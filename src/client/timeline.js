import { pageScroller } from './scroll.js'

const clamp = (n, max) => Math.max(0, Math.min(max, Number(n) || 0))

/** The page owns scrub state. The studio only reads it and draws snapshots. */
export function createTimeline({ win, boot, selected, exclude, changed }) {
  let mode = 'auto'
  let scrub = null
  let clockEnd = 30000
  const time = () => boot.time?.() ?? 0
  const scroller = () => pageScroller(win, selected?.(), exclude)
  function state() {
    const target = scrub?.target ?? scroller()
    const kind = scrub?.kind ?? (mode !== 'time' && target ? 'scroll' : 'time')
    let end = scrub?.end
    if (end == null && kind === 'scroll') end = Math.max(1, target.scrollHeight - target.clientHeight)
    if (end == null) {
      // CSS/WAAPI supply their full duration. Frame loops have no declared end;
      // give them thirty seconds, extending the range as their clock runs.
      let last = time() + 2000
      for (const animation of win.document.getAnimations?.() ?? []) {
        try {
          const duration = animation.effect?.getComputedTiming().endTime
          const rate = animation.playbackRate / (boot.speed?.() ?? 1)
          if (Number.isFinite(duration) && typeof animation.currentTime === 'number' && rate > 0) {
            last = Math.max(last, time() + (duration - animation.currentTime) / rate)
          }
        } catch {}
      }
      clockEnd = Math.max(clockEnd, Math.ceil(last / 10000) * 10000)
      end = clockEnd
    }
    const position = scrub?.position ?? (kind === 'scroll' ? target.scrollTop : time())
    return { kind, end, position: clamp(position, end), hasScroll: !!target, scrubbing: !!scrub }
  }
  function apply(position) {
    if (scrub.kind === 'scroll') {
      scrub.target.scrollTop = position
      boot.step?.(0)
    } else boot.step?.(position - time())
    scrub.position = position
    changed?.()
  }
  function begin() {
    if (scrub) return state()
    const s = state()
    boot.freeze?.(true)
    const target = s.kind === 'scroll' ? scroller() : null
    scrub = { ...s, target, position: s.kind === 'scroll' ? target.scrollTop : time(), originalTime: time(), originalScroll: target?.scrollTop }
    // Keep the user's playback preference for cancellation, without persisting
    // transient preview state in sessionStorage or the source history.
    changed?.()
    return state()
  }
  return {
    state,
    clock: () => scrub ? scrub.originalTime : time(),
    setMode(kind) { if (!scrub) { mode = kind === 'scroll' ? 'scroll' : 'time'; changed?.() } },
    begin() {
      if (scrub) return state()
      const wasFrozen = !!boot.isFrozen?.()
      const result = begin()
      scrub.frozen = wasFrozen
      return result
    },
    preview(position) { if (scrub) apply(clamp(position, scrub.end)) },
    end(commit = true) {
      if (!scrub) return
      const original = scrub
      if (!commit) {
        if (original.target) original.target.scrollTop = original.originalScroll
        boot.step?.(original.originalTime - time())
      }
      scrub = null
      boot.freeze?.(commit || original.frozen)
      changed?.()
    },
  }
}
