import { attr, indentAt, lineStart, newlineOf, walk } from './ast.mjs'
import { VOID } from './html.mjs'
import { RetouchError } from './util.mjs'

/**
 * NEW ELEMENTS: a text element added beside or inside another, and a copy
 * of an element pasted beside another. Both are written as source, in the
 * file and the indentation of the element they go next to, and both are
 * refused where the result would not be valid code: beside something that
 * is not one of a list of children, inside something that closes itself,
 * or a copy carrying values of a component it would be pasted out of.
 *
 * Nothing here is clever about layout. A new element takes its place in
 * the flow, the way a person typing it in would put it.
 */

const TAG = /^[a-z][a-z0-9-]{0,30}$/
const CLASS = /^[\w\s:/.[\]%#()!,=-]{0,300}$/
const MAX_TEXT = 2000

/** Words as JSX text: braces and angle brackets would be read as code, so such text is written as a string. */
const jsxText = (s) => (/[{}<>]/.test(s) ? `{${JSON.stringify(s)}}` : s)
const htmlText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The class a target element is written with, when it is written as plain text. */
export function writtenClass(a, el) {
  const at = attr(el, 'className') ?? attr(el, 'class')
  const v = at?.value
  if (!v) return ''
  if (v.type === 'StringLiteral') return v.value
  if (v.type === 'JSXExpressionContainer' && v.expression.type === 'StringLiteral') return v.expression.value
  if (v.type === 'JSXExpressionContainer' && v.expression.type === 'TemplateLiteral' && !v.expression.expressions.length) return v.expression.quasis[0].value.cooked ?? ''
  return ''
}

/** `<p class="...">words</p>`, as JSX or as HTML. */
export function newElementMarkup({ tag = 'p', className = '', text = 'New text' } = {}, { jsx }) {
  tag = String(tag).toLowerCase()
  if (!TAG.test(tag) || VOID.has(tag)) throw new RetouchError(`"${tag}" is not a tag Retouch can add text in.`)
  const cls = String(className ?? '').trim().replace(/\s+/g, ' ')
  if (!CLASS.test(cls) || /["'`{}<>\\]/.test(cls)) throw new RetouchError('That class cannot be written.')
  const words = String(text ?? '').replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT) || 'New text'
  const attrText = cls ? ` ${jsx ? 'className' : 'class'}="${cls}"` : ''
  return `<${tag}${attrText}>${jsx ? jsxText(words) : htmlText(words)}</${tag}>`
}

/** A snippet moved to a new indentation: its first line goes where it is put, the rest keep their shape. */
function reindent(snippet, from, to, nl) {
  const lines = snippet.split(/\r?\n/)
  return lines.map((l, i) => (i === 0 ? l : (l.startsWith(from) ? to + l.slice(from.length) : l))).join(nl)
}

const ownLine = (code, at) => /^[ \t]*$/.test(code.slice(lineStart(code, at), at))
/** One step of indentation as this file writes it: tabs, or the smallest step of spaces any line takes. */
function unitOf(code) {
  let tabs = 0
  let spaces = 0
  let least = 8
  for (const m of code.matchAll(/\n([ \t]+)\S/g)) {
    if (m[1][0] === '\t') tabs++
    else {
      spaces++
      least = Math.min(least, m[1].length)
    }
  }
  return tabs > spaces ? '\t' : ' '.repeat(Math.max(1, least))
}

/** Where to write `text` so it sits after `node` on a line of its own, or right after it inline. */
function after(code, node, markup, base = '') {
  const nl = newlineOf(code)
  if (!ownLine(code, node.start)) return { start: node.end, end: node.end, text: markup }
  const ind = indentAt(code, node.start)
  return { start: node.end, end: node.end, text: `${nl}${ind}${reindent(markup, base, ind, nl)}` }
}

/**
 * Where to write `text` so it is the last thing inside, before the closing
 * tag at `close`: at the indentation of the children already there (`kid`,
 * the start of the last one on a line of its own), or one step in.
 */
function atEnd(code, close, markup, base = '', kid = null) {
  const nl = newlineOf(code)
  if (!ownLine(code, close)) return { start: close, end: close, text: markup }
  const ind = kid != null && ownLine(code, kid) ? indentAt(code, kid) : indentAt(code, close) + unitOf(code)
  const ls = lineStart(code, close)
  return { start: ls, end: ls, text: `${ind}${reindent(markup, base, ind, nl)}${nl}` }
}

const isChildOf = (n) => n && (n.type === 'JSXElement' || n.type === 'JSXFragment')

/**
 * Beside a JSX element (`after`) or inside it at the end (`end`). Beside is
 * only possible among children: a component's root, a `.map` callback's
 * result or a prop value has nowhere for a sibling to go.
 */
export function jsxInsertSplice(a, el, markup, where, base = '') {
  const code = a.code
  if (where === 'end') {
    if (!el.closingElement) throw new RetouchError('This element closes itself, so nothing can go inside it. Add it beside it instead.', { code: 'place' })
    const kids = el.children.filter((c) => !(c.type === 'JSXText' && !c.value.trim()))
    return atEnd(code, el.closingElement.start, markup, base, kids.length ? kids[kids.length - 1].start : null)
  }
  let node = el
  let parent = a.parents.get(node)
  // `{show && <X/>}`: beside the whole condition
  if (parent?.type === 'LogicalExpression' && a.keys.get(node) === 'right') {
    node = parent
    parent = a.parents.get(node)
  }
  if (parent?.type === 'JSXExpressionContainer' && isChildOf(a.parents.get(parent))) {
    node = parent
    parent = a.parents.get(node)
  }
  if (!isChildOf(parent)) throw new RetouchError('Nothing can go beside this: it is not one of a list of children (it is what a component or a list returns). Select what holds it and add it inside that.', { code: 'place' })
  return after(code, node, markup, base)
}

/** Beside an element of an HTML file, or inside it before its closing tag. `els` is the file's elements, for its children. */
export function htmlInsertSplice(code, el, markup, where, base = '', els = []) {
  if (where === 'end') {
    const close = code.lastIndexOf('</', el.end - 1)
    if (VOID.has(el.tag) || close < el.tagEnd || code.slice(close + 2, close + 2 + el.tag.length).toLowerCase() !== el.tag) {
      throw new RetouchError('This element has no closing tag to put anything before. Add it beside it instead.', { code: 'place' })
    }
    const at = els.indexOf(el)
    const kids = at >= 0 ? els.filter((e) => e.parent === at) : []
    return atEnd(code, close, markup, base, kids.length ? kids[kids.length - 1].start : null)
  }
  return after(code, el, markup, base)
}

/** A JSX element's own source, refused across files when it reads values of the component it is in. */
export function jsxSnippet(a, el, { sameFile }) {
  const text = a.code.slice(el.start, el.end)
  if (!sameFile) {
    let dynamic = false
    walk(el, (n) => {
      if (n.type === 'JSXExpressionContainer' && n.expression.type !== 'StringLiteral' && n.expression.type !== 'JSXEmptyExpression') dynamic = true
      if (n.type === 'JSXSpreadAttribute' || n.type === 'JSXSpreadChild') dynamic = true
    })
    if (dynamic) throw new RetouchError('That copy uses values from its own component, so it can only be pasted in the same file.', { code: 'place' })
  }
  return { text, base: ownLine(a.code, el.start) ? indentAt(a.code, el.start) : '' }
}

/** An HTML element's own source. */
export function htmlSnippet(code, el) {
  return { text: code.slice(el.start, el.end), base: ownLine(code, el.start) ? indentAt(code, el.start) : '' }
}
