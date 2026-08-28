import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Sheet, mount, score, serialize, deserialize } from "../dist/esm/index.js";

/* ------------------------------------------------------------ choice labels */

test("choices may carry labels; values are what gets stored", () => {
  const sheet = new Sheet({
    questions: 3,
    choices: ["A", { value: "B", label: "Sometimes" }, { value: "C", label: "Never" }],
  });
  assert.deepEqual([...sheet.choices], ["A", "B", "C"]);
  assert.equal(sheet.labelOf("B"), "Sometimes");
  assert.equal(sheet.labelOf("A"), undefined);
  sheet.handleKey({ key: "b" });
  assert.deepEqual(sheet.value, { 1: "B" });
});

/* ------------------------------------------------------------- multi-select */

const multi = (options) =>
  new Sheet({ questions: 5, maxSelections: Infinity, ...options });

test("a multi-select sheet stores arrays in canonical choice order", () => {
  const sheet = multi();
  sheet.set(1, "C");
  sheet.set(1, "A");
  assert.deepEqual(sheet.value, { 1: ["A", "C"] });
  assert.equal(sheet.has(1, "C"), true);
  assert.deepEqual([...sheet.selected(1)], ["A", "C"]);
});

test("unset removes one selection; removing the last clears the question", () => {
  const sheet = multi({ value: { 1: ["A", "C"] } });
  assert.equal(sheet.unset(1, "A"), true);
  assert.deepEqual(sheet.value, { 1: ["C"] });
  assert.equal(sheet.unset(1, "C"), true);
  assert.deepEqual(sheet.value, {});
  assert.equal(sheet.unset(1, "C"), false);
});

test("maxSelections caps how many marks a question takes", () => {
  const sheet = new Sheet({ questions: 3, maxSelections: 2 });
  assert.equal(sheet.set(1, "A"), true);
  assert.equal(sheet.set(1, "B"), true);
  assert.equal(sheet.set(1, "C"), false);
  assert.deepEqual(sheet.value, { 1: ["A", "B"] });
  sheet.unset(1, "A");
  assert.equal(sheet.set(1, "C"), true);
});

test("on a multi-select sheet a choice key toggles and stays put", () => {
  const sheet = multi();
  sheet.handleKey({ key: "a" });
  sheet.handleKey({ key: "c" });
  assert.deepEqual(sheet.value, { 1: ["A", "C"] });
  assert.equal(sheet.cursor.question, 1);
  sheet.handleKey({ key: "a" });
  assert.deepEqual(sheet.value, { 1: ["C"] });
  sheet.handleKey({ key: "Enter" });
  assert.equal(sheet.cursor.question, 2);
});

test("sanitize keeps arrays that fit and drops what does not", () => {
  const sheet = new Sheet({
    questions: 3,
    maxSelections: 2,
    value: { 1: ["c", "a", "Z", "A"], 2: "B", 9: ["A"] },
  });
  assert.deepEqual(sheet.value, { 1: ["A", "C"], 2: ["B"] });
});

/* ------------------------------------------------------------------ resize */

test("resize drops answers past the end and clamps the cursor", () => {
  const sheet = new Sheet({ questions: 10, value: { 2: "A", 8: "B" } });
  const events = [];
  sheet.on("resize", (e) => events.push(e));
  sheet.setCursor(9, 0);
  assert.equal(sheet.resize(5), true);
  assert.equal(sheet.questions, 5);
  assert.deepEqual(sheet.value, { 2: "A" });
  assert.equal(sheet.cursor.question, 5);
  assert.deepEqual(events, [{ questions: 5, previous: 10 }]);
  assert.equal(sheet.resize(5), false);
});

/* ---------------------------------------------------------------- grading */

test("a multi-select answer is correct only as an exact set", () => {
  const key = { 1: ["A", "C"], 2: "B" };
  const result = score({ 1: ["c", "a"], 2: ["B"] }, key);
  assert.equal(result.correct, 2);
  assert.equal(score({ 1: ["A"] }, key).byQuestion[1], "incorrect");
  assert.equal(score({ 1: ["A", "C", "E"] }, key).byQuestion[1], "incorrect");
});

test("multi answers serialize side by side and need a separator", () => {
  const answers = { 1: ["A", "C"], 3: "B" };
  assert.throws(() => serialize(answers, { questions: 3 }), /separator/);
  const packed = serialize(answers, { questions: 3, separator: "," });
  assert.equal(packed, "AC,-,B");
  assert.deepEqual(deserialize(packed, { separator: ",", multi: true }), {
    1: ["A", "C"],
    3: ["B"],
  });
});

/* -------------------------------------------------------------- rendering */

let dom;
let host;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='host'></div>");
  global.document = dom.window.document;
  host = dom.window.document.getElementById("host");
});

const click = (el) =>
  el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail: 1 }));

test("a multi-select sheet renders checkboxes and paints every selection", () => {
  const bubbles = mount(host, { questions: 3, maxSelections: 3, value: { 1: ["A", "C"] } });
  const row = bubbles.element.querySelector('[data-question="1"]');
  assert.equal(row.getAttribute("role"), "group");
  const inputs = [...row.querySelectorAll("input")];
  assert.ok(inputs.every((i) => i.type === "checkbox"));
  assert.deepEqual(inputs.filter((i) => i.checked).map((i) => i.value), ["A", "C"]);
  assert.equal(row.querySelectorAll(".is-filled").length, 2);
});

test("checkbox clicks toggle selections through the model", () => {
  const bubbles = mount(host, { questions: 2, maxSelections: 2 });
  const a = bubbles.element.querySelector('[data-question="1"] input[value="A"]');
  const c = bubbles.element.querySelector('[data-question="1"] input[value="C"]');
  click(a);
  click(c);
  assert.deepEqual(bubbles.value, { 1: ["A", "C"] });
  click(a);
  assert.deepEqual(bubbles.value, { 1: ["C"] });
});

test("a full multi-select question refuses further checks in the markup too", () => {
  const bubbles = mount(host, { questions: 1, maxSelections: 2, value: { 1: ["A", "B"] } });
  const c = bubbles.element.querySelector('input[value="C"]');
  click(c);
  assert.deepEqual(bubbles.value, { 1: ["A", "B"] });
  assert.equal(c.checked, false);
});

test("labeled choices render their label beside the bubble", () => {
  const bubbles = mount(host, {
    questions: 1,
    choices: [{ value: "1", label: "Poor" }, { value: "2" }, { value: "3", label: "Great" }],
  });
  const labels = [...bubbles.element.querySelectorAll(".bs-choice-label")].map(
    (l) => l.textContent,
  );
  assert.deepEqual(labels, ["Poor", "Great"]);
  const input = bubbles.element.querySelector('input[value="1"]');
  assert.equal(input.getAttribute("aria-label"), "1: Poor");
});
