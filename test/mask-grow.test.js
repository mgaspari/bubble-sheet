import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mountGrid } from "../dist/esm/index.js";

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
const press = (el, key) =>
  el.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
const boxOf = (field, cell) =>
  field.element.querySelector(`.bs-cell[data-cell="${cell}"] .bs-box`);
const cellCount = (field) => field.element.querySelectorAll(".bs-cell").length;

/* -------------------------------------------------------------------- mask */

test("a string mask makes cells and printed literals", () => {
  const field = mountGrid(host, { mask: "99/99/9999", caption: "Date" });
  assert.equal(cellCount(field), 8);
  const seps = [...field.element.querySelectorAll(".bs-sep")].map((s) => s.textContent);
  assert.deepEqual(seps, ["/", "/"]);
  // each cell's stack offers only its own menu — ten digits here
  assert.equal(field.element.querySelectorAll('.bs-cell[data-cell="1"] .bs-oval').length, 10);
});

test("mask text round-trips with literals included or omitted", () => {
  const field = mountGrid(host, { mask: "99/99/9999" });
  field.text = "08/28/2026";
  assert.equal(field.text, "08/28/2026");
  field.text = "12312026";
  assert.equal(field.text, "12/31/2026");
});

test("a partial mask entry keeps literals up to the last filled cell", () => {
  const field = mountGrid(host, { mask: "99/99/9999" });
  field.text = "083";
  assert.equal(field.text, "08/3");
});

test("an array mask restricts cells individually", () => {
  const field = mountGrid(host, {
    mask: ["01", "0123456789", { literal: ":" }, "012345", "0123456789"],
  });
  assert.equal(field.element.querySelectorAll('.bs-cell[data-cell="1"] .bs-oval').length, 2);
  type(boxOf(field, 1), "5"); // not in "01"
  assert.equal(field.text, "");
  type(boxOf(field, 1), "1");
  assert.equal(field.text, "1");
});

test("a masked cell refuses characters that belong to other cells", () => {
  const field = mountGrid(host, { mask: "A9" });
  type(boxOf(field, 1), "7"); // digit into the letter cell
  assert.equal(field.text, "");
  type(boxOf(field, 1), "X");
  type(boxOf(field, 2), "7");
  assert.equal(field.text, "X7");
});

test("mask and grow together are refused", () => {
  assert.throws(() => mountGrid(host, { mask: "99", grow: true }), /grow and.*mask/i);
});

/* -------------------------------------------------------------------- grow */

test("a growing field keeps one empty cell after the last filled", () => {
  const field = mountGrid(host, { grow: { min: 1, max: 10 } });
  assert.equal(cellCount(field), 1);
  field.focus(1);
  type(boxOf(field, 1), "A");
  assert.equal(cellCount(field), 2);
  type(boxOf(field, 2), "B");
  assert.equal(cellCount(field), 3);
  assert.equal(field.text, "AB");
});

test("backspace erases one character per press, shrinking as it goes", () => {
  const field = mountGrid(host, { grow: { max: 10 }, text: "ABC" });
  assert.equal(cellCount(field), 4);
  const trailing = boxOf(field, 4);
  press(trailing, "Backspace"); // empty cell: clears C, cell 4 falls away
  assert.equal(field.text, "AB");
  assert.equal(cellCount(field), 3);
  press(boxOf(field, 3), "Backspace");
  assert.equal(field.text, "A");
  assert.equal(cellCount(field), 2);
  press(boxOf(field, 2), "Backspace");
  assert.equal(field.text, "");
  assert.equal(cellCount(field), 1);
});

test("backspace on a filled cell clears it in place first", () => {
  const field = mountGrid(host, { grow: { max: 10 }, text: "ABC" });
  field.focus(2);
  press(boxOf(field, 2), "Backspace");
  assert.equal(field.text, "A C");
  assert.equal(cellCount(field), 4); // C still holds the field open
  press(boxOf(field, 2), "Backspace"); // now empty: clears A to the left
  assert.equal(field.text, "  C");
});

test("growth stops at max and starts at min", () => {
  const field = mountGrid(host, { grow: { min: 3, max: 4 } });
  assert.equal(cellCount(field), 3);
  field.text = "WXYZ";
  assert.equal(cellCount(field), 4);
  assert.equal(field.text, "WXYZ");
  type(boxOf(field, 4), "Q"); // full: replaces the last cell, no growth
  assert.equal(cellCount(field), 4);
  assert.equal(field.text, "WXYQ");
});

test("setting shorter text shrinks the field back", () => {
  const field = mountGrid(host, { grow: { min: 2, max: 12 }, text: "LOVELACE" });
  assert.equal(cellCount(field), 9);
  field.text = "LI";
  assert.equal(cellCount(field), 3);
  assert.equal(field.text, "LI");
});

test("cells added by growth are live, not stale clones", () => {
  const field = mountGrid(host, { grow: { max: 6 } });
  field.focus(1);
  for (const char of "ABC") type(dom.window.document.activeElement, char);
  assert.equal(field.text, "ABC");
  // the newest cell accepts a bubble click too
  const oval = field.element.querySelector('.bs-cell[data-cell="4"] input[value="D"]');
  oval.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail: 1 }));
  oval.checked = true;
  oval.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(field.text, "ABCD");
  assert.equal(cellCount(field), 5);
});
