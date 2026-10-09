import { parse, walk, isFunction } from './ast.mjs'

/**
 * THE STAMP: every JSX element, tagged with where it was written.
 *
 *   data-rt="7f3a2c.1b9e4d0a:1234-1290"
 *            path   content   offsets of the element in THAT content
 *
 * The path id is a hash of the root-relative path and the content id a hash
 * of the exact text the offsets index into, so a stamp is self-validating:
 * the server can always tell whether the file still says what the page was
 * built from. Nothing is looked up by line number, which an edit above the
 * element would silently invalidate.
 *
 * An element written inside a `.map(...)` callback is ONE stamp rendered N
 * times, and "move this grass blade" is not the same edit as "move all
 * fourteen". So inside a map the stamp also carries which entry it was:
 *
 *   data-rt={`7f3a2c.1b9e4d0a:1234-1290@1180=${i}`}
 *
 * 1180 is where the callback starts, so the server can find the map again
 * in the same content, and `i` is the callback's own index parameter - or
 * one added for the purpose when the callback did not ask for it. The index
 * is only ever read back for maps over an array the server can find
 * written in source; anything else falls back to "this edit changes every
 * instance", said out loud before it happens.
 *
 * It runs before every other transform (see plugin.mjs), on the file as
 * written, so the offsets are offsets into the source a person edits.
 */

const HTML = new Set(
  ('a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp search section select slot small source span strong sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr').split(' '),
)
const SVG = new Set(
  ('svg g path rect circle ellipse line polyline polygon text tspan textPath image use defs symbol marker mask pattern clipPath linearGradient radialGradient stop filter foreignObject switch view desc metadata feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence animate animateMotion animateTransform set mpath').split(' '),
)
const REACT_BUILTINS = new Set(['Fragment', 'StrictMode', 'Suspense', 'Profiler', 'SuspenseList', 'Activity', 'ViewTransition', 'Offscreen'])

export const ATTR = 'data-rt'

export function stampable(nameNode, skip) {
  if (!nameNode) return false
  if (nameNode.type === 'JSXNamespacedName') return false
  if (nameNode.type === 'JSXMemberExpression') {
    const last = nameNode.property.name
    if (last === 'Fragment' || last === 'Provider' || last === 'Consumer') return false
    let root = nameNode
    while (root.type === 'JSXMemberExpression') root = root.object
    const full = memberText(nameNode)
    return !skip.has(full) && !skip.has(last)
  }
  const name = nameNode.name
  if (/^[A-Z]/.test(name)) return !REACT_BUILTINS.has(name) && !skip.has(name)
  // lowercase: only real DOM elements. A lowercase name that is neither HTML
  // nor SVG belongs to a custom renderer (react-three-fiber's <mesh>), where
  // an unknown prop is not inert.
  return HTML.has(name) || SVG.has(name) || name.includes('-')
}

const memberText = (n) => (n.type === 'JSXMemberExpression' ? memberText(n.object) + '.' + n.property.name : n.name)

/** Is `fn` the callback of `something.map(fn)` (or flatMap)? */
export function mapCallOf(fn, parentOf) {
  const call = parentOf.get(fn)
  if (!call || call.type !== 'CallExpression' || call.arguments[0] !== fn) return null
  const callee = call.callee
  if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return null
  if (callee.computed || callee.property.type !== 'Identifier') return null
  if (callee.property.name !== 'map' && callee.property.name !== 'flatMap') return null
  return call
}

const paramNames = (fn) => {
  const names = new Set()
  const visit = (p) => {
    if (!p) return
    if (p.type === 'Identifier') names.add(p.name)
    else if (p.type === 'AssignmentPattern') visit(p.left)
    else if (p.type === 'RestElement') visit(p.argument)
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => visit(q.type === 'RestElement' ? q.argument : q.value))
    else if (p.type === 'ArrayPattern') p.elements.forEach(visit)
    else if (p.type === 'TSParameterProperty') visit(p.parameter)
  }
  fn.params.forEach(visit)
  return names
}

/**
 * Stamp one module. Returns null when there is nothing to do or the file
 * cannot be parsed, in which case it is served untouched - a page that
 * cannot be edited is better than a page that does not load.
 */
export function stampSource(code, file, prefix, { skip = new Set() } = {}) {
  let ast
  try {
    ast = parse(code, file)
  } catch {
    return null
  }
  if (ast.errors?.length) return null

  const parentOf = new Map()
  const elements = []
  walk(ast, (node, parent) => {
    parentOf.set(node, parent)
    if (node.type === 'JSXElement') elements.push(node)
  })
  if (!elements.length) return null

  /** fn -> name of the index parameter the stamp will read, or null. */
  const indexFor = new Map()
  const edits = []

  const indexName = (fn) => {
    if (indexFor.has(fn)) return indexFor.get(fn)
    let name = null
    const ps = fn.params
    if (ps.some((p) => p.type === 'RestElement')) name = null
    else if (ps.length >= 2) name = ps[1].type === 'Identifier' ? ps[1].name : null
    else {
      name = `__rt${fn.start}`
      if (ps.length === 1) {
        const p = ps[0]
        // The '(' in .map(item => ...) belongs to the CALL, not the
        // callback's parameters. Only look inside the callback's range.
        const prefix = code.slice(fn.start, p.start).trimEnd()
        if (prefix.endsWith('(')) edits.push({ at: p.end, text: `, ${name}` })
        else {
          edits.push({ at: p.start, text: '(' })
          edits.push({ at: p.end, text: `, ${name})` })
        }
      } else {
        // `() => ...` - give it both parameters
        const open = code.indexOf('(', fn.async ? code.indexOf('async', fn.start) + 5 : fn.start)
        if (open < 0 || open > fn.body.start) name = null
        else edits.push({ at: open + 1, text: `__rtv${fn.start}, ${name}` })
      }
    }
    indexFor.set(fn, name)
    return name
  }

  for (const el of elements) {
    const open = el.openingElement
    if (!stampable(open.name, skip)) continue
    if (open.attributes.some((a) => a.type === 'JSXAttribute' && a.name.name === ATTR)) continue

    // the maps this element sits inside, outermost first, and the names
    // their indices will be read through
    const maps = []
    const shadowed = new Set()
    for (let n = parentOf.get(el); n; n = parentOf.get(n)) {
      if (!isFunction(n)) continue
      if (mapCallOf(n, parentOf)) {
        const name = indexName(n)
        if (name && !shadowed.has(name)) maps.unshift({ start: n.start, name })
      }
      for (const p of paramNames(n)) shadowed.add(p)
    }

    const base = `${prefix}:${el.start}-${el.end}`
    const typeArgs = open.typeArguments ?? open.typeParameters
    const at = typeArgs ? typeArgs.end : open.name.end
    const value = maps.length ? `{\`${base}@${maps.map((m) => `${m.start}=\${${m.name}}`).join(';')}\`}` : `"${base}"`
    edits.push({ at, text: ` ${ATTR}=${value}` })
  }
  if (!edits.length) return null

  edits.sort((a, b) => b.at - a.at)
  let out = code
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.at)
  return { code: out, count: elements.length }
}

const STAMP_RE = /^([0-9a-f]{6})\.([0-9a-f]{8}):(\d+)-(\d+)(?:@(.*))?$/

/** "7f3a2c.1b9e4d0a:12-90@40=3;55=1" -> its parts. */
export function parseStamp(stamp) {
  const m = STAMP_RE.exec(String(stamp ?? ''))
  if (!m) return null
  const maps = []
  if (m[5]) {
    for (const part of m[5].split(';')) {
      const [fn, idx] = part.split('=')
      const index = /^\d+$/.test(idx) ? Number(idx) : null
      maps.push({ fn: Number(fn), index })
    }
  }
  return { pid: m[1], vid: m[2], start: Number(m[3]), end: Number(m[4]), maps, base: `${m[1]}.${m[2]}:${m[3]}-${m[4]}` }
}
