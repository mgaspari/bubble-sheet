import { Sheet } from "./sheet.js";
import type { Answers, ChangeEvent, Choice, SheetOptions } from "./types.js";
import { same } from "./util.js";

/** The character sets a printed form gives you a column of bubbles for. */
export const CHARSETS = {
  letters: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
} as const;

export type CharsetName = keyof typeof CHARSETS;

/**
 * One position in a mask: a cell offering these characters, or a printed
 * literal (a slash in a date, a dash in an ID) that is not a cell at all.
 */
export type MaskSlot = string | { literal: string };

export interface GridFieldOptions
  extends Omit<
    SheetOptions,
    "questions" | "choices" | "orientation" | "digitJump" | "maxSelections"
  > {
  /** How many character cells the field has. Default `12`. Ignored with `mask`. */
  cells?: number;
  /**
   * Which characters each cell offers: a {@link CHARSETS} name, a string of
   * characters, or an array of values. Default `"letters"`.
   */
  charset?: CharsetName | string | readonly Choice[];
  /**
   * Shape the field position by position instead of uniformly. As a string,
   * `9` is a digit cell, `A` a letter cell, `*` an alphanumeric cell, and any
   * other character a printed literal: `"99/99/9999"` is a date. As an array,
   * each entry is a string of characters for that cell, or `{ literal }`:
   * `["01", "0123456789", { literal: "/" }, …]` restricts the month's first
   * digit. Overrides `cells` and `charset`; incompatible with `grow`.
   */
  mask?: string | readonly MaskSlot[];
  /**
   * Let the field grow as it is typed into: there is always one empty cell
   * after the last filled one, appearing as you type and disappearing as you
   * erase. `true`, or `{ min, max }` (default 1 and 24). Incompatible with
   * `mask`.
   */
  grow?: boolean | { min?: number; max?: number };
  /** Visible caption, e.g. `"Name"`. Also names the field for screen readers. */
  caption?: string;
  /** Class-name prefix. Default `"bs"`. */
  prefix?: string;
  /** Bring your own model instead of constructing one. */
  sheet?: Sheet;
  /** Initial text, one character per cell (mask literals may be included). */
  text?: string;
  /**
   * `name` for a hidden input carrying the field's text, so a plain `<form>`
   * post sends `"LOVELACE"` rather than a dozen radio groups.
   */
  name?: string;
  /** Called after every change, with the field's text. */
  onChange?: (text: string, event: ChangeEvent) => void;
}

export interface MountedGridField {
  /** The model behind the field: cells are questions, characters are choices. */
  readonly sheet: Sheet;
  readonly element: HTMLElement;
  /**
   * The field's text. Mask literals are included on the way out, optional on
   * the way in; trailing blanks are trimmed.
   */
  text: string;
  /** The raw cell-to-character map, if you would rather have positions. */
  value: Answers;
  disabled: boolean;
  focus(cell?: number): void;
  destroy(): void;
}

interface CellSlot {
  kind: "cell";
  chars: Choice[];
}

interface LiteralSlot {
  kind: "literal";
  text: string;
}

type Slot = CellSlot | LiteralSlot;

let uid = 0;

/**
 * Render a grid-in field — the block at the top of a scantron where you print
 * a name or an ID one character per box, then fill the matching bubble in each
 * column.
 *
 * ```ts
 * const name = mountGrid("#name", { cells: 12, charset: "letters", caption: "Name" });
 * const id = mountGrid("#id", { cells: 8, charset: "digits", caption: "Student ID" });
 * const date = mountGrid("#date", { mask: "99/99/9999", caption: "Date" });
 * name.text = "LOVELACE";
 * ```
 *
 * Typing in a box fills that column's bubble and moves to the next box;
 * filling a bubble writes the character into the box. Space blanks a column,
 * which is how you separate a last name from a first.
 */
export function mountGrid(
  target: Element | string,
  options: GridFieldOptions = {},
): MountedGridField {
  const host = typeof target === "string" ? document.querySelector(target) : target;
  if (!host) throw new Error(`No element matched ${JSON.stringify(target)}`);
  if (options.mask && options.grow) {
    throw new Error("A field cannot both grow and have a mask");
  }

  const doc = host.ownerDocument!;
  const prefix = options.prefix ?? "bs";
  const caption = options.caption ?? "";
  const group = `${prefix}-field-${++uid}`;

  const grow =
    options.grow === undefined || options.grow === false
      ? null
      : {
          min: Math.max(1, Math.floor((options.grow === true ? {} : options.grow).min ?? 1)),
          max: Math.max(1, Math.floor((options.grow === true ? {} : options.grow).max ?? 24)),
        };
  if (grow && grow.max < grow.min) {
    throw new Error(`grow.max (${grow.max}) is below grow.min (${grow.min})`);
  }

  const uniformChars = resolveCharset(options.charset ?? "letters");
  const slots: Slot[] = options.mask
    ? parseMask(options.mask)
    : Array.from(
        { length: grow ? grow.max : Math.max(1, Math.floor(options.cells ?? 12)) },
        () => ({ kind: "cell", chars: uniformChars }) as CellSlot,
      );

  /** Per-cell character menus, 0-indexed by cell number - 1. */
  const cellChars = slots
    .filter((slot): slot is CellSlot => slot.kind === "cell")
    .map((slot) => slot.chars);
  const maxCells = cellChars.length;
  if (maxCells === 0) throw new Error("A field needs at least one cell");

  /** Every character any cell offers, deduplicated — the model's choice menu. */
  const union: Choice[] = [];
  for (const chars of cellChars) {
    for (const char of chars) if (!union.includes(char)) union.push(char);
  }

  const initialCells = grow
    ? clamp((options.text?.length ?? 0) + 1, grow.min, grow.max)
    : maxCells;

  const sheet =
    options.sheet ??
    new Sheet({
      ...options,
      questions: initialCells,
      choices: union,
      orientation: "columns",
      // In a field a digit is a value, never an address to jump to.
      digitJump: false,
    });

  /**
   * True while a deliberate resize is in flight. Shrinking drops answers,
   * which fires `change`, whose listener calls {@link ensureSize} — without
   * the flag that inner call would resize again mid-resize and desync the
   * cells.
   */
  let resizing = false;

  const boxes = new Map<number, HTMLInputElement>();
  const ovals = new Map<string, { input: HTMLInputElement; label: HTMLElement }>();
  const cellEls = new Map<number, HTMLElement>();

  const field = doc.createElement("div");
  field.className = `${prefix}-field`;
  field.setAttribute("role", "group");
  if (caption) field.setAttribute("aria-label", caption);

  if (caption) {
    const heading = doc.createElement("div");
    heading.className = `${prefix}-field-caption`;
    heading.textContent = caption;
    field.appendChild(heading);
  }

  const track = doc.createElement("div");
  track.className = `${prefix}-cells`;
  {
    let cell = 0;
    for (const slot of slots) {
      if (slot.kind === "literal") {
        track.appendChild(buildSeparator(slot.text));
        continue;
      }
      cell += 1;
      if (cell > sheet.questions) break;
      track.appendChild(buildCell(cell));
    }
  }
  field.appendChild(track);

  const hidden = doc.createElement("input");
  if (options.name) {
    hidden.type = "hidden";
    hidden.name = options.name;
    field.appendChild(hidden);
  }

  host.appendChild(field);

  /* ------------------------------------------------------------ building */

  function charsAt(cell: number): Choice[] {
    return cellChars[cell - 1] ?? cellChars[cellChars.length - 1];
  }

  function buildSeparator(text: string): HTMLElement {
    const sep = doc.createElement("span");
    sep.className = `${prefix}-sep`;
    sep.textContent = text;
    sep.setAttribute("aria-hidden", "true");
    return sep;
  }

  function buildCell(cell: number): HTMLElement {
    const el = doc.createElement("div");
    el.className = `${prefix}-cell`;
    el.dataset.cell = String(cell);
    const chars = charsAt(cell);

    const box = doc.createElement("input");
    box.className = `${prefix}-box`;
    box.type = "text";
    box.autocomplete = "off";
    box.spellcheck = false;
    box.setAttribute("autocapitalize", "characters");
    box.setAttribute("inputmode", chars.every(isDigit) ? "numeric" : "text");
    box.setAttribute("aria-label", `${caption || "Field"}, character ${cell}`);
    box.dataset.cell = String(cell);
    boxes.set(cell, box);

    const stack = doc.createElement("div");
    stack.className = `${prefix}-stack`;
    stack.setAttribute("role", "radiogroup");
    stack.setAttribute("aria-label", `${caption || "Field"}, character ${cell}`);

    for (const char of chars) {
      const i = sheet.indexOf(char);
      const label = doc.createElement("label");
      label.className = `${prefix}-oval`;

      const input = doc.createElement("input");
      input.type = "radio";
      input.name = `${group}-c${cell}`;
      input.value = char;
      input.dataset.cell = String(cell);
      input.dataset.choice = String(i);

      const face = doc.createElement("span");
      face.className = `${prefix}-face`;
      face.textContent = char;

      label.append(input, face);
      stack.appendChild(label);
      ovals.set(`${cell}:${i}`, { input, label });
    }

    el.append(box, stack);
    cellEls.set(cell, el);
    paintCell(cell);
    return el;
  }

  function removeCell(cell: number): void {
    cellEls.get(cell)?.remove();
    cellEls.delete(cell);
    boxes.delete(cell);
    for (const char of charsAt(cell)) ovals.delete(`${cell}:${sheet.indexOf(char)}`);
  }

  /* ------------------------------------------------------------- syncing */

  function paintCell(cell: number): void {
    const char = sheet.get(cell) as Choice | undefined;
    const box = boxes.get(cell);
    if (box && box.value !== (char ?? "")) box.value = char ?? "";
    cellEls.get(cell)?.classList.toggle("is-marked", char !== undefined);
    for (const choice of charsAt(cell)) {
      const oval = ovals.get(`${cell}:${sheet.indexOf(choice)}`);
      if (!oval) continue;
      const filled = char === choice;
      oval.input.checked = filled;
      oval.label.classList.toggle("is-filled", filled);
    }
  }

  function syncDisabled(): void {
    for (const box of boxes.values()) box.disabled = sheet.disabled;
    for (const { input } of ovals.values()) input.disabled = sheet.disabled;
    field.classList.toggle("is-disabled", sheet.disabled);
    field.setAttribute("aria-disabled", String(sheet.disabled));
  }

  function syncHidden(): void {
    if (options.name) hidden.value = getText();
  }

  function safeResize(cells: number): void {
    resizing = true;
    try {
      sheet.resize(cells);
    } finally {
      resizing = false;
    }
  }

  /**
   * Keep the growth invariant: one empty cell after the last filled one — or
   * after the cursor, when a typed space has carried it further out. That is
   * what lets "ADA LOVELACE" be typed: the space holds the field open while
   * the next word arrives, and the held cell collapses once the cursor moves
   * back leaving it trailing. Within min..max; a no-op on fixed fields.
   */
  function ensureSize(): void {
    if (!grow || resizing) return;
    let lastFilled = 0;
    for (const key of Object.keys(sheet.value)) lastFilled = Math.max(lastFilled, Number(key));
    safeResize(clamp(Math.max(lastFilled + 1, sheet.cursor.question), grow.min, grow.max));
  }

  /**
   * A space at the field's current end needs somewhere to advance to: grow by
   * one cell before the cursor moves, since the cursor clamps to the cells
   * that exist.
   */
  function holdOpenFor(cell: number): void {
    if (grow && cell === sheet.questions && cell < grow.max) safeResize(cell + 1);
  }

  /** Drop a held-open trailing blank; content alone decides the size again. */
  function releaseHold(): void {
    if (!grow) return;
    let lastFilled = 0;
    for (const key of Object.keys(sheet.value)) lastFilled = Math.max(lastFilled, Number(key));
    safeResize(clamp(lastFilled + 1, grow.min, grow.max));
  }

  function getText(): string {
    const parts: string[] = [];
    let cell = 0;
    let keep = 0;
    for (const slot of slots) {
      if (slot.kind === "literal") {
        parts.push(slot.text);
        continue;
      }
      cell += 1;
      if (cell > sheet.questions) break;
      const char = sheet.get(cell) as Choice | undefined;
      parts.push(char ?? " ");
      if (char !== undefined) keep = parts.length;
    }
    return parts.slice(0, keep).join("");
  }

  function setText(text: string): void {
    // Grow up front so long text is not truncated; shrinking is left to
    // ensureSize once the new answers are in.
    if (grow && text.length + 1 > sheet.questions) {
      safeResize(clamp(text.length + 1, grow.min, grow.max));
    }
    const next: Answers = {};
    let pos = 0;
    let cell = 0;
    for (const slot of slots) {
      if (pos >= text.length) break;
      if (slot.kind === "literal") {
        // The literal is printed on the form; consume it from the text only
        // when the text bothered to include it.
        if (text.startsWith(slot.text, pos)) pos += slot.text.length;
        continue;
      }
      cell += 1;
      if (cell > sheet.questions) break;
      const char = text[pos];
      pos += 1;
      const match = charsAt(cell).find((c) => same(c, char));
      if (match !== undefined) next[cell] = match;
    }
    sheet.setValue(next);
    ensureSize();
  }

  function focusCell(cell: number, viaBox: boolean): void {
    const clamped = clamp(cell, 1, sheet.questions);
    if (viaBox) {
      boxes.get(clamped)?.focus();
      return;
    }
    const exact = ovals.get(`${clamped}:${sheet.cursor.choice}`);
    if (exact) {
      exact.input.focus();
      return;
    }
    // A masked field's cells offer different menus, so the cursor's choice may
    // not exist here; land on the first bubble of the cell instead.
    const first = charsAt(clamped)[0];
    ovals.get(`${clamped}:${sheet.indexOf(first)}`)?.input.focus();
  }

  const inBox = () =>
    doc.activeElement instanceof doc.defaultView!.HTMLInputElement &&
    doc.activeElement.classList.contains(`${prefix}-box`);

  /* ----------------------------------------------------------- listeners */

  const offChange = sheet.on("change", (event) => {
    for (const cell of event.questions) paintCell(cell);
    ensureSize();
    syncHidden();
    options.onChange?.(getText(), event);
  });

  // Reconcile against what actually exists rather than trusting the event's
  // delta: resizes can nest (a drop fires change, whose listener resizes
  // again), and an idempotent pass can never duplicate or orphan a cell.
  const offResize = sheet.on("resize", () => {
    for (const cell of [...cellEls.keys()]) {
      if (cell > sheet.questions) removeCell(cell);
    }
    for (let cell = 1; cell <= sheet.questions; cell++) {
      if (!cellEls.has(cell)) track.appendChild(buildCell(cell));
    }
  });

  const offCursor = sheet.on("cursor", (cursor) => {
    ensureSize();
    if (field.contains(doc.activeElement)) focusCell(cursor.question, inBox());
  });

  // Only now that the listeners exist: applying initial text can shrink a
  // growing field, and that resize must reach the DOM.
  if (options.text) {
    setText(options.text);
    for (const cell of cellEls.keys()) paintCell(cell);
  }
  syncDisabled();
  syncHidden();

  /** Typing into a box: accept the character, or put the box back as it was. */
  function onBoxInput(event: Event): void {
    const box = event.target as HTMLInputElement;
    if (!box.classList?.contains(`${prefix}-box`)) return;
    const cell = Number(box.dataset.cell);
    const typed = box.value.slice(-1).toUpperCase();

    if (box.value === "") {
      sheet.clear(cell);
    } else if (charsAt(cell).some((c) => same(c, typed))) {
      sheet.set(cell, typed);
      sheet.setCursor(cell + 1);
      focusCell(cell + 1, true);
    }
    paintCell(cell);
  }

  function onBoxKeyDown(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.ctrlKey || key.metaKey || key.altKey) return;
    const box = key.target as HTMLInputElement;
    if (!box.classList?.contains(`${prefix}-box`)) return;
    const cell = Number(box.dataset.cell);

    switch (key.key) {
      case "Backspace":
        key.preventDefault();
        // Clear this cell if it holds anything; otherwise back up and clear
        // that one. On a growing field the emptied trailing cell then falls
        // away on its own, which is exactly the two-stage erase.
        if (sheet.get(cell) !== undefined) {
          sheet.clear(cell);
        } else {
          sheet.clear(Math.max(cell - 1, 1));
          focusCell(cell - 1, true);
        }
        return;
      case "Delete":
        key.preventDefault();
        sheet.clear(cell);
        return;
      case " ":
        // A blank column, which is how a last name is split from a first.
        key.preventDefault();
        sheet.clear(cell);
        holdOpenFor(cell);
        sheet.setCursor(cell + 1);
        focusCell(cell + 1, true);
        return;
      case "ArrowLeft":
        key.preventDefault();
        focusCell(cell - 1, true);
        return;
      case "ArrowRight":
        key.preventDefault();
        focusCell(cell + 1, true);
        return;
      case "Home":
        key.preventDefault();
        focusCell(1, true);
        return;
      case "End":
        key.preventDefault();
        focusCell(sheet.questions, true);
        return;
      default:
    }
  }

  function onOvalKeyDown(event: Event): void {
    const key = event as KeyboardEvent;
    if (!(key.target as HTMLElement).closest?.(`.${prefix}-stack`)) return;
    const cell = Number((key.target as HTMLInputElement).dataset?.cell);
    if ((key.key === " " || key.key === "Spacebar") && cell) holdOpenFor(cell);
    // A masked cell only accepts its own characters, even though the model's
    // menu is the union of every cell's.
    if (key.key.length === 1 && cell && !charsAt(cell).some((c) => same(c, key.key))) {
      if (sheet.indexOf(key.key) > -1) {
        key.preventDefault();
        return;
      }
    }
    if (sheet.handleKey(key)) key.preventDefault();
  }

  function onFocusOut(event: Event): void {
    // Focus left the field entirely: a blank held open by the cursor is
    // abandoned, so let the size settle back to the content.
    const next = (event as FocusEvent).relatedTarget as Node | null;
    if (!next || !field.contains(next)) releaseHold();
  }

  function onFocusIn(event: Event): void {
    const el = event.target as HTMLElement;
    const cell = Number((el as HTMLInputElement).dataset?.cell);
    if (!cell) return;
    // Select what is already in the box, so the next keystroke overwrites it
    // rather than being refused for want of room.
    if (el.classList.contains(`${prefix}-box`)) (el as HTMLInputElement).select();
    const choice = (el as HTMLInputElement).dataset?.choice;
    sheet.setCursor(cell, choice === undefined ? sheet.cursor.choice : Number(choice));
  }

  function onChangeEvent(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.type !== "radio" || !input.dataset.cell) return;
    const cell = Number(input.dataset.cell);
    sheet.set(cell, input.value);
    paintCell(cell);
  }

  function onClick(event: Event): void {
    const input = (event.target as HTMLElement).closest?.("input[type=radio]") as
      | HTMLInputElement
      | null;
    if (!input?.dataset.cell) return;
    const cell = Number(input.dataset.cell);
    if ((event as MouseEvent).detail > 0 && sheet.get(cell) === input.value) {
      sheet.clear(cell);
      paintCell(cell);
      return;
    }
    // As in the answer grid: let the change event do the filling, so this
    // handler cannot undo the browser's check before it arrives.
    if (sheet.disabled) paintCell(cell);
  }

  field.addEventListener("input", onBoxInput);
  field.addEventListener("keydown", onBoxKeyDown);
  field.addEventListener("keydown", onOvalKeyDown);
  field.addEventListener("focusin", onFocusIn);
  field.addEventListener("focusout", onFocusOut);
  field.addEventListener("change", onChangeEvent);
  field.addEventListener("click", onClick);

  /* ----------------------------------------------------------- interface */

  return {
    sheet,
    element: field,
    get text() {
      return getText();
    },
    set text(next: string) {
      setText(next);
    },
    get value() {
      return sheet.value;
    },
    set value(next: Answers) {
      sheet.setValue(next);
    },
    get disabled() {
      return sheet.disabled;
    },
    set disabled(next: boolean) {
      sheet.disabled = next;
      syncDisabled();
    },
    focus(cell = sheet.cursor.question) {
      sheet.setCursor(cell);
      focusCell(cell, true);
    },
    destroy() {
      offChange();
      offResize();
      offCursor();
      field.removeEventListener("input", onBoxInput);
      field.removeEventListener("keydown", onBoxKeyDown);
      field.removeEventListener("keydown", onOvalKeyDown);
      field.removeEventListener("focusin", onFocusIn);
      field.removeEventListener("focusout", onFocusOut);
      field.removeEventListener("change", onChangeEvent);
      field.removeEventListener("click", onClick);
      field.remove();
      boxes.clear();
      ovals.clear();
      cellEls.clear();
    },
  };
}

function parseMask(mask: string | readonly MaskSlot[]): Slot[] {
  if (typeof mask === "string") {
    return Array.from(mask, (token): Slot => {
      if (token === "9") return { kind: "cell", chars: Array.from(CHARSETS.digits) };
      if (token === "A") return { kind: "cell", chars: Array.from(CHARSETS.letters) };
      if (token === "*") return { kind: "cell", chars: Array.from(CHARSETS.alphanumeric) };
      return { kind: "literal", text: token };
    });
  }
  return mask.map((slot): Slot => {
    if (typeof slot === "string") return { kind: "cell", chars: Array.from(slot) };
    return { kind: "literal", text: slot.literal };
  });
}

function resolveCharset(charset: CharsetName | string | readonly Choice[]): Choice[] {
  if (Array.isArray(charset)) return charset.map(String);
  const named = CHARSETS[charset as CharsetName];
  return Array.from(named ?? (charset as string));
}

function isDigit(char: string): boolean {
  return /^[0-9]$/.test(char);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
