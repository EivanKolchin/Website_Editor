/**
 * WHERE A COLOUR ACTUALLY SHOWS. The band a gradient stop owns is a strip
 * (or a ring, or a wedge), and a strip drawn across a picture runs straight
 * over everything painted on top of it - a sky's band through the fox, the
 * hills and the curtain in front of it. What a person means by "where is
 * this colour" is the part they can SEE. So the mark is found in pixels:
 *
 *   a point belongs to the mark when its gradient offset falls in the stop's
 *   band, it is inside the drawing's own path, the canvas there still shows
 *   the colour this drawing would paint (nothing later on the same canvas
 *   has painted over it), and nothing above the canvas covers it.
 *
 * Everything here is arithmetic on arrays, with no DOM, so it can be tested
 * on its own; the editor reads the pixels and draws the result.
 */

/** [a, b, c, d, e, f] inverted, or null when it cannot be. */
export function invert(m) {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (Math.abs(det) < 1e-12) return null
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

/**
 * The offset a canvas gradient has at a canvas pixel, the way the canvas
 * computes it: projection onto the line for a linear one, the largest
 * circle through the point for a radial one, the angle for a conic one.
 */
export function offsetAt(grad) {
  const inv = invert(grad.m ?? [1, 0, 0, 1, 0, 0])
  if (!inv) return null
  const a = grad.args
  const local = (x, y) => [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]]
  if (grad.kind === 'linear') {
    const [x0, y0, x1, y1] = a
    const dx = x1 - x0
    const dy = y1 - y0
    const len2 = dx * dx + dy * dy || 1
    return (x, y) => {
      const [u, v] = local(x, y)
      return ((u - x0) * dx + (v - y0) * dy) / len2
    }
  }
  if (grad.kind === 'radial') {
    const [x0, y0, r0, x1, y1, r1] = a
    const cdx = x1 - x0
    const cdy = y1 - y0
    const dr = r1 - r0
    const A = cdx * cdx + cdy * cdy - dr * dr
    return (x, y) => {
      const [u, v] = local(x, y)
      const pdx = u - x0
      const pdy = v - y0
      const B = pdx * cdx + pdy * cdy + r0 * dr
      const C = pdx * pdx + pdy * pdy - r0 * r0
      if (Math.abs(A) < 1e-9) return B ? C / (2 * B) : 0
      const disc = B * B - A * C
      if (disc < 0) return NaN
      const s = Math.sqrt(disc)
      // the larger root whose circle has a radius, as the spec takes it
      for (const w of [(B + s) / A, (B - s) / A].sort((p, q) => q - p)) if (r0 + w * dr >= 0) return w
      return NaN
    }
  }
  if (grad.kind === 'conic') {
    const [start, cx, cy] = a
    return (x, y) => {
      const [u, v] = local(x, y)
      let t = (Math.atan2(v - cy, u - cx) - start) / (Math.PI * 2)
      t -= Math.floor(t)
      return t
    }
  }
  return null
}

/** The colour of a gradient at offset t, [r, g, b, a] in 0..255, interpolated as a canvas does between its stops. */
export function colorAt(stops, t) {
  if (!stops.length) return [0, 0, 0, 0]
  if (!(t > stops[0].at)) return stops[0].rgba
  const last = stops[stops.length - 1]
  if (t >= last.at) return last.rgba
  for (let i = 1; i < stops.length; i++) {
    const s = stops[i]
    if (t > s.at) continue
    const p = stops[i - 1]
    const k = s.at === p.at ? 1 : (t - p.at) / (s.at - p.at)
    // premultiplied, as the canvas interpolates
    const pa = p.rgba[3] / 255
    const sa = s.rgba[3] / 255
    const a = pa + (sa - pa) * k
    const ch = (j) => (a ? (p.rgba[j] * pa + (s.rgba[j] * sa - p.rgba[j] * pa) * k) / a : 0)
    return [ch(0), ch(1), ch(2), a * 255]
  }
  return last.rgba
}

/**
 * The mark, on a grid one cell per `step` canvas pixels over the box
 * [x0, y0, w, h] of the canvas. `pixels` is the canvas's own RGBA,
 * `width` its width; `cover(gx, gy)` is how much of a grid cell something
 * above the canvas covers, 0..1; `inShape(gx, gy)` whether a cell is inside
 * the drawing's path (both read from rasters, one cell each); `inBand(x, y)`
 * whether a canvas point is in the stop's band; `expected(x, y)` the colour
 * this drawing paints there. `compare: false` skips the colour test, for a
 * translucent drawing whose pixels are mixed with what is under it.
 * Returns { mask, mw, mh, count }.
 */
export function buildMask({ x0, y0, w, h, step, pixels, width, cover, inShape, expected, inBand, compare = true, tol = 14, clean = true }) {
  const mw = Math.max(1, Math.ceil(w / step))
  const mh = Math.max(1, Math.ceil(h / step))
  const mask = new Uint8Array(mw * mh)
  let count = 0
  for (let gy = 0; gy < mh; gy++) {
    const y = y0 + (gy + 0.5) * step
    for (let gx = 0; gx < mw; gx++) {
      const x = x0 + (gx + 0.5) * step
      if (inBand && !inBand(x, y)) continue
      if (inShape && !inShape(gx, gy)) continue
      if (cover && cover(gx, gy) > 0.35) continue
      const i = (Math.floor(y) * width + Math.floor(x)) * 4
      if (pixels[i + 3] < 8) continue
      if (compare) {
        const want = expected(x, y)
        if (!want) continue
        // what the canvas shows there is this drawing's colour, or something painted after it
        if (Math.abs(pixels[i] - want[0]) > tol || Math.abs(pixels[i + 1] - want[1]) > tol || Math.abs(pixels[i + 2] - want[2]) > tol) continue
      }
      mask[gy * mw + gx] = 1
      count++
    }
  }
  return clean ? smooth({ mask, mw, mh, count }) : { mask, mw, mh, count }
}

/**
 * Where a colour fades into another (a glow laid over a sky) the cut is a
 * scatter of cells either side of the tolerance: each cell takes the
 * majority of the nine around it, once, which clears specks and fills
 * pinholes without moving a clean edge.
 */
export function smooth({ mask, mw, mh }) {
  const out = new Uint8Array(mw * mh)
  let count = 0
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= mh) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx >= 0 && xx < mw) n += mask[yy * mw + xx]
        }
      }
      if (n >= 5) {
        out[y * mw + x] = 1
        count++
      }
    }
  }
  return { mask: out, mw, mh, count }
}

/**
 * The mark as pixels to show: the area tinted, its edge light, and a dark
 * rim just outside it, so it reads on any colour. RGBA, mw x mh.
 */
export function paintMask({ mask, mw, mh }) {
  const out = new Uint8ClampedArray(mw * mh * 4)
  const at = (x, y) => (x < 0 || y < 0 || x >= mw || y >= mh ? 0 : mask[y * mw + x])
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const i = (y * mw + x) * 4
      const on = at(x, y)
      const edgeIn = on && (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1))
      const near = !on && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1) || at(x - 1, y - 1) || at(x + 1, y + 1) || at(x - 1, y + 1) || at(x + 1, y - 1))
      if (edgeIn) out.set([255, 255, 255, 255], i)
      else if (on) out.set([255, 255, 255, 60], i)
      else if (near) out.set([0, 0, 0, 190], i)
    }
  }
  return out
}
