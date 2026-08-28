/** A choice label, e.g. `"A"`. Labels are what get stored in the answer map. */
export type Choice = string;

/** Answers keyed by 1-based question number: `{ 1: "C", 2: "A" }`. */
export type Answers = Record<number, Choice>;

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
  /** Oval labels for every question. Default `["A", "B", "C", "D", "E"]`. */
  choices?: Choice[];
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

export type SheetEvent = "change" | "cursor";

/** The subset of `KeyboardEvent` that {@link Sheet.handleKey} reads. */
export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}
