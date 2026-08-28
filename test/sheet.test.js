import { test } from "node:test";
import assert from "node:assert/strict";
import { Sheet } from "../dist/esm/index.js";

const setup = (options) => new Sheet({ questions: 10, ...options });

test("starts empty and clamps its configuration", () => {
  const sheet = setup();
  assert.deepEqual(sheet.value, {});
  assert.equal(sheet.answered, 0);
  assert.equal(sheet.complete, false);
  assert.deepEqual(sheet.cursor, { question: 1, choice: 0 });
  assert.deepEqual([...sheet.choices], ["A", "B", "C", "D", "E"]);
});

test("drops answers that do not fit the sheet", () => {
  const sheet = setup({ value: { 1: "C", 0: "A", 11: "B", 2: "Z", 3: "e" } });
  assert.deepEqual(sheet.value, { 1: "C", 3: "E" });
});

test("set, clear and toggle report whether anything moved", () => {
  const sheet = setup();
  assert.equal(sheet.set(1, "C"), true);
  assert.equal(sheet.set(1, "C"), false);
  assert.equal(sheet.get(1), "C");
  assert.equal(sheet.toggle(1, "C"), true);
  assert.equal(sheet.get(1), undefined);
  assert.equal(sheet.clear(1), false);
});

test("rejects marks that are not on the sheet", () => {
  const sheet = setup();
  assert.throws(() => sheet.set(11, "A"), RangeError);
  assert.throws(() => sheet.set(1, "Z"), /Unknown choice/);
});

test("value is frozen and replaced, never mutated", () => {
  const sheet = setup();
  const before = sheet.value;
  sheet.set(1, "A");
  assert.notEqual(sheet.value, before);
  assert.deepEqual(before, {});
  assert.equal(Object.isFrozen(sheet.value), true);
});

test("change events name the questions that moved", () => {
  const sheet = setup({ value: { 1: "A", 2: "B" } });
  const seen = [];
  const off = sheet.on("change", (event) => seen.push(event));
  sheet.setValue({ 2: "B", 3: "C" });
  assert.deepEqual(seen[0].questions, [1, 3]);
  assert.deepEqual(seen[0].previous, { 1: "A", 2: "B" });
  off();
  sheet.clearAll();
  assert.equal(seen.length, 1);
});

test("a disabled sheet refuses marks but still navigates", () => {
  const sheet = setup({ disabled: true, value: { 1: "A" } });
  assert.equal(sheet.set(2, "B"), false);
  assert.equal(sheet.clear(1), false);
  sheet.handleKey({ key: "ArrowDown" });
  assert.equal(sheet.cursor.question, 2);
});

test("the cursor clamps, or wraps when asked", () => {
  const sheet = setup();
  sheet.setCursor(99, 99);
  assert.deepEqual(sheet.cursor, { question: 10, choice: 4 });
  sheet.setCursor(-5, -5);
  assert.deepEqual(sheet.cursor, { question: 1, choice: 0 });

  const looped = setup({ wrap: true });
  looped.setCursor(11, 5);
  assert.deepEqual(looped.cursor, { question: 1, choice: 0 });
  looped.moveQuestion(-1);
  assert.equal(looped.cursor.question, 10);
});

test("a choice key fills the question and advances", () => {
  const sheet = setup();
  assert.equal(sheet.handleKey({ key: "c" }), true);
  assert.equal(sheet.get(1), "C");
  assert.deepEqual(sheet.cursor, { question: 2, choice: 2 });
});

test("backspace erases and steps back, delete stays put", () => {
  const sheet = setup({ value: { 3: "A", 4: "B" } });
  sheet.setCursor(4, 0);
  sheet.handleKey({ key: "Backspace" });
  assert.equal(sheet.get(4), undefined);
  assert.equal(sheet.cursor.question, 3);
  sheet.handleKey({ key: "Delete" });
  assert.equal(sheet.get(3), undefined);
  assert.equal(sheet.cursor.question, 3);
});

test("arrows walk questions and ovals", () => {
  const sheet = setup();
  sheet.handleKey({ key: "ArrowDown" });
  sheet.handleKey({ key: "ArrowRight" });
  sheet.handleKey({ key: "ArrowRight" });
  assert.deepEqual(sheet.cursor, { question: 2, choice: 2 });
  sheet.handleKey({ key: "ArrowUp" });
  sheet.handleKey({ key: "ArrowLeft" });
  assert.deepEqual(sheet.cursor, { question: 1, choice: 1 });
  sheet.handleKey({ key: "End" });
  assert.equal(sheet.cursor.question, 10);
  sheet.handleKey({ key: "PageUp" });
  assert.equal(sheet.cursor.question, 1);
});

test("enter fills the oval under the cursor, space toggles it", () => {
  const sheet = setup();
  sheet.setCursor(1, 3);
  sheet.handleKey({ key: "Enter" });
  assert.equal(sheet.get(1), "D");
  assert.equal(sheet.cursor.question, 2);
  sheet.handleKey({ key: " " });
  assert.equal(sheet.get(2), "D");
  sheet.handleKey({ key: " " });
  assert.equal(sheet.get(2), undefined);
});

test("digits compose a question number inside the timeout", () => {
  let clock = 0;
  const sheet = new Sheet({ questions: 120, now: () => clock, digitTimeout: 800 });
  sheet.handleKey({ key: "1" });
  assert.equal(sheet.cursor.question, 1);
  clock += 100;
  sheet.handleKey({ key: "2" });
  assert.equal(sheet.cursor.question, 12);
  clock += 5000;
  sheet.handleKey({ key: "3" });
  assert.equal(sheet.cursor.question, 3);
  clock += 100;
  assert.equal(sheet.handleKey({ key: "Escape" }), true);
  clock += 100;
  sheet.handleKey({ key: "9" });
  assert.equal(sheet.cursor.question, 9);
});

test("numeric labels are filled rather than treated as jumps", () => {
  const sheet = new Sheet({ questions: 20, choices: ["1", "2", "3", "4"] });
  sheet.handleKey({ key: "3" });
  assert.equal(sheet.get(1), "3");
  assert.equal(sheet.cursor.question, 2);
});

test("keys the sheet does not own are left alone", () => {
  const sheet = setup();
  assert.equal(sheet.handleKey({ key: "Tab" }), false);
  assert.equal(sheet.handleKey({ key: "a", metaKey: true }), false);
  assert.equal(sheet.get(1), undefined);
});
