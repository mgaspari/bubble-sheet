/**
 * A choice's stored value, e.g. `"A"`. Values are what appear in the answer
 * map and what grading compares.
 */
export type Choice = string;

/**
 * A choice as given to the sheet: the bare value, or a value with a longer
 * label — `{ value: "A", label: "Strongly agree" }`. The bubble face shows the
 * value; the label is presentation beside it.
 */
export type ChoiceSpec = Choice | { value: Choice; label?: string };

/**
 * Answers keyed by 1-based question number. A single-select sheet stores one
 * value per question (`{ 1: "C" }`); a multi-select sheet stores an array
 * (`{ 1: ["A", "C"] }`).
 */
export type Answers = Record<number, Choice | readonly Choice[]>;

/** Where the keyboard currently is: a question and an oval within it. */
export interface Cursor {
  /** 1-based question number. */
  question: number;
  /** 0-based index into `choices`. */
  choice: number;
}

export interface SheetOptions {
  /** How many questions the sheet has. Default `50`. */
  questions?: number;
  /** Choices for every question. Default `["A", "B", "C", "D", "E"]`. */
  choices?: readonly ChoiceSpec[];
  /**
   * How many choices one question may hold. Default `1` — a radio group.
   * Anything higher makes the sheet multi-select ("mark all that apply"):
   * answers become arrays, choice keys toggle instead of advancing, and
   * `Infinity` means no cap.
   */
  maxSelections?: number;
  /** Initial answers. Default `{}`. */
  value?: Answers;
  /** Reject every mutation while true. Default `false`. */
  disabled?: boolean;
  /** Wrap around at the ends instead of clamping when navigating. Default `false`. */
  wrap?: boolean;
  /**
   * Which way the questions run, which is what the arrow keys follow.
   * `"rows"` (default) is an answer sheet: up/down walk questions, left/right
   * walk the ovals. `"columns"` is a grid-in field: left/right walk the
   * character cells, up/down walk the letters stacked inside one.
   */
  orientation?: "rows" | "columns";
  /**
   * Let digit keys jump to a question number. Default `true`. Turn it off for
   * fields where a digit is a value rather than an address. Ignored when the
   * choices themselves are digits — those always fill.
   */
  digitJump?: boolean;
  /** Questions moved per PageUp/PageDown. Default `10`. */
  pageSize?: number;
  /**
   * How long consecutive digits keep composing one question number, in ms.
   * Typing `1` then `2` inside the window jumps to 12, outside it to 2.
   * Default `800`.
   */
  digitTimeout?: number;
  /** Clock used for the digit timeout. Default `Date.now`. Handy in tests. */
  now?: () => number;
}

/** What changed, handed to every `change` listener. */
export interface ChangeEvent {
  value: Answers;
  previous: Answers;
  /** Questions whose answer differs between `previous` and `value`. */
  questions: number[];
}

/** Handed to every `resize` listener after the question count changes. */
export interface ResizeEvent {
  questions: number;
  previous: number;
}

export type SheetEvent = "change" | "cursor" | "resize";

/** The subset of `KeyboardEvent` that {@link Sheet.handleKey} reads. */
export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}
