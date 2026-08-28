import { Sheet } from "./sheet.js";
import { columnize } from "./layout.js";
import type { Answers, ChangeEvent, SheetOptions } from "./types.js";

export interface MountOptions extends SheetOptions {
  /** Visual columns of questions. Default `2`. */
  columns?: number;
  /** Class-name prefix for every element the renderer creates. Default `"bs"`. */
  prefix?: string;
  /** Bring your own model. When given, the `Sheet` options above are ignored. */
  sheet?: Sheet;
  /** `name` attribute for each question's radios — set it to post the sheet in a plain form. */
  name?: (question: number) => string;
  /** Accessible name for each question's group. Default `` `Question ${q}` ``. */
  label?: (question: number) => string;
  /** Called after every answer change. */
  onChange?: (value: Answers, event: ChangeEvent) => void;
}

export interface MountedSheet {
  /** The model driving the markup. Every method on it is reflected in the DOM. */
  readonly sheet: Sheet;
  /** The root element the renderer created. */
  readonly element: HTMLElement;
  value: Answers;
  disabled: boolean;
  /** Focus an oval, defaulting to wherever the cursor is. */
  focus(question?: number, choice?: number): void;
  /** Unbind listeners and remove the markup. */
  destroy(): void;
}

interface Oval {
  input: HTMLInputElement;
  label: HTMLElement;
}

/**
 * Render a sheet into the page and keep it in sync with its model.
 *
 * ```ts
 * const bubbles = mount("#sheet", { questions: 50, columns: 2 });
 * bubbles.sheet.on("change", ({ value }) => save(value));
 * ```
 */
export function mount(target: Element | string, options: MountOptions = {}): MountedSheet {
  const host =
    typeof target === "string" ? document.querySelector(target) : target;
  if (!host) throw new Error(`No element matched ${JSON.stringify(target)}`);

  const doc = host.ownerDocument!;
  const sheet = options.sheet ?? new Sheet(options);
  const prefix = options.prefix ?? "bs";
  const columns = Math.max(1, Math.floor(options.columns ?? 2));
  const nameOf = options.name ?? ((q: number) => `${prefix}-q${q}`);
  const labelOf = options.label ?? ((q: number) => `Question ${q}`);

  const rows = new Map<number, HTMLElement>();
  const ovals = new Map<string, Oval>();

  const grid = doc.createElement("div");
  grid.className = `${prefix}-grid`;
  grid.style.setProperty("--bs-columns", String(columns));
  grid.setAttribute("role", "group");

  for (const column of columnize(sheet.questions, columns)) {
    const col = doc.createElement("div");
    col.className = `${prefix}-col`;
    for (const q of column) col.appendChild(buildRow(q));
    grid.appendChild(col);
  }

  host.appendChild(grid);
  syncDisabled();

  /* ------------------------------------------------------------ building */

  function buildRow(q: number): HTMLElement {
    const row = doc.createElement("div");
    row.className = `${prefix}-row`;
    row.dataset.question = String(q);
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", labelOf(q));

    const timing = doc.createElement("span");
    timing.className = `${prefix}-timing`;
    timing.setAttribute("aria-hidden", "true");

    const number = doc.createElement("span");
    number.className = `${prefix}-num`;
    number.textContent = String(q);

    const group = doc.createElement("span");
    group.className = `${prefix}-ovals`;

    sheet.choices.forEach((choice, i) => {
      const label = doc.createElement("label");
      label.className = `${prefix}-oval`;

      const input = doc.createElement("input");
      input.type = "radio";
      input.name = nameOf(q);
      input.value = choice;
      input.dataset.question = String(q);
      input.dataset.choice = String(i);
      input.checked = sheet.get(q) === choice;

      const face = doc.createElement("span");
      face.className = `${prefix}-face`;
      face.textContent = choice;

      label.append(input, face);
      group.appendChild(label);
      ovals.set(`${q}:${i}`, { input, label });
    });

    row.append(timing, number, group);
    rows.set(q, row);
    paintRow(q);
    return row;
  }

  /* ------------------------------------------------------------- syncing */

  function paintRow(q: number): void {
    const answer = sheet.get(q);
    rows.get(q)?.classList.toggle(`is-marked`, answer !== undefined);
    sheet.choices.forEach((choice, i) => {
      const oval = ovals.get(`${q}:${i}`);
      if (!oval) return;
      const filled = answer === choice;
      oval.input.checked = filled;
      oval.label.classList.toggle("is-filled", filled);
    });
  }

  function syncDisabled(): void {
    for (const { input } of ovals.values()) input.disabled = sheet.disabled;
    grid.classList.toggle("is-disabled", sheet.disabled);
    grid.setAttribute("aria-disabled", String(sheet.disabled));
  }

  function focusCursor(): void {
    const { question, choice } = sheet.cursor;
    ovals.get(`${question}:${choice}`)?.input.focus();
  }

  /* ------------------------------------------------------------ listeners */

  const offChange = sheet.on("change", (event) => {
    for (const q of event.questions) paintRow(q);
    options.onChange?.(event.value, event);
  });

  const offCursor = sheet.on("cursor", () => {
    // Follow the cursor only while the sheet already holds focus, so that
    // programmatic navigation does not yank focus out of the rest of the page.
    if (grid.contains(doc.activeElement)) focusCursor();
  });

  function onKeyDown(event: Event): void {
    const key = event as KeyboardEvent;
    if (sheet.handleKey(key)) key.preventDefault();
  }

  function onFocusIn(event: Event): void {
    const input = (event.target as HTMLElement).closest?.("input");
    if (!input) return;
    sheet.setCursor(Number(input.dataset.question), Number(input.dataset.choice));
  }

  function onChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.dataset.question) return;
    const q = Number(input.dataset.question);
    sheet.set(q, input.value);
    // The browser has already moved the radio; repaint so a refused mark (a
    // disabled sheet, a rejected value) cannot leave the markup ahead of the
    // model.
    paintRow(q);
  }

  function onClick(event: Event): void {
    const input = (event.target as HTMLElement).closest?.("input") as HTMLInputElement | null;
    if (!input?.dataset.question) return;
    const q = Number(input.dataset.question);
    // A pointer click on an already-filled oval erases it, the way a good
    // eraser does. Synthetic clicks (detail 0) come from the keyboard and
    // should not undo the mark that was just made.
    if ((event as MouseEvent).detail > 0 && sheet.get(q) === input.value) {
      sheet.clear(q);
      paintRow(q);
      return;
    }
    // Filling is left to the change event that follows: repainting here would
    // undo the browser's own check before that event is delivered. The one
    // exception is a sheet that refuses the mark outright.
    if (sheet.disabled) paintRow(q);
  }

  grid.addEventListener("keydown", onKeyDown);
  grid.addEventListener("focusin", onFocusIn);
  grid.addEventListener("change", onChange);
  grid.addEventListener("click", onClick);

  /* ------------------------------------------------------------ interface */

  return {
    sheet,
    element: grid,
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
    focus(question = sheet.cursor.question, choice = sheet.cursor.choice) {
      sheet.setCursor(question, choice);
      focusCursor();
    },
    destroy() {
      offChange();
      offCursor();
      grid.removeEventListener("keydown", onKeyDown);
      grid.removeEventListener("focusin", onFocusIn);
      grid.removeEventListener("change", onChange);
      grid.removeEventListener("click", onClick);
      grid.remove();
      rows.clear();
      ovals.clear();
    },
  };
}
