# Contributing to Retouch

Thank you for helping. Retouch exists so that people can make the many small,
specific changes to a website themselves - visually, exactly, without
reading the code and without handing every tweak to an AI agent. A
contribution is good when it makes that faster, safer or easier, especially
for someone with little technical knowledge.

This guide is the detail behind the "Contributing" section of the
[README](README.md). [AGENTS.md](AGENTS.md) is the technical reference: how
every part works, every file, and the rules that keep saves exact.

---

## Before you start

- **Small fixes** (a typo, a clear bug, a confusing message): open a pull
  request directly.
- **Anything larger** (a new feature, a new kind of edit, a change to how
  saving works, a new dependency): open an issue first and describe what you
  want to do and how. Agreeing the approach first saves you rework.
- Check the open issues and pull requests, so two people do not build the
  same thing.

## Set up

1. Fork <https://github.com/EivanKolchin/Website_Editor> and clone your fork.
   Cloning it inside a Vite + React project you can test against is the
   easiest way to work:

   ```bash
   git clone https://github.com/<your-name>/Website_Editor.git retouch
   cd retouch
   npm install
   ```

2. Run the tests. They must pass before you change anything:

   ```bash
   npm test
   ```

3. Run Retouch against a project:

   ```bash
   node bin/retouch.mjs --root ../path/to/a/vite-react-project
   ```

   Useful flags: `--page` (the page without the studio), `--port <n>`,
   `--no-open`, `--skip-before`. `node bin/retouch.mjs doctor` prints what it
   found.

4. While you work: changes to `src/client/` show when you reload the page;
   changes to `src/server/` need Retouch restarted (Node does not reload
   itself).

## Where things are

| folder | what is in it |
|---|---|
| `bin/` | the command line: `start`, `map`, `doctor` |
| `src/server/` | the Vite plugin, finding where things are written, planning and applying saves |
| `src/client/` | the editor that runs inside the page, and the studio around it |
| `src/ai/` | the optional one-time setup with a model; never part of editing |
| `test/run.mjs` | the gate: every edit kind run against real files |

The table in AGENTS.md ("Changing Retouch") lists every file and its job.

## Recipes

### Add a new kind of edit

1. **Client** (`src/client/app.js`): record the edit so it previews on the
   page and has an undo entry, and add it to `pending()` as an op
   (`{ kind: 'your-kind', ... }`). Fields starting with `_` stay in the
   browser.
2. **Server** (`src/server/ops.mjs`, `plan`): turn the op into splices -
   `{ file, basis, start, end, text }` - using a builder in `edits.mjs`,
   `html.mjs` or a new module. Never write a file yourself; `save.mjs` does
   that for every edit.
3. **Test** (`test/run.mjs`): plan and save the op against the fixture and
   assert the exact text that ends up in the file. Then break your code on
   purpose and watch the test fail.
4. **Docs**: a row in the README's "What a save writes", and a line in
   AGENTS.md.

### Read text from a new kind of file

`src/server/text.mjs`: add how the file's text is cooked (what the page
shows, mapped character by character to the source), encoded (how new text
is written back) and verified (re-read after the splice). Add the extension
to `textEntries`. Test a round trip, including escapes.

### Add a property to Properties

`src/client/inspector.js`: add `{ prop, label }` to the right list
(`LAYOUT`, `TYPE`, `FILL`, `TIMING`). Values are read and written through the
controller (`ctl.styles`, `ctl.setStyle`), so nothing else is needed for an
ordinary CSS property.

### Change the interface

Panels never hold state: they read from `ctl` (the controller at the end of
`app.js`) and send every change through it. Add a method to `ctl` rather
than reaching into the editor from a panel, and keep the editor's toolbar
off the top of the page, where a site's own navigation lives.

## Test it

- `npm test` must pass.
- Try your change by hand in a real project: select, edit, save, read the
  `git diff`, undo, and check the diff is empty again.
- Without a mouse, `window.__RETOUCH__.app` in the page's console is the same
  controller the panels use: `selectElement(el)`, `selection()`,
  `settings()`, `search('words')`, `trace()`, and `debug.capture()` for
  canvases.
- A browser window in the background runs no animation frames: canvases do
  not draw and animations do not move there. Test those in a visible window.

## Code style

- Plain JavaScript ES modules. No build step, no TypeScript, no framework in
  the editor.
- No new runtime dependency without agreeing it in an issue first. Today
  there is one (`@babel/parser`).
- Two-space indent, single quotes, no semicolons, trailing commas: match the
  file you are in.
- Comments explain *why* something is the way it is, especially when the
  obvious way was tried and failed. Name the failure.
- Messages shown to people say what happened and what to do next, in plain
  words.

## Commit and open a pull request

1. Branch from `main`: `fix/...`, `feature/...` or `docs/...`.
2. Keep each pull request to one change. Several small pull requests are
   easier to review than one large one.
3. Write commit messages that say what changed and why, in the present tense:
   "Keep a group's spacing when it is resized".
4. Push to your fork and open a pull request against `main`. Fill in the
   template: what changed, why, and exactly what you tested.
5. A maintainer reviews it. Expect questions; they are about keeping saves
   exact, not about you.

## Report a bug

Use the bug report template. The most useful reports have:

- the steps, from opening Retouch to the problem;
- what you expected, and what happened instead;
- the `git diff` if a save wrote the wrong thing;
- the output of `node retouch/bin/retouch.mjs doctor`;
- your browser, Node version, and the project's React and Vite versions;
- any error from the browser console or the terminal.

## Security

If you find a way for a web page other than the one being edited to make
Retouch write files, do not open a public issue: use GitHub's private
vulnerability reporting on the repository instead.

## Working with an AI agent

You are welcome to use one. Point it at AGENTS.md, keep the change small,
read every line it writes, run the tests yourself, and say in the pull
request that an agent helped. You are responsible for the change.

## Be kind

Assume good intent, explain rather than correct, and remember that many
people here are new to code. That is the point of the project.
