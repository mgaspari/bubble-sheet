# bubble-sheet

A scantron for the web: the answer sheet, the pencil-fill keyboard flow, and the
grading — without a framework.

The one idea: **every question is a group of cells, and every cell selects from
a fixed menu of choices.** An exam question is one cell with five choices; a
name field is twelve cells over the alphabet; a rating scale is one cell over
the numbers; a date is digit cells with printed slashes. If it can be drawn as
boxes and bubbles on paper, it is a configuration of the same model — and if it
cannot (calendars, dropdowns, scrolling text), it belongs to some other
library.

The package is two layers. `Sheet` is the whole behaviour with no DOM at all:
answers, a keyboard cursor, and the key handling that ties them together.
`mount()` is a small renderer that draws that model into real, accessible radio
inputs and keeps the two in sync. A React wrapper — when it lands — is a hook
over the same `Sheet`, not a second implementation.

## Run it

```bash
npm install
npm start        # → http://localhost:5173
```

That serves `demo/`: a full form — name and ID grid-ins, fifty questions, a
reader head that sweeps the page. `npm start` builds first if `dist/` is
missing or stale, so a fresh clone works from those two commands alone.
A minimal integration — the code you would actually write in an app — is at
[`examples/quiz.html`](examples/quiz.html), served at
`/examples/quiz.html`.

Opening `demo/index.html` straight off the filesystem will *not* work, because
browsers block ES modules over `file://`. The page says so if you try.

## Install

```bash
npm install bubble-sheet
```

## Quick start

```js
import { mount, score } from "bubble-sheet";
import "bubble-sheet/styles.css";

const bubbles = mount("#sheet", {
  questions: 50,
  choices: ["A", "B", "C", "D", "E"],
  columns: 2,
});

bubbles.sheet.on("change", ({ value }) => {
  localStorage.setItem("answers", JSON.stringify(value));
});

document.querySelector("#grade").addEventListener("click", () => {
  console.log(score(bubbles.value, ANSWER_KEY)); // { correct: 43, percent: 0.86, … }
});
```

Everything outside the grid — the paper, the printed instructions, the reader
head — lives in [`demo/`](demo/) and is deliberately not in the package.

## Name and ID fields

The other half of a scantron is the block at the top where you print your name
one character per box and fill the matching bubble in the column beneath. That
is `mountGrid`:

```js
import { mountGrid } from "bubble-sheet";

const name = mountGrid("#name", { cells: 12, charset: "letters", caption: "Name" });
const id = mountGrid("#id", { cells: 8, charset: "digits", caption: "Student ID" });

name.text = "LOVELACE";    // paints the boxes and the bubbles
id.text;                   // "18151210"
```

Typing in a box fills that column's bubble and moves to the next box; filling a
bubble writes the character back into the box. `Space` blanks a column, which is
how a last name is split from a first. `Backspace` clears the current cell, or
steps back and clears the previous one when it is already empty. `←` `→` walk
the cells, and on the bubbles themselves `↑` `↓` walk the characters stacked in
one column — the axes swap because the questions run sideways here
(`orientation: "columns"`).

| Option | Default | |
| --- | --- | --- |
| `cells` | `12` | character boxes in the field |
| `charset` | `"letters"` | `"letters"`, `"digits"`, `"alphanumeric"`, or your own string/array |
| `mask` | — | shape the field per position; see below |
| `grow` | `false` | `true` or `{ min, max }`: the field grows as it is typed into |
| `caption` | — | visible label, also the accessible name |
| `text` | — | initial text, one character per cell |
| `name` | — | `name` for a hidden input carrying the text, for plain form posts |
| `onChange` | — | called with the field's text |
| `prefix`, `sheet`, `disabled`, `wrap` | | as for `mount` |

The handle exposes `text` (get and set — trailing blanks trimmed on the way
out), `value` for the raw cell-to-character map, `sheet`, `element`, `disabled`,
`focus(cell)` and `destroy()`. Under the hood it is the same `Sheet`: cells are
questions, characters are choices, so a twelve-box name field is a twelve
question sheet with twenty-six choices each.

### Masks

A mask shapes the field position by position — digit cells with printed
slashes is a date:

```js
const date = mountGrid("#date", { mask: "99/99/9999", caption: "Date" });
date.text = "08282026";  // typed digits only…
date.text;               // "08/28/2026" — literals come back on the way out
```

In a string mask `9` is a digit cell, `A` a letter cell, `*` alphanumeric, and
any other character a printed literal — drawn on the form, never typed, never
a cell. Each cell's bubble stack offers only its own characters, and a cell
refuses characters that belong elsewhere. For finer control pass an array,
where each entry is a string of characters for that cell or `{ literal }`:

```js
mountGrid("#time", { mask: ["012", "0123456789", { literal: ":" }, "012345", "0123456789"] });
```

### Growing fields

A fixed field is the scantron default — the paper has exactly twelve boxes,
and a blank column is meaningful. When length is genuinely unknown, let the
field grow:

```js
mountGrid("#name", { charset: "letters", grow: { min: 1, max: 30 } });
```

The invariant: there is always exactly one empty cell after the last filled
one, within `min..max`. Type into the last cell and a new one appears; erase
and it falls away. Backspace clears the current column in place; on an empty
column it clears the one to the left — so at the end of the field each press
erases exactly one character, and the field shrinks as it goes.

## Keyboard

The flow is the point: click one oval, then keep your hands on the keys.

| Key | Effect |
| --- | --- |
| a choice label (`A`–`E`) | fill the question and advance to the next |
| `Backspace` | erase and step back |
| `Delete` | erase and stay |
| `↑` `↓` | previous / next question |
| `←` `→` | previous / next oval |
| `Home` `End` | first / last question |
| `PageUp` `PageDown` | move by `pageSize` (default 10) |
| `Enter` | fill the oval under the cursor and advance |
| `Space` | toggle the oval under the cursor |
| digits | jump to that question — `4` `2` lands on 42 |
| `Escape` | drop a half-typed question number |

Digits compose into one number while they arrive within `digitTimeout`
(800 ms), so `1` `2` is question 12 but `1` … pause … `2` is question 2. When
the choices themselves are digits (`["1", "2", "3", "4"]`), digit keys fill
instead of jumping.

Clicking a filled oval erases it, the way an eraser would.

## Headless use

Everything works without a document, which is what makes the model easy to test
and to wrap for any framework:

```js
import { Sheet } from "bubble-sheet";

const sheet = new Sheet({ questions: 50, value: { 1: "C" } });

sheet.handleKey({ key: "b" }); // fills question 1 with B, cursor moves to 2
sheet.set(3, "E");
sheet.value; // { 1: "B", 3: "E" } — frozen, and replaced on every change
```

`value` is never mutated in place: each change swaps in a new frozen object, so
the reference doubles as a cheap "did anything change" check in a render loop.

### `new Sheet(options)`

| Option | Default | |
| --- | --- | --- |
| `questions` | `50` | how many rows |
| `choices` | `["A","B","C","D","E"]` | values, or `{ value, label }` pairs |
| `maxSelections` | `1` | above 1, questions hold arrays ("mark all that apply") |
| `value` | `{}` | initial answers |
| `disabled` | `false` | refuse every mutation |
| `wrap` | `false` | wrap at the ends instead of clamping |
| `orientation` | `"rows"` | `"rows"`: `↑`/`↓` walk questions. `"columns"`: `←`/`→` do |
| `digitJump` | `true` | let digit keys jump to a question number |
| `pageSize` | `10` | questions per `PageUp` / `PageDown` |
| `digitTimeout` | `800` | ms that digits keep composing one number |
| `now` | `Date.now` | clock for that timeout — inject one in tests |

Answers are keyed by 1-based question number: `{ 1: "C", 2: "A" }` — or, on a
multi-select sheet, `{ 1: ["A", "C"] }`, kept in canonical choice order.

A choice can carry a label for display: `{ value: "5", label: "Great" }`. The
value is what is stored and graded; `labelOf(choice)` returns the label, and
the renderers draw it beside the bubble.

**State** — `value` (get/set), `get(q)`, `selected(q)` (always an array),
`has(q, choice)`, `set(q, choice)`, `unset(q, choice)`, `clear(q)`,
`toggle(q, choice)`, `clearAll()`, `setValue(next)`, `resize(n)`, `answered`,
`complete`, `disabled`, `multi`, `indexOf(choice)`, `labelOf(choice)`.

On a multi-select sheet `set` adds a selection (refusing past
`maxSelections`), `unset` removes one, and a choice key on the keyboard
toggles without advancing. `resize(n)` changes the question count, dropping
answers past the end; it emits a `resize` event, which is what lets a growing
field add and remove cells.

Mutators return `true` when something actually changed. `set` throws for a
question off the sheet or a label that is not a choice — those are bugs, not
input. `setValue` is the forgiving path: entries that no longer fit (a question
past the end, a label the sheet does not offer) are dropped, so a sheet saved
under one configuration still restores under another.

**Cursor** — `cursor`, `setCursor(q, choice)`, `moveQuestion(delta)`,
`moveChoice(delta)`. Positions clamp, or wrap when `wrap` is on.

**Keyboard** — `handleKey(event)` takes anything shaped like a `KeyboardEvent`
(`{ key, ctrlKey?, metaKey?, altKey? }`) and returns `true` when the sheet owned
that key, which is exactly when a DOM caller should `preventDefault()`. Keys
held with a modifier are always left to the browser.

**Events** — `on("change", fn)`, `on("cursor", fn)` and `on("resize", fn)`
return an unsubscribe function; `off()` drops everything. A change event carries `{ value, previous,
questions }`, where `questions` lists only what moved — enough to repaint a few
rows instead of the sheet.

A disabled sheet still navigates. Reading a submitted sheet with the arrow keys
is useful; changing it is not.

### `mount(target, options)`

Takes an element or a selector, appends the grid, and returns a handle. Accepts
every `Sheet` option, plus:

| Option | Default | |
| --- | --- | --- |
| `columns` | `2` | visual columns; questions fill column by column |
| `prefix` | `"bs"` | class-name prefix |
| `sheet` | — | bring your own `Sheet` instead of constructing one |
| `name` | `` q => `bs-q${q}` `` | `name` attribute of each question's radios |
| `label` | `` q => `Question ${q}` `` | accessible name for each question |
| `onChange` | — | shorthand for `sheet.on("change", …)` |

The handle exposes `sheet`, `element`, `value`, `disabled`, `focus(q, choice)`
and `destroy()`. Every method on `sheet` is reflected in the markup, and the DOM
is repainted from the model after each interaction, so a refused change can
never leave the two out of step.

Each question is a `radiogroup` of real `<input type="radio">` elements — or
checkboxes, on a multi-select sheet, so the browser's own toggling matches the
model — which
is what buys screen-reader support and native form submission for free — set
`name` and a plain `<form>` post carries the answers with no JavaScript at all:

```js
mount("#sheet", { questions: 50, name: (q) => `answer[${q}]` });
```

Focus follows the cursor only while the sheet already holds focus, so
programmatic navigation never yanks focus away from the rest of the page.

### Grading and storage

```js
import { score, serialize, deserialize } from "bubble-sheet";

score({ 1: "C", 2: "A" }, { 1: "C", 2: "B", 3: "D" });
// { total: 3, graded: 3, correct: 1, incorrect: 1, blank: 1, ungraded: 0,
//   percent: 0.333…, byQuestion: { 1: "correct", 2: "incorrect", 3: "blank" } }

serialize({ 1: "C", 3: "A" }, { questions: 4 }); // "C-A-"
deserialize("C-A-"); // { 1: "C", 3: "A" }
```

Comparison is case-insensitive throughout. A question the key does not cover
comes back `ungraded` rather than counting for or against the taker, and
`percent` divides by `graded`, not `total`. A multi-select answer is correct
only as an exact set — every required choice marked and nothing extra. In
`serialize`, a multi-select answer packs its selections side by side within
the slot (`["A","C"]` becomes `"AC"`), which — like any multi-character slot —
needs an explicit `separator`; `deserialize` reads them back with
`{ multi: true }`.

`columnize(questions, columns)` is the same layout helper `mount` uses, exported
for anyone drawing their own grid.

## Styling

`bubble-sheet/styles.css` styles the grid and nothing else — the form around it
is yours. Retheme through the custom properties on `.bs-grid` rather than by
overriding rules:

```css
.bs-grid {
  --bs-ink: #1b1d16;      /* rules, borders, numbers */
  --bs-muted: #6b7560;    /* unfilled labels */
  --bs-accent: #b4322a;   /* focus ring */
  --bs-oval-width: 26px;
  --bs-oval-height: 16px;
}
```

The answer grid is `.bs-grid > .bs-col > .bs-row > .bs-timing | .bs-num |
.bs-ovals > .bs-oval > input + .bs-face` (plus `.bs-choice-label` after a
labeled bubble); a field is `.bs-field > .bs-field-caption | .bs-cells >
.bs-cell > .bs-box | .bs-stack > .bs-oval`, with `.bs-sep` for mask literals. Both
carry `.is-marked` on an answered row or cell, `.is-filled` on a filled oval and
`.is-disabled` when disabled, and both read the same custom properties. Rows
carry `data-question` and cells `data-cell`; inputs carry `data-choice`. Skip
the stylesheet entirely and style those hooks yourself if you would rather.

## Development

```bash
npm install
npm start       # build if needed, then serve demo/ on :5173
npm test        # build, then run the model and jsdom suites (50 tests)
npm run build   # ESM + CJS + types + css into dist/
npm run typecheck
```

## Roadmap

- `@bubble-sheet/react` — a `useSheet` hook and a `<BubbleSheet />` wrapping this
  same model.
- Server rendering: emit the markup as a string so a sheet works before hydration.
- Print stylesheet, so a sheet on paper matches the sheet on screen.

## License

MIT
