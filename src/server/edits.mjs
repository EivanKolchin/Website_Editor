import { attr, elementName, findProperty, indentAt, keyName, lineEnd, lineStart, newlineOf, onlySpace, unwrap } from './ast.mjs'
import { fmt, RetouchError, tidyNumber } from './util.mjs'

/**
 * SPLICES: the only thing that ever touches a source file.
 *
 * Every edit is a list of { a, start, end, text } against one analysed text
 * (`a.code`), computed without changing anything. save.mjs relocates them
 * onto the file as it is now, refuses any that collide, applies them in one
 * pass and checks the result still parses before a byte is written. So each
 * function here only has to answer one question - which characters, replaced
 * by what - and never has to worry about the file moving under it.
 */

const sp = (a, start, end, text) => ({ a, file: a.file, basis: a.code, start, end, text })

/* ------------------------------------------------------------------ */
/*  numbers                                                             */
/* ------------------------------------------------------------------ */

const LOOSE_FOR_ADD = new Set(['ConditionalExpression', 'LogicalExpression', 'AssignmentExpression', 'SequenceExpression', 'ArrowFunctionExpression', 'YieldExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'FunctionExpression'])
const TIGHT_BINARY = new Set(['+', '-', '*', '/', '%', '**'])

function needsParens(node, forMul) {
  const n = node
  if (LOOSE_FOR_ADD.has(n.type)) return true
  if (n.type === 'BinaryExpression') {
    if (!TIGHT_BINARY.has(n.operator)) return true
    if (forMul && (n.operator === '+' || n.operator === '-')) return true
  }
  return false
}

const literalValue = (n) => (n.type === 'UnaryExpression' ? -n.argument.value : n.value)
const literalRaw = (a, n) => a.code.slice(n.type === 'UnaryExpression' ? n.argument.start : n.start, n.end)

const signed = (v) => (v < 0 ? ` - ${fmt(-v)}` : ` + ${fmt(v)}`)

/**
 * A new value at the precision the old one was written in - a whole number
 * stays whole - unless that rounding is visible: a size scaled to a whole
 * number can be off by more than half a percent on a small element, and
 * then it keeps a decimal.
 */
function rounded(old, op, like) {
  const exact = op.add != null ? old + op.add : old * op.mul
  // a position written as a whole number stays one: a half-unit wobble
  // from a drag is noise, not an edit worth a decimal in the source
  if (op.add != null && Number.isInteger(old) && !String(like).includes('.')) return Math.round(exact)
  const next = tidyNumber(exact, like)
  if (op.mul != null && Math.abs(next - exact) > Math.abs(exact) * 0.005) return Number(exact.toFixed(1))
  return next
}

/**
 * Write `op` ({ add } or { mul }) at a value site.
 * A literal is rewritten in place; an expression that already ends in a
 * `+ n` / `- n` / `* n` has that number adjusted; anything else gains one.
 */
export function numericSplices(site, op, propName) {
  const a = site.a
  if (site.kind === 'literal') {
    const old = literalValue(site.node)
    const raw = literalRaw(a, site.node)
    return [sp(a, site.node.start, site.node.end, String(rounded(old, op, raw.includes('.') ? raw : Math.round(old))))]
  }
  if (site.kind === 'string-number') {
    const old = Number(site.node.value)
    const q = a.code[site.node.start]
    return [sp(a, site.node.start, site.node.end, q + String(rounded(old, op, site.node.value)) + q)]
  }
  if (site.kind === 'shorthand') {
    const name = keyName(site.prop)
    const value = op.add != null ? `${name}${signed(op.add)}` : `${name} * ${fmt(op.mul)}`
    return [sp(a, site.prop.start, site.prop.end, `${name}: ${value}`)]
  }
  if (site.kind === 'missing') {
    if (op.add == null) throw new RetouchError(`${propName} is not set, so it cannot be scaled`)
    return [addAttribute(a, site.el, `${propName}={${fmt(op.add)}}`)]
  }
  if (site.kind === 'expr') {
    const node = site.node
    const n = unwrap(node)
    if (op.add != null) {
      if (n.type === 'BinaryExpression' && (n.operator === '+' || n.operator === '-') && n.right.type === 'NumericLiteral') {
        const total = (n.operator === '+' ? 1 : -1) * n.right.value + op.add
        const text = Math.abs(total) < 1e-9 ? '' : signed(Number(total.toFixed(2)))
        return [sp(a, n.left.end, n.end, text)]
      }
      const src = a.code.slice(node.start, node.end)
      return [sp(a, node.start, node.end, (needsParens(n, false) ? `(${src})` : src) + signed(op.add))]
    }
    if (n.type === 'BinaryExpression' && n.operator === '*' && n.right.type === 'NumericLiteral') {
      const total = n.right.value * op.mul
      return [sp(a, n.left.end, n.end, Math.abs(total - 1) < 1e-9 ? '' : ` * ${fmt(total)}`)]
    }
    const src = a.code.slice(node.start, node.end)
    return [sp(a, node.start, node.end, `${needsParens(n, true) ? `(${src})` : src} * ${fmt(op.mul)}`)]
  }
  throw new RetouchError(`${propName ?? 'that value'} cannot be edited here`)
}

/* ------------------------------------------------------------------ */
/*  removal                                                            */
/* ------------------------------------------------------------------ */

/** Remove a JSX child, taking its whole line(s) when it stands alone on them. */
function removeChild(a, node) {
  const code = a.code
  const ls = lineStart(code, node.start)
  const le = lineEnd(code, node.end)
  const before = code.slice(ls, node.start)
  const after = code.slice(node.end, le).replace(/\r?\n$/, '')
  if (onlySpace(before) && onlySpace(after)) return [sp(a, ls, le, '')]
  return [sp(a, node.start, node.end, '')]
}

/**
 * Delete a JSX element from wherever it is written, leaving valid code:
 * a child is removed outright (and `{cond && <X/>}` with it), an element in
 * an array loses its slot, and an element in any other expression position
 * becomes `null`, which renders nothing everywhere React accepts a node.
 */
export function deleteElementSplices(a, el) {
  const parent = a.parents.get(el)
  const key = a.keys.get(el)
  const isChildOf = (n) => n && (n.type === 'JSXElement' || n.type === 'JSXFragment')
  if (isChildOf(parent)) return removeChild(a, el)
  if (parent?.type === 'JSXExpressionContainer') {
    const gp = a.parents.get(parent)
    if (isChildOf(gp)) return removeChild(a, parent)
    return [sp(a, el.start, el.end, 'null')]
  }
  if (parent?.type === 'LogicalExpression' && parent.operator === '&&' && key === 'right') {
    const gp = a.parents.get(parent)
    if (gp?.type === 'JSXExpressionContainer' && isChildOf(a.parents.get(gp))) return removeChild(a, gp)
  }
  if (parent?.type === 'ArrayExpression') return removeArrayEntrySplices(a, parent, parent.elements.indexOf(el))
  return [sp(a, el.start, el.end, 'null')]
}

/** Remove entry `index` of an array literal, with its comma, and its line when it has one to itself. */
export function removeArrayEntrySplices(a, arr, index) {
  const code = a.code
  const el = arr.elements[index]
  if (!el) throw new RetouchError('That entry is no longer in the list.')
  const prev = arr.elements[index - 1]
  const next = arr.elements[index + 1]
  let comma = el.end
  while (comma < code.length && /[ \t]/.test(code[comma])) comma++
  const commaEnd = code[comma] === ',' ? comma + 1 : null
  const ls = lineStart(code, el.start)
  if (onlySpace(code.slice(ls, el.start))) {
    const endAt = commaEnd ?? el.end
    const le = lineEnd(code, endAt)
    const rest = code.slice(endAt, le).replace(/\r?\n$/, '')
    if (onlySpace(rest) || /^\s*\/\/.*$/.test(rest)) return [sp(a, ls, le, '')]
  }
  if (next) return [sp(a, el.start, next.start, '')]
  if (prev) return [sp(a, prev.end, commaEnd ?? el.end, commaEnd ? ',' : '')]
  return [sp(a, el.start, commaEnd ?? el.end, '')]
}

/* ------------------------------------------------------------------ */
/*  attributes, style, wrappers                                        */
/* ------------------------------------------------------------------ */

const afterName = (el) => {
  const open = el.openingElement
  return (open.typeArguments ?? open.typeParameters)?.end ?? open.name.end
}

/**
 * A new attribute goes where a person would have typed it: after the last
 * one, on its own line when the element already lists one per line.
 */
function addAttribute(a, el, text) {
  const code = a.code
  const attrs = el.openingElement.attributes
  if (!attrs.length) {
    const pos = afterName(el)
    return sp(a, pos, pos, ' ' + text)
  }
  const last = attrs[attrs.length - 1]
  if (lineStart(code, last.start) !== lineStart(code, el.openingElement.start)) {
    return sp(a, last.end, last.end, newlineOf(code) + indentAt(code, last.start) + text)
  }
  return sp(a, last.end, last.end, ' ' + text)
}

/** Set an attribute to a JS expression (`delay={0.4}`), replacing whatever value it had. */
export function setAttrExprSplices(a, el, name, expr) {
  if (/[\n\r]/.test(expr)) throw new RetouchError('That value cannot be written as an attribute.')
  const at = attr(el, name)
  if (at?.value) return [sp(a, at.value.start, at.value.end, `{${expr}}`)]
  if (at) return [sp(a, at.end, at.end, `={${expr}}`)]
  return [addAttribute(a, el, `${name}={${expr}}`)]
}

/** Set a plain string attribute (`fill="#fff"`), replacing whatever value it had. */
export function setAttrSplices(a, el, name, value) {
  if (/["\n\r]/.test(value)) throw new RetouchError('That value cannot be written as an attribute.')
  const at = attr(el, name)
  if (at?.value) return [sp(a, at.value.start, at.value.end, `"${value}"`)]
  if (at) return [sp(a, at.end, at.end, `="${value}"`)]
  return [addAttribute(a, el, `${name}="${value}"`)]
}

/** Remove one property of an object literal, with the comma that separated it. */
function removeProperty(a, obj, prop) {
  const props = obj.properties
  const i = props.indexOf(prop)
  if (i < props.length - 1) {
    const ls = lineStart(a.code, prop.start)
    if (onlySpace(a.code.slice(ls, prop.start)) && lineStart(a.code, props[i + 1].start) !== ls) {
      return [sp(a, ls, lineStart(a.code, props[i + 1].start), '')]
    }
    return [sp(a, prop.start, props[i + 1].start, '')]
  }
  if (i > 0) return [sp(a, props[i - 1].end, prop.end, '')]
  return [sp(a, prop.start, prop.end, '')]
}

/**
 * Merge CSS properties into an element's `style` prop. `props` maps a
 * camelCase key to JS source for its value, or to null to remove it.
 * An object literal is edited in place, in its own layout; an expression
 * is spread into a new literal; no style prop gains one.
 */
export function styleSplices(a, el, props) {
  const code = a.code
  const entries = Object.entries(props)
  const setting = entries.filter(([, v]) => v != null)
  const st = attr(el, 'style')
  if (!st) {
    if (!setting.length) return []
    return [addAttribute(a, el, `style={{ ${setting.map(([k, v]) => `${k}: ${v}`).join(', ')} }}`)]
  }
  if (st.value?.type !== 'JSXExpressionContainer') throw new RetouchError('This element has a style prop Retouch cannot read.')
  const ex = unwrap(st.value.expression)
  if (ex.type !== 'ObjectExpression') {
    if (!setting.length) return []
    const src = code.slice(st.value.expression.start, st.value.expression.end)
    return [sp(a, st.value.expression.start, st.value.expression.end, `{ ...${src}, ${setting.map(([k, v]) => `${k}: ${v}`).join(', ')} }`)]
  }
  const out = []
  const adding = []
  for (const [k, v] of entries) {
    const prop = findProperty(ex, k)
    if (prop) {
      if (v == null) out.push(...removeProperty(a, ex, prop))
      else if (prop.shorthand) out.push(sp(a, prop.start, prop.end, `${k}: ${v}`))
      else out.push(sp(a, prop.value.start, prop.value.end, v))
    } else if (v != null) adding.push(`${k}: ${v}`)
  }
  if (adding.length) {
    const props = ex.properties
    if (!props.length) out.push(sp(a, ex.start + 1, ex.end - 1, ` ${adding.join(', ')} `))
    else {
      const last = props[props.length - 1]
      let k = last.end
      while (k < ex.end && /\s/.test(code[k])) k++
      const trailingComma = code[k] === ','
      const multiline = lineStart(code, last.start) !== lineStart(code, ex.start)
      if (multiline) {
        const nl = newlineOf(code)
        const ind = indentAt(code, last.start)
        const at = trailingComma ? k + 1 : last.end
        out.push(sp(a, at, at, (trailingComma ? '' : ',') + adding.map((p) => `${nl}${ind}${p}`).join(',') + (trailingComma ? ',' : '')))
      } else out.push(sp(a, last.end, last.end, `, ${adding.join(', ')}`))
    }
  }
  return out
}

/**
 * Put an SVG element inside `<g transform="...">`, or extend the transform
 * of the wrapper a previous save gave it. A wrapper is the right tool in
 * SVG: a group lays nothing out, so it can carry a rotation or a flip without
 * disturbing anything, and it never fights the element's own `transform`,
 * which may be rewritten every frame by an animation.
 */
export function wrapperSplices(a, el, transform) {
  if (!/^[a-z0-9 .,()\-]+$/i.test(transform)) throw new RetouchError('Invalid transform.')
  const code = a.code
  const parent = a.parents.get(el)
  if (parent?.type === 'JSXElement' && elementName(parent) === 'g') {
    const attrs = parent.openingElement.attributes
    const only = attrs.length === 1 && attrs[0].type === 'JSXAttribute' && attrs[0].name.name === 'transform' && attrs[0].value?.type === 'StringLiteral'
    const kids = parent.children.filter((c) => !(c.type === 'JSXText' && !c.value.trim()))
    if (only && kids.length === 1 && kids[0] === el) {
      const v = attrs[0].value
      return [sp(a, v.start, v.end, `"${v.value} ${transform}"`)]
    }
  }
  const out = []
  let keyText = ''
  const key = attr(el, 'key')
  if (key) {
    keyText = ' ' + code.slice(key.start, key.end)
    let k = key.start
    while (k > 0 && /[ \t]/.test(code[k - 1])) k--
    out.push(sp(a, k, key.end, ''))
  }
  out.push(sp(a, el.start, el.start, `<g${keyText} transform="${transform}">`))
  out.push(sp(a, el.end, el.end, '</g>'))
  return out
}

/** CSS values the client may ask for, and nothing else: these strings are written into code. */
const balanced = (v) => {
  let depth = 0
  for (const c of v) {
    if (c === '(') depth++
    else if (c === ')' && --depth < 0) return false
  }
  return depth === 0
}

export const SAFE = {
  css: (v) => typeof v === 'string' && /^[-+0-9. a-z%]*$/i.test(v) && v.length < 80,
  // any single CSS value: nothing that could end the declaration, the rule or the string it is written into
  style: (v) =>
    typeof v === 'string' &&
    v.length < 240 &&
    !/[;{}<>\\\n\r`]|\/\*|url\s*\(|expression\s*\(|javascript:/i.test(v) &&
    (v.match(/"/g) ?? []).length % 2 === 0 &&
    (v.match(/'/g) ?? []).length % 2 === 0 &&
    balanced(v),
  color: (v) => typeof v === 'string' && v.length < 80 && /^(#[0-9a-f]{3,8}|var\(--[\w-]+\)|(rgb|rgba|hsl|hsla|oklch|oklab)\([-\d.,%\s/a-z]+\)|transparent|currentColor|[a-z]+)$/i.test(v.trim()),
}
