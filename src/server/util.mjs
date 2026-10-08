import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

/** Forward slashes, always: stamps, globs and the client all speak POSIX paths. */
export const posix = (p) => p.split(sep).join('/').replace(/\\/g, '/')

export const relTo = (root, file) => posix(relative(root, file))

export const hash = (text, n = 8) => createHash('sha1').update(text).digest('hex').slice(0, n)

/** A path id: stable across restarts, so a stamp outlives a server bounce. */
export const pathId = (rel) => hash(rel.toLowerCase(), 6)

/** Strip Vite's query and the /@fs prefix from a module id. */
export function cleanId(id) {
  let file = id.split('?')[0].split('#')[0]
  if (file.startsWith('/@fs/')) file = file.slice(4)
  if (/^\/[A-Za-z]:\//.test(file)) file = file.slice(1)
  return file
}

/**
 * A small glob: `**` crosses directories, `*` and `?` do not, `{a,b}` picks.
 * Matched against root-relative POSIX paths. Enough for config files; not
 * a full minimatch, and deliberately so - no dependency for this.
 */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/'
        re += slash ? '(?:.*/)?' : '.*'
        i += slash ? 2 : 1
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const end = glob.indexOf('}', i)
      if (end < 0) {
        re += '\\{'
        continue
      }
      re += '(?:' + glob.slice(i + 1, end).split(',').map(escapeRe).join('|') + ')'
      i = end
    } else re += escapeRe(c)
  }
  return new RegExp('^' + re + '$', 'i')
}

const escapeRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')

export function matcher(include = [], exclude = []) {
  const inc = include.map(globToRegExp)
  const exc = exclude.map(globToRegExp)
  return (rel) => (inc.length === 0 || inc.some((r) => r.test(rel))) && !exc.some((r) => r.test(rel))
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * WRITE A SOURCE FILE WITHOUT EVER LEAVING IT HALF-WRITTEN.
 *
 * The new text goes to a sibling temp file first and is read back; only a
 * verified copy replaces the original, by rename. A full disk, a crash or a
 * killed process therefore costs the edit and never the file: the original
 * is untouched until the moment the complete replacement exists. Windows can
 * refuse a rename while another process (an editor, an indexer, a watcher)
 * holds the target, so the rename is retried before falling back to a
 * direct write that is verified the same way.
 */
export function writeFileAtomic(file, text) {
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.retouch.tmp`)
  writeFileSync(tmp, text, 'utf8')
  try {
    if (readFileSync(tmp, 'utf8') !== text) throw new Error(`could not verify a temporary copy of ${file}`)
    let lastError
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        renameSync(tmp, file)
        return
      } catch (e) {
        lastError = e
        sleepSync(40 * (attempt + 1))
      }
    }
    writeFileSync(file, text, 'utf8')
    if (readFileSync(file, 'utf8') !== text) throw lastError ?? new Error(`could not write ${file}`)
  } finally {
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp)
      } catch {}
    }
  }
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Read a request body as JSON, with a ceiling so a runaway client cannot fill memory. */
export function readJson(req, limit = 8 * 1024 * 1024) {
  return new Promise((done, fail) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        fail(new Error('request body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        done(text ? JSON.parse(text) : {})
      } catch (e) {
        fail(e)
      }
    })
    req.on('error', fail)
  })
}

export function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/** The 1-based line and column of an offset, for labels a person reads. */
export function lineCol(code, offset) {
  let line = 1
  let last = 0
  for (let i = 0; i < offset && i < code.length; i++) {
    if (code.charCodeAt(i) === 10) {
      line++
      last = i + 1
    }
  }
  return { line, col: offset - last + 1 }
}

/** Round to the precision a hand-written number would carry. */
export function tidyNumber(value, like) {
  const decimals = like == null ? 2 : Math.min(3, (String(like).split('.')[1] || '').length)
  let places = Math.max(decimals, 0)
  let out = Number(value.toFixed(places))
  if (like != null && out === Number(like) && Math.abs(value - Number(like)) > 1e-9) {
    places = Math.max(places, 1)
    out = Number(value.toFixed(places))
    if (out === Number(like)) out = Number(value.toFixed(2))
  }
  if (Object.is(out, -0)) out = 0
  return out
}

export const fmt = (n) => {
  const v = Number(n.toFixed(2))
  return String(Object.is(v, -0) ? 0 : v)
}

export class RetouchError extends Error {
  constructor(message, extra = {}) {
    super(message)
    Object.assign(this, extra)
  }
}

export const isUnder = (root, file) => {
  const r = posix(resolve(root)).toLowerCase()
  const f = posix(resolve(file)).toLowerCase()
  return f === r || f.startsWith(r.endsWith('/') ? r : r + '/')
}
