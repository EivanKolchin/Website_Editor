/**
 * SMART GUIDES AND SNAPPING.
 *
 * While something is dragged, its left edge, centre and right edge (and its
 * top, middle and bottom) are compared with the same lines of everything
 * near it: its container, its neighbours, the window's centre. Within a few
 * pixels of a match it jumps to the exact line and a guide is drawn along it,
 * so "almost aligned" becomes aligned without a steady hand. The midpoint
 * between its two nearest neighbours is a line too, which is how equal
 * spacing snaps. Resizing snaps edges and matching sizes the same way.
 *
 * Everything here works in screen pixels on rectangles taken when the
 * gesture starts; the caller turns the snapped screen delta into the
 * element's own frame, so snapping is the same for HTML and SVG.
 */

export const SNAP_PX = 5

export const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, cx: left + width / 2, cy: top + height / 2 })

/** The box around several rectangles. */
export const unionBox = (rs) => {
  const left = Math.min(...rs.map((r) => r.left))
  const top = Math.min(...rs.map((r) => r.top))
  return box(left, top, Math.max(...rs.map((r) => r.right)) - left, Math.max(...rs.map((r) => r.bottom)) - top)
}
export const rectOf = (el) => {
  const r = el.getBoundingClientRect()
  return box(r.left, r.top, r.width, r.height)
}
const shift = (r, d) => box(r.left + d.x, r.top + d.y, r.width, r.height)

const xLines = (t) => (t.kind === 'viewport' ? [t.cx] : t.kind === 'mid-x' ? [t.at] : t.kind === 'mid-y' ? [] : [t.left, t.cx, t.right])
const yLines = (t) => (t.kind === 'viewport' ? [t.cy] : t.kind === 'mid-y' ? [t.at] : t.kind === 'mid-x' ? [] : [t.top, t.cy, t.bottom])
const RANK = { container: 4, element: 3, 'mid-x': 3, 'mid-y': 3, viewport: 1 }

/** How far apart two boxes are: 0 when they overlap. */
function gap(a, b) {
  const dx = Math.max(0, a.left - b.right, b.left - a.right)
  const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom)
  return Math.hypot(dx, dy)
}

/**
 * What an element can line up with - and, as much, what it should NOT.
 *
 * A design tool snaps to what is around the thing being moved, not to every
 * layer in the document, and on a real page that difference is the whole
 * feature: a scene of fifty sprites puts a line every few pixels, so
 * snapping to all of them means nothing can be put anywhere by hand. So:
 *
 *  - the box that visibly contains it, its edges and centre
 *  - its NEAREST neighbours, at most a dozen, by the gap between boxes
 *  - at most two backdrops it sits on (an image behind it is not a
 *    neighbour, and with a gap of zero it would crowd every real one out)
 *  - the window's centre lines
 *
 * Its own ancestors and descendants are never targets: a thing lined up
 * with its own wrapper has moved nowhere.
 */
/**
 * Snap targets for several elements moved as one: their union is the box
 * that snaps, their nearest common container is the container, and none of
 * them - nor anything inside or around one of them - is a target.
 */
export function collectGroupTargets(els, opts = {}) {
  return collectTargets(els[0], { ...opts, group: els })
}

const unionOf = (els) => unionBox(els.map(rectOf))

export function collectTargets(el, { host, isLocked, neighbours: near = 12, group = null } = {}) {
  const me = group ? unionOf(group) : rectOf(el)
  const members = group ?? [el]
  const related = (n) => members.some((m) => n === m || m.contains(n) || n.contains(m))
  const out = []
  // the container: for a group, the nearest ancestor every member is inside
  let start = el.parentElement || el.parentNode
  if (group) while (start && start.nodeType === 1 && !group.every((m) => start.contains(m))) start = start.parentElement
  for (let p = start; p && p.nodeType === 1 && p !== document.documentElement; p = p.parentElement || p.parentNode) {
    const r = rectOf(p)
    if (r.width < 1 || r.height < 1) continue
    const contains = r.left <= me.left + 0.5 && r.right >= me.right - 0.5 && r.top <= me.top + 0.5 && r.bottom >= me.bottom - 0.5
    if (contains && r.width * r.height >= me.width * me.height * 1.3) {
      out.push({ ...r, kind: 'container', el: p })
      break
    }
  }
  out.push({ ...box(0, 0, innerWidth, innerHeight), kind: 'viewport' })
  const beside = []
  const behind = []
  for (const n of document.querySelectorAll('[data-rt]')) {
    if (related(n) || host?.contains(n) || isLocked?.(n)) continue
    const r = rectOf(n)
    if (r.width < 4 || r.height < 4) continue
    // only what can be seen: a line to something below the fold aligns to nothing visible
    if (r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight) continue
    const covers = r.left <= me.left && r.right >= me.right && r.top <= me.top && r.bottom >= me.bottom
    if (covers) behind.push({ ...r, kind: 'element', el: n, dist: 0, area: r.width * r.height })
    else beside.push({ ...r, kind: 'element', el: n, dist: gap(me, r) })
  }
  const seen = new Set()
  const take = (list, max) => {
    let n = 0
    for (const c of list) {
      if (n >= max) break
      // a wrapper and its only child often share one box: one copy is enough
      const key = `${Math.round(c.left)},${Math.round(c.top)},${Math.round(c.width)},${Math.round(c.height)}`
      if (seen.has(key)) continue
      // seen means seen: a layer faded out by an ANCESTOR is still in the
      // layout with opacity 1 of its own, and would draw guides to nothing
      if (c.el.checkVisibility && !c.el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
      const cs = getComputedStyle(c.el)
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0 || cs.display === 'contents') continue
      seen.add(key)
      out.push(c)
      n++
    }
  }
  take(beside.sort((a, b) => a.dist - b.dist), near)
  take(behind.sort((a, b) => a.area - b.area), 2)
  return { me, targets: out }
}

/**
 * Leave out what has moved since its box was taken: a drifting cloud or a
 * floating seed is somewhere else by the next frame, and lining up with it
 * means nothing. Called a moment after collecting - on the first move of a
 * drag - so anything animated has had time to show itself.
 */
export function dropMoving(targets) {
  return targets.filter((t) => {
    if (!t.el || t.kind === 'container') return true
    const r = t.el.getBoundingClientRect()
    return Math.abs(r.left - t.left) < 1 && Math.abs(r.top - t.top) < 1 && Math.abs(r.width - t.width) < 1 && Math.abs(r.height - t.height) < 1
  })
}

/** The nearest box on each side of `r` that overlaps it across the other axis. */
function neighbours(r, targets) {
  const n = { left: null, right: null, up: null, down: null }
  for (const t of targets) {
    if (t.kind !== 'element') continue
    const overlapY = t.top < r.bottom && t.bottom > r.top
    const overlapX = t.left < r.right && t.right > r.left
    if (overlapY && t.right <= r.left + 0.5 && (!n.left || t.right > n.left.right)) n.left = t
    if (overlapY && t.left >= r.right - 0.5 && (!n.right || t.left < n.right.left)) n.right = t
    if (overlapX && t.bottom <= r.top + 0.5 && (!n.up || t.bottom > n.up.bottom)) n.up = t
    if (overlapX && t.top >= r.bottom - 0.5 && (!n.down || t.top < n.down.top)) n.down = t
  }
  return n
}

/** Midpoints between facing neighbours, as lines: centring there makes the two gaps equal. */
function spacingLines(r, targets) {
  const n = neighbours(r, targets)
  const out = []
  if (n.left && n.right && n.right.left - n.left.right >= r.width) out.push({ kind: 'mid-x', at: (n.left.right + n.right.left) / 2, a: n.left, b: n.right })
  if (n.up && n.down && n.down.top - n.up.bottom >= r.height) out.push({ kind: 'mid-y', at: (n.up.bottom + n.down.top) / 2, a: n.up, b: n.down })
  return out
}

function best(current, cand) {
  if (!current) return cand
  if (cand.ad < current.ad - 0.01) return cand
  if (Math.abs(cand.ad - current.ad) <= 0.01 && cand.score > current.score) return cand
  return current
}

/**
 * Snap a drag. `me0` is the element's box when the drag began, `d` the raw
 * pointer delta. Returns the adjusted delta and the guides to draw.
 */
export function snapMove(me0, d, targets, { threshold = SNAP_PX, off = false } = {}) {
  const raw = shift(me0, d)
  if (off) return { d, guides: gapGuides(raw, targets) }
  const all = [...targets, ...spacingLines(raw, targets)]
  const xs = [raw.left, raw.cx, raw.right]
  const ys = [raw.top, raw.cy, raw.bottom]
  let bx = null
  let by = null
  for (const t of all) {
    const tx = xLines(t)
    const ty = yLines(t)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < tx.length; j++) {
        const delta = tx[j] - xs[i]
        const ad = Math.abs(delta)
        if (ad <= threshold) bx = best(bx, { delta, ad, score: RANK[t.kind] + (tx.length === 3 && i === j ? 1 : 0) })
      }
      for (let j = 0; j < ty.length; j++) {
        const delta = ty[j] - ys[i]
        const ad = Math.abs(delta)
        if (ad <= threshold) by = best(by, { delta, ad, score: RANK[t.kind] + (ty.length === 3 && i === j ? 1 : 0) })
      }
    }
  }
  const out = { x: d.x + (bx?.delta ?? 0), y: d.y + (by?.delta ?? 0) }
  const r = shift(me0, out)
  return { d: out, snapped: { x: !!bx, y: !!by }, guides: [...alignmentGuides(r, all), ...gapGuides(r, targets)] }
}

/**
 * Lines along every exact match between `r` and the targets: the faint
 * guides shown on a still selection and the strong ones while dragging.
 * At most a few per axis, nearest first, so a page full of shared left
 * edges does not turn into a grid.
 */
export function alignmentGuides(r, targets, { tolerance = 0.6, perAxis = 3 } = {}) {
  const xs = [r.left, r.cx, r.right]
  const ys = [r.top, r.cy, r.bottom]
  const vertical = new Map()
  const horizontal = new Map()
  const add = (map, key, span, t) => {
    const k = Math.round(key * 2) / 2
    const cur = map.get(k)
    const d = t.kind === 'element' ? t.dist ?? gap(r, t) : t.kind === 'container' ? -1 : 9999
    if (!cur) map.set(k, { at: k, from: span[0], to: span[1], d, kind: t.kind })
    else {
      cur.from = Math.min(cur.from, span[0])
      cur.to = Math.max(cur.to, span[1])
      cur.d = Math.min(cur.d, d)
    }
  }
  for (const t of targets) {
    // equal spacing is shown as two equal labelled gaps (gapGuides), not as a line
    if (t.kind === 'mid-x' || t.kind === 'mid-y') continue
    for (const lx of xLines(t)) {
      if (xs.some((v) => Math.abs(v - lx) <= tolerance)) {
        const span = t.kind === 'viewport' ? [0, innerHeight] : [Math.min(r.top, t.top), Math.max(r.bottom, t.bottom)]
        add(vertical, lx, span, t)
      }
    }
    for (const ly of yLines(t)) {
      if (ys.some((v) => Math.abs(v - ly) <= tolerance)) {
        const span = t.kind === 'viewport' ? [0, innerWidth] : [Math.min(r.left, t.left), Math.max(r.right, t.right)]
        add(horizontal, ly, span, t)
      }
    }
  }
  const pick = (map) => [...map.values()].sort((a, b) => a.d - b.d).slice(0, perAxis)
  return [
    ...pick(vertical).map((g) => ({ type: 'line', x1: g.at, y1: g.from, x2: g.at, y2: g.to, dashed: g.kind === 'viewport' })),
    ...pick(horizontal).map((g) => ({ type: 'line', x1: g.from, y1: g.at, x2: g.to, y2: g.at, dashed: g.kind === 'viewport' })),
  ]
}

/** The gaps to the nearest neighbour on each side, labelled, as while dragging in a design tool. */
export function gapGuides(r, targets, { max = 320 } = {}) {
  const n = neighbours(r, targets)
  const out = []
  const midY = (a) => (Math.max(r.top, a.top) + Math.min(r.bottom, a.bottom)) / 2
  const midX = (a) => (Math.max(r.left, a.left) + Math.min(r.right, a.right)) / 2
  const push = (x1, y1, x2, y2, v) => v > 0.5 && v <= max && out.push({ type: 'gap', x1, y1, x2, y2, label: String(Math.round(v)) })
  if (n.left) push(n.left.right, midY(n.left), r.left, midY(n.left), r.left - n.left.right)
  if (n.right) push(r.right, midY(n.right), n.right.left, midY(n.right), n.right.left - r.right)
  if (n.up) push(midX(n.up), n.up.bottom, midX(n.up), r.top, r.top - n.up.bottom)
  if (n.down) push(midX(n.down), r.bottom, midX(n.down), n.down.top, n.down.top - r.bottom)
  return out
}

/**
 * Snap a resize about the element's centre: an edge onto a line, the
 * element to the width or height of a neighbour, or back to its own
 * original size. Returns the scale factor to use and what it matched.
 */
export function snapScale(me0, kRaw, targets, { threshold = SNAP_PX, off = false, original = null } = {}) {
  if (off) return { k: kRaw, guides: [] }
  const c = { x: me0.cx, y: me0.cy }
  const hw = me0.width / 2
  const hh = me0.height / 2
  let pick = null
  const consider = (k, err, guide) => {
    if (k > 0.02 && err <= threshold && (!pick || err < pick.err)) pick = { k, err, guide }
  }
  for (const t of targets) {
    for (const lx of xLines(t)) {
      const k = Math.abs(lx - c.x) / hw
      consider(k, Math.abs(k - kRaw) * hw, { type: 'edge', axis: 'x', at: lx, t })
    }
    for (const ly of yLines(t)) {
      const k = Math.abs(ly - c.y) / hh
      consider(k, Math.abs(k - kRaw) * hh, { type: 'edge', axis: 'y', at: ly, t })
    }
    if (t.kind === 'element') {
      consider(t.width / me0.width, Math.abs(t.width / me0.width - kRaw) * hw, { type: 'width', t })
      consider(t.height / me0.height, Math.abs(t.height / me0.height - kRaw) * hh, { type: 'height', t })
    }
  }
  if (original) consider(original, Math.abs(original - kRaw) * Math.max(hw, hh), { type: 'original' })
  const k = pick ? pick.k : kRaw
  const r = box(c.x - hw * k, c.y - hh * k, me0.width * k, me0.height * k)
  const guides = []
  if (pick?.guide.type === 'edge') {
    const g = pick.guide
    if (g.axis === 'x') guides.push({ type: 'line', x1: g.at, y1: Math.min(r.top, g.t.top ?? r.top), x2: g.at, y2: Math.max(r.bottom, g.t.bottom ?? r.bottom), dashed: g.t.kind === 'viewport' })
    else guides.push({ type: 'line', x1: Math.min(r.left, g.t.left ?? r.left), y1: g.at, x2: Math.max(r.right, g.t.right ?? r.right), y2: g.at, dashed: g.t.kind === 'viewport' })
  } else if (pick?.guide.type === 'width' || pick?.guide.type === 'height') {
    const t = pick.guide.t
    const w = pick.guide.type === 'width'
    guides.push(w ? { type: 'size', x1: r.left, y1: r.bottom + 10, x2: r.right, y2: r.bottom + 10, label: `= ${Math.round(r.width)}` } : { type: 'size', x1: r.right + 10, y1: r.top, x2: r.right + 10, y2: r.bottom, label: `= ${Math.round(r.height)}` })
    guides.push(w ? { type: 'size', x1: t.left, y1: t.bottom + 10, x2: t.right, y2: t.bottom + 10, label: '' } : { type: 'size', x1: t.right + 10, y1: t.top, x2: t.right + 10, y2: t.bottom, label: '' })
  }
  return { k, guides, matched: pick?.guide.type ?? null }
}

/** Turn near a right angle, or a diagonal, and it settles on it. */
export function snapAngle(theta, { off = false } = {}) {
  if (off) return { theta, snapped: false }
  const right = Math.round(theta / 90) * 90
  if (Math.abs(theta - right) <= 3) return { theta: right, snapped: true }
  const diag = Math.round(theta / 45) * 45
  if (Math.abs(theta - diag) <= 2) return { theta: diag, snapped: true }
  return { theta, snapped: false }
}

/* ------------------------------------------------------------------ */
/*  drawing                                                            */
/* ------------------------------------------------------------------ */

const NS = 'http://www.w3.org/2000/svg'

/** The layer guides are drawn in: one SVG over the viewport, redrawn per frame of a gesture. */
export function createGuideLayer(parent) {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'guides')
  parent.append(svg)
  const el = (tag, attrs) => {
    const n = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
    return n
  }
  const px = (v) => Math.round(v) + 0.5
  return {
    draw(guides, { faint = false } = {}) {
      svg.replaceChildren()
      svg.setAttribute('width', innerWidth)
      svg.setAttribute('height', innerHeight)
      svg.classList.toggle('faint', faint)
      for (const g of guides) {
        if (g.type === 'line') {
          svg.append(el('line', { x1: px(g.x1), y1: px(g.y1), x2: px(g.x2), y2: px(g.y2), class: g.dashed ? 'g dashed' : 'g' }))
          if (!g.dashed) {
            for (const [x, y] of [[g.x1, g.y1], [g.x2, g.y2]]) svg.append(el('path', { d: `M${px(x) - 2.5} ${px(y) - 2.5}l5 5m0 -5l-5 5`, class: 'g x' }))
          }
        } else if (g.type === 'gap' || g.type === 'size') {
          const vertical = Math.abs(g.x1 - g.x2) < 0.5
          svg.append(el('line', { x1: px(g.x1), y1: px(g.y1), x2: px(g.x2), y2: px(g.y2), class: 'g gap' }))
          const tick = vertical ? (x, y) => `M${px(x) - 3} ${px(y)}h6` : (x, y) => `M${px(x)} ${px(y) - 3}v6`
          svg.append(el('path', { d: `${tick(g.x1, g.y1)}${tick(g.x2, g.y2)}`, class: 'g gap' }))
          if (g.label) {
            const mx = (g.x1 + g.x2) / 2
            const my = (g.y1 + g.y2) / 2
            const w = 7 * g.label.length + 10
            const lbl = el('g', { class: 'label', transform: `translate(${Math.round(mx - w / 2)} ${Math.round(my - 8)})` })
            lbl.append(el('rect', { width: w, height: 16, rx: 4 }))
            const t = el('text', { x: w / 2, y: 11.5 })
            t.textContent = g.label
            lbl.append(t)
            svg.append(lbl)
          }
        }
      }
    },
    clear() {
      svg.replaceChildren()
    },
  }
}
