import { Sheet } from "./sheet.js";
import type { Answers, ChangeEvent, Choice, SheetOptions } from "./types.js";

/** The character sets a printed form gives you a column of bubbles for. */
export const CHARSETS = {
  letters: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
} as const;

export type CharsetName = keyof typeof CHARSETS;

export interface GridFieldOptions
  extends Omit<SheetOptions, "questions" | "choices" | "orientation" | "digitJump"> {
  /** How many character cells the field has. Default `12`. */
  cells?: number;
  /**
   * Which characters each cell offers: a {@link CHARSETS} name, a string of
   * characters, or an array of labels. Default `"letters"`.
   */
  charset?: CharsetName | string | readonly Choice[];
  /** Visible caption, e.g. `"Name"`. Also names the field for screen readers. */
  caption?: string;
  /** Class-name prefix. Default `"bs"`. */
  prefix?: string;
  /** Bring your own model instead of constructing one. */
  sheet?: Sheet;
  /** Initial text, one character per cell. */
  text?: string;
  /**
   * `name` for a hidden input carrying the field's text, so a plain `<form>`
   * post sends `"GASPARI"` rather than a dozen radio groups.
   */
  name?: string;
  /** Called after every change, with the field's text. */
  onChange?: (text: string, event: ChangeEvent) => void;
}

export interface MountedGridField {
  /** The model behind the field: cells are questions, characters are choices. */
  readonly sheet: Sheet;
  readonly element: HTMLElement;
  /** The field's text. Trailing blanks are trimmed on the way out. */
  text: string;
  /** The raw cell-to-character map, if you would rather have positions. */
  value: Answers;
  disabled: boolean;
  focus(cell?: number): void;
  destroy(): void;
}

let uid = 0;

/**
 * Render a grid-in field — the block at the top of a scantron where you print
 * a name or an ID one character per box, then fill the matching bubble in each
 * column.
 *
 * ```ts
 * const name = mountGrid("#name", { cells: 12, charset: "letters", caption: "Name" });
 * const id = mountGrid("#id", { cells: 8, charset: "digits", caption: "Student ID" });
 * name.text = "GASPARI";
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

  const doc = host.ownerDocument!;
  const prefix = options.prefix ?? "bs";
  const cells = Math.max(1, Math.floor(options.cells ?? 12));
  const charset = resolveCharset(options.charset ?? "letters");
  const caption = options.caption ?? "";
  const group = `${prefix}-field-${++uid}`;

  const sheet =
    options.sheet ??
    new Sheet({
      ...options,
      questions: cells,
      choices: charset,
      orientation: "columns",
      // In a field a digit is a value, never an address to jump to.
      digitJump: false,
    });

  const boxes = new Map<number, HTMLInputElement>();
  const ovals = new Map<string, { input: HTMLInputElement; label: HTMLElement }>();
  const cellEls = new Map<number, HTMLElement>();

  const field = doc.createElement("div");
  field.className = `${prefix}-field`;
  field.style.setProperty("--bs-cells", String(cells));
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
  for (let cell = 1; cell <= cells; cell++) track.appendChild(buildCell(cell));
  field.appendChild(track);

  const hidden = doc.createElement("input");
  if (options.name) {
    hidden.type = "hidden";
    hidden.name = options.name;
    field.appendChild(hidden);
  }

  host.appendChild(field);
  if (options.text) {
    setText(options.text);
    for (let cell = 1; cell <= cells; cell++) paintCell(cell);
  }
  syncDisabled();
  syncHidden();

  /* ------------------------------------------------------------ building */

  function buildCell(cell: number): HTMLElement {
    const el = doc.createElement("div");
    el.className = `${prefix}-cell`;
    el.dataset.cell = String(cell);

    const box = doc.createElement("input");
    box.className = `${prefix}-box`;
    box.type = "text";
    box.maxLength = 1;
    box.autocomplete = "off";
    box.spellcheck = false;
    box.setAttribute("autocapitalize", "characters");
    box.setAttribute("inputmode", charset.every(isDigit) ? "numeric" : "text");
    box.setAttribute("aria-label", `${caption || "Field"}, character ${cell}`);
    box.dataset.cell = String(cell);
    boxes.set(cell, box);

    const stack = doc.createElement("div");
    stack.className = `${prefix}-stack`;
    stack.setAttribute("role", "radiogroup");
    stack.setAttribute("aria-label", `${caption || "Field"}, character ${cell}`);

    charset.forEach((char, i) => {
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
    });

    el.append(box, stack);
    cellEls.set(cell, el);
    paintCell(cell);
    return el;
  }

  /* ------------------------------------------------------------- syncing */

  function paintCell(cell: number): void {
    const char = sheet.get(cell);
    const box = boxes.get(cell);
    if (box && box.value !== (char ?? "")) box.value = char ?? "";
    cellEls.get(cell)?.classList.toggle("is-marked", char !== undefined);
    charset.forEach((choice, i) => {
      const oval = ovals.get(`${cell}:${i}`);
      if (!oval) return;
      const filled = char === choice;
      oval.input.checked = filled;
      oval.label.classList.toggle("is-filled", filled);
    });
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

  function getText(): string {
    let text = "";
    for (let cell = 1; cell <= cells; cell++) text += sheet.get(cell) ?? " ";
    return text.replace(/\s+$/, "");
  }

  function setText(text: string): void {
    const next: Answers = {};
    for (let cell = 1; cell <= cells; cell++) {
      const index = sheet.indexOf(String(text[cell - 1] ?? ""));
      if (index > -1) next[cell] = charset[index];
    }
    sheet.setValue(next);
  }

  function focusCell(cell: number, viaBox: boolean): void {
    const clamped = Math.min(Math.max(cell, 1), cells);
    if (viaBox) boxes.get(clamped)?.focus();
    else ovals.get(`${clamped}:${sheet.cursor.choice}`)?.input.focus();
  }

  const inBox = () =>
    doc.activeElement instanceof doc.defaultView!.HTMLInputElement &&
    doc.activeElement.classList.contains(`${prefix}-box`);

  /* ----------------------------------------------------------- listeners */

  const offChange = sheet.on("change", (event) => {
    for (const cell of event.questions) paintCell(cell);
    syncHidden();
    options.onChange?.(getText(), event);
  });

  const offCursor = sheet.on("cursor", (cursor) => {
    if (field.contains(doc.activeElement)) focusCell(cursor.question, inBox());
  });

  /** Typing into a box: accept the character, or put the box back as it was. */
  function onBoxInput(event: Event): void {
    const box = event.target as HTMLInputElement;
    if (!box.classList?.contains(`${prefix}-box`)) return;
    const cell = Number(box.dataset.cell);
    const typed = box.value.slice(-1).toUpperCase();

    if (box.value === "") {
      sheet.clear(cell);
    } else if (sheet.indexOf(typed) > -1) {
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
        // Clear this cell if it holds anything, otherwise back up and clear
        // that one — the way any boxed code input behaves.
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
        focusCell(cells, true);
        return;
      default:
    }
  }

  function onOvalKeyDown(event: Event): void {
    const key = event as KeyboardEvent;
    if (!(key.target as HTMLElement).closest?.(`.${prefix}-stack`)) return;
    if (sheet.handleKey(key)) key.preventDefault();
  }

  function onFocusIn(event: Event): void {
    const el = event.target as HTMLElement;
    const cell = Number((el as HTMLInputElement).dataset?.cell);
    if (!cell) return;
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
      offCursor();
      field.removeEventListener("input", onBoxInput);
      field.removeEventListener("keydown", onBoxKeyDown);
      field.removeEventListener("keydown", onOvalKeyDown);
      field.removeEventListener("focusin", onFocusIn);
      field.removeEventListener("change", onChangeEvent);
      field.removeEventListener("click", onClick);
      field.remove();
      boxes.clear();
      ovals.clear();
      cellEls.clear();
    },
  };
}

function resolveCharset(charset: CharsetName | string | readonly Choice[]): Choice[] {
  if (Array.isArray(charset)) return charset.map(String);
  const named = CHARSETS[charset as CharsetName];
  return Array.from(named ?? (charset as string));
}

function isDigit(char: string): boolean {
  return /^[0-9]$/.test(char);
}
