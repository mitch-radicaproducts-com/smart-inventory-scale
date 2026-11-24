// ==UserScript==
// @name         SEAKS3011D scale input
// @namespace    https://github.com/mitch-radicaproducts-com/smart-inventory-scale
// @version      1.0.0
// @description  Type prints from the SEAKS3011D RS-232 adapter into the focused field
// @match        https://*/*
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  const serial = navigator.serial;
  if (!serial) return;

  function isTextBytes(bytes) {
    if (!bytes.length) return true;
    let noisy = 0;
    for (const byte of bytes) {
      if (byte < 9 || (byte > 13 && byte < 32) || byte > 126) noisy += 1;
    }
    return noisy / bytes.length <= 0.4;
  }

  function createScaleFeed() {
    let pending = "";

    function takeEnter() {
      const actions = [];
      while (pending.startsWith("\r") || pending.startsWith("\n")) {
        const first = pending[0];
        pending = pending.slice(1);
        if (first === "\r" && pending.startsWith("\n")) pending = pending.slice(1);
        if (first === "\n" && pending.startsWith("\r")) pending = pending.slice(1);
        actions.push({ type: "enter" });
      }
      return actions;
    }

    return function push(chunk) {
      pending += chunk;
      const actions = takeEnter();
      while (pending.length) {
        const cr = pending.indexOf("\r");
        const lf = pending.indexOf("\n");
        const cut = cr >= 0 && lf >= 0 ? Math.min(cr, lf) : Math.max(cr, lf);
        if (cut === -1) {
          actions.push({ type: "text", text: pending });
          pending = "";
          break;
        }
        if (cut > 0) actions.push({ type: "text", text: pending.slice(0, cut) });
        pending = pending.slice(cut);
        actions.push(...takeEnter());
      }
      return actions;
    };
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Connect scale";
  button.title = "Open the SEAKS3011D adapter at 9600 8N1. Then click a field and press P.";
  button.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483647",
    "padding:8px 12px",
    "border:1px solid #1c1914",
    "border-radius:8px",
    "background:#fffdf8",
    "color:#1c1914",
    "font:14px/1.2 system-ui,sans-serif",
    "cursor:pointer",
  ].join(";");
  button.addEventListener("mousedown", (event) => event.preventDefault());

  let port = null;
  let reader = null;
  let reading = false;
  let generation = 0;
  const feed = createScaleFeed();
  const decoder = new TextDecoder();

  function setButton(text, listening) {
    button.textContent = text;
    button.style.background = listening ? "#0d5c56" : "#fffdf8";
    button.style.color = listening ? "#f3fffc" : "#1c1914";
  }

  function insertText(text) {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement || el === button) return;
    if (el.isContentEditable) {
      document.execCommand("insertText", false, text);
      return;
    }
    const prototype = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    if (!("value" in el) || typeof el.selectionStart !== "number") return;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = String(el.value).slice(0, start) + text + String(el.value).slice(end);
    if (setter) setter.call(el, next);
    else el.value = next;
    const caret = start + text.length;
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  function pressEnter() {
    const el = document.activeElement;
    if (!el || el === button) return;
    const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  function applyActions(actions) {
    for (const action of actions) {
      if (action.type === "text") insertText(action.text);
      else pressEnter();
    }
  }

  async function readLoop(token) {
    reading = true;
    try {
      while (reading && reader && token === generation) {
        const { value, done } = await reader.read();
        if (token !== generation || done) break;
        if (!value) continue;
        if (!isTextBytes(value)) {
          setButton("Scale: garbled", true);
          continue;
        }
        applyActions(feed(decoder.decode(value, { stream: true })));
        setButton("Scale on", true);
      }
    } catch (error) {
      if (token === generation) setButton(error.message || "Scale stopped", false);
    } finally {
      if (token === generation) reading = false;
    }
  }

  async function disconnect() {
    generation += 1;
    reading = false;
    const current = reader;
    reader = null;
    if (current) {
      try { await current.cancel(); } catch { /* already closed */ }
      try { current.releaseLock(); } catch { /* already released */ }
    }
    try { await port?.close(); } catch { /* already closed */ }
    port = null;
    setButton("Connect scale", false);
  }

  async function connect() {
    const nextPort = await serial.requestPort();
    await nextPort.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
    port = nextPort;
    generation += 1;
    reader = port.readable.getReader();
    setButton("Scale on", true);
    readLoop(generation);
  }

  button.addEventListener("click", () => {
    const action = port ? disconnect() : connect();
    action.catch((error) => {
      if (error.name === "NotFoundError") setButton("Connect scale", false);
      else setButton(error.message || "Scale failed", false);
    });
  });

  document.documentElement.append(button);
})();
