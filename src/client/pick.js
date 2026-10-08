import { parseColor, rgbToHex, toOklch } from './palette.js'
import { h } from './ui.js'

/**
 * THE COLOUR PICKER: point at anything, read its colour, click to keep it.
 *
 * What is under the pointer is asked in the order a person sees it: a
 * canvas or an image shows its own pixel; text shows its ink; then the
 * border, the background or the shape's fill of the topmost thing that
 * draws there. The answer says which of those it was and on what element,
 * because "this colour" and "where this colour is written" are found
 * differently for each.
 */

const label = (el) => {
  if (!el?.tagName) return 'the page'
  const t = el.tagName.toLowerCase()
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : el.getAttribute?.('class')?.split(/\s+/)[0]
  return `<${t}${el.id ? '#' + el.id : cls ? '.' + cls : ''}>`
}

let scratch = null
/** One pixel of a canvas, image or video, read through a copy so the source's own context is never touched. */
export function pixelOf(el, x, y) {
  const r = el.getBoundingClientRect()
  const w = el.width || el.naturalWidth || el.videoWidth
  const hgt = el.height || el.naturalHeight || el.videoHeight
  if (!w || !hgt || !r.width || !r.height) return null
  const px = Math.floor(((x - r.left) * w) / r.width)
  const py = Math.floor(((y - r.top) * hgt) / r.height)
  if (px < 0 || py < 0 || px >= w || py >= hgt) return null
  try {
    if (!scratch) {
      const cv = document.createElement('canvas')
      cv.width = cv.height = 1
      scratch = cv.getContext('2d', { willReadFrequently: true })
    }
    scratch.clearRect(0, 0, 1, 1)
    scratch.drawImage(el, px, py, 1, 1, 0, 0, 1, 1)
    const d = scratch.getImageData(0, 0, 1, 1).data
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
  } catch {
    // a cross-origin image taints the copy; the pixel cannot be read
    return null
  }
}

function ownTextAt(el, x, y) {
  for (const n of el.childNodes) {
    if (n.nodeType !== 3 || !n.data.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true
  }
  return false
}

function inBorder(el, x, y, cs) {
  const r = el.getBoundingClientRect()
  const t = parseFloat(cs.borderTopWidth) || 0
  const ri = parseFloat(cs.borderRightWidth) || 0
  const b = parseFloat(cs.borderBottomWidth) || 0
  const l = parseFloat(cs.borderLeftWidth) || 0
  if (!(t || ri || b || l)) return null
  if (y - r.top < t) return 'border-top-color'
  if (r.bottom - y < b) return 'border-bottom-color'
  if (x - r.left < l) return 'border-left-color'
  if (r.right - x < ri) return 'border-right-color'
  return null
}

/** The colours of a gradient, in order, read from its computed value. */
export function gradientStops(image) {
  const out = []
  for (const m of String(image).matchAll(/(?:rgba?|oklch|oklab|lab|lch|color|hsla?)\([^()]*\)|#[0-9a-f]{3,8}\b/gi)) {
    const c = parseColor(m[0])
    if (c) out.push(c)
  }
  return out
}

/** What colour is at (x, y), and what draws it there. `stack` is the hit-test stack, topmost first. */
export function sampleAt(stack, x, y) {
  for (const el of stack) {
    const tag = el.tagName
    if (tag === 'CANVAS' || tag === 'IMG' || tag === 'VIDEO') {
      const px = pixelOf(el, x, y)
      if (px && px.a > 0.02) return { rgb: px, source: tag === 'CANVAS' ? 'canvas' : 'image', prop: null, el, what: `${tag === 'CANVAS' ? 'a pixel drawn on' : 'a pixel of'} ${label(el)}` }
      if (px) continue
      if (tag !== 'CANVAS') return { rgb: null, source: 'image', prop: null, el, what: `${label(el)} (its pixels cannot be read)` }
      continue
    }
    const cs = getComputedStyle(el)
    if (el instanceof SVGElement && !/^(svg|g)$/i.test(tag)) {
      const fill = parseColor(cs.fill)
      if (fill && fill.a > 0.02) return { rgb: fill, source: 'fill', prop: 'fill', el, what: `the fill of ${label(el)}` }
      const stroke = parseColor(cs.stroke)
      if (stroke && stroke.a > 0.02) return { rgb: stroke, source: 'stroke', prop: 'stroke', el, what: `the stroke of ${label(el)}` }
      continue
    }
    if (ownTextAt(el, x, y)) {
      const ink = parseColor(cs.color)
      if (ink) return { rgb: ink, source: 'text', prop: 'color', el, what: `the text of ${label(el)}` }
    }
    const side = inBorder(el, x, y, cs)
    if (side) {
      const c = parseColor(cs.getPropertyValue(side))
      if (c && c.a > 0.02) return { rgb: c, source: 'border', prop: side, el, what: `the border of ${label(el)}` }
    }
    const bg = parseColor(cs.backgroundColor)
    if (/gradient\(/.test(cs.backgroundImage)) {
      const stops = gradientStops(cs.backgroundImage)
      if (stops.length) return { rgb: stops[0], stops, source: 'gradient', prop: 'background-image', el, what: `the gradient behind ${label(el)}` }
    }
    if (bg && bg.a > 0.02) return { rgb: bg, source: 'background', prop: 'background-color', el, what: `the background of ${label(el)}` }
  }
  const root = parseColor(getComputedStyle(document.body).backgroundColor)
  const rgb = root && root.a > 0.02 ? root : parseColor(getComputedStyle(document.documentElement).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
  return { rgb: rgb.a > 0.02 ? rgb : { r: 255, g: 255, b: 255, a: 1 }, source: 'background', prop: 'background-color', el: document.body, what: 'the page background' }
}

export const describeColor = (rgb) => {
  if (!rgb) return { hex: '-', rgbText: '', oklch: '' }
  const { L, C, h: hue } = toOklch(rgb)
  return {
    hex: rgbToHex(rgb),
    rgbText: `rgb(${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)}${rgb.a < 0.999 ? ` / ${Number(rgb.a.toFixed(2))}` : ''})`,
    oklch: `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${C < 0.002 ? 0 : hue.toFixed(1)})`,
  }
}

/**
 * Pick mode. While on, the pointer reads colours (a loupe follows it) and a
 * click keeps one; Escape leaves. The page receives none of it: the editor
 * already holds back every click in edit mode, and pick mode is only
 * reachable from there.
 */
export function createPicker({ ui, stackAt, realRaf, onPick, onEnd }) {
  const chip = h('span', { class: 'chip checker' }, h('i'))
  const hex = h('b', { class: 'mono' })
  const what = h('span', { class: 'muted' })
  const help = h('span', { class: 'muted small', text: 'Click to pick  |  C copies  |  Esc stops' })
  const loupe = h('div', { class: 'loupe panel' }, chip, h('div', {}, hex, what, help))
  ui.root.append(loupe)
  let active = false
  let last = null
  let queued = false
  let at = null

  function read(x, y) {
    const s = sampleAt(stackAt(x, y), x, y)
    last = { ...s, x, y }
    const d = describeColor(s.rgb)
    chip.firstChild.style.background = s.rgb ? `rgba(${s.rgb.r}, ${s.rgb.g}, ${s.rgb.b}, ${s.rgb.a})` : 'transparent'
    hex.textContent = d.hex
    what.textContent = s.what
    const w = 260
    loupe.style.left = `${Math.min(innerWidth - w - 8, x + 18)}px`
    loupe.style.top = `${Math.min(innerHeight - 70, y + 18)}px`
    loupe.style.display = 'flex'
  }

  const move = (e) => {
    if (!active || ui.isOurs(e)) return
    at = { x: e.clientX, y: e.clientY }
    if (queued) return
    queued = true
    const go = () => {
      queued = false
      if (active && at) read(at.x, at.y)
    }
    // on a frame where there are frames; at once where there are none (a hidden window)
    if (document.visibilityState === 'visible') realRaf(go)
    else go()
  }

  function start() {
    if (active) return
    active = true
    document.documentElement.setAttribute('data-retouch-picking', '')
    window.addEventListener('pointermove', move, true)
  }
  function stop(picked = null) {
    if (!active) return
    active = false
    document.documentElement.removeAttribute('data-retouch-picking')
    window.removeEventListener('pointermove', move, true)
    loupe.style.display = 'none'
    onEnd?.(picked)
  }
  /** A click while picking: keep what is under it. */
  function click(x, y) {
    read(x, y)
    const s = last
    stop(s)
    if (s?.rgb) onPick(s)
  }
  async function copy() {
    if (!last?.rgb) return false
    try {
      await navigator.clipboard.writeText(describeColor(last.rgb).hex)
      return true
    } catch {
      return false
    }
  }

  return {
    start,
    stop,
    click,
    copy,
    read,
    get active() {
      return active
    },
    get last() {
      return last
    },
  }
}
