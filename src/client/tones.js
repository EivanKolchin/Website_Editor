/**
 * WHERE ONE COLOUR OF A GRADIENT IS. Hovering a gradient's colour in
 * Properties outlines the AREA that colour owns: the part of the shape
 * nearer to that stop than to either neighbour, halfway to each, and open
 * at the ends, since past the first and last stops the end colours carry
 * on. A band for a linear gradient, a ring for a radial one, a wedge for a
 * conic one. Pure geometry, no DOM: every mark is a list of closed rings
 * in page pixels, to be cut to the shape and drawn by the caller.
 *
 * Canvas gradients come with the arguments the page created them with and
 * the transform they were painted under (recorded by the head snippet); CSS
 * gradients are read from the computed background-image.
 */

/** The offsets a stop owns: halfway to the stop before it and halfway to the one after; open at the ends. */
export function bandOf(offsets, i) {
  const lo = i > 0 ? (offsets[i - 1] + offsets[i]) / 2 : -Infinity
  const hi = i < offsets.length - 1 ? (offsets[i] + offsets[i + 1]) / 2 : Infinity
  return [lo, hi]
}

/** The part of polygon `poly` on the side of the line through `p` that `n` points to. */
export function clipHalf(poly, p, n) {
  const side = (q) => (q.x - p.x) * n.x + (q.y - p.y) * n.y
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const sa = side(a)
    const sb = side(b)
    if (sa >= 0) out.push(a)
    if (sa >= 0 !== sb >= 0) {
      const t = sa / (sa - sb)
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

const corners = (r) => [
  { x: r.left, y: r.top },
  { x: r.right, y: r.top },
  { x: r.right, y: r.bottom },
  { x: r.left, y: r.bottom },
]
const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })

/**
 * A linear band: the shape between the lines of one colour at offsets lo
 * and hi. `at(t)` is the point at offset t, `grow` the way offsets grow,
 * `along` the way a line of one colour runs.
 */
function linearBand(at, grow, along, lo, hi, r) {
  let n = { x: -along.y, y: along.x }
  if (n.x * grow.x + n.y * grow.y < 0) n = { x: -n.x, y: -n.y }
  let poly = corners(r)
  if (Number.isFinite(lo)) poly = clipHalf(poly, at(lo), n)
  if (Number.isFinite(hi)) poly = clipHalf(poly, at(hi), { x: -n.x, y: -n.y })
  return poly.length >= 3 ? { kind: 'area', rings: [poly] } : null
}

/** A closed ellipse of 72 points, through `map` (an affine map keeps it an ellipse). */
function ellipse(map, cx, cy, rx, ry) {
  const out = []
  for (let i = 0; i < 72; i++) {
    const th = (i / 72) * Math.PI * 2
    out.push(map(cx + rx * Math.cos(th), cy + ry * Math.sin(th)))
  }
  return out
}

/** Between two rings, the outer one the shape itself when the band runs off the end. */
const annulus = (outer, inner, r) => ({ kind: 'area', rings: [outer ?? corners(r), inner].filter(Boolean), evenOdd: true })

/** A wedge from a centre, between two angles (radians, from `ray(th)`), as a polygon reaching past the shape. */
function wedge(c, ray, t0, t1) {
  const pts = [c]
  for (let k = 0; k <= 48; k++) pts.push(ray(t0 + ((t1 - t0) * k) / 48))
  return { kind: 'area', rings: [pts] }
}

/**
 * The area stop `i` owns in a canvas gradient. `offsets` are the
 * gradient's stops in order; `toPage` maps a canvas pixel to the page;
 * `rect` is the painted shape's box on the page.
 */
export function canvasToneArea(grad, offsets, i, toPage, rect) {
  const m = grad.m ?? [1, 0, 0, 1, 0, 0]
  const at = (x, y) => toPage(apply(m, x, y))
  const a = grad.args
  const [lo, hi] = bandOf(offsets, i)
  if (grad.kind === 'linear') {
    const [x0, y0, x1, y1] = a
    const dx = x1 - x0
    const dy = y1 - y0
    const P = (t) => at(x0 + dx * t, y0 + dy * t)
    const o = P(0)
    const e = P(1)
    // a line of one colour runs square to the gradient in the gradient's own space; mapped, it runs along the mapped square
    const q = at(x0 - dy, y0 + dx)
    return linearBand(P, { x: e.x - o.x, y: e.y - o.y }, { x: q.x - o.x, y: q.y - o.y }, lo, hi, rect)
  }
  if (grad.kind === 'radial') {
    const [x0, y0, r0, x1, y1, r1] = a
    const circle = (t) => {
      const tt = Math.max(0, t)
      const rr = r0 + (r1 - r0) * tt
      return rr > 0 ? ellipse(at, x0 + (x1 - x0) * tt, y0 + (y1 - y0) * tt, rr, rr) : null
    }
    return annulus(Number.isFinite(hi) ? circle(hi) : null, Number.isFinite(lo) ? circle(lo) : null, rect)
  }
  if (grad.kind === 'conic') {
    const [start, cx, cy] = a
    const far = Math.max(rect.width, rect.height) * 4 + 1e4
    const ray = (t) => at(cx + Math.cos(start + t * Math.PI * 2) * far, cy + Math.sin(start + t * Math.PI * 2) * far)
    return wedge(at(cx, cy), ray, Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 1)
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  CSS gradients                                                       */
/* ------------------------------------------------------------------ */

/** Split on commas that are not inside brackets. */
function topLevel(s, sep = ',') {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === sep && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const SIDES = { top: 0, right: 90, bottom: 180, left: 270 }
const COLOR_RE = /^(#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)|[a-z]+)/i

/**
 * The first gradient of a computed background-image: its kind, its angle
 * for a linear one (degrees, CSS's own: 0 points up, 90 to the right) and
 * its stops at offsets 0..1, positions the browser left out filled in
 * evenly the way it fills them.
 */
export function parseCssGradient(bg) {
  const m = /(repeating-)?(linear|radial|conic)-gradient\(/i.exec(bg ?? '')
  if (!m) return null
  let depth = 0
  let end = m.index + m[0].length
  for (let i = end - 1; i < bg.length; i++) {
    if (bg[i] === '(') depth++
    else if (bg[i] === ')' && --depth === 0) {
      end = i
      break
    }
  }
  const body = bg.slice(m.index + m[0].length, end)
  const parts = topLevel(body)
  const kind = m[2].toLowerCase()
  // a linear gradient runs to the bottom unless told otherwise; a conic one starts at the top
  let angle = kind === 'conic' ? 0 : 180
  if ((parts.length && !COLOR_RE.test(parts[0])) || /^(to |from |at |circle|ellipse|closest|farthest)/i.test(parts[0] ?? '')) {
    const head = parts.shift()
    const deg = /(-?[\d.]+)(deg|turn|rad|grad)/i.exec(head)
    if (deg) angle = parseFloat(deg[1]) * ({ deg: 1, turn: 360, rad: 180 / Math.PI, grad: 0.9 }[deg[2].toLowerCase()] ?? 1)
    else if (/^to /i.test(head)) {
      const words = head.slice(3).trim().split(/\s+/)
      const vals = words.map((w) => SIDES[w.toLowerCase()]).filter((v) => v != null)
      if (vals.length === 1) angle = vals[0]
      else if (vals.length === 2) angle = (vals.includes(0) && vals.includes(270) ? 315 : (vals[0] + vals[1]) / 2)
    }
  }
  const stops = []
  for (const p of parts) {
    const c = COLOR_RE.exec(p)
    if (!c) continue
    const pos = [...p.slice(c[0].length).matchAll(/(-?[\d.]+)%/g)].map((x) => parseFloat(x[1]) / 100)
    if (!pos.length) stops.push({ text: c[0], at: null })
    for (const at of pos) stops.push({ text: c[0], at })
  }
  if (!stops.length) return null
  if (stops[0].at == null) stops[0].at = 0
  if (stops[stops.length - 1].at == null) stops[stops.length - 1].at = 1
  // the gaps between known positions are shared out evenly
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].at != null) continue
    let j = i
    while (stops[j].at == null) j++
    const a = stops[i - 1].at
    const b = stops[j].at
    for (let k = i; k < j; k++) stops[k].at = a + ((b - a) * (k - i + 1)) / (j - i + 1)
  }
  return { kind, angle, repeating: !!m[1], stops }
}

/** The area stop `i` owns in a CSS gradient on an element whose box on the page is `r`. */
export function cssToneArea(g, i, r) {
  const [lo, hi] = bandOf(g.stops.map((s) => s.at), i)
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  if (g.kind === 'linear') {
    const th = (g.angle * Math.PI) / 180
    const dir = { x: Math.sin(th), y: -Math.cos(th) }
    // the gradient line is as long as it must be for the corners to take its ends
    const len = Math.abs(r.width * Math.sin(th)) + Math.abs(r.height * Math.cos(th))
    const P = (t) => ({ x: cx + dir.x * (t - 0.5) * len, y: cy + dir.y * (t - 0.5) * len })
    return linearBand(P, dir, { x: -dir.y, y: dir.x }, lo, hi, r)
  }
  if (g.kind === 'radial') {
    // the default ellipse reaches the farthest corner
    const fx = (r.width / 2) * Math.SQRT2
    const fy = (r.height / 2) * Math.SQRT2
    const ring = (t) => (t > 0 ? ellipse((x, y) => ({ x, y }), cx, cy, fx * t, fy * t) : null)
    return annulus(Number.isFinite(hi) ? ring(hi) : null, Number.isFinite(lo) ? ring(lo) : null, r)
  }
  const far = (r.width + r.height) * 2
  const ray = (t) => {
    const th = ((g.angle + t * 360) * Math.PI) / 180
    return { x: cx + Math.sin(th) * far, y: cy - Math.cos(th) * far }
  }
  return wedge({ x: cx, y: cy }, ray, Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 1)
}
