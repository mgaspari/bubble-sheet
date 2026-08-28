import type { Answers, Choice } from "./types.js";

/** `ungraded` means the answer key has no entry for that question. */
export type Outcome = "correct" | "incorrect" | "blank" | "ungraded";

export interface Score {
  /** Questions graded — `options.questions`, or the size of the key. */
  total: number;
  /** Questions the key actually covers. */
  graded: number;
  answered: number;
  correct: number;
  incorrect: number;
  /** Keyed questions left unanswered. */
  blank: number;
  ungraded: number;
  /** `correct / graded`, in the range 0..1. `0` when there is nothing to grade. */
  percent: number;
  byQuestion: Record<number, Outcome>;
}

export interface ScoreOptions {
  /** Grade this many questions. Default: the number of entries in `key`. */
  questions?: number;
}

/**
 * Grade a sheet against an answer key. Comparison is case-insensitive, and a
 * question the key does not cover comes back `ungraded` rather than counting
 * for or against the taker.
 *
 * ```ts
 * score({ 1: "C", 2: "A" }, { 1: "C", 2: "B" }); // 1 correct, 1 incorrect
 * ```
 */
export function score(answers: Answers, key: Answers, options: ScoreOptions = {}): Score {
  const questions =
    options.questions ?? Object.keys(key).reduce((max, q) => Math.max(max, Number(q)), 0);

  const byQuestion: Record<number, Outcome> = {};
  let correct = 0;
  let incorrect = 0;
  let blank = 0;
  let ungraded = 0;

  for (let q = 1; q <= questions; q++) {
    const expected = key[q];
    const given = answers[q];
    let outcome: Outcome;
    if (expected === undefined) outcome = "ungraded";
    else if (given === undefined) outcome = "blank";
    else outcome = same(given, expected) ? "correct" : "incorrect";

    byQuestion[q] = outcome;
    if (outcome === "correct") correct++;
    else if (outcome === "incorrect") incorrect++;
    else if (outcome === "blank") blank++;
    else ungraded++;
  }

  const graded = questions - ungraded;

  return {
    total: questions,
    graded,
    answered: correct + incorrect,
    correct,
    incorrect,
    blank,
    ungraded,
    percent: graded > 0 ? correct / graded : 0,
    byQuestion,
  };
}

export interface SerializeOptions {
  /** How many slots to write. Default: the highest answered question. */
  questions?: number;
  /** Placeholder for an unanswered question. Default `"-"`. */
  blank?: string;
  /** Put this between slots. Default `""`, which requires single-character labels. */
  separator?: string;
}

/**
 * Flatten answers into one compact string — handy for a URL, a database
 * column, or a diff.
 *
 * ```ts
 * serialize({ 1: "C", 3: "A" }, { questions: 4 }); // "C-A-"
 * ```
 */
export function serialize(answers: Answers, options: SerializeOptions = {}): string {
  const blank = options.blank ?? "-";
  const separator = options.separator ?? "";
  const questions =
    options.questions ??
    Object.keys(answers).reduce((max, q) => Math.max(max, Number(q)), 0);

  const cells: string[] = [];
  for (let q = 1; q <= questions; q++) {
    const cell = answers[q] ?? blank;
    if (separator === "" && cell.length !== 1) {
      throw new Error(
        `Cannot pack ${JSON.stringify(cell)} without a separator: labels must be one character`,
      );
    }
    cells.push(cell);
  }
  return cells.join(separator);
}

export interface DeserializeOptions {
  /** Restrict to these labels; anything else is treated as blank. */
  choices?: readonly Choice[];
  /** Placeholder for an unanswered question. Default `"-"`. */
  blank?: string;
  /** Separator used when the string was written. Default `""`. */
  separator?: string;
}

/** Read back a string written by {@link serialize}. */
export function deserialize(text: string, options: DeserializeOptions = {}): Answers {
  const blank = options.blank ?? "-";
  const separator = options.separator ?? "";
  const cells = separator === "" ? Array.from(text) : text.split(separator);

  const answers: Answers = {};
  cells.forEach((cell, i) => {
    const value = cell.trim();
    if (value === "" || value === blank) return;
    const match = options.choices
      ? options.choices.find((c) => same(c, value))
      : value;
    if (match !== undefined) answers[i + 1] = match;
  });
  return answers;
}

function same(a: string, b: string): boolean {
  return String(a).toLowerCase() === String(b).toLowerCase();
}
