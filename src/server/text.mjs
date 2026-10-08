import { analysed, walk, unwrap } from './ast.mjs'

/**
 * WHERE THE WORDS ARE WRITTEN.
 *
 * Text on a page is rarely written where the element is. It sits in a data
 * module (`COPY.title`), is split across `'...' + '...'` lines, carries
 * escapes, entities and JSX whitespace rules. So every piece of text in a
 * source file is indexed as an ENTRY: its value as the page renders it
 * ("cooked"), and for every cooked character the raw source range it came
 * from. A change to the cooked text then maps back onto exactly the raw
 * characters that produced it, and only those are rewritten - escapes and
 * line breaks elsewhere in the literal are left as they were, so the diff a
 * person reviews is the edit they made and nothing else.
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', middot: '\u00b7', bull: '\u2022', copy: '\u00a9', reg: '\u00ae',
  trade: '\u2122', laquo: '\u00ab', raquo: '\u00bb', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  sbquo: '\u201a', bdquo: '\u201e', times: '\u00d7', divide: '\u00f7', deg: '\u00b0', plusmn: '\u00b1', minus: '\u2212',
  para: '\u00b6', sect: '\u00a7', euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2', frac12: '\u00bd',
  frac14: '\u00bc', frac34: '\u00be', sup2: '\u00b2', sup3: '\u00b3', larr: '\u2190', rarr: '\u2192', uarr: '\u2191',
  darr: '\u2193', harr: '\u2194', rArr: '\u21d2', lArr: '\u21d0', hearts: '\u2665', star: '\u2606', check: '\u2713',
  shy: '\u00ad', zwj: '\u200d', zwnj: '\u200c', iexcl: '\u00a1', iquest: '\u00bf', micro: '\u00b5', le: '\u2264', ge: '\u2265',
  ne: '\u2260', asymp: '\u2248', infin: '\u221e', prime: '\u2032', Prime: '\u2033',
}

/** One cooked unit per source token: {value, start, end} with start/end relative to the raw text. */
function entityAt(raw, i) {
  const m = /^&(#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/.exec(raw.slice(i, i + 12))
  if (!m) return null
  const body = m[1]
  let value
  if (body[0] === '#') {
    const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    if (!Number.isFinite(cp) || cp > 0x10ffff) return null
    value = String.fromCodePoint(cp)
  } else {
    value = ENTITIES[body]
    if (value === undefined) return null
  }
  return { value, len: m[0].length }
}

/** Push `value` as cooked text produced by raw[start, end). Multi-unit values share the range. */
function emit(out, value, start, end) {
  for (let k = 0; k < value.length; k++) {
    out.value += value[k]
    out.starts.push(start)
    out.ends.push(end)
  }
}

/** A JS string literal's body (between the quotes), escapes resolved. */
export function cookStringBody(raw, offset = 0) {
  const out = { value: '', starts: [], ends: [] }
  let i = 0
  while (i < raw.length) {
    const c = raw[i]
    if (c !== '\\') {
      emit(out, c, offset + i, offset + i + 1)
      i++
      continue
    }
    const n = raw[i + 1]
    const s = offset + i
    if (n === undefined) break
    const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }
    if (n in simple && !(n === '0' && /[0-9]/.test(raw[i + 2] ?? ''))) {
      emit(out, simple[n], s, s + 2)
      i += 2
    } else if (n === 'x') {
      emit(out, String.fromCharCode(parseInt(raw.slice(i + 2, i + 4), 16)), s, s + 4)
      i += 4
    } else if (n === 'u') {
      if (raw[i + 2] === '{') {
        const close = raw.indexOf('}', i)
        emit(out, String.fromCodePoint(parseInt(raw.slice(i + 3, close), 16)), s, offset + close + 1)
        i = close + 1
      } else {
        emit(out, String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16)), s, s + 6)
        i += 6
      }
    } else if (n === '\r' || n === '\n' || n === '\u2028' || n === '\u2029') {
      // line continuation: produces nothing
      i += n === '\r' && raw[i + 2] === '\n' ? 3 : 2
    } else {
      emit(out, n, s, s + 2)
      i += 2
    }
  }
  return out
}

/**
 * JSX text, cooked the way Babel and the TypeScript compiler cook it:
 * entities decoded, tabs become spaces, each line trimmed where it meets a
 * line break, blank lines dropped, and the surviving lines joined with ONE
 * space. That joining space is not in the source; it is mapped onto the
 * whole whitespace run it replaced, so deleting it deletes the line break.
 */
export function cookJSXText(raw, offset = 0) {
  const units = []
  for (let i = 0; i < raw.length; ) {
    if (raw[i] === '&') {
      const ent = entityAt(raw, i)
      if (ent) {
        units.push({ v: ent.value, s: i, e: i + ent.len, ws: false, nl: false })
        i += ent.len
        continue
      }
    }
    if (raw[i] === '\r' && raw[i + 1] === '\n') {
      units.push({ v: '\n', s: i, e: i + 2, ws: true, nl: true })
      i += 2
      continue
    }
    const c = raw[i]
    units.push({ v: c === '\t' ? ' ' : c, s: i, e: i + 1, ws: c === ' ' || c === '\t', nl: c === '\n' || c === '\r' })
    i++
  }
  const lines = [[]]
  for (const u of units) {
    if (u.nl) lines.push([])
    else lines[lines.length - 1].push(u)
  }
  const last = lines.length - 1
  let lastNonEmpty = -1
  lines.forEach((line, k) => {
    if (line.some((u) => !u.ws)) lastNonEmpty = k
  })
  const out = { value: '', starts: [], ends: [] }
  let pendingJoinFrom = null
  lines.forEach((line, k) => {
    let a = 0
    let b = line.length
    if (k !== 0) while (a < b && line[a].ws) a++
    if (k !== last) while (b > a && line[b - 1].ws) b--
    if (a >= b) return
    if (pendingJoinFrom !== null) {
      emit(out, ' ', offset + pendingJoinFrom, offset + line[a].s)
      pendingJoinFrom = null
    }
    for (let j = a; j < b; j++) emit(out, line[j].v, offset + line[j].s, offset + line[j].e)
    if (k !== lastNonEmpty) pendingJoinFrom = line[b - 1].e
  })
  return out
}

/** A JSX attribute string: entities decoded, nothing else. */
export function cookJSXAttr(raw, offset = 0) {
  const out = { value: '', starts: [], ends: [] }
  for (let i = 0; i < raw.length; ) {
    if (raw[i] === '&') {
      const ent = entityAt(raw, i)
      if (ent) {
        emit(out, ent.value, offset + i, offset + i + ent.len)
        i += ent.len
        continue
      }
    }
    emit(out, raw[i], offset + i, offset + i + 1)
    i++
  }
  return out
}

/**
 * HTML text, cooked the way the browser's parser cooks it into text nodes:
 * entities decoded, a CR LF read as one line feed, and everything else
 * kept as written. The DOM keeps whitespace - CSS only hides it - so unlike
 * JSX nothing is trimmed or joined.
 */
export function cookHTMLText(raw, offset = 0) {
  const out = { value: '', starts: [], ends: [] }
  for (let i = 0; i < raw.length; ) {
    if (raw[i] === '&') {
      const ent = entityAt(raw, i)
      if (ent) {
        emit(out, ent.value, offset + i, offset + i + ent.len)
        i += ent.len
        continue
      }
    }
    if (raw[i] === '\r') {
      const len = raw[i + 1] === '\n' ? 2 : 1
      emit(out, '\n', offset + i, offset + i + len)
      i += len
      continue
    }
    emit(out, raw[i], offset + i, offset + i + 1)
    i++
  }
  return out
}

const RAW_TEXT_TAGS = /^(script|style|textarea|title|template)$/i

/** Every run of text between tags in an HTML file, as entries. Tags, comments and script or style bodies are not page text. */
export function htmlTextEntries(code) {
  const out = []
  const n = code.length
  let runStart = 0
  const flush = (end) => {
    if (end <= runStart) return
    const cooked = cookHTMLText(code.slice(runStart, end), runStart)
    if (cooked.value.trim()) out.push({ kind: 'html', start: runStart, end, ...cooked })
  }
  let i = 0
  while (i < n) {
    const lt = code.indexOf('<', i)
    if (lt < 0) break
    const next = code[lt + 1] ?? ''
    if (code.startsWith('<!--', lt)) {
      flush(lt)
      const e = code.indexOf('-->', lt + 4)
      i = runStart = e < 0 ? n : e + 3
      continue
    }
    if (!/[A-Za-z!/?]/.test(next)) {
      // a '<' that starts no tag is text
      i = lt + 1
      continue
    }
    flush(lt)
    let j = lt + 1
    while (j < n && code[j] !== '>') {
      if (code[j] === '"' || code[j] === "'") {
        const close = code.indexOf(code[j], j + 1)
        j = close < 0 ? n : close
      }
      j++
    }
    const tagEnd = Math.min(n, j + 1)
    const m = /^<([A-Za-z][\w:-]*)/.exec(code.slice(lt, lt + 40))
    if (m && RAW_TEXT_TAGS.test(m[1])) {
      const close = code.toLowerCase().indexOf(`</${m[1].toLowerCase()}`, tagEnd)
      const after = close < 0 ? n : code.indexOf('>', close) + 1 || n
      i = runStart = after
      continue
    }
    i = runStart = tagEnd
  }
  flush(n)
  return out
}

const INVISIBLE = /[\u00a0\u00ad\u200b-\u200f\u2028\u2029\u2060\ufeff]/g

/** Text for an HTML file: markup characters escaped, and the invisible ones written as entities so they can be seen in review. */
const encodeHTMLText = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(INVISIBLE, (c) => `&#${c.codePointAt(0)};`)

/** Template quasi: like a string body, but newlines are literal. */
const cookTemplateBody = (raw, offset) => cookStringBody(raw, offset)

/** Escapes that are valid in both a JS string and a JSON string, so one encoder serves both. */
function encodeString(value, quote) {
  let s = ''
  for (const ch of value) {
    const code = ch.codePointAt(0)
    if (ch === '\\') s += '\\\\'
    else if (ch === quote) s += '\\' + quote
    else if (ch === '\n') s += '\\n'
    else if (ch === '\r') s += '\\r'
    else if (ch === '\t') s += '\\t'
    else if (code < 0x20 || ch === '\u2028' || ch === '\u2029') s += '\\u' + code.toString(16).padStart(4, '0')
    else s += ch
  }
  return s
}

const encodeTemplate = (value) => value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

function encodeJSXText(value) {
  return value
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, '&amp;')
    .replace(/[{}<>]/g, (c) => `{'${c}'}`)
}

const encodeJSXAttr = (value, quote) => value.replace(/&(?=#?[A-Za-z0-9]+;)/g, '&amp;').replace(new RegExp(quote, 'g'), quote === '"' ? '&quot;' : '&apos;')

/**
 * Every text-bearing literal in a file, as entries:
 *   { kind, start, end, value, starts, ends, ...kind-specific }
 * `start`/`end` cover the whole literal (or concatenation); `starts[i]` and
 * `ends[i]` are the raw range of cooked character i.
 */
export function textEntries(code, file) {
  if (/\.html?$/i.test(file)) return htmlTextEntries(code)
  if (!/\.(m?[jt]sx?|cts|json)$/i.test(file)) {
    // markdown, plain text: the file is its own text, character for character
    const starts = Array.from({ length: code.length }, (_, i) => i)
    return [{ kind: 'raw', start: 0, end: code.length, value: code, starts, ends: starts.map((i) => i + 1) }]
  }
  const a = analysed(code, file)
  const out = []
  const inConcat = new Set()

  const stringEntry = (n) => {
    const raw = code.slice(n.start, n.end)
    const quote = raw[0]
    const cooked = cookStringBody(raw.slice(1, -1), n.start + 1)
    return { kind: 'string', start: n.start, end: n.end, quote, ...cooked, bodyStart: n.start + 1, bodyEnd: n.end - 1 }
  }

  walk(a.ast, (node, parent, key) => {
    if (node.type === 'BinaryExpression' && node.operator === '+' && !inConcat.has(node)) {
      const pieces = []
      const binaries = []
      const flatten = (n) => {
        n = unwrap(n)
        if (n.type === 'BinaryExpression' && n.operator === '+') {
          binaries.push(n)
          return flatten(n.left) && flatten(n.right)
        }
        if (n.type === 'StringLiteral') {
          pieces.push(n)
          return true
        }
        return false
      }
      if (flatten(node) && pieces.length > 1) {
        const entry = { kind: 'concat', start: node.start, end: node.end, value: '', starts: [], ends: [], pieces: [] }
        for (const p of pieces) {
          const e = stringEntry(p)
          entry.pieces.push({ ...e, from: entry.value.length })
          entry.value += e.value
          entry.starts.push(...e.starts)
          entry.ends.push(...e.ends)
        }
        out.push(entry)
        binaries.forEach((b) => inConcat.add(b))
        pieces.forEach((p) => inConcat.add(p))
        return false
      }
    }
    if (node.type === 'StringLiteral' && !inConcat.has(node)) {
      if (parent && (parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportAllDeclaration' || parent.type === 'ImportExpression')) return
      if (parent && (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod' || parent.type === 'ClassProperty') && key === 'key') return
      if (parent && parent.type === 'TSLiteralType') return
      if (parent && parent.type === 'JSXAttribute') {
        const raw = code.slice(node.start, node.end)
        const quote = raw[0]
        const cooked = cookJSXAttr(raw.slice(1, -1), node.start + 1)
        out.push({ kind: 'jsxattr', start: node.start, end: node.end, quote, ...cooked, attr: parent.name?.name })
        return
      }
      out.push(stringEntry(node))
    }
    if (node.type === 'TemplateLiteral' && parent?.type !== 'TaggedTemplateExpression') {
      const parts = node.quasis.map((q) => ({ q, cooked: cookTemplateBody(code.slice(q.start, q.end), q.start) }))
      if (node.expressions.length === 0) {
        const c = parts[0].cooked
        out.push({ kind: 'template', start: node.start, end: node.end, ...c, bodyStart: node.start + 1, bodyEnd: node.end - 1 })
      } else {
        for (const { q, cooked } of parts) {
          if (!cooked.value.trim()) continue
          out.push({ kind: 'quasi', partial: true, start: q.start, end: q.end, ...cooked, bodyStart: q.start, bodyEnd: q.end })
        }
      }
    }
    if (node.type === 'JSXText') {
      const raw = code.slice(node.start, node.end)
      const cooked = cookJSXText(raw, node.start)
      if (cooked.value) out.push({ kind: 'jsxtext', start: node.start, end: node.end, ...cooked })
    }
  })
  return out
}

/** Cooked [from, to) of an entry -> the raw range that produced it. */
function rawRange(entry, from, to) {
  const n = entry.value.length
  if (from === to) {
    const at = from < n ? entry.starts[from] : n > 0 ? entry.ends[n - 1] : entry.bodyStart ?? entry.start
    return { start: at, end: at }
  }
  return { start: entry.starts[from], end: entry.ends[to - 1] }
}

/**
 * The splice that turns `entry.value` into
 * `value.slice(0, from) + replacement + value.slice(to)`.
 * Returns { start, end, text } in file offsets.
 */
export function spliceEntry(code, entry, from, to, replacement) {
  if (entry.kind === 'concat') {
    const pieceAt = (i) => [...entry.pieces].reverse().find((p) => p.from <= i) ?? entry.pieces[0]
    const pa = pieceAt(from)
    const pb = pieceAt(Math.max(from, to - 1))
    if (pa === pb) return spliceEntry(code, pa, from - pa.from, to - pa.from, replacement)
    // the change crosses a `' + '` seam: rewrite from the first piece to the
    // last as one literal in the first piece's quote style
    const value = pa.value.slice(0, from - pa.from) + replacement + pb.value.slice(to - pb.from)
    return { start: pa.start, end: pb.end, text: pa.quote + encodeString(value, pa.quote) + pa.quote }
  }
  const r = rawRange(entry, from, to)
  let text
  if (entry.kind === 'string') text = encodeString(replacement, entry.quote)
  else if (entry.kind === 'template' || entry.kind === 'quasi') text = encodeTemplate(replacement)
  else if (entry.kind === 'jsxattr') text = encodeJSXAttr(replacement, entry.quote)
  else if (entry.kind === 'jsxtext') text = encodeJSXText(replacement)
  else if (entry.kind === 'html') text = encodeHTMLText(replacement)
  else if (entry.kind === 'raw') text = replacement
  else throw new Error('unknown entry kind ' + entry.kind)
  return { start: r.start, end: r.end, text }
}

/**
 * Re-cook an entry's region after a splice and say whether it now reads as
 * intended. Guards the JSX whitespace rules in particular: a space typed at
 * the end of a line is trimmed by the compiler, and the save must not claim
 * an edit the page will not show.
 */
export function verifyEntry(newCode, file, entryBefore, splice, expected) {
  const shift = splice.text.length - (splice.end - splice.start)
  const start = entryBefore.start
  const end = entryBefore.end + shift
  const raw = newCode.slice(start, end)
  let value
  if (entryBefore.kind === 'jsxtext') value = cookJSXText(raw).value
  else if (entryBefore.kind === 'string' || entryBefore.kind === 'template') value = cookStringBody(raw.slice(1, -1)).value
  else if (entryBefore.kind === 'jsxattr') value = cookJSXAttr(raw.slice(1, -1)).value
  else if (entryBefore.kind === 'html') value = cookHTMLText(raw).value
  else return true
  return value === expected
}

/** A JSX text rewritten whole, keeping its outer whitespace: the fallback when a minimal splice would be trimmed away. */
export function rewriteJSXText(code, entry, newValue) {
  const raw = code.slice(entry.start, entry.end)
  const lead = /^\s*/.exec(raw)[0]
  const trail = /\s*$/.exec(raw)[0]
  let body = encodeJSXText(newValue)
  if (/^\s/.test(newValue) && lead.includes('\n')) body = `{' '}` + body.replace(/^\s+/, '')
  if (/\s$/.test(newValue) && trail.includes('\n')) body = body.replace(/\s+$/, '') + `{' '}`
  return { start: entry.start, end: entry.end, text: lead + body + trail }
}

/** For the human: a short excerpt of what an entry says. */
export const excerpt = (value, at = 0, span = 60) => {
  const s = Math.max(0, at - 20)
  const t = value.slice(s, s + span)
  return (s > 0 ? '...' : '') + t + (s + span < value.length ? '...' : '')
}
