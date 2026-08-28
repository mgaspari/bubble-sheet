import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mount } from "../dist/esm/index.js";

let dom;
let host;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='host'></div>", { pretendToBeVisual: true });
  global.document = dom.window.document;
  host = dom.window.document.getElementById("host");
});

const click = (el) =>
  el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, detail: 1 }));

const key = (el, k) =>
  el.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true }));

test("renders a row per question and an oval per choice", () => {
  const bubbles = mount(host, { questions: 4, choices: ["A", "B", "C"], columns: 2 });
  assert.equal(bubbles.element.querySelectorAll(".bs-row").length, 4);
  assert.equal(bubbles.element.querySelectorAll(".bs-col").length, 2);
  assert.equal(bubbles.element.querySelectorAll(".bs-row")[0].querySelectorAll("input").length, 3);
  assert.equal(bubbles.element.style.getPropertyValue("--bs-columns"), "2");
});

test("renders the answers it was given", () => {
  const bubbles = mount(host, { questions: 3, value: { 2: "B" } });
  const row = bubbles.element.querySelector('[data-question="2"]');
  assert.equal(row.classList.contains("is-marked"), true);
  assert.equal(row.querySelectorAll("input")[1].checked, true);
  assert.equal(row.querySelectorAll(".bs-oval")[1].classList.contains("is-filled"), true);
});

test("clicking an oval fills it, clicking again erases it", () => {
  const changes = [];
  const bubbles = mount(host, { questions: 3, onChange: (value) => changes.push(value) });
  const oval = bubbles.element.querySelector('[data-question="1"] input[value="C"]');

  click(oval);
  assert.equal(bubbles.value[1], "C");

  click(oval);
  assert.equal(bubbles.value[1], undefined);
  assert.equal(oval.checked, false);
  assert.equal(
    bubbles.element.querySelector('[data-question="1"]').classList.contains("is-marked"),
    false,
  );
  assert.deepEqual(changes, [{ 1: "C" }, {}]);
});

test("typing a choice fills the question and moves focus to the next", () => {
  const bubbles = mount(host, { questions: 3 });
  bubbles.focus(1, 0);
  key(dom.window.document.activeElement, "b");

  assert.equal(bubbles.value[1], "B");
  assert.deepEqual(bubbles.sheet.cursor, { question: 2, choice: 1 });
  assert.equal(dom.window.document.activeElement.dataset.question, "2");
  assert.equal(dom.window.document.activeElement.dataset.choice, "1");
});

test("focusing an oval moves the cursor to it", () => {
  const bubbles = mount(host, { questions: 3 });
  bubbles.element.querySelector('[data-question="3"] input[value="D"]').focus();
  assert.deepEqual(bubbles.sheet.cursor, { question: 3, choice: 3 });
});

test("model changes reach the markup", () => {
  const bubbles = mount(host, { questions: 3 });
  bubbles.sheet.set(3, "E");
  assert.equal(
    bubbles.element.querySelector('[data-question="3"] input[value="E"]').checked,
    true,
  );
  bubbles.value = { 1: "A" };
  assert.equal(
    bubbles.element.querySelector('[data-question="3"] input[value="E"]').checked,
    false,
  );
  assert.equal(
    bubbles.element.querySelector('[data-question="1"] input[value="A"]').checked,
    true,
  );
});

test("disabling stops marks and disables every input", () => {
  const bubbles = mount(host, { questions: 2 });
  bubbles.disabled = true;
  assert.ok([...bubbles.element.querySelectorAll("input")].every((i) => i.disabled));
  click(bubbles.element.querySelector('input[value="A"]'));
  assert.deepEqual(bubbles.value, {});
  bubbles.disabled = false;
  click(bubbles.element.querySelector('input[value="A"]'));
  assert.deepEqual(bubbles.value, { 1: "A" });
});

test("radios share a name per question so a plain form posts them", () => {
  const bubbles = mount(host, { questions: 2, name: (q) => `answer[${q}]` });
  const names = [...bubbles.element.querySelectorAll('[data-question="2"] input')].map(
    (i) => i.name,
  );
  assert.deepEqual(new Set(names), new Set(["answer[2]"]));
});

test("destroy removes the markup and stops listening", () => {
  const bubbles = mount(host, { questions: 2 });
  const sheet = bubbles.sheet;
  bubbles.destroy();
  assert.equal(host.children.length, 0);
  sheet.set(1, "A"); // must not throw against detached nodes
  assert.equal(sheet.get(1), "A");
});

test("each question is an accessible radiogroup", () => {
  const bubbles = mount(host, { questions: 2, label: (q) => `Item ${q}` });
  const row = bubbles.element.querySelector('[data-question="2"]');
  assert.equal(row.getAttribute("role"), "radiogroup");
  assert.equal(row.getAttribute("aria-label"), "Item 2");
});
