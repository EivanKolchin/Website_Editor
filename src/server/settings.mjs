import { analysed, elementName, isFunction, keyName, unwrap, walk } from './ast.mjs'
import { lexStrings, lineAt, lineStarts } from './colors.mjs'
import { attributesOf } from './html.mjs'
import { bindingOf } from './resolve.mjs'
import { lineCol, relTo } from './util.mjs'

/**
 * THE SETTINGS OF A THING: every value written in code that decides how it
 * looks or behaves, gathered where a person can change it.
 *
 * For a component on the page that is the props of THIS instance (with the
 * choices its TypeScript type allows, and the ones it could have but does
 * not set), the defaults it falls back to, the named constants its code
 * reads - with the comment written above each, which is usually the best
 * description there is - and the numbers in its code that time or place
 * things (delays, durations, thresholds). For a plain element it is its
 * attributes and the component it is written in. For something a script
 * draws, the numbers in the code that drew it.
 *
 * Every item carries the exact source range of its value, so changing it is
 * a one-literal splice (ops.mjs, `literal`), and nothing is listed that
 * cannot be written back exactly.
 */

const TIMING = /(duration|delay|ease|easing|stagger|threshold|offset|distance|speed|interval|timeout|hide|show|scroll|recall|spring|stiffness|damping|mass|repeat|loop|velocity|fps|frame|ms\b|seconds|fade|slide|travel)/i
const SKIP_NUM = new Set([0, 1, 2, -1, 100])

/** The comment written above a node, first sentence, as a description. */
function describe(node) {
  const c = node?.leadingComments?.[node.leadingComments.length - 1]
  if (!c) return null
  const text = c.value
    .split('\n')
    .map((l) => l.replace(/^\s*\*+\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim()
  if (!text) return null
  const first = /^(.{20,220}?[.!?])(\s|$)/.exec(text)?.[1] ?? text.slice(0, 220)
  return first
}

/** A literal's value and kind, or null when the expression is not one literal. */
function literalOf(node, code) {
  const n = unwrap(node)
  if (!n) return null
  if (n.type === 'NumericLiteral') return { kind: 'number', value: n.value, node: n }
  if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'NumericLiteral') return { kind: 'number', value: -n.argument.value, node: n }
  if (n.type === 'BooleanLiteral') return { kind: 'boolean', value: n.value, node: n }
  if (n.type === 'StringLiteral') return { kind: 'string', value: n.value, node: n }
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return { kind: 'string', value: n.quasis[0].value.cooked, node: n }
  return null
}

export function createSettings({ project, ops }) {
  const root = project.root
  const rel = (f) => relTo(root, f)

  function item(a, file, node, lit, extra = {}) {
    const { line } = lineCol(a.code, node.start)
    return {
      id: `${rel(file)}:${node.start}`,
      kind: lit.kind,
      value: lit.value,
      target: { file: rel(file), start: node.start, end: node.end, text: a.code.slice(node.start, node.end) },
      file: rel(file),
      line,
      ...extra,
    }
  }

  /** Literal leaves of an object or array expression, as `path.to.key` items. */
  function leaves(a, file, node, path, out, depth = 0) {
    const n = unwrap(node)
    if (!n || depth > 3) return
    const lit = literalOf(n, a.code)
    if (lit) {
      out.push(item(a, file, lit.node, lit, { label: path }))
      return
    }
    if (n.type === 'ObjectExpression') {
      for (const p of n.properties) {
        if (p.type !== 'ObjectProperty') continue
        const k = keyName(p)
        if (k == null) continue
        leaves(a, file, p.value, path ? `${path}.${k}` : k, out, depth + 1)
      }
    } else if (n.type === 'ArrayExpression' && n.elements.length <= 8) {
      n.elements.forEach((e, i) => e && leaves(a, file, e, `${path}[${i}]`, out, depth + 1))
    }
  }

  /** The attributes written on a JSX element. */
  function attributes(a, file, el) {
    const out = []
    for (const at of el.openingElement.attributes) {
      if (at.type !== 'JSXAttribute') continue
      const name = at.name.type === 'JSXNamespacedName' ? `${at.name.namespace.name}:${at.name.name.name}` : at.name.name
      if (name === 'key' || name === 'data-rt' || name === 'ref') continue
      const v = at.value
      if (!v) {
        // a bare attribute is `true`; switching it off writes ={false} after its name
        out.push({ id: `${rel(file)}:${at.end}`, kind: 'boolean', value: true, label: name, target: { file: rel(file), start: at.end, end: at.end, text: '', bare: true }, file: rel(file), line: lineCol(a.code, at.start).line })
        continue
      }
      if (v.type === 'StringLiteral') {
        out.push(item(a, file, v, { kind: 'string', value: v.value }, { label: name, jsxAttr: true }))
        continue
      }
      if (v.type !== 'JSXExpressionContainer') continue
      const before = out.length
      leaves(a, file, v.expression, name, out)
      if (out.length === before) {
        out.push({ id: `${rel(file)}:${v.start}`, kind: 'code', value: a.code.slice(v.expression.start, v.expression.end).slice(0, 160), label: name, file: rel(file), line: lineCol(a.code, v.start).line, col: lineCol(a.code, v.start).col })
      }
    }
    return out
  }

  /** Find a component's function in a module: declared, assigned, or wrapped in memo/forwardRef. */
  function componentIn(a, name) {
    const fnOf = (init) => {
      const n = unwrap(init)
      if (!n) return null
      if (isFunction(n)) return n
      if (n.type === 'CallExpression') for (const arg of n.arguments) if (isFunction(unwrap(arg))) return unwrap(arg)
      return null
    }
    for (const st of a.ast.program?.body ?? []) {
      const d = st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration' ? st.declaration : st
      if (!d) continue
      if (d.type === 'FunctionDeclaration' && (d.id?.name === name || (name === 'default' && st.type === 'ExportDefaultDeclaration'))) return { fn: d, decl: st }
      if (name === 'default' && st.type === 'ExportDefaultDeclaration') {
        const fn = fnOf(d)
        if (fn) return { fn, decl: st }
        if (d.type === 'Identifier') return componentIn(a, d.name)
      }
      if (d.type === 'VariableDeclaration') {
        for (const v of d.declarations) if (v.id.type === 'Identifier' && v.id.name === name && fnOf(v.init)) return { fn: fnOf(v.init), decl: st }
      }
    }
    return null
  }

  /** Where the component a JSX usage names is written. */
  async function definitionOf(a, file, el) {
    const nameNode = el.openingElement.name
    if (nameNode.type !== 'JSXIdentifier') return null
    const b = bindingOf(a, nameNode)
    if (!b) return null
    if (b.kind === 'function') return { a, file, fn: b.node, decl: b.node }
    if (b.kind === 'var') {
      const hit = componentIn(a, nameNode.name)
      return hit ? { a, file, ...hit } : null
    }
    if (b.kind === 'import') {
      const target = await project.importTarget(file, b.source)
      if (!target) return null
      const ta = project.analysis(target)
      if (!ta) return null
      const hit = componentIn(ta, b.imported === 'default' ? 'default' : b.imported)
      return hit ? { a: ta, file: target, ...hit } : null
    }
    return null
  }

  /** A type as a control: a union of string literals becomes a choice, booleans a switch. */
  function typeInfo(a, t, seen = new Set()) {
    if (!t) return { kind: 'code' }
    if (t.type === 'TSTypeAnnotation') return typeInfo(a, t.typeAnnotation, seen)
    if (t.type === 'TSBooleanKeyword') return { kind: 'boolean' }
    if (t.type === 'TSNumberKeyword') return { kind: 'number' }
    if (t.type === 'TSStringKeyword') return { kind: 'string' }
    if (t.type === 'TSUnionType') {
      const lits = t.types.filter((x) => x.type === 'TSLiteralType' && x.literal.type === 'StringLiteral').map((x) => x.literal.value)
      if (lits.length && lits.length === t.types.filter((x) => x.type !== 'TSUndefinedKeyword' && x.type !== 'TSNullKeyword').length) return { kind: 'enum', options: lits }
      if (t.types.every((x) => x.type === 'TSBooleanKeyword' || (x.type === 'TSLiteralType' && x.literal.type === 'BooleanLiteral') || x.type === 'TSUndefinedKeyword')) return { kind: 'boolean' }
      return { kind: 'code' }
    }
    if (t.type === 'TSTypeReference' && t.typeName.type === 'Identifier') {
      const name = t.typeName.name
      if (seen.has(name)) return { kind: 'code' }
      seen.add(name)
      for (const st of a.ast.program?.body ?? []) {
        const d = st.type === 'ExportNamedDeclaration' ? st.declaration : st
        if (d?.type === 'TSTypeAliasDeclaration' && d.id.name === name) return typeInfo(a, d.typeAnnotation, seen)
      }
    }
    return { kind: 'code' }
  }

  /** The props a component declares: name -> { kind, options, optional, default, desc }. */
  function declaredProps(def) {
    const { a, fn } = def
    const param = fn.params?.[0]
    if (!param) return {}
    const out = {}
    const pattern = param.type === 'AssignmentPattern' ? param.left : param
    let members = []
    const ann = pattern.typeAnnotation?.typeAnnotation
    if (ann?.type === 'TSTypeLiteral') members = ann.members
    else if (ann?.type === 'TSTypeReference' && ann.typeName.type === 'Identifier') {
      for (const st of a.ast.program?.body ?? []) {
        const d = st.type === 'ExportNamedDeclaration' ? st.declaration : st
        if (d?.type === 'TSInterfaceDeclaration' && d.id.name === ann.typeName.name) members = d.body.body
        if (d?.type === 'TSTypeAliasDeclaration' && d.id.name === ann.typeName.name && d.typeAnnotation.type === 'TSTypeLiteral') members = d.typeAnnotation.members
      }
    }
    for (const m of members) {
      if (m.type !== 'TSPropertySignature' || m.key.type !== 'Identifier') continue
      out[m.key.name] = { ...typeInfo(a, m.typeAnnotation), optional: !!m.optional, desc: describe(m) }
    }
    if (pattern.type === 'ObjectPattern') {
      for (const p of pattern.properties) {
        if (p.type !== 'ObjectProperty') continue
        const k = keyName(p)
        if (!k) continue
        if (p.value.type === 'AssignmentPattern') {
          const lit = literalOf(p.value.right, a.code)
          out[k] = { ...(out[k] ?? { kind: lit?.kind ?? 'code' }), default: lit ? lit.value : a.code.slice(p.value.right.start, p.value.right.end), defaultItem: lit ? item(a, def.file, lit.node, lit, { label: `${k} (default)` }) : null }
        }
      }
    }
    return out
  }

  /** Top-level constants a function reads, as items, each described by its own comment. */
  function constantsUsed(a, file, fn) {
    const names = new Set()
    walk(fn, (n, parent, key) => {
      if (n.type !== 'Identifier' || !parent) return
      if ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && key === 'property' && !parent.computed) return
      if (parent.type === 'ObjectProperty' && key === 'key' && !parent.computed) return
      names.add(n.name)
    })
    const out = []
    for (const st of a.ast.program?.body ?? []) {
      const d = st.type === 'ExportNamedDeclaration' ? st.declaration : st
      if (d?.type !== 'VariableDeclaration') continue
      for (const v of d.declarations) {
        if (v.id.type !== 'Identifier' || !names.has(v.id.name) || !v.init) continue
        if (isFunction(unwrap(v.init))) continue
        const desc = describe(st) ?? describe(d)
        const found = []
        leaves(a, file, v.init, v.id.name, found)
        if (found.length > 24) continue
        for (const it of found) out.push({ ...it, desc })
      }
    }
    return out
  }

  /** The numbers inside a function that time or place things; the rest only when asked for. */
  function numbersIn(a, file, fn, { all = false } = {}) {
    const timing = []
    const other = []
    const seen = new Set()
    const parents = new Map()
    walk(fn, (n, parent, key) => {
      parents.set(n, { parent, key })
      const lit = literalOf(n, a.code)
      if (!lit || lit.kind !== 'number' || seen.has(n.start)) return
      if (n.type === 'NumericLiteral' && parent?.type === 'UnaryExpression') return
      seen.add(n.start)
      // what the number is called, by whatever holds it; failing a name, the expression it sits in
      let label = null
      let named = false
      const p = parent
      const snip = (node) => a.code.slice(node.start, node.end).replace(/\s+/g, ' ').slice(0, 48)
      if (p?.type === 'ObjectProperty' && key === 'value') (label = keyName(p)), (named = true)
      else if (p?.type === 'VariableDeclarator') (label = p.id.name), (named = true)
      else if (p?.type === 'AssignmentPattern') (label = p.left.name ? `${p.left.name} (default)` : null), (named = !!p.left.name)
      else if (p?.type === 'AssignmentExpression') (label = snip(p.left)), (named = true)
      else if (p?.type === 'JSXExpressionContainer') (label = parents.get(p)?.parent?.name?.name ?? null), (named = !!label)
      else if (p?.type === 'CallExpression') {
        const callee = a.code.slice(p.callee.start, p.callee.end)
        label = `${callee.length > 28 ? callee.slice(-28) : callee}, argument ${p.arguments.indexOf(n) + 1}`
        named = true
      } else if (p?.type === 'MemberExpression' && p.computed) return
      else if (p && /Binary|Logical|Conditional/.test(p.type)) label = snip(p)
      const { line } = lineCol(a.code, n.start)
      const ls = a.code.lastIndexOf('\n', n.start) + 1
      const le = a.code.indexOf('\n', n.start)
      const context = a.code.slice(ls, le < 0 ? undefined : le).trim().slice(0, 120)
      // timing is judged by the name, or the expression right around the number - not by the whole line
      const isTiming = TIMING.test(label ?? '') || (!named && TIMING.test(p ? snip(p) : ''))
      if (SKIP_NUM.has(lit.value) && !(named && isTiming) && !all) return
      const it = item(a, file, lit.node, lit, { label: label ?? String(lit.value), context, line })
      if (isTiming) timing.push(it)
      else other.push(it)
    })
    return { timing: timing.slice(0, 40), other: other.slice(0, 60) }
  }

  /** The function a node is written in: the component a plain element belongs to. */
  function enclosingFunction(a, node) {
    let best = null
    walk(a.ast, (n) => {
      if (isFunction(n) && n.start <= node.start && n.end >= node.end) best = n
    })
    // the outermost one inside the module body: the component, not an inline callback
    let outer = null
    walk(a.ast, (n) => {
      if (isFunction(n) && n.start <= node.start && n.end >= node.end && !outer) outer = n
    })
    return outer ?? best
  }

  const fnName = (a, fn) => fn.id?.name ?? (() => {
    let name = null
    walk(a.ast, (n) => {
      if (n.type === 'VariableDeclarator' && n.init && (unwrap(n.init) === fn || (unwrap(n.init)?.arguments ?? []).includes(fn))) name = n.id.name
    })
    return name ?? 'this component'
  })()

  /** Settings for one stamp: a component usage or a plain element. */
  async function forStamp(stamp) {
    const { a, el, f } = ops.locate(stamp)
    const file = f.file
    const name = elementName(el)
    const groups = []
    const usageLine = lineCol(a.code, el.start).line
    const component = /^[A-Z]/.test(name) || name.includes('.')
    const attrs = attributes(a, file, el)
    if (component) {
      const def = await definitionOf(a, file, el)
      const declared = def ? declaredProps(def) : {}
      // the props set here, with the choices their type allows
      for (const it of attrs) {
        const d = declared[it.label.split(/[.[]/)[0]]
        if (d?.kind === 'enum' && it.kind === 'string' && !it.label.includes('.')) Object.assign(it, { kind: 'enum', options: d.options })
        if (d?.desc) it.desc ??= d.desc
      }
      const unset = Object.entries(declared)
        .filter(([k, d]) => !attrs.some((x) => x.label === k || x.label.startsWith(k + '.')) && ['boolean', 'number', 'string', 'enum'].includes(d.kind) && k !== 'children')
        .map(([k, d]) => ({ id: `add:${stamp}:${k}`, kind: d.kind, options: d.options, value: d.default ?? (d.kind === 'boolean' ? false : d.kind === 'enum' ? d.options[0] : ''), label: k, unset: true, desc: d.desc ?? (d.default !== undefined ? `Not set here: ${JSON.stringify(d.default)} by default.` : 'Not set here.'), add: { stamp, name: k } }))
      groups.push({ id: 'props', title: `<${name}> here`, sub: 'This instance only', file: rel(file), line: usageLine, items: [...attrs, ...unset] })
      if (def) {
        const defLine = lineCol(def.a.code, def.fn.start).line
        const defaults = Object.entries(declared).filter(([, d]) => d.defaultItem).map(([k, d]) => ({ ...d.defaultItem, label: k, desc: d.desc ?? `Used wherever ${name} is placed without ${k}.` }))
        if (defaults.length) groups.push({ id: 'defaults', title: `${name} defaults`, sub: `Every ${name} that does not set them`, file: rel(def.file), line: defLine, items: defaults })
        const consts = constantsUsed(def.a, def.file, def.fn)
        if (consts.length) groups.push({ id: 'constants', title: `${name} settings`, sub: `Named values in ${rel(def.file).split('/').pop()}, for every ${name}`, file: rel(def.file), line: defLine, items: consts })
        const nums = numbersIn(def.a, def.file, def.fn)
        if (nums.timing.length) groups.push({ id: 'timing', title: 'Timing and motion', sub: `Numbers in ${name}'s code that time or move things`, file: rel(def.file), line: defLine, items: nums.timing })
        if (nums.other.length) groups.push({ id: 'numbers', title: 'Other numbers', sub: `The rest of ${name}'s numbers, with the line each is on`, file: rel(def.file), line: defLine, items: nums.other, collapsed: true })
      }
    } else {
      groups.push({ id: 'attrs', title: `<${name}> attributes`, sub: 'On this element', file: rel(file), line: usageLine, items: attrs })
      const fn = enclosingFunction(a, el)
      if (fn) {
        const owner = fnName(a, fn)
        const consts = constantsUsed(a, file, fn)
        if (consts.length) groups.push({ id: 'constants', title: `${owner} settings`, sub: `Named values ${owner} reads`, file: rel(file), line: lineCol(a.code, fn.start).line, items: consts })
        const nums = numbersIn(a, file, fn)
        if (nums.timing.length) groups.push({ id: 'timing', title: 'Timing and motion', sub: `Numbers in ${owner} that time or move things`, file: rel(file), items: nums.timing })
        if (nums.other.length) groups.push({ id: 'numbers', title: 'Other numbers', sub: `The rest of ${owner}'s numbers`, file: rel(file), items: nums.other, collapsed: true })
      }
    }
    return { stamp, name, groups }
  }

  /** An HTML element's attributes, in its file. */
  function forHtml(hit) {
    const { file, code, el } = hit
    const items = attributesOf(code, el.start, el.tagEnd)
      .filter((x) => x.quote && x.name !== 'style')
      .map((x) => ({ id: `${rel(file)}:${x.valueStart}`, kind: 'string', value: x.value, label: x.name, target: { file: rel(file), start: x.valueStart, end: x.valueEnd, text: x.value, htmlAttr: x.quote }, file: rel(file), line: lineCol(code, x.start).line }))
    return { name: el.tag, groups: [{ id: 'attrs', title: `<${el.tag}> attributes`, sub: `In ${rel(file)}`, file: rel(file), line: lineCol(code, el.start).line, items }] }
  }

  /**
   * The numbers in the code at a line - for a drawing a script made, whose
   * size and shape are numbers somewhere in the function that drew it. Read
   * from the syntax tree when the file parses, else from the lines around.
   */
  function forLine(fileRel, line) {
    const file = project.root + '/' + fileRel
    if (!project.allowed(file)) return null
    const code = project.read(file)
    if (code == null) return null
    const starts = lineStarts(code)
    const at = starts[Math.max(0, line - 1)] ?? 0
    let a = null
    try {
      a = analysed(code, file)
    } catch {}
    if (a?.ast) {
      let fn = null
      walk(a.ast, (n) => {
        if (isFunction(n) && n.start <= at && n.end >= at && (!fn || n.start >= fn.start)) fn = n
      })
      if (fn) {
        const owner = fnName(a, fn)
        const nums = numbersIn(a, file, fn, { all: false })
        const consts = constantsUsed(a, file, fn)
        const groups = []
        if (consts.length) groups.push({ id: 'constants', title: 'Values it reads', sub: `Named values the drawing code reads`, file: fileRel, items: consts })
        groups.push({ id: 'numbers', title: `Numbers in ${owner}`, sub: 'The code that drew it; its size and shape are among these', file: fileRel, line, items: [...nums.timing, ...nums.other] })
        return { name: owner, groups }
      }
    }
    // a fragment that does not parse alone: numbers on the lines around, strings and comments masked
    let masked = code
    for (const [s, e] of lexStrings(code)) masked = masked.slice(0, s) + ' '.repeat(e - s) + masked.slice(e)
    masked = masked.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    const from = starts[Math.max(0, line - 13)] ?? 0
    const to = starts[Math.min(starts.length - 1, line + 12)] ?? code.length
    const items = []
    for (const m of masked.slice(from, to).matchAll(/(?<![\w.$])-?\d*\.?\d+(?![\w.])/g)) {
      const start = from + m.index
      const value = Number(m[0])
      if (SKIP_NUM.has(value)) continue
      const l = lineAt(starts, start)
      items.push({ id: `${fileRel}:${start}`, kind: 'number', value, label: m[0], context: code.slice(starts[l], (starts[l + 1] ?? code.length) - 1).trim().slice(0, 120), target: { file: fileRel, start, end: start + m[0].length, text: m[0] }, file: fileRel, line: l + 1 })
      if (items.length >= 60) break
    }
    return { name: fileRel.split('/').pop(), groups: [{ id: 'numbers', title: 'Numbers around the code that drew it', sub: 'Its size and shape are among these', file: fileRel, line, items }] }
  }

  return { forStamp, forHtml, forLine }
}
