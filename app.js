import { createStreamParser } from "./protocol.js?v=4";

const statusEl = document.querySelector("#status");
const printEl = document.querySelector("#print");
const weightEl = document.querySelector("#weight");
const piecesEl = document.querySelector("#pieces");
const unitWeightEl = document.querySelector("#unit-weight");
const stabilityEl = document.querySelector("#stability");
const logEl = document.querySelector("#log");
const baudEl = document.querySelector("#baud");
const dataBitsEl = document.querySelector("#data-bits");
const parityEl = document.querySelector("#parity");
const stopBitsEl = document.querySelector("#stop-bits");
const connectBtn = document.querySelector("#connect");
const reconnectBtn = document.querySelector("#reconnect");
const disconnectBtn = document.querySelector("#disconnect");

const reading = {
  printText: null,
  weightText: null,
  piecesText: null,
  unitWeightText: null,
  stable: null,
  overload: false,
};

const parser = createStreamParser();
const maxLogLines = 200;

let port = null;
let reader = null;
let readingPort = false;
let readGeneration = 0;

function setStatus(text) {
  statusEl.textContent = text;
}

function render() {
  printEl.textContent = reading.printText ?? "—";
  weightEl.textContent = reading.overload ? "OVER" : reading.weightText ?? "—";
  piecesEl.textContent = reading.piecesText ?? "—";
  unitWeightEl.textContent = reading.unitWeightText ?? "—";
  stabilityEl.textContent = reading.stable == null ? "" : reading.stable ? "Stable" : "Moving";
  stabilityEl.classList.toggle("warn", reading.stable === false);
}

function appendLog(text, kind) {
  const item = document.createElement("li");
  item.textContent = text;
  if (kind) item.classList.add(kind);
  logEl.append(item);
  while (logEl.children.length > maxLogLines) logEl.firstElementChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}

function applyInterpreted(parsed) {
  if (!parsed) return;
  appendLog(parsed.raw);
  reading.printText = parsed.raw;
  if (parsed.overload) reading.overload = true;
  if (parsed.weightText) {
    reading.weightText = parsed.weightText;
    reading.overload = false;
  }
  if (parsed.piecesText) reading.piecesText = parsed.piecesText;
  if (parsed.unitWeightText) reading.unitWeightText = parsed.unitWeightText;
  if (parsed.stable != null) reading.stable = parsed.stable;
  render();
}

function ingestText(text) {
  const parsed = parser.push(text);
  if (parsed.length === 0 && text.trim()) {
    const pending = text.replace(/\s+/g, " ").trim();
    reading.printText = pending;
    appendLog(pending);
    render();
    return;
  }
  for (const line of parsed) applyInterpreted(line);
}

function ingestBytes(bytes) {
  const copy = new Uint8Array(bytes);
  const noisy = [...copy].filter((byte) => byte < 9 || (byte > 13 && byte < 32) || byte > 126).length;
  if (copy.length && noisy / copy.length > 0.4) {
    const hex = [...copy].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
    reading.printText = hex;
    appendLog(hex, "note");
    setStatus("Received bytes that are not text. Match baud, data bits, and parity to the scale.");
    render();
    return;
  }
  ingestText(new TextDecoder().decode(copy));
}

function setConnected(connected) {
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  baudEl.disabled = connected;
  dataBitsEl.disabled = connected;
  parityEl.disabled = connected;
  stopBitsEl.disabled = connected;
}

function serialOptions() {
  return {
    baudRate: Number(baudEl.value),
    dataBits: Number(dataBitsEl.value),
    stopBits: Number(stopBitsEl.value),
    parity: parityEl.value,
    flowControl: "none",
  };
}

async function readLoop(generation) {
  readingPort = true;
  try {
    while (readingPort && reader && generation === readGeneration) {
      const { value, done } = await reader.read();
      if (generation !== readGeneration || done) break;
      if (value) ingestBytes(value);
    }
  } catch (error) {
    if (generation === readGeneration && readingPort) setStatus(error.message || "The serial read stopped.");
  } finally {
    if (generation === readGeneration) readingPort = false;
  }
}

async function stopReading() {
  readGeneration += 1;
  readingPort = false;
  const currentReader = reader;
  reader = null;
  if (!currentReader) return;
  try {
    await currentReader.cancel();
  } catch (error) {
    appendLog(error.message || "The reader was already closed.", "note");
  }
  try {
    currentReader.releaseLock();
  } catch (error) {
    appendLog(error.message || "The reader lock was already released.", "note");
  }
}

function startReading() {
  readGeneration += 1;
  reader = port.readable.getReader();
  readLoop(readGeneration);
}

async function openPort(nextPort) {
  await nextPort.open(serialOptions());
  port = nextPort;
  setConnected(true);
  const options = serialOptions();
  const parity = options.parity === "none" ? "N" : options.parity[0].toUpperCase();
  setStatus(`Listening at ${options.baudRate} baud, ${options.dataBits}${parity}${options.stopBits}. Press P on the scale.`);
  startReading();
}

async function connectNewPort() {
  if (!("serial" in navigator)) {
    setStatus("This browser has no Web Serial port. Open the page in Chrome.");
    return;
  }
  if (!window.isSecureContext) {
    setStatus("Open this page on https. The serial port stays blocked on other addresses.");
    return;
  }
  try {
    await openPort(await navigator.serial.requestPort());
  } catch (error) {
    if (error.name === "NotFoundError") setStatus("No serial port was selected.");
    else setStatus(error.message || "Could not open the serial port.");
  }
}

async function reconnectGrantedPort() {
  const ports = await navigator.serial.getPorts();
  if (!ports[0]) {
    setStatus("Chrome has not been allowed to use an adapter yet. Use Connect.");
    return;
  }
  try {
    await openPort(ports[0]);
  } catch (error) {
    setStatus(error.message || "Could not reopen the adapter.");
  }
}

async function disconnect() {
  await stopReading();
  try {
    await port?.close();
  } catch (error) {
    appendLog(error.message || "The port was already closed.", "note");
  }
  port = null;
  setConnected(false);
  setStatus("Not connected.");
}

function clearBench() {
  parser.reset();
  reading.printText = null;
  reading.weightText = null;
  reading.piecesText = null;
  reading.unitWeightText = null;
  reading.stable = null;
  reading.overload = false;
  logEl.replaceChildren();
  render();
}

connectBtn.addEventListener("click", () => {
  connectNewPort();
});
reconnectBtn.addEventListener("click", () => {
  reconnectGrantedPort();
});
disconnectBtn.addEventListener("click", () => {
  disconnect();
});
document.querySelector("#clear").addEventListener("click", clearBench);

if (!("serial" in navigator)) {
  setStatus("This browser has no Web Serial port. Open the page in Chrome.");
} else if (!window.isSecureContext) {
  setStatus("Open this page on https. The serial port stays blocked on other addresses.");
} else {
  navigator.serial.getPorts().then((ports) => {
    reconnectBtn.hidden = ports.length === 0;
  });
}

render();
