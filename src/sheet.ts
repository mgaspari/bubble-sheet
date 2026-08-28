import type {
  Answers,
  ChangeEvent,
  Choice,
  Cursor,
  KeyInput,
  SheetEvent,
  SheetOptions,
} from "./types.js";

const DEFAULT_CHOICES: Choice[] = ["A", "B", "C", "D", "E"];

type Listener = (event: any) => void;

/**
 * The headless answer sheet: answers, a keyboard cursor, and the key handling
 * that ties them together. No DOM, no framework — {@link mount} and any
 * framework wrapper are thin layers over this.
 *
 * ```ts
 * const sheet = new Sheet({ questions: 50 });
 * sheet.on("change", ({ value }) => console.log(value));
 * sheet.set(1, "C");
 * ```
 */
export class Sheet {
  readonly questions: number;
  readonly choices: readonly Choice[];
  readonly wrap: boolean;
  readonly orientation: "rows" | "columns";
  readonly digitJump: boolean;
  readonly pageSize: number;
  readonly digitTimeout: number;

  #answers: Answers;
  #cursor: Cursor;
  #disabled: boolean;
  #now: () => number;
  #listeners = new Map<SheetEvent, Set<Listener>>();
  #digits = "";
  #digitsAt = -Infinity;
  readonly #digitChoices: boolean;

  constructor(options: SheetOptions = {}) {
    const choices = options.choices ?? DEFAULT_CHOICES;
    if (choices.length === 0) throw new Error("Sheet needs at least one choice");

    this.questions = Math.max(1, Math.floor(options.questions ?? 50));
    this.choices = Object.freeze(choices.map(String));
    this.wrap = options.wrap ?? false;
    this.orientation = options.orientation ?? "rows";
    this.digitJump = options.digitJump ?? true;
    this.pageSize = Math.max(1, Math.floor(options.pageSize ?? 10));
    this.digitTimeout = options.digitTimeout ?? 800;

    this.#digitChoices = this.choices.some((c) => /^[0-9]$/.test(c));
    this.#disabled = options.disabled ?? false;
    this.#now = options.now ?? Date.now;
    this.#answers = freeze(sanitize(options.value ?? {}, this.questions, this.choices));
    this.#cursor = { question: 1, choice: 0 };
  }

  /* ---------------------------------------------------------------- state */

  /**
   * The current answers. Frozen, and replaced rather than mutated on every
   * change, so the reference is safe to use as a render key.
   */
  get value(): Answers {
    return this.#answers;
  }

  set value(next: Answers) {
    this.setValue(next);
  }

  get disabled(): boolean {
    return this.#disabled;
  }

  set disabled(next: boolean) {
    this.#disabled = next;
  }

  /** How many questions carry an answer. */
  get answered(): number {
    return Object.keys(this.#answers).length;
  }

  get complete(): boolean {
    return this.answered === this.questions;
  }

  /** The answer to `question`, or `undefined`. */
  get(question: number): Choice | undefined {
    return this.#answers[question];
  }

  /**
   * Replace every answer at once. Entries outside the sheet — unknown
   * questions, labels not in `choices` — are dropped rather than stored, so a
   * sheet saved under a different configuration still restores cleanly.
   */
  setValue(next: Answers): boolean {
    if (this.#disabled) return false;
    return this.#commit(sanitize(next, this.questions, this.choices));
  }

  /** Mark `question` with `choice`. Throws if either is off the sheet. */
  set(question: number, choice: Choice): boolean {
    const q = this.#assertQuestion(question);
    const index = this.indexOf(choice);
    if (index < 0) throw new Error(`Unknown choice: ${JSON.stringify(choice)}`);
    if (this.#disabled || this.#answers[q] === this.choices[index]) return false;
    return this.#commit({ ...this.#answers, [q]: this.choices[index] });
  }

  /** Erase `question`. */
  clear(question: number): boolean {
    const q = this.#assertQuestion(question);
    if (this.#disabled || !(q in this.#answers)) return false;
    const next = { ...this.#answers };
    delete next[q];
    return this.#commit(next);
  }

  /** Mark `question`, or erase it if that choice is already filled. */
  toggle(question: number, choice: Choice): boolean {
    const q = this.#assertQuestion(question);
    const index = this.indexOf(choice);
    if (index < 0) throw new Error(`Unknown choice: ${JSON.stringify(choice)}`);
    return this.#answers[q] === this.choices[index] ? this.clear(q) : this.set(q, this.choices[index]);
  }

  /** Erase the whole sheet. */
  clearAll(): boolean {
    if (this.#disabled || this.answered === 0) return false;
    return this.#commit({});
  }

  /** Index of `choice` in `choices`, case-insensitively. `-1` if absent. */
  indexOf(choice: Choice): number {
    const needle = String(choice).toLowerCase();
    return this.choices.findIndex((c) => c.toLowerCase() === needle);
  }

  /* --------------------------------------------------------------- cursor */

  get cursor(): Cursor {
    return this.#cursor;
  }

  /** Move the cursor. Out-of-range values clamp (or wrap, per `wrap`). */
  setCursor(question: number, choice = this.#cursor.choice): Cursor {
    const next = {
      question: bound(Math.floor(question), 1, this.questions, this.wrap),
      choice: bound(Math.floor(choice), 0, this.choices.length - 1, this.wrap),
    };
    if (next.question !== this.#cursor.question || next.choice !== this.#cursor.choice) {
      this.#cursor = next;
      this.#emit("cursor", next);
    }
    return this.#cursor;
  }

  /** Move `delta` questions, keeping the same oval. */
  moveQuestion(delta: number): Cursor {
    return this.setCursor(this.#cursor.question + delta, this.#cursor.choice);
  }

  /** Move `delta` ovals within the current question. */
  moveChoice(delta: number): Cursor {
    return this.setCursor(this.#cursor.question, this.#cursor.choice + delta);
  }

  /* ------------------------------------------------------------- keyboard */

  /**
   * Apply one keystroke. Returns `true` when the key belonged to the sheet, so
   * a DOM caller can `preventDefault()` on exactly those.
   *
   * | Key | Effect |
   * | --- | --- |
   * | a choice label | fill the question and advance |
   * | `Backspace` | erase and step back |
   * | `Delete` | erase and stay |
   * | `↑` `↓` | previous / next question |
   * | `←` `→` | previous / next oval |
   * | `Home` `End` | first / last question |
   * | `PageUp` `PageDown` | move by `pageSize` |
   * | `Enter` | fill the oval under the cursor and advance |
   * | `Space` | toggle the oval under the cursor |
   * | digits | jump to that question number |
   * | `Escape` | drop a half-typed question number |
   */
  handleKey(event: KeyInput): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const { key } = event;
    const { question, choice } = this.#cursor;

    const index = key.length === 1 ? this.indexOf(key) : -1;
    const isDigit = /^[0-9]$/.test(key);
    if (index > -1 && (!isDigit || this.#digitChoices)) {
      this.#digits = "";
      this.set(question, this.choices[index]);
      this.setCursor(question + 1, index);
      return true;
    }

    switch (key) {
      case "Backspace":
        this.#digits = "";
        this.clear(question);
        this.setCursor(question - 1, choice);
        return true;
      case "Delete":
        this.#digits = "";
        this.clear(question);
        return true;
      case "ArrowDown":
        this.#arrow("vertical", 1);
        return true;
      case "ArrowUp":
        this.#arrow("vertical", -1);
        return true;
      case "ArrowRight":
        this.#arrow("horizontal", 1);
        return true;
      case "ArrowLeft":
        this.#arrow("horizontal", -1);
        return true;
      case "PageDown":
        this.moveQuestion(this.pageSize);
        return true;
      case "PageUp":
        this.moveQuestion(-this.pageSize);
        return true;
      case "Home":
        this.setCursor(1, choice);
        return true;
      case "End":
        this.setCursor(this.questions, choice);
        return true;
      case "Enter":
        this.set(question, this.choices[choice]);
        this.setCursor(question + 1, choice);
        return true;
      case " ":
      case "Spacebar":
        this.toggle(question, this.choices[choice]);
        return true;
      case "Escape": {
        const pending = this.#digits.length > 0;
        this.#digits = "";
        return pending;
      }
    }

    if (isDigit) {
      if (!this.digitJump) return false;
      const at = this.#now();
      if (at - this.#digitsAt > this.digitTimeout) this.#digits = "";
      this.#digitsAt = at;
      this.#digits = (this.#digits + key).slice(-String(this.questions).length);
      const target = parseInt(this.#digits, 10);
      if (target >= 1) this.setCursor(target, 0);
      return true;
    }

    return false;
  }

  /**
   * Route an arrow key. Whichever axis the questions run along moves between
   * questions; the other moves between choices.
   */
  #arrow(axis: "vertical" | "horizontal", delta: number): void {
    const questionAxis = this.orientation === "rows" ? "vertical" : "horizontal";
    if (axis === questionAxis) this.moveQuestion(delta);
    else this.moveChoice(delta);
  }

  /* --------------------------------------------------------------- events */

  /** Subscribe to `change` or `cursor`. Returns an unsubscribe function. */
  on(event: "change", listener: (event: ChangeEvent) => void): () => void;
  on(event: "cursor", listener: (cursor: Cursor) => void): () => void;
  on(event: SheetEvent, listener: Listener): () => void {
    let set = this.#listeners.get(event);
    if (!set) this.#listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => {
      set!.delete(listener);
    };
  }

  /** Drop every listener. */
  off(): void {
    this.#listeners.clear();
  }

  /* -------------------------------------------------------------- private */

  #commit(next: Answers): boolean {
    const previous = this.#answers;
    const questions = changedQuestions(previous, next);
    if (questions.length === 0) return false;
    this.#answers = freeze(next);
    this.#emit("change", { value: this.#answers, previous, questions });
    return true;
  }

  #emit(event: SheetEvent, payload: unknown): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(payload);
  }

  #assertQuestion(question: number): number {
    const q = Math.floor(question);
    if (!(q >= 1 && q <= this.questions)) {
      throw new RangeError(`Question ${question} is outside 1..${this.questions}`);
    }
    return q;
  }
}

function freeze(answers: Answers): Answers {
  return Object.freeze(answers);
}

function sanitize(value: Answers, questions: number, choices: readonly Choice[]): Answers {
  const out: Answers = {};
  for (const [key, choice] of Object.entries(value)) {
    const q = Number(key);
    if (!Number.isInteger(q) || q < 1 || q > questions) continue;
    const match = choices.find((c) => c.toLowerCase() === String(choice).toLowerCase());
    if (match !== undefined) out[q] = match;
  }
  return out;
}

function changedQuestions(a: Answers, b: Answers): number[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: number[] = [];
  for (const key of keys) {
    if (a[key as unknown as number] !== b[key as unknown as number]) changed.push(Number(key));
  }
  return changed.sort((x, y) => x - y);
}

function bound(n: number, min: number, max: number, wrap: boolean): number {
  if (!Number.isFinite(n)) return min;
  if (!wrap) return Math.min(Math.max(n, min), max);
  const span = max - min + 1;
  return min + (((n - min) % span) + span) % span;
}
