import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { CHARSETS, Sheet, mountGrid } from "../dist/esm/index.js";

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
  el.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const click = (el) =>
  el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail: 1 }));
const boxOf = (field, cell) => field.element.querySelector(`.bs-cell[data-cell="${cell}"] .bs-box`);
const boxes = (field) => [...field.element.querySelectorAll(".bs-box")].map((b) => b.value).join("");

test("renders a box and a full stack of bubbles per cell", () => {
  const field = mountGrid(host, { cells: 4, charset: "letters", caption: "Name" });
  assert.equal(field.element.querySelectorAll(".bs-cell").length, 4);
  assert.equal(field.element.querySelectorAll(".bs-box").length, 4);
  assert.equal(field.element.querySelectorAll('.bs-cell[data-cell="1"] .bs-oval').length, 26);
  assert.equal(field.element.querySelector(".bs-field-caption").textContent, "Name");
});

test("initial text reaches both the boxes and the bubbles", () => {
  const field = mountGrid(host, { cells: 6, text: "ADA" });
  assert.equal(boxes(field), "ADA");
  assert.equal(field.text, "ADA");
  const filled = [...field.element.querySelectorAll(".bs-oval.is-filled .bs-face")].map(
    (f) => f.textContent,
  );
  assert.deepEqual(filled, ["A", "D", "A"]);
});

test("typing fills the column and moves to the next box", () => {
  const field = mountGrid(host, { cells: 4 });
  field.focus(1);
  type(boxOf(field, 1), "k");
  assert.equal(field.text, "K");
  assert.equal(
    field.element.querySelector('.bs-cell[data-cell="1"] input[value="K"]').checked,
    true,
  );
  assert.equal(dom.window.document.activeElement, boxOf(field, 2));
});

test("a character the field does not offer is refused", () => {
  const field = mountGrid(host, { cells: 4, charset: "letters" });
  type(boxOf(field, 1), "7");
  assert.equal(field.text, "");
  assert.equal(boxOf(field, 1).value, "");
});

test("digits fill a numeric field instead of jumping to a cell", () => {
  const field = mountGrid(host, { cells: 6, charset: "digits" });
  field.focus(1);
  for (const digit of "4021") type(dom.window.document.activeElement, digit);
  assert.equal(field.text, "4021");
});

test("space blanks a column, which is how names are split", () => {
  const field = mountGrid(host, { cells: 8, text: "LEE" });
  field.focus(4);
  press(boxOf(field, 4), " ");
  type(boxOf(field, 5), "A");
  assert.equal(field.text, "LEE A");
});

test("backspace clears the current cell, then walks back", () => {
  const field = mountGrid(host, { cells: 6, text: "ABC" });
  field.focus(3);
  press(boxOf(field, 3), "Backspace"); // clears C
  assert.equal(field.text, "AB");
  press(boxOf(field, 3), "Backspace"); // empty now, so back up and clear B
  assert.equal(field.text, "A");
  assert.equal(dom.window.document.activeElement, boxOf(field, 2));
});

test("filling a bubble writes the character into the box", () => {
  const field = mountGrid(host, { cells: 4, charset: "digits" });
  click(field.element.querySelector('.bs-cell[data-cell="2"] input[value="7"]'));
  assert.equal(boxOf(field, 2).value, "7");
  assert.equal(field.text, " 7");
});

test("clicking a filled bubble erases the column", () => {
  const field = mountGrid(host, { cells: 3, text: "XY" });
  click(field.element.querySelector('.bs-cell[data-cell="1"] input[value="X"]'));
  assert.equal(field.text, " Y");
  assert.equal(boxOf(field, 1).value, "");
});

test("text round-trips and trailing blanks are trimmed", () => {
  const field = mountGrid(host, { cells: 10 });
  field.text = "LOVELACE";
  assert.equal(field.text, "LOVELACE");
  assert.deepEqual(field.value, { 1: "L", 2: "O", 3: "V", 4: "E", 5: "L", 6: "A", 7: "C", 8: "E" });
  field.text = "LI";
  assert.equal(field.text, "LI");
  assert.equal(boxes(field), "LI");
});

test("a hidden input carries the text for a plain form post", () => {
  const field = mountGrid(host, { cells: 6, name: "student-name", text: "ADA" });
  const hidden = field.element.querySelector('input[type="hidden"][name="student-name"]');
  assert.equal(hidden.value, "ADA");
  type(boxOf(field, 4), "M");
  assert.equal(hidden.value, "ADAM");
});

test("the charsets are the ones a printed form offers", () => {
  assert.equal(CHARSETS.letters.length, 26);
  assert.equal(CHARSETS.digits, "0123456789");
  assert.equal(CHARSETS.alphanumeric.length, 36);
  const field = mountGrid(host, { cells: 2, charset: "AB" });
  assert.deepEqual([...field.sheet.choices], ["A", "B"]);
});

test("a disabled field refuses typing and disables its inputs", () => {
  const field = mountGrid(host, { cells: 3, text: "AB" });
  field.disabled = true;
  assert.ok([...field.element.querySelectorAll("input:not([type=hidden])")].every((i) => i.disabled));
  type(boxOf(field, 3), "C");
  assert.equal(field.text, "AB");
});

test("destroy removes the field", () => {
  const field = mountGrid(host, { cells: 3 });
  field.destroy();
  assert.equal(host.children.length, 0);
});

test("a column field walks cells sideways and characters downward", () => {
  const sheet = new Sheet({ questions: 5, choices: [..."ABCD"], orientation: "columns" });
  sheet.handleKey({ key: "ArrowRight" });
  assert.deepEqual(sheet.cursor, { question: 2, choice: 0 });
  sheet.handleKey({ key: "ArrowDown" });
  sheet.handleKey({ key: "ArrowDown" });
  assert.deepEqual(sheet.cursor, { question: 2, choice: 2 });
  sheet.handleKey({ key: "ArrowLeft" });
  assert.deepEqual(sheet.cursor, { question: 1, choice: 2 });
});

test("space on a columns sheet blanks the cell and advances", () => {
  const sheet = new Sheet({
    questions: 4,
    choices: [..."ABCD"],
    orientation: "columns",
    value: { 1: "A", 2: "B" },
  });
  sheet.handleKey({ key: " " }); // cell 1: blanked, cursor moves on
  assert.equal(sheet.get(1), undefined);
  assert.equal(sheet.cursor.question, 2);
  sheet.handleKey({ key: " " });
  assert.deepEqual(sheet.value, {});
  assert.equal(sheet.cursor.question, 3);
});

test("space on the bubbles of a field advances like in the boxes", () => {
  const field = mountGrid(host, { cells: 5, text: "AB" });
  const oval = field.element.querySelector('.bs-cell[data-cell="1"] input[value="A"]');
  oval.focus();
  press(oval, " ");
  assert.equal(field.text, " B");
  assert.equal(field.sheet.cursor.question, 2);
});

test("digitJump off leaves digit keys to the caller", () => {
  const sheet = new Sheet({ questions: 20, digitJump: false });
  assert.equal(sheet.handleKey({ key: "5" }), false);
  assert.equal(sheet.cursor.question, 1);
});
