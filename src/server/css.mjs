/**
 * READING CSS WITHOUT A CSS PARSER.
 *
 * Enough of CSS to find things in it: every rule with its selector and its
 * declarations, what at-rules it sits inside, and every @keyframes by name,
 * all with exact offsets into the text. Comments and strings are respected
 * and nesting is followed (CSS nesting, and @media inside a rule). Nothing
 * is validated: a stylesheet the browser accepts is read, and one it would
 * reject is read as far as it makes sense.
 */

const STYLE_AT = new Set(['font-face', 'page', 'property', 'counter-style', 'font-palette-values', 'view-transition', 'position-try'])

/**
 * {
 *   rules: [{ selector, chain, selStart, selEnd, start, end, at, keyframes, decls }],
 *   decls: [{ prop, start, end, valueStart, valueEnd, value, rule }],   every declaration, rule or not
 *   keyframes: [{ name, start, end }],
 * }
 * `chain` is the selectors from the outermost enclosing rule to this one,
 * as a nested rule's own selector is relative to its parent's.
 */
export function parseCss(code, offset = 0) {
  const rules = []
  const decls = []
  const keyframes = []
  const n = code.length

  const endComment = (i) => {
    const e = code.indexOf('*/', i + 2)
    return e < 0 ? n : e + 2
  }
  const endString = (i) => {
    const q = code[i]
    let j = i + 1
    while (j < n && code[j] !== q && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
    return Math.min(n, j + 1)
  }
  const skip = (i) => {
    for (;;) {
      while (i < n && /\s/.test(code[i])) i++
      if (code.startsWith('/*', i)) i = endComment(i)
      else return i
    }
  }
  /** To the first top-level { ; or } from i. */
  const prelude = (i) => {
    let depth = 0
    while (i < n) {
      const c = code[i]
      if (c === '/' && code[i + 1] === '*') i = endComment(i)
      else if (c === '"' || c === "'") i = endString(i)
      else if (c === '\\') i += 2
      else {
        if (c === '(' || c === '[') depth++
        else if ((c === ')' || c === ']') && depth > 0) depth--
        else if (depth === 0 && (c === '{' || c === ';' || c === '}')) return { end: i, stop: c }
        i++
      }
    }
    return { end: n, stop: null }
  }
  const trimEnd = (s, e) => {
    while (e > s && /\s/.test(code[e - 1])) e--
    return e
  }

  /** A block's body from i (just after its brace). kind: 'rules' | 'style' | 'keyframes'. Returns the offset after its closing brace. */
  function block(i, kind, ctx) {
    for (;;) {
      i = skip(i)
      if (i >= n) return n
      if (code[i] === '}') return i + 1
      if (code[i] === ';') {
        i++
        continue
      }
      const start = i
      const p = prelude(i)
      const headEnd = trimEnd(start, p.end)
      const head = code.slice(start, headEnd)
      if (p.stop === '{') {
        const inner = p.end + 1
        if (head.startsWith('@')) {
          const m = /^@(?:-[a-z]+-)?([\w-]+)\s*([\s\S]*)$/i.exec(head)
          const name = (m?.[1] ?? '').toLowerCase()
          if (name === 'keyframes') {
            const kfName = (m[2] ?? '').trim().replace(/^["']|["']$/g, '')
            const end = block(inner, 'keyframes', { ...ctx, keyframes: kfName })
            keyframes.push({ name: kfName, start: start + offset, end: end + offset })
            i = end
          } else if (STYLE_AT.has(name)) {
            const rule = { selector: head, chain: [head], selStart: start + offset, selEnd: headEnd + offset, start: start + offset, end: 0, at: ctx.at, keyframes: null, decls: [] }
            rules.push(rule)
            i = block(inner, 'style', { ...ctx, rule })
            rule.end = i + offset
          } else {
            // @media, @supports, @layer, @container, @scope: inside a rule, their body is more of that rule
            i = block(inner, kind === 'style' ? 'style' : kind, { ...ctx, at: [...ctx.at, head] })
          }
        } else {
          const rule = {
            selector: head,
            chain: [...(ctx.rule?.chain ?? []), head],
            selStart: start + offset,
            selEnd: headEnd + offset,
            start: start + offset,
            end: 0,
            at: ctx.at,
            keyframes: kind === 'keyframes' ? ctx.keyframes : ctx.rule?.keyframes ?? null,
            decls: [],
          }
          rules.push(rule)
          i = block(inner, 'style', { ...ctx, rule })
          rule.end = i + offset
        }
        continue
      }
      // a declaration, or a statement at-rule (@import) between rules
      if (!head.startsWith('@')) {
        const colon = head.indexOf(':')
        if (colon > 0) {
          const prop = head.slice(0, colon).trim()
          let vs = start + colon + 1
          while (vs < headEnd && /\s/.test(code[vs])) vs++
          const d = { prop, start: start + offset, end: headEnd + offset, valueStart: vs + offset, valueEnd: headEnd + offset, value: code.slice(vs, headEnd), rule: ctx.rule ?? null }
          decls.push(d)
          ctx.rule?.decls.push(d)
        }
      }
      if (p.stop === null) return n
      i = p.stop === ';' ? p.end + 1 : p.end
    }
  }

  block(0, 'rules', { at: [], rule: null, keyframes: null })
  return { rules, decls, keyframes }
}

/**
 * A selector as browsers serialise it, near enough to compare one read
 * from a file with one read from the CSSOM: comments gone, whitespace
 * collapsed, none around combinators and commas, attribute values quoted
 * with double quotes, the legacy one-colon pseudo-elements given two.
 */
export function normSelector(s) {
  return String(s ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*([>+~,])\s*/g, '$1')
    .replace(/'/g, '"')
    .replace(/\[\s*([\w-]+)\s*([~|^$*]?=)\s*([^"\]\s]+)\s*\]/g, '[$1$2"$3"]')
    .replace(/(^|[^:]):(before|after|first-line|first-letter)\b/g, '$1::$2')
}

/** The rules in a parsed sheet whose selector chain is `chain` (outermost first). */
export function findRules(parsed, chain) {
  const want = chain.map(normSelector)
  return parsed.rules.filter((r) => r.chain.length === want.length && r.chain.every((s, k) => normSelector(s) === want[k]))
}
