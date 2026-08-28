import type {
  Answers,
  ChangeEvent,
  Choice,
  ChoiceSpec,
  Cursor,
  KeyInput,
  ResizeEvent,
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
  readonly choices: readonly Choice[];
  readonly maxSelections: number;
  readonly wrap: boolean;
  readonly orientation: "rows" | "columns";
  readonly digitJump: boolean;
  readonly pageSize: number;
  readonly digitTimeout: number;

  #questions: number;
  #labels: ReadonlyMap<Choice, string>;
  #answers: Answers;
  #cursor: Cursor;
  #disabled: boolean;
  #now: () => number;
  #listeners = new Map<SheetEvent, Set<Listener>>();
  #digits = "";
  #digitsAt = -Infinity;
  readonly #digitChoices: boolean;

  constructor(options: SheetOptions = {}) {
    const specs = options.choices ?? DEFAULT_CHOICES;
    if (specs.length === 0) throw new Error("Sheet needs at least one choice");

    const labels = new Map<Choice, string>();
    this.choices = Object.freeze(
      specs.map((spec) => {
        if (typeof spec === "object") {
          const value = String(spec.value);
          if (spec.label !== undefined) labels.set(value, spec.label);
          return value;
        }
        return String(spec);
      }),
    );
    this.#labels = labels;

    this.#questions = Math.max(1, Math.floor(options.questions ?? 50));
    this.maxSelections = Math.max(1, Math.floor(options.maxSelections ?? 1));
    this.wrap = options.wrap ?? false;
    this.orientation = options.orientation ?? "rows";
    this.digitJump = options.digitJump ?? true;
    this.pageSize = Math.max(1, Math.floor(options.pageSize ?? 10));
    this.digitTimeout = options.digitTimeout ?? 800;

    this.#digitChoices = this.choices.some((c) => /^[0-9]$/.test(c));
    this.#disabled = options.disabled ?? false;
    this.#now = options.now ?? Date.now;
    this.#answers = freeze(this.#sanitize(options.value ?? {}));
    this.#cursor = { question: 1, choice: 0 };
  }

  /* ---------------------------------------------------------------- state */

  /** How many questions the sheet currently has. Changed via {@link resize}. */
  get questions(): number {
    return this.#questions;
  }

  /** True when one question may hold several choices. */
  get multi(): boolean {
    return this.maxSelections > 1;
  }

  /**
   * The current answers. Frozen, and replaced rather than mutated on every
   * change, so the reference is safe to use as a render key. Values are
   * strings on a single-select sheet, arrays on a multi-select one.
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

  /** How many questions carry at least one selection. */
  get answered(): number {
    return Object.keys(this.#answers).length;
  }

  get complete(): boolean {
    return this.answered === this.#questions;
  }

  /** The raw answer to `question` — a value, an array, or `undefined`. */
  get(question: number): Choice | readonly Choice[] | undefined {
    return this.#answers[question];
  }

  /** The selections on `question` as an array, empty when blank. */
  selected(question: number): readonly Choice[] {
    const raw = this.#answers[question];
    if (raw === undefined) return [];
    return Array.isArray(raw) ? raw : [raw as Choice];
  }

  /** True when `question` holds `choice`. */
  has(question: number, choice: Choice): boolean {
    const index = this.indexOf(choice);
    return index > -1 && this.selected(question).includes(this.choices[index]);
  }

  /** The display label for `choice`, when one was given. */
  labelOf(choice: Choice): string | undefined {
    return this.#labels.get(choice);
  }

  /**
   * Replace every answer at once. Entries outside the sheet — unknown
   * questions, values not in `choices`, selections past `maxSelections` — are
   * dropped rather than stored, so a sheet saved under a different
   * configuration still restores cleanly.
   */
  setValue(next: Answers): boolean {
    if (this.#disabled) return false;
    return this.#commit(this.#sanitize(next));
  }

  /**
   * Mark `question` with `choice`. On a single-select sheet this replaces the
   * answer; on a multi-select sheet it adds a selection, refusing once
   * `maxSelections` is reached. Throws if the question or choice is off the
   * sheet.
   */
  set(question: number, choice: Choice): boolean {
    const q = this.#assertQuestion(question);
    const value = this.#assertChoice(choice);
    if (this.#disabled) return false;

    if (!this.multi) {
      if (this.#answers[q] === value) return false;
      return this.#commit({ ...this.#answers, [q]: value });
    }

    const current = this.selected(q);
    if (current.includes(value) || current.length >= this.maxSelections) return false;
    const next = this.choices.filter((c) => c === value || current.includes(c));
    return this.#commit({ ...this.#answers, [q]: next });
  }

  /** Remove one selection from `question`. On a single-select sheet, clears it. */
  unset(question: number, choice: Choice): boolean {
    const q = this.#assertQuestion(question);
    const value = this.#assertChoice(choice);
    if (this.#disabled) return false;

    const current = this.selected(q);
    if (!current.includes(value)) return false;
    if (!this.multi || current.length === 1) return this.clear(q);
    return this.#commit({ ...this.#answers, [q]: current.filter((c) => c !== value) });
  }

  /** Erase `question` entirely. */
  clear(question: number): boolean {
    const q = this.#assertQuestion(question);
    if (this.#disabled || !(q in this.#answers)) return false;
    const next = { ...this.#answers };
    delete next[q];
    return this.#commit(next);
  }

  /** Mark `question` with `choice`, or remove that choice if already marked. */
  toggle(question: number, choice: Choice): boolean {
    return this.has(question, choice)
      ? this.unset(question, choice)
      : this.set(question, choice);
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

  /**
   * Change the question count. Answers past the new end are dropped, and the
   * cursor is clamped. Emits `resize` (and `change` if answers were dropped).
   */
  resize(questions: number): boolean {
    const next = Math.max(1, Math.floor(questions));
    if (this.#disabled || next === this.#questions) return false;

    const previous = this.#questions;
    this.#questions = next;

    const kept: Answers = {};
    let dropped = false;
    for (const [key, value] of Object.entries(this.#answers)) {
      if (Number(key) <= next) kept[Number(key)] = value;
      else dropped = true;
    }
    if (dropped) this.#commit(kept);

    if (this.#cursor.question > this.#questions) {
      this.setCursor(this.#questions, this.#cursor.choice);
    }
    // Report the count as it stands now: a change listener above may itself
    // have resized, and a stale number here would desync any renderer.
    this.#emit("resize", { questions: this.#questions, previous } satisfies ResizeEvent);
    return true;
  }

  /* --------------------------------------------------------------- cursor */

  get cursor(): Cursor {
    return this.#cursor;
  }

  /** Move the cursor. Out-of-range values clamp (or wrap, per `wrap`). */
  setCursor(question: number, choice = this.#cursor.choice): Cursor {
    const next = {
      question: bound(Math.floor(question), 1, this.#questions, this.wrap),
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
   * | a choice value | single-select: fill and advance. Multi: toggle, stay |
   * | `Backspace` | erase and step back |
   * | `Delete` | erase and stay |
   * | arrows | move; which pair walks questions follows `orientation` |
   * | `Home` `End` | first / last question |
   * | `PageUp` `PageDown` | move by `pageSize` |
   * | `Enter` | single-select: fill the cursor's oval and advance. Multi: advance |
   * | `Space` | toggle the cursor's oval; on a `"columns"` sheet, blank the cell and advance |
   * | digits | jump to that question number (when `digitJump`) |
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
      if (this.multi) {
        this.toggle(question, this.choices[index]);
        this.setCursor(question, index);
      } else {
        this.set(question, this.choices[index]);
        this.setCursor(question + 1, index);
      }
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
        this.setCursor(this.#questions, choice);
        return true;
      case "Enter":
        if (!this.multi) this.set(question, this.choices[choice]);
        this.setCursor(question + 1, choice);
        return true;
      case " ":
      case "Spacebar":
        if (this.orientation === "columns") {
          // In a field, space is a typewriter space: write a blank column and
          // move on to the next cell.
          this.clear(question);
          this.setCursor(question + 1, choice);
        } else {
          this.toggle(question, this.choices[choice]);
        }
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
      this.#digits = (this.#digits + key).slice(-String(this.#questions).length);
      const target = parseInt(this.#digits, 10);
      if (target >= 1) this.setCursor(target, 0);
      return true;
    }

    return false;
  }

  /* --------------------------------------------------------------- events */

  /** Subscribe to `change`, `cursor` or `resize`. Returns an unsubscribe function. */
  on(event: "change", listener: (event: ChangeEvent) => void): () => void;
  on(event: "cursor", listener: (cursor: Cursor) => void): () => void;
  on(event: "resize", listener: (event: ResizeEvent) => void): () => void;
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

  /**
   * Route an arrow key. Whichever axis the questions run along moves between
   * questions; the other moves between choices.
   */
  #arrow(axis: "vertical" | "horizontal", delta: number): void {
    const questionAxis = this.orientation === "rows" ? "vertical" : "horizontal";
    if (axis === questionAxis) this.moveQuestion(delta);
    else this.moveChoice(delta);
  }

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
    if (!(q >= 1 && q <= this.#questions)) {
      throw new RangeError(`Question ${question} is outside 1..${this.#questions}`);
    }
    return q;
  }

  #assertChoice(choice: Choice): Choice {
    const index = this.indexOf(choice);
    if (index < 0) throw new Error(`Unknown choice: ${JSON.stringify(choice)}`);
    return this.choices[index];
  }

  /**
   * Coerce arbitrary stored answers into this sheet's shape: known questions,
   * known values, arrays capped and canonically ordered on a multi-select
   * sheet, first-match-wins on a single-select one.
   */
  #sanitize(value: Answers): Answers {
    const out: Answers = {};
    for (const [key, raw] of Object.entries(value)) {
      const q = Number(key);
      if (!Number.isInteger(q) || q < 1 || q > this.#questions) continue;

      const given = Array.isArray(raw) ? raw : [raw as Choice];
      const matched: Choice[] = [];
      for (const item of given) {
        const index = this.indexOf(String(item));
        if (index > -1 && !matched.includes(this.choices[index])) {
          matched.push(this.choices[index]);
        }
      }
      if (matched.length === 0) continue;

      if (this.multi) {
        const ordered = this.choices.filter((c) => matched.includes(c));
        out[q] = ordered.slice(0, this.maxSelections);
      } else {
        out[q] = matched[0];
      }
    }
    return out;
  }
}

function freeze(answers: Answers): Answers {
  for (const value of Object.values(answers)) {
    if (Array.isArray(value)) Object.freeze(value);
  }
  return Object.freeze(answers);
}

/** One comparable string per answer, so arrays and values compare uniformly. */
function normalize(value: Choice | readonly Choice[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  // NUL cannot appear in a choice value typed or clicked in, so the join can
  // never collide with a value that happens to contain the separator.
  return Array.isArray(value) ? `\u0000${value.join("\u0000")}` : (value as string);
}

function changedQuestions(a: Answers, b: Answers): number[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: number[] = [];
  for (const key of keys) {
    const q = Number(key);
    if (normalize(a[q]) !== normalize(b[q])) changed.push(q);
  }
  return changed.sort((x, y) => x - y);
}

function bound(n: number, min: number, max: number, wrap: boolean): number {
  if (!Number.isFinite(n)) return min;
  if (!wrap) return Math.min(Math.max(n, min), max);
  const span = max - min + 1;
  return min + (((n - min) % span) + span) % span;
}
