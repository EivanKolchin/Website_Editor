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
