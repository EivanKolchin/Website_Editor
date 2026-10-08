import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
let parser = null

/**
 * @babel/parser from this tool's own node_modules if it was installed, else
 * from the host project's (every Vite + React project has one, because
 * @vitejs/plugin-react depends on Babel). So a fresh copy dropped into a
 * repo works before anyone has run npm install in it.
 */
export function loadParser(hostRoot) {
  if (parser) return parser
  const tries = [join(here, '..', '..', 'package.json'), join(hostRoot, 'package.json')]
  for (const base of tries) {
    try {
      parser = createRequire(base)('@babel/parser')
      return parser
    } catch {}
  }
  throw new Error('Retouch needs @babel/parser. Run `npm install` in the retouch folder.')
}

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'range', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'tokens', 'errors'])

export function pluginsFor(file) {
  const f = file.toLowerCase()
  const ts = /\.(ts|tsx|mts|cts)$/.test(f)
  const jsx = !/\.(ts|mts|cts)$/.test(f)
  return [...(ts ? ['typescript'] : []), ...(jsx ? ['jsx'] : []), 'decorators-legacy', 'importAttributes']
}

export function parse(code, file, { strict = false } = {}) {
  if (!parser) throw new Error('parser not loaded')
  return parser.parse(code, {
    sourceType: 'module',
    plugins: pluginsFor(file),
    errorRecovery: !strict,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowImportExportEverywhere: true,
    allowUndeclaredExports: true,
  })
}

/** A JSON file, parsed as the expression it is, with real offsets. */
export function parseJson(code) {
  if (!parser) throw new Error('parser not loaded')
  return parser.parseExpression(code, { errorRecovery: true })
}

/** Does this source parse cleanly? Used before and after every save. */
export function parseErrors(code, file) {
  try {
    if (/\.json$/i.test(file)) {
      parseJson(code)
      return 0
    }
    return parse(code, file).errors?.length ?? 0
  } catch {
    return Infinity
  }
}

export const isNode = (v) => v !== null && typeof v === 'object' && typeof v.type === 'string'

/** Depth-first walk. `enter(node, parent, key)` may return false to skip children. */
export function walk(node, enter, parent = null, key = null) {
  if (!isNode(node)) return
  if (enter(node, parent, key) === false) return
  for (const k in node) {
    if (SKIP_KEYS.has(k)) continue
    const v = node[k]
    if (Array.isArray(v)) {
      for (const item of v) if (isNode(item)) walk(item, enter, node, k)
    } else if (isNode(v)) walk(v, enter, node, k)
  }
}

/** Parse once, keep parent links: everything that edits code needs to look up. */
export function analyse(code, file) {
  const ast = /\.json$/i.test(file) ? parseJson(code) : parse(code, file)
  const parents = new Map()
  const keys = new Map()
  walk(ast, (node, parent, key) => {
    parents.set(node, parent)
    keys.set(node, key)
  })
  return { ast, parents, keys, code, file }
}

const cache = new Map()

/** Analyses keyed by file and content, so a snapshot is parsed once however often it is asked about. */
export function analysed(code, file) {
  const k = file + '\0' + code.length + '\0' + code.slice(0, 64) + code.slice(-64)
  const hit = cache.get(k)
  if (hit && hit.code === code) return hit
  const a = analyse(code, file)
  cache.set(k, a)
  if (cache.size > 200) cache.delete(cache.keys().next().value)
  return a
}

export function ancestors(a, node) {
  const out = []
  for (let p = a.parents.get(node); p; p = a.parents.get(p)) out.push(p)
  return out
}

export function findNode(a, predicate) {
  let found = null
  walk(a.ast, (node) => {
    if (found) return false
    if (predicate(node)) {
      found = node
      return false
    }
  })
  return found
}

export function findElementAt(a, start, end) {
  return findNode(a, (n) => n.type === 'JSXElement' && n.start === start && n.end === end)
}

/** Strip the wrappers TypeScript and parentheses put around an expression. */
export function unwrap(node) {
  let n = node
  while (n && (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'TSNonNullExpression' || n.type === 'TSTypeAssertion' || n.type === 'ParenthesizedExpression')) n = n.expression
  return n
}

export const isFunction = (n) => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration' || n.type === 'ObjectMethod' || n.type === 'ClassMethod')

/** `<Foo>`, `<foo.Bar>`, `<svg:rect>` as the string a person would write. */
export function elementName(el) {
  const n = el.openingElement?.name ?? el.name
  const str = (x) => (x.type === 'JSXIdentifier' ? x.name : x.type === 'JSXMemberExpression' ? str(x.object) + '.' + x.property.name : x.type === 'JSXNamespacedName' ? x.namespace.name + ':' + x.name.name : '?')
  return n ? str(n) : '?'
}

export function attr(el, name) {
  for (const a of el.openingElement.attributes) {
    if (a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === name) return a
  }
  return null
}

export const keyName = (prop) => {
  if (!prop || prop.computed && prop.key.type !== 'StringLiteral' && prop.key.type !== 'NumericLiteral') return null
  const k = prop.key
  return k.type === 'Identifier' ? k.name : k.type === 'StringLiteral' ? k.value : k.type === 'NumericLiteral' ? String(k.value) : null
}

export function findProperty(obj, name) {
  if (!obj || obj.type !== 'ObjectExpression') return null
  let found = null
  for (const p of obj.properties) {
    if (p.type === 'ObjectProperty' && keyName(p) === name) found = p
  }
  return found
}

/** Start of the line an offset sits on. */
export const lineStart = (code, at) => {
  let i = at
  while (i > 0 && code[i - 1] !== '\n') i--
  return i
}

/** Offset just past the newline that ends the line an offset sits on. */
export const lineEnd = (code, at) => {
  let i = at
  while (i < code.length && code[i] !== '\n') i++
  return i < code.length ? i + 1 : i
}

export const onlySpace = (s) => /^[ \t]*$/.test(s)

/** The indentation of the line an offset sits on. */
export const indentAt = (code, at) => {
  const s = lineStart(code, at)
  return /^[ \t]*/.exec(code.slice(s))[0]
}

export const newlineOf = (code) => (code.includes('\r\n') ? '\r\n' : '\n')
