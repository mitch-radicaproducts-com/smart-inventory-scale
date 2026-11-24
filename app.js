import { buildReport, diagnosticPlan, reportFilename, runDiagnostic } from "./diagnostic.js?v=3";
import { createStreamParser, interpretLine } from "./protocol.js?v=3";

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
const diagnoseBtn = document.querySelector("#diagnose");
const downloadDiagnosticBtn = document.querySelector("#download-diagnostic");
const diagnosticProgress = document.querySelector("#diagnostic-progress");

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
let readGeneration = 0;
let sampleTimers = [];
let diagnosticBucket = null;
let diagnosticRunning = false;
let diagnosticReport = null;

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
  const copy = new Uint8Array(bytes);
  if (diagnosticBucket) diagnosticBucket.push(copy);
  if (diagnosticRunning) return;
  const noisy = [...copy].filter((byte) => byte < 9 || (byte > 13 && byte < 32) || byte > 126).length;
  if (copy.length && noisy / copy.length > 0.4) {
    const hex = [...copy].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
    appendLog(hex, "note");
    setStatus("Received bytes that are not text. Match baud, data bits, and parity to the scale.");
    return;
  }
  ingestText(new TextDecoder().decode(copy));
}

function setConnected(connected) {
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  sendBtn.disabled = !connected || diagnosticRunning;
  diagnoseBtn.disabled = diagnosticRunning;
  diagnoseBtn.classList.toggle("is-ready", connected && !diagnosticRunning);
  if (!diagnosticReport) {
    diagnosticProgress.textContent = connected
      ? "Port open. Run diagnostic is ready."
      : "Connect the adapter, then choose Run diagnostic.";
  }
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
      if (generation !== readGeneration) break;
      if (done) break;
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
  const currentWriter = writer;
  reader = null;
  writer = null;
  if (currentReader) {
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
  if (currentWriter) {
    try {
      currentWriter.releaseLock();
    } catch (error) {
      appendLog(error.message || "The writer lock was already released.", "note");
    }
  }
}

function startReading() {
  readGeneration += 1;
  reader = port.readable.getReader();
  writer = port.writable.getWriter();
  readLoop(readGeneration);
}

async function setPortOptions(options) {
  await stopReading();
  await port.close();
  await port.open({ ...options, flowControl: "none" });
  startReading();
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function openPort(nextPort) {
  await nextPort.open(serialOptions());
  port = nextPort;
  setConnected(true);
  const options = serialOptions();
  setStatus(`Connected at ${options.baudRate} baud, ${options.dataBits}${options.parity === "none" ? "N" : options.parity[0].toUpperCase()}${options.stopBits}. Press P on the scale, or send R.`);
  startReading();
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
  diagnosticRunning = false;
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

function concatBytes(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function downloadReport(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = reportFilename(new Date());
  link.click();
  URL.revokeObjectURL(url);
}

async function runHardwareDiagnostic() {
  if (!writer || diagnosticRunning) {
    setStatus("Connect the adapter first.");
    return;
  }
  const original = serialOptions();
  diagnosticRunning = true;
  diagnosticReport = null;
  downloadDiagnosticBtn.disabled = true;
  setConnected(true);
  const startedAt = new Date().toISOString();
  try {
    const trials = await runDiagnostic(diagnosticPlan(), {
      signal: { get aborted() { return !diagnosticRunning || !port; } },
      onProgress(current, total, step) {
        const detail = step.port ? `${step.label}` : step.label;
        diagnosticProgress.textContent = `${current} of ${total}: ${detail}`;
        setStatus(`Diagnostic ${current} of ${total}`);
      },
      async write(text) {
        if (!diagnosticBucket) diagnosticBucket = [];
        await writer.write(new TextEncoder().encode(text));
      },
      async collect(waitMs) {
        if (!diagnosticBucket) diagnosticBucket = [];
        const mine = diagnosticBucket;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        if (diagnosticBucket === mine) diagnosticBucket = null;
        return concatBytes(mine);
      },
      async setPort(options) {
        await setPortOptions(options);
      },
    });
    const report = buildReport({ startedAt, port: original, trials });
    diagnosticReport = report;
    downloadDiagnosticBtn.disabled = false;
    try {
      await setPortOptions(original);
    } catch (restoreError) {
      appendLog(restoreError.message || "The original port settings were not restored.", "note");
    }
    downloadReport(report);
    const summary = `Diagnostic finished. ${report.replyCount} of ${report.trialCount} probes returned bytes. Choose Download log if the file did not save on its own.`;
    diagnosticProgress.textContent = summary;
    setStatus(summary);
    appendLog(summary, "note");
  } catch (error) {
    setStatus(error.message || "The diagnostic stopped.");
    try {
      if (port) await setPortOptions(original);
    } catch (restoreError) {
      appendLog(restoreError.message || "The original port settings were not restored.", "note");
    }
  } finally {
    diagnosticBucket = null;
    diagnosticRunning = false;
    if (port) setConnected(true);
  }
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
diagnoseBtn.addEventListener("click", () => {
  runHardwareDiagnostic();
});
downloadDiagnosticBtn.addEventListener("click", () => {
  if (diagnosticReport) downloadReport(diagnosticReport);
});

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
