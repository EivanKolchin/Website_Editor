/**
 * ONE UNDO STACK FOR EVERYTHING: unsaved edits, and saves.
 *
 * An unsaved edit undoes in the page. A save undoes on disk - the server
 * writes back what it replaced - and the page follows through hot reload.
 * Because a save takes every unsaved edit with it, unsaved entries can only
 * ever be the tail of the stack, which is what lets a save collapse them
 * into one entry without reordering anything.
 */
export function createHistory(onChange) {
  const done = []
  const undone = []
  let busy = false

  async function step(from, to, method) {
    if (busy) return false
    const e = from.pop()
    if (!e) return false
    busy = true
    try {
      await e[method]()
      to.push(e)
      return true
    } catch (err) {
      from.push(e)
      throw err
    } finally {
      busy = false
      onChange()
    }
  }

  return {
    push(entry) {
      done.push(entry)
      undone.length = 0
      onChange()
    },
    undo: () => step(done, undone, 'undo'),
    redo: () => step(undone, done, 'redo'),
    canUndo: () => done.length > 0 && !busy,
    canRedo: () => undone.length > 0 && !busy,
    unsaved: () => {
      const out = []
      for (let i = done.length - 1; i >= 0 && !done[i].saved; i--) out.unshift(done[i])
      return out
    },
    /** Replace the unsaved tail with the save that took it. */
    collapse(savedEntry) {
      while (done.length && !done[done.length - 1].saved) done.pop()
      undone.length = 0
      done.push(savedEntry)
      onChange()
    },
    /** Rebuild from the server's journal after a reload. */
    seed(savedEntries, redoEntries) {
      done.length = 0
      undone.length = 0
      done.push(...savedEntries)
      undone.push(...redoEntries)
      onChange()
    },
    peekUndo: () => done[done.length - 1] ?? null,
    peekRedo: () => undone[undone.length - 1] ?? null,
    /** Forget what could be redone: after discarding edits there is nothing to bring back. */
    clearRedo() {
      undone.length = 0
      onChange()
    },
  }
}
