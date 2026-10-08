**What this changes**


**Why**

<!-- The problem it solves for someone editing their site. Link the issue if there is one. -->


**What I tested**

- [ ] `npm test` passes
- [ ] Tried by hand in a real Vite + React project: select, edit, save, read the `git diff`, undo
- [ ] A new kind of edit has a test in `test/run.mjs` that states the exact text it writes
- [ ] README.md updated if what a person sees or does changed
- [ ] AGENTS.md updated if how it works changed

**Rules kept** (see AGENTS.md, "Changing Retouch")

- [ ] No AI in the edit path
- [ ] Every file write goes through a checked splice (`save.mjs`)
- [ ] The preview shows exactly what the save writes
- [ ] An edit that reaches more than one thing says so first

<!-- If an AI agent helped write this, say so here. -->
