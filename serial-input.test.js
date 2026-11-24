import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createScaleFeed, isTextBytes } from "./serial-input.js";

test("trailing spaces on a print are not typed", () => {
  const feed = createScaleFeed();
  assert.deepEqual(feed("0.0000kg  \r\n0.0000kg  "), [
    { type: "text", text: "0.0000kg" },
    { type: "enter" },
    { type: "text", text: "0.0000kg" },
  ]);
});

test("a print types the number and one Enter", () => {
  const feed = createScaleFeed();
  assert.deepEqual(feed("12.500\r\n"), [
    { type: "text", text: "12.500" },
    { type: "enter" },
  ]);
});

test("a split print still types in order", () => {
  const feed = createScaleFeed();
  assert.deepEqual(feed("12."), [{ type: "text", text: "12." }]);
  assert.deepEqual(feed("500\n"), [
    { type: "text", text: "500" },
    { type: "enter" },
  ]);
});

test("CR LF is one Enter and a bare number gets no unit", () => {
  const feed = createScaleFeed();
  assert.deepEqual(feed("\r\n4\r\n"), [
    { type: "enter" },
    { type: "text", text: "4" },
    { type: "enter" },
  ]);
});

test("garbled bytes are rejected", () => {
  assert.equal(isTextBytes(new Uint8Array([0x31, 0x32, 0x0d, 0x0a])), true);
  assert.equal(isTextBytes(new Uint8Array([0x00, 0x01, 0xff, 0xfe])), false);
});

test("the userscript carries the same feed", () => {
  const normalize = (source) => source
    .replace(/^export /gm, "")
    .replace(/^\/\/.*\n/gm, "")
    .replace(/^[ \t]+/gm, "")
    .trim();
  const library = normalize(readFileSync(new URL("./serial-input.js", import.meta.url), "utf8"));
  const script = readFileSync(new URL("./scale.user.js", import.meta.url), "utf8");
  const start = script.indexOf("function isTextBytes");
  const end = script.indexOf("const button");
  assert.equal(normalize(script.slice(start, end)), library);
  assert.match(script, /@grant\s+none/);
  assert.match(script, /@noframes/);
  assert.match(script, /navigator\.serial/);
  assert.match(script, /getPorts/);
});
