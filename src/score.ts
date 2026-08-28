import type { Answers, Choice } from "./types.js";
import { same } from "./util.js";

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
 * A multi-select answer (an array on either side) is correct only when it
 * matches the key's set exactly — order and case aside, every required choice
 * marked and nothing extra.
 *
 * ```ts
 * score({ 1: "C", 2: ["A", "C"] }, { 1: "C", 2: ["A", "C"] }); // 2 correct
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
    // An empty array is as unanswered as a missing key: selected() returns
    // [] for a blank question, and that must not grade as incorrect.
    if (isEmpty(expected)) outcome = "ungraded";
    else if (isEmpty(given)) outcome = "blank";
    else outcome = sameAnswer(given!, expected!) ? "correct" : "incorrect";

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
  /**
   * Put this between slots. Default `""`, which requires every slot to pack
   * into a single character — one-character values, one selection each.
   */
  separator?: string;
}

/**
 * Flatten answers into one compact string — handy for a URL, a database
 * column, or a diff. A multi-select answer packs its selections side by side
 * within the slot (`["A", "C"]` becomes `"AC"`), so it needs a `separator`.
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
    const raw = answers[q];
    if (Array.isArray(raw) && raw.some((part) => String(part).length !== 1)) {
      // "10"+"11" would pack to "1011", which deserialize cannot split.
      throw new Error(
        `Cannot pack multi-select values longer than one character: ${JSON.stringify(raw)}`,
      );
    }
    const cell = raw === undefined ? blank : Array.isArray(raw) ? raw.join("") : String(raw);
    if (separator === "" && cell.length !== 1) {
      throw new Error(
        `Cannot pack ${JSON.stringify(cell)} without a separator: each slot must be one character`,
      );
    }
    cells.push(cell);
  }
  return cells.join(separator);
}

export interface DeserializeOptions {
  /** Restrict to these values; anything else is treated as blank. */
  choices?: readonly Choice[];
  /** Placeholder for an unanswered question. Default `"-"`. */
  blank?: string;
  /** Separator used when the string was written. Default `""`. */
  separator?: string;
  /**
   * Read a multi-character slot as several one-character selections
   * (`"AC"` becomes `["A", "C"]`) instead of one value. Default `false`.
   */
  multi?: boolean;
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

    if (options.multi) {
      const parts = Array.from(value)
        .map((char) => matchChoice(char, options.choices))
        .filter((c): c is Choice => c !== undefined);
      if (parts.length > 0) answers[i + 1] = parts;
      return;
    }

    const match = matchChoice(value, options.choices);
    if (match !== undefined) answers[i + 1] = match;
  });
  return answers;
}

function matchChoice(value: string, choices?: readonly Choice[]): Choice | undefined {
  if (!choices) return value;
  return choices.find((c) => same(c, value));
}

function isEmpty(value: Choice | readonly Choice[] | undefined): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

function sameAnswer(
  a: Choice | readonly Choice[],
  b: Choice | readonly Choice[],
): boolean {
  const setA = (Array.isArray(a) ? a : [a as Choice]).map((c) => String(c).toLowerCase());
  const setB = (Array.isArray(b) ? b : [b as Choice]).map((c) => String(c).toLowerCase());
  if (setA.length !== setB.length) return false;
  const sortedB = [...setB].sort();
  return [...setA].sort().every((c, i) => c === sortedB[i]);
}
