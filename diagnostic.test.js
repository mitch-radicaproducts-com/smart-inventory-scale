import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildReport,
  bytesToHex,
  bytesToText,
  diagnosticPlan,
  reportFilename,
  runDiagnostic,
} from "./diagnostic.js";

const BANNED = ["789", "CAL", "AU-CAL", "FACTORY", "RESET"];

test("the plan probes characters and read commands without setup or calibration", () => {
  const plan = diagnosticPlan();
  assert.ok(plan.length > 100);
  assert.equal(plan[0].send, null);
  assert.ok(plan.some((step) => step.send === "R\r\n"));
  assert.ok(plan.some((step) => step.send === "P\r\n"));
  assert.ok(plan.some((step) => step.send === "SI\r\n"));
  for (const step of plan) {
    const sent = (step.send ?? "").toUpperCase();
    for (const banned of BANNED) assert.equal(sent.includes(banned), false);
  }
});

test("formats bytes as hex and visible text", () => {
  const bytes = new Uint8Array([0x31, 0x32, 0x2e, 0x35, 0x0d, 0x0a, 0x00]);
  assert.equal(bytesToHex(bytes), "31 32 2e 35 0d 0a 00");
  assert.equal(bytesToText(bytes), "12.5\\r\\n.");
});

test("a run records silence and a reply", async () => {
  const plan = [
    { id: 1, phase: "listen", label: "listen", send: null, waitMs: 5, port: null },
    { id: 2, phase: "line", label: JSON.stringify("R\r\n"), send: "R\r\n", waitMs: 5, port: null },
  ];
  const writes = [];
  const trials = await runDiagnostic(plan, {
    async write(text) {
      writes.push(text);
    },
    async collect() {
      return writes.length ? new Uint8Array([0x53, 0x54, 0x0d, 0x0a]) : new Uint8Array();
    },
    async setPort() {},
  });
  assert.deepEqual(writes, ["R\r\n"]);
  assert.equal(trials[0].byteCount, 0);
  assert.equal(trials[1].responseText, "ST\\r\\n");
  assert.equal(trials[1].responseHex, "53 54 0d 0a");
  const report = buildReport({
    startedAt: "2026-11-24T16:00:00.000Z",
    port: { baudRate: 9600, dataBits: 8, parity: "none", stopBits: 1 },
    trials,
  });
  assert.equal(report.replyCount, 1);
  assert.equal(report.replies[0].label, JSON.stringify("R\r\n"));
});

test("a failed write stops the run and keeps the partial log", async () => {
  const plan = diagnosticPlan().slice(0, 3);
  const trials = await runDiagnostic(plan, {
    async write() {
      throw new Error("port closed");
    },
    async collect() {
      return new Uint8Array([1]);
    },
    async setPort() {},
  });
  assert.equal(trials.length, 2);
  assert.equal(trials[1].error, "port closed");
  assert.equal(trials[1].byteCount, 0);
});

test("the report file name is sortable", () => {
  const name = reportFilename(new Date(2026, 10, 24, 9, 5, 7));
  assert.equal(name, "seaks3011d-diagnostic-20261124-090507.json");
});

test("the page exposes the diagnostic controls", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /id="diagnose"/);
  assert.doesNotMatch(html, /id="diagnose"[^>]*disabled/);
  assert.match(html, /app\.js\?v=3/);
  assert.match(html, /id="download-diagnostic"/);
  assert.match(html, /id="diagnostic-progress"/);
});
