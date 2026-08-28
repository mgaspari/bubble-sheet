import { test } from "node:test";
import assert from "node:assert/strict";
import { columnize, deserialize, score, serialize } from "../dist/esm/index.js";

test("columnize fills column by column", () => {
  assert.deepEqual(columnize(5, 2), [[1, 2, 3], [4, 5]]);
  assert.deepEqual(columnize(4, 2), [[1, 2], [3, 4]]);
  assert.deepEqual(columnize(3), [[1, 2, 3]]);
  assert.deepEqual(columnize(0, 2), [[], []]);
});

test("score counts correct, incorrect and blank", () => {
  const result = score({ 1: "C", 2: "a", 3: "D" }, { 1: "C", 2: "A", 3: "B", 4: "E" });
  assert.equal(result.total, 4);
  assert.equal(result.correct, 2);
  assert.equal(result.incorrect, 1);
  assert.equal(result.blank, 1);
  assert.equal(result.answered, 3);
  assert.equal(result.percent, 0.5);
  assert.deepEqual(result.byQuestion, {
    1: "correct",
    2: "correct",
    3: "incorrect",
    4: "blank",
  });
});

test("questions the key skips are ungraded, not wrong", () => {
  const result = score({ 1: "A", 2: "B" }, { 2: "B" }, { questions: 3 });
  assert.equal(result.ungraded, 2);
  assert.equal(result.graded, 1);
  assert.equal(result.correct, 1);
  assert.equal(result.percent, 1);
  assert.equal(result.byQuestion[1], "ungraded");
});

test("an empty key grades nothing rather than dividing by zero", () => {
  assert.equal(score({}, {}).percent, 0);
});

test("serialize and deserialize round-trip", () => {
  const answers = { 1: "C", 3: "A", 5: "E" };
  const packed = serialize(answers, { questions: 6 });
  assert.equal(packed, "C-A-E-");
  assert.deepEqual(deserialize(packed), answers);
});

test("serialize needs a separator for multi-character labels", () => {
  const answers = { 1: "True", 2: "False" };
  assert.throws(() => serialize(answers, { questions: 2 }), /separator/);
  const packed = serialize(answers, { questions: 3, separator: "," });
  assert.equal(packed, "True,False,-");
  assert.deepEqual(deserialize(packed, { separator: "," }), answers);
});

test("deserialize ignores labels the sheet does not offer", () => {
  assert.deepEqual(deserialize("aZc", { choices: ["A", "B", "C"] }), { 1: "A", 3: "C" });
});
