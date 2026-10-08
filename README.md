# Retouch

**Edit your website by pointing at it, and the change is saved straight into its code.**

Retouch opens your site as it really runs, in an editor. Click a heading and
retype it. Drag a box around three cards and space them out evenly. Point at a
colour and fine-tune it. Make a fade a little slower. Press Save, and Retouch
writes each change into the exact characters of your source code that
produced it - a small, readable edit in `git diff`, nothing else touched.

There is **no AI in the editing.** Every change is traced to its source and
written by rules you can read, the same way every time.

Works with **Vite + React** projects (React 18 or 19), on Windows, macOS and
Linux.

---

## Why Retouch exists

Most changes to a website are small and specific: this heading two words
shorter, that button a shade warmer, these cards 8 px apart, that animation
a beat later. You know exactly what you want, and you can see exactly where.

The usual ways of making those changes cost more than the changes do:

- **By hand**, you first have to find where the thing is written - which
  file, which line, which of the three places that colour appears - and that
  takes knowing the codebase. For many people who care most about how a site
  looks, it is the part they cannot do.
- **Through an AI agent**, you have to describe in words what you can already
  see, and trust that it understood your exact direction. A request like
  "make the quote a bit smaller and move it up" is easy to get slightly
  wrong, slow to check, and expensive to repeat twenty times for twenty small
  edits. The more precise the change, the riskier it is to delegate.

Retouch closes that gap. You make the change directly on the page, where you
can see it, and Retouch does the part that needs knowing the code: finding
where it is written and changing exactly that.

**Who it is for:** designers, writers, founders, anyone with limited
technical knowledge who wants to change their own site; and developers who
would rather not spend ten minutes finding the code for a ten-second change.

**Where AI belongs:** in the big changes - a new feature, a redesign, a
refactor - where an agent's reach is worth the review. Keep the many small,
specific edits for yourself, and spend AI where it matters. (Retouch's one
optional use of a model is to set itself up in a new project, once.)

---

## What you can do

**Select anything.** Hover anything and it is outlined; click to select it.
A **depth rail** above the selection shows what it sits in - click a step, or
scroll over it, to take the picture, its card or its section. **Right-click**
lists everything under the pointer, top first. **Layers** shows the page as a
tree. Even the stars, lines and shapes a script paints on a **canvas** can be
hovered and selected. Tap words and you get the heading, paragraph or button
they belong to, even where the page has made its text click-through.

**Edit text where it is written.** Tap selected words again (or double-click
them) and type, or type new words into Properties. Retouch finds the literal
that produced them - often a data file, a joined string or markup kept in an
`.html` file - and rewrites only the characters you changed, so every styled
part around your change stays as it was.

**Add, copy, paste.** `T` (or right-click, Add text) puts new words after
what is selected, in the same tag and class so they look like their
neighbour, and opens them for typing. `Ctrl+C`, `Ctrl+X` and `Ctrl+V`
copy, cut and paste an element after the selection; `Ctrl+D` duplicates.
`Ctrl+Alt+C` copies a text style (font, size, weight, colour, and a
button's fill and corners) and `Ctrl+Alt+V` pastes it onto something else.

**Move, resize, rotate, flip, delete.** Click something to select it, then
drag it to move it; the corners resize, the dot above rotates. Smart guides
snap edges and centres into line, and the middle between two neighbours too.

**Many at once.** Drag on the page to draw a box: everything inside it is
selected, drawings on a canvas included, and each gets a tick. While several
are selected, a tap takes one out or adds another, so whatever the box caught
by accident is one tap away. Ctrl+A takes everything beside the selection;
Esc, Unselect all or a click on the dark space around the page lets go. Move
them together, resize them together (their spacing scales with them), align
their edges or centres, or space them out evenly.

**Buttons and their states.** Select a button and Properties shows its words,
its fill and text colour, and how it looks pressed, hovered and focused -
the rules that do not apply while it sits there selected. Edit them, and
"Show it" puts that look on the page without pressing anything.

**Design properties.** Size, margin, padding; font size, weight, line height,
letter spacing, alignment; fill, opacity, corners, border, shadow. Every
value shows where it comes from. A change lands on this one element by
default; "rule" changes the stylesheet rule instead and says how many
elements that reaches.

**Colours, where they are written.** Press `I` and point: a loupe reads the
colour under the cursor, from text, a background, an SVG or a canvas pixel.
Click, and Retouch lists every place that colour is written - CSS tokens,
rules, strings in scripts, colour data a canvas is drawn from - exact matches
first. Edit one with the colour wheel, previewed live, saved in its own
format. Point at one colour of a gradient in Properties and the part of the
page where you can actually see that colour is outlined: cut around whatever
is painted over it, a fox, a hill, a button, following their real edges.

**Settings: the values in code.** Select a component and Settings shows what
decides how it behaves: the props this instance sets (choices read from its
TypeScript types), the defaults it falls back to, the named constants its
code reads with the comment written above each, and the numbers that time or
move it. Drag a number's label sideways to change it; the page shows the
result straight away.

**Animations, frame by frame.** A timeline freezes, plays, slows (to a half,
a quarter or a tenth) and steps the page a frame forward or back, and scrubs
it by dragging. CSS animations appear as keyframe tracks: click a keyframe,
change its values, see it at once, save it into the `@keyframes` where it
lives.

**Trace everything to its file.** The Source tab names the line that writes
the element, the line that writes its words, every stylesheet rule that
styles it, the `@keyframes` that animate it, and the script that moves it.
Every line opens in your code editor.

**Zoom in, look closely.** `Ctrl`+wheel or a pinch zooms in on the point
under the pointer, up to 800%; `Shift+2` zooms to the selection, `Shift+1`
fits. Zoomed in, in Edit mode, the wheel moves the view (`Shift` for sideways) and
`Space`+drag moves around. The page keeps its real size underneath, so
zooming never changes its layout.

**Search the page.** `Ctrl+K` finds things by the words on them, by what they
are called, by the file they come from, or by colour, and runs commands.

**Save, check, undo.** Save writes every edit in one all-or-nothing batch,
then runs your project's own check (lint, tests, whatever you trust) and
shows the result. Undo and redo reach past a save, even after a reload.

---

## Quick start

You need Node 18.17 or newer and a Vite + React project. From the root of
that project:

```bash
git clone https://github.com/EivanKolchin/Website_Editor.git retouch
```

```bash
cd retouch && npm install
```

Then double-click **`Retouch.cmd`** (Windows), run `./retouch.sh`
(macOS/Linux; `chmod +x retouch.sh` once), or:

```bash
node retouch/bin/retouch.mjs
```

Retouch starts your project's own Vite dev server on its own port (5199,
next to yours), opens the **studio** - your page in the middle, Layers on the
left, Properties on the right - and stops when you close the window.
`--page` opens the page alone, with the editor floating over it.

With no configuration it finds `vite.config.*` in the folder above and works
on every `.jsx` / `.tsx` file. Most projects want a few minutes of wiring:
see [Setting it up in a project](#setting-it-up-in-a-project).

> Add `retouch/` to your project's `.gitignore`. Retouch is its own
> repository; your project should not track it.

---

## Using it

Four habits cover almost everything:

1. **Click selects.** Click again to go deeper - or, on words, to start
   typing; right-click for actions and everything under the pointer.
2. **Click, then drag, moves.** Only what is already selected moves, so you
   can explore the page without shifting anything by accident.
3. **Drag on the page selects several.** Then move, resize or align them as
   one; tap to take one out or add another.
4. **Double-click edits text.**

| to | do this |
|---|---|
| select | click. Again to go deeper; `Ctrl`+click for exactly what is under the pointer; `Alt`+click for what is underneath |
| choose a depth | the rail above the selection (click a step, or scroll over it); right-click for everything under the pointer |
| select several | drag a box on the page; `Shift`+click to add or remove; `Ctrl`+`A` for everything beside the selection |
| take one out, add one | with several selected, tap it |
| unselect everything | `Esc`, Unselect all, or click the dark space around the page |
| move | click to select, then drag it; arrow keys nudge (`Shift`: 10 px) |
| resize, rotate | the corner handles; the dot above the box. A group's corners resize every member and the space between them |
| align, space out | select several: the bar under them, or Properties |
| constrain | hold `Shift`: straight lines, 15 degree turns, 5% size steps |
| place freely | hold `Ctrl` while dragging, or switch the magnet off |
| cancel a drag | `Esc` before letting go |
| exact values | X, Y, W, R and every property in Properties; arrow keys step them, dragging a label scrubs it |
| edit text | tap selected words again, double-click them, or `Enter`; or type in Properties' Words box. `Enter` commits, `Esc` cancels |
| add text | `T`, the T button, or right-click, Add text |
| copy, cut, paste, duplicate | `Ctrl`+`C`, `X`, `V` (after the selection), `D`; or right-click |
| copy a style to something else | `Ctrl`+`Alt`+`C` on the source, `Ctrl`+`Alt`+`V` on the target; or Copy style and Paste style in Properties |
| a button's pressed or hover look | select it: Properties, Key |
| zoom | `Ctrl`+wheel or pinch; `Ctrl`+`+` / `-` / `0`; `Shift`+`1` fit, `Shift`+`2` the selection |
| move around when zoomed | in Edit mode the wheel (`Shift` sideways), `Space`+drag, or drag the dark space; in View mode the wheel scrolls the site and the scrollbars move the view |
| a style on this element or its rule | Properties: type a value; "rule" switches to editing the rule |
| a colour | the drop under the selection, or `I` to pick one off the page and edit it where it is written |
| a value in code | Settings: type, choose, switch, or drag a number's label |
| an animation | the timeline to play, freeze, slow or step (`,` and `.`); Motion to edit keyframes |
| find something | `Ctrl`+`K` or `/` |
| see where it is written | Source: every line opens in your editor |
| delete | `Delete` |
| undo, redo | `Ctrl`+`Z`, `Ctrl`+`Shift`+`Z`, saves included |
| save | `Ctrl`+`S`, or Save |
| use the page normally | View mode, or `Ctrl`+`Shift`+`E` |

### What a save writes

| you did | the change in your source |
|---|---|
| edited a heading rendered from `COPY.title` | `title: 'New words'` in the data file |
| moved a sprite `<Sprite x={238} ground={874} w={30} />` | `x={248} ground={871}` |
| resized one item of `ITEMS.map(...)` | `w: 105` in that item's own entry |
| moved an HTML box | `style={{ translate: '12px 4px' }}` on that element |
| moved three cards together | the same, on each card |
| changed the font size of one heading | `style={{ fontSize: '30px' }}` on it |
| the same, with "rule" | `font-size: 30px;` in the rule, in its stylesheet |
| fine-tuned a picked colour | that literal, in its own format: `--brand: #2b4ad8;` |
| changed a setting | `const RECALL = { fine: 80, coarse: 24 }`, that number and nothing else |
| switched a prop on one instance | `<Bar tone="night" />`, or `count={3}` added where it was missing |
| changed a keyframe | `50% { opacity: 0.6; }` inside its `@keyframes` |
| deleted one item of a list | its line in the list |
| added text after a paragraph | `<p class="lead">New text</p>` on the next line, at its indentation |
| pasted a card after another | that card's own source, on the line after |
| changed how a button looks pressed | `transform: translateY(3px);` in its `:active` rule |
| pasted a style onto a heading | `style={{ fontSize: '30px', fontWeight: '800', ... }}` on it |

---

## Setting it up in a project

Wiring is one file, **`retouch/local/config.mjs`**. The `local/` folder is
ignored by this repository, so Retouch stays generic however many projects
it lives in. (A project that wants to track its wiring can use
`<project>/retouch.config.mjs` instead.)

It says which Vite config serves the site, what runs before it, which
components are placed by their props, where text and colours live outside
the code the page imports (`.html` markup, token files, scene scripts),
which files are generated and what generates them, your project's own check
command, and any house rules. `retouch.config.example.mjs` documents every
field. Three ways to write it:

1. **By hand**, from the example.
2. **With your coding agent.** Paste:
   > Read retouch/AGENTS.md and wire Retouch into this project: write
   > retouch/local/config.mjs, check it with `node retouch/bin/retouch.mjs
   > doctor`, then launch it and test each tool on one element of each kind.
3. **With a model, once:** `npm install @anthropic-ai/sdk` in `retouch/`, put
   `ANTHROPIC_API_KEY=...` in `retouch/.env`, then run
   `node retouch/bin/retouch.mjs map`. It explores the project with read-only
   tools, writes and checks the config, and leaves notes in
   `local/MAPPING.md`.

`node retouch/bin/retouch.mjs doctor` prints what Retouch found.

---

## How it works

```text
 the browser                                  your dev server (Node)
 -----------                                  ----------------------
 your page, with the editor inside it         Vite, with Retouch's plugin
   select, drag, type, pick a colour   ---->    where is this written?   (ops, trace, colors, settings)
   previews every edit on the page     ---->    a splice per edit        (edits, html, text)
   the studio's panels drive it        ---->    checked, written, journalled  (save)
                                                then your generators and your check run
```

1. **Stamps.** As the dev server compiles each JSX file, Retouch's plugin tags
   every element with where it is written: the file, its version, and the
   element's exact position in it.
2. **Selection.** The editor reads React's tree from the element under the
   pointer back to every place it was written, and picks the one that can be
   edited on its own. Markup from an `.html` file is found in that file;
   canvas drawings are recorded as the page draws them.
3. **Preview.** Every edit shows on the page at once, computed by the same
   maths the save uses, so what you see is what gets written.
4. **Save.** Each edit becomes a splice - which characters, replaced by what -
   against the exact text the page was built from, moved onto the file as it
   is now, checked against every other edit, and required to leave a file
   that still parses. Then the files are written atomically and the batch is
   journalled for undo.

---

## Safety

- The editor's server listens on `localhost` only, and every request carries
  a token printed into the page, so no other website can ask it to write
  files.
- It only writes inside your project, never in `node_modules` or `.git`.
- Every save is all-or-nothing: if any edit collides with another, no longer
  matches its file, or would leave a file that does not parse, nothing is
  written.
- Writes are atomic - a full disk costs the edit, never the file - and every
  save is journalled in `node_modules/.cache/retouch/` so it can be undone.
- It runs on its own Vite dependency cache, beside your own dev server.

## Limits

- Vite + React only, for now.
- A drawing on a canvas can be selected, traced and recoloured, but not
  dragged: the script that draws it decides where it goes, so you change it
  through the numbers in that code (Settings).
- Moves are visual (`translate`), so neighbours do not reflow around them.
- Text built by code (`${count} items`, dates) is editable only where its
  literal parts are written; Retouch refuses an edit it cannot place exactly.
- Turning or flipping ONE item of a list is refused: it would be saved into
  the template every item shares. Moving and resizing work per item.
- New text and pastes go into the flow, beside or inside what is selected,
  not at an arbitrary point. A copy that uses its own component's values
  pastes only within that file.
- A pressed or hover look that is written nowhere cannot be created from the
  panel yet; one that exists can be edited.

---

## Contributing

Retouch is meant to be built by the people who use it. Every contribution
that makes a small edit faster, safer or easier for someone without deep
technical knowledge is in scope. **[CONTRIBUTING.md](CONTRIBUTING.md)** has
the full guide; the short version is below.

### Ways to help

- **Try it on your own site** and report what it could not do. A clear bug
  report is one of the most useful things you can send.
- **Fix a bug** or a rough edge in the interface.
- **Teach it a new kind of edit**, or a new place things are written
  (Tailwind classes, CSS modules, translation files, MDX).
- **Bring it to another framework.** Vue and Svelte are the most requested;
  the save engine is framework-neutral, the stamping and selection are not.
- **Improve the words.** The interface and these docs should read clearly to
  someone who has never seen the code.

Not sure where to start? Look for issues labelled `good first issue`, or open
an issue describing what you want to do before starting a larger change, so
the approach can be agreed first.

### Set up

1. Fork <https://github.com/EivanKolchin/Website_Editor> on GitHub, then
   clone your fork - inside a Vite + React project you can test against is
   easiest:
   ```bash
   git clone https://github.com/<your-name>/Website_Editor.git retouch
   ```
2. Install and run the tests:
   ```bash
   cd retouch && npm install && npm test
   ```
3. Run it against a project:
   ```bash
   node bin/retouch.mjs --root ../path/to/a/vite-react-project
   ```
   Changes to `src/client/` show when you reload the page; changes to
   `src/server/` need Retouch restarted.

### Make a change

1. Branch from `main`: `git checkout -b fix/short-description` (or
   `feature/...`, `docs/...`).
2. Read **[AGENTS.md](AGENTS.md)** - "How it works" and "Changing Retouch".
   It maps every file and lists the rules that keep saves exact. It is
   written for AI agents and people alike.
3. Make the change: plain JavaScript modules, no build step, no new
   dependency without discussing it first, comments that say *why*.
4. **Add a test** in `test/run.mjs` for anything that changes what is written
   to a file. A test states the exact text it expects; "it changed something
   plausible" is not a pass.
5. Run `npm test` - it must pass - and try the change by hand in a real
   project: select, edit, save, read the diff, undo.
6. Update **README.md** if what a person sees or does changed, and
   **AGENTS.md** if how it works changed.
7. Commit with a message saying what changed and why, push to your fork, and
   open a pull request against `main`. The template asks what you tested.

### Report a bug

Open an issue (there is a template) with what you did step by step, what you
expected, what happened instead (with the `git diff` if a save wrote
something wrong), the output of `node retouch/bin/retouch.mjs doctor`, your
browser and Node version, and any error from the browser console or the
terminal.

### The rules every change keeps

The full list is in [AGENTS.md](AGENTS.md); these matter most:

1. **No AI in the edit path.** Selecting, finding and saving are
   deterministic.
2. **Every write is a checked splice.** Never write a source file any other
   way.
3. **The preview is the save.** What the page shows is what gets written.
4. **Say when an edit reaches more than one thing,** before making it.
5. **Never offer a change Retouch cannot write back exactly.**

### Contributing with an AI agent

Welcome, with a person in charge. Point the agent at AGENTS.md, keep the
change small, review every line it writes, and run the tests yourself before
opening the pull request.

### On the roadmap

- Vue and Svelte support
- Tailwind: editing classes as well as styles
- Per-screen-size styles (change the phone layout without touching desktop)
- Replacing an image; adding an element from the page's own components
- Rotating a group as one
- A review mode: comments pinned to elements, applied by the owner

### Licence

No licence has been chosen yet. Until one is added, please open an issue
before contributing code, so everything can be released under the same
terms.
