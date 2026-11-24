import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createStreamParser, interpretLine } from "./protocol.js";

test("reads a stable weight line", () => {
  const parsed = interpretLine("ST, 12.500 kg");
  assert.equal(parsed.weightText, "12.500 kg");
  assert.equal(parsed.stable, true);
  assert.equal(parsed.unitWeightText, null);
  assert.equal(parsed.piecesText, null);
});

test("reads an unstable compact weight", () => {
  const parsed = interpretLine("US,+0001.50g");
  assert.equal(parsed.weightText, "+0001.50 g");
  assert.equal(parsed.stable, false);
});

test("keeps a negative net weight", () => {
  assert.equal(interpretLine("Net -0.500 kg").weightText, "-0.500 kg");
});

test("treats unit weight separately from total weight", () => {
  const parsed = interpretLine("U.W. 25.000 g");
  assert.equal(parsed.unitWeightText, "25.000 g");
  assert.equal(parsed.weightText, null);
});

test("reads Unit Wt. lines", () => {
  assert.equal(interpretLine("Unit Wt. 123 g").unitWeightText, "123 g");
});

test("reads piece counts from either word order", () => {
  assert.equal(interpretLine("PCS 500 pcs").piecesText, "500");
  assert.equal(interpretLine("500 pieces").piecesText, "500");
  assert.equal(interpretLine("QTY: 12").piecesText, "12");
});

test("marks overload without inventing a weight", () => {
  const parsed = interpretLine("OVER");
  assert.equal(parsed.overload, true);
  assert.equal(parsed.weightText, null);
});

test("keeps unrecognized text raw", () => {
  const parsed = interpretLine("hello scale");
  assert.equal(parsed.raw, "hello scale");
  assert.equal(parsed.weightText, null);
  assert.equal(parsed.piecesText, null);
  assert.equal(parsed.unitWeightText, null);
});

test("a bare number does not get a unit", () => {
  const parsed = interpretLine("12.500");
  assert.equal(parsed.raw, "12.500");
  assert.equal(parsed.weightText, null);
  assert.equal(parsed.unitWeightText, null);
});

test("splits CR LF frames and holds a partial line", () => {
  const parser = createStreamParser();
  assert.deepEqual(
    parser.push("ST, 12.500 kg\r\nU.W. 25").map((line) => line.raw),
    ["ST, 12.500 kg"],
  );
  const rest = parser.push(".000 g\r\nPCS 500 pcs\r\n");
  assert.equal(rest[0].unitWeightText, "25.000 g");
  assert.equal(rest[1].piecesText, "500");
});

test("drops blank lines and resets a partial frame", () => {
  const parser = createStreamParser();
  assert.deepEqual(parser.push("\r\n\n"), []);
  assert.deepEqual(parser.push("ST, 12"), []);
  parser.reset();
  const next = parser.push(".500 kg\r\n");
  assert.equal(next[0].raw, ".500 kg");
  assert.equal(next[0].weightText, null);
});

test("the page exposes the serial controls", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  for (const id of ["connect", "disconnect", "clear", "print", "weight", "pieces", "unit-weight", "log", "baud"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /id="diagnose"/);
  assert.doesNotMatch(html, /id="send"/);
  assert.match(html, /app\.js\?v=4/);
});
