/**
 * READING HTML FILES AS SOURCE.
 *
 * Some pages are not all JSX: a block of markup kept in an .html file and
 * handed to the page as a string (`dangerouslySetInnerHTML`, `innerHTML`, a
 * template a build script inlines). The browser builds elements from it
 * that React never saw, so they carry no stamp. This reads such a file the
 * way the browser's parser would read it into elements - tags, their
 * attributes with exact offsets, where each element ends - so an element on
 * the page can be found in the file and edited there.
 */

export const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title'])
// an open <p> or <li> is closed by the parser when one of these starts
const AUTO_CLOSE = {
  p: /^(address|article|aside|blockquote|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|table|ul|details|figcaption|menu)$/,
  li: /^li$/,
  dt: /^(dt|dd)$/,
  dd: /^(dt|dd)$/,
  option: /^(option|optgroup)$/,
  tr: /^tr$/,
  td: /^(td|th|tr)$/,
  th: /^(td|th|tr)$/,
}

/** Where the tag starting at `i` (a '<') ends: just after its '>', with quoted attribute values respected. */
export function endOfTag(code, i) {
  let j = i + 1
  while (j < code.length) {
    const c = code[j]
    if (c === '"' || c === "'") {
      const close = code.indexOf(c, j + 1)
      j = close < 0 ? code.length : close + 1
      continue
    }
    if (c === '>') return j + 1
    j++
  }
  return code.length
}

/** The attributes of a start tag, with offsets: [{ name, start, end, value, valueStart, valueEnd, quote }]. */
export function attributesOf(code, tagStart, tagEnd) {
  const out = []
  const nameMatch = /^<[A-Za-z][\w:-]*/.exec(code.slice(tagStart, Math.min(tagEnd, tagStart + 80)))
  let j = tagStart + (nameMatch ? nameMatch[0].length : 1)
  const stop = code[tagEnd - 2] === '/' ? tagEnd - 2 : tagEnd - 1
  while (j < stop) {
    while (j < stop && /[\s/]/.test(code[j])) j++
    if (j >= stop) break
    const s = j
    while (j < stop && !/[\s=>/]/.test(code[j])) j++
    const name = code.slice(s, j)
    let k = j
    while (k < stop && /\s/.test(code[k])) k++
    if (code[k] !== '=') {
      out.push({ name, start: s, end: j, value: '', valueStart: j, valueEnd: j, quote: null })
      continue
    }
    k++
    while (k < stop && /\s/.test(code[k])) k++
    const q = code[k]
    if (q === '"' || q === "'") {
      const close = code.indexOf(q, k + 1)
      const ve = close < 0 ? stop : close
      out.push({ name, start: s, end: ve + 1, value: code.slice(k + 1, ve), valueStart: k + 1, valueEnd: ve, quote: q })
      j = ve + 1
    } else {
      const vs = k
      while (k < stop && !/[\s>]/.test(code[k])) k++
      out.push({ name, start: s, end: k, value: code.slice(vs, k), valueStart: vs, valueEnd: k, quote: null })
      j = k
    }
  }
  return out
}

/**
 * Every element in an HTML text, in document order:
 *   { tag, start, tagEnd, end, attrs, parent, depth, classes, id }
 * `end` is just after its closing tag, or where the parser would have
 * closed it. Comments, doctypes and the bodies of <script>/<style> are
 * stepped over.
 */
export function htmlElements(code) {
  const els = []
  const open = []
  const n = code.length
  let i = 0
  const close = (k, at) => {
    while (open.length > k) els[open.pop()].end = at
  }
  while (i < n) {
    const lt = code.indexOf('<', i)
    if (lt < 0) break
    if (code.startsWith('<!--', lt)) {
      const e = code.indexOf('-->', lt + 4)
      i = e < 0 ? n : e + 3
      continue
    }
    if (code[lt + 1] === '!' || code[lt + 1] === '?') {
      i = endOfTag(code, lt)
      continue
    }
    if (code[lt + 1] === '/') {
      const m = /^<\/([A-Za-z][\w:-]*)/.exec(code.slice(lt, lt + 60))
      const end = endOfTag(code, lt)
      if (m) {
        const tag = m[1].toLowerCase()
        for (let k = open.length - 1; k >= 0; k--) {
          if (els[open[k]].tag === tag) {
            close(k + 1, lt)
            els[open.pop()].end = end
            break
          }
        }
      }
      i = end
      continue
    }
    const m = /^<([A-Za-z][\w:-]*)/.exec(code.slice(lt, lt + 60))
    if (!m) {
      i = lt + 1
      continue
    }
    const tag = m[1].toLowerCase()
    const tagEnd = endOfTag(code, lt)
    // a start tag that ends an open <p>, <li>... the way the parser does
    for (let k = open.length - 1; k >= 0; k--) {
      const rule = AUTO_CLOSE[els[open[k]].tag]
      if (rule && rule.test(tag)) {
        close(k, lt)
        break
      }
      if (/^(div|section|article|ul|ol|table|body|main)$/.test(els[open[k]].tag)) break
    }
    const attrs = attributesOf(code, lt, tagEnd)
    const cls = attrs.find((a) => a.name.toLowerCase() === 'class')?.value ?? ''
    const el = {
      tag,
      start: lt,
      tagEnd,
      end: tagEnd,
      attrs,
      parent: open.length ? open[open.length - 1] : -1,
      depth: open.length,
      classes: cls.split(/\s+/).filter(Boolean),
      id: attrs.find((a) => a.name.toLowerCase() === 'id')?.value ?? '',
    }
    const idx = els.push(el) - 1
    const selfClosing = code[tagEnd - 2] === '/'
    if (RAW_TEXT.has(tag)) {
      const closeAt = code.toLowerCase().indexOf(`</${tag}`, tagEnd)
      el.end = closeAt < 0 ? n : endOfTag(code, closeAt)
      i = el.end
      continue
    }
    if (!VOID.has(tag) && !selfClosing) open.push(idx)
    i = tagEnd
  }
  close(0, n)
  return els
}

const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")

/** An element's text as the page would show it, whitespace collapsed: what a person can recognise it by. */
export function textOf(code, el, max = 120) {
  const inner = code.slice(el.tagEnd, el.end)
  return decode(inner.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ''))
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()
    .slice(0, max)
}

/**
 * Find a page element in an HTML file by what the page can tell about it:
 * its tag, id and classes, the start of its text, the signatures of the
 * elements around it, and which of its look-alikes it is. Returns every
 * candidate with a score; the caller decides whether the best is clear.
 */
export function locateElement(code, els, want) {
  const sameClasses = (a, b) => a.length === b.length && a.every((c) => b.includes(c))
  const sig = (e) => `${e.tag}#${e.id}.${[...e.classes].sort().join('.')}`
  const wantSig = `${want.tag}#${want.id ?? ''}.${[...(want.classes ?? [])].sort().join('.')}`
  const out = []
  const looksAlike = els.filter((e) => e.tag === want.tag && (e.id ?? '') === (want.id ?? '') && sameClasses(e.classes, want.classes ?? []))
  looksAlike.forEach((e, nth) => {
    let score = 1
    const text = textOf(code, e, 200)
    const hint = (want.text ?? '').replace(/[\s\u00a0]+/g, ' ').trim()
    if (hint) {
      if (text === hint) score += 6
      else if (text.startsWith(hint.slice(0, 40)) || hint.startsWith(text.slice(0, 40))) score += 4
      else if (text && hint && (text.includes(hint.slice(0, 24)) || hint.includes(text.slice(0, 24)))) score += 2
      else score -= 2
    }
    // the elements around it
    let p = e.parent
    for (const anc of want.ancestors ?? []) {
      if (p < 0) break
      const pe = els[p]
      if (sig(pe) === anc) score += 1
      p = pe.parent
    }
    if (want.nth != null && nth === want.nth) score += 0.5
    out.push({ el: e, score, sig: wantSig })
  })
  return out.sort((a, b) => b.score - a.score)
}

/**
 * The splice that sets CSS properties in an element's style attribute,
 * creating the attribute if there is none. `props` maps a CSS property
 * name (kebab-case) to a value, or to null to remove it.
 */
export function styleAttributeSplice(code, el, props) {
  const attr = el.attrs.find((a) => a.name.toLowerCase() === 'style')
  const decls = []
  if (attr) {
    for (const part of attr.value.split(';')) {
      const c = part.indexOf(':')
      if (c < 0) continue
      decls.push([part.slice(0, c).trim(), part.slice(c + 1).trim()])
    }
  }
  for (const [k, v] of Object.entries(props)) {
    const at = decls.findIndex(([name]) => name.toLowerCase() === k)
    if (v == null) {
      if (at >= 0) decls.splice(at, 1)
    } else if (at >= 0) decls[at][1] = v
    else decls.push([k, v])
  }
  const value = decls.map(([k, v]) => `${k}: ${v}`).join('; ')
  const q = attr?.quote ?? '"'
  const safe = value.replace(new RegExp(q, 'g'), q === '"' ? '&quot;' : '&#39;')
  if (attr) {
    if (!value) {
      // drop the attribute and the space before it
      let s = attr.start
      while (s > 0 && /[ \t]/.test(code[s - 1])) s--
      return { start: s, end: attr.end, text: '' }
    }
    return attr.quote ? { start: attr.valueStart, end: attr.valueEnd, text: safe } : { start: attr.start, end: attr.end, text: `style="${safe}"` }
  }
  if (!value) return null
  const at = code[el.tagEnd - 2] === '/' ? el.tagEnd - 2 : el.tagEnd - 1
  return { start: at, end: at, text: ` style="${safe}"` }
}

/** The splice that removes an element, with the indentation and line break it stood on when it had a line of its own. */
export function removeElementSplice(code, el) {
  let s = el.start
  let e = el.end
  let ls = s
  while (ls > 0 && /[ \t]/.test(code[ls - 1])) ls--
  let le = e
  while (le < code.length && /[ \t]/.test(code[le])) le++
  const ownLine = (ls === 0 || code[ls - 1] === '\n') && (le >= code.length || code[le] === '\n' || code[le] === '\r')
  if (ownLine) {
    s = ls
    e = code[le] === '\r' && code[le + 1] === '\n' ? le + 2 : le < code.length ? le + 1 : le
  }
  return { start: s, end: e, text: '' }
}
