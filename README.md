# bubble-sheet

A scantron for the web: the answer sheet, the pencil-fill keyboard flow, and the
grading — without a framework.

The package is two layers. `Sheet` is the whole behaviour with no DOM at all:
answers, a keyboard cursor, and the key handling that ties them together.
`mount()` is a small renderer that draws that model into real, accessible radio
inputs and keeps the two in sync. A React wrapper — when it lands — is a hook
over the same `Sheet`, not a second implementation.

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

`npm run demo` serves a full form — paper, header fields, a reader head that
sweeps the page — at <http://localhost:5173>. The source of that page is in
[`demo/`](demo/), and everything outside the grid is deliberately not in the
package.

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
| `choices` | `["A","B","C","D","E"]` | oval labels |
| `value` | `{}` | initial answers |
| `disabled` | `false` | refuse every mutation |
| `wrap` | `false` | wrap at the ends instead of clamping |
| `pageSize` | `10` | questions per `PageUp` / `PageDown` |
| `digitTimeout` | `800` | ms that digits keep composing one number |
| `now` | `Date.now` | clock for that timeout — inject one in tests |

Answers are keyed by 1-based question number: `{ 1: "C", 2: "A" }`.

**State** — `value` (get/set), `get(q)`, `set(q, choice)`, `clear(q)`,
`toggle(q, choice)`, `clearAll()`, `setValue(next)`, `answered`, `complete`,
`disabled`, `indexOf(choice)`.

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

**Events** — `on("change", fn)` and `on("cursor", fn)` return an unsubscribe
function; `off()` drops everything. A change event carries `{ value, previous,
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

Each question is a `radiogroup` of real `<input type="radio">` elements, which
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
`percent` divides by `graded`, not `total`. Multi-character labels need an
explicit `separator`; single characters pack with none.

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

The structure is `.bs-grid > .bs-col > .bs-row > .bs-timing | .bs-num |
.bs-ovals > .bs-oval > input + .bs-face`, with `.is-marked` on an answered row,
`.is-filled` on a filled oval and `.is-disabled` on a disabled grid. Rows carry
`data-question`; inputs carry `data-question` and `data-choice`. Skip the
stylesheet entirely and style those hooks yourself if you would rather.

## Development

```bash
npm install
npm test        # builds, then runs the model and jsdom suites
npm run demo    # build and serve demo/ on :5173
npm run build   # ESM + CJS + types + css into dist/
```

## Roadmap

- `@bubble-sheet/react` — a `useSheet` hook and a `<BubbleSheet />` wrapping this
  same model.
- Server rendering: emit the markup as a string so a sheet works before hydration.
- Multi-select questions ("mark all that apply") and per-question choice counts.
- Print stylesheet, so a sheet on paper matches the sheet on screen.

## License

MIT
