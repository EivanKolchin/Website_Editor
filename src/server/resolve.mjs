import { analysed, ancestors, findProperty, isFunction, keyName, unwrap, walk } from './ast.mjs'
import { mapCallOf } from './stamp.mjs'

/**
 * FROM AN EXPRESSION ON THE PAGE TO THE NUMBER IN THE SOURCE.
 *
 * `<Sprite x={s.x}>` inside `SWAYS.map((s, i) => ...)` is not an edit to
 * that line - writing `s.x + 12` there moves all fourteen sprites. The edit
 * that moves ONE is to `x: 352` in entry i of the SWAYS array. This module
 * makes that walk: from a prop's expression, through the binding it names,
 * through the map it came from, into the array literal and the entry the
 * stamp says this instance was.
 *
 * It is a small static evaluator, not a type checker, and it says when it
 * cannot follow something rather than guessing: an array built by
 * `.filter()`, a value computed at runtime, a prop handed down from a parent
 * component. Those fall back to an edit at the usage, and the client is
 * told that edit is shared by every instance.
 */

/** What does this identifier refer to, in the scope it is written in? */
export function bindingOf(a, id) {
  const name = id.name
  for (const scope of ancestors(a, id)) {
    if (isFunction(scope)) {
      for (let i = 0; i < scope.params.length; i++) {
        const path = patternPath(scope.params[i], name)
        if (path) return { kind: 'param', fn: scope, index: i, path }
      }
      if (scope.type === 'FunctionDeclaration' || scope.type === 'FunctionExpression') {
        if (scope.id?.name === name && scope.type === 'FunctionExpression') return { kind: 'function', node: scope }
      }
    }
    const body = scope.type === 'Program' || scope.type === 'BlockStatement' || scope.type === 'StaticBlock' ? scope.body : null
    if (body) {
      for (const st of body) {
        const decl = st.type === 'ExportNamedDeclaration' && st.declaration ? st.declaration : st
        if (decl.type === 'VariableDeclaration') {
          for (const d of decl.declarations) {
            if (d.id.type === 'Identifier' && d.id.name === name) return { kind: 'var', node: d, init: d.init, constant: decl.kind === 'const' }
          }
        } else if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id?.name === name) {
          return { kind: 'function', node: decl }
        } else if (st.type === 'ImportDeclaration') {
          for (const sp of st.specifiers) {
            if (sp.local.name !== name) continue
            const imported = sp.type === 'ImportDefaultSpecifier' ? 'default' : sp.type === 'ImportNamespaceSpecifier' ? '*' : sp.imported.type === 'StringLiteral' ? sp.imported.value : sp.imported.name
            return { kind: 'import', source: st.source.value, imported }
          }
        }
      }
    }
  }
  return null
}

/** Where `name` sits inside a binding pattern: [] for the whole param, ['x'] for `{ x }`. */
function patternPath(p, name, path = []) {
  if (!p) return null
  if (p.type === 'Identifier') return p.name === name ? path : null
  if (p.type === 'AssignmentPattern') return patternPath(p.left, name, path)
  if (p.type === 'TSParameterProperty') return patternPath(p.parameter, name, path)
  if (p.type === 'ObjectPattern') {
    for (const prop of p.properties) {
      if (prop.type === 'RestElement') {
        if (patternPath(prop.argument, name, path)) return null
        continue
      }
      const key = keyName(prop)
      if (key == null) continue
      const found = patternPath(prop.value, name, [...path, key])
      if (found) return found
    }
  }
  return null
}

/** How many places read this name - a constant read once can be edited in place. */
export function refCount(a, name) {
  let n = 0
  walk(a.ast, (node, parent, key) => {
    if (node.type !== 'Identifier' || node.name !== name || !parent) return
    if (parent.type.startsWith('TS')) return
    if ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && key === 'property' && !parent.computed) return
    if ((parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') && key === 'key' && !parent.computed) return
    if (parent.type === 'VariableDeclarator' && key === 'id') return
    if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier' || parent.type === 'ExportSpecifier') return
    if (isFunction(parent) && (key === 'params' || key === 'id')) return
    if (parent.type === 'ClassDeclaration' && key === 'id') return
    n++
  })
  return n
}

const propName = (m) => {
  if (!m.computed && m.property.type === 'Identifier') return m.property.name
  if (m.property.type === 'StringLiteral') return m.property.value
  if (m.property.type === 'NumericLiteral') return String(m.property.value)
  return null
}

/** The export named `name` in an analysed module, as the expression it is initialised with. */
function exportExpr(a, name) {
  for (const st of a.ast.program?.body ?? []) {
    if (name === 'default' && st.type === 'ExportDefaultDeclaration') {
      const d = st.declaration
      if (d.type === 'Identifier') {
        const b = bindingOf(a, d)
        return b?.kind === 'var' ? b.init : null
      }
      return d
    }
    if (st.type === 'ExportNamedDeclaration') {
      if (st.declaration?.type === 'VariableDeclaration') {
        for (const d of st.declaration.declarations) if (d.id.type === 'Identifier' && d.id.name === name) return d.init
      }
      for (const sp of st.specifiers ?? []) {
        const exported = sp.exported.type === 'StringLiteral' ? sp.exported.value : sp.exported.name
        if (exported === name && !st.source) {
          const b = bindingOf(a, sp.local)
          return b?.kind === 'var' ? b.init : null
        }
      }
    }
  }
  return null
}

/**
 * Follow an expression to the literal it ultimately is, if it is one we can
 * see: through constants, imports, object members and map entries.
 * Returns { a, node } with node an unwrapped expression, or null.
 */
export async function evaluate(project, a, expr, instance, depth = 0) {
  if (!expr || depth > 8) return null
  const n = unwrap(expr)
  if (n.type === 'ObjectExpression' || n.type === 'ArrayExpression' || n.type === 'NumericLiteral' || n.type === 'StringLiteral') return { a, node: n, viaEntry: false }
  if (n.type === 'Identifier') {
    const b = bindingOf(a, n)
    if (!b) return null
    if (b.kind === 'var' && b.constant && b.init) return evaluate(project, a, b.init, instance, depth + 1)
    if (b.kind === 'import') {
      const target = await project.importTarget(a.file, b.source)
      if (!target) return null
      const ta = project.analysis(target)
      if (!ta) return null
      const ex = exportExpr(ta, b.imported)
      return ex ? evaluate(project, ta, ex, instance, depth + 1) : null
    }
    if (b.kind === 'param') {
      const entry = await mapEntry(project, a, b.fn, b.index, instance, depth)
      if (!entry) return null
      let node = entry.node
      for (const key of b.path) {
        const prop = findProperty(node, key)
        if (!prop) return null
        node = unwrap(prop.value)
      }
      return { a: entry.a, node, viaEntry: true }
    }
    return null
  }
  if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && propName(n) != null) {
    const obj = await evaluate(project, a, n.object, instance, depth + 1)
    if (!obj) return null
    const key = propName(n)
    if (obj.node.type === 'ObjectExpression') {
      const prop = findProperty(obj.node, key)
      if (!prop || prop.shorthand) return null
      const inner = await evaluate(project, obj.a, prop.value, instance, depth + 1)
      return inner ? { ...inner, viaEntry: inner.viaEntry || obj.viaEntry } : null
    }
    if (obj.node.type === 'ArrayExpression' && /^\d+$/.test(key)) {
      const el = arrayElement(obj.node, Number(key))
      return el ? { a: obj.a, node: unwrap(el), viaEntry: obj.viaEntry } : null
    }
  }
  return null
}

function arrayElement(arr, index) {
  for (let k = 0; k <= index && k < arr.elements.length; k++) {
    const e = arr.elements[k]
    if (!e || e.type === 'SpreadElement') return null
  }
  return arr.elements[index] ?? null
}

/**
 * The entry a map callback was called with for this instance: the stamp
 * carries the index, the callee says which array. Only arrays written as
 * literals count - `.filter(...).map(...)` reindexes, so its index says
 * nothing about the source.
 */
export async function mapEntry(project, a, fn, paramIndex, instance, depth = 0) {
  if (paramIndex !== 0 || !instance) return null
  const index = instance.get(fn.start)
  if (index == null) return null
  const call = mapCallOf(fn, a.parents)
  if (!call) return null
  const arr = await evaluate(project, a, call.callee.object, instance, depth + 1)
  if (!arr || arr.node.type !== 'ArrayExpression') return null
  const el = arrayElement(arr.node, index)
  if (!el) return null
  return { a: arr.a, node: unwrap(el), array: arr.node, index, label: `${labelOf(call.callee.object)}[${index}]` }
}

const labelOf = (n) => {
  n = unwrap(n)
  if (n.type === 'Identifier') return n.name
  if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') return labelOf(n.object) + '.' + n.property.name
  return 'list'
}

/** Is this node written inside a `.map(...)` callback, i.e. shared by every instance it renders? */
export function inMapTemplate(a, node) {
  for (const p of ancestors(a, node)) if (isFunction(p) && mapCallOf(p, a.parents)) return p
  return null
}

/**
 * THE VALUE SITE of one numeric prop: the exact place a delta should be
 * written. `entry` sites are this instance's own; every other kind is
 * written at a place every instance shares.
 */
export async function siteFor(project, a, expr, instance) {
  const n = unwrap(expr)
  if (n.type === 'NumericLiteral' || (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'NumericLiteral')) {
    return { kind: 'literal', a, node: n, entry: false }
  }
  if (n.type === 'Identifier' || n.type === 'MemberExpression') {
    // map entries: `s.x`, or `x` destructured from the item
    const viaEntry = await entrySite(project, a, n, instance)
    if (viaEntry) return viaEntry
    // a constant read in exactly one place may be edited where it is declared
    if (n.type === 'Identifier') {
      const b = bindingOf(a, n)
      if (b?.kind === 'var' && b.constant && b.init && refCount(a, n.name) === 1) {
        const init = unwrap(b.init)
        if (init.type === 'NumericLiteral') return { kind: 'literal', a, node: init, entry: false, label: n.name }
      }
    }
  }
  return { kind: 'expr', a, node: expr, entry: false }
}

async function entrySite(project, a, n, instance) {
  let id = n
  const keys = []
  while (id.type === 'MemberExpression' && propName(id) != null) {
    keys.unshift(propName(id))
    id = unwrap(id.object)
  }
  if (id.type !== 'Identifier') return null
  const b = bindingOf(a, id)
  if (b?.kind !== 'param') return null
  const entry = await mapEntry(project, a, b.fn, b.index, instance)
  if (!entry) return null
  const path = [...b.path, ...keys]
  if (!path.length) return null
  let node = entry.node
  let prop = null
  for (const key of path) {
    if (node.type !== 'ObjectExpression') return null
    prop = findProperty(node, key)
    if (!prop) return null
    node = unwrap(prop.value)
  }
  const label = `${entry.label}.${path.join('.')}`
  if (prop.shorthand) return { kind: 'shorthand', a: entry.a, prop, entry: true, label }
  if (node.type === 'NumericLiteral' || (node.type === 'UnaryExpression' && node.operator === '-' && node.argument?.type === 'NumericLiteral')) {
    return { kind: 'literal', a: entry.a, node, entry: true, label }
  }
  return { kind: 'expr', a: entry.a, node: prop.value, entry: true, label }
}

/**
 * The site of a JSX prop on an element, honouring JSX's own rule that the
 * LAST definition wins - an explicit attribute or a spread that carries it.
 */
export async function propSite(project, a, el, name, instance) {
  const attrs = el.openingElement.attributes
  for (let i = attrs.length - 1; i >= 0; i--) {
    const at = attrs[i]
    if (at.type === 'JSXAttribute') {
      if (at.name.type !== 'JSXIdentifier' || at.name.name !== name) continue
      if (!at.value) return { kind: 'none', reason: `${name} is a bare attribute` }
      if (at.value.type === 'StringLiteral') {
        return /^-?\d+(\.\d+)?$/.test(at.value.value) ? { kind: 'string-number', a, node: at.value, entry: false } : { kind: 'none', reason: `${name} is not a number` }
      }
      if (at.value.type === 'JSXExpressionContainer') return siteFor(project, a, at.value.expression, instance)
      return { kind: 'none', reason: `${name} is not a number` }
    }
    if (at.type === 'JSXSpreadAttribute') {
      const obj = await evaluate(project, a, at.argument, instance)
      if (!obj || obj.node.type !== 'ObjectExpression') return { kind: 'none', reason: `${name} may come from a spread of props` }
      const prop = findProperty(obj.node, name)
      if (!prop) continue
      const node = unwrap(prop.value)
      // a spread object reached through a map entry belongs to that entry alone
      const entry = obj.viaEntry
      if (prop.shorthand) return { kind: 'shorthand', a: obj.a, prop, entry }
      if (node.type === 'NumericLiteral') return { kind: 'literal', a: obj.a, node, entry }
      return { kind: 'expr', a: obj.a, node: prop.value, entry }
    }
  }
  return { kind: 'missing', a, el, entry: false }
}

/** Find the analysed array literal and entry index of a map instance, for deletion. */
export async function instanceEntry(project, a, el, instance) {
  const fn = inMapTemplate(a, el)
  if (!fn) return null
  const entry = await mapEntry(project, a, fn, 0, instance)
  if (!entry) return null
  // the element must BE the instance: the callback's root, or the only
  // element on the chain down from it, or deleting the entry deletes more
  // than was selected
  const root = callbackRoot(fn)
  if (!root) return null
  let k = root
  while (k && k !== el) {
    const kids = (k.children ?? []).filter((c) => c.type === 'JSXElement' || (c.type === 'JSXExpressionContainer' && c.expression.type !== 'JSXEmptyExpression'))
    if (kids.length !== 1 || kids[0].type !== 'JSXElement') return null
    k = kids[0]
  }
  return k === el ? { ...entry, fn } : null
}

/** The JSX element a callback returns, when it returns exactly one. */
export function callbackRoot(fn) {
  let body = unwrap(fn.body)
  if (body.type === 'BlockStatement') {
    const rets = body.body.filter((s) => s.type === 'ReturnStatement')
    if (rets.length !== 1 || !rets[0].argument) return null
    body = unwrap(rets[0].argument)
  }
  return body.type === 'JSXElement' ? body : null
}

