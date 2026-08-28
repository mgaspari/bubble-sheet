import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);

test("the CommonJS build loads and works", () => {
  const { Sheet, score } = require("../dist/cjs/index.cjs");
  const sheet = new Sheet({ questions: 3 });
  sheet.handleKey({ key: "a" });
  assert.deepEqual(sheet.value, { 1: "A" });
  assert.equal(score(sheet.value, { 1: "A" }).correct, 1);
});

test("both builds ship types", () => {
  assert.ok(existsSync(new URL("../dist/esm/index.d.ts", import.meta.url)));
  assert.ok(existsSync(new URL("../dist/cjs/index.d.cts", import.meta.url)));
});
