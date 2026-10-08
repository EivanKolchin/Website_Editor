import { parseErrors } from './ast.mjs'
import { relocate } from './sources.mjs'
import { hash, relTo, RetouchError, writeFileAtomic } from './util.mjs'

/**
 * APPLY A BATCH, ALL OR NOTHING.
 *
 * Splices arrive computed against the texts the page was built from. Here
 * they are moved onto each file as it is on disk right now, sorted, checked
 * for collisions, and applied in one pass per file. The result must parse
 * at least as cleanly as the file did before, or nothing is written - not
 * that file, not any other file in the batch. Only then are the files
 * written (atomically, see util.mjs) and the batch journalled for undo.
 */
export function applySplices({ project, journal, splices, label }) {
  const byFile = new Map()
  for (const s of splices) {
    if (!project.allowed(s.file)) throw new RetouchError(`Refusing to edit ${s.file}: it is outside the project or in node_modules.`)
    if (!byFile.has(s.file)) byFile.set(s.file, [])
    byFile.get(s.file).push(s)
  }
  if (!byFile.size) throw new RetouchError('Nothing to save.')

  const files = []
  for (const [file, list] of byFile) {
    const current = project.readFresh(file)
    if (current == null) throw new RetouchError(`${relTo(project.root, file)} no longer exists.`)
    const moved = list.map((s) => {
      if (s.basis === current) return s
      const r = relocate(s.basis, current, s.start, s.end)
      if (!r) throw new RetouchError(`${relTo(project.root, file)} was changed around this edit since the page loaded. Reload the page and make the edit again.`, { code: 'stale', op: s.op })
      return { ...s, ...r }
    })
    // later ops first at equal positions, so earlier ops end up earlier in the text
    moved.sort((x, y) => y.start - x.start || y.end - x.end || y.op - x.op)
    const span = (x) => x.end - x.start
    const kept = []
    for (const s of moved) {
      // an edit inside a region another edit deletes has nothing left to change
      if (kept.some((k) => k.text === '' && k.start <= s.start && s.end <= k.end && span(k) > span(s))) continue
      if (s.text === '') {
        for (let j = kept.length - 1; j >= 0; j--) {
          const k = kept[j]
          if (s.start <= k.start && k.end <= s.end && span(s) > span(k)) kept.splice(j, 1)
        }
      }
      // insertions touch nothing; ranges must not overlap at all
      if (kept.some((k) => s.start < k.end && k.start < s.end)) {
        throw new RetouchError('Two of these edits change the same code. Save them one at a time.', { code: 'conflict', op: s.op })
      }
      kept.push(s)
    }
    kept.sort((x, y) => y.start - x.start || y.end - x.end || y.op - x.op)
    let next = current
    for (const s of kept) next = next.slice(0, s.start) + s.text + next.slice(s.end)
    const before = parseErrors(current, file)
    const after = parseErrors(next, file)
    if (after > before) throw new RetouchError(`That edit would break ${relTo(project.root, file)}, so nothing was saved.`, { code: 'parse' })
    if (next !== current) files.push({ file, rel: relTo(project.root, file), before: current, after: next })
  }
  if (!files.length) throw new RetouchError('These edits leave the code exactly as it was.', { code: 'noop' })

  for (const f of files) writeFileAtomic(f.file, f.after)
  const time = Date.now()
  const batch = journal.add({
    id: hash(`${time}:${Math.random()}`),
    time,
    label: label || `${files.length} file${files.length === 1 ? '' : 's'}`,
    files: files.map(({ rel, before, after }) => ({ rel, before, after })),
  })
  return batch
}
