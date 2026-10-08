/**
 * READING REACT FROM THE OUTSIDE.
 *
 * The stamp on a DOM node says where THAT node was written - often inside a
 * component used many times, like the <image> inside Sprite. What a person
 * clicked is usually the USAGE: <Sprite x={238} .../> on line 390 of the
 * page. React keeps that usage's props on its fiber, and the stamp is one of
 * them, so walking up the fiber tree from the node recovers every place the
 * pixel was written, innermost first. No React internals are written to,
 * and none are needed beyond the public shape every devtool reads.
 */

export const ATTR = 'data-rt'
let fiberKey = null

export function fiberOf(node) {
  if (!node || typeof node !== 'object') return null
  if (!fiberKey || !(fiberKey in node)) fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$')) ?? fiberKey
  return fiberKey ? node[fiberKey] ?? null : null
}

const HOST = new Set([5, 26, 27])
export const isHost = (f) => HOST.has(f?.tag)
const isRoot = (f) => f?.tag === 3
const isPortal = (f) => f?.tag === 4

export const stampOf = (f) => {
  const p = f?.memoizedProps
  return p && typeof p === 'object' && typeof p[ATTR] === 'string' ? p[ATTR] : null
}

export const baseOf = (stamp) => (stamp ? stamp.split('@')[0] : stamp)

export function nameOf(f) {
  const t = f?.type
  if (!t) return null
  if (typeof t === 'string') return t
  return t.displayName || t.name || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name || 'Component'
}

/** How many host nodes a component renders at its top level; stops counting at 2. */
function topHosts(f) {
  let n = 0
  const stack = f.child ? [f.child] : []
  while (stack.length && n < 2) {
    const x = stack.pop()
    if (x.sibling) stack.push(x.sibling)
    if (isHost(x) || x.tag === 6) {
      if (isHost(x)) n++
      continue
    }
    if (isPortal(x)) continue
    if (x.child) stack.push(x.child)
  }
  return n
}

/**
 * The editable unit a DOM element belongs to: its own stamp, then the
 * stamps of every component usage whose ONLY rendered root it is. A
 * component that renders two roots is not one visible thing, so the walk
 * stops there.
 */
export function unitFor(el) {
  const fiber = fiberOf(el)
  const stamps = []
  const names = []
  const own = el.getAttribute?.(ATTR) || stampOf(fiber)
  const tag = el.tagName ? el.tagName.toLowerCase() : '?'
  if (own) {
    stamps.push(own)
    names.push(tag)
  }
  // the props each stamp was rendered with: what an adapter reads its anchor from
  const propsByStamp = {}
  if (own) propsByStamp[own] = fiber?.memoizedProps ?? attrsOf(el)
  if (fiber) {
    for (let f = fiber.return; f && !isHost(f) && !isRoot(f) && !isPortal(f); f = f.return) {
      const s = stampOf(f)
      if (!s || stamps.includes(s)) continue
      if (topHosts(f) !== 1) break
      stamps.push(s)
      names.push(nameOf(f))
      propsByStamp[s] = f.memoizedProps
    }
  }
  const dangerous = !!fiber?.memoizedProps?.dangerouslySetInnerHTML
  return { el, stamps, names, label: names[names.length - 1] ?? tag, tag, svg: isSvgChild(el), propsByStamp, dangerous }
}

const attrsOf = (el) => {
  const out = {}
  for (const a of el.attributes ?? []) out[a.name] = a.value
  return out
}

/** An SVG element drawn in an SVG coordinate system - not the outer <svg>, which is laid out like any box. */
export const isSvgChild = (el) => typeof SVGElement !== 'undefined' && el instanceof SVGElement && !!el.ownerSVGElement

/** Units from an element up to the document, innermost first, skipping anything without a stamp. */
export function unitChain(el, isLocked, limit = 14) {
  const out = []
  for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && out.length < limit; n = n.parentElement || n.parentNode) {
    if (isLocked?.(n)) continue
    const u = unitFor(n)
    if (u.stamps.length) out.push(u)
  }
  return out
}

/** The fiber root an element is rendered under, for counting instances. */
function rootFiberOf(el) {
  let f = fiberOf(el)
  while (f && !isRoot(f)) f = f.return
  return f?.stateNode?.current ?? null
}

/**
 * How many times each stamp is rendered on the page, keyed by its base
 * (the stamp without the map index). A host node carrying the same stamp
 * as the component above it - a forwarded prop - is the same instance, not
 * a second one.
 */
export function countStamps(anyEl) {
  const counts = new Map()
  const root = rootFiberOf(anyEl)
  if (!root) {
    for (const n of document.querySelectorAll(`[${ATTR}]`)) {
      const b = baseOf(n.getAttribute(ATTR))
      counts.set(b, (counts.get(b) ?? 0) + 1)
    }
    return counts
  }
  const stack = [[root, null]]
  while (stack.length) {
    const [f, parentStamp] = stack.pop()
    const s = stampOf(f)
    let carry = parentStamp
    if (s) {
      if (s !== parentStamp) {
        const b = baseOf(s)
        counts.set(b, (counts.get(b) ?? 0) + 1)
      }
      carry = s
    }
    if (f.sibling) stack.push([f.sibling, parentStamp])
    if (f.child) stack.push([f.child, carry])
  }
  return counts
}

/** Every rendered element of a stamp's base: the instances a shared edit will reach. */
export function peersOf(anyEl, stamp) {
  const base = baseOf(stamp)
  const out = []
  const root = rootFiberOf(anyEl)
  if (!root) return [...document.querySelectorAll(`[${ATTR}]`)].filter((n) => baseOf(n.getAttribute(ATTR)) === base)
  const stack = [root]
  while (stack.length) {
    const f = stack.pop()
    if (f.sibling) stack.push(f.sibling)
    const s = stampOf(f)
    if (s && baseOf(s) === base) {
      const host = isHost(f) ? f : firstHost(f)
      if (host?.stateNode && !out.includes(host.stateNode)) out.push(host.stateNode)
      continue
    }
    if (f.child) stack.push(f.child)
  }
  return out
}

function firstHost(f) {
  const stack = f.child ? [f.child] : []
  while (stack.length) {
    const x = stack.shift()
    if (isHost(x)) return x
    if (x.child) stack.push(x.child)
    if (x.sibling) stack.push(x.sibling)
  }
  return null
}
