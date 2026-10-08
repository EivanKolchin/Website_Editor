# Retouch - notes for agents

Retouch edits a running Vite + React site in place and saves each edit back
to the source code: text, position, size, rotation, flips, colour, styles
and deletion, with one undo history that reaches past saves. It traces every
element, its words, its styles, its colours and what moves it to the line
that writes them. **There is no AI in
the edit path.** Every edit is resolved and written deterministically by the
server in `src/server/`; a model is only ever used, optionally, to write a
project's config (`retouch map`), and that config is what this guide is
mostly about.

If you were asked to set Retouch up in a project, read **Wiring Retouch into
a project** and do exactly that. If you were asked to change Retouch itself,
read **Changing Retouch** first; it has rules that are easy to break.

---

## How it works, in one screen

1. **Stamps.** A Vite plugin (`src/server/plugin.mjs`) runs a transform with
   `order: 'pre'`, ahead of `@vitejs/plugin-react`, on every JSX file. It adds
   `data-rt="<path-hash>.<content-hash>:<start>-<end>"` to every JSX element:
   the element's offsets in the exact text the page was built from. Inside a
   `.map(...)` callback the stamp also carries the callback's index, so one
   instance of a list can be told from the rest.
2. **Selection.** The editor (`src/client/`) walks React's fiber tree up from
   the clicked node. That recovers every place the pixel was written: the
   `<image>` inside `Sprite`, and the `<Sprite x={238} .../>` usage on the
   page. It selects the outermost one that can be edited on its own.
3. **Strategy.** The server (`src/server/ops.mjs`) answers, per tool, what a
   save will write:
   | selected thing | move and size | turn and flip | delete | colour |
   |---|---|---|---|---|
   | a component with an **adapter** | its position and size props | a `<g transform>` wrapper (SVG) or style (HTML) | the element, or its list entry | style |
   | a plain SVG element | its own `x`/`y`/`width`/`height` (built-in adapters) | `<g transform>` wrapper | the element, or its list entry | `fill` attribute or style |
   | an HTML element | `style={{ translate, scale }}` | `style={{ rotate, scale }}` | the element | `style={{ backgroundColor }}` / `color` |
   An element drawn from a list literal (`ITEMS.map(...)`) is edited **in its
   own entry** of that list when the value can be traced there; otherwise the
   edit is shared by every instance, and the editor says so before doing it.
4. **Text** is found where it is written, which is usually not where the
   element is: a data module, a `'...' + '...'` concatenation, a JSX text
   node. `src/server/text.mjs` indexes every literal with a map from each
   rendered character to the source characters that produced it, so an edit
   rewrites only those characters.
5. **Saving** (`src/server/save.mjs`) computes every edit as a splice against
   the text the page was built from, relocates it onto the file as it is now,
   refuses collisions, checks the result still parses, writes atomically and
   journals the batch so it can be undone - even after a reload. Then any
   `rebuild` generator the saved files feed is run (`src/server/rebuild.mjs`).
6. **Markup from a string.** Elements React never rendered (an `.html` file
   set with `dangerouslySetInnerHTML`, markup a build step inlines) carry no
   stamp. The client describes them - tag, classes, text, ancestors - and the
   server finds them in the HTML files of `text.include`
   (`src/server/html.mjs`); they are then edited in that file through a
   pseudo-stamp `html:<file>|<offset>|<tag hash>`: their style attribute,
   their text, or removal. Elements a script made at run time are found
   nowhere; they can be selected, inspected and traced, never saved.
7. **Trace.** The browser knows which rules apply and win, what animates an
   element and (by listening for a moment) which script writes its style;
   the server (`src/server/trace.mjs`) turns each into a file and a line:
   CSS rules by selector, `@keyframes` by name, stack frames through Vite's
   source maps, generated files through the `rebuild` rule that makes them.
8. **Colours where they are written** (`src/server/colors.mjs`): every hex,
   `rgb()`, `hsl()`, `oklch()`, `oklab()`, named colour and (opt-in) OKLCH
   number array in the source files, matched to a colour picked off the page
   by OKLab distance and rewritten in its own spelling.
9. **The studio** (`src/client/studio.js`, served at `/__retouch/studio`) is
   the page in a frame with Layers and Changes on the left, Properties
   (Design, Settings, Motion, Source) on the right, a search bar and a
   timeline. The editor still runs inside the page; the studio reads and
   drives it through the controller `app.js` hands over
   (`window.__RETOUCH__.app`). In a narrow window the panels open over the
   page instead of squeezing it (each area is placed in its grid column by
   name, so a floating panel never pulls the stage into its column). Its tab
   wears THE PROJECT'S OWN ICON: `projectIcons` in `src/server/studio.mjs`
   reads the icons index.html declares, and the studio then copies whatever
   icon the framed page carries, so it is never Retouch's and never one the
   browser cached for the same localhost port from another project.
10. **Drawings on a canvas** (`src/client/canvas.js`). The head script wraps
    the 2D context's and Path2D's drawing methods with a hook that costs one
    property read per call until the editor records. A recording keeps one
    whole animation frame per canvas - frames are told apart by the page's
    `requestAnimationFrame` tick, which the head script names in
    `R.frameT`; a full clear only drops what it erases - and each path,
    fill, stroke, text or image becomes an ITEM: outline in canvas pixels,
    colour, line width, and the stack that drew it. Items are hit-tested
    under the pointer, outlined, selected (the page is frozen first), grouped
    by their first two stack frames (the drawing helper and its caller), and
    traced through source maps - including a bundled public script's own
    `sourceMappingURL` map. Canvases with `pointer-events: none` are put back
    into the hit-test stack by paint order (`withCanvases` in `app.js`).
11. **Settings** (`src/server/settings.mjs`): the values in code that decide
    how a selection works. For a component usage: its props (choices read
    from its TypeScript type, unset props offered), the defaults it falls
    back to, the top-level constants its function reads (described by the
    comment above each), and the numbers in it that time or move things.
    For a drawing: the numbers in the function of the chosen stack frame.
    Each item carries its literal's exact range, so a change is a `literal`
    or `prop` op, saved at once.
12. **The clock**: the head script runs the page's rAF timestamps and
    `performance.now` on a virtual clock, so the editor can freeze, slow
    and step it forwards and BACK (`R.step(ms)`), and every time-driven
    drawing follows. CSS animations are scrubbed through the Web Animations
    API; their `@keyframes` are read from the CSSOM, located in source, and
    edited with a live preview (`decl` ops into the keyframe). The studio's
    timeline runs the clock by dragging its TIME readout, and its bar is the
    page's SCROLL, because a scroll-driven page keeps its animations there
    and a clock moved alone never reached them. `src/client/scroll.js` finds
    the scroller (the one with the most scroll, weighted by how much of the
    window it covers; an `overflow: hidden` box only when laid-out boxes run
    past it, since transforms inflate `scrollHeight` too) and speaks in
    fractions of its range. The needle goes wherever it is put; while it is
    held, a second copy of the page framed as `retouch-preview` shows that
    point (no editor boots in it, it ignores the stored clock, and it is
    frozen between drags), and letting go scrolls the real page there
    (`ctl.scrollTo`, which steps a frozen page once so it redraws).
13. **Depth and search**: the depth rail over the selection, the right-click
    list of everything under the pointer, and the search panel
    (`src/client/finder.js`, Ctrl+K) are all ways to reach something a click
    cannot.
14. **The pointer.** A click selects (on release, so a press can still turn
    into a drag); a drag on the page draws a selection box; only what is
    already selected moves, dragged by its own box - so exploring a page
    never shifts anything. Shift+click adds or removes; Ctrl+A takes the
    selection's siblings. WORDS FIRST: `textAt` finds text by where it is
    laid out, not by the hit test, because pages put `pointer-events: none`
    on their headlines so drags reach the stage beneath; `textBlockOf`
    then climbs from a word or line span to the heading, paragraph or key it
    belongs to. A second tap on selected words starts typing there, and
    `startEditing` opens up `pointer-events` and `user-select` on the
    block while it is edited, then puts them back.
15. **Groups** (`state.group` in `app.js`, "several at once"). A box takes
    the outermost things wholly inside it, and a wrapper that draws nothing
    of its own (no fill, border, shadow or text) gives way to the visible
    things inside it; a block of text stays one thing even when its words
    are each in a span. Every member keeps its own edit record and frame and
    is saved exactly as it would be alone. Moving snaps the union box;
    resizing scales each member about its own centre AND moves that centre
    away from the group's by the same factor, so spacing keeps its
    proportions. Align and space-out are per-member translations. Members
    that cannot move (made by a script, drawn many times from one line) are
    named and left where they are; one history entry covers the group.
    DRAWINGS JOIN GROUPS: a box over a canvas freezes the page and takes
    the drawings wholly inside it (`drawingsInBox`); a drawing member has
    `drawing` set, is told apart from others on its canvas by its own box
    (`sameDrawing`), is traced lazily (`traceMembers`) and never moves.
    Once several are selected, EVERY TAP TOGGLES: a tap on something selected
    (or inside it) takes it out, a tap elsewhere adds it, a box adds more, and
    the group stays a group even at one member (`setMembers(list, { keep })`)
    until Unselect all, Esc, or a click on the studio's empty stage. Each
    member wears a tick at its top right.
16. **New elements are source, written at once** (`src/server/insert.mjs`,
    the `insert` op). New text goes beside a text element (same tag and
    class, so it looks like what it follows) or inside a container at the
    end; a paste writes the copied element's own source after the
    selection. Both use the indentation of the children already there, and
    both are refused where the result would not be code: beside a
    component's root or a `.map` result, inside a self-closing element, a
    copy reading its component's values pasted into another file, HTML into
    JSX or back. `insertNow` saves with everything pending, then finds the
    new element when hot reload delivers it (`arrival`), or after a
    rebuild's reload (`afterReload` in sessionStorage).
17. **States and styles.** `stateRules` (trace.js) finds the rules that
    style an element pressed, hovered or focused by taking the state out of
    each selector and matching what is left; they are edited where they are
    written (`setDeclOf`), and "Show it" copies their declarations onto the
    element until asked back. Copy style takes the text style (and a key's
    box when it draws one) from computed values; Paste style is one
    `setStyles` edit, one undo step.
18. **Where a colour sits.** Hovering a gradient's colour marks the part of
    the page where that colour can be SEEN. For a drawing it is found in
    pixels (`src/client/tonemask.js`, pure arithmetic): a cell is kept when
    its gradient offset is in the band the stop owns (halfway to each
    neighbour, `bandOf` in tones.js), it is inside the drawing's own path
    (rastered), the canvas there still shows the colour this drawing paints
    (so anything painted later on the same canvas drops out), and nothing
    above the canvas covers it - other canvases, pictures, an SVG's own
    silhouette (a copy with its computed paint, loaded as an image) and
    filled boxes, chosen by asking the browser's stacking with every element
    made hit-testable. The head script tags every canvas gradient with how
    it was created, so offsets are computed as the canvas computes them. CSS
    gradients, and drawings whose pixels cannot be read, fall back to the
    geometric band cut to the shape with SVG masks (tones.js). PICTURES:
    pages pre-render layers off screen and stamp the picture over the
    canvas each frame (Kerfox's sky is drawn, then covered by its own cached
    copy with the dawn glow). A picture carries no fill style (whatever
    gradient was left on the context is not its colour), is hit only where
    it is not clear (`imageAlphaAt` reads the picture itself), and a click
    prefers the drawing whose colour the canvas shows at that point
    (`showingFirst`), so tapping the sky selects the sky.
19. **Zoom is a lens** (studio.js). The frame keeps the size the page lays
    out at and is drawn scaled inside a sizer, so zooming never trips a
    breakpoint; the editor works in page pixels throughout, and its chrome is
    drawn at `--inv` (one over the scale) so labels, handles and ticks stay
    one size on screen. Ctrl+wheel and pinch reach the studio from inside
    the page through the shell (`zoomWheel`); zoomed in, in Edit mode, a plain
    wheel moves the view first and scrolls the page only once the view is at
    its edge (`panWheel`). In View mode the wheel is always the site's: it is
    being used, not edited, and the view moves by its scrollbars.

---

## Wiring Retouch into a project

The goal is one file: **`retouch/local/config.mjs`** when the Retouch folder
sits inside the project (that folder is gitignored by Retouch, which keeps the
Retouch repo generic), or **`<project>/retouch.config.mjs`** when the project
wants the wiring in its own history. Both are ES modules exporting a config
object. `retouch.config.example.mjs` is a documented starting point.

Work through these in order. Read files; do not guess.

### 1. Find the dev server

- Find the Vite config the site is served with. There may be several (an app
  and a marketing site, or a web and a native build). Read `package.json`
  scripts: the `dev` script for the site names its config with `--config`.
  Set `vite.configFile` to that file, relative to the project root.
- Note any commands that script runs **before** `vite` (generators, codegen,
  `node scripts/x.mjs && vite ...`). Put them in `before`, in order: the page
  Retouch serves must be the page the project's own dev server would serve.
- Retouch runs on its own port (default 5199) beside the project's dev
  server, with its own dependency cache. Do not change the project's config.
- If the project is not Vite + React, say so plainly and stop: stamping
  needs JSX through Vite, and selection reads React's fiber tree.

### 2. Decide what gets stamped

- `stamp.include` defaults to every `.jsx`/`.tsx` file outside node_modules.
  Narrow it to the site's source folder when the repo holds several apps.
- `stamp.skipComponents`: components that pass unknown props to something
  that is not a DOM element and is not inert - typically custom renderers
  (react-three-fiber scenes: their lowercase elements are already skipped,
  but a capitalised wrapper that spreads props onto `<mesh>` is not), or
  components that validate their props strictly. Search for `...props` /
  `...rest` spreads onto non-DOM targets.

### 3. Find where the words live

- Text is searched in every module the page imports, automatically. Add
  `text.include` globs only for text outside the module graph: markdown or
  JSON loaded at runtime with `fetch`, and **`.html` files whose markup the
  page receives as a string** (`dangerouslySetInnerHTML`, a template a build
  step inlines). An included `.html` file is read as the browser reads it:
  text between tags, entities decoded; its elements become selectable and
  editable in that file.
- Script fragments a build step concatenates can be included too: a file
  that does not parse alone still has its string literals read.
- Add `text.exclude` globs for **generated** files: anything a script
  rewrites (`generated/`, `.gen.ts`, i18n compiled output, files listed in
  `.gitignore`). An edit saved there would be overwritten by the generator.
  If the generated text has a hand-written source, the source is where the
  edit belongs; if it has none, it is not editable and that is correct.

### 4. Positioned components: adapters

This is the step that needs real reading. An **adapter** tells Retouch that a
component is placed and sized by its own props, so moving it should edit
those props instead of adding a transform on top.

Look for components rendered with numeric props that are clearly geometry:
`x`, `y`, `left`, `top`, `ground`, `cx`, `w`, `width`, `size`, `scale`, `r`.
Common in illustrated scenes: SVG sprites, rigged characters, chart marks,
positioned cards. For each one, **read the component's source** and answer:

1. **Which props hold its position?** They become `move: { x, y }`.
2. **Which point do they denote?** The centre, the top-left, the
   bottom-centre ("standing on the ground"). For SVG this is usually fine to
   leave as `anchor: 'props'` (the default): the anchor IS the point
   `(props[x], props[y])`, in the coordinate system of the element's parent.
3. **Which props hold its size, and about which point do they scale?** List
   them in `size`. Retouch multiplies each by the scale factor and assumes
   the element grows about the anchor from step 2. Check that: if `w` scales
   the drawing about its bottom-centre and `x, ground` IS the bottom-centre,
   it is right. If size scales about a different point than the position
   props name, leave `size` out - resizing then falls back to a wrapper,
   which is always correct, just less tidy.
4. **Are the props in the parent's coordinate system?** A component that
   applies its own `transform` to the props (`translate(x, y)` on its root
   group) is fine. One whose props are in some other unit (percentages, grid
   cells) is not an adapter; leave it to the wrapper.

Example, from a scene where sprites stand on the ground:

```js
// function Sprite({ x, ground, w, aspect }) {
//   const h = w * aspect
//   return <image x={x - w / 2} y={ground - h} width={w} height={h} />
// }
adapters: [{ component: 'Sprite', move: { x: 'x', y: 'ground' }, size: ['w'] }]
```

`x` is the centre and `ground` the bottom, so `(x, ground)` is the
bottom-centre; `w` scales the image about exactly that point. Correct.

For HTML components placed by props in CSS pixels, give the anchor as box
fractions: `anchor: [0, 0]` for top-left props (`left`/`top`), `[0.5, 0.5]`
for centre props.

Plain SVG elements need no adapter: `image`, `use`, `rect`,
`foreignObject` (x, y, width, height), `circle` (cx, cy, r), `ellipse` (cx,
cy, rx, ry) and `text` (x, y) are built in, used whenever the element has no
`transform` of its own.

### 5. Locked areas

`locked`: CSS selectors for output that must not be selected or edited -
typeset maths (`.katex`, `.MathJax`), embedded third-party widgets, canvas
and WebGL hosts, rendered markdown. HTML injected with
`dangerouslySetInnerHTML` is already refused for text editing.

### 6. The project's own check

`check`: the command that should run after every save, and is fast - a lint,
a typecheck of the edited app, a project gate. It is shown on the toolbar as
passed or failed; it never blocks a save. Prefer a command under about ten
seconds. Never put a full production build here.

### 7. House rules

Look for written rules about copy and colour: `CLAUDE.md`, `AGENTS.md`,
`CONTRIBUTING.md`, design docs, style guides, lint rules, gates that grep the
source. Turn the ones that apply to a single edit into rules:

- `textRules`: `{ pattern: /.../, message }` or `(text) => message | null`,
  run on the new text of every text edit. Example: a ban on a character.
- `colorRules`: `(value) => message | null`, run on every colour picked.
  Example: a brand colour that must come from a token, never a literal.

Rules warn; they do not block. If a project gate would fail on something, the
rule should say which gate and why.

### 8. Colours

`colors.tokens` (default true) shows the page's CSS custom properties that
hold colours; picking one writes `var(--name)`, which follows dark mode where
a hex would not. Set `colors.tokensFirst: true` when the project has a token
system and raw literals are discouraged.

The colour picker finds where a colour is written in every module the page
imports. Add `colors.include` globs for colour sources outside it: a token
file a build step copies into a generated sheet (the generated copy cannot
be edited, its source can), stylesheets a script injects, scene scripts that
draw on a canvas. If a project keeps colours as OKLCH number arrays
(`[0.62, 0.15, 250]`, or gradient stops `[t, L, C, h]`), set
`colors.arrays: 'oklch'`; without it, arrays are never read as colours.

### 9. Generators: `rebuild`

If part of the page is BUILT by a script from files the dev server never
imports (markup inlined into a module, scene scripts bundled into
`public/`), a save to those files changes nothing until the script runs.
Declare each such script:

```js
rebuild: [{ from: ['site/landing/**'], run: 'node scripts/build-landing.mjs', outputs: ['site/generated/landing.*', 'site/public/landing/**'] }]
```

It runs after every save, undo or redo that touches `from`; its `outputs`
are not hot-reloaded while it runs (the page already shows the edit, and a
markup string swapped under a running script breaks it), and a trace that
lands in an output names the rule and its sources. Put the same script in
`before` so the editor starts on current output.

### 10. Scripts that draw: source maps

A canvas drawing is traced through the stack of the code that drew it. Vite
modules are mapped automatically. A script a build step bundles into
`public/` is only as traceable as its source map: a generator should write
one, with `//# sourceMappingURL=` at the end of the script, when Retouch runs
it - Retouch sets `RETOUCH=1` in the environment of every `before` and
`rebuild` command for exactly this, so the map never ships in a real build.
For concatenated parts, build a line map from the concatenation to the part
files and hand it to the minifier as an input map (esbuild composes it); see
how a project's own generator does it if one exists. Without a map the
drawing is still selectable and its colour still findable; Source then says
it could not be placed.

### 11. Verify

1. `node retouch/bin/retouch.mjs doctor` - every line should be resolved.
2. Launch (`Retouch.cmd`, or `node retouch/bin/retouch.mjs`), then on one
   element of each kind (a heading from a data module, an SVG sprite, an
   item of a list, an HTML box): select it, read the inspector's description
   of what each tool will write, make the edit, save, read the diff, undo.
3. Confirm undo after save restores the file byte for byte
   (`git diff` is empty again, or the file hash matches).
4. If the page draws on a canvas: open the canvas in Layers (it lists its
   drawings), select one, and check Source names the code that drew it.
5. Leave the project's own files as you found them.

**Probing without a mouse.** `window.__RETOUCH__.app` is the controller the
panels use: `selectElement(el)`, `selection()`, `settings()`,
`search(q)`, `drawingsOf(canvas)`, `selectDrawing(item)`, `trace()`,
`keyframes()`, `styles(props)`. `app.debug.capture({ stacks })` records the
canvases once, and `app.debug.resolveHit(x, y)` says what a click there
would take. A hidden browser pane delivers no animation frames, so canvases
are not drawn there and recordings come back empty; a studio squeezed to no
width gives the page a zero-width canvas.

Report what you configured, every adapter with the reason, and anything you
were not sure of.

---

## Config reference

```js
export default {
  name: 'My site',                 // shown in the toolbar
  root: '../..',                   // the project, relative to THIS file
  vite: { configFile: 'vite.config.ts', mode: 'development', port: 5199 },
  open: '/',                       // first page to open
  before: [],                      // commands run in the project root first
  stamp: { include: ['**/*.{jsx,tsx}'], exclude: [], skipComponents: [] },
  text: { include: [], exclude: [] },  // include: runtime text, .html markup; exclude: generated files
  rebuild: [{ from: ['src/landing/**'], run: 'node build.mjs', outputs: ['src/generated/**'], label: 'landing' }],
  adapters: [{ component: 'Sprite', move: { x: 'x', y: 'ground' }, size: ['w'], anchor: 'props' }],
  locked: ['.katex'],
  check: { command: 'npm run lint', label: 'lint', timeoutMs: 180000 },
  textRules: [{ pattern: /!/, message: 'No exclamation marks.' }],
  colorRules: [(value) => null],
  colors: { tokens: true, tokensFirst: false, include: [], arrays: null },  // arrays: 'oklch' to read [L, C, h]
  ai: { model: 'claude-opus-5-5', effort: 'high' },        // retouch map only
  window: { browser: 'auto', app: true, width: 1440, height: 920 },
  exitOnClose: true,               // stop the server when the window closes
  studio: true,                    // open the studio (panels around the page); false or --page: the page alone
}
```

`component` may be a list of names. Every field is optional; `root` defaults
to the folder the Retouch folder sits in, and `vite.configFile` to whichever
`vite.config.*` exists there.

---

## Changing Retouch

| file | job |
|---|---|
| `bin/retouch.mjs` | CLI: `start` (default), `map`, `doctor`; `--page`, `--skip-before` |
| `src/server/start.mjs` | loads config, runs `before`, starts the host's own Vite with the plugin, opens the window |
| `src/server/plugin.mjs` | the Vite plugin: snapshots, stamps, page injection, the API mount |
| `src/server/stamp.mjs` | JSX stamping and map-index injection; `parseStamp` |
| `src/server/sources.mjs` | snapshots per content hash, `relocate`, the save journal |
| `src/server/text.mjs` | text entries (JS, JSX, JSON, HTML): cooking, raw maps, minimal splices, verification |
| `src/server/html.mjs` | HTML files as source: elements with offsets, finding a page element in one, style attribute and removal splices |
| `src/server/css.mjs` | stylesheets as source: rules, declarations, nesting, keyframes; selector normalising |
| `src/server/colors.mjs` | colour literals: parse, find in CSS/HTML/JS, rewrite in the same spelling; OKLab distance |
| `src/server/trace.mjs` | where things are written: HTML elements, rules, keyframes, stack frames, colours, generated files |
| `src/server/rebuild.mjs` | generators run after saves, and their outputs kept from hot-reloading |
| `src/server/sourcemap.mjs` | served line and column back to the written line |
| `src/server/studio.mjs` | the studio page's HTML, and the project's own icons for its tab |
| `src/server/settings.mjs` | settings: props and their types, defaults, named constants with their comments, timing numbers, the numbers at a stack frame |
| `src/server/resolve.mjs` | bindings, map entries, value sites for props |
| `src/server/edits.mjs` | splice builders: numbers, deletion, attributes, style, wrappers |
| `src/server/insert.mjs` | new elements: new text and pasted copies, beside or inside an element, JSX or HTML, refused where they would break the code |
| `src/server/ops.mjs` | `inspect` (strategies), `resolveText`, `findText`, `plan` (edits to splices, HTML elements included) |
| `src/server/save.mjs` | apply a batch: relocate, collide, parse-check, write, journal |
| `src/server/api.mjs` | the token-guarded HTTP API under `/__retouch` |
| `src/client/app.js` | the editor: modes, events, selection, gestures, styles, recolouring, navigation, save, history, and `ctl`, the controller the panels use |
| `src/client/inspector.js` | the properties panel, drawn in the studio or over the page |
| `src/client/studio.js`, `layers.js` | the studio: frame, devices, zoom and panning, bar, layers, panels |
| `src/client/trace.js` | what the browser knows: matched rules, winners, rules for pressed / hovered / focused states, animations, script writers |
| `src/client/tones.js` | where one colour of a gradient is: CSS gradients parsed, the area each stop owns as a band, ring or wedge |
| `src/client/tonemask.js` | the same, in pixels: the cells of a canvas where a colour can actually be seen, and their outline |
| `src/client/pick.js` | the colour picker and its loupe |
| `src/client/canvas.js` | canvas drawings: the recorder, hit testing, names, grouping sites |
| `src/client/finder.js` | the search panel (Ctrl+K), drawn in the studio or over the page |
| `src/client/geometry.js` | the transform maths shared by preview and save |
| `src/client/snap.js` | smart guides: snap targets, move/resize/turn snapping, the guide layer |
| `src/client/react.js` | fiber walking: units, counts, instances |
| `src/client/scroll.js` | the page's main scroller, and positions on it as fractions: the timeline's bar and its preview |
| `src/client/text.js` | in-place text editing that leaves React's nodes intact |
| `src/client/color.js`, `palette.js` | the colour panel and its curated palette |
| `src/ai/map.mjs` | the optional model-driven wiring |
| `test/run.mjs` | the engine's gate |

Rules, each learned the hard way:

1. **No AI in the edit path.** Selection, resolution and saving are
   deterministic. `src/ai/` may only ever write a config.
2. **Every write is a splice** computed against a snapshot, relocated onto
   the current file, collision-checked, parse-checked, written atomically
   (`writeFileAtomic`) and journalled. Never write a source file any other
   way, and never read one for saving through a cache (`readFresh`).
3. **Stamps index the file as written.** The stamp transform must stay
   `order: 'pre'`; after React's Babel pass the offsets point into code nobody
   wrote.
4. **The preview is the save.** `geometry.js` computes both. A change to one
   without the other shows an edit and writes a different one.
5. **Say when an edit is shared.** Never let a single-element gesture save to
   every instance without the person being told first.
6. **The editor never breaks the page's DOM.** Text editing snapshots and
   restores React's own nodes; previews are inline styles that are removed
   only once the saved code has rendered.
7. **Page events are stopped with `stopPropagation`, never
   `stopImmediatePropagation`** - the editor's own window listeners must
   still run.
8. **The editor's toolbar never covers the page's own navigation.** It
   docks at the bottom because a site's nav lives at the top; anything new
   that floats over the page must leave the top band alone.
9. **Navigating is a real link click**, let through with `state.passClicks`,
   never `location.assign`: the site's own router must handle it exactly as
   it would a visitor's click. Other origins open in a new window.
10. **Snap to few things, and only to what can be seen.** Targets are the
    container, a dozen nearest neighbours, two backdrops and the window's
    centre; anything invisible (an ancestor's opacity counts), off-screen or
    moving is dropped. Snapping to every element on a busy page leaves no
    position that does not snap, which is the same as no free placement.
11. **Panels never hold state.** `inspector.js` and the studio read every
    value from `ctl` and send every change through it, so the page and the
    studio can never disagree about the selection or the history.
12. **Listening is put back exactly.** `watchMotion` wraps style setters for
    a moment; every wrapper is removed (Chrome keeps style properties on each
    style object, so they are wrapped per object and deleted after).
13. **The canvas hook stays one property read.** Every drawing call on the
    page goes through it, thousands per frame; it may only check `R.rec`
    and call through. Recording work belongs in `canvas.js`, and only while
    a capture runs.
14. **A frame is a tick, not a clear.** Pages paint a canvas over more than
    once per frame; splitting frames on clears returned half pictures.
15. **Settings are saved at once, with everything pending.** Code cannot be
    previewed, and saving only the setting would leave unsaved edits below a
    saved one in the history, which then undo in the wrong order.
16. **Never offer a value Retouch cannot write back exactly.** A setting is
    listed only with the exact range of one literal; an expression is shown
    read-only, with its line.
17. **A click never moves anything.** Moving starts only from the selection's
    own box. Pressing on the page and dragging draws a selection box; do not
    reintroduce press-and-drag-to-move on unselected things.
18. **A group edits its members as members.** No group-level code path may
    write a source file differently from how the same edit on one member
    would be written.
19. **Find text by its layout, not by the hit test.** Never go back to
    `elementFromPoint` or the caret lookup alone for "what words are here":
    both skip `pointer-events: none`, which is how pages lay out headlines.
20. **Nothing new appears without being written.** New text and pastes are
    saved at once and shown by hot reload; there is no preview of an element
    that does not exist in the source yet.
21. **Overlays are sized to the window.** An SVG mask or clip region
    thousands of pixels across is not painted; keep them to the viewport.
22. `node test/run.mjs` must pass. A new edit kind gets a case that states the
    exact text it expects in the saved file.
23. **The timeline's preview is never an editor.** The copy framed as
    `retouch-preview` must not boot `app.js` (it would attach to the studio
    in place of the real page) nor read the real page's stored clock state;
    it shares the tab's sessionStorage, so anything new the head script or
    the editor restores from there has to skip it too.

## Known limits

- Vite + React only (React 18 or 19). Plain HTML pages get text editing by
  search but no stamps. Markup set as a string is editable only when it is
  kept in an `.html` file listed in `text.include`.
- A canvas has no elements. Its drawings are recorded and can be selected,
  traced and recoloured where their colour is written, but not dragged: how
  big and where they are is computed by the script, so Settings lists the
  numbers in the code that drew them, which is as close as a generic tool
  can get. A canvas that does not redraw every frame is recorded only when
  it next draws.
- A script that moves an element is named only when its stack has a frame in
  the project; a library's animation loop is named as that library.
- Groups move, resize, align, space out and delete together, but do not
  rotate or flip as one. Drawings in a group are looked at, traced and
  recoloured, never moved.
- Copy and paste take one thing at a time. A copy that reads its own
  component's values pastes only within that file.
- New text goes into the flow beside or inside what is selected; it is not
  placed at an arbitrary point.
- A pressed or hover look that is written nowhere cannot be added from the
  panel yet: a rule with :active or :hover has to exist first.
- A transform is visual: HTML moves use `translate`, so they do not reflow
  neighbours. An inline element (a bare `<span>` in a sentence) cannot be
  moved; select its block.
- Text assembled by code (`${count} items`, dates, `.join()`) is found only
  where its literal parts are written, and the editor refuses edits it cannot
  place. Text in a template literal with expressions is matched piece by
  piece.
- Turning or flipping ONE item of a list is refused: the wrapper would be in
  the shared template. Move and resize work per item.
- A style saved on a component usage shows only if that component passes its
  `style` prop through; the inspector says so.
