import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ensureDir, hash, pathId, posix, relTo, writeFileAtomic } from './util.mjs'

/**
 * EVERY VERSION OF EVERY FILE THE PAGE WAS BUILT FROM.
 *
 * A stamp's offsets index into one exact text. When a save arrives, the
 * file on disk may have moved on - another editor saved it, an agent edited
 * it, our own previous save landed - so the server keeps the text each stamp
 * was minted against and relocates edits from that text onto the current
 * one, refusing when the region around the edit has itself changed.
 */
export class Sources {
  constructor(root) {
    this.root = root
    this.byPid = new Map() // pid -> { file, rel }
    this.snapshots = new Map() // `${pid}.${vid}` -> code
    this.latest = new Map() // file -> vid
  }

  record(file, code) {
    const rel = relTo(this.root, file)
    const pid = pathId(rel)
    const vid = hash(code)
    this.byPid.set(pid, { file: posix(resolve(file)), rel })
    const key = `${pid}.${vid}`
    if (!this.snapshots.has(key)) {
      this.snapshots.set(key, code)
      this.prune(pid)
    }
    this.latest.set(pid, vid)
    return { pid, vid, rel }
  }

  /** Keep the last few versions of each file: enough for an edit made just before a save. */
  prune(pid) {
    const keys = [...this.snapshots.keys()].filter((k) => k.startsWith(pid + '.'))
    while (keys.length > 6) this.snapshots.delete(keys.shift())
  }

  file(pid) {
    return this.byPid.get(pid) ?? null
  }

  snapshot(pid, vid) {
    return this.snapshots.get(`${pid}.${vid}`) ?? null
  }

  read(file) {
    return readFileSync(file, 'utf8')
  }
}

/**
 * Map a range in an older text onto the current one. Edits elsewhere in
 * the file shift it; an edit overlapping it makes it unknowable, and then
 * the honest answer is "reload", not a guess.
 */
export function relocate(basis, current, start, end) {
  if (basis === current) return { start, end }
  let p = 0
  const max = Math.min(basis.length, current.length)
  while (p < max && basis.charCodeAt(p) === current.charCodeAt(p)) p++
  let s = 0
  while (s < max - p && basis.charCodeAt(basis.length - 1 - s) === current.charCodeAt(current.length - 1 - s)) s++
  const changedStart = p
  const changedEnd = basis.length - s
  if (end <= changedStart) return { start, end }
  if (start >= changedEnd) {
    const shift = current.length - basis.length
    return { start: start + shift, end: end + shift }
  }
  return null
}

/**
 * THE SAVE JOURNAL: what every save replaced, so undo still works after the
 * page has reloaded or the editor was closed and opened again. Lives in the
 * host's node_modules/.cache, which every project already ignores.
 */
export class Journal {
  constructor(root) {
    this.root = root
    this.dir = ensureDir(join(root, 'node_modules', '.cache', 'retouch', 'journal'))
    this.batches = []
    for (const name of safeList(this.dir)) {
      if (!name.endsWith('.json')) continue
      try {
        this.batches.push(JSON.parse(readFileSync(join(this.dir, name), 'utf8')))
      } catch {}
    }
    this.batches.sort((a, b) => a.time - b.time)
    while (this.batches.length > 100) this.batches.shift()
  }

  add(batch) {
    this.batches.push(batch)
    this.persist(batch)
    return batch
  }

  get(id) {
    return this.batches.find((b) => b.id === id) ?? null
  }

  persist(batch) {
    try {
      writeFileSync(join(this.dir, `${batch.time}-${batch.id}.json`), JSON.stringify(batch))
    } catch {}
  }

  /** The newest batches, for the client to rebuild its undo history from. */
  summary(limit = 30) {
    return this.batches.slice(-limit).map((b) => ({ id: b.id, time: b.time, label: b.label, undone: !!b.undone, files: b.files.map((f) => f.rel) }))
  }

  /**
   * Swap a batch's files between their before and after texts. Refuses when
   * any of them has been changed by something else since, because writing
   * the old text back over that would destroy the other change.
   */
  swap(id, direction) {
    const batch = this.get(id)
    if (!batch) throw new Error('That save is no longer in the journal.')
    const want = direction === 'undo' ? 'after' : 'before'
    const put = direction === 'undo' ? 'before' : 'after'
    for (const f of batch.files) {
      const path = join(this.root, f.rel)
      const now = existsSync(path) ? readFileSync(path, 'utf8') : null
      if (now !== f[want]) {
        throw new Error(`${f.rel} has changed since that save, so it cannot be ${direction === 'undo' ? 'undone' : 'redone'} without losing the newer change.`)
      }
    }
    for (const f of batch.files) writeFileAtomic(join(this.root, f.rel), f[put])
    batch.undone = direction === 'undo'
    this.persist(batch)
    return batch
  }
}

function safeList(dir) {
  try {
    return readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile())
  } catch {
    return []
  }
}
