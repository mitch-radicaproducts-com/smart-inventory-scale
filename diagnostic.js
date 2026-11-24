const BYTE_WAIT_MS = 350;
const LINE_WAIT_MS = 400;
const NAMED_WAIT_MS = 500;
const LISTEN_WAIT_MS = 2000;
const FRAME_LISTEN_MS = 600;
const FRAME_COMMAND_MS = 700;

const NAMED_COMMANDS = ["SI\r\n", "SIR\r\n", "ID\r\n", "PCS\r\n", "WT\r\n", "READ\r\n", "PRINT\r\n", "?\r\n"];

const FRAMINGS = [
  { dataBits: 8, parity: "none", stopBits: 1, tag: "8N1" },
  { dataBits: 7, parity: "even", stopBits: 1, tag: "7E1" },
  { dataBits: 7, parity: "none", stopBits: 1, tag: "7N1" },
];

const BAUD_RATES = [1200, 2400, 4800, 9600, 19200];

export function diagnosticPlan() {
  const steps = [{ phase: "listen", send: null, waitMs: LISTEN_WAIT_MS, port: null }];

  for (let code = 32; code <= 126; code += 1) {
    steps.push({ phase: "byte", send: String.fromCharCode(code), waitMs: BYTE_WAIT_MS, port: null });
  }

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (const character of letters) {
    steps.push({ phase: "line", send: `${character}\r\n`, waitMs: LINE_WAIT_MS, port: null });
  }

  for (const send of NAMED_COMMANDS) {
    steps.push({ phase: "named", send, waitMs: NAMED_WAIT_MS, port: null });
  }

  for (const framing of FRAMINGS) {
    for (const baudRate of BAUD_RATES) {
      const port = {
        baudRate,
        dataBits: framing.dataBits,
        parity: framing.parity,
        stopBits: framing.stopBits,
        flowControl: "none",
      };
      steps.push({
        phase: "framing",
        send: null,
        waitMs: FRAME_LISTEN_MS,
        port,
        label: `listen ${baudRate} ${framing.tag}`,
      });
      steps.push({
        phase: "framing",
        send: "R\r\n",
        waitMs: FRAME_COMMAND_MS,
        port: null,
        label: `R ${baudRate} ${framing.tag}`,
      });
    }
  }

  return steps.map((step, index) => ({
    id: index + 1,
    phase: step.phase,
    send: step.send,
    waitMs: step.waitMs,
    port: step.port,
    label: step.label ?? (step.send == null ? "listen" : JSON.stringify(step.send)),
  }));
}

export function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

export function bytesToText(bytes) {
  return [...bytes]
    .map((byte) => {
      if (byte === 13) return "\\r";
      if (byte === 10) return "\\n";
      if (byte === 9) return "\\t";
      if (byte >= 32 && byte <= 126) return String.fromCharCode(byte);
      return ".";
    })
    .join("");
}

export function describeTrial(step, response, elapsedMs, error) {
  const bytes = response ?? new Uint8Array();
  return {
    id: step.id,
    phase: step.phase,
    label: step.label,
    sentText: step.send,
    sentHex: step.send == null ? "" : bytesToHex(new TextEncoder().encode(step.send)),
    waitMs: step.waitMs,
    port: step.port,
    responseHex: bytesToHex(bytes),
    responseText: bytesToText(bytes),
    byteCount: bytes.length,
    elapsedMs: Math.round(elapsedMs),
    error: error ?? null,
  };
}

export async function runDiagnostic(plan, io) {
  const trials = [];
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    if (io.signal?.aborted) break;
    io.onProgress?.(index + 1, plan.length, step);
    if (step.port) {
      try {
        await io.setPort(step.port);
      } catch (portError) {
        trials.push(describeTrial(step, new Uint8Array(), 0, portError.message || "The port did not reopen."));
        break;
      }
    }
    const started = performance.now();
    let error = null;
    if (step.send != null) {
      try {
        await io.write(step.send);
      } catch (writeError) {
        error = writeError.message || "The write failed.";
      }
    }
    const response = error ? new Uint8Array() : await io.collect(step.waitMs);
    trials.push(describeTrial(step, response, performance.now() - started, error));
    if (error) break;
  }
  return trials;
}

export function buildReport({ startedAt, port, trials }) {
  const replies = trials.filter((trial) => trial.byteCount > 0);
  return {
    model: "SEAKS3011D",
    startedAt,
    port,
    trialCount: trials.length,
    replyCount: replies.length,
    replies: replies.map((trial) => ({
      id: trial.id,
      label: trial.label,
      responseText: trial.responseText,
      responseHex: trial.responseHex,
      byteCount: trial.byteCount,
    })),
    trials,
  };
}

export function reportFilename(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `seaks3011d-diagnostic-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`;
}
