// ==UserScript==
// @name         SEAKS3011D scale input
// @namespace    https://github.com/mitch-radicaproducts-com/smart-inventory-scale
// @version      1.3.0
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

    function takeEnd() {
      const actions = [];
      while (pending.startsWith("\r") || pending.startsWith("\n")) {
        const first = pending[0];
        pending = pending.slice(1);
        if (first === "\r" && pending.startsWith("\n")) pending = pending.slice(1);
        if (first === "\n" && pending.startsWith("\r")) pending = pending.slice(1);
        actions.push({ type: "end" });
      }
      return actions;
    }

    function emitText(actions, raw) {
      const text = raw.trim();
      if (text) actions.push({ type: "text", text });
    }

    return function push(chunk) {
      pending += chunk;
      const actions = takeEnd();
      while (pending.length) {
        const cr = pending.indexOf("\r");
        const lf = pending.indexOf("\n");
        const cut = cr >= 0 && lf >= 0 ? Math.min(cr, lf) : Math.max(cr, lf);
        if (cut === -1) {
          emitText(actions, pending);
          pending = "";
          break;
        }
        if (cut > 0) emitText(actions, pending.slice(0, cut));
        pending = pending.slice(cut);
        actions.push(...takeEnd());
      }
      return actions;
    };
  }

  const panel = document.createElement("div");
  panel.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483647",
    "display:grid",
    "gap:6px",
    "padding:8px",
    "border:1px solid #1c1914",
    "border-radius:10px",
    "background:#fffdf8",
    "color:#1c1914",
    "font:13px/1.2 system-ui,sans-serif",
    "box-shadow:0 1px 4px rgba(28,25,20,0.18)",
  ].join(";");

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Connect scale";
  button.title = "Reopens the saved adapter. The first time on a site, Chrome still asks you to choose it.";
  button.style.cssText = [
    "padding:8px 12px",
    "border:1px solid #1c1914",
    "border-radius:8px",
    "background:#fffdf8",
    "color:#1c1914",
    "font:inherit",
    "cursor:pointer",
  ].join(";");

  function savedAfter() {
    try {
      return JSON.parse(localStorage.getItem("seaks3011d-after") || "{}");
    } catch {
      return {};
    }
  }

  function rememberAfter() {
    localStorage.setItem("seaks3011d-after", JSON.stringify({
      tab: tabBox.checked,
      enter: enterBox.checked,
    }));
  }

  function addChoice(name, label, checked) {
    const row = document.createElement("label");
    row.style.cssText = "display:flex;gap:6px;align-items:center;cursor:pointer;";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = checked;
    box.addEventListener("change", rememberAfter);
    row.append(box, document.createTextNode(label));
    panel.append(row);
    return box;
  }

  const remembered = savedAfter();
  panel.append(button);
  const tabBox = addChoice("tab", "Send Tab After", remembered.tab === true);
  const enterBox = addChoice("enter", "Send Enter After", remembered.enter === true);
  button.addEventListener("mousedown", (event) => event.preventDefault());

  let port = null;
  let reader = null;
  let reading = false;
  let generation = 0;
  let paused = false;
  let opening = null;
  const feed = createScaleFeed();
  const decoder = new TextDecoder();

  function setButton(text, listening) {
    button.textContent = text;
    button.style.background = listening ? "#0d5c56" : "#fffdf8";
    button.style.color = listening ? "#f3fffc" : "#1c1914";
  }

  function insertText(text) {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement || panel.contains(el)) return;
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

  function pressKey(key) {
    const el = document.activeElement;
    if (!el || panel.contains(el)) return;
    const init = { key, code: key, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  let settleTimer = null;
  let waitingToFinish = false;

  function sendAfter() {
    waitingToFinish = false;
    if (tabBox.checked) pressKey("Tab");
    if (enterBox.checked) pressKey("Enter");
  }

  function applyActions(actions) {
    for (const action of actions) {
      if (action.type === "text") {
        insertText(action.text);
        waitingToFinish = true;
      } else if (waitingToFinish) {
        clearTimeout(settleTimer);
        sendAfter();
      }
    }
    if (!waitingToFinish) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(sendAfter, 150);
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
    paused = true;
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

  function openPort(nextPort) {
    if (port || paused) return Promise.resolve();
    if (opening) return opening;
    opening = (async () => {
      try {
        await nextPort.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
        if (paused) {
          await nextPort.close();
          return;
        }
        port = nextPort;
        generation += 1;
        reader = port.readable.getReader();
        setButton("Scale on", true);
        readLoop(generation);
      } finally {
        opening = null;
      }
    })();
    return opening;
  }

  async function useRememberedPort() {
    if (port || paused) return false;
    const ports = await serial.getPorts();
    if (ports.length !== 1) return false;
    await openPort(ports[0]);
    return true;
  }

  async function connect() {
    paused = false;
    if (await useRememberedPort()) return;
    await openPort(await serial.requestPort());
  }

  function report(error) {
    if (error?.name === "NotFoundError") setButton("Connect scale", false);
    else setButton(error?.message || "Scale failed", false);
  }

  button.addEventListener("click", () => {
    const action = port ? disconnect() : connect();
    action.catch(report);
  });

  serial.addEventListener("connect", (event) => {
    if (port || paused) return;
    openPort(event.target).catch(() => setButton("Connect scale", false));
  });

  useRememberedPort().catch(() => setButton("Connect scale", false));

  document.documentElement.append(panel);
})();
