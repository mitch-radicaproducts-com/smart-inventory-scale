import { createStreamParser, interpretLine } from "./protocol.js";

const statusEl = document.querySelector("#status");
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
const commandForm = document.querySelector("#command-form");
const commandEl = document.querySelector("#command");
const endLineEl = document.querySelector("#end-line");
const sendBtn = document.querySelector("#send");
const sampleBtn = document.querySelector("#sample");
const clearBtn = document.querySelector("#clear");

const reading = {
  weightText: null,
  piecesText: null,
  unitWeightText: null,
  stable: null,
  overload: false,
};

const parser = createStreamParser();
const sampleLines = ["ST, 12.500 kg", "U.W. 25.000 g", "PCS 500 pcs"];
const maxLogLines = 200;

let port = null;
let reader = null;
let writer = null;
let readingPort = false;
let sampleTimers = [];

function setStatus(text) {
  statusEl.textContent = text;
}

function render() {
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
  for (const parsed of parser.push(text)) applyInterpreted(parsed);
}

function ingestBytes(bytes) {
  const noisy = [...bytes].filter((byte) => byte < 9 || (byte > 13 && byte < 32) || byte > 126).length;
  if (bytes.length && noisy / bytes.length > 0.4) {
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
    appendLog(hex, "note");
    setStatus("Received bytes that are not text. Match baud, data bits, and parity to the scale.");
    return;
  }
  ingestText(new TextDecoder().decode(bytes));
}

function setConnected(connected) {
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  sendBtn.disabled = !connected;
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

async function readLoop() {
  readingPort = true;
  try {
    while (readingPort && reader) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) ingestBytes(value);
    }
  } catch (error) {
    if (readingPort) setStatus(error.message || "The serial read stopped.");
  } finally {
    readingPort = false;
  }
}

async function openPort(nextPort) {
  await nextPort.open(serialOptions());
  port = nextPort;
  reader = port.readable.getReader();
  writer = port.writable.getWriter();
  setConnected(true);
  const options = serialOptions();
  setStatus(`Connected at ${options.baudRate} baud, ${options.dataBits}${options.parity === "none" ? "N" : options.parity[0].toUpperCase()}${options.stopBits}. Press P on the scale, or send R.`);
  readLoop();
}

async function connectNewPort() {
  if (!("serial" in navigator)) {
    setStatus("This browser has no Web Serial port. Open the page in Chrome on the Chromebook.");
    return;
  }
  if (!window.isSecureContext) {
    setStatus("Open this page at http://localhost or on https. The serial port stays blocked on other addresses.");
    return;
  }
  try {
    const nextPort = await navigator.serial.requestPort();
    await openPort(nextPort);
  } catch (error) {
    if (error.name === "NotFoundError") setStatus("No serial port was selected.");
    else setStatus(error.message || "Could not open the serial port.");
  }
}

async function reconnectGrantedPort() {
  const ports = await navigator.serial.getPorts();
  const nextPort = ports[0];
  if (!nextPort) {
    setStatus("Chrome has not been allowed to use an adapter yet. Use Connect.");
    return;
  }
  try {
    await openPort(nextPort);
  } catch (error) {
    setStatus(error.message || "Could not reopen the adapter.");
  }
}

async function disconnect() {
  readingPort = false;
  try {
    if (reader) await reader.cancel();
  } catch (error) {
    appendLog(error.message || "The reader was already closed.", "note");
  }
  try {
    reader?.releaseLock();
    writer?.releaseLock();
    await port?.close();
  } catch (error) {
    appendLog(error.message || "The port was already closed.", "note");
  }
  port = null;
  reader = null;
  writer = null;
  setConnected(false);
  setStatus("Not connected.");
}

async function sendCommand(event) {
  event.preventDefault();
  if (!writer) {
    setStatus("Connect the adapter first.");
    return;
  }
  let payload = commandEl.value;
  if (endLineEl.checked && !payload.endsWith("\n")) payload += "\r\n";
  try {
    await writer.write(new TextEncoder().encode(payload));
    appendLog(`Sent ${JSON.stringify(payload)}`, "note");
  } catch (error) {
    setStatus(error.message || "Could not send the command.");
  }
}

function clearSampleTimers() {
  for (const timer of sampleTimers) clearTimeout(timer);
  sampleTimers = [];
}

function showSample() {
  clearSampleTimers();
  appendLog("Sample lines, not from the scale.", "note");
  sampleLines.forEach((line, index) => {
    const timer = setTimeout(() => {
      applyInterpreted(interpretLine(line));
    }, 400 * (index + 1));
    sampleTimers.push(timer);
  });
}

function clearBench() {
  clearSampleTimers();
  parser.reset();
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
commandForm.addEventListener("submit", (event) => {
  sendCommand(event);
});
sampleBtn.addEventListener("click", showSample);
clearBtn.addEventListener("click", clearBench);

if (!("serial" in navigator)) {
  setStatus("This browser has no Web Serial port. Open the page in Chrome on the Chromebook.");
} else if (!window.isSecureContext) {
  setStatus("Open this page at http://localhost or on https. The serial port stays blocked on other addresses.");
} else {
  navigator.serial.getPorts().then((ports) => {
    reconnectBtn.hidden = ports.length === 0;
  });
}

render();
