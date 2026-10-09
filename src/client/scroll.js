// Scroll the page beneath a selection box, including a scene whose script
// normally moves an overflow:hidden scroller. Frozen scripts cannot respond
// to a wheel, so Edit mode moves that scroller and redraws the same clock tick.
export function scrollable(win, el, axis = 'y') {
  if (!el || el.nodeType !== 1) return false
  const vertical = axis === 'y'
  const extent = vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
  if (extent < 2 || !(vertical ? el.clientHeight : el.clientWidth)) return false
  if (el === win.document.scrollingElement) return true
  const style = win.getComputedStyle(el)
  const overflow = vertical ? style.overflowY : style.overflowX
  if (!/^(auto|scroll|hidden)$/.test(overflow)) return false
  if (overflow === 'hidden' && el.tabIndex < 0) {
    // A sticky scene clips absolute artwork parked outside its viewport. Its
    // scrollHeight includes that artwork, but scrolling it hides the drawing.
    // A scripted scroller has a real track in its flow (or is focusable).
    const track = [...el.children].some((child) => {
      const position = win.getComputedStyle(child).position
      if (position === 'absolute' || position === 'fixed') return false
      return vertical ? child.offsetTop + child.offsetHeight > el.clientHeight + 2 : child.offsetLeft + child.offsetWidth > el.clientWidth + 2
    })
    if (!track) return false
  }
  return true
}

export function scrollAncestors(win, el, axis = 'y', exclude) {
  const result = []
  for (let node = el; node; node = node.parentElement) {
    if (!exclude?.contains(node) && scrollable(win, node, axis)) result.push(node)
  }
  const root = win.document.scrollingElement
  if (!result.includes(root) && scrollable(win, root, axis)) result.push(root)
  return result
}

export function scrollAt(win, x, y, axis = 'y', exclude) {
  const stack = win.document.elementsFromPoint(x, y)
  const el = stack.find((node) => !exclude?.contains(node))
  return scrollAncestors(win, el, axis, exclude)
}

export function pageScroller(win, selected, exclude) {
  const own = scrollAncestors(win, selected, 'y', exclude)
  if (own.length && own[0] !== win.document.scrollingElement) return own[0]
  const beneath = scrollAt(win, win.innerWidth / 2, win.innerHeight / 2, 'y', exclude)
  return beneath[0] ?? own[0] ?? null
}

export function scrollWheel(win, event, { exclude, frozen = false, overlay = false, redraw } = {}) {
  const sideways = event.shiftKey && !event.deltaX
  const dx = sideways ? event.deltaY : event.deltaX
  const dy = sideways ? 0 : event.deltaY
  const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
  const targets = scrollAt(win, event.clientX, event.clientY, axis, exclude)
  for (const el of targets) {
    const style = win.getComputedStyle(el)
    const hidden = (axis === 'y' ? style.overflowY : style.overflowX) === 'hidden'
    if (!frozen && !overlay && !hidden) return false // the site's native scroll
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1
    const x = el.scrollLeft, y = el.scrollTop
    // Assigning scrollTop is immediate, even on sites with smooth scrolling.
    el.scrollLeft += dx * unit
    el.scrollTop += dy * unit
    if (Math.abs(el.scrollLeft - x) > 0.1 || Math.abs(el.scrollTop - y) > 0.1) {
      redraw?.()
      return true
    }
    const boundary = axis === 'y' ? style.overscrollBehaviorY : style.overscrollBehaviorX
    if (boundary === 'contain' || boundary === 'none') return true
  }
  return false
}

/**
 * THE PAGE'S OWN SCROLL, FOR THE TIMELINE.
 *
 * A scroll-driven page keeps its whole story in one scroller: scene after
 * scene, each one a stretch of scroll. That scroller is often NOT the
 * document - a landing page that plays its scenes in a fixed window scrolls
 * an element of its own, with `overflow: hidden` so only its script moves
 * it - so it is found by what it does: of everything that can scroll, the
 * one with the most scroll to it, weighted by how much of the window it
 * covers. A narrow side panel with a long list does not win over the page.
 *
 * Positions are FRACTIONS of the scroller's range, 0 at the top and 1 at
 * the bottom, so the studio's bar, the page and the preview (a second copy
 * of the page, laid out at the same size) all mean the same point by the
 * same number.
 */

const cache = new WeakMap() // window -> { el, at }

/**
 * Whether `el` is a scroller: something to scroll, and an overflow that
 * clips. An `overflow: hidden` box counts only when laid-out boxes really
 * run past it, because a TRANSFORM adds to scrollHeight too: a stage that
 * clips its own props, with the scenes still to come translated far below
 * it, reports more scroll than the page has and is not a scroller at all.
 */
function canScroll(win, el) {
  if (el.scrollHeight - el.clientHeight < 2) return false
  const oy = win.getComputedStyle(el).overflowY
  if (oy === 'visible' || oy === 'clip') return false
  return oy !== 'hidden' || laidOutBottom(el) > el.clientHeight + 2
}

/** How far down the element's children are laid out (offsets ignore transforms), from its top. */
function laidOutBottom(el) {
  let bottom = 0
  for (const c of el.children) {
    if (!('offsetTop' in c) || c.offsetParent == null) continue
    const top = c.offsetParent === el ? c.offsetTop : c.offsetParent === el.offsetParent ? c.offsetTop - el.offsetTop - el.clientTop : null
    if (top != null) bottom = Math.max(bottom, top + c.offsetHeight)
  }
  return bottom
}

/** The element that holds the page's scroll story, or null when nothing on the page scrolls. */
export function mainScroller(win) {
  const doc = win?.document
  if (!doc?.body) return null
  const hit = cache.get(win)
  // found again at most once a second, and at once if the last one has gone or stopped scrolling
  if (hit && hit.el.isConnected && Date.now() - hit.at < 1000 && hit.el.scrollHeight - hit.el.clientHeight >= 2) return hit.el
  const vw = Math.max(1, win.innerWidth)
  const vh = Math.max(1, win.innerHeight)
  let best = null
  let bestScore = 0
  const se = doc.scrollingElement ?? doc.documentElement
  if (se && se.scrollHeight - se.clientHeight >= 2) {
    best = se
    bestScore = se.scrollHeight - se.clientHeight
  }
  for (const el of [doc.body, ...doc.body.querySelectorAll('*')]) {
    // the editor's own surfaces are never the page, and the document was weighed above
    if (el === se || el.localName === 'retouch-editor') continue
    if (!canScroll(win, el)) continue
    const r = el.getBoundingClientRect()
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0))
    const ht = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
    const cover = (w * ht) / (vw * vh)
    if (cover < 0.25) continue
    const score = (el.scrollHeight - el.clientHeight) * cover
    if (score > bestScore) {
      best = el
      bestScore = score
    }
  }
  if (best) cache.set(win, { el: best, at: Date.now() })
  else cache.delete(win)
  return best
}

/**
 * Where the page is in its scroll: the fraction `p`, the range in pixels,
 * and `screen`, the share of the range one screenful is (what the bar's
 * ticks are spaced by). Null when the page does not scroll.
 */
export function scrollState(win) {
  const el = mainScroller(win)
  if (!el) return null
  const range = el.scrollHeight - el.clientHeight
  if (range < 2) return null
  return { el, range, p: Math.min(1, Math.max(0, el.scrollTop / range)), screen: el.clientHeight / range }
}

/** Scroll the page to the fraction `p` of its range, at once (never smoothly: the bar has already moved there). */
export function scrollToFraction(win, p) {
  const s = scrollState(win)
  if (!s) return null
  const top = Math.round(Math.min(1, Math.max(0, p)) * s.range)
  try {
    s.el.scrollTo({ top, behavior: 'instant' })
  } catch {
    s.el.scrollTop = top
  }
  return scrollState(win)
}
