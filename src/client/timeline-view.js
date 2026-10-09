import { h } from './ui.js'

export const TIMELINE_CSS = `
.bottom .jog { position:relative;flex:1 1 400px;min-width:100px;height:28px;border-radius:6px;background:rgba(255,255,255,.025);border:1px solid var(--line);cursor:ew-resize;touch-action:none;outline:none;overflow:hidden; }
.bottom .jog:focus-visible { border-color:var(--acc);box-shadow:0 0 0 2px var(--acc-soft); }
.jog .ticks { position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(255,255,255,.12) 0 1px,transparent 1px 5%);opacity:.55; }
.jog .elapsed { position:absolute;inset:0 auto 0 0;background:var(--playhead-soft);pointer-events:none; }
.jog .edge { position:absolute;bottom:4px;left:8px;font:10px ui-monospace,monospace;color:var(--mut);pointer-events:none; }
.jog .edge.end { left:auto;right:8px; }
.jog .needle { position:absolute;top:0;bottom:0;width:2px;background:var(--playhead);pointer-events:none; }
.jog .needle::before { content:'';position:absolute;left:-3px;top:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--playhead); }
.bottom .timeline-mode { font-size:11px;min-width:48px;color:var(--mut); }
.bottom .sel { flex:0 1 220px; }
.scrub-hold { position:absolute;inset:0;z-index:2;pointer-events:none;background:#fff; }
.scrub-hold iframe { width:100%;height:100%;border:0;pointer-events:none; }
.scrub-preview { position:fixed;z-index:25;pointer-events:none;width:320px;padding:5px;border-radius:12px;background:var(--panel-2);border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 65px rgba(0,0,0,.6); }
.scrub-preview[hidden] { display:none; }
.scrub-preview .preview-viewport { position:relative;overflow:hidden;border-radius:7px;background:var(--bg); }
.scrub-preview iframe { position:absolute;border:0;transform-origin:0 0;pointer-events:none; }
.scrub-preview .preview-caption { display:flex;justify-content:space-between;align-items:center;padding:9px 7px 5px;gap:12px;font-size:11px;color:var(--mut); }
.scrub-preview .preview-value { color:#fff;font-variant-numeric:tabular-nums; }
@media(max-width:760px) { .bottom .sel,.bottom .seg { display:none; } }
`

const label = (s) => s.kind === 'scroll' ? `${Math.round(s.position / s.end * 100)}%` : `${(s.position / 1000).toFixed(2)} s`
// A sandbox with scripting disabled renders canvas fallback content instead
// of its pixels. Snapshot documents forbid scripts with CSP instead.
const inertFrame = (title) => h('iframe', { title, tabindex: '-1', 'aria-hidden': 'true' })

export function createTimelineView({ getCtl, getPage, frameBox, jog, timeEl, modeBtn }) {
  const needle = h('div', { class: 'needle' })
  const elapsed = h('div', { class: 'elapsed' })
  const endLabel = h('span', { class: 'edge end' })
  jog.replaceChildren(h('div', { class: 'ticks' }), elapsed, h('span', { class: 'edge', text: '0' }), endLabel, needle)
  const thumbnail = inertFrame('Animation scrub preview')
  const viewport = h('div', { class: 'preview-viewport' }, thumbnail)
  const previewValue = h('span', { class: 'preview-value' })
  const popup = h('div', { class: 'scrub-preview', hidden: true }, viewport,
    h('div', { class: 'preview-caption' }, previewValue, h('span', { text: 'Release to apply · Esc to cancel' })))
  document.body.append(popup)
  let active = null, paint = 0, wheelTimer = 0
  function render() {
    const c = getCtl(), s = c?.timeline?.()
    if (!s) return
    if (active && active.ctl !== c) finish(false)
    const fraction = Math.max(0, Math.min(1, s.position / s.end))
    needle.style.left = `calc(${fraction * 100}% - ${fraction * 2}px)`
    elapsed.style.width = `${fraction * 100}%`
    endLabel.textContent = s.kind === 'scroll' ? '100%' : `${Math.round(s.end / 1000)} s`
    timeEl.textContent = label(s)
    modeBtn.textContent = s.kind === 'scroll' ? 'Page' : 'Time'
    modeBtn.disabled = s.scrubbing || !s.hasScroll
    modeBtn.title = s.kind === 'scroll' ? 'Page animation: switch to the time clock' : 'Time animation: switch to page scrolling'
    jog.setAttribute('aria-valuemax', String(s.end))
    jog.setAttribute('aria-valuenow', String(Math.round(s.position)))
    jog.setAttribute('aria-valuetext', `${s.kind === 'scroll' ? 'Page' : 'Time'} ${label(s)}`)
    jog.title = 'Drag or scroll to preview the whole animation. Release to apply. Arrow keys, Home and End also seek.'
    previewValue.textContent = `${s.kind === 'scroll' ? 'Page' : 'Time'} ${label(s)}`
    return s
  }
  function place() {
    if (!active) return
    const { win } = active, s = active.ctl.timeline(), r = jog.getBoundingClientRect()
    const width = Math.min(320, innerWidth - 24), area = width - 12
    const height = Math.min(220, Math.max(100, area * win.innerHeight / win.innerWidth))
    const scale = Math.min(area / win.innerWidth, height / win.innerHeight)
    popup.style.width = `${width}px`
    viewport.style.height = `${height}px`
    Object.assign(thumbnail.style, { width: `${win.innerWidth}px`, height: `${win.innerHeight}px`, transform: `scale(${scale})`, left: `${(area - win.innerWidth * scale) / 2}px` })
    const x = r.left + s.position / s.end * r.width
    popup.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, x - width / 2))}px`
    popup.style.bottom = `${innerHeight - r.top + 12}px`
  }
  function start(pointerId = null) {
    if (active) return true
    const c = getCtl(), win = getPage()
    if (!c?.beginScrub || !win) return false
    const still = inertFrame('Current project state')
    const hold = h('div', { class: 'scrub-hold', 'aria-hidden': 'true' }, still)
    frameBox.append(hold)
    try {
      // Hold the main view BEFORE the clock or the page scroll is changed.
      if (!c.snapshotInto(still)) { hold.remove(); return false }
      c.beginScrub()
      active = { ctl: c, win, hold, pointerId }
      c.snapshotInto(thumbnail)
      popup.hidden = false
      render()
      place()
      return true
    } catch (error) {
      hold.remove()
      c.endScrub(false)
      throw error
    }
  }
  function update(position) {
    if (!active) return
    active.ctl.previewScrub(position)
    render()
    place()
    if (!paint) paint = requestAnimationFrame(() => {
      paint = 0
      if (active) active.ctl.snapshotInto(thumbnail)
    })
  }
  function fromPointer(e) {
    const r = jog.getBoundingClientRect()
    return (e.clientX - r.left) / r.width * active.ctl.timeline().end
  }
  function finish(commit) {
    if (!active) return
    const previous = active
    active = null
    clearTimeout(wheelTimer)
    cancelAnimationFrame(paint)
    paint = 0
    try { previous.ctl.endScrub(commit) } finally {
      previous.hold.remove()
      popup.hidden = true
      if (previous.pointerId != null && jog.hasPointerCapture(previous.pointerId)) jog.releasePointerCapture(previous.pointerId)
      render()
    }
  }
  jog.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !start(e.pointerId)) return
    clearTimeout(wheelTimer)
    e.preventDefault()
    jog.focus({ preventScroll: true })
    jog.setPointerCapture(e.pointerId)
    active.pointerId = e.pointerId
    update(fromPointer(e))
  })
  jog.addEventListener('pointermove', (e) => { if (active?.pointerId === e.pointerId) update(fromPointer(e)) })
  jog.addEventListener('pointerup', (e) => {
    if (active?.pointerId !== e.pointerId) return
    update(fromPointer(e))
    finish(true)
  })
  jog.addEventListener('pointercancel', () => finish(false))
  jog.addEventListener('lostpointercapture', () => finish(false))
  jog.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey || active?.pointerId != null || !start()) return
    e.preventDefault()
    const s = active.ctl.timeline()
    const delta = (e.deltaX || e.deltaY) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 200 : 1)
    update(s.position + delta * s.end / Math.max(1, jog.clientWidth))
    clearTimeout(wheelTimer)
    wheelTimer = setTimeout(() => finish(true), 220)
  }, { passive: false })
  jog.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) || active) return
    e.preventDefault()
    e.stopPropagation()
    if (!start()) return
    const s = active.ctl.timeline(), step = s.kind === 'scroll' ? s.end / 100 : 1000 / 60
    const value = e.key === 'Home' ? 0 : e.key === 'End' ? s.end : s.position + step * (e.shiftKey ? 10 : 1) * (['ArrowLeft', 'ArrowDown'].includes(e.key) ? -1 : 1)
    update(value)
    finish(true)
  })
  modeBtn.addEventListener('click', () => {
    const c = getCtl(), s = c?.timeline()
    if (s && !active) { c.setTimelineMode(s.kind === 'scroll' ? 'time' : 'scroll'); render() }
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && active) { e.preventDefault(); e.stopPropagation(); finish(false) }
  }, true)
  window.addEventListener('blur', () => finish(false))
  window.addEventListener('resize', () => finish(false))
  setInterval(render, 100)
  return { render, cancel: () => finish(false) }
}
