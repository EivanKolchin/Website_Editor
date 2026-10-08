/**
 * MOVE, ROTATE, SCALE, FLIP - PREVIEWED EXACTLY AS THEY WILL BE SAVED.
 *
 * Every element's edit is one 2D affine N, expressed in that element's own
 * FRAME: the coordinate system its CSS `translate` moves it in. N is
 * composed gesture by gesture (a drag is T(d)·N, a rotation is
 * T(c)·R·T(-c)·N about the element's current centre) and the preview is the
 * CSS individual-transform properties - translate, rotate, scale - that
 * reproduce N on top of whatever the element already does. Those three
 * properties compose with an element's own `transform`, so an element an
 * animation rewrites every frame still previews correctly.
 *
 * The frame is MEASURED, not derived: nudge the element by a known
 * translate and see where it lands, scale it by a half and see which point
 * stays put. That captures every ancestor transform, SVG viewBox, zoom and
 * transform-origin the page has, without having to know about any of them.
 */

export const I = () => [1, 0, 0, 1, 0, 0]

/** [a, b, c, d, e, f] maps (x, y) to (a x + c y + e, b x + d y + f), as DOMMatrix does. */
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]
export const apply = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })
export const applyLin = (m, v) => ({ x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y })
export const T = (x, y) => [1, 0, 0, 1, x, y]
export const R = (deg) => {
  const r = (deg * Math.PI) / 180
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]
}
export const S = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0]
export const about = (c, m) => mul(T(c.x, c.y), mul(m, T(-c.x, -c.y)))
export function inv(m) {
  const det = m[0] * m[3] - m[1] * m[2]
  if (Math.abs(det) < 1e-12) return null
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}
export const isIdentity = (m, eps = 1e-4) => Math.abs(m[0] - 1) < eps && Math.abs(m[1]) < eps && Math.abs(m[2]) < eps && Math.abs(m[3] - 1) < eps && Math.abs(m[4]) < 0.01 && Math.abs(m[5]) < 0.01

/**
 * Split the linear part into rotate(θ) · scale(sx, sy), choosing the
 * reading a person would: a horizontal flip comes out as scale(-1, 1), not
 * as a half turn and a vertical flip, which is the same matrix.
 */
export function decompose(m) {
  let sx = Math.hypot(m[0], m[1])
  let theta = (Math.atan2(m[1], m[0]) * 180) / Math.PI
  const det = m[0] * m[3] - m[1] * m[2]
  let sy = sx === 0 ? 0 : det / sx
  if (Math.abs(theta) > 90) {
    theta = theta > 0 ? theta - 180 : theta + 180
    sx = -sx
    sy = -sy
  }
  return { theta: clean(theta), sx: clean(sx), sy: clean(sy), tx: m[4], ty: m[5] }
}
const clean = (v) => (Math.abs(v) < 1e-9 ? 0 : v)

export const num = (v, places = 2) => {
  const r = Number(v.toFixed(places))
  return Object.is(r, -0) ? 0 : r
}

const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })

function parseTranslate(v) {
  if (!v || v === 'none') return { x: 0, y: 0 }
  const parts = v.trim().split(/\s+/).map((p) => parseFloat(p))
  return { x: parts[0] || 0, y: parts[1] || 0 }
}
function parseRotate(v) {
  if (!v || v === 'none') return 0
  const m = /(-?[\d.]+)(deg|rad|turn|grad)?/.exec(v)
  if (!m) return 0
  const n = parseFloat(m[1])
  return m[2] === 'rad' ? (n * 180) / Math.PI : m[2] === 'turn' ? n * 360 : m[2] === 'grad' ? n * 0.9 : n
}
function parseScale(v) {
  if (!v || v === 'none') return { x: 1, y: 1 }
  const parts = v.trim().split(/\s+/).map((p) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p)))
  return { x: parts[0] ?? 1, y: parts[1] ?? parts[0] ?? 1 }
}

/** The inline translate/rotate/scale an element already has, as written by its own code. */
export function readBase(el) {
  const s = el.style
  const t = parseTranslate(s.translate)
  const r = parseRotate(s.rotate)
  const k = parseScale(s.scale)
  return { t, L: mul(R(r), S(k.x, k.y)), raw: { translate: s.translate, rotate: s.rotate, scale: s.scale } }
}

/**
 * Measure an element's frame. Runs synchronously - no frame passes, so no
 * animation moves the element between the probes.
 */
export function measure(el, svg) {
  const s = el.style
  const keep = { translate: s.translate, rotate: s.rotate, scale: s.scale }
  const rect = () => center(el.getBoundingClientRect())
  const now = el.getBoundingClientRect()
  s.translate = 'none'
  s.rotate = 'none'
  s.scale = 'none'
  const r0 = rect()
  s.translate = '100px 0px'
  const r1 = rect()
  s.translate = '0px 100px'
  const r2 = rect()
  s.translate = 'none'
  s.scale = '0.5'
  const rh = rect()
  s.translate = keep.translate
  s.rotate = keep.rotate
  s.scale = keep.scale
  const A = [(r1.x - r0.x) / 100, (r1.y - r0.y) / 100, (r2.x - r0.x) / 100, (r2.y - r0.y) / 100, 0, 0]
  const Ainv = inv(A)
  if (!Ainv || now.width + now.height === 0) return null
  const o = { x: 2 * rh.x - r0.x, y: 2 * rh.y - r0.y }
  let P = null
  let Pinv = null
  if (svg) {
    const parent = el.parentNode
    const ctm = parent?.getScreenCTM ? parent.getScreenCTM() : null
    if (ctm) {
      P = [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f]
      Pinv = inv(P)
    }
  }
  return { A, Ainv, o, P, Pinv, svg: !!(svg && Pinv), size: { w: now.width, h: now.height } }
}

/**
 * Frame coordinates: for SVG, the parent's user space (absolute, so a saved
 * wrapper can name a centre); for HTML, offsets from the transform origin.
 */
export function toFrame(fr, p) {
  if (fr.svg) return apply(fr.Pinv, p)
  return applyLin(fr.Ainv, { x: p.x - fr.o.x, y: p.y - fr.o.y })
}
export function toScreen(fr, p) {
  if (fr.svg) return apply(fr.P, p)
  const v = applyLin(fr.A, p)
  return { x: v.x + fr.o.x, y: v.y + fr.o.y }
}
export const vecToFrame = (fr, v) => applyLin(fr.svg ? [fr.Pinv[0], fr.Pinv[1], fr.Pinv[2], fr.Pinv[3], 0, 0] : fr.Ainv, v)

/** The transform origin in frame coordinates. */
const originOf = (fr) => (fr.svg ? apply(fr.Pinv, fr.o) : { x: 0, y: 0 })

/** The CSS translate/rotate/scale that show N on top of the element's own base values. */
export function cssFor(state) {
  const { N, base, frame } = state
  const o = originOf(frame)
  // N relative to the origin: T(-o) · N · T(o)
  const Nr = mul(T(-o.x, -o.y), mul(N, T(o.x, o.y)))
  const t0 = applyLin(Nr, base.t)
  const L = mul([Nr[0], Nr[1], Nr[2], Nr[3], 0, 0], base.L)
  const d = decompose(L)
  return { tx: Nr[4] + t0.x, ty: Nr[5] + t0.y, theta: d.theta, sx: d.sx, sy: d.sy }
}

export function cssStrings(c) {
  const translate = Math.abs(c.tx) < 0.01 && Math.abs(c.ty) < 0.01 ? null : `${num(c.tx)}px ${num(c.ty)}px`
  const rotate = Math.abs(c.theta) < 0.01 ? null : `${num(c.theta)}deg`
  const sx = num(c.sx, 3)
  const sy = num(c.sy, 3)
  const scale = sx === 1 && sy === 1 ? null : sx === sy ? `${sx}` : `${sx} ${sy}`
  return { translate, rotate, scale }
}

export function paint(el, state) {
  const c = cssStrings(cssFor(state))
  el.style.translate = c.translate ?? 'none'
  el.style.rotate = c.rotate ?? 'none'
  el.style.scale = c.scale ?? 'none'
}

export function unpaint(el, base) {
  el.style.translate = base.raw.translate
  el.style.rotate = base.raw.rotate
  el.style.scale = base.raw.scale
}

/**
 * N written as an SVG transform list, about the element's original centre:
 *   translate(d) rotate(θ c) translate(c) scale(s) translate(-c)
 * which is how a person would write "moved, turned and flipped in place".
 */
export function svgTransform(N, c0) {
  const d = decompose(N)
  const nc = apply(N, c0)
  const dx = nc.x - c0.x
  const dy = nc.y - c0.y
  const parts = []
  if (Math.abs(dx) >= 0.01 || Math.abs(dy) >= 0.01) parts.push(`translate(${num(dx)} ${num(dy)})`)
  if (Math.abs(d.theta) >= 0.01) parts.push(`rotate(${num(d.theta)} ${num(c0.x)} ${num(c0.y)})`)
  if (Math.abs(d.sx - 1) >= 0.001 || Math.abs(d.sy - 1) >= 0.001) {
    parts.push(`translate(${num(c0.x)} ${num(c0.y)}) scale(${num(d.sx, 3)} ${num(d.sy, 3)}) translate(${num(-c0.x)} ${num(-c0.y)})`)
  }
  return parts.join(' ')
}

/**
 * Split N for an ADAPTER: position and size go into the component's own
 * props, and only what props cannot say - a turn, a flip, or a resize when
 * there is no size prop - is left for a wrapper. The props scale the
 * element about its anchor, so the anchor is moved by exactly what makes
 * the element's centre land where the preview put it.
 */
export function adapterSplit(N, c0, anchor, hasSize) {
  const d = decompose(N)
  const k = Math.sqrt(Math.abs(d.sx * d.sy))
  const kp = hasSize ? k : 1
  const nc = apply(N, c0)
  const delta = { x: nc.x - c0.x + (1 - kp) * (c0.x - anchor.x), y: nc.y - c0.y + (1 - kp) * (c0.y - anchor.y) }
  const fx = Math.sign(d.sx) || 1
  const fy = Math.sign(d.sy) || 1
  const restScale = hasSize ? 1 : k
  const rest = []
  if (Math.abs(d.theta) >= 0.01) rest.push(`rotate(${num(d.theta)} ${num(nc.x)} ${num(nc.y)})`)
  if (fx !== 1 || fy !== 1 || Math.abs(restScale - 1) >= 0.001) {
    rest.push(`translate(${num(nc.x)} ${num(nc.y)}) scale(${num(fx * restScale, 3)} ${num(fy * restScale, 3)}) translate(${num(-nc.x)} ${num(-nc.y)})`)
  }
  return { delta, k: kp, rest: rest.join(' '), theta: d.theta, fx, fy }
}
