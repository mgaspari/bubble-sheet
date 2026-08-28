// Regressions for the findings of the pre-merge code review.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Sheet, mount, mountGrid, score, serialize } from "../dist/esm/index.js";

let dom;
let host;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='host'></div>");
  global.document = dom.window.document;
  host = dom.window.document.getElementById("host");
});

const type = (box, char) => {
  box.value = char;
  box.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};
const cells = (field) => [...field.element.querySelectorAll(".bs-cell")];

test("initial grow text with out-of-charset characters leaves no orphan cells", () => {
  // "1" is not a letter, so only "AB" lands; the field must settle at 3 cells
  // with none of them stale.
  const field = mountGrid(host, { grow: { max: 10 }, text: "AB1" });
  assert.equal(field.text, "AB");
  assert.equal(cells(field).length, 3);
  // the trailing cell is live: typing into it must not throw
  type(cells(field)[2].querySelector(".bs-box"), "C");
  assert.equal(field.text, "ABC");
});

test("resizing the sheet under mount() redraws the rows", () => {
  const bubbles = mount(host, { questions: 10, columns: 2, value: { 2: "A", 8: "B" } });
  bubbles.sheet.resize(5);
  assert.equal(bubbles.element.querySelectorAll(".bs-row").length, 5);
  bubbles.sheet.resize(8);
  assert.equal(bubbles.element.querySelectorAll(".bs-row").length, 8);
  // surviving answers still painted, and new rows are live
  assert.equal(bubbles.element.querySelector('[data-question="2"] input[value="A"]').checked, true);
  const q7 = bubbles.element.querySelector('[data-question="7"] input[value="C"]');
  q7.checked = true;
  q7.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(bubbles.value[7], "C");
});

test("an external resize on a growing field cannot duplicate cells", () => {
  const field = mountGrid(host, { grow: { max: 10 }, text: "ABCD" });
  field.sheet.resize(3); // drops D; ensureSize immediately re-grows to 4
  const numbers = cells(field).map((c) => c.dataset.cell);
  assert.deepEqual(numbers, [...new Set(numbers)]);
  assert.equal(cells(field).length, field.sheet.questions);
  assert.equal(field.text, "ABC");
});

test("choice values containing the old join character still compare correctly", () => {
  const sheet = new Sheet({
    questions: 2,
    maxSelections: 3,
    choices: ["A B", "A", "B"],
    value: { 1: ["A B"] },
  });
  assert.equal(sheet.setValue({ 1: ["A", "B"] }), true);
  assert.deepEqual(sheet.value, { 1: ["A", "B"] });
});

test("serialize refuses multi-select values it could not read back", () => {
  assert.throws(
    () => serialize({ 1: ["10", "11"] }, { questions: 1, separator: "," }),
    /longer than one character/,
  );
});

test("a fractional maxSelections is floored", () => {
  const sheet = new Sheet({ questions: 1, maxSelections: 2.5 });
  sheet.set(1, "A");
  sheet.set(1, "B");
  assert.equal(sheet.set(1, "C"), false);
  assert.deepEqual(sheet.value, { 1: ["A", "B"] });
});

test("empty arrays grade as blank, not incorrect", () => {
  const result = score({ 1: [] }, { 1: ["A"], 2: [] });
  assert.equal(result.byQuestion[1], "blank");
  assert.equal(result.byQuestion[2], "ungraded");
  assert.equal(result.incorrect, 0);
});
