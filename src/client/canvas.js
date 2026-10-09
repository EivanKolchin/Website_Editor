/**
 * WHAT A CANVAS DREW.
 *
 * A canvas is one element with a picture in it: the stars, lines and shapes
 * a script paints are pixels, not things. To make them things, the page's
 * drawing calls go through a hook (installed in the page's head before any
 * of its scripts, see plugin.mjs) that this module switches on for one
 * frame at a time. Every path, fill, stroke, text and image drawn in that
 * frame is kept as an ITEM: its outline in the canvas's own pixels, its
 * colour, its line width, and - when asked - the stack of the code that drew
 * it. Items can then be hit-tested under the pointer, outlined, selected,
 * grouped by the line of code that drew them, and traced to that line.
 *
 * Nothing about the picture is changed. Recording with stacks costs a little
 * per call, so the pointer's frequent look-ups record without them and a
 * selection records once more with them.
 */

import { apply, inv, mul } from './geometry.js'

const STEPS = 12
const matrixOf = (m) => [m.a, m.b, m.c, m.d, m.e, m.f]
const frameKey = (f) => f ? `${f.url.split('?')[0]}:${f.line}:${f.col}` : null
const functionsIn = (stack) => [...String(stack).matchAll(/\(?((?:https?):\/\/[^\s()]+?):(\d+):(\d+)\)?\s*$/gm)].map((m) => ({ url: m[1], line: Number(m[2]), col: Number(m[3]) }))
const clipBox = (box, clips) => {
  let b = box
  for (const subs of clips) {
    const r = bboxOf(subs)
    if (!r) return null
    const x = Math.max(b.x, r.x), y = Math.max(b.y, r.y), right = Math.min(b.x + b.w, r.x + r.w), bottom = Math.min(b.y + b.h, r.y + r.h)
    if (right <= x || bottom <= y) return null
    b = { x, y, w: right - x, h: bottom - y }
  }
  return b
}

/** A point through a 2D matrix. */
const tx = (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]
const scaleOf = (m) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1

function arcPoints(m, x, y, r, a0, a1, ccw, rx = r, ry = r, rot = 0) {
  let sweep = a1 - a0
  if (ccw && sweep > 0) sweep -= Math.PI * 2 * Math.ceil(sweep / (Math.PI * 2))
  if (!ccw && sweep < 0) sweep += Math.PI * 2 * Math.ceil(-sweep / (Math.PI * 2))
  if (Math.abs(sweep) > Math.PI * 2) sweep = Math.sign(sweep) * Math.PI * 2
  const n = Math.max(4, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * STEPS * 2))
  const out = []
  const cr = Math.cos(rot)
  const sr = Math.sin(rot)
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n
    const ex = rx * Math.cos(a)
    const ey = ry * Math.sin(a)
    out.push(...tx(m, x + ex * cr - ey * sr, y + ex * sr + ey * cr))
  }
  return out
}

function curvePoints(m, p0, cps, end) {
  const out = []
  for (let i = 1; i <= 8; i++) {
    const t = i / 8
    let x
    let y
    if (cps.length === 2) {
      // quadratic
      const u = 1 - t
      x = u * u * p0[0] + 2 * u * t * cps[0] + t * t * end[0]
      y = u * u * p0[1] + 2 * u * t * cps[1] + t * t * end[1]
    } else {
      const u = 1 - t
      x = u * u * u * p0[0] + 3 * u * u * t * cps[0] + 3 * u * t * t * cps[2] + t * t * t * end[0]
      y = u * u * u * p0[1] + 3 * u * u * t * cps[1] + 3 * u * t * t * cps[3] + t * t * t * end[1]
    }
    out.push(...tx(m, x, y))
  }
  return out
}

/**
 * A path being built: subpaths of device-pixel points. `user` keeps the
 * last point in user space, which curves need; `m` is read per command
 * because a transform may change halfway through a path.
 */
function newPath() {
  return { subs: [], cur: null, last: [0, 0], arcs: [] }
}
function addCommand(path, m, name, a) {
  const start = (p) => {
    path.cur = [...p]
    path.subs.push(path.cur)
  }
  const push = (pts) => {
    if (!path.cur) start(pts.slice(0, 2))
    path.cur.push(...pts)
  }
  switch (name) {
    case 'moveTo':
      start(tx(m, a[0], a[1]))
      path.last = [a[0], a[1]]
      break
    case 'lineTo':
      push(tx(m, a[0], a[1]))
      path.last = [a[0], a[1]]
      break
    case 'arc': {
      const pts = arcPoints(m, a[0], a[1], a[2], a[3], a[4], !!a[5])
      push(pts)
      path.arcs.push({ c: tx(m, a[0], a[1]), r: a[2] * scaleOf(m), full: Math.abs(a[4] - a[3]) >= Math.PI * 2 - 1e-3 })
      path.last = [a[0] + a[2] * Math.cos(a[4]), a[1] + a[2] * Math.sin(a[4])]
      break
    }
    case 'ellipse': {
      push(arcPoints(m, a[0], a[1], 0, a[5], a[6], !!a[7], a[2], a[3], a[4]))
      path.arcs.push({ c: tx(m, a[0], a[1]), r: Math.max(a[2], a[3]) * scaleOf(m), full: Math.abs(a[6] - a[5]) >= Math.PI * 2 - 1e-3 })
      break
    }
    case 'arcTo':
      push(tx(m, a[0], a[1]))
      push(tx(m, a[2], a[3]))
      path.last = [a[2], a[3]]
      break
    case 'rect':
    case 'roundRect': {
      const [x, y, w, hh] = a
      start(tx(m, x, y))
      path.cur.push(...tx(m, x + w, y), ...tx(m, x + w, y + hh), ...tx(m, x, y + hh), ...tx(m, x, y))
      path.cur.closed = true
      path.cur = null
      break
    }
    case 'bezierCurveTo':
      push(curvePoints(m, path.last, [a[0], a[1], a[2], a[3]], [a[4], a[5]]))
      path.last = [a[4], a[5]]
      break
    case 'quadraticCurveTo':
      push(curvePoints(m, path.last, [a[0], a[1]], [a[2], a[3]]))
      path.last = [a[2], a[3]]
      break
    case 'closePath':
      if (path.cur) {
        path.cur.closed = true
        path.cur = null
      }
      break
  }
}

function bboxOf(subs) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of subs) {
    for (let i = 0; i < s.length; i += 2) {
      if (s[i] < x0) x0 = s[i]
      if (s[i] > x1) x1 = s[i]
      if (s[i + 1] < y0) y0 = s[i + 1]
      if (s[i + 1] > y1) y1 = s[i + 1]
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const styleName = (s) => (typeof s === 'string' ? s : s && typeof s === 'object' ? (s.constructor?.name === 'CanvasPattern' ? 'pattern' : 'gradient') : null)

/** The page's drawing calls, recorded for a frame at a time. */
export function createCanvasRecorder(boot, realRaf) {
  const paths = new WeakMap() // context -> the path being built
  const p2d = new WeakMap() // Path2D -> its commands
  const stops = new WeakMap() // CanvasGradient -> [[offset, colour]]
  let clips = new WeakMap(), clipStacks = new WeakMap()
  // canvas -> { cur: what this frame has drawn so far, done: the last whole frame, frame: which frame cur is }
  let frames = new Map()
  let withStacks = false
  let seq = 0
  /**
   * The canvas's record for the frame being drawn. A new frame (the page's
   * requestAnimationFrame tick, named by the hook in its head) puts the
   * last one away whole.
   */
  const entry = (c) => {
    let e = frames.get(c)
    if (!e) frames.set(c, (e = { cur: [], done: null, frame: boot.frameT }))
    if (e.frame !== boot.frameT) {
      if (e.cur.length) e.done = e.cur
      e.cur = []
      e.frame = boot.frameT
    }
    return e
  }
  /** Clearing or painting over the whole canvas hides what this frame drew before it. */
  const newPicture = (c) => {
    entry(c).cur = []
  }

  function emit(ctx, kind, subs, extra = {}) {
    const canvas = ctx.canvas
    if (!canvas) return
    const clipping = clips.get(ctx) ?? []
    const raw = bboxOf(subs)
    const bbox = raw && clipBox(raw, clipping)
    if (!bbox) return
    // a picture is not painted with the fill style - whatever gradient was left set on the context
    // belongs to something else - so it carries no style of its own
    const style = kind === 'image' ? null : kind === 'stroke' || kind === 'strokeText' ? ctx.strokeStyle : ctx.fillStyle
    // a gradient's own geometry, in the space it is painted in: the transform at the moment of painting
    const geom = style && typeof style === 'object' ? style.__rtGeom ?? null : null
    const t = geom ? ctx.getTransform() : null
    const item = {
      canvas,
      kind,
      subs,
      bbox,
      clips: clipping.slice(),
      matrix: matrixOf(ctx.getTransform()),
      composite: ctx.globalCompositeOperation,
      color: styleName(style),
      stops: style && typeof style === 'object' ? stops.get(style) ?? null : null,
      gradient: geom ? { kind: geom.kind, args: geom.args, m: [t.a, t.b, t.c, t.d, t.e, t.f] } : null,
      alpha: ctx.globalAlpha,
      lineWidth: kind === 'stroke' ? ctx.lineWidth * scaleOf(ctx.getTransform()) : 0,
      lineCap: ctx.lineCap,
      lineJoin: ctx.lineJoin,
      seq: seq++,
      stack: withStacks ? new Error().stack : null,
      ...extra,
    }
    entry(canvas).cur.push(item)
  }

  function rec(ctx, name, a) {
    if (name === 'save') {
      const stack = clipStacks.get(ctx) ?? []
      stack.push(clips.get(ctx) ?? [])
      clipStacks.set(ctx, stack)
      return
    }
    if (name === 'restore') { clips.set(ctx, clipStacks.get(ctx)?.pop() ?? []); return }
    if (name === 'clip') {
      const from = a[0] && typeof a[0] === 'object' ? p2d.get(a[0]) : null
      let path = paths.get(ctx)
      if (from) { path = newPath(); for (const [n, args] of from) addCommand(path, ctx.getTransform(), n, args) }
      if (path) clips.set(ctx, [...(clips.get(ctx) ?? []), path.subs.map((s) => Object.assign([...s], { closed: s.closed }))])
      return
    }
    if (name === 'beginPath') {
      paths.set(ctx, newPath())
      return
    }
    let path = paths.get(ctx)
    if (!path) paths.set(ctx, (path = newPath()))
    const m = ctx.getTransform()
    if (name === 'fill' || name === 'stroke') {
      const from = a[0] && typeof a[0] === 'object' ? p2d.get(a[0]) : null
      let subs = path.subs
      let arcs = path.arcs
      if (from) {
        const tmp = newPath()
        for (const [n, args] of from) addCommand(tmp, m, n, args)
        subs = tmp.subs
        arcs = tmp.arcs
      }
      emit(ctx, name, subs.map((s) => Object.assign([...s], { closed: s.closed })), { arcs: arcs.slice() })
      return
    }
    if (name === 'fillRect' || name === 'strokeRect' || name === 'clearRect') {
      const [x, y, w, hh] = a
      const sub = [...tx(m, x, y), ...tx(m, x + w, y), ...tx(m, x + w, y + hh), ...tx(m, x, y + hh)]
      sub.closed = true
      if (name === 'clearRect') {
        // a clear of the whole canvas starts a new picture
        const c = ctx.canvas
        const b = bboxOf([sub])
        if (b && b.w >= c.width * 0.98 && b.h >= c.height * 0.98) newPicture(c)
        return
      }
      if (name === 'fillRect') {
        const c = ctx.canvas
        const b = bboxOf([sub])
        // painting the whole canvas over is a new picture too, with this as its ground
        if (b && b.w >= c.width * 0.98 && b.h >= c.height * 0.98 && ctx.globalAlpha >= 0.99) newPicture(c)
      }
      emit(ctx, name === 'fillRect' ? 'fill' : 'stroke', [sub])
      return
    }
    if (name === 'fillText' || name === 'strokeText') {
      const text = String(a[0])
      const mt = ctx.measureText(text)
      const left = a[1] - (mt.actualBoundingBoxLeft ?? 0)
      const right = a[1] + (mt.actualBoundingBoxRight ?? mt.width)
      const top = a[2] - (mt.actualBoundingBoxAscent ?? 10)
      const bottom = a[2] + (mt.actualBoundingBoxDescent ?? 2)
      const sub = [...tx(m, left, top), ...tx(m, right, top), ...tx(m, right, bottom), ...tx(m, left, bottom)]
      sub.closed = true
      emit(ctx, name === 'fillText' ? 'text' : 'strokeText', [sub], { text, font: ctx.font })
      return
    }
    if (name === 'drawImage') {
      let dx
      let dy
      let dw
      let dh
      const img = a[0]
      if (a.length >= 9) [dx, dy, dw, dh] = [a[5], a[6], a[7], a[8]]
      else if (a.length >= 5) [dx, dy, dw, dh] = [a[1], a[2], a[3], a[4]]
      else [dx, dy, dw, dh] = [a[1], a[2], img?.naturalWidth ?? img?.width ?? 0, img?.naturalHeight ?? img?.height ?? 0]
      const sub = [...tx(m, dx, dy), ...tx(m, dx + dw, dy), ...tx(m, dx + dw, dy + dh), ...tx(m, dx, dy + dh)]
      sub.closed = true
      // the picture itself and where it went, so a hit test can tell where it is clear
      let sx = 0
      let sy = 0
      let sw = img?.naturalWidth || img?.videoWidth || img?.width || 0
      let sh = img?.naturalHeight || img?.videoHeight || img?.height || 0
      if (a.length >= 9) [sx, sy, sw, sh] = [a[1], a[2], a[3], a[4]]
      emit(ctx, 'image', [sub], {
        src: img?.currentSrc || img?.src || (img?.tagName ? img.tagName.toLowerCase() : 'bitmap'),
        source: img,
        place: { dx, dy, dw, dh, sx, sy, sw, sh, m: [m.a, m.b, m.c, m.d, m.e, m.f] },
      })
      // The picture can be a whole scene assembled off screen. Keep the
      // original drawings and their source stacks inside it, including the
      // crop and destination clip; a cached ground is not one huge object.
      const source = frames.get(img)
      const children = source?.cur.length ? source.cur : source?.done ?? []
      if (img !== ctx.canvas && sw && sh && children.length) {
        const placement = mul(matrixOf(m), [dw / sw, 0, 0, dh / sh, dx - sx * dw / sw, dy - sy * dh / sh])
        const projectSubs = (subs) => subs.map((s) => Object.assign(s.flatMap((_, i) => i % 2 ? [] : (() => { const p = apply(placement, { x: s[i], y: s[i + 1] }); return [p.x, p.y] })()), { closed: s.closed }))
        const destinationClips = [...(clips.get(ctx) ?? []), [sub]]
        for (const child of children) {
          if (child.composite && child.composite !== 'source-over') continue
          const subs = projectSubs(child.subs), cut = [...destinationClips, ...(child.clips ?? []).map(projectSubs)]
          const bbox = clipBox(bboxOf(subs), cut)
          if (!bbox) continue
          entry(ctx.canvas).cur.push({ ...child, canvas: ctx.canvas, subs, bbox, clips: cut, alpha: child.alpha * ctx.globalAlpha, lineWidth: child.lineWidth * scaleOf({ a: placement[0], b: placement[1], c: placement[2], d: placement[3] }), seq: seq++, matrix: mul(placement, child.matrix), ...(child.place ? { place: { ...child.place, m: mul(placement, child.place.m) } } : {}) })
        }
      }
      return
    }
    addCommand(path, m, name, a)
  }

  function recPath(path, name, a) {
    if (!p2d.has(path)) p2d.set(path, [])
    if (name === 'addPath') {
      const other = p2d.get(a[0])
      if (other) p2d.get(path).push(...other)
      return
    }
    p2d.get(path).push([name, [...a]])
  }
  function recStop(g, name, a) {
    if (!stops.has(g)) stops.set(g, [])
    stops.get(g).push([a[0], a[1]])
  }
  // Path2D objects are often built once, before any recording: their commands are kept from the start
  boot.recPath = recPath
  boot.recStop = recStop

  const nextFrame = () => new Promise((done) => (document.visibilityState === 'visible' ? realRaf(() => done()) : setTimeout(done, 40)))

  /**
   * Record what every canvas draws in one frame: canvas -> its items. A
   * frozen page is asked to draw the frame it is showing again. A running
   * one is watched until every canvas it clears has drawn one whole frame,
   * from a clear to the next - a page that draws every other frame, or
   * slower, would otherwise be caught between pictures or halfway through
   * one - and for no more than a dozen frames.
   */
  async function capture({ stacks = false } = {}) {
    frames = new Map()
    clips = new WeakMap(); clipStacks = new WeakMap()
    withStacks = stacks
    seq = 0
    boot.rec = rec
    try {
      if (boot.isFrozen?.()) {
        // a page that draws at half rate when idle, or not at all when its clock has not moved,
        // can skip the one redraw asked for: ask again, a few times, until something is drawn
        for (let i = 0; i < 4; i++) {
          boot.step?.(0)
          if (frames.size && [...frames.values()].every((e) => e.cur.length || e.done)) break
        }
      } else {
        for (let i = 0; i < 12; i++) {
          await nextFrame()
          // nothing seen yet is not "every canvas done": a page drawing at 30 fps, or on a timer, misses two frames
          if (i >= 1 && frames.size && [...frames.values()].every((e) => e.done || !e.cur.length)) break
        }
      }
    } finally {
      boot.rec = null
    }
    const out = new Map()
    // the last whole frame; a frozen page's one redraw is the frame it shows
    for (const [c, e] of frames) if (c.isConnected) out.set(c, boot.isFrozen?.() ? (e.cur.length ? e.cur : e.done ?? []) : e.done ?? e.cur)
    return out
  }

  /** Preview the same context transform the source wrapper will write.
   * Only the requested frozen redraw pays for stack lookup; the ordinary
   * canvas hook still reads one property and calls straight through.
   */
  function redraw(previews) {
    if (!boot.isFrozen?.()) return
    const roots = new Map()
    const previous = boot.rec
    boot.rec = (ctx, name, args) => {
      const stack = functionsIn(new Error().stack)
      const matches = previews.filter((p) => stack.some((f) => frameKey(f) === p.key))
      if (!matches.length || name === 'clearRect') return
      let n = [1, 0, 0, 1, 0, 0]
      for (const p of matches) {
        let contexts = roots.get(p)
        if (!contexts) roots.set(p, (contexts = new WeakMap()))
        let root = contexts.get(ctx)
        if (!root) contexts.set(ctx, (root = matrixOf(ctx.getTransform())))
        const inverse = inv(root)
        if (inverse) n = mul(mul(root, mul(p.matrix, inverse)), n)
      }
      if (['save', 'restore', 'beginPath', 'clip', 'closePath'].includes(name)) return
      const before = boot.rec
      boot.rec = null
      ctx.save()
      ctx.setTransform(...mul(n, matrixOf(ctx.getTransform())))
      boot.rec = before
      return () => { const active = boot.rec; boot.rec = null; ctx.restore(); boot.rec = active }
    }
    try { for (let i = 0; i < 4; i++) boot.step?.(0) } finally { boot.rec = previous }
  }

  function matchesSkip(ctx, kind, b, skipItems) {
    if (!b) return false
    for (const it of skipItems) {
      if (it.canvas && it.canvas !== ctx.canvas) continue
      if (it.kind !== kind && !(kind === 'fillRect' && it.kind === 'fill') && !(kind === 'strokeRect' && it.kind === 'stroke')) continue
      const ib = it.bbox
      if (!ib) continue
      if (Math.abs(b.x - ib.x) <= 3 && Math.abs(b.y - ib.y) <= 3 && Math.abs(b.w - ib.w) <= 3 && Math.abs(b.h - ib.h) <= 3) {
        return true
      }
    }
    return false
  }

  function captureCleanCanvases(skipItems = []) {
    if (!skipItems.length) return new Map()
    const canvases = new Set(skipItems.map((it) => it.canvas).filter(Boolean))
    const cleanMap = new Map()
    const drawnCanvases = new Set()

    if (boot.isFrozen?.()) {
      const cleanPaths = new WeakMap()
      const previous = boot.rec
      boot.rec = (ctx, name, a) => {
        let path = cleanPaths.get(ctx)
        if (!path) cleanPaths.set(ctx, (path = newPath()))
        const m = ctx.getTransform()
        if (name === 'beginPath') {
          cleanPaths.set(ctx, newPath())
          return
        }
        if (name === 'fill' || name === 'stroke') {
          drawnCanvases.add(ctx.canvas)
          const from = a[0] && typeof a[0] === 'object' ? p2d.get(a[0]) : null
          let subs = path.subs
          if (from) {
            const tmp = newPath()
            for (const [n, args] of from) addCommand(tmp, m, n, args)
            subs = tmp.subs
          }
          const b = bboxOf(subs)
          if (matchesSkip(ctx, name, b, skipItems)) return { skip: true }
          return
        }
        if (name === 'fillRect' || name === 'strokeRect') {
          drawnCanvases.add(ctx.canvas)
          const [x, y, w, hh] = a
          const sub = [...tx(m, x, y), ...tx(m, x + w, y), ...tx(m, x + w, y + hh), ...tx(m, x, y + hh)]
          const b = bboxOf([sub])
          if (matchesSkip(ctx, name === 'fillRect' ? 'fill' : 'stroke', b, skipItems)) return { skip: true }
          return
        }
        if (name === 'fillText' || name === 'strokeText') {
          drawnCanvases.add(ctx.canvas)
          const text = String(a[0])
          for (const it of skipItems) {
            if (it.canvas === ctx.canvas && (it.kind === 'text' || it.kind === 'strokeText') && it.text === text) {
              return { skip: true }
            }
          }
          return
        }
        if (name === 'drawImage') {
          drawnCanvases.add(ctx.canvas)
          let dx = a.length >= 9 ? a[5] : a.length >= 5 ? a[1] : a[1]
          let dy = a.length >= 9 ? a[6] : a.length >= 5 ? a[2] : a[2]
          let dw = a.length >= 9 ? a[7] : a.length >= 5 ? a[3] : (a[0]?.naturalWidth ?? a[0]?.width ?? 0)
          let dh = a.length >= 9 ? a[8] : a.length >= 5 ? a[4] : (a[0]?.naturalHeight ?? a[0]?.height ?? 0)
          const sub = [...tx(m, dx, dy), ...tx(m, dx + dw, dy), ...tx(m, dx + dw, dy + dh), ...tx(m, dx, dy + dh)]
          const b = bboxOf([sub])
          if (matchesSkip(ctx, 'image', b, skipItems)) return { skip: true }
          return
        }
        addCommand(path, m, name, a)
      }
      try {
        for (let i = 0; i < 4; i++) {
          drawnCanvases.clear()
          boot.step?.(0)
          if (canvases.size && [...canvases].every((cv) => drawnCanvases.has(cv))) break
        }
      } finally {
        boot.rec = previous
      }
    }

    for (const cv of canvases) {
      const copy = typeof document !== 'undefined' && document.createElement
        ? document.createElement('canvas')
        : { width: cv.width, height: cv.height, getContext: () => ({ drawImage: () => {}, clearRect: () => {} }) }
      copy.width = cv.width
      copy.height = cv.height
      const cctx = copy.getContext('2d')
      cctx.drawImage(cv, 0, 0)
      if (!drawnCanvases.has(cv)) {
        for (const it of skipItems) {
          if (it.canvas === cv && it.bbox) {
            cctx.clearRect(it.bbox.x - 2, it.bbox.y - 2, it.bbox.w + 4, it.bbox.h + 4)
          }
        }
      }
      cleanMap.set(cv, copy)
    }

    return cleanMap
  }

  return { capture, redraw, captureCleanCanvases }
}

function strokeColorOf(d) {
  if (d.color && d.color !== 'gradient' && d.color !== 'pattern') return d.color
  if (d.stops && d.stops.length && typeof d.stops[0][1] === 'string') return d.stops[0][1]
  return '#ffffff'
}

function fillColorOf(d) {
  if (d.color && d.color !== 'gradient' && d.color !== 'pattern') return d.color
  if (d.stops && d.stops.length && typeof d.stops[0][1] === 'string') return d.stops[0][1]
  return '#ffffff'
}

export function renderDrawing(ctx, d) {
  if (!d) return
  ctx.save()
  if (d.composite) ctx.globalCompositeOperation = d.composite
  if (d.alpha !== undefined && d.alpha !== null) ctx.globalAlpha = d.alpha

  if (d.clips?.length) {
    for (const clipSubs of d.clips) {
      ctx.beginPath()
      for (const sub of clipSubs) {
        for (let i = 0; i < sub.length; i += 2) {
          if (i === 0) ctx.moveTo(sub[i], sub[i + 1])
          else ctx.lineTo(sub[i], sub[i + 1])
        }
        if (sub.closed) ctx.closePath()
      }
      ctx.clip()
    }
  }

  if (d.kind === 'fill' || d.kind === 'stroke') {
    if (d.arcs && d.arcs.length === 1 && d.arcs[0].full && d.bbox && Math.abs(d.bbox.w - d.bbox.h) < 1.5) {
      ctx.beginPath()
      const cx = d.bbox.x + d.bbox.w / 2
      const cy = d.bbox.y + d.bbox.h / 2
      const r = (d.bbox.w + d.bbox.h) / 4
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      if (d.kind === 'fill') {
        ctx.fillStyle = fillColorOf(d)
        ctx.fill()
      } else {
        ctx.strokeStyle = strokeColorOf(d)
        ctx.lineWidth = d.lineWidth || 1
        if (d.lineCap) ctx.lineCap = d.lineCap
        if (d.lineJoin) ctx.lineJoin = d.lineJoin
        ctx.stroke()
      }
    } else if (d.subs) {
      ctx.beginPath()
      for (const sub of d.subs) {
        for (let i = 0; i < sub.length; i += 2) {
          if (i === 0) ctx.moveTo(sub[i], sub[i + 1])
          else ctx.lineTo(sub[i], sub[i + 1])
        }
        if (sub.closed) ctx.closePath()
      }
      if (d.kind === 'fill') {
        ctx.fillStyle = fillColorOf(d)
        ctx.fill()
      } else {
        ctx.strokeStyle = strokeColorOf(d)
        ctx.lineWidth = d.lineWidth || 1
        if (d.lineCap) ctx.lineCap = d.lineCap
        if (d.lineJoin) ctx.lineJoin = d.lineJoin
        ctx.stroke()
      }
    }
  } else if (d.kind === 'fillRect') {
    ctx.fillStyle = fillColorOf(d)
    ctx.fillRect(d.bbox.x, d.bbox.y, d.bbox.w, d.bbox.h)
  } else if (d.kind === 'strokeRect') {
    ctx.strokeStyle = strokeColorOf(d)
    ctx.lineWidth = d.lineWidth || 1
    if (d.lineCap) ctx.lineCap = d.lineCap
    if (d.lineJoin) ctx.lineJoin = d.lineJoin
    ctx.strokeRect(d.bbox.x, d.bbox.y, d.bbox.w, d.bbox.h)
  } else if (d.kind === 'text' || d.kind === 'strokeText') {
    if (d.font) ctx.font = d.font
    if (d.kind === 'text') {
      ctx.fillStyle = fillColorOf(d)
      ctx.fillText(d.text, d.bbox.x, d.bbox.y + d.bbox.h)
    } else {
      ctx.strokeStyle = strokeColorOf(d)
      ctx.lineWidth = d.lineWidth || 1
      if (d.lineCap) ctx.lineCap = d.lineCap
      if (d.lineJoin) ctx.lineJoin = d.lineJoin
      ctx.strokeText(d.text, d.bbox.x, d.bbox.y + d.bbox.h)
    }
  } else if (d.kind === 'image' && d.source) {
    const p = d.place
    if (p) {
      ctx.drawImage(d.source, p.sx, p.sy, p.sw, p.sh, d.bbox.x, d.bbox.y, d.bbox.w, d.bbox.h)
    } else {
      ctx.drawImage(d.source, d.bbox.x, d.bbox.y, d.bbox.w, d.bbox.h)
    }
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/*  hit testing                                                         */
/* ------------------------------------------------------------------ */

function distToSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0
  const dy = y1 - y0
  const l = dx * dx + dy * dy
  const t = l ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l)) : 0
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

function inside(px, py, subs) {
  let c = false
  for (const s of subs) {
    for (let i = 0, j = s.length - 2; i < s.length; j = i, i += 2) {
      const xi = s[i]
      const yi = s[i + 1]
      const xj = s[j]
      const yj = s[j + 1]
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c
    }
  }
  return c
}

/** The pixel ratio between a canvas's own pixels and the page's. */
export const scaleFor = (canvas) => {
  const r = canvas.getBoundingClientRect()
  return { r, k: r.width ? canvas.width / r.width : 1 }
}

/** An item's box in page coordinates. */
export function pageRect(item) {
  const { r, k } = scaleFor(item.canvas)
  const b = item.bbox
  return { left: r.left + b.x / k, top: r.top + b.y / k, width: b.w / k, height: b.h / k, right: r.left + (b.x + b.w) / k, bottom: r.top + (b.y + b.h) / k }
}

/**
 * The items under a page point, topmost first. A small thing is given a
 * generous target - a star two pixels wide could never be hovered
 * otherwise - and anything that covers most of the canvas (its ground) is
 * offered last, so a click lands on what is drawn on it.
 */
export function itemsAt(items, x, y) {
  if (!items?.length) return []
  const { r, k } = scaleFor(items[0].canvas)
  const px = (x - r.left) * k
  const py = (y - r.top) * k
  const tol = 4 * k
  const area = items[0].canvas.width * items[0].canvas.height
  const hits = []
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    const b = it.bbox
    if (it.alpha < 0.03) continue
    const sTol = it.kind === 'stroke' || it.kind === 'strokeText' ? Math.max(8 * k, it.lineWidth / 2 + 6 * k) : tol
    const pad = Math.max(tol, sTol, b.w < 10 * k && b.h < 10 * k ? 8 * k : 0)
    if (px < b.x - pad || px > b.x + b.w + pad || py < b.y - pad || py > b.y + b.h + pad) continue
    if ((it.clips ?? []).some((clip) => !inside(px, py, clip))) continue
    let hit = false
    if (b.w < 10 * k && b.h < 10 * k) hit = true
    else if (it.kind === 'stroke' || it.kind === 'strokeText') {
      const lineTol = Math.max(8 * k, it.lineWidth / 2 + 6 * k)
      for (const s of it.subs) {
        const n = s.length
        for (let j = 0; j + 3 < n && !hit; j += 2) if (distToSeg(px, py, s[j], s[j + 1], s[j + 2], s[j + 3]) <= lineTol) hit = true
        if (!hit && s.closed && n >= 4 && distToSeg(px, py, s[n - 2], s[n - 1], s[0], s[1]) <= lineTol) hit = true
        if (hit) break
      }
    } else if (it.kind === 'text') hit = true
    // a picture is hit only where it is not clear: a layer pre-rendered over the whole canvas lets the rest through
    else if (it.kind === 'image') hit = imageAlphaAt(it, px, py) > 0.08
    else hit = inside(px, py, it.subs)
    if (hit) hits.push({ item: it, ground: b.w * b.h > area * 0.5 })
  }
  return [...hits.filter((h) => !h.ground), ...hits.filter((h) => h.ground)].map((h) => h.item)
}

/**
 * How opaque a drawn picture is at a canvas pixel, read from the picture
 * itself where it can be (another canvas, a same-origin image); 1 where it
 * cannot, so an unreadable picture is hit across its whole box as before.
 */
const alphaReads = new WeakMap()
export function imageAlphaAt(it, px, py) {
  const p = it.place
  const src = it.source
  if (!p || !src || !p.dw || !p.dh) return 1
  // the canvas pixel back into the picture's own pixels
  const [a, b, c, d, e, f] = p.m
  const det = a * d - b * c
  if (!det) return 1
  const u = (d * (px - e) - c * (py - f)) / det
  const v = (-b * (px - e) + a * (py - f)) / det
  const ix = Math.floor(p.sx + ((u - p.dx) / p.dw) * p.sw)
  const iy = Math.floor(p.sy + ((v - p.dy) / p.dh) * p.sh)
  try {
    let ctx = alphaReads.get(src)
    if (ctx === undefined) {
      if (typeof src.getContext === 'function') ctx = src.getContext('2d')
      else {
        // an image: drawn once onto a scratch canvas of its own size
        const scratch = document.createElement('canvas')
        scratch.width = p.sw || 1
        scratch.height = p.sh || 1
        ctx = scratch.getContext('2d')
        ctx.drawImage(src, -p.sx, -p.sy)
      }
      alphaReads.set(src, ctx ?? null)
    }
    if (!ctx) return 1
    return ctx.getImageData(ix, iy, 1, 1).data[3] / 255
  } catch {
    return 1
  }
}

/** A short, human name for an item: what shape it is and how it was drawn. */
export function itemName(it) {
  if (it.kind === 'text' || it.kind === 'strokeText') return `text "${it.text.slice(0, 24)}"`
  if (it.kind === 'image') return 'image'
  const arcs = it.arcs ?? []
  const shape = arcs.length === 1 && arcs[0].full && it.subs.length <= 1 ? 'circle' : arcs.length > 1 && arcs.every((a) => a.full) ? `${arcs.length} circles` : it.subs.length === 1 && it.subs[0].length === 8 && it.subs[0].closed ? 'rectangle' : it.subs.length === 1 && it.subs[0].length === 4 ? 'line' : 'shape'
  return `${shape}${it.kind === 'stroke' ? ' (outline)' : ''}`
}

/**
 * Where in the code an item was drawn: the first stack frame that is
 * neither Retouch (this module, or the hook inlined in the page's own
 * document) nor Vite. It is the key items are grouped by: every star drawn
 * by one `ctx.arc` in a loop shares it.
 */
export function siteOf(it, toolDir) {
  if (!it.stack) return null
  if (it._site !== undefined) return it._site
  const doc = location.origin + location.pathname
  const tool = toolDir ? encodeURI(toolDir.replace(/^\//, '')).toLowerCase() : null
  const frames = []
  for (const l of it.stack.split('\n').slice(1)) {
    const m = /\(?((?:https?):\/\/[^\s()]+?):(\d+):(\d+)\)?\s*$/.exec(l)
    if (!m) continue
    const url = m[1]
    const low = url.toLowerCase()
    if ((tool && low.includes(tool)) || low.includes('/@vite/') || url.split('?')[0] === doc) continue
    const name = /^\s*at (?:async )?([^\s(]+) \(/.exec(l)?.[1]?.replace(/^Object\./, '') ?? null
    frames.push({ url, line: Number(m[2]), col: Number(m[3]), name })
    if (frames.length >= 5) break
  }
  if (!frames.length) return (it._site = null)
  // a drawing helper (a disc, a rounded box) is called from everywhere: what it was called FROM tells drawings apart
  const key = frames
    .slice(0, 2)
    .map((f) => `${f.url.split('?')[0]}:${f.line}:${f.col}`)
    .join('<')
  return (it._site = { ...frames[0], frames, key })
}

/** The same item found again in a newer recording: same canvas, same kind, nearest in place and order. */
export function findAgain(item, items) {
  let best = null
  let bestScore = Infinity
  for (const it of items ?? []) {
    if (it.kind !== item.kind) continue
    const d = Math.hypot(it.bbox.x - item.bbox.x, it.bbox.y - item.bbox.y) + Math.abs(it.bbox.w - item.bbox.w) + Math.abs(it.bbox.h - item.bbox.h) + Math.abs(it.seq - item.seq) * 0.5
    if (d < bestScore) {
      bestScore = d
      best = it
    }
  }
  return best
}
