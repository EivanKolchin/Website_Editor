import { runInNewContext } from 'node:vm'
import { tmpdir } from 'node:os'
import { createTimeline } from '../src/client/timeline.js'
import { scrollWheel, pageScroller } from '../src/client/scroll.js'
import { retouchPlugin } from '../src/server/plugin.mjs'
import { normalise } from '../src/server/config.mjs'

export async function interactionTests(test, eq, ok) {
  function page() {
    let top = 0
    const scene = { nodeType: 1, clientHeight: 500, scrollHeight: 5500, clientWidth: 800, scrollWidth: 800, scrollLeft: 0, parentElement: null, tabIndex: 0 }
    Object.defineProperty(scene, 'scrollTop', { get: () => top, set: (v) => { top = Math.max(0, Math.min(5000, v)) } })
    const canvas = { nodeType: 1, parentElement: scene }
    const win = { innerWidth: 800, innerHeight: 500, document: { scrollingElement: null, elementsFromPoint: () => [canvas, scene], getAnimations: () => [] }, getComputedStyle: () => ({ overflowY: 'hidden', overflowX: 'hidden', overscrollBehaviorY: 'contain' }) }
    let frozen = false, time = 1200, redraws = 0
    const boot = { isFrozen: () => frozen, freeze: (v) => { frozen = v }, time: () => time, step: (ms) => { frozen = true; time += ms; redraws++ } }
    const timeline = createTimeline({ win, boot, selected: () => canvas })
    return { win, scene, canvas, boot, timeline, redraws: () => redraws }
  }
  await test('scrolling over a selected frozen canvas moves its hidden scene and redraws at the same clock tick', () => {
    const p = page()
    p.boot.freeze(true)
    eq(pageScroller(p.win, p.canvas), p.scene)
    const handled = scrollWheel(p.win, { clientX: 50, clientY: 50, deltaX: 0, deltaY: 4, deltaMode: 1 }, { frozen: true, overlay: true, redraw: () => p.boot.step(0) })
    ok(handled, 'the selection overlay routes its wheel to the underlying scene')
    eq(p.scene.scrollTop, 64)
    eq(p.boot.time(), 1200, 'scrolling does not advance animation time')
    eq(p.redraws(), 1)
    p.scene.scrollTop = 5000
    ok(scrollWheel(p.win, { clientX: 50, clientY: 50, deltaX: 0, deltaY: 300, deltaMode: 0 }, { frozen: true }), 'contained scene does not leak a wheel to the page outside')
    eq(p.scene.scrollTop, 5000)
  })
  await test('scrolling chooses the scene track rather than a sticky clip filled with overflowing absolute artwork', () => {
    const p = page()
    const art = { position: 'absolute', offsetTop: 0, offsetHeight: 6000 }
    const clip = { nodeType: 1, clientHeight: 500, scrollHeight: 6000, tabIndex: -1, children: [art], parentElement: p.scene }
    p.canvas.parentElement = clip
    p.win.getComputedStyle = (el) => ({ overflowY: 'hidden', position: el.position ?? 'sticky' })
    eq(pageScroller(p.win, p.canvas), p.scene, 'the outer scroll track owns the animation')
    scrollWheel(p.win, { clientX: 50, clientY: 50, deltaX: 0, deltaY: 300, deltaMode: 0 }, { frozen: true })
    eq(p.scene.scrollTop, 300)
    p.scene.tabIndex = -1
    p.scene.children = [{ position: 'relative', offsetTop: 0, offsetHeight: 5500 }]
    eq(pageScroller(p.win, p.canvas), p.scene, 'a non-focusable scroller is found by its in-flow track')
  })
  await test('page timeline spans the entire scene, clamps seeks and restores scroll and playback on cancellation', () => {
    const p = page(), t = p.timeline
    p.scene.scrollTop = 100
    eq(t.state().kind, 'scroll')
    eq(t.state().end, 5000)
    t.begin()
    t.preview(2500)
    eq(t.state().position, 2500)
    eq(p.scene.scrollTop, 2500)
    eq(t.clock(), 1200)
    t.end(false)
    eq(p.scene.scrollTop, 100)
    eq(p.boot.isFrozen(), false, 'a playing page resumes on cancellation')
    p.boot.freeze(true)
    t.begin()
    t.preview(-100)
    eq(p.scene.scrollTop, 0)
    t.preview(9000)
    eq(p.scene.scrollTop, 5000)
    t.end(false)
    eq(p.scene.scrollTop, 100)
    eq(p.boot.isFrozen(), true, 'an already frozen page stays frozen')
    t.begin()
    t.preview(2500)
    t.end(true)
    eq(p.scene.scrollTop, 2500, 'release applies the previewed position')
    eq(t.state().scrubbing, false)
  })
  await test('time timeline includes full declared animation duration, hides tentative clock changes, commits and rewinds', () => {
    const p = page(), t = p.timeline
    p.win.document.getAnimations = () => [{ currentTime: 1000, playbackRate: 1, effect: { getComputedTiming: () => ({ endTime: 60000 }) } }]
    t.setMode('time')
    ok(t.state().end >= 60200, 'the entire finite animation fits')
    const duration = t.state().end
    p.boot.speed = () => .25
    p.win.document.getAnimations = () => [{ currentTime: 1000, playbackRate: .25, effect: { getComputedTiming: () => ({ endTime: 60000 }) } }]
    eq(t.state().end, duration, 'slow motion does not stretch the virtual time range')
    t.begin()
    t.preview(15000)
    eq(p.boot.time(), 15000)
    eq(t.clock(), 1200, 'panels retain committed clock until release')
    t.end(true)
    eq(t.clock(), 15000)
    eq(p.boot.isFrozen(), true)
    t.begin()
    t.preview(0)
    t.end(false)
    eq(p.boot.time(), 15000)
  })
  await test('the virtual clock retains in-flight frames at freeze and preserves cancellation when playback resumes', () => {
    const script = retouchPlugin({ config: normalise({}, tmpdir()) }).transformIndexHtml().find((tag) => tag.tag === 'script' && tag.children).children
    let real = 100, next = 0, calls = 0, value = 0
    const native = new Map()
    const win = { requestAnimationFrame: (cb) => { native.set(++next, cb); return next }, cancelAnimationFrame: (id) => native.delete(id) }
    const doc = { getAnimations: () => [], documentElement: { toggleAttribute() {} }, readyState: 'complete' }
    runInNewContext(script, { window: win, document: doc, performance: { now: () => real }, sessionStorage: { getItem: () => null }, parent: { location: { search: '' } }, URLSearchParams, setTimeout, setInterval, clearInterval, console })
    function frame(t) { calls++; value = t; win.requestAnimationFrame(frame) }
    win.requestAnimationFrame(frame)
    win.__RETOUCH__.freeze(true)
    eq(native.size, 0, 'an in-flight frame is stopped immediately')
    win.__RETOUCH__.step(250)
    eq(calls, 1, 'step renders even before another real frame arrives')
    eq(value, 350)
    win.__RETOUCH__.step(-100)
    eq(value, 250)
    const cancel = win.requestAnimationFrame(() => { throw new Error('cancelled callback ran') })
    win.__RETOUCH__.freeze(false)
    win.cancelAnimationFrame(cancel)
    eq(native.size, 1, 'the cancelled frozen callback stays cancelled after play')
    real += 20
    const callbacks = [...native.values()]
    native.clear()
    callbacks.forEach((cb) => cb(real))
    eq(calls, 3)
    eq(value, 270)
    win.__RETOUCH__.freeze(true)
  })
  await test('a live timeline preview ignores the real page stored clock and remains usable', () => {
    const script = retouchPlugin({ config: normalise({}, tmpdir()) }).transformIndexHtml().find((tag) => tag.tag === 'script' && tag.children).children
    const win = { name: 'retouch-preview', requestAnimationFrame: () => 1, cancelAnimationFrame() {} }
    runInNewContext(script, { window: win, document: { getAnimations: () => [], documentElement: { toggleAttribute() {} }, readyState: 'complete' }, performance: { now: () => 100 }, sessionStorage: { getItem: () => { throw new Error('preview read the main page clock') } }, parent: { location: { search: '' } }, URLSearchParams, setTimeout, setInterval, clearInterval, console })
    eq(win.__RETOUCH__.isFrozen(), false)
    win.__RETOUCH__.step(250)
    eq(win.__RETOUCH__.time(), 350, 'the studio can still drive the preview clock')
  })
  await test('CSS scrubbing follows the virtual clock at slow speed and preserves animation start offsets through a rewind', () => {
    const script = retouchPlugin({ config: normalise({}, tmpdir()) }).transformIndexHtml().find((tag) => tag.tag === 'script' && tag.children).children
    const animation = { currentTime: 50, playbackRate: 1, playState: 'running', pause() { this.playState = 'paused' }, play() { this.playState = 'running' } }
    const win = { requestAnimationFrame: () => 1, cancelAnimationFrame() {} }
    runInNewContext(script, { window: win, document: { getAnimations: () => [animation], documentElement: { toggleAttribute() {} }, readyState: 'complete' }, performance: { now: () => 100 }, sessionStorage: { getItem: () => null }, parent: { location: { search: '' } }, URLSearchParams, setTimeout, setInterval, clearInterval, console })
    const clock = win.__RETOUCH__
    try {
      clock.setSpeed(.25)
      clock.freeze(true)
      clock.step(100)
      eq(animation.currentTime, 150, 'one hundred virtual milliseconds is the same CSS and frame-loop time')
      clock.step(-200)
      eq(animation.currentTime, -50, 'the beginning retains the animation start offset')
      clock.step(100)
      eq(animation.currentTime, 50, 'restoring time restores the exact CSS position')
      animation.currentTime = 75
      clock.step(100)
      eq(animation.currentTime, 175, 'a Motion-panel seek becomes the new anchor')
    } finally { clock.setSpeed(1) }
  })
}
