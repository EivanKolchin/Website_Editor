import { createApi } from './api.js'
import { createColorPanel } from './color.js'
import * as G from './geometry.js'
import { createFinder, FINDER_CSS } from './finder.js'
import { createHistory } from './history.js'
import { createInspector, INSPECTOR_CSS } from './inspector.js'
import { colorDistance, parseColor, rgbToHex } from './palette.js'
import { createCanvasRecorder, findAgain, itemName, itemsAt, pageRect, scaleFor, siteOf } from './canvas.js'
import { createPicker, pixelOf } from './pick.js'
import { scrollState, scrollToFraction } from './scroll.js'
import { baseOf, countStamps, fiberOf, isSvgChild, peersOf, unitChain, unitFor } from './react.js'
import { alignmentGuides, collectGroupTargets, collectTargets, createGuideLayer, dropMoving, rectOf, snapAngle, snapMove, snapScale, unionBox } from './snap.js'
import { applyText, blockFor, startEditing, textNodes } from './text.js'
import { animationsOf, colorsIn, matchedRules, normSelector, SHORTHAND, stateRules, varsFor, watchMotion, winner } from './trace.js'
import { bandOf, canvasToneArea, cssToneArea, parseCssGradient } from './tones.js'
import { buildMask, colorAt, offsetAt, paintMask } from './tonemask.js'
import { createUI, h, icon, zoomKeyOf } from './ui.js'

/**
 * THE EDITOR.
 *
 * Edit mode takes the pointer and keyboard away from the page; view mode
 * gives them back. Every edit is previewed in the page itself and recorded
 * in one undo history; nothing reaches a file until Save, which sends the
 * net state of every edited element to the server in one batch.
 */
export function createApp(boot, hot) {
  const api = createApi(boot)
  const ui = createUI()
  ui.shadow.append(h('style', { text: INSPECTOR_CSS }))
  const color = createColorPanel({ ui })
  // inside the studio's frame, the studio draws the bar and the panels; the page keeps its overlays
  const shell = (() => {
    try {
      return window.parent !== window ? window.parent.__RETOUCH_SHELL__ ?? null : null
    } catch {
      return null
    }
  })()
  const embedded = !!shell
  if (embedded) ui.root.classList.add('embedded')
  const events = new EventTarget()
  let emitQueued = false
  /** Tell whoever draws the panels that something changed; batched to one event per task. */
  const emit = () => {
    if (emitQueued) return
    emitQueued = true
    queueMicrotask(() => {
      emitQueued = false
      events.dispatchEvent(new Event('change'))
    })
  }
  const guides = createGuideLayer(ui.guidesHost)
  const realRaf = boot.raf ?? window.requestAnimationFrame.bind(window)
  const store = {
    get: (k) => {
      try {
        return sessionStorage.getItem('retouch:' + k)
      } catch {
        return null
      }
    },
    set: (k, v) => {
      try {
        sessionStorage.setItem('retouch:' + k, v)
      } catch {}
    },
  }

  let snapPref = null
  try {
    snapPref = localStorage.getItem('retouch:snap')
  } catch {}
  const state = {
    mode: store.get('mode') === 'view' ? 'view' : 'edit',
    collapsed: store.get('collapsed') === '1',
    sel: null,
    editing: null,
    config: { locked: [], colors: {} },
    check: null,
    saving: false,
    gesture: null,
    activeGesture: null,
    lastClick: null,
    passClicks: false,
    // smart guides and snapping: on unless switched off on this device
    snap: snapPref !== '0',
    // the last colour picked off the page, and where it is written
    picked: null,
    anims: [],
  }
  const recs = new Map() // element -> live edit record
  const blocks = new Map() // block element -> text record
  const infoCache = new Map()
  let htmlStamps = new WeakMap() // element from an HTML string -> its pseudo-stamp, or null when not found
  let located = new WeakMap() // CSSStyleRule -> where the server found it
  const declEdits = new Map() // `${file}:${start}` -> an unsaved edit of a rule's declaration
  const recolors = new Map() // colour literal id -> an unsaved colour written where it is defined
  const scopes = new WeakMap() // element -> Map(prop -> 'element' | 'rule')
  let traceCache = new WeakMap()
  let motionCache = new WeakMap()
  const history = createHistory(() => renderBar())

  /* ================================================================ */
  /*  toolbar                                                          */
  /* ================================================================ */

  const btn = (name, title, onclick, cls = '') => h('button', { class: cls, title, html: icon(name), onclick })
  const editBtn = h('button', { html: `${icon('pencil', 14)}<span>Edit</span>`, title: 'Edit mode: click to select (Ctrl+Shift+E)', onclick: () => setMode('edit') })
  const viewBtn = h('button', { html: `${icon('eye', 14)}<span>View</span>`, title: 'View mode: use the page normally, links included (Ctrl+Shift+E)', onclick: () => setMode('view') })
  const pathInput = h('input', { class: 'path mono', spellcheck: 'false', title: 'Go to a page: pick one, or type an address and press Enter', 'aria-label': 'Page' })
  const undoBtn = btn('undo', 'Undo (Ctrl+Z)', () => undo(), 'edit-only')
  const redoBtn = btn('redo', 'Redo (Ctrl+Shift+Z)', () => redo(), 'edit-only')
  const freezeBtn = btn('freeze', 'Freeze motion', () => setFrozen(!boot.isFrozen?.()), 'edit-only')
  const snapBtn = btn('magnet', 'Snap to guides (hold Ctrl while dragging to place freely)', () => setSnap(!state.snap), 'edit-only')
  const pickBtn = btn('pipette', 'Pick a colour off the page (I)', () => togglePick(), 'edit-only')
  const studioBtn = btn('dock', 'Open the studio: the page with layers and properties beside it', () => goStudio())
  const searchBtn = btn('search', 'Search the page: words, elements, files, colours, commands (Ctrl+K or /)', () => openFinder())
  const pendingBtn = h('button', { class: 'pending', onclick: () => toggleMenu('pending') })
  const saveBtn = h('button', { class: 'primary', html: `${icon('check', 14)}<span>Save</span>`, title: 'Save to source (Ctrl+S)', onclick: () => save() })
  const checkBtn = h('button', { class: 'check', title: 'Project check', onclick: () => toggleMenu('check') })
  const brand = h('div', { class: 'brand', title: 'Retouch - drag to move this bar, click to fold it, double-click to dock it again' }, h('span', { class: 'dot' }), h('span', { text: 'Retouch' }))
  ui.bar.append(
    brand,
    h('div', { class: 'seg' }, editBtn, viewBtn),
    h('span', { class: 'sep' }),
    btn('back', 'Back', () => goHistory(-1)),
    btn('fwd', 'Forward', () => goHistory(1)),
    pathInput,
    btn('reload', 'Reload page', () => location.reload()),
    h('span', { class: 'sep edit-only' }),
    undoBtn,
    redoBtn,
    h('span', { class: 'sep edit-only' }),
    searchBtn,
    snapBtn,
    freezeBtn,
    pickBtn,
    h('span', { class: 'sep' }),
    pendingBtn,
    saveBtn,
    checkBtn,
    btn('help', 'Shortcuts', () => toggleHelp()),
    studioBtn,
  )

  /* ---- the page picker: every page the site itself links to ---- */
  pathInput.addEventListener('focus', () => {
    pathInput.select()
    showPages()
  })
  pathInput.addEventListener('input', () => showPages(pathInput.value))
  pathInput.addEventListener('blur', () => setTimeout(() => ui.menu.dataset.which === 'pages' && (ui.menu.style.display = 'none'), 180))
  pathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = ui.menu.dataset.which === 'pages' && pathInput.value.trim() && !pathInput.value.trim().startsWith('/') ? ui.menu.querySelector('.page') : null
      const v = first?.dataset.href ?? (pathInput.value.trim() || '/')
      pathInput.blur()
      go(v.startsWith('/') || /^[a-z]+:/i.test(v) ? v : '/' + v)
    } else if (e.key === 'Escape') {
      ui.menu.style.display = 'none'
      pathInput.blur()
    }
  })
  const syncPath = () => {
    if (ui.shadow.activeElement !== pathInput) pathInput.value = location.pathname + location.search + location.hash
  }
  setInterval(syncPath, 600)
  window.addEventListener('popstate', () => setTimeout(syncPath))
  syncPath()

  /** Same-origin pages the current page links to, as the site names them. */
  function sitePages() {
    const seen = new Map()
    for (const a of document.querySelectorAll('a[href]')) {
      if (ui.host.contains(a)) continue
      const raw = a.getAttribute('href')
      if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw) || a.hasAttribute('download')) continue
      let url
      try {
        url = new URL(raw, location.href)
      } catch {
        continue
      }
      if (url.origin !== location.origin) continue
      const path = (url.pathname.replace(/\/+$/, '') || '/') + url.search
      const label = (a.getAttribute('aria-label') || a.title || a.textContent || '').replace(/\s+/g, ' ').trim()
      const prev = seen.get(path)
      // the shortest real name wins: a nav link's "About" over a card's paragraph
      if (!prev || (label && (!prev.label || label.length < prev.label.length))) seen.set(path, { path, label })
    }
    if (!seen.has('/')) seen.set('/', { path: '/', label: 'Home' })
    return [...seen.values()].sort((x, y) => x.path.localeCompare(y.path))
  }

  function showPages(filter = '') {
    const q = filter.trim().toLowerCase()
    const here = location.pathname.replace(/\/+$/, '') || '/'
    const pages = sitePages().filter((p) => !q || p.path.toLowerCase().includes(q) || p.label.toLowerCase().includes(q) || pathInput.value === here)
    const m = ui.menu
    m.dataset.which = 'pages'
    m.replaceChildren(h('h6', { text: pages.length ? 'Pages this page links to' : 'No links match - press Enter to open the address' }))
    for (const p of pages) {
      m.append(
        h(
          'button',
          {
            class: `page${p.path === here ? ' here' : ''}`,
            'data-href': p.path,
            // pointerdown, not click: the field's blur would close the list first
            onpointerdown: (e) => {
              e.preventDefault()
              pathInput.blur()
              go(p.path)
            },
          },
          h('span', { text: p.label || p.path }),
          h('span', { class: 'mono', text: p.path }),
        ),
      )
    }
    m.style.display = 'block'
    placeNearBar(m)
  }

  /* ---- the bar can be moved out of the way, and remembers where ---- */
  const BAR_KEY = 'retouch:bar'
  const local = {
    get: () => {
      try {
        return JSON.parse(localStorage.getItem(BAR_KEY) ?? 'null')
      } catch {
        return null
      }
    },
    set: (v) => {
      try {
        if (v) localStorage.setItem(BAR_KEY, JSON.stringify(v))
        else localStorage.removeItem(BAR_KEY)
      } catch {}
    },
  }
  function placeBar(pos) {
    const bar = ui.bar
    if (!pos) {
      bar.classList.remove('free')
      bar.style.left = bar.style.top = ''
      return
    }
    const w = bar.offsetWidth || 600
    const hgt = bar.offsetHeight || 40
    bar.classList.add('free')
    bar.style.left = `${Math.max(6, Math.min(innerWidth - w - 6, pos.left))}px`
    bar.style.top = `${Math.max(6, Math.min(innerHeight - hgt - 6, pos.top))}px`
  }
  placeBar(local.get())
  window.addEventListener('resize', () => local.get() && placeBar(local.get()))
  brand.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const r = ui.bar.getBoundingClientRect()
    const dx = e.clientX - r.left
    const dy = e.clientY - r.top
    let moved = false
    try {
      brand.setPointerCapture(e.pointerId)
    } catch {}
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return
      moved = true
      placeBar({ left: ev.clientX - dx, top: ev.clientY - dy })
    }
    const up = () => {
      brand.removeEventListener('pointermove', move)
      brand.removeEventListener('pointerup', up)
      if (moved) local.set({ left: parseFloat(ui.bar.style.left), top: parseFloat(ui.bar.style.top) })
      else setCollapsed(!state.collapsed)
    }
    brand.addEventListener('pointermove', move)
    brand.addEventListener('pointerup', up)
  })
  brand.addEventListener('dblclick', () => {
    local.set(null)
    placeBar(null)
    setCollapsed(false)
  })

  /** Open a panel next to the bar, on whichever side of it has room. */
  function placeNearBar(panel) {
    const r = ui.bar.getBoundingClientRect()
    const below = r.top < innerHeight / 2
    panel.style.transform = 'none'
    const w = panel.offsetWidth || 380
    panel.style.left = `${Math.max(10, Math.min(innerWidth - w - 10, r.left + r.width / 2 - w / 2))}px`
    if (below) {
      panel.style.top = `${r.bottom + 8}px`
      panel.style.bottom = 'auto'
    } else {
      panel.style.bottom = `${innerHeight - r.top + 8}px`
      panel.style.top = 'auto'
    }
  }

  function toggleHelp() {
    const open = ui.help.style.display !== 'block'
    ui.help.style.display = open ? 'block' : 'none'
    if (open) placeNearBar(ui.help)
  }

  ui.help.innerHTML = `<table>
    <tr><td>Click</td><td>Select (click again to go deeper)</td></tr>
    <tr><td>Click, then drag</td><td>Move: only what is already selected moves, so exploring never shifts anything</td></tr>
    <tr><td>Drag on the page</td><td>Draw a box: everything inside it is selected, drawings on a canvas too, to move, resize, align and space out together</td></tr>
    <tr><td>Tap, with several selected</td><td>Each has a tick. Tap one to take it out, another to add it; <kbd>Esc</kbd> or Unselect all starts again</td></tr>
    <tr><td>Tap words, then again</td><td>Selects the heading, paragraph or key they are in; the second tap types there</td></tr>
    <tr><td><kbd>T</kbd></td><td>Add text after the selection, styled like it</td></tr>
    <tr><td><kbd>Ctrl</kbd> <kbd>C</kbd> <kbd>X</kbd> <kbd>V</kbd> <kbd>D</kbd></td><td>Copy, cut, paste after the selection, duplicate</td></tr>
    <tr><td><kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>C</kbd> / <kbd>V</kbd></td><td>Copy a style, paste it</td></tr>
    <tr><td><kbd>Shift</kbd> + click</td><td>Add to the selection, or take out of it</td></tr>
    <tr><td><kbd>Ctrl</kbd> <kbd>A</kbd></td><td>Everything beside what is selected</td></tr>
    <tr><td><kbd>Ctrl</kbd> + click</td><td>Select exactly what is under the pointer</td></tr>
    <tr><td><kbd>Alt</kbd> + click</td><td>Select what is underneath</td></tr>
    <tr><td>Double-click</td><td>Edit text</td></tr>
    <tr><td>Drag the selection</td><td>Move it. Corners resize, the dot above rotates; a group's corners resize every member and the space between them</td></tr>
    <tr><td>Pink guides</td><td>Edges and centres catch on what is around them, and the middle between two neighbours. Hold <kbd>Ctrl</kbd> to place freely; the magnet switches it off</td></tr>
    <tr><td><kbd>Shift</kbd> while dragging</td><td>Straight lines, 15 degree turns, sizes in steps of 5%</td></tr>
    <tr><td><kbd>Esc</kbd> while dragging</td><td>Put it back where the drag began</td></tr>
    <tr><td>X Y W R</td><td>Exact moves, size and turn, typed in the inspector (arrow keys step)</td></tr>
    <tr><td><kbd>Shift</kbd> <kbd>Enter</kbd></td><td>Select what this sits in</td></tr>
    <tr><td><kbd>Tab</kbd></td><td>Select the next thing beside it (<kbd>Shift</kbd>: previous)</td></tr>
    <tr><td>Arrows</td><td>Nudge (with <kbd>Shift</kbd>: 10 px)</td></tr>
    <tr><td><kbd>Shift</kbd> <kbd>H</kbd> / <kbd>V</kbd></td><td>Flip horizontally / vertically</td></tr>
    <tr><td><kbd>Delete</kbd></td><td>Delete</td></tr>
    <tr><td><kbd>Ctrl</kbd> <kbd>Z</kbd> / <kbd>Shift</kbd> <kbd>Z</kbd></td><td>Undo / redo, saves included</td></tr>
    <tr><td><kbd>I</kbd></td><td>Pick a colour off the page: the loupe reads it, a click keeps it and finds where it is written (C copies it)</td></tr>
    <tr><td>Properties</td><td>Size, spacing, type, fill, border: changed on this element, or on the rule that styles it ("rule")</td></tr>
    <tr><td>Source</td><td>Where the element, its words, its styles and what moves it are written; every line opens in your editor</td></tr>
    <tr><td><kbd>Ctrl</kbd> <kbd>S</kbd></td><td>Save to source</td></tr>
    <tr><td><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>E</kbd></td><td>Switch edit / view</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>Deselect</td></tr>
    <tr><td>Go to a page</td><td>The page box on this bar lists every page the site links to. In Edit mode a link selects instead of opening: use the link button by the selection, or View mode</td></tr>
    <tr><td>This bar</td><td>Drag it by its name to move it; double-click the name to dock it again</td></tr>
  </table>`

  function renderBar() {
    editBtn.classList.toggle('on', state.mode === 'edit')
    viewBtn.classList.toggle('on', state.mode === 'view')
    ui.root.classList.toggle('collapsed', state.collapsed)
    ui.root.classList.toggle('view', state.mode === 'view')
    undoBtn.disabled = !history.canUndo()
    redoBtn.disabled = !history.canRedo()
    const u = history.peekUndo()
    const r = history.peekRedo()
    undoBtn.title = u ? `Undo ${u.label} (Ctrl+Z)` : 'Undo (Ctrl+Z)'
    redoBtn.title = r ? `Redo ${r.label} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)'
    freezeBtn.classList.toggle('on', !!boot.isFrozen?.())
    snapBtn.classList.toggle('on', state.snap)
    pickBtn.classList.toggle('on', !!picker?.active)
    emit()
    const n = pending().length
    pendingBtn.classList.toggle('has', n > 0)
    pendingBtn.innerHTML = n ? `<span class="badge">${n}</span><span>unsaved</span>` : '<span>No changes</span>'
    saveBtn.disabled = n === 0 || state.saving
    const c = state.check
    checkBtn.style.display = state.config.check ? '' : 'none'
    checkBtn.className = `check ${c?.status ?? ''}`
    checkBtn.innerHTML = `<i></i><span>${state.config.check?.label ?? 'check'}${c?.status ? ` ${c.status}` : ''}</span>`
  }

  function toggleMenu(which) {
    const m = ui.menu
    if (m.style.display === 'block' && m.dataset.which === which) {
      m.style.display = 'none'
      return
    }
    m.dataset.which = which
    m.replaceChildren()
    if (which === 'pending') {
      const list = pending()
      if (!list.length) m.append(h('div', { class: 'empty', text: 'No unsaved edits. Select something on the page to start.' }))
      if (list.length) m.append(h('h6', { text: 'Unsaved - click one to find it' }))
      for (const op of list) {
        m.append(
          h(
            'button',
            {
              class: 'page',
              onclick: () => {
                m.style.display = 'none'
                const el = op._el
                if (el?.isConnected && op.kind !== 'delete') {
                  el.scrollIntoView({ block: 'center', inline: 'nearest' })
                  selectElement(el)
                } else toast(op.kind === 'delete' ? 'That element is deleted until you save or undo.' : 'That element is not on this page any more.', 'info', 2600)
              },
            },
            h('span', { text: describeOp(op) }),
          ),
        )
      }
    } else {
      const c = state.check
      m.append(h('div', { class: 'item' }, h('b', { text: `${state.config.check?.label}: ${c?.status ?? 'not run yet'}` }), c?.ms ? h('span', { class: 'muted', text: `${(c.ms / 1000).toFixed(1)} s` }) : null))
      if (c?.output) m.append(h('pre', { text: c.output }))
    }
    m.style.display = 'block'
    placeNearBar(m)
  }

  /* ================================================================ */
  /*  navigation                                                       */
  /* ================================================================ */

  /**
   * GO TO A PAGE THE WAY A PERSON WOULD: by clicking a link to it.
   *
   * Edit mode stops every click from reaching the page - that is what lets
   * a link be selected rather than followed - so navigating has to be asked
   * for. It is done with a real link click, let through on purpose, so the
   * site's own router handles it exactly as it would a visitor's: a
   * client-side route change where the site has a router, an ordinary page
   * load where it does not. Unsaved edits are not silently left behind.
   */
  async function go(href, anchor = null) {
    let url
    try {
      url = new URL(anchor?.href ?? href, location.href)
    } catch {
      return toast('That is not an address.', 'warn', 2500)
    }
    // another site opens beside the editor, never in place of it
    if (url.origin !== location.origin) {
      window.open(url.href, '_blank', 'noopener')
      return
    }
    if (!(await readyToLeave())) return
    deselect()
    ui.menu.style.display = 'none'
    const a = anchor ?? document.createElement('a')
    const temp = !anchor
    if (temp) {
      a.href = href
      a.style.display = 'none'
      document.body.append(a)
    }
    state.passClicks = true
    try {
      a.click()
    } finally {
      state.passClicks = false
      if (temp) a.remove()
    }
    setTimeout(syncPath, 50)
  }

  async function goHistory(step) {
    if (!(await readyToLeave())) return
    deselect()
    history_go(step)
  }
  const history_go = (step) => window.history.go(step)

  /** With unsaved edits on this page, ask before leaving it. */
  async function readyToLeave() {
    if (state.editing) state.editing.commit()
    if (color.isOpen) color.apply()
    const n = pending().length
    if (!n) return true
    const choice = await ui.ask({
      title: `${n} unsaved edit${n === 1 ? '' : 's'} on this page`,
      text: 'Save them before you go, or discard them? They are not kept when the page changes.',
      cancel: 'Stay',
      buttons: [
        { label: 'Discard', value: 'discard', danger: true },
        { label: 'Save and go', value: 'save', primary: true },
      ],
    })
    if (choice === 'save') {
      await save()
      return pending().length === 0
    }
    if (choice === 'discard') {
      await discardUnsaved()
      return true
    }
    return false
  }

  /** Undo every unsaved edit, so the page is as its source says, and forget them. */
  async function discardUnsaved() {
    for (let e = history.peekUndo(); e && !e.saved; e = history.peekUndo()) {
      if (!(await history.undo())) break
    }
    history.clearRedo()
    recs.clear()
    blocks.clear()
    declEdits.clear()
    recolors.clear()
    renderBar()
  }

  /** The link a selection is, or is inside: what "Open link" follows. */
  const linkOf = (el) => {
    const a = el?.closest?.('a[href]')
    if (!a) return null
    const raw = a.getAttribute('href')
    return raw && !raw.startsWith('javascript:') ? a : null
  }

  /* ================================================================ */
  /*  modes                                                            */
  /* ================================================================ */

  function setMode(mode) {
    if (state.editing) state.editing.commit()
    if (color.isOpen) color.apply()
    state.mode = mode
    store.set('mode', mode)
    if (mode === 'view') deselect()
    document.documentElement.toggleAttribute('data-retouch-edit', mode === 'edit')
    ui.hover.style.display = 'none'
    renderBar()
  }
  function setCollapsed(v) {
    state.collapsed = v
    store.set('collapsed', v ? '1' : '0')
    renderBar()
  }
  function setFrozen(on) {
    boot.freeze?.(on)
    store.set('frozen', on ? '1' : '0')
    renderBar()
  }
  function setSnap(on) {
    state.snap = on
    try {
      localStorage.setItem('retouch:snap', on ? '1' : '0')
    } catch {}
    toast(on ? 'Snapping on: edges and centres catch within a few pixels.' : 'Snapping off: things go exactly where you put them.', 'info', 2200)
    if (on) scheduleHints()
    else guides.clear()
    renderBar()
  }

  /* ================================================================ */
  /*  hit testing and selection                                        */
  /* ================================================================ */

  const lockedSel = () => (state.config.locked ?? []).join(',')
  const isLocked = (el) => {
    const s = lockedSel()
    try {
      return !!(s && el.closest?.(s))
    } catch {
      return false
    }
  }

  /** Hit-test the page with the editor's own surfaces taken out of the way. */
  function passThrough(fn) {
    ui.host.style.visibility = 'hidden'
    try {
      return fn()
    } finally {
      ui.host.style.visibility = ''
    }
  }
  const pageStack = (x, y) => withCanvases(passThrough(() => document.elementsFromPoint(x, y)).filter((e) => e !== ui.host && e !== document.documentElement && e !== document.body), x, y)

  /**
   * The browser's hit test leaves out anything with pointer-events: none,
   * which is exactly how a page lays a drawing surface over itself. Canvases
   * under the point are put back where they paint: above their own
   * ancestors and above whatever comes before them in the document.
   */
  function withCanvases(stack, x, y) {
    const extra = [...document.getElementsByTagName('canvas')].filter((c) => {
      if (stack.includes(c) || ui.host.contains(c) || !c.width || !c.height) return false
      const r = c.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false
      const cs = getComputedStyle(c)
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.02
    })
    if (!extra.length) return stack
    // later in the document paints later: the last canvas is the top one
    extra.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1))
    // the z-index that decides where something paints: its nearest positioned ancestor's that sets one
    const zOf = (el) => {
      for (let p = el; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.position !== 'static' && cs.zIndex !== 'auto') return Number(cs.zIndex) || 0
      }
      return 0
    }
    const out = []
    const left = new Set(extra)
    for (const el of stack) {
      for (const c of [...left]) {
        const zc = zOf(c)
        const ze = zOf(el)
        if (el.contains(c) || zc > ze || (zc === ze && el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          out.push(c)
          left.delete(c)
        }
      }
      out.push(el)
    }
    out.push(...left)
    return out
  }

  /**
   * Does this element draw anything at (x, y)? A layout box laid over
   * artwork - a full-height text column above a scene - is the top of the
   * hit-test stack everywhere it spans, but where it has no background and
   * no text of its own, a person clicking there means what they can SEE,
   * which is underneath.
   */
  const REPLACED = /^(IMG|VIDEO|CANVAS|IFRAME|INPUT|TEXTAREA|SELECT|BUTTON|OBJECT|EMBED|PICTURE)$/
  function drawsAt(el, x, y) {
    if (el instanceof SVGElement) return el.tagName.toLowerCase() !== 'svg' && el.tagName.toLowerCase() !== 'g'
    if (REPLACED.test(el.tagName)) return true
    const cs = getComputedStyle(el)
    const bg = parseColor(cs.backgroundColor)
    if ((bg && bg.a > 0.02) || cs.backgroundImage !== 'none' || (cs.backdropFilter && cs.backdropFilter !== 'none')) return true
    if (['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some((k) => parseFloat(cs[k]) > 0)) return true
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.data.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      for (const r of range.getClientRects()) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true
    }
    return false
  }
  const visibleHit = (stack, x, y) => stack.find((el) => drawsAt(el, x, y)) ?? stack[0]

  async function inspect(chain) {
    const want = []
    for (const u of chain) for (const s of u.stamps) if (!infoCache.has(s)) want.push({ stamp: s, svg: u.svg })
    if (want.length) {
      const { items } = await api.post('/inspect', { items: want })
      for (const [k, v] of Object.entries(items)) infoCache.set(k, v)
    }
    const out = {}
    for (const u of chain) for (const s of u.stamps) out[s] = infoCache.get(s)
    return out
  }

  /* ---- elements React never rendered: markup set as a string, nodes a script made ---- */

  const sigOf = (e) => `${e.tagName.toLowerCase()}#${e.id || ''}.${[...(e.classList ?? [])].sort().join('.')}`
  const labelOf = (e) => {
    if (!e?.tagName) return 'page'
    const tag = e.tagName.toLowerCase()
    const cls = e.classList?.[0]
    return e.id ? `${tag}#${e.id}` : cls ? `${tag}.${cls}` : tag
  }

  /** The elements between `hit` and the nearest element React rendered, innermost first. */
  function foreignPath(hit) {
    const out = []
    for (let n = hit; n && n.nodeType === 1 && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (fiberOf(n)) break
      if (!isLocked(n)) out.push(n)
      if (out.length >= 10) break
    }
    return out
  }

  /** What the page can tell the server about an element, to find it in an HTML file. */
  function locatorOf(e, scope) {
    const ancestors = []
    for (let p = e.parentElement; p && ancestors.length < 3; p = p.parentElement) ancestors.push(sigOf(p))
    const sig = sigOf(e)
    const alike = [...(scope ?? document.body).querySelectorAll(e.tagName)].filter((x) => sigOf(x) === sig)
    return { tag: e.tagName.toLowerCase(), id: e.id || '', classes: [...e.classList], text: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160), ancestors, nth: alike.indexOf(e) }
  }

  let noneSeq = 0
  /** Units for foreign elements: found in an HTML file they are edited there; not found they can be looked at and traced, not saved. */
  async function foreignUnits(path) {
    if (!path.length) return []
    const want = path.filter((e) => !htmlStamps.has(e))
    if (want.length) {
      const scope = path[path.length - 1].parentElement ?? document.body
      try {
        const { items } = await api.post('/html/locate', { items: want.map((e, k) => ({ key: String(k), ...locatorOf(e, scope) })) })
        want.forEach((e, k) => htmlStamps.set(e, items[String(k)]?.found ? items[String(k)].stamp : null))
      } catch {
        want.forEach((e) => htmlStamps.set(e, null))
      }
    }
    return path.map((e) => {
      let stamp = htmlStamps.get(e)
      if (!stamp) {
        stamp = e.__retouchNone ??= `none:${++noneSeq}`
        if (!infoCache.has(stamp)) {
          infoCache.set(stamp, {
            stamp,
            base: stamp,
            readonly: true,
            why: 'Made by a script while the page runs: it is not written in any file Retouch reads.',
            file: null,
            name: e.tagName.toLowerCase(),
            strategies: { transform: { kind: 'none' }, delete: { kind: 'none' }, color: { kind: 'none' } },
          })
        }
      }
      return { el: e, stamps: [stamp], names: [labelOf(e)], label: labelOf(e), tag: e.tagName.toLowerCase(), svg: isSvgChild(e), propsByStamp: {}, dangerous: false, foreign: true }
    })
  }

  /** Every unit an element belongs to, innermost first, with their info: React's, then what came from a string or a script. */
  async function chainFor(hit) {
    const chain = [...(await foreignUnits(foreignPath(hit))), ...unitChain(hit, isLocked)]
    const info = chain.length ? await inspect(chain) : {}
    return { chain, info, counts: countStamps(hit) }
  }

  const independent = (info, n) => info && !info.error && !info.readonly && (n <= 1 || info.strategies.transform.entry || info.strategies.delete.entry)

  /** The first unit, innermost out, that can be edited on its own; outermost stamp first within a unit. */
  function choose(chain, info, counts, from = 0, to = chain.length) {
    for (let k = from; k < to; k++) {
      const u = chain[k]
      for (let i = u.stamps.length - 1; i >= 0; i--) {
        const s = u.stamps[i]
        if (independent(info[s], counts.get(baseOf(s)) ?? 1)) return { unit: u, stamp: s, index: k }
      }
    }
    return null
  }

  async function selectAt(x, y, { deep = false, under = false, deeper = false, add = false } = {}) {
    const stack = pageStack(x, y)
    if (!stack.length) return add ? null : deselect()
    let hit = visibleHit(stack, x, y)
    // WORDS FIRST: visible text under the point is what a tap there means, even where the page
    // let the hit test pass through it (pointer-events: none) or laid a canvas over it
    const words = !under && !deep ? textAt(x, y) : null
    // the block the words are in: a heading set as one span per line is still one heading
    const block = words ? textBlockOf(words.node) ?? words.el : null
    const onWords = words && textShows(words, stack) && (!deeper || (state.sel && state.sel.el !== block && state.sel.el.contains(block)))
    if (onWords) hit = block
    // a drawing on a canvas, seen through the parts of canvases that are clear
    else if (!under && !deeper && stack.some((e) => e.tagName === 'CANVAS')) {
      let r = await resolveHit(stack, x, y)
      if (r.drawings && add && (state.sel || state.group)) {
        // with the others: held still first, so the one taken is the one shown
        if (await holdStill('Froze the page so the drawings hold still. Play it again from the timeline.')) r = await resolveHit(pageStack(x, y), x, y)
        if (r.drawings) return toggleMember(drawingMember(r.drawings[0]))
      }
      if (r.drawings) {
        const again = state.sel?.canvas && r.drawings.find((d) => findAgain(state.sel.canvas.item, [d]) && d.bbox.x === state.sel.canvas.item.bbox.x && d.bbox.y === state.sel.canvas.item.bbox.y)
        // clicking the selected drawing again steps out to its canvas, the way a click goes deeper elsewhere
        if (!again) return selectCanvasItem(r.drawings[0])
        hit = again.canvas
      } else hit = r.el ?? hit
    }
    if (under && state.lastClick && Math.hypot(state.lastClick.x - x, state.lastClick.y - y) < 4) {
      // the next distinct thing down: the parts of what is selected are the same thing
      let d = state.lastClick.depth
      for (let tries = 0; tries < stack.length; tries++) {
        d = (d + 1) % stack.length
        if (!state.sel || (!state.sel.el.contains(stack[d]) && !stack[d].contains(state.sel.el))) break
      }
      state.lastClick.depth = d
      hit = stack[d]
    } else state.lastClick = { x, y, depth: stack.indexOf(hit) }
    let chain, info, counts
    try {
      ;({ chain, info, counts } = await chainFor(hit))
    } catch (e) {
      toast(e.message, 'err')
      return
    }
    if (!chain.length) {
      // a tap that finds nothing never drops what several taps built up
      if (!add || !state.group) deselect()
      toast('Nothing here comes from the project source - it may be generated by a library.', 'warn')
      return
    }
    let pick
    if (deep) pick = { unit: chain[0], stamp: chain[0].stamps[0], index: 0 }
    else if (deeper && state.sel) {
      const at = chain.findIndex((u) => u.el === state.sel.el)
      pick = at > 0 ? [...Array(at).keys()].reverse().map((k) => choose(chain, info, counts, k, k + 1)).find(Boolean) ?? null : null
      if (!pick) return
    } else pick = choose(chain, info, counts) ?? { unit: chain[0], stamp: chain[0].stamps[chain[0].stamps.length - 1], index: 0 }
    // Shift+click, or any tap while several are selected: add it, or take out what it is part of
    if (add && (state.sel || state.group)) return toggleMember(memberOf(pick.unit, pick.stamp, { chain, info, counts, hit }))
    select(pick.unit, pick.stamp, { chain, info, counts, hit })
  }

  function select(unit, stamp, ctx) {
    if (color.isOpen) color.apply()
    const rec = unit.canvasItem ? null : recs.get(unit.el)
    if (rec) stamp = rec.target // an element already edited keeps the target its edits are for
    const info = ctx.info[stamp] ?? infoCache.get(stamp)
    if (!info || info.error) {
      toast(info?.error ?? 'That element cannot be edited.', 'warn')
      return
    }
    const count = unit.foreign ? 1 : ctx.counts.get(baseOf(stamp)) ?? 1
    const props = unit.propsByStamp?.[stamp] ?? null
    unshowState()
    clearTone()
    state.group = null
    ui.members.replaceChildren()
    state.sel = { unit, el: unit.el, stamp, info, chain: ctx.chain, chainInfo: ctx.info, counts: ctx.counts, count, props, hit: ctx.hit ?? unit.el, peers: count > 1 ? peersOf(unit.el, stamp).filter((e) => e !== unit.el) : [] }
    renderSelection()
    renderInspector()
    loop()
    scheduleHints()
  }

  function deselect() {
    if (color.isOpen) color.apply()
    unshowState()
    clearTone()
    state.sel = null
    state.group = null
    ui.members.replaceChildren()
    ui.sel.style.display = 'none'
    ui.peers.replaceChildren()
    clearHints()
    renderInspector()
  }

  /**
   * Select an element as a click on it would, by its own box rather than a
   * point. `exact` takes the element itself even when it cannot be edited
   * on its own (the layers list and the colour picker mean that one).
   */
  async function selectElement(el, { exact = false, scroll = true } = {}) {
    let chain, info, counts
    try {
      ;({ chain, info, counts } = await chainFor(el))
    } catch (e) {
      return toast(e.message, 'err')
    }
    if (!chain.length) return toast('Nothing here comes from the project source - it may be generated by a library.', 'warn')
    const own = chain[0].el === el ? chain[0] : null
    const pick =
      exact && own
        ? { unit: own, stamp: own.stamps[own.stamps.length - 1] }
        : choose(chain, info, counts, 0, 1) ?? choose(chain, info, counts) ?? { unit: chain[0], stamp: chain[0].stamps[chain[0].stamps.length - 1] }
    select(pick.unit, pick.stamp, { chain, info, counts, hit: el })
    const r = el.getBoundingClientRect()
    if (scroll && (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth)) el.scrollIntoView({ block: 'center', inline: 'nearest' })
  }

  /** Shift+Enter: the thing this selection sits in. */
  function selectParent() {
    const sel = state.sel
    if (!sel) return
    const at = sel.chain.findIndex((u) => u.el === sel.el)
    for (let k = at + 1; k < sel.chain.length; k++) {
      const p = choose(sel.chain, sel.chainInfo, sel.counts, k, k + 1)
      if (p) return select(p.unit, p.stamp, { chain: sel.chain, info: sel.chainInfo, counts: sel.counts })
    }
    toast('Nothing editable contains this.', 'info', 1800)
  }

  /**
   * Tab: the next thing beside this selection. Wrappers that hold one child
   * each are climbed first, so the next grass blade is found beside this
   * blade's group rather than nowhere, then the same number of single-child
   * levels are walked back down inside the sibling.
   */
  function selectSibling(step) {
    const sel = state.sel
    if (!sel) return
    let el = sel.el
    let up = 0
    const usable = (c) => !ui.host.contains(c) && unitFor(c).stamps.length > 0 && c.getBoundingClientRect().width > 0
    let kids = []
    for (; up < 6 && el.parentElement; up++) {
      kids = [...el.parentElement.children].filter(usable)
      if (kids.length > 1) break
      el = el.parentElement
    }
    if (kids.length < 2) return toast('There is nothing beside this to step to.', 'info', 1800)
    let next = kids[(kids.indexOf(el) + step + kids.length) % kids.length]
    for (let k = 0; k < up && next.children.length === 1; k++) next = next.firstElementChild
    selectElement(next)
  }

  /** What each tool will do to the current selection, and whether it reaches every instance. */
  function reach(sel = state.sel) {
    const st = sel.info.strategies
    const many = sel.count > 1
    const t = st.transform
    return {
      move: !many || (t.kind === 'adapter' && t.entry),
      turn: !many,
      shared: many,
      deleteEntry: st.delete.kind === 'entry',
    }
  }

  /* ================================================================ */
  /*  edit records                                                     */
  /* ================================================================ */

  function recFor(sel = state.sel) {
    let rec = recs.get(sel.el)
    if (!rec) {
      rec = {
        el: sel.el,
        target: sel.stamp,
        info: sel.info,
        svg: sel.unit.svg,
        props: sel.props,
        unitLabel: sel.unit.names[sel.unit.stamps.indexOf(sel.stamp)] ?? sel.unit.label,
        base: G.readBase(sel.el),
        frame: null,
        c0: null,
        N: G.I(),
        shared: false,
        peers: [],
        deleted: false,
        colors: {},
        styles: {},
        // an element from an HTML string keeps its preview after saving; this is what undoing the save puts back
        styleAttr0: sel.el.getAttribute('style'),
      }
      recs.set(sel.el, rec)
    }
    return rec
  }

  const targetsOf = (rec) => [rec.el, ...(rec.shared ? rec.peers : [])]

  function paintRec(rec) {
    if (!rec.frame) return
    G.paint(rec.el, rec)
    for (const p of rec.shared ? rec.peers : []) {
      p.style.translate = rec.el.style.translate
      p.style.rotate = rec.el.style.rotate
      p.style.scale = rec.el.style.scale
    }
    position()
  }

  function ensureFrame(rec) {
    const fr = G.measure(rec.el, rec.svg)
    if (!fr) return false
    rec.frame = fr
    if (!rec.c0) {
      const r = rec.el.getBoundingClientRect()
      rec.c0 = G.toFrame(fr, { x: r.left + r.width / 2, y: r.top + r.height / 2 })
    }
    return true
  }

  /** Make a transform edit possible on the selection, asking first when it reaches every instance. */
  const READONLY_MSG = 'This element is made by a script while the page runs, so there is no line to save a change to. Select what it sits in (Shift+Enter), or change the rules that style it in Properties.'

  async function canTransform(kind) {
    const sel = state.sel
    if (!sel) return null
    if (sel.info.readonly) {
      toast(READONLY_MSG, 'warn', 6500)
      return null
    }
    const r = reach(sel)
    const rec = recFor(sel)
    if (kind === 'move' ? !r.move : !r.turn) {
      if (sel.count > 1 && sel.info.strategies.transform.kind === 'adapter' && sel.info.strategies.transform.entry) {
        toast(`Only moving and resizing can be saved for one of these ${sel.count}: they are written as a list. Ctrl+click to edit the shared line instead.`, 'warn', 6500)
        return null
      }
      if (!rec.shared) {
        const ok = await ui.ask({ title: `This changes all ${sel.count}`, text: `These ${sel.count} come from one line of code, so the edit is saved to all of them. Continue?`, ok: `Edit all ${sel.count}` })
        if (!ok) return null
        rec.shared = true
        rec.peers = sel.peers
      }
    }
    if (!ensureFrame(rec)) {
      toast('This element cannot be transformed - it is inline text or not drawn. Select its container instead.', 'warn')
      return null
    }
    return rec
  }

  const transformEntry = (rec, before, after, label) => ({
    kind: 'transform',
    label,
    undo: () => {
      rec.N = before
      paintRec(rec)
    },
    redo: () => {
      rec.N = after
      paintRec(rec)
    },
  })

  /* ================================================================ */
  /*  gestures                                                         */
  /* ================================================================ */

  const centreOnScreen = (rec, N = rec.N) => G.toScreen(rec.frame, G.apply(N, rec.c0))
  const flipSign = (rec) => (rec.frame.svg ? Math.sign(rec.frame.P[0] * rec.frame.P[3] - rec.frame.P[1] * rec.frame.P[2]) : Math.sign(rec.frame.A[0] * rec.frame.A[3] - rec.frame.A[1] * rec.frame.A[2])) || 1

  function readout(text, x, y) {
    ui.readout.textContent = text
    ui.readout.style.display = text ? 'block' : 'none'
    ui.readout.style.left = `${x + 14}px`
    ui.readout.style.top = `${y + 14}px`
  }

  /* ---- smart guides on a still selection ---- */
  let hintTimer = null
  /**
   * Faint lines along whatever the selection already lines up with. Boxes
   * are taken now and checked again when drawn, so anything that moved in
   * between - an animation - is left out.
   */
  function scheduleHints(delay = 120) {
    clearTimeout(hintTimer)
    const sel = state.sel
    // guides are for placing things: nothing that cannot be moved gets them
    if (!sel || state.mode !== 'edit' || !state.snap || !sel.el.isConnected || sel.info.readonly) return guides.clear()
    const first = collectTargets(sel.el, { host: ui.host, isLocked })
    hintTimer = setTimeout(() => {
      if (state.sel !== sel || state.gesture || !sel.el.isConnected) return
      guides.draw(alignmentGuides(rectOf(sel.el), dropMoving(first.targets), { perAxis: 2 }), { faint: true })
    }, delay)
  }
  function clearHints() {
    clearTimeout(hintTimer)
    guides.clear()
  }
  const mods = (e) => ({ shift: e.shiftKey, free: e.ctrlKey || e.metaKey })

  /**
   * Start a drag on the current selection; returns {move, end, cancel}.
   * Moves and resizes snap to the guides unless snapping is off or Ctrl is
   * held; turns settle on right angles and diagonals; Shift constrains.
   */
  async function beginGesture(kind, start) {
    const rec = await canTransform(kind === 'rotate' ? 'turn' : 'move')
    if (!rec) return null
    const N0 = rec.N
    const c0s = centreOnScreen(rec)
    const cf = G.apply(N0, rec.c0)
    const a0 = Math.atan2(start.y - c0s.y, start.x - c0s.x)
    const d0 = Math.max(4, Math.hypot(start.x - c0s.x, start.y - c0s.y))
    const dec0 = G.decompose(N0)
    const theta0 = dec0.theta
    const k0 = Math.sqrt(Math.abs(dec0.sx * dec0.sy)) || 1
    const me0 = rectOf(rec.el)
    let targets = kind === 'rotate' ? [] : collectTargets(rec.el, { host: ui.host, isLocked }).targets
    let settled = false
    let changed = false
    let cancelled = false
    clearHints()
    state.gesture = kind
    const finish = () => {
      state.gesture = null
      state.activeGesture = null
      readout('')
      guides.clear()
      scheduleHints(60)
    }
    const g = {
      move(p, m = {}) {
        if (cancelled) return
        if (!settled) {
          // by the first move, anything animated has shown itself by moving
          targets = dropMoving(targets)
          settled = true
        }
        const off = !state.snap || m.free
        if (kind === 'move') {
          let dx = p.x - start.x
          let dy = p.y - start.y
          if (m.shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0)
          const s = snapMove(me0, { x: dx, y: dy }, targets, { off })
          // Shift keeps the drag on its axis even when a guide pulls the other way
          if (m.shift) dy === 0 ? (s.d.y = 0) : (s.d.x = 0)
          const d = G.vecToFrame(rec.frame, s.d)
          rec.N = G.mul(G.T(d.x, d.y), N0)
          guides.draw(s.guides)
          readout(`${G.num(d.x, 1)}, ${G.num(d.y, 1)}${s.snapped?.x || s.snapped?.y ? '  snapped' : ''}`, p.x, p.y)
        } else if (kind === 'rotate') {
          const dt = ((Math.atan2(p.y - c0s.y, p.x - c0s.x) - a0) * 180) / Math.PI
          let total = theta0 + dt
          let snapped = false
          if (m.shift) total = Math.round(total / 15) * 15
          else ({ theta: total, snapped } = snapAngle(total, { off }))
          rec.N = G.mul(G.about(cf, G.R((total - theta0) * flipSign(rec))), N0)
          readout(`${G.num(total, 1)} deg${snapped ? '  snapped' : ''}`, p.x, p.y)
        } else {
          let k = Math.max(0.05, Math.min(20, Math.hypot(p.x - c0s.x, p.y - c0s.y) / d0))
          let matched = null
          if (m.shift) k = Math.round(k * k0 * 20) / 20 / k0
          else {
            const s = snapScale(me0, k, targets, { off, original: 1 / k0 })
            k = s.k
            matched = s.matched
            guides.draw(s.guides)
          }
          rec.N = G.mul(G.about(cf, G.S(k)), N0)
          const total = Math.abs(G.decompose(rec.N).sx)
          readout(`${G.num(total * 100, 1)}%${matched === 'original' ? '  original size' : matched ? '  snapped' : ''}`, p.x, p.y)
        }
        changed = true
        paintRec(rec)
      },
      cancel() {
        if (cancelled) return
        cancelled = true
        rec.N = N0
        paintRec(rec)
        finish()
      },
      end() {
        if (cancelled) return
        finish()
        if (changed && !G.isIdentity(G.mul(rec.N, G.inv(N0) ?? G.I()))) {
          history.push(transformEntry(rec, N0, rec.N, `${kind} ${rec.unitLabel}`))
        }
        renderInspector()
      },
    }
    state.activeGesture = g
    return g
  }

  /**
   * Follow a press. The gesture is only started once the pointer has
   * actually moved, so a plain click never asks "edit all 14?" or measures
   * anything - it goes to `onClick` instead.
   */
  function trackPointer(startEvent, startGesture, onClick) {
    let gesture = null
    const start = { x: startEvent.clientX, y: startEvent.clientY }
    const move = (e) => {
      if (!gesture) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 3) return
        gesture = startGesture(start)
      }
      const m = mods(e)
      gesture.then((g) => g?.move({ x: e.clientX, y: e.clientY }, m))
    }
    const up = (e) => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      if (gesture) gesture.then((g) => g?.end())
      else if (e.type === 'pointerup') onClick?.(e)
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
  }

  // the selection box: drag to move, click to go deeper, double-click for text
  ui.sel.querySelector('.box').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.stopPropagation()
    // what is selected moves when dragged: the second press, after the click that selected it
    trackPointer(
      e,
      (p) => (state.group ? beginGroupGesture('move', p) : beginGesture('move', p)),
      (ev) => {
        const deep = ev.ctrlKey || ev.metaKey
        // a tap inside a group takes out what it lands on, or adds it when it is not in yet
        if (state.group) return selectAt(ev.clientX, ev.clientY, { deep, add: true })
        // a second tap on the words of selected text starts typing there, caret where it landed
        if (!deep && !ev.altKey && !ev.shiftKey && state.sel && !state.sel.canvas) {
          const w = textAt(ev.clientX, ev.clientY)
          const b = w && textBlockOf(w.node)
          if (b && (b === state.sel.el || b.contains(state.sel.el))) return editTextAt(ev.clientX, ev.clientY)
        }
        selectAt(ev.clientX, ev.clientY, { deep, under: ev.altKey, deeper: !deep && !ev.altKey && !ev.shiftKey, add: ev.shiftKey })
      },
    )
  })
  ui.sel.querySelector('.box').addEventListener('dblclick', (e) => !state.group && editTextAt(e.clientX, e.clientY))
  ui.sel.querySelector('.rot').addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    trackPointer(e, (p) => beginGesture('rotate', p))
  })
  for (const hd of ui.sel.querySelectorAll('.handle')) {
    hd.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      trackPointer(e, (p) => (state.group ? beginGroupGesture('scale', p) : beginGesture('scale', p, hd.dataset.corner)))
    })
  }

  async function nudge(dx, dy) {
    const rec = await canTransform('move')
    if (!rec) return
    const N0 = rec.N
    const d = G.vecToFrame(rec.frame, { x: dx, y: dy })
    rec.N = G.mul(G.T(d.x, d.y), N0)
    paintRec(rec)
    const after = rec.N
    const last = history.peekUndo()
    // a run of nudges is one edit, as in every editor
    if (last?.nudge === rec && Date.now() - last.at < 1200) {
      last.redo = () => {
        rec.N = after
        paintRec(rec)
      }
      last.at = Date.now()
    } else history.push({ ...transformEntry(rec, N0, after, `nudge ${rec.unitLabel}`), nudge: rec, at: Date.now() })
    renderBar()
    renderInspector()
    scheduleHints(200)
  }

  async function flip(axis) {
    const rec = await canTransform('turn')
    if (!rec) return
    const N0 = rec.N
    const cf = G.apply(N0, rec.c0)
    rec.N = G.mul(G.about(cf, axis === 'h' ? G.S(-1, 1) : G.S(1, -1)), N0)
    paintRec(rec)
    history.push(transformEntry(rec, N0, rec.N, `flip ${rec.unitLabel}`))
    renderInspector()
    scheduleHints()
  }

  /* ================================================================ */
  /*  delete                                                           */
  /* ================================================================ */

  async function remove() {
    const sel = state.sel
    if (!sel) return
    if (sel.info.readonly) return toast(READONLY_MSG, 'warn', 6500)
    const r = reach(sel)
    const instance = r.deleteEntry
    const shared = sel.count > 1 && !instance
    if (shared) {
      const ok = await ui.ask({ title: `Delete all ${sel.count}?`, text: `These ${sel.count} are written once and drawn ${sel.count} times, so deleting one deletes the line that draws them all.`, ok: `Delete all ${sel.count}`, danger: true })
      if (!ok) return
    }
    const rec = recFor(sel)
    rec.deleteMode = instance ? 'entry' : 'element'
    const els = [rec.el, ...(shared ? sel.peers : [])]
    const prev = els.map((el) => [el, el.style.getPropertyValue('display'), el.style.getPropertyPriority('display')])
    const hide = () => {
      rec.deleted = true
      for (const el of els) el.style.setProperty('display', 'none', 'important')
    }
    const show = () => {
      rec.deleted = false
      for (const [el, v, p] of prev) el.style.setProperty('display', v, p)
    }
    rec.hidden = { els, prev }
    hide()
    history.push({ kind: 'delete', label: `delete ${rec.unitLabel}`, undo: show, redo: hide })
    deselect()
    renderBar()
  }

  /* ================================================================ */
  /*  colour                                                           */
  /* ================================================================ */

  /** Colour on the selected element alone. `first` opens on that property's tab (a CSS property name). */
  function openColor(first = null, initialValue = null) {
    const sel = state.sel
    if (!sel) return
    if (sel.info.readonly) return toast(READONLY_MSG, 'warn', 6500)
    const el = sel.el
    const tag = el.tagName.toLowerCase()
    const svg = sel.unit.svg
    let tabs = svg
      ? ['image', 'use', 'g', 'foreignObject'].includes(tag)
        ? []
        : [
            { id: 'fill', label: 'Fill', css: 'fill', key: 'fill' },
            { id: 'stroke', label: 'Stroke', css: 'stroke', key: 'stroke' },
          ]
      : [
          { id: 'bg', label: 'Background', css: 'background-color', key: 'backgroundColor' },
          { id: 'text', label: 'Text', css: 'color', key: 'color' },
          { id: 'border', label: 'Border', css: 'border-color', key: 'borderColor' },
        ]
    if (!tabs.length) return toast('An image has no colour of its own to change. Select the shape or box behind it.', 'warn')
    const firstTab = first && tabs.find((t) => t.css === first || (first.startsWith('border') && t.id === 'border'))
    if (firstTab) tabs = [firstTab, ...tabs.filter((t) => t !== firstTab)]
    const many = sel.count > 1
    const go = async () => {
      if (many) {
        const rec0 = recs.get(el)
        if (!rec0?.shared) {
          const ok = await ui.ask({ title: `This changes all ${sel.count}`, text: `These ${sel.count} come from one line of code, so a colour set here is saved to all of them.`, ok: `Colour all ${sel.count}` })
          if (!ok) return
        }
      }
      const rec = recFor(sel)
      if (many) {
        rec.shared = true
        rec.peers = sel.peers
      }
      const cssOf = (tab) => {
        const t = tabs.find((x) => x.id === tab)
        if (t.id === 'bg' && /gradient\(/.test(getComputedStyle(el).backgroundImage)) return { ...t, css: 'background', key: 'background' }
        return t
      }
      const touched = new Map() // css prop -> inline value before this session
      const preview = (tab, value) => {
        const t = cssOf(tab)
        for (const x of targetsOf(rec)) {
          if (!touched.has(x)) touched.set(x, new Map())
          const m = touched.get(x)
          if (!m.has(t.css)) m.set(t.css, x.style.getPropertyValue(t.css))
          x.style.setProperty(t.css, value)
        }
      }
      const restoreTouched = () => {
        for (const [x, m] of touched) for (const [prop, v] of m) x.style.setProperty(prop, v)
        touched.clear()
      }
      color.open({
        rect: el.getBoundingClientRect(),
        avoid: ui.bar.getBoundingClientRect(),
        tabs,
        tokens: state.config.colors?.tokens !== false,
        tokensFirst: !!state.config.colors?.tokensFirst,
        initial: (tab) => {
          const t = cssOf(tab)
          const inline = el.style.getPropertyValue(t.css)
          const computed = getComputedStyle(el).getPropertyValue(t.css === 'border-color' ? 'border-top-color' : t.css)
          const start = tab === tabs[0].id && initialValue ? initialValue : null
          return { value: inline || computed, rgb: start ?? parseColor(computed) ?? { r: 255, g: 255, b: 255, a: 0 }, start: !!start }
        },
        preview,
        warnings: (value) => api.post('/color/check', { value }).then((r) => r.warnings),
        commit: (tab, value) => {
          const t = cssOf(tab)
          const before = rec.colors[t.key] ? { ...rec.colors[t.key] } : null
          const was = touched.get(el)?.get(t.css) ?? el.style.getPropertyValue(t.css)
          const attrMode = svg && t.key === 'fill' && sel.info.strategies.color.kind === 'attr'
          const after = { key: t.key, css: t.css, value, was: before?.was ?? was, mode: attrMode ? 'attr' : 'style', attr: attrMode ? 'fill' : null }
          rec.colors[t.key] = after
          const set = (c) => {
            for (const x of targetsOf(rec)) {
              if (c) x.style.setProperty(t.css, c.value)
              else x.style.setProperty(t.css, after.was)
            }
          }
          touched.clear()
          history.push({
            kind: 'color',
            label: `colour ${rec.unitLabel}`,
            undo: () => {
              if (before) rec.colors[t.key] = before
              else delete rec.colors[t.key]
              set(before)
            },
            redo: () => {
              rec.colors[t.key] = after
              set(after)
            },
          })
          renderBar()
        },
        cancel: restoreTouched,
      })
    }
    go()
  }

  /* ================================================================ */
  /*  styles: on this element, or on the rule that styles it           */
  /* ================================================================ */

  const camel = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  const COLORISH = /(^|-)(color|fill|stroke)$/

  /** Find the rules the server has not placed yet, in one request. */
  async function locateRules(matches) {
    const want = [...new Set(matches)].filter((m) => !located.has(m.rule))
    if (!want.length) return
    try {
      const { rules } = await api.post('/trace/rules', { rules: want.map((m, k) => ({ key: String(k), chain: m.chain, sheet: m.sheet, props: m.props })) })
      want.forEach((m, k) => located.set(m.rule, rules[String(k)] ?? null))
    } catch {
      want.forEach((m) => located.set(m.rule, null))
    }
  }

  /** How many elements on the page a rule reaches: what changing it costs. */
  function ruleReach(m) {
    try {
      const sel = m.chain.length > 1 ? m.chain.reduce((acc, s) => (s.includes('&') ? s.replace(/&/g, `:is(${acc})`) : `:is(${acc}) ${s}`)) : m.selector
      return document.querySelectorAll(sel).length
    } catch {
      return 0
    }
  }

  /** Where a declaration a rule makes is written, or null when it is not in a file Retouch can edit. */
  function declOf(m, prop) {
    const f = located.get(m.rule)?.found?.[0]
    const d = f?.decls?.[prop]
    if (!d) return null
    // !important stays: only the value is the edit
    const imp = /\s*!important\s*$/i.exec(d.value)
    const text = imp ? d.value.slice(0, imp.index) : d.value
    return { file: f.file, start: d.start, end: d.start + text.length, text, line: d.line, col: d.col }
  }

  const scopeOf = (prop) => scopes.get(state.sel?.el)?.get(prop) ?? 'element'
  function setScope(prop, scope) {
    const el = state.sel?.el
    if (!el) return
    if (!scopes.has(el)) scopes.set(el, new Map())
    scopes.get(el).set(prop, scope)
    renderInspector()
  }

  /** Everything the properties panel shows for these properties of the selection. */
  async function styleInfo(props) {
    const sel = state.sel
    if (!sel) return {}
    const el = sel.el
    const matched = matchedRules(el)
    const wins = props.map((p) => [p, winner(el, p, matched)])
    await locateRules(wins.filter(([, w]) => w.kind === 'rule').map(([, w]) => w.match))
    const cs = getComputedStyle(el)
    const rec = recs.get(el)
    const out = {}
    for (const [p, w] of wins) {
      const own = rec?.styles?.[p]
      const decl = w.kind === 'rule' ? declOf(w.match, w.declared) : null
      const pending = decl ? declEdits.get(`${decl.file}:${decl.start}`) : null
      const computed = cs.getPropertyValue(p).trim()
      const value = own?.value ?? (w.kind === 'inline' ? w.value : computed)
      const f = w.kind === 'rule' ? located.get(w.match.rule) : null
      out[p] = {
        value,
        computed,
        rgb: COLORISH.test(p) ? parseColor(value) ?? parseColor(computed) : null,
        winner: {
          kind: w.kind,
          inherited: !!w.inherited,
          edited: !!own || !!pending,
          selector: w.match?.selector ?? null,
          file: decl?.file ?? f?.found?.[0]?.file ?? null,
          line: decl?.line ?? f?.found?.[0]?.line ?? null,
          col: decl?.col ?? null,
          sheetGenerated: f?.sheetGenerated ?? null,
          ruleEditable: !!decl && w.declared === p && !w.inherited,
          count: w.kind === 'rule' ? ruleReach(w.match) : 0,
        },
      }
    }
    return out
  }

  /** Show a value without recording it: while a slider moves or arrows step. */
  function previewStyle(prop, value) {
    const sel = state.sel
    if (!sel) return
    if (scopeOf(prop) === 'rule') {
      const w = winner(sel.el, prop)
      if (w.kind === 'rule') w.match.rule.style.setProperty(prop, value, w.match.rule.style.getPropertyPriority(prop))
      return
    }
    if (sel.info.readonly) return
    sel.el.style.setProperty(prop, value)
  }

  async function setStyle(prop, value, scope = 'element') {
    const sel = state.sel
    if (!sel) return
    value = String(value ?? '').trim()
    if (value && typeof CSS !== 'undefined' && CSS.supports && !CSS.supports(prop, value)) {
      renderInspector()
      return toast(`"${value}" is not a value ${prop} accepts.`, 'warn', 4000)
    }
    if (scope === 'rule') return setRuleStyle(sel, prop, value)
    if (sel.info.readonly) {
      renderInspector()
      return toast(READONLY_MSG, 'warn', 6500)
    }
    if (sel.count > 1 && !recs.get(sel.el)?.shared) {
      const ok = await ui.ask({ title: `This changes all ${sel.count}`, text: `These ${sel.count} come from one line of code, so a style set here is saved to all of them.`, ok: `Change all ${sel.count}` })
      if (!ok) return renderInspector()
    }
    const rec = recFor(sel)
    if (sel.count > 1) {
      rec.shared = true
      rec.peers = sel.peers
    }
    rec.styles ??= {}
    const before = rec.styles[prop] ? { ...rec.styles[prop] } : null
    const was = before?.was ?? rec.el.style.getPropertyValue(prop)
    const after = { value, was }
    const set = (v) => {
      for (const x of targetsOf(rec)) {
        if (v && v.value !== '') x.style.setProperty(prop, v.value)
        else x.style.setProperty(prop, v ? '' : was)
      }
    }
    rec.styles[prop] = after
    set(after)
    history.push({
      kind: 'style',
      label: `${prop} on ${rec.unitLabel}`,
      undo: () => {
        if (before) rec.styles[prop] = before
        else delete rec.styles[prop]
        set(before ?? { value: was })
      },
      redo: () => {
        rec.styles[prop] = after
        set(after)
      },
    })
    renderBar()
    renderInspector()
    scheduleHints()
  }

  /** Several properties on the selection as ONE edit: a pasted style undoes in one step. */
  async function setStyles(props, label) {
    const sel = state.sel
    if (!sel) return
    if (sel.info.readonly) return toast(READONLY_MSG, 'warn', 6500)
    const list = Object.entries(props).filter(([p, v]) => !(typeof CSS !== 'undefined' && CSS.supports && v && !CSS.supports(p, v)))
    if (!list.length) return
    if (sel.count > 1 && !recs.get(sel.el)?.shared) {
      const ok = await ui.ask({ title: `This changes all ${sel.count}`, text: `These ${sel.count} come from one line of code, so a style set here is saved to all of them.`, ok: `Change all ${sel.count}` })
      if (!ok) return renderInspector()
    }
    const rec = recFor(sel)
    if (sel.count > 1) {
      rec.shared = true
      rec.peers = sel.peers
    }
    rec.styles ??= {}
    const before = Object.fromEntries(list.map(([p]) => [p, rec.styles[p] ? { ...rec.styles[p] } : null]))
    const was = Object.fromEntries(list.map(([p]) => [p, before[p]?.was ?? rec.el.style.getPropertyValue(p)]))
    const after = Object.fromEntries(list.map(([p, v]) => [p, { value: v, was: was[p] }]))
    const put = (vals) => {
      for (const [p] of list) {
        const v = vals[p]
        if (v) rec.styles[p] = v
        else delete rec.styles[p]
        for (const x of targetsOf(rec)) x.style.setProperty(p, v && v.value !== '' ? v.value : was[p])
      }
    }
    put(after)
    history.push({ kind: 'style', label: label ?? `${list.length} styles on ${rec.unitLabel}`, undo: () => put(before), redo: () => put(after) })
    renderBar()
    renderInspector()
    scheduleHints()
  }

  /** A change to the rule that styles the selection: every element it reaches changes with it. */
  async function setRuleStyle(sel, prop, value) {
    const w = winner(sel.el, prop)
    if (w.kind !== 'rule' || w.inherited) return toast('No rule sets this on the element; it can only be changed here.', 'warn', 4000)
    return setDeclOf(w.match, prop, value, sel.el)
  }

  /** Change one declaration of a rule where it is written: shown at once in the page's own sheet, saved with the rest. */
  async function setDeclOf(match, prop, value, el) {
    await locateRules([match])
    const decl = declOf(match, prop)
    if (!decl) return toast(`${match.selector} is not written in a file Retouch can edit.`, 'warn', 5000)
    if (!value) return toast('A rule needs a value; to remove it, open the file.', 'warn', 4000)
    const rule = match.rule
    const key = `${decl.file}:${decl.start}`
    const before = declEdits.get(key) ?? null
    const pri = rule.style.getPropertyPriority(prop)
    const was = before?.was ?? rule.style.getPropertyValue(prop)
    const after = { target: { file: decl.file, start: decl.start, end: decl.end, text: decl.text }, value, was, rule, prop, pri, label: `${prop} in ${match.selector}`, el }
    const apply = (e) => rule.style.setProperty(prop, e ? e.value : was, pri)
    declEdits.set(key, after)
    apply(after)
    history.push({
      kind: 'decl',
      label: after.label,
      undo: () => {
        if (before) declEdits.set(key, before)
        else declEdits.delete(key)
        apply(before)
      },
      redo: () => {
        declEdits.set(key, after)
        apply(after)
      },
    })
    renderBar()
    renderInspector()
  }

  /* ================================================================ */
  /*  colours where they are written                                   */
  /* ================================================================ */

  /** The page's own declarations a colour literal in a stylesheet feeds: what to change to show it before saving. */
  function cssomTargets(c) {
    const out = []
    if (c.where !== 'css' || !c.selector || !c.prop) return out
    const want = normSelector(c.selector)
    const visit = (rules) => {
      for (const r of rules) {
        if (r.selectorText && normSelector(r.selectorText) === want) {
          const v = r.style.getPropertyValue(c.prop)
          if (v && colorsIn(v).some((x) => colorDistance(x.rgb, c.rgb) < 0.01)) out.push({ rule: r, prop: c.prop, original: v, pri: r.style.getPropertyPriority(c.prop) })
        }
        if (r.cssRules) {
          try {
            visit(r.cssRules)
          } catch {}
        }
      }
    }
    for (const s of document.styleSheets) {
      try {
        visit(s.cssRules)
      } catch {}
    }
    return out
  }

  /** A declaration's value with one colour in it swapped for another. */
  function swapColor(value, from, to) {
    let out = value
    for (const x of colorsIn(value).reverse()) if (colorDistance(x.rgb, from) < 0.01) out = out.slice(0, x.start) + to + out.slice(x.end)
    return out
  }

  /** Fine-tune a colour where it is written: every use of that literal changes, on this page and in the file. */
  function recolor(c) {
    if (color.isOpen) color.apply()
    const targets = cssomTargets(c)
    const committed = () => recolors.get(c.id)
    const show = (value) => {
      for (const t of targets) t.rule.style.setProperty(t.prop, value == null ? t.original : swapColor(t.original, c.rgb, value), t.pri)
    }
    const where = `${c.file}:${c.line}`
    const name = c.key ?? (c.selector ? `${c.selector} ${c.prop}` : c.where === 'array' ? 'colour data' : 'colour')
    const anchor = state.sel?.el?.getBoundingClientRect() ?? { left: innerWidth / 2, right: innerWidth / 2, top: 80, bottom: 80, width: 0, height: 0 }
    color.open({
      rect: anchor,
      avoid: ui.bar.getBoundingClientRect(),
      tabs: [{ id: 'src', label: name, title: where }],
      header: h(
        'div',
        { class: 'small' },
        h('div', { class: 'mono', text: where }),
        h('div', {
          class: 'muted',
          text: targets.length
            ? 'Changes every use of this colour where it is written.'
            : c.where === 'css'
              ? 'This page does not load that stylesheet itself (a build step copies it), so the change shows after saving and reloading.'
              : 'Read by a script, so the change shows after saving and reloading.',
        }),
      ),
      tokens: c.where === 'css' && state.config.colors?.tokens !== false,
      tokensFirst: !!state.config.colors?.tokensFirst,
      initial: () => ({ value: committed()?.value ?? c.text, rgb: committed()?.rgb ?? c.rgb }),
      preview: (_, value) => show(value),
      warnings: (value) => api.post('/color/check', { value }).then((r) => r.warnings),
      commit: (_, value) => {
        const before = committed() ?? null
        const after = { cand: c, value, rgb: parseColor(value), previewed: targets.length > 0, label: `colour ${name}`, show }
        const apply = (e) => {
          if (e) recolors.set(c.id, e)
          else recolors.delete(c.id)
          show(e ? e.value : null)
        }
        apply(after)
        history.push({ kind: 'recolor', label: after.label, undo: () => apply(before), redo: () => apply(after) })
        if (!targets.length) toast('This colour cannot be shown before it is saved; after saving, reload to see it.', 'info', 4500)
        renderBar()
        renderInspector()
      },
      cancel: () => show(committed()?.value ?? null),
    })
  }

  /* ================================================================ */
  /*  the colour picker                                                */
  /* ================================================================ */

  let picker = null
  function togglePick() {
    if (!picker) return
    if (picker.active) return picker.stop()
    if (state.mode !== 'edit') setMode('edit')
    if (state.editing) state.editing.commit()
    if (color.isOpen) color.apply()
    picker.start()
    toast('Point at any colour on the page. Click to keep it; Esc to stop.', 'info', 3000)
    renderBar()
  }

  async function onPicked(s) {
    const hints = { vars: [], selectors: [] }
    if (s.el && s.el.nodeType === 1) {
      try {
        hints.vars = varsFor(s.el, s.rgb)
        const prop = s.prop ?? ''
        hints.selectors = matchedRules(s.el)
          .filter((m) => m.props.includes(prop) || (SHORTHAND[prop] && m.props.includes(SHORTHAND[prop])) || (prop.startsWith('border') && m.props.some((p) => p.startsWith('border'))))
          .map((m) => m.selector)
      } catch {}
    }
    const canElement = ['background', 'text', 'border', 'fill', 'stroke'].includes(s.source)
    state.picked = { ...s, candidates: null, canElement }
    // the element it came from is selected, so its styles are beside the colour
    if (s.el && s.el !== document.body && !ui.host.contains(s.el)) await selectElement(s.el, { exact: true, scroll: false })
    renderInspector()
    try {
      const { candidates } = await api.post('/color/find', { rgb: s.rgb, hints })
      if (state.picked?.rgb === s.rgb) state.picked.candidates = candidates
    } catch (e) {
      if (state.picked?.rgb === s.rgb) state.picked.candidates = []
      toast(e.message, 'err')
    }
    renderInspector()
  }

  /* ================================================================ */
  /*  trace and motion, for the properties panel                       */
  /* ================================================================ */

  /** The text block an element shows, if it shows one: itself, or the first one inside it. */
  function textBlockOf(el) {
    if (textNodes(el).length === 0) return null
    for (const n of el.childNodes) if (n.nodeType === 3 && n.data.trim()) return el
    const first = textNodes(el).find((n) => n.data.trim())
    return first ? blockFor(first) : null
  }

  async function traceData() {
    const sel = state.sel
    if (!sel) return null
    const cached = traceCache.get(sel.el)
    if (cached) return cached
    const job = (async () => {
      const i = sel.info
      const label = sel.unit.names[sel.unit.stamps.indexOf(sel.stamp)] ?? sel.unit.label
      const t = { element: { label, where: null, why: null, chain: [] }, words: null, rules: [] }
      if (i.readonly) t.element.why = i.why
      else t.element.where = { file: i.file, line: i.line, col: i.col }
      for (const u of sel.chain) {
        if (u.el === sel.el) continue
        const s = u.stamps[u.stamps.length - 1]
        const inf = sel.chainInfo[s] ?? infoCache.get(s)
        if (inf?.file && !inf.error) t.element.chain.push({ label: u.label, file: inf.file, line: inf.line, col: inf.col })
        if (t.element.chain.length >= 6) break
      }
      const block = textBlockOf(sel.el)
      if (block) {
        const nodes = textNodes(block)
        const node = nodes.find((n) => n.data.trim())
        let offset = 0
        for (const n of nodes) {
          if (n === node) break
          offset += n.data.length
        }
        const text = nodes.map((n) => n.data).join('')
        try {
          const { candidates } = await api.post('/text/find', { chain: unitChain(block, isLocked).flatMap((u) => u.stamps).slice(0, 16), elementOld: text, nodeOld: node.data, nodeOffset: offset })
          t.words = { text: text.replace(/\s+/g, ' ').trim().slice(0, 100), found: candidates }
        } catch {}
      }
      const matched = matchedRules(sel.el)
      await locateRules(matched)
      t.rules = matched
        .slice()
        .reverse()
        .slice(0, 14)
        .map((m) => {
          const loc = located.get(m.rule)
          const f = loc?.found?.[0]
          return { selector: m.selector, media: m.media, props: m.props, where: f ? { file: f.file, line: f.line, col: f.col } : null, sheet: loc?.sheet ?? m.sheet, sheetGenerated: loc?.sheetGenerated ?? null }
        })
      return t
    })()
    traceCache.set(sel.el, job)
    return job
  }

  async function motionData() {
    const sel = state.sel
    if (!sel) return { animations: [], movers: [], frozen: false }
    const el = sel.el
    const anims = animationsOf(el, true).slice(0, 12)
    state.anims = anims
    let kf = {}
    const names = [...new Set(anims.filter((a) => a.kind === 'css').map((a) => a.name))]
    if (names.length) {
      try {
        kf = (await api.post('/trace/keyframes', { names })).keyframes
      } catch {}
    }
    const animations = anims.map((a, index) => ({
      index,
      kind: a.kind,
      name: a.name,
      target: a.target === el ? 'this element' : labelOf(a.target),
      duration: a.duration,
      iterations: a.iterations,
      playState: a.anim.playState,
      currentTime: Number(a.anim.currentTime) || 0,
      source: a.kind === 'css' ? kf[a.name]?.[0] ?? null : null,
    }))
    const frozen = !!boot.isFrozen?.()
    let watched = motionCache.get(el)
    if (!watched && !frozen) {
      watched = (async () => {
        const around = []
        for (let p = el.parentElement; p && around.length < 3 && p !== document.body; p = p.parentElement) around.push(p)
        const hits = await watchMotion([el, ...around, ...[...el.children].slice(0, 6)], { ms: 700, toolDir: boot.tool })
        const frames = hits.flatMap((x) => x.frames)
        let mapped = {}
        if (frames.length) {
          try {
            mapped = (await api.post('/trace/frames', { frames: frames.map((f) => ({ key: `${f.url}:${f.line}:${f.col}`, url: f.url, line: f.line, col: f.col })) })).frames
          } catch {}
        }
        return hits.map((x) => ({
          label: x.el === el ? 'this element' : labelOf(x.el),
          props: x.props,
          count: x.count,
          library: x.library,
          frames: x.frames.map((f) => mapped[`${f.url}:${f.line}:${f.col}`]).filter(Boolean),
        }))
      })()
      motionCache.set(el, watched)
    }
    return { animations, movers: watched ? await watched : [], frozen }
  }

  function setSpeed(v) {
    if (boot.isFrozen?.()) setFrozen(false)
    boot.setSpeed?.(v)
    store.set('speed', String(v))
    renderBar()
    renderInspector()
  }

  /* ================================================================ */
  /*  text                                                             */
  /* ================================================================ */

  function caretAt(x, y) {
    return passThrough(() => {
      if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(x, y)
        if (!p) return null
        const r = document.createRange()
        r.setStart(p.offsetNode, p.offset)
        r.collapse(true)
        return r
      }
      return document.caretRangeFromPoint?.(x, y) ?? null
    })
  }

  /**
   * HOW MUCH OF AN ELEMENT CAN BE SEEN: its opacity times every ancestor's.
   * checkVisibility's opacity test is for exactly 0, and pages fade what
   * they are not showing to NEARLY nothing instead: a scene-by-scene landing
   * keeps every other scene's words painted at 0.003 so they appear without
   * a stall, and on a phone all of them sit in the same place. A tap on the
   * words that showed found the faded ones laid over them, and opened words
   * nobody could see for editing. Below FAINT, words cannot be read, so a
   * tap never means them; Layers and search still reach them.
   */
  const FAINT = 0.08
  function seenOpacity(el, memo) {
    if (!el || el === document.documentElement) return 1
    if (memo?.has(el)) return memo.get(el)
    const own = Number(getComputedStyle(el).opacity)
    const a = (Number.isFinite(own) ? own : 1) * seenOpacity(el.parentElement, memo)
    memo?.set(el, a)
    return a
  }

  /**
   * THE WORDS UNDER A POINT, found by where text is LAID OUT rather than by
   * the browser's hit test. The hit test skips anything with
   * pointer-events: none - which is exactly how a page lets a drag reach the
   * stage under its headline - so a tap on visible words selected the stage,
   * and the caret lookup found no text at all. Returns the text node, a
   * caret at the character under the point, and the element holding it;
   * the last in document order wins, as it paints last.
   */
  function textAt(x, y) {
    let best = null
    const shown = new Map() // element -> how much of it can be seen
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement
        if (!p || !n.data.trim() || ui.host.contains(p) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|OPTION)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })
    const range = document.createRange()
    const seen = new Map()
    const near = (r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement
      // most text sits inside its own element's box: a cheap first test, measured once per element
      let box = seen.get(p)
      if (box === undefined) {
        const r = p.getBoundingClientRect()
        box = r.width || r.height ? r : null
        seen.set(p, box)
      }
      if (box && !near({ left: box.left - 40, right: box.right + 40, top: box.top - 20, bottom: box.bottom + 20 })) continue
      range.selectNodeContents(n)
      if (![...range.getClientRects()].some(near)) continue
      if (p.checkVisibility && !p.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
      if (seenOpacity(p, shown) < FAINT) continue
      best = n
    }
    if (!best) return null
    // the character under the point, for the caret
    let at = 0
    for (let i = 0; i < best.data.length; i++) {
      range.setStart(best, i)
      range.setEnd(best, i + 1)
      const r = range.getBoundingClientRect()
      if (near(r)) {
        at = x > r.left + r.width / 2 ? i + 1 : i
        break
      }
    }
    const caret = document.createRange()
    caret.setStart(best, at)
    caret.collapse(true)
    return { node: best, caret, el: best.parentElement }
  }

  /**
   * The piece of text a tap means: the block the words are in, and past it
   * when that block is only a word or a line of a longer text - a heading
   * set one span per word, or a paragraph one span per line, to animate
   * them - since nobody tapping "Ideas" means the word and not the heading.
   * A span that is the whole of a key's or a heading's words gives way to
   * it too. Only spans and their kind climb, so a card's own text stays its own.
   */
  const PIECE = /^(SPAN|EM|STRONG|B|I|MARK|SMALL|SUB|SUP|U|S)$/
  function textBlockOf(node) {
    let el = blockFor(node)
    for (let i = 0; i < 6 && el?.parentElement && el.parentElement !== document.body && PIECE.test(el.tagName); i++) {
      const parent = el.parentElement
      const pieces = [...parent.childNodes].filter((n) => (n.nodeType === 3 ? n.data.trim() : n.nodeType === 1 && (n.textContent ?? '').trim()))
      if (pieces.length < 2 && !/^(A|BUTTON|LABEL|SUMMARY|H[1-6]|P|LI)$/.test(parent.tagName)) break
      el = parent
    }
    return el
  }

  /**
   * Whether the words found at a point are what a tap there means: nothing
   * solid is painted over them. Canvases are let through (a canvas over text
   * is a drawing surface, and its pixels say nothing about stacking); an
   * element with an opaque fill or a picture of its own is not.
   */
  function textShows(words, stack) {
    for (const e of stack) {
      if (e === words.el || e.contains(words.el)) return true
      if (e.tagName === 'CANVAS') continue
      if (REPLACED.test(e.tagName)) return false
      const cs = getComputedStyle(e)
      const bg = parseColor(cs.backgroundColor)
      if ((bg && bg.a > 0.85) || (cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage))) return false
    }
    return true
  }

  function textRequest(b, node) {
    const nodes = b.nodes
    const elementOld = nodes.map((n) => b.orig.get(n) ?? n.data).join('')
    let nodeOffset = 0
    for (const n of nodes) {
      if (n === node) break
      nodeOffset += (b.orig.get(n) ?? n.data).length
    }
    const old = b.orig.get(node) ?? ''
    const now = node.data
    let p = 0
    const max = Math.min(old.length, now.length)
    while (p < max && old[p] === now[p]) p++
    let s = 0
    while (s < max - p && old[old.length - 1 - s] === now[now.length - 1 - s]) s++
    return { chain: b.chain, elementOld, nodeOld: old, nodeOffset, from: nodeOffset + p, to: nodeOffset + old.length - s, insert: now.slice(p, now.length - s), choice: b.choice.get(node) ?? null }
  }

  async function onTextCommit(block, changes) {
    let b = blocks.get(block)
    if (!b) {
      const nodes = textNodes(block)
      const orig = new Map(nodes.map((n) => [n, n.data]))
      for (const c of changes) orig.set(c.node, c.before)
      b = { el: block, nodes, orig, choice: new Map(), chain: unitChain(block, isLocked).flatMap((u) => u.stamps).slice(0, 16) }
      if (!b.chain.length) {
        toast('This text is not part of the project source.', 'warn')
        return false
      }
      blocks.set(block, b)
    }
    let target = null
    for (const c of changes) {
      let req = textRequest(b, c.node)
      if (req.from === req.to && !req.insert) continue
      let r
      try {
        r = await api.post('/text/resolve', req)
        if (r.status === 'ambiguous') {
          const pick = await ui.ask({
            title: 'Which one is this?',
            text: 'These words are written in more than one place. Pick the one this element shows.',
            choices: r.candidates.map((x) => ({ value: x.id, title: `${x.file}:${x.line}`, detail: x.preview })),
          })
          if (!pick) return false
          b.choice.set(c.node, pick)
          req = { ...req, choice: pick }
          r = await api.post('/text/resolve', req)
        }
      } catch (e) {
        toast(e.message, 'err')
        return false
      }
      if (r.status !== 'ok') {
        const fromString = !fiberOf(block) || unitFor(block).dangerous
        toast(
          r.reason ??
            (fromString
              ? 'These words come from markup set as a string, and Retouch could not find them in the files it reads. If they are kept in an .html file, add it to text.include in the config.'
              : 'These words are not written in the source as they appear here - they are probably put together by code.'),
          'warn',
          7500,
        )
        return false
      }
      if (r.warnings?.length) toast(r.warnings.join(' '), 'warn', 6500)
      target = r.target
    }
    history.push({
      kind: 'text',
      label: `text in ${target?.file ?? 'source'}`,
      undo: () => changes.forEach((c) => (c.node.data = c.before)),
      redo: () => changes.forEach((c) => (c.node.data = c.after)),
    })
    if (target) toast(`Text in ${target.file}:${target.line}`, 'info', 2600)
    renderBar()
    return true
  }

  function editTextAt(x, y) {
    if (state.editing) state.editing.commit()
    // by where the words are laid out first: the caret lookup cannot see text the page made click-through
    const w = textAt(x, y)
    const range = w?.caret ?? caretAt(x, y)
    const node = range?.startContainer
    if (!node || node.nodeType !== 3 || !node.data.trim()) return toast('There is no text here to edit.', 'warn', 2400)
    startTextEdit(node, range)
  }

  /** Type into an element's own words: the caret at the end of them, whatever its padding; `all` selects them, to type over. */
  function editTextOf(el, { all = false } = {}) {
    const nodes = textNodes(el).filter((n) => n.data.trim())
    if (!nodes.length) return toast('There is no text in this to edit.', 'warn', 2400)
    const last = nodes[nodes.length - 1]
    const r = document.createRange()
    r.setStart(all ? nodes[0] : last, all ? nodes[0].data.length - nodes[0].data.trimStart().length : last.data.replace(/\s+$/, '').length)
    if (all) r.setEnd(last, last.data.replace(/\s+$/, '').length)
    else r.collapse(true)
    startTextEdit(last, r)
  }

  function startTextEdit(node, range) {
    const block = textBlockOf(node)
    if (!block || isLocked(block)) return toast('This text is locked in the Retouch config.', 'warn')
    if (block.closest?.('[contenteditable=""],[contenteditable="true"]')) return toast('This text is the page\'s own editable field, so Retouch leaves it alone.', 'warn')
    if (block instanceof SVGElement) return editSvgText(block)
    deselect()
    state.editing = startEditing(block, {
      caret: range,
      onCommit: (changes) => onTextCommit(block, changes),
      onEnd: () => {
        state.editing = null
        ui.editing.style.display = 'none'
        // what was typed into stays selected, so its Text panel is still there to read
        if (block.isConnected && state.mode === 'edit' && !state.sel && !state.group) selectElement(block, { scroll: false })
      },
    })
    loop()
  }

  async function editSvgText(el) {
    const nodes = textNodes(el)
    const old = nodes.map((n) => n.data).join('')
    const next = await prompt('Edit text', old)
    if (next == null || next === old) return
    const changes = applyText(nodes, next)
    if (changes.length && (await onTextCommit(el, changes)) === false) for (const c of changes) c.node.data = c.before
  }

  function prompt(title, value) {
    return new Promise((done) => {
      const input = h('input', { value, style: { width: '100%', marginBottom: '12px' } })
      ui.dialog.replaceChildren(
        h('h4', { text: title }),
        input,
        h('div', { class: 'btns' }, h('button', { text: 'Cancel', onclick: () => end(null) }), h('button', { class: 'primary', text: 'OK', onclick: () => end(input.value) })),
      )
      const end = (v) => {
        ui.dialog.style.display = 'none'
        done(v)
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') end(input.value)
        if (e.key === 'Escape') end(null)
      })
      ui.dialog.style.display = 'block'
      input.focus()
      input.select()
    })
  }

  /* ================================================================ */
  /*  saving                                                           */
  /* ================================================================ */

  function transformOp(rec) {
    const st = rec.info.strategies.transform
    const op = { kind: 'transform', stamp: rec.target }
    if (st.kind === 'adapter') {
      const ad = st.adapter
      const p = rec.props ?? {}
      let anchor
      if (rec.svg && ad.anchor === 'props') anchor = { x: Number(p[ad.move.x]) || 0, y: Number(p[ad.move.y]) || 0 }
      else {
        const f = Array.isArray(ad.anchor) ? ad.anchor : [0, 0]
        anchor = { x: rec.c0.x + (f[0] - 0.5) * rec.el.offsetWidth, y: rec.c0.y + (f[1] - 0.5) * rec.el.offsetHeight }
      }
      const split = G.adapterSplit(rec.N, rec.c0, anchor, ad.size.length > 0)
      op.propEdits = {}
      if (ad.move.x) op.propEdits[ad.move.x] = { add: G.num(split.delta.x) }
      if (ad.move.y) op.propEdits[ad.move.y] = { add: G.num(split.delta.y) }
      for (const s of ad.size) op.propEdits[s] = { mul: G.num(split.k, 4) }
      if (split.rest) {
        if (rec.svg) op.wrapper = split.rest
        else op.style = { rotate: Math.abs(split.theta) >= 0.01 ? `${G.num(split.theta)}deg` : null, scale: split.fx !== 1 || split.fy !== 1 ? `${split.fx} ${split.fy}` : null }
      }
      return op
    }
    if (st.kind === 'wrapper') {
      op.wrapper = G.svgTransform(rec.N, rec.c0)
      return op
    }
    op.style = G.cssStrings(G.cssFor(rec))
    return op
  }

  /** Every unsaved edit, as the batch a save would send. Keys starting with _ are for the editor only. */
  function pending() {
    const ops = []
    for (const rec of recs.values()) {
      if (rec.deleted) {
        ops.push({ kind: 'delete', stamp: rec.target, mode: rec.deleteMode, _label: rec.unitLabel, _el: rec.el })
        continue
      }
      if (rec.frame && !G.isIdentity(rec.N)) ops.push({ ...transformOp(rec), _label: rec.unitLabel, _el: rec.el })
      for (const c of Object.values(rec.colors)) if (c.value !== c.was) ops.push({ kind: 'color', stamp: rec.target, prop: c.key, value: c.value, mode: c.mode, attr: c.attr, _label: rec.unitLabel, _el: rec.el })
      const styles = Object.entries(rec.styles ?? {}).filter(([, s]) => s.value !== s.was)
      if (styles.length) ops.push({ kind: 'style', stamp: rec.target, props: Object.fromEntries(styles.map(([p, s]) => [camel(p), s.value === '' ? null : s.value])), _label: `${styles.map(([p]) => p).join(', ')} on ${rec.unitLabel}`, _el: rec.el })
    }
    for (const d of declEdits.values()) {
      if (d.value !== d.was) ops.push({ kind: 'decl', target: d.target, value: d.value, _label: d.label, _el: d.el, _decl: d })
    }
    for (const r of recolors.values()) {
      const c = r.cand
      ops.push({ kind: 'recolor', target: { file: c.file, start: c.start, end: c.end, text: c.text, where: c.where }, value: r.value, _label: `${r.label} to ${r.value}`, _el: null, _recolor: r })
    }
    for (const b of blocks.values()) {
      for (const n of b.nodes) {
        if (!b.orig.has(n) || b.orig.get(n) === n.data) continue
        const { choice, ...req } = textRequest(b, n)
        ops.push({ kind: 'text', ...req, ...(choice ? { choice } : {}), _label: `"${n.data.trim().slice(0, 40)}"`, _el: b.el })
      }
    }
    return ops
  }

  const wire = (op) => Object.fromEntries(Object.entries(op).filter(([k]) => !k.startsWith('_')))

  /** Elements with unsaved edits, for their outlines. */
  function editedElements() {
    const out = new Set()
    for (const rec of recs.values()) {
      if (rec.deleted || !rec.el.isConnected) continue
      if (isEdited(rec)) out.add(rec.el)
    }
    for (const b of blocks.values()) if (b.el.isConnected && b.nodes.some((n) => b.orig.has(n) && b.orig.get(n) !== n.data)) out.add(b.el)
    return [...out]
  }

  const isEdited = (rec) =>
    (rec.frame && !G.isIdentity(rec.N)) || Object.values(rec.colors).some((c) => c.value !== c.was) || Object.values(rec.styles ?? {}).some((s) => s.value !== s.was)

  const describeOp = (op) =>
    op.kind === 'text'
      ? `Text ${op._label}`
      : op.kind === 'delete'
        ? `Delete ${op._label}`
        : op.kind === 'color'
          ? `Colour ${op._label} ${op.value}`
          : op.kind === 'style'
            ? `Style ${op._label}`
            : op.kind === 'decl'
              ? `Rule: ${op._label} to ${op.value}`
              : op.kind === 'recolor'
                ? `Written colour: ${op._label}`
                : `Move or resize ${op._label}`

  /**
   * What a save cannot hand to hot reload: edits on elements from HTML
   * strings, edited rules and recoloured literals in generated sheets, and
   * text in markup. Their previews ARE the page's state after the save, so
   * undoing the save has to put them back by hand - and redoing it, again.
   */
  function previewsOf(ops) {
    const undo = []
    const redo = []
    for (const b of blocks.values()) {
      const changed = b.nodes.filter((n) => b.orig.has(n) && b.orig.get(n) !== n.data).map((n) => [n, b.orig.get(n), n.data])
      if (!changed.length) continue
      undo.push(() => changed.forEach(([n, was]) => (n.data = was)))
      redo.push(() => changed.forEach(([n, , now]) => (n.data = now)))
    }
    for (const rec of recs.values()) {
      if (!rec.info?.html) continue
      const els = targetsOf(rec)
      const now = els.map((x) => x.getAttribute('style'))
      const was = els.map((x, k) => (k === 0 ? rec.styleAttr0 : x.__retouchStyle0) ?? null)
      const put = (vals) => els.forEach((x, k) => (vals[k] == null ? x.removeAttribute('style') : x.setAttribute('style', vals[k])))
      undo.push(() => put(was))
      redo.push(() => put(now))
    }
    for (const op of ops) {
      if (op._decl) {
        const d = op._decl
        undo.push(() => d.rule.style.setProperty(d.prop, d.was, d.pri))
        redo.push(() => d.rule.style.setProperty(d.prop, d.value, d.pri))
      }
      if (op._recolor) {
        const r = op._recolor
        undo.push(() => r.show(null))
        redo.push(() => r.show(r.value))
      }
    }
    return { undo, redo }
  }

  async function save({ keepSelection = false, label = null, quiet = false } = {}) {
    if (state.saving) return null
    if (state.editing) state.editing.commit()
    if (color.isOpen) color.apply()
    await new Promise((r) => setTimeout(r, 30))
    const ops = [...pending(), ...settingOps]
    if (!ops.length) {
      toast('Nothing to save.', 'info', 2000)
      return null
    }
    state.saving = true
    renderBar()
    try {
      const kinds = [...new Set(ops.map((o) => o.kind))]
      const previews = previewsOf(ops)
      const needsReload = ops.some((o) => o._recolor && !o._recolor.previewed)
      const { batch, rebuilt } = await api.post('/save', { ops: ops.map(wire), label: label ?? `${ops.length} edit${ops.length === 1 ? '' : 's'} (${kinds.join(', ')})` })
      const done = [...recs.values()]
      recs.clear()
      blocks.clear()
      declEdits.clear()
      recolors.clear()
      forgetSources()
      settle(done)
      history.collapse(savedEntry(batch, previews))
      if (!keepSelection) deselect()
      toast(`Saved to ${batch.files.join(', ')}${rebuilt?.length ? `, then ran ${rebuilt.map((r) => r.label).join(', ')}` : ''}`, 'ok', 4000)
      reportRebuilt(rebuilt)
      if (needsReload && !rebuilt?.some((r) => !r.ok)) {
        const go = await ui.ask({ title: 'Reload to see it?', text: 'That colour reaches the page through a script or a build step, which reads it when the page loads. Reload now, at the same place on the page?', ok: 'Reload', cancel: 'Later' })
        if (go) reloadInPlace()
      }
      return { batch, rebuilt }
    } catch (e) {
      // a caller with a way round the refusal hears why, rather than the person
      if (quiet) return { error: { message: e.message, code: e.code } }
      toast(e.message, 'err', 8000)
      return null
    } finally {
      state.saving = false
      renderBar()
    }
  }

  /**
   * After a save, the page catches up through hot reload. Previews written
   * as the same style the save wrote are simply forgotten - React sets the
   * same values. Previews standing in for something else (props, a wrapper,
   * an attribute, a deletion) are removed the moment React touches the
   * element, so nothing is shown twice and nothing jumps back.
   */
  function settle(done) {
    for (const rec of done) {
      // an element from an HTML string is not re-rendered by hot reload: its preview is its saved state
      if (rec.info?.html) continue
      const st = rec.info?.strategies?.transform?.kind
      const styleOnly = !rec.deleted && (st === 'style' || !rec.frame || G.isIdentity(rec.N)) && Object.values(rec.colors).every((c) => c.mode === 'style')
      if (styleOnly) continue
      const els = targetsOf(rec)
      let cleaned = false
      const clean = () => {
        if (cleaned) return
        cleaned = true
        obs.disconnect()
        for (const el of els) {
          if (rec.frame && st !== 'style') G.unpaint(el, rec.base)
          for (const c of Object.values(rec.colors)) if (c.mode === 'attr') el.style.removeProperty(c.css)
        }
        if (rec.hidden) for (const [el, v, p] of rec.hidden.prev) el.style.setProperty('display', v, p)
      }
      const obs = new MutationObserver((list) => {
        if (list.some((m) => m.type === 'childList' || m.attributeName !== 'style')) clean()
      })
      for (const el of els) {
        obs.observe(el, { attributes: true })
        if (el.parentNode) obs.observe(el.parentNode, { childList: true })
      }
      setTimeout(clean, 5000)
    }
  }

  /** Everything learned about where things are written: stale the moment a file changes. */
  function forgetSources() {
    infoCache.clear()
    htmlStamps = new WeakMap()
    located = new WeakMap()
    traceCache = new WeakMap()
    motionCache = new WeakMap()
    settingsCache = new WeakMap()
    fileIds = null
  }

  /** A generator that failed after a save is the one thing a person must hear about: the page will not match the file. */
  function reportRebuilt(rebuilt) {
    for (const r of rebuilt ?? []) {
      if (r.ok) continue
      const tail = (r.output ?? '').split('\n').filter(Boolean).slice(-3).join(' ')
      toast(`${r.label} failed after that change: ${tail}`, 'err', 12000)
    }
  }

  const savedEntry = (batch, previews = null) => ({
    kind: 'saved',
    saved: true,
    id: batch.id,
    label: batch.label ?? 'save',
    undo: async () => {
      const r = await api.post('/revert', { id: batch.id })
      forgetSources()
      previews?.undo.forEach((f) => f())
      reportRebuilt(r.rebuilt)
      toast(r.rebuilt?.length && !previews ? 'Save undone. Reload to see the rebuilt page.' : 'Save undone - the files are back as they were.', 'ok', 3500)
    },
    redo: async () => {
      const r = await api.post('/reapply', { id: batch.id })
      forgetSources()
      previews?.redo.forEach((f) => f())
      reportRebuilt(r.rebuilt)
      toast(r.rebuilt?.length && !previews ? 'Save redone. Reload to see the rebuilt page.' : 'Save redone.', 'ok', 3500)
    },
  })

  async function undo() {
    try {
      await history.undo()
    } catch (e) {
      toast(e.message, 'err', 7000)
    }
    renderInspector()
  }
  async function redo() {
    try {
      await history.redo()
    } catch (e) {
      toast(e.message, 'err', 7000)
    }
    renderInspector()
  }

  /** Undo history survives reloads: the server's journal is the record of saves. */
  async function seedHistory() {
    try {
      const { batches } = await api.get('/history')
      const kept = batches.filter((b) => !b.undone)
      const lastKept = batches.lastIndexOf(kept[kept.length - 1])
      const redo = batches.slice(lastKept + 1).filter((b) => b.undone).reverse()
      history.seed(kept.map(savedEntry), redo.map(savedEntry))
    } catch {}
  }

  /* ================================================================ */
  /*  rendering                                                        */
  /* ================================================================ */

  /**
   * THE DEPTH RAIL, on the selection itself: everything the selection sits
   * in, outermost first, down to the deepest thing under the click - a
   * drawing on a canvas included. Click a step to select at that depth;
   * hover it to see what it is; scroll over the rail to step through depths.
   */
  function depthRail(sel) {
    const chain = sel.chain.slice().reverse()
    const at = chain.findIndex((u) => u.el === sel.el && (!sel.canvas || u.canvasItem === sel.canvas.item))
    const steps = chain.map((u, k) => ({ u, k }))
    // the selection, its two nearest containers and everything inside it, with the rest folded
    const keep = steps.filter(({ k }) => k >= at - 2 || k === 0)
    const rail = h('div', { class: 'rail' })
    let last = -1
    for (const { u, k } of keep) {
      if (k > last + 1) rail.append(h('span', { class: 'fold', text: '...', title: chain.slice(last + 1, k).map((x) => x.label).join(' > ') }))
      last = k
      const best = u.canvasItem ? u.stamps[0] : [...u.stamps].reverse().find((s) => independent(sel.chainInfo[s] ?? infoCache.get(s), sel.counts.get(baseOf(s)) ?? 1)) ?? u.stamps[u.stamps.length - 1]
      const b = h('button', {
        class: `step${k === at ? ' on' : ''}${u.canvasItem ? ' draw' : u.foreign ? ' str' : ''}`,
        text: u.label,
        title: u.canvasItem ? 'A drawing on the canvas' : u.names.join(' > '),
        onclick: (e) => {
          e.stopPropagation()
          if (u.canvasItem) return selectCanvasItem(u.canvasItem)
          select(u, best, { chain: sel.chain, info: sel.chainInfo, counts: sel.counts, hit: sel.hit })
        },
        onpointerenter: () => ctl.hover(u.canvasItem ? null : u.el, u.canvasItem),
        onpointerleave: () => ctl.hover(null),
      })
      rail.append(b)
    }
    rail.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        e.stopPropagation()
        const next = chain[Math.max(0, Math.min(chain.length - 1, at + (e.deltaY > 0 ? 1 : -1)))]
        if (!next || next === chain[at]) return
        if (next.canvasItem) selectCanvasItem(next.canvasItem)
        else select(next, next.stamps[next.stamps.length - 1], { chain: sel.chain, info: sel.chainInfo, counts: sel.counts, hit: sel.hit })
      },
      { passive: false },
    )
    return rail
  }

  function renderSelection() {
    if (state.group && state.mode === 'edit') return renderGroup()
    ui.sel.classList.remove('group')
    const sel = state.sel
    if (!sel || state.mode !== 'edit') {
      ui.sel.style.display = 'none'
      return
    }
    const ro = !!sel.info.readonly
    const r = ro ? { move: false } : reach(sel)
    const rec = recs.get(sel.el)
    const shared = sel.count > 1 && !(r.move && sel.info.entryLabel)
    ui.sel.classList.toggle('shared', shared || !!rec?.shared)
    ui.sel.classList.toggle('readonly', ro)
    ui.sel.classList.toggle('drawing', !!sel.canvas)
    ui.sel.querySelector('.label').replaceChildren(depthRail(sel), h('span', { class: 'dims' }))
    const actions = ui.sel.querySelector('.actions')
    const link = linkOf(sel.el)
    actions.replaceChildren(
      ...(sel.canvas
        ? [
            btn('drop', 'Its colour, and where it is written', () => ctl.colorOfDrawing()),
            btn('code', 'Open the code that drew it', () => sel.canvas.where && openInEditor(sel.canvas.where.file, sel.canvas.where.line, sel.canvas.where.col)),
          ]
        : [
            link ? btn('link', `Open link: ${link.getAttribute('href')}`, () => go(link.href, link)) : null,
            btn('flipH', 'Flip horizontally (Shift+H)', () => flip('h'), ro ? 'off' : ''),
            btn('flipV', 'Flip vertically (Shift+V)', () => flip('v'), ro ? 'off' : ''),
            btn('drop', 'Colour', () => openColor(), ro ? 'off' : ''),
            btn('pencil', 'Edit text (Enter)', () => editTextOf(sel.el)),
            btn('text', 'Add text after it (T)', () => addText(), ro ? 'off' : ''),
            btn('trash', 'Delete', () => remove(), ro ? 'danger off' : 'danger'),
          ]),
    )
    ui.sel.style.display = 'block'
  }

  /** A group: one box round all of them, its count, and the tools that only make sense for several. */
  function renderGroup() {
    const ms = state.group.members
    const n = ms.length
    const drawn = ms.filter((m) => m.drawing).length
    // drawings are placed by their script: outlined and traced with the rest, never moved
    const onlyDrawn = drawn === n
    ui.sel.classList.add('group')
    ui.sel.classList.toggle('readonly', onlyDrawn)
    ui.sel.classList.toggle('drawing', onlyDrawn)
    ui.sel.classList.remove('shared')
    ui.sel.querySelector('.label').replaceChildren(
      h('span', { class: 'count', text: groupCount(n, drawn) }),
      h('span', { class: 'dims' }),
      h('button', { class: 'unsel', title: 'Unselect all (Esc)', html: `${icon('x', 11)}<span>Unselect all</span>`, onclick: () => unselectAll() }),
    )
    const b = (name, title, fn, cls = '') => btn(name, title, fn, cls)
    const off = onlyDrawn ? 'off' : ''
    ui.sel.querySelector('.actions').replaceChildren(
      b('alignL', 'Align left edges', () => alignGroup('left'), off),
      b('alignC', 'Align centres across', () => alignGroup('center'), off),
      b('alignR', 'Align right edges', () => alignGroup('right'), off),
      b('alignT', 'Align top edges', () => alignGroup('top'), off),
      b('alignM', 'Align middles', () => alignGroup('middle'), off),
      b('alignB', 'Align bottom edges', () => alignGroup('bottom'), off),
      h('span', { class: 'sep' }),
      b('distH', 'Space out evenly across', () => distributeGroup('x'), off),
      b('distV', 'Space out evenly down', () => distributeGroup('y'), off),
      h('span', { class: 'sep' }),
      b('trash', `Delete all ${n}`, () => removeGroup(), onlyDrawn ? 'danger off' : 'danger'),
    )
    ui.sel.style.display = 'block'
  }

  /** "3 items", "5 drawings", "4 items, 2 of them drawings". */
  const groupCount = (n, drawn) => (drawn === n ? `${n} drawing${n === 1 ? '' : 's'}` : drawn ? `${n} items, ${drawn} drawn` : `${n} item${n === 1 ? '' : 's'}`)

  /** Where the selection is on screen: an element's box, or a drawing's box on its canvas. */
  const selRect = (sel) => (sel.canvas ? pageRect(sel.canvas.item) : sel.el.getBoundingClientRect())

  /**
   * EXACT NUMBERS: how far the selection has been moved, how large it is
   * and how far it is turned, relative to how its code draws it - typed in
   * when a drag will not do. Values are in the element's own units: CSS
   * pixels for HTML, the drawing's own units for SVG.
   */
  function transformState(sel = state.sel) {
    const rec = sel ? recs.get(sel.el) : null
    const N = rec?.frame ? rec.N : G.I()
    const c0 = rec?.c0
    const moved = c0 ? G.apply(N, c0) : null
    const dec = G.decompose(N)
    return {
      x: moved ? G.num(moved.x - c0.x, 1) : 0,
      y: moved ? G.num(moved.y - c0.y, 1) : 0,
      size: G.num(Math.sqrt(Math.abs(dec.sx * dec.sy)) * 100, 1) || 100,
      turn: G.num(dec.theta, 1),
    }
  }

  async function setTransform(next) {
    const sel = state.sel
    if (!sel) return
    const cur = transformState(sel)
    const rec0 = recs.get(sel.el)
    const dec = G.decompose(rec0?.frame ? rec0.N : G.I())
    const fx = Math.sign(dec.sx) || 1
    const fy = Math.sign(dec.sy) || 1
    const r = await canTransform(next.turn !== cur.turn ? 'turn' : 'move')
    if (!r) return renderInspector()
    const N0 = r.N
    const lin = G.mul(G.R(next.turn), G.S((next.size / 100) * fx, (next.size / 100) * fy))
    r.N = G.mul(G.T(next.x, next.y), G.about(r.c0, lin))
    paintRec(r)
    history.push(transformEntry(r, N0, r.N, `set ${r.unitLabel}`))
    renderInspector()
    scheduleHints()
  }

  /** The selection as the properties panel shows it: plain values, and actions bound to it. */
  function selectionSummary() {
    const sel = state.sel
    if (!sel || !sel.el.isConnected || state.mode !== 'edit') return null
    const i = sel.info
    const label = sel.unit.names[sel.unit.stamps.indexOf(sel.stamp)] ?? sel.unit.label
    const rec = recs.get(sel.el)
    const notes = []
    const how = []
    if (!i.readonly) {
      const st = i.strategies
      const r = reach(sel)
      const t = st.transform
      const moveText =
        t.kind === 'adapter'
          ? `edits ${[t.adapter.move.x, t.adapter.move.y, ...t.adapter.size].filter(Boolean).join(', ')}${t.entry ? ` in ${i.entryLabel ?? 'its entry'}` : ''}`
          : t.kind === 'wrapper'
            ? 'wraps it in <g transform>'
            : i.html
              ? 'writes its style attribute'
              : 'writes a style prop'
      const turnText = t.kind === 'adapter' ? (t.rest === 'wrapper' ? 'wraps it in <g transform>' : 'writes a style prop') : moveText
      how.push(
        ['Move, size', moveText + (sel.count > 1 && !r.move ? ` (all ${sel.count})` : '')],
        ['Turn, flip', !r.turn && sel.count > 1 && t.kind === 'adapter' && t.entry ? 'not for one of a list' : turnText + (sel.count > 1 ? ` (all ${sel.count})` : '')],
        ['Delete', st.delete.kind === 'entry' ? `removes ${st.delete.label}` : sel.count > 1 ? `removes the line (all ${sel.count})` : i.html ? 'removes it from the HTML file' : 'removes the element'],
      )
      if (sel.count > 1 && i.entryLabel && r.move) notes.push({ info: true, text: `${i.entryLabel}: one of ${sel.count} drawn from a list. Moving and resizing edit just this entry.` })
      else if (sel.count > 1) notes.push({ text: `Drawn ${sel.count} times from one line of code: edits here are saved to all ${sel.count}.` })
      if (t.unverified || (st.color.unverified && !sel.unit.svg)) notes.push({ info: true, text: `Style edits are saved on <${label}>. They show only if ${label} passes its style prop through; check after saving.` })
      if (i.html) notes.push({ info: true, text: `Written in ${i.file}, which the page loads as a string. Edits are saved there${state.config.rebuild?.length ? ' and its generator runs after each save' : ''}.` })
      if (i.stale) notes.push({ text: 'The file changed since this page loaded. Edits are relocated when saved; reload if a save is refused.' })
    }
    // breadcrumbs: outer to inner
    const crumbs = sel.chain
      .slice(0, 8)
      .reverse()
      .map((u) => {
        const best = [...u.stamps].reverse().find((s) => independent(sel.chainInfo[s], sel.counts.get(baseOf(s)) ?? 1)) ?? u.stamps[u.stamps.length - 1]
        const on = u.canvasItem ? sel.canvas?.item === u.canvasItem : u.el === sel.el && !sel.canvas
        return { label: u.label, title: u.names.join(' > '), on, draw: !!u.canvasItem, select: () => (u.canvasItem ? selectCanvasItem(u.canvasItem) : select(u, best, { chain: sel.chain, info: sel.chainInfo, counts: sel.counts, hit: sel.hit })) }
      })
    const cs = getComputedStyle(sel.el)
    let drawing = null
    if (sel.canvas) {
      const it = sel.canvas.item
      const { k } = scaleFor(it.canvas)
      const cr = it.canvas.getBoundingClientRect()
      drawing = {
        name: itemName(it),
        kind: it.kind,
        x: Math.round(it.bbox.x / k),
        y: Math.round(it.bbox.y / k),
        w: Math.round((it.bbox.w / k) * 10) / 10,
        h: Math.round((it.bbox.h / k) * 10) / 10,
        lineWidth: it.lineWidth ? Math.round((it.lineWidth / k) * 10) / 10 : 0,
        alpha: Math.round(it.alpha * 100) / 100,
        colors: drawingColors(it),
        text: it.text ?? null,
        src: it.src ?? null,
        canvas: labelOf(it.canvas),
        canvasSize: `${Math.round(cr.width)} x ${Math.round(cr.height)}`,
        where: sel.canvas.where,
        chain: sel.canvas.chain,
        at: sel.canvas.at,
        group: sel.canvas.group.length,
        showGroup: sel.canvas.showGroup,
      }
    }
    return {
      label,
      tag: sel.el.tagName.toLowerCase(),
      drawing,
      kind: drawing ? 'drawing' : i.readonly ? 'script' : i.html ? 'html' : 'jsx',
      file: i.file ?? null,
      line: i.line,
      col: i.col,
      count: sel.count,
      readonly: !!i.readonly,
      readonlyWhy: i.why ?? null,
      svg: !!sel.unit.svg,
      display: cs.display,
      hasText: textNodes(sel.el).some((n) => n.data.trim()),
      // the words as they read, for the Text panel's field
      words: drawing ? null : (sel.el.innerText ?? sel.el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 800),
      key: !drawing && isKey(sel.el, cs),
      textStyle: drawing ? null : styleSummary(Object.fromEntries(TEXT_STYLE.map((p) => [p, cs.getPropertyValue(p).trim()]))),
      gradient: !drawing && !!parseCssGradient(cs.backgroundImage),
      link: linkOf(sel.el)?.getAttribute('href') ?? null,
      edited: !!rec && isEdited(rec),
      crumbs,
      how,
      notes,
    }
  }

  let inspector = null
  let inspectorVersion = 0
  function renderInspector() {
    inspectorVersion++
    emit()
    const box = ui.inspector
    if (embedded || state.mode !== 'edit' || (!state.sel && !state.group && !state.picked)) {
      box.style.display = 'none'
      return
    }
    inspector ??= createInspector(box, ctl, { compact: true })
    box.style.display = 'block'
    inspector.render()
  }

  function resetRec(rec) {
    const before = { N: rec.N, colors: { ...rec.colors }, styles: { ...rec.styles }, deleted: rec.deleted }
    const apply = (snap) => {
      rec.N = snap.N
      paintRec(rec)
      for (const c of Object.values(rec.colors)) for (const x of targetsOf(rec)) x.style.setProperty(c.css, c.was)
      for (const [p, s] of Object.entries(rec.styles ?? {})) for (const x of targetsOf(rec)) x.style.setProperty(p, s.was)
      rec.colors = { ...snap.colors }
      rec.styles = { ...snap.styles }
      for (const c of Object.values(rec.colors)) for (const x of targetsOf(rec)) x.style.setProperty(c.css, c.value)
      for (const [p, s] of Object.entries(rec.styles)) for (const x of targetsOf(rec)) x.style.setProperty(p, s.value)
    }
    const clean = { N: G.I(), colors: {}, styles: {}, deleted: false }
    apply(clean)
    history.push({ kind: 'reset', label: `reset ${rec.unitLabel}`, undo: () => apply(before), redo: () => apply(clean) })
    renderBar()
    renderInspector()
  }

  /** Put the selection box, instance outlines, edited outlines and editing frame over their elements. */
  function position() {
    const sel = state.sel
    // a faint outline on everything with unsaved edits, so they can be found again
    const edited = state.mode === 'edit' ? editedElements().filter((el) => el !== sel?.el).slice(0, 40) : []
    if (ui.edited.childElementCount !== edited.length) ui.edited.replaceChildren(...edited.map(() => h('div', { class: 'edited' })))
    edited.forEach((el, k) => ui.place(ui.edited.children[k], el.getBoundingClientRect()))
    if (state.group && state.mode === 'edit') {
      const ms = state.group.members.filter((m) => m.el.isConnected)
      if (ms.length < state.group.members.length) return setMembers(ms, { keep: true })
      const r = groupRect()
      ui.place(ui.sel, r)
      ui.sel.classList.toggle('below', r.top < 64)
      const dims = ui.sel.querySelector('.label .dims')
      if (dims) dims.textContent = `${Math.round(r.width)} x ${Math.round(r.height)}`
      // every member outlined, with a tick at its corner: what is in, at a glance, and what a tap would take out
      if (ui.members.childElementCount !== ms.length) ui.members.replaceChildren(...ms.map(() => h('div', { class: 'member' }, h('i', { class: 'tick', html: icon('check', 9) }))))
      ms.forEach((m, k) => {
        const node = ui.members.children[k]
        const mr = memberRect(m)
        ui.place(node, mr)
        node.classList.toggle('drawing', !!m.drawing)
        node.classList.toggle('stuck', !m.drawing && (!!m.info?.readonly || m.count > 1))
        node.classList.toggle('small', mr.width < 18 || mr.height < 18)
      })
    } else if (sel && state.mode === 'edit') {
      if (!sel.el.isConnected) {
        // hot reload replaced it; a stale box over nothing would be worse than none
        deselect()
      } else {
        const r = selRect(sel)
        ui.place(ui.sel, r)
        ui.sel.classList.toggle('notransform', r.width + r.height === 0)
        // a rail that would run off the top of the window sits under the box instead
        ui.sel.classList.toggle('below', r.top < 64)
        const dims = ui.sel.querySelector('.label .dims')
        if (dims) dims.textContent = `${Math.round(r.width)} x ${Math.round(r.height)}`
        // instances of the same line of code: elements, or every drawing the same code drew
        const peers = sel.canvas ? (sel.canvas.showGroup ? sel.canvas.group.filter((i) => i !== sel.canvas.item) : []) : sel.peers ?? []
        if (ui.peers.childElementCount !== Math.min(peers.length, 80)) ui.peers.replaceChildren(...peers.slice(0, 80).map(() => h('div', { class: 'peer' })))
        peers.slice(0, 80).forEach((p, k) => ui.place(ui.peers.children[k], sel.canvas ? pageRect(p) : p.getBoundingClientRect()))
      }
    }
    if (state.editing) {
      ui.editing.style.display = 'block'
      ui.place(ui.editing, state.editing.el.getBoundingClientRect())
    }
  }

  // Positioned on every event that can move things, and on every frame for
  // things that move by themselves. Not on frames alone: a window that is
  // not being painted delivers none, and the box must still be right when
  // it is shown again.
  window.addEventListener(
    'scroll',
    () => {
      position()
      // guides are drawn in window coordinates: stale the moment the page moves
      if (!state.gesture) {
        guides.clear()
        scheduleHints(220)
      }
    },
    { capture: true, passive: true },
  )
  let redrawTimer = 0
  window.addEventListener('resize', () => {
    position()
    scheduleHints(220)
    // a resized canvas is cleared; a frozen page would otherwise leave it blank until it plays
    clearTimeout(redrawTimer)
    if (boot.isFrozen?.()) redrawTimer = setTimeout(() => boot.step?.(0), 120)
  })

  let looping = false
  function loop() {
    position()
    if (looping) return
    looping = true
    const frame = () => {
      position()
      if (state.sel || state.group || state.editing) realRaf(frame)
      else {
        looping = false
        ui.peers.replaceChildren()
      }
    }
    realRaf(frame)
  }

  /* ================================================================ */
  /*  page events                                                      */
  /* ================================================================ */

  let hoverQueued = false
  let hoverAt = null
  const groupBox = ui.sel.querySelector('.box')
  /**
   * The hover outline. While several are selected it says what a tap will
   * do - add this, or take out the selected thing it is part of - and
   * outlines that thing, since that is what the tap acts on.
   */
  function showHover(rect, label, { draw = false, verb = null } = {}) {
    ui.place(ui.hover, rect)
    ui.hover.firstChild.textContent = verb === 'out' ? `Tap to take out: ${label}` : verb === 'in' ? `Tap to add: ${label}` : label
    ui.hover.classList.toggle('draw', draw)
    ui.hover.classList.toggle('add', verb === 'in')
    ui.hover.classList.toggle('takeout', verb === 'out')
    ui.hover.style.display = 'block'
  }
  /** The group member an element is part of, if any. */
  const holderOf = (el) => state.group?.members.find((m) => !m.drawing && (m.el === el || m.el.contains(el))) ?? null
  window.addEventListener(
    'pointermove',
    (e) => {
      // over the group's own box the page under it is still what a tap acts on
      const overGroup = !!state.group && e.composedPath?.().includes(groupBox)
      const ours = ui.isOurs(e) && !overGroup
      if (state.mode !== 'edit' || state.gesture || state.editing || ours || picker?.active) {
        if (ours || picker?.active) ui.hover.style.display = 'none'
        return
      }
      hoverAt = { x: e.clientX, y: e.clientY }
      if (hoverQueued) return
      hoverQueued = true
      const run = async () => {
        hoverQueued = false
        const p = hoverAt
        const stack = pageStack(p.x, p.y)
        let el = stack.length ? visibleHit(stack, p.x, p.y) : null
        const several = !!state.group
        // over words: the block they are in, as a tap would take it, through click-through layers and canvases
        const words = stack.length ? textAt(p.x, p.y) : null
        if (words && textShows(words, stack)) el = textBlockOf(words.node) ?? words.el
        // over a canvas: the drawing under the pointer, outlined as its own thing
        else if (stack.some((e) => e.tagName === 'CANVAS')) {
          const my = ++hoverToken
          const r = await resolveHit(stack, p.x, p.y)
          if (my !== hoverToken || state.mode !== 'edit' || state.gesture || state.editing) return
          if (r.drawings) {
            const it = r.drawings[0]
            if (!several && state.sel?.canvas?.item === it) return (ui.hover.style.display = 'none')
            const inGroup = several && state.group.members.some((m) => m.drawing && sameDrawing(m.drawing, it))
            return showHover(pageRect(it), itemName(it), { draw: true, verb: several ? (inGroup ? 'out' : 'in') : null })
          }
          el = r.el ?? el
        }
        if (!el || (!several && el === state.sel?.el)) {
          ui.hover.style.display = 'none'
          return
        }
        const holder = several ? holderOf(el) : null
        if (holder) return showHover(holder.el.getBoundingClientRect(), holder.unit.label, { verb: 'out' })
        const verb = several ? 'in' : null
        // React never saw it (markup from a string, a script's node): outline the element itself
        if (!fiberOf(el) && !isLocked(el)) return showHover(el.getBoundingClientRect(), labelOf(el), { verb })
        const u = unitChain(el, isLocked, 1)[0]
        if (!u) {
          ui.hover.style.display = 'none'
          return
        }
        showHover(u.el.getBoundingClientRect(), u.label, { verb })
      }
      // on a frame where there are frames; soon where there are none (a window in the background)
      if (document.visibilityState === 'visible') realRaf(run)
      else setTimeout(run, 30)
    },
    true,
  )
  let hoverToken = 0

  const BLOCK = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'auxclick', 'dragstart', 'submit', 'touchstart', 'touchend']
  for (const type of BLOCK) {
    window.addEventListener(
      type,
      (e) => {
        // a link the editor itself is following: let the page have it
        if (state.passClicks) return
        if (state.mode !== 'edit' || ui.isOurs(e)) return
        // picking a colour: a click keeps the colour under it and does nothing else
        if (picker?.active) {
          e.preventDefault()
          e.stopPropagation()
          if (type === 'pointerdown' && e.button === 0) picker.click(e.clientX, e.clientY)
          return
        }
        if (state.editing && state.editing.el.contains(e.target)) {
          e.stopPropagation()
          return
        }
        // stopPropagation, NOT stopImmediatePropagation: the page's handlers
        // are on its own elements and never see this, but the editor's other
        // window listeners - the ones following a drag - still must
        e.preventDefault()
        e.stopPropagation()
        if (type === 'pointerdown' && e.button === 0) {
          if (state.editing) {
            state.editing.commit()
            return
          }
          if (color.isOpen) color.apply()
          ui.menu.style.display = 'none'
          ui.help.style.display = 'none'
          ui.stackMenu.style.display = 'none'
          const deep = e.ctrlKey || e.metaKey
          // while several are selected every tap adds or takes out, and a box adds more
          const add = e.shiftKey || !!state.group
          const p = { x: e.clientX, y: e.clientY }
          // A CLICK SELECTS; A DRAG DRAWS A SELECTION BOX. Nothing moves from
          // here: moving takes a second press, on what is already selected
          // (its box), so a page can be explored without anything shifting.
          let boxing = false
          const move = (ev) => {
            if (!boxing && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < 5) return
            boxing = true
            drawMarquee(p, { x: ev.clientX, y: ev.clientY })
          }
          const release = (ev) => {
            window.removeEventListener('pointermove', move, true)
            window.removeEventListener('pointerup', release, true)
            window.removeEventListener('pointercancel', release, true)
            if (boxing) finishMarquee(p, { x: ev.clientX, y: ev.clientY }, { add })
            else if (ev.type === 'pointerup') selectAt(p.x, p.y, { deep, under: e.altKey, add })
          }
          window.addEventListener('pointermove', move, true)
          window.addEventListener('pointerup', release, true)
          window.addEventListener('pointercancel', release, true)
        }
        if (type === 'dblclick') editTextAt(e.clientX, e.clientY)
        // right-click: everything under the pointer, top first, to pick the depth wanted
        if (type === 'contextmenu') openStackMenu(e.clientX, e.clientY)
      },
      // not passive: a window-level touch listener is passive by default,
      // and a passive listener cannot stop the page's default action
      { capture: true, passive: false },
    )
  }

  window.addEventListener(
    'keydown',
    (e) => {
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (state.editing) {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          state.editing.cancel()
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          state.editing.commit()
        } else if (mod && k === 's') {
          e.preventDefault()
          state.editing.commit()
          save()
        }
        return
      }
      // search, from anywhere outside a text field
      if ((mod && k === 'k') || (e.key === '/' && !mod && !(ui.isOurs(e) && /^(INPUT|TEXTAREA)$/.test(ui.shadow.activeElement?.tagName ?? '')))) {
        e.preventDefault()
        e.stopPropagation()
        if (embedded && shell?.openFinder) shell.openFinder()
        else openFinder()
        return
      }
      if (mod && e.shiftKey && k === 'e') {
        e.preventDefault()
        e.stopPropagation()
        setMode(state.mode === 'edit' ? 'view' : 'edit')
        return
      }
      if (picker?.active && !ui.isOurs(e)) {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape' || k === 'i') picker.stop()
        else if (k === 'c') picker.copy().then((ok) => toast(ok ? `Copied ${rgbToHex(picker.last?.rgb ?? { r: 0, g: 0, b: 0 })}` : 'The clipboard is not available here.', ok ? 'ok' : 'warn', 1800))
        return
      }
      // Esc mid-drag puts the thing back where the drag began
      if (e.key === 'Escape' && state.activeGesture) {
        e.preventDefault()
        e.stopPropagation()
        state.activeGesture.cancel()
        return
      }
      const inOurInput = ui.isOurs(e) && /^(INPUT|TEXTAREA)$/.test(ui.shadow.activeElement?.tagName ?? '')
      if (inOurInput) return
      // the studio's zoom and its Space+drag, from inside the page; never out of a field the page has
      if (embedded && shell) {
        const t = e.target
        const typing = !ui.isOurs(e) && (/^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '') || !!t?.isContentEditable)
        const zk = zoomKeyOf(e)
        if (zk && shell.zoomKey && !(typing && !(e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          e.stopPropagation()
          shell.zoomKey(zk)
          return
        }
        if (e.code === 'Space' && !typing && state.mode === 'edit' && shell.space) {
          e.preventDefault()
          e.stopPropagation()
          shell.space(true)
          return
        }
      }
      if (state.mode !== 'edit') {
        if (mod && k === 's' && pending().length) {
          e.preventDefault()
          save()
        }
        return
      }
      let handled = true
      if (mod && k === 'z') e.shiftKey ? redo() : undo()
      else if (mod && k === 'y') redo()
      else if (mod && k === 's') save()
      // copy, cut, paste, duplicate; a style; new text
      else if (mod && e.altKey && k === 'c') copyStyle()
      else if (mod && e.altKey && k === 'v') pasteStyle()
      else if (mod && !e.altKey && k === 'c') copySelection()
      else if (mod && !e.altKey && k === 'x') copySelection({ cut: true })
      else if (mod && !e.altKey && k === 'v') pasteAfter()
      else if (mod && !e.altKey && k === 'd') duplicate()
      else if (!mod && !e.altKey && k === 't' && state.sel) addText()
      else if (e.key === 'Escape') {
        if (ui.dialog.style.display === 'block') handled = false
        else if (ui.stackMenu.style.display === 'block') ui.stackMenu.style.display = 'none'
        else if (color.isOpen) color.cancel()
        else deselect()
      } else if (k === 'i' && !mod && !e.altKey) togglePick()
      else if (mod && k === 'a' && (state.sel || state.group)) selectSiblings()
      else if (state.group) {
        const step = e.shiftKey ? 10 : 1
        if (e.key === 'Delete' || e.key === 'Backspace') removeGroup()
        else if (e.key.startsWith('Arrow')) {
          const d = { x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, y: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0 }
          moveMembers(() => d, `nudge ${state.group.members.length} items`)
        } else handled = false
      }
      else if (e.key === ',' && !mod) ctl.seekBy(-1000 / 60)
      else if (e.key === '.' && !mod) ctl.seekBy(1000 / 60)
      else if (!state.sel) handled = false
      else if (e.key === 'Delete' || e.key === 'Backspace') remove()
      else if (e.key.startsWith('Arrow')) {
        const step = e.shiftKey ? 10 : 1
        nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
      } else if (e.shiftKey && k === 'h') flip('h')
      else if (e.shiftKey && k === 'v') flip('v')
      else if (e.key === 'Enter' && e.shiftKey) selectParent()
      else if (e.key === 'Tab') selectSibling(e.shiftKey ? -1 : 1)
      else if (e.key === 'Enter') editTextOf(state.sel.el)
      else handled = false
      if (handled) e.preventDefault()
      e.stopPropagation()
    },
    true,
  )

  if (embedded && shell) {
    window.addEventListener('keyup', (e) => e.code === 'Space' && shell.space?.(false), true)
    window.addEventListener('blur', () => shell.space?.(false))
    // Ctrl+wheel and a trackpad pinch over the page zoom the studio's view, never the browser's.
    // In Edit mode, zoomed in, a plain wheel moves the VIEW first, across and down, and the page
    // scrolls itself once the view is at its edge. In View mode the wheel is the site's, always:
    // it is being used, not edited, and the view still moves by its scrollbars.
    window.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          if (!shell.zoomWheel) return
          e.preventDefault()
          e.stopPropagation()
          shell.zoomWheel(e.deltaY, e.deltaMode, e.clientX, e.clientY)
          return
        }
        if (!shell.panWheel || e.altKey || state.mode !== 'edit') return
        // Shift turns a wheel sideways where the browser has not already
        const sideways = e.shiftKey && !e.deltaX
        if (shell.panWheel(sideways ? e.deltaY : e.deltaX, sideways ? 0 : e.deltaY, e.deltaMode)) {
          e.preventDefault()
          e.stopPropagation()
        }
      },
      { capture: true, passive: false },
    )
  }

  window.addEventListener('beforeunload', (e) => {
    if (pending().length) {
      e.preventDefault()
      e.returnValue = ''
    }
  })

  /* ================================================================ */
  /*  boot                                                             */
  /* ================================================================ */

  function toast(message, kind, ms) {
    return ui.toast(message, kind, ms)
  }

  hot?.on?.('retouch:check', (d) => {
    state.check = d
    renderBar()
    if (d.status === 'failed') toast(`${d.label} failed after that change. Open the check on the toolbar to read why, or undo.`, 'err', 7000)
  })
  hot?.on?.('vite:afterUpdate', () => {
    infoCache.clear()
    traceCache = new WeakMap()
    if (state.sel && !state.sel.el.isConnected) deselect()
    else renderInspector()
  })

  /* ================================================================ */
  /*  several at once                                                  */
  /* ================================================================ */

  /**
   * A GROUP is two or more selected things moved, resized, aligned and
   * deleted together. Each member keeps its own edit record and its own
   * frame, so a member inside a rotated card still moves the way the
   * pointer does, and each is saved exactly as it would be alone. Resizing
   * scales every member about the group's centre - its size AND its
   * distance from the centre - so the layout keeps its proportions.
   */
  const memberOf = (unit, stamp, ctx) => ({
    unit,
    el: unit.el,
    stamp,
    info: ctx.info[stamp] ?? infoCache.get(stamp),
    chain: ctx.chain,
    chainInfo: ctx.info,
    counts: ctx.counts,
    count: unit.foreign ? 1 : ctx.counts.get(baseOf(stamp)) ?? 1,
    props: unit.propsByStamp?.[stamp] ?? null,
    hit: ctx.hit ?? unit.el,
    peers: [],
  })

  /** The thing an element is, as a group member: itself where it can be edited on its own, else what it is in. */
  async function memberFor(el) {
    let ctx
    try {
      ctx = await chainFor(el)
    } catch {
      return null
    }
    if (!ctx.chain.length) return null
    const pick = (ctx.chain[0].el === el ? choose(ctx.chain, ctx.info, ctx.counts, 0, 1) : null) ?? choose(ctx.chain, ctx.info, ctx.counts)
    return pick ? memberOf(pick.unit, pick.stamp, { ...ctx, hit: el }) : null
  }

  /**
   * A drawing on a canvas as a group member: outlined, looked at, recoloured
   * and traced with the others - never moved, since its script places it.
   */
  function drawingMember(it) {
    const name = itemName(it)
    const stamp = `drawing:${++canvasSeq}`
    const info = {
      stamp,
      base: stamp,
      readonly: true,
      drawing: true,
      why: 'Drawn on a canvas by a script, which places it.',
      file: null,
      name,
      strategies: { transform: { kind: 'none' }, delete: { kind: 'none' }, color: { kind: 'none' } },
    }
    infoCache.set(stamp, info)
    const unit = { el: it.canvas, stamps: [stamp], names: [name], label: name, tag: 'canvas', svg: false, propsByStamp: {}, foreign: true, canvasItem: it }
    return { unit, el: it.canvas, stamp, info, chain: [unit], chainInfo: { [stamp]: info }, counts: new Map(), count: 1, props: null, hit: it.canvas, peers: [], drawing: it }
  }
  /** One drawing found again in a newer recording is the same drawing. */
  const sameDrawing = (a, b) => a === b || (a && b && a.canvas === b.canvas && a.kind === b.kind && Math.abs(a.bbox.x - b.bbox.x) < 1 && Math.abs(a.bbox.y - b.bbox.y) < 1 && Math.abs(a.bbox.w - b.bbox.w) < 1)
  const sameMember = (a, b) => (a.drawing || b.drawing ? sameDrawing(a.drawing, b.drawing) : a.el === b.el)
  const memberRect = (m) => (m.drawing ? pageRect(m.drawing) : m.el.getBoundingClientRect())

  const currentMembers = () => {
    if (state.group) return state.group.members
    const s = state.sel
    if (!s) return []
    return [s.canvas ? drawingMember(s.canvas.item) : s]
  }

  /**
   * Make these the selection: one becomes an ordinary selection, more become
   * a group. `keep` holds a group open even at one member: once several are
   * selected, taps add and take out until Unselect all, so tapping away the
   * ones a box took by accident never drops the rest.
   */
  function setMembers(list, { keep = false } = {}) {
    // nothing inside another: a card and its own title are one thing to move. Drawings share
    // their canvas, so they are told apart by themselves, not by the element they are on.
    const out = []
    for (const m of list) {
      if (!m?.el?.isConnected) continue
      if (m.drawing) {
        if (!out.some((x) => sameMember(x, m))) out.push(m)
        continue
      }
      if (out.some((x) => !x.drawing && (x.el === m.el || x.el.contains(m.el)))) continue
      for (let i = out.length - 1; i >= 0; i--) if (!out[i].drawing && m.el.contains(out[i].el)) out.splice(i, 1)
      out.push(m)
    }
    if (color.isOpen) color.apply()
    if (!out.length) return deselect()
    if (out.length === 1 && !keep) {
      state.group = null
      const m = out[0]
      if (m.drawing) return selectCanvasItem(m.drawing)
      return select(m.unit, m.stamp, { chain: m.chain, info: m.chainInfo, counts: m.counts, hit: m.hit })
    }
    state.sel = null
    state.group = { members: out }
    ui.peers.replaceChildren()
    ui.hover.style.display = 'none'
    renderSelection()
    renderInspector()
    loop()
    traceMembers()
  }

  /** The member a tap at this thing would take out: itself, or the selected thing it is part of. */
  const memberHolding = (m) => currentMembers().findIndex((x) => sameMember(x, m) || (!x.drawing && !m.drawing && x.el.contains(m.el)))

  /** In if it is out, out if it is in. A group stays a group until Unselect all. */
  async function toggleMember(m) {
    if (!m) return
    const now = currentMembers()
    const at = memberHolding(m)
    const keep = !!state.group
    if (at >= 0) setMembers(now.filter((_, i) => i !== at), { keep })
    else setMembers([...now, m], { keep })
  }

  /** Leave several-at-once: nothing selected, taps select one thing again. */
  function unselectAll() {
    deselect()
    ui.hover.style.display = 'none'
  }

  /**
   * Where each drawing in a group was drawn: the first frame of its stack
   * mapped to the line written, once per line of code, then shown in
   * Properties. Drawings recorded without stacks are recorded again.
   */
  let tracing = null
  async function traceMembers() {
    const g = state.group
    const want = g?.members.filter((m) => m.drawing && m.where === undefined) ?? []
    if (!want.length || tracing) return
    tracing = (async () => {
      const frames = await drawingsNow({ stacks: true })
      const bySite = new Map()
      for (const m of want) {
        const list = frames.get(m.drawing.canvas) ?? []
        const it = list.includes(m.drawing) ? m.drawing : findAgain(m.drawing, list) ?? m.drawing
        const site = siteOf(it, boot.tool)
        m.where = null
        if (!site?.frames?.length) continue
        if (!bySite.has(site.key)) bySite.set(site.key, { frame: site.frames[0], members: [] })
        bySite.get(site.key).members.push(m)
      }
      if (!bySite.size) return
      const keys = [...bySite.keys()]
      try {
        const { frames: mapped } = await api.post('/trace/frames', { frames: keys.map((k, i) => ({ key: String(i), url: bySite.get(k).frame.url, line: bySite.get(k).frame.line, col: bySite.get(k).frame.col })) })
        keys.forEach((k, i) => {
          const at = mapped[String(i)]
          for (const m of bySite.get(k).members) m.where = at ? { ...at, site: k } : null
        })
      } catch {}
    })()
    try {
      await tracing
    } catch {}
    tracing = null
    if (state.group === g) renderInspector()
    // drawings added while that ran
    if (state.group?.members.some((m) => m.drawing && m.where === undefined)) traceMembers()
  }

  /** Everything a dragged box takes: whole things inside it, the outermost of each nest. */
  function inBox(r) {
    const inside = []
    for (const el of document.body.querySelectorAll('*')) {
      if (ui.host.contains(el) || /^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE|BR|WBR)$/.test(el.tagName) || isLocked(el)) continue
      const b = el.getBoundingClientRect()
      if (b.width < 2 || b.height < 2) continue
      if (b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1) continue
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
      inside.push(el)
    }
    const set = new Set(inside)
    const outermost = inside.filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false
      return true
    })
    // a wrapper that draws nothing of its own is not a thing anyone sees: the visible things inside it are
    const expand = (el, depth = 0) => {
      const parts = [...el.children].filter((c) => set.has(c))
      if (depth < 8 && parts.length >= 1 && !drawsSelf(el)) return parts.flatMap((c) => expand(c, depth + 1))
      return [el]
    }
    return outermost.flatMap((el) => expand(el))
  }

  /** Does an element show anything itself: a fill, a border, a shadow, its own words, or a picture? */
  function drawsSelf(el) {
    if (REPLACED.test(el.tagName) || (el instanceof SVGElement && !/^(g)$/i.test(el.tagName))) return true
    const cs = getComputedStyle(el)
    const bg = parseColor(cs.backgroundColor)
    if ((bg && bg.a > 0.02) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return true
    if (['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some((k) => parseFloat(cs[k]) > 0)) return true
    for (const n of el.childNodes) if (n.nodeType === 3 && n.data.trim()) return true
    // a heading whose words are each in a span is still one block of text
    if ((el.textContent ?? '').trim() && [...el.children].every((c) => /^inline/.test(getComputedStyle(c).display))) return true
    return false
  }

  const boxOf = (a, b) => ({ left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) })
  const within = (p, r) => p.left >= r.left - 1 && p.right <= r.right + 1 && p.top >= r.top - 1 && p.bottom <= r.bottom + 1

  /** The drawings on every canvas the box covers, wholly inside it; the canvas's own ground never. */
  function drawingsInBox(r, frames) {
    const out = []
    for (const [canvas, items] of frames ?? []) {
      if (!canvas.isConnected || ui.host.contains(canvas)) continue
      const cr = canvas.getBoundingClientRect()
      if (cr.right < r.left || cr.left > r.right || cr.bottom < r.top || cr.top > r.bottom) continue
      for (const it of items) {
        if (groundOf(it) || it.alpha < 0.03) continue
        if (within(pageRect(it), r)) out.push(it)
        if (out.length >= 120) return out
      }
    }
    return out
  }

  let marqueeHints = 0
  function drawMarquee(a, b) {
    const r = boxOf(a, b)
    ui.place(ui.marquee, r)
    ui.marquee.style.display = 'block'
    ui.hover.style.display = 'none'
    // what it would take, outlined as it is drawn; a page's worth of boxes, measured at most every 80 ms
    const now = Date.now()
    if (now - marqueeHints < 80) return
    marqueeHints = now
    const rects = [...inBox(r).slice(0, 60).map((el) => el.getBoundingClientRect()), ...drawingsInBox(r, drawings.frames).slice(0, 80).map(pageRect)]
    if (ui.members.childElementCount !== rects.length) ui.members.replaceChildren(...rects.map(() => h('div', { class: 'member hint' })))
    rects.forEach((rc, k) => ui.place(ui.members.children[k], rc))
    // keep the recording fresh while the box is drawn, so what it shows is where the drawings are now
    if (document.getElementsByTagName('canvas').length) drawingsNow()
  }
  let marqueeTold = false
  async function finishMarquee(a, b, { add = false } = {}) {
    const r = boxOf(a, b)
    ui.marquee.style.display = 'none'
    ui.members.replaceChildren()
    const els = inBox(r).slice(0, 60)
    // drawings: frozen first, so the ones taken are the ones that stay where they are shown
    let drawn = []
    const overCanvas = [...document.getElementsByTagName('canvas')].some((c) => {
      const cr = c.getBoundingClientRect()
      return !ui.host.contains(c) && cr.right > r.left && cr.left < r.right && cr.bottom > r.top && cr.top < r.bottom
    })
    if (overCanvas) {
      drawn = drawingsInBox(r, await drawingsNow())
      if (drawn.length && (await holdStill('Froze the page so the drawings hold still. Play it again from the timeline.'))) {
        // where they are now they have stopped; a page that skipped its redraw keeps what the box found
        const still = drawingsInBox(r, await drawingsNow({ fresh: true, stacks: true }))
        if (still.length) drawn = still
      }
    }
    if (!els.length && !drawn.length) {
      if (!add) deselect()
      if (!marqueeTold) toast('Drag around things to select them together. To move something, click it first, then drag it.', 'info', 5000)
      marqueeTold = true
      return
    }
    const found = [...(await Promise.all(els.map(memberFor))).filter(Boolean), ...drawn.map(drawingMember)]
    if (!found.length) return toast('Nothing in that box can be edited on its own: it is made by a script, or written as a whole elsewhere.', 'warn', 5000)
    // a box drawn while several are selected adds to them, as a tap does
    const keep = !!state.group
    setMembers(add ? [...currentMembers(), ...found] : found, { keep })
    if (state.group && !marqueeTold) toast('Selected. Tap one to take it out, tap another to add it, drag the box to move them together. Unselect all (Esc) starts again.', 'info', 6500)
    marqueeTold = true
  }

  /** Freeze the page so drawings hold still; true once the frame already asked for has run. */
  async function holdStill(why) {
    if (boot.isFrozen?.()) return false
    setFrozen(true)
    // the frame already asked for still runs once; after it the page's loop waits in the editor's queue
    await new Promise((done) => (document.visibilityState === 'visible' ? realRaf(() => realRaf(done)) : setTimeout(done, 60)))
    if (why) toast(why, 'info', 4000)
    return true
  }

  const groupRect = () => unionBox(state.group.members.map(memberRect))

  /** The members that can move, each with its record and frame ready; the rest are named, not moved. */
  function movable(members) {
    const ready = []
    const stuck = []
    for (const m of members) {
      if (m.info?.readonly) {
        stuck.push(m)
        continue
      }
      const r = reach(m)
      if (!r.move || (m.count > 1 && !recs.get(m.el)?.shared)) {
        stuck.push(m)
        continue
      }
      const rec = recFor(m)
      if (!ensureFrame(rec)) {
        stuck.push(m)
        continue
      }
      ready.push(rec)
    }
    return { ready, stuck }
  }

  /** One history step for a change to many: each record from where it was to where it is. */
  function pushGroup(recsList, before, label) {
    const after = recsList.map((r) => r.N)
    history.push({
      kind: 'group',
      label,
      undo: () => recsList.forEach((r, i) => ((r.N = before[i]), paintRec(r))),
      redo: () => recsList.forEach((r, i) => ((r.N = after[i]), paintRec(r))),
    })
    renderBar()
    renderInspector()
  }

  /** Move or resize a group by dragging; returns { move, end, cancel } like a single gesture. */
  async function beginGroupGesture(kind, start) {
    if (!state.group) return null
    const { ready, stuck } = movable(state.group.members)
    if (!ready.length) {
      toast(
        stuck.every((m) => m.drawing)
          ? 'Drawings on a canvas are placed by the script that draws them, so they cannot be dragged. Their colours and that code are in Properties.'
          : 'None of these can be moved: they are drawn several times from one line, or made by a script.',
        'warn',
        5500,
      )
      return null
    }
    if (stuck.length) toast(`${stuck.length} of these cannot move with the rest: drawn on a canvas or several times from one line, or made by a script.`, 'warn', 4500)
    const N0 = ready.map((r) => r.N)
    const c0s = ready.map((r) => centreOnScreen(r))
    const cf = ready.map((r) => G.apply(r.N, r.c0))
    const me0 = groupRect()
    const gc = { x: me0.cx, y: me0.cy }
    const d0 = Math.max(4, Math.hypot(start.x - gc.x, start.y - gc.y))
    let targets = kind === 'move' ? collectGroupTargets(ready.map((r) => r.el), { host: ui.host, isLocked }).targets : []
    let settled = false
    let changed = false
    let cancelled = false
    clearHints()
    state.gesture = kind
    const finish = () => {
      state.gesture = null
      state.activeGesture = null
      readout('')
      guides.clear()
    }
    const g = {
      move(p, m = {}) {
        if (cancelled) return
        if (!settled) {
          targets = dropMoving(targets)
          settled = true
        }
        const off = !state.snap || m.free
        if (kind === 'move') {
          let dx = p.x - start.x
          let dy = p.y - start.y
          if (m.shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0)
          const s = snapMove(me0, { x: dx, y: dy }, targets, { off })
          if (m.shift) dy === 0 ? (s.d.y = 0) : (s.d.x = 0)
          ready.forEach((r, i) => {
            const d = G.vecToFrame(r.frame, s.d)
            r.N = G.mul(G.T(d.x, d.y), N0[i])
          })
          guides.draw(s.guides)
          readout(`${G.num(s.d.x, 1)}, ${G.num(s.d.y, 1)}  ${ready.length} items${s.snapped?.x || s.snapped?.y ? '  snapped' : ''}`, p.x, p.y)
        } else {
          let k = Math.max(0.05, Math.min(20, Math.hypot(p.x - gc.x, p.y - gc.y) / d0))
          if (m.shift) k = Math.round(k * 20) / 20
          // each member grows about its own centre, and its centre moves away from the group's by the same factor
          ready.forEach((r, i) => {
            const d = G.vecToFrame(r.frame, { x: (c0s[i].x - gc.x) * (k - 1), y: (c0s[i].y - gc.y) * (k - 1) })
            r.N = G.mul(G.T(d.x, d.y), G.mul(G.about(cf[i], G.S(k)), N0[i]))
          })
          readout(`${G.num(k * 100, 1)}%  ${ready.length} items, spacing kept`, p.x, p.y)
        }
        changed = true
        ready.forEach(paintRec)
      },
      cancel() {
        if (cancelled) return
        cancelled = true
        ready.forEach((r, i) => ((r.N = N0[i]), paintRec(r)))
        finish()
      },
      end() {
        if (cancelled) return
        finish()
        if (changed) pushGroup(ready, N0, `${kind === 'move' ? 'move' : 'resize'} ${ready.length} items`)
      },
    }
    state.activeGesture = g
    return g
  }

  /** Move every member by its own amount on screen: alignment, distribution, nudges. */
  function moveMembers(deltas, label) {
    const { ready, stuck } = movable(state.group?.members ?? [])
    if (!ready.length) return toast('None of these can be moved.', 'warn')
    if (stuck.length) toast(`${stuck.length} of these stay where they are: they cannot move on their own.`, 'warn', 4000)
    const before = ready.map((r) => r.N)
    ready.forEach((r) => {
      const dv = deltas(r.el.getBoundingClientRect(), r)
      if (!dv || (!dv.x && !dv.y)) return
      const d = G.vecToFrame(r.frame, dv)
      r.N = G.mul(G.T(d.x, d.y), r.N)
      paintRec(r)
    })
    pushGroup(ready, before, label)
  }

  function alignGroup(edge) {
    if (!state.group) return
    const g = groupRect()
    const fns = {
      left: (r) => ({ x: g.left - r.left, y: 0 }),
      center: (r) => ({ x: g.cx - (r.left + r.width / 2), y: 0 }),
      right: (r) => ({ x: g.right - r.right, y: 0 }),
      top: (r) => ({ x: 0, y: g.top - r.top }),
      middle: (r) => ({ x: 0, y: g.cy - (r.top + r.height / 2) }),
      bottom: (r) => ({ x: 0, y: g.bottom - r.bottom }),
    }
    moveMembers(fns[edge], `align ${edge}`)
  }

  /** Equal gaps between them, the outermost two staying put. */
  function distributeGroup(axis) {
    if (!state.group || state.group.members.length < 3) return toast('Spacing out takes three or more.', 'info', 2500)
    const h = axis === 'x'
    const rects = state.group.members.filter((m) => !m.drawing).map((m) => ({ el: m.el, r: m.el.getBoundingClientRect() }))
    if (rects.length < 3) return toast('Spacing out takes three or more that can move.', 'info', 2500)
    rects.sort((a, b) => (h ? a.r.left - b.r.left : a.r.top - b.r.top))
    const first = rects[0].r
    const last = rects[rects.length - 1].r
    const span = h ? last.right - first.left : last.bottom - first.top
    const sizes = rects.reduce((s, x) => s + (h ? x.r.width : x.r.height), 0)
    const gap = (span - sizes) / (rects.length - 1)
    const want = new Map()
    let at = h ? first.left : first.top
    for (const x of rects) {
      want.set(x.el, at - (h ? x.r.left : x.r.top))
      at += (h ? x.r.width : x.r.height) + gap
    }
    moveMembers((r, rec) => (h ? { x: want.get(rec.el) ?? 0, y: 0 } : { x: 0, y: want.get(rec.el) ?? 0 }), `space out ${h ? 'across' : 'down'}`)
  }

  /** Resize the whole group by a percentage, spacing included, as a corner drag would. */
  function scaleGroup(pct) {
    if (!state.group) return
    const k = pct / 100
    if (!(k > 0)) return
    const { ready } = movable(state.group.members)
    if (!ready.length) return
    const g = groupRect()
    const before = ready.map((r) => r.N)
    ready.forEach((r) => {
      const c = centreOnScreen(r)
      const cf = G.apply(r.N, r.c0)
      const d = G.vecToFrame(r.frame, { x: (c.x - g.cx) * (k - 1), y: (c.y - g.cy) * (k - 1) })
      r.N = G.mul(G.T(d.x, d.y), G.mul(G.about(cf, G.S(k)), r.N))
      paintRec(r)
    })
    pushGroup(ready, before, `resize ${ready.length} items to ${pct}%`)
  }

  async function removeGroup() {
    if (!state.group) return
    const { ready, stuck } = movable(state.group.members)
    if (!ready.length) return toast('None of these can be deleted on their own.', 'warn')
    const ok = await ui.ask({ title: `Delete ${ready.length} items?`, text: stuck.length ? `${stuck.length} more cannot be deleted on their own and stay.` : 'They are removed from the page now and from their files when you save.', ok: `Delete ${ready.length}`, danger: true })
    if (!ok) return
    const hidden = ready.map((rec) => {
      rec.deleteMode = rec.info.strategies.delete.kind === 'entry' ? 'entry' : 'element'
      return [rec, rec.el.style.getPropertyValue('display'), rec.el.style.getPropertyPriority('display')]
    })
    const hide = () => hidden.forEach(([rec]) => ((rec.deleted = true), rec.el.style.setProperty('display', 'none', 'important')))
    const show = () => hidden.forEach(([rec, v, p]) => ((rec.deleted = false), rec.el.style.setProperty('display', v, p)))
    hidden.forEach(([rec, v, p]) => (rec.hidden = { els: [rec.el], prev: [[rec.el, v, p]] }))
    hide()
    history.push({ kind: 'delete', label: `delete ${ready.length} items`, undo: show, redo: hide })
    deselect()
    renderBar()
  }

  /** The things beside the selection: Ctrl+A takes them all. For a drawing, everything the same line of code drew. */
  async function selectSiblings() {
    const first = state.group?.members[0]
    if (first?.drawing || state.sel?.canvas) {
      const it = first?.drawing ?? state.sel.canvas.item
      const frames = await drawingsNow({ stacks: true })
      const list = frames.get(it.canvas) ?? []
      const me = list.includes(it) ? it : findAgain(it, list) ?? it
      const site = siteOf(me, boot.tool)
      const same = site ? list.filter((o) => siteOf(o, boot.tool)?.key === site.key) : [me]
      return setMembers(same.map(drawingMember), { keep: true })
    }
    const base = first?.el ?? state.sel?.el
    if (!base?.parentElement) return
    const kids = [...base.parentElement.children].filter((c) => !ui.host.contains(c) && c.getBoundingClientRect().width > 0)
    const found = (await Promise.all(kids.map(memberFor))).filter(Boolean)
    setMembers(found, { keep: true })
  }

  /* ================================================================ */
  /*  copy, cut, paste, duplicate; a style; new text                   */
  /* ================================================================ */

  /**
   * A COPY IS A LINE OF SOURCE, NOT A PICTURE. Ctrl+C remembers which
   * element was copied (and puts its words on the clipboard); Ctrl+V writes
   * that element's own source after what is selected, in the selection's
   * file and indentation, and the page shows it through hot reload. Pasting
   * and adding text write at once, like a setting: there is no honest
   * preview of an element that does not exist yet. Undo takes it out again.
   */
  let copied = null
  let copiedStyle = null
  const TEXT_STYLE = ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'color', 'text-transform', 'text-decoration-line', 'text-align']
  const BOX_STYLE = ['background-color', 'border-radius', 'border-width', 'border-style', 'border-color', 'box-shadow', 'padding']
  /** The stamp an edit to the selection writes to: an edited element keeps the target its edits are for. */
  const targetStamp = (s) => recs.get(s.el)?.target ?? s.stamp
  const labelOfSel = (s) => s.unit.names?.[s.unit.stamps.indexOf(s.stamp)] ?? s.unit.label

  function copySelection({ cut = false } = {}) {
    const s = state.sel
    if (state.group) return toast('Copy and paste take one thing at a time. Select one, then Ctrl+C.', 'info', 3500)
    if (!s) return toast('Select something to copy first.', 'info', 2500)
    if (s.canvas) return toast('A drawing is made by its code; its colours can be copied from Properties.', 'info', 3500)
    if (s.info.readonly) return toast(READONLY_MSG, 'warn', 6500)
    copied = { stamp: targetStamp(s), label: labelOfSel(s), count: s.count }
    const words = (s.el.innerText ?? s.el.textContent ?? '').trim()
    try {
      if (words) navigator.clipboard?.writeText(words)
    } catch {}
    if (cut) {
      remove()
      toast(`Cut ${copied.label}. Select where it goes and press Ctrl+V; it leaves its old place when it is pasted or saved.`, 'ok', 5000)
    } else toast(`Copied ${copied.label}. Select where it goes and press Ctrl+V to put it after that.${words ? ' Its words are on the clipboard too.' : ''}`, 'ok', 4500)
    renderInspector()
  }

  async function pasteAfter() {
    if (!copied) return toast('Copy something first (Ctrl+C), or right-click for Add text.', 'info', 3000)
    const s = state.sel
    if (!s || s.canvas || s.info.readonly) return toast('Select where it goes first: the copy is put after what is selected.', 'info', 3500)
    const res = await insertNow({ stamp: targetStamp(s), where: 'after', copy: copied.stamp }, `paste ${copied.label}`, s)
    if (res?.el) selectElement(res.el, { scroll: false })
  }

  async function duplicate() {
    const s = state.sel
    if (!s || s.canvas || s.info.readonly || state.group) return toast('Select one thing to duplicate.', 'info', 2500)
    const res = await insertNow({ stamp: targetStamp(s), where: 'after', copy: targetStamp(s) }, `duplicate ${labelOfSel(s)}`, s)
    if (res?.el) selectElement(res.el, { scroll: false })
  }

  /** A key: something pressed - a button, a link drawn as a button - whose looks when pressed are worth showing. */
  function isKey(el, cs = getComputedStyle(el)) {
    if (/^(BUTTON|SUMMARY)$/.test(el.tagName) || el.getAttribute('role') === 'button' || (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type))) return true
    if (el.tagName !== 'A' && !el.onclick) return false
    const bg = parseColor(cs.backgroundColor)
    return (bg && bg.a > 0.02) || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none'
  }

  /** "Nunito 48px, weight 800, #f8fbff": what a style is, in one line. */
  function styleSummary(p) {
    const fam = (p['font-family'] ?? '').split(',')[0].replace(/["']/g, '').trim()
    const rgb = parseColor(p.color ?? '')
    const bits = [`${fam} ${p['font-size'] ?? ''}`.trim(), p['font-weight'] ? `weight ${p['font-weight']}` : '', p['font-style'] === 'italic' ? 'italic' : '', rgb ? rgbToHex(rgb) : '']
    return bits.filter(Boolean).join(', ')
  }

  /** The text style of the selection, and its box when it draws one (a button's fill, corners and padding). */
  function copyStyle() {
    const s = state.sel
    if (!s || s.canvas || state.group) return toast('Select one piece of text or one element first.', 'info', 2500)
    const cs = getComputedStyle(s.el)
    const props = Object.fromEntries(TEXT_STYLE.map((p) => [p, cs.getPropertyValue(p).trim()]))
    const bg = parseColor(cs.backgroundColor)
    const box = (bg && bg.a > 0.02) || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none'
    if (box) for (const p of BOX_STYLE) props[p] = cs.getPropertyValue(p).trim()
    copiedStyle = { from: labelOfSel(s), props, box }
    toast(`Copied the style of ${copiedStyle.from}: ${styleSummary(props)}${box ? ', with its box' : ''}. Select something and paste it (Ctrl+Alt+V).`, 'ok', 5000)
    renderInspector()
  }

  async function pasteStyle() {
    if (!copiedStyle) return toast('Copy a style first: select some text and press Ctrl+Alt+C.', 'info', 3500)
    const s = state.sel
    if (!s || s.canvas || state.group) return toast('Select what the style goes on first.', 'info', 2500)
    const cs = getComputedStyle(s.el)
    const changes = Object.entries(copiedStyle.props).filter(([p, v]) => v && cs.getPropertyValue(p).trim() !== v)
    if (!changes.length) return toast('It already has that style.', 'info', 2500)
    await setStyles(Object.fromEntries(changes), `paste the style of ${copiedStyle.from}`)
    toast(`Pasted ${changes.length} part${changes.length === 1 ? '' : 's'} of the style of ${copiedStyle.from}. Save to write it.`, 'ok', 3500)
  }

  // tags new words beside a text element take its own tag (and class) for; anything else is a paragraph
  const SAME_TAG = /^(P|LI|H2|H3|H4|H5|H6|SPAN|BLOCKQUOTE|FIGCAPTION|DT|DD|LABEL|SMALL)$/

  /**
   * NEW WORDS. Beside the selection when it is text - same tag and class, so
   * it looks like the words it follows - and inside it, at the end, when it
   * holds other things. Written at once, then opened for typing with every
   * word selected, so the first key typed replaces them.
   */
  async function addText() {
    const s = state.sel
    if (state.group) return toast('Select one thing: new text goes after it, or inside it when it holds other things.', 'info', 4000)
    if (!s || s.canvas || s.info.readonly) return toast('Select where the text goes first: it is added after what is selected, or inside it when it holds other things.', 'info', 4500)
    const el = s.el
    const ownWords = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim()) || (textNodes(el).some((n) => n.data.trim()) && blockFor(textNodes(el).find((n) => n.data.trim())) === el)
    const same = SAME_TAG.test(el.tagName)
    const op = ownWords
      ? { stamp: targetStamp(s), where: 'after', element: { tag: same ? el.tagName.toLowerCase() : 'p', text: 'New text', sameClass: same } }
      : { stamp: targetStamp(s), where: 'end', element: { tag: 'p', text: 'New text' } }
    let res = await insertNow(op, 'add text', s, { quiet: true, edit: 'New text' })
    // nowhere beside it (a component's root, what a list returns): at the end of what holds it instead
    if (res?.error?.code === 'place' && op.where === 'after') {
      const at = s.chain.findIndex((u) => u.el === el)
      const up = s.chain.slice(at + 1).find((u) => u.stamps.length && !(s.chainInfo[u.stamps[u.stamps.length - 1]]?.readonly))
      if (up) {
        const parentSel = { el: up.el, count: 1, info: s.chainInfo[up.stamps[up.stamps.length - 1]] ?? {}, stamp: up.stamps[up.stamps.length - 1] }
        res = await insertNow({ ...op, stamp: parentSel.stamp, where: 'end' }, 'add text', parentSel, { edit: 'New text' })
        if (res && !res.error) toast(`It could not go beside ${labelOfSel(s)}, so it went at the end of ${up.label}.`, 'info', 4500)
      } else toast(res.error.message, 'warn', 6000)
    } else if (res?.error) toast(res.error.message, 'warn', 6000)
    if (res?.el) {
      selectElement(res.el, { scroll: false })
      setTimeout(() => res.el.isConnected && editTextOf(res.el, { all: true }), 60)
    }
  }

  /**
   * Write one new element now, and find it on the page once hot reload has
   * put it there. A page that a build step makes is rebuilt and reloaded in
   * place instead.
   */
  async function insertNow(op, label, anchor, { quiet = false, edit = null } = {}) {
    if (anchor.count > 1) {
      const ok = await ui.ask({ title: `This adds ${anchor.count}`, text: `What is selected is drawn ${anchor.count} times from one line of code, so what is written beside it appears beside every one.`, ok: `Add ${anchor.count}` })
      if (!ok) return null
    }
    const parent = op.where === 'end' ? anchor.el : anchor.el.parentElement
    const before = parent ? [...parent.children] : []
    settingOps.push({ kind: 'insert', ...op, _label: label })
    let res
    try {
      res = await save({ keepSelection: true, label, quiet })
    } finally {
      settingOps.length = 0
    }
    if (res?.error) return res
    if (!res) return null
    if (res.rebuilt?.length && !res.rebuilt.some((r) => !r.ok)) {
      toast('Added. Rebuilding the page to show it...', 'info', 2500)
      // the new words are found again after the reload, and opened for typing there
      if (edit) store.set('afterReload', JSON.stringify({ edit }))
      setTimeout(() => reloadInPlace(), 400)
      return res
    }
    return { ...res, el: await arrival(parent, before, op.where === 'end' ? null : anchor.el) }
  }

  /** The child of `parent` that was not there before: the one right after `anchor` when there are several. */
  function arrival(parent, before, anchor) {
    return new Promise((done) => {
      if (!parent) return done(null)
      const known = new Set(before)
      const look = () => {
        const fresh = [...parent.children].filter((c) => !known.has(c) && !ui.host.contains(c))
        if (!fresh.length) return null
        return (anchor?.isConnected && fresh.find((c) => c.previousElementSibling === anchor)) || fresh[fresh.length - 1]
      }
      const now = look()
      if (now) return done(now)
      const t = setTimeout(() => {
        obs.disconnect()
        done(null)
      }, 5000)
      const obs = new MutationObserver(() => {
        const f = look()
        if (!f) return
        obs.disconnect()
        clearTimeout(t)
        done(f)
      })
      obs.observe(parent, { childList: true })
    })
  }

  /* ================================================================ */
  /*  states: pressed, hovered, focused                                */
  /* ================================================================ */

  /**
   * A KEY HAS MORE THAN ONE LOOK. What it looks like pressed, hovered or
   * focused is written in rules that do not apply while it is selected, so
   * the ordinary Design rows never show them. These are those rules, found
   * by selector, edited where they are written, and shown on demand by
   * copying their declarations onto the element for as long as it is asked.
   */
  let stateList = []
  async function stateStyles() {
    const s = state.sel
    if (!s || s.canvas) return []
    stateList = stateRules(s.el)
    // a longhand that reads empty was written inside a shorthand: ask for the shorthand too, so it is found where it is written
    for (const m of stateList) {
      const extra = []
      for (const p of m.props) {
        if (m.rule.style.getPropertyValue(p).trim()) continue
        const parts = p.split('-')
        for (let n = parts.length - 1; n > 0; n--) extra.push(parts.slice(0, n).join('-'))
      }
      m.props = [...new Set([...m.props, ...extra])]
    }
    await locateRules(stateList)
    return stateList.map((m, i) => {
      const f = located.get(m.rule)?.found?.[0]
      return {
        i,
        states: m.states,
        onAncestor: m.onAncestor,
        selector: m.selector,
        file: f?.file ?? null,
        line: f?.line ?? null,
        rows: [
          ...new Set(
            m.props.map((p) => {
              // a longhand written as part of a shorthand (outline: 2px solid var(--x)) reads empty: the shorthand is what is written
              if (m.rule.style.getPropertyValue(p).trim() || declOf(m, p)) return p
              const parts = p.split('-')
              for (let n = parts.length - 1; n > 0; n--) {
                const sh = parts.slice(0, n).join('-')
                if (declOf(m, sh) || m.rule.style.getPropertyValue(sh).trim()) return sh
              }
              return p
            }),
          ),
        ].map((p) => {
          const decl = declOf(m, p)
          const pending = decl ? declEdits.get(`${decl.file}:${decl.start}`) : null
          const value = pending?.value ?? m.rule.style.getPropertyValue(p).trim()
          return { prop: p, value, rgb: COLORISH.test(p) || /color|shadow|background/.test(p) ? parseColor(value) ?? colorsIn(value)[0]?.rgb ?? null : null, editable: !!decl, file: decl?.file ?? null, line: decl?.line ?? null, edited: !!pending }
        }),
      }
    })
  }
  async function setStateStyle(i, prop, value) {
    const m = stateList[i]
    if (!m || !state.sel) return
    await setDeclOf(m, prop, value, state.sel.el)
    if (unshowState.cur) showState(unshowState.cur.name, true)
  }

  // the state shown on the element now, and what its inline style was before: kept on the function,
  // which exists from the start, since deselect() asks before this part of the file has run
  function unshowState() {
    const cur = unshowState.cur
    if (!cur) return
    for (const [p, v, pri] of cur.prev) cur.el.style.setProperty(p, v, pri)
    if (cur.el.getAttribute('style') === '') cur.el.removeAttribute('style')
    unshowState.cur = null
  }
  function showState(name, on) {
    unshowState()
    const s = state.sel
    if (!on || !s || s.canvas) return renderInspector()
    const props = new Map()
    for (const m of stateList.filter((x) => x.states.includes(name))) for (const p of m.props) props.set(p, m.rule.style.getPropertyValue(p))
    const prev = [...props.keys()].map((p) => [p, s.el.style.getPropertyValue(p), s.el.style.getPropertyPriority(p)])
    for (const [p, v] of props) s.el.style.setProperty(p, v, 'important')
    unshowState.cur = { name, el: s.el, prev }
    renderInspector()
  }

  /* ================================================================ */
  /*  where one colour falls: the outline for a hovered tone           */
  /* ================================================================ */

  const SVGNS = 'http://www.w3.org/2000/svg'
  /** The layer the marks are drawn in, made the first time it is asked for. */
  function toneLayer() {
    if (!toneLayer.el) {
      toneLayer.el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      toneLayer.el.setAttribute('class', 'tones')
      ui.root.append(toneLayer.el)
    }
    return toneLayer.el
  }

  /** Canvas pixels to page pixels, for a drawing's gradient. */
  const canvasToPage = (canvas) => {
    const cr = canvas.getBoundingClientRect()
    const kx = cr.width / (canvas.width || 1)
    const ky = cr.height / (canvas.height || 1)
    return (p) => ({ x: cr.left + p.x * kx, y: cr.top + p.y * ky })
  }

  /**
   * Mark where a colour sits: `{ item, stop }` for a drawing (its gradient
   * at that offset, or the whole drawing for a plain colour), `{ css: true,
   * stop }` for the selection's CSS gradient, `{ el }` for a whole element.
   */
  /** A path through page points: each ring a closed subpath, unless it is an open line. */
  const ringsPath = (rings) => rings.map((r) => 'M' + r.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L') + (r.open ? '' : 'Z')).join(' ')

  /**
   * THE SHAPE ITSELF, as a path on the page: a drawing's own path as it was
   * painted (curves and all, as the recorder flattened them), or an
   * element's box with its own rounded corners. A stroke is its line.
   */
  function shapeOf(spec) {
    if (spec.item) {
      const it = spec.item
      const toPage = canvasToPage(it.canvas)
      const rings = (it.subs ?? []).map((sub) => {
        const pts = []
        for (let i = 0; i + 1 < sub.length; i += 2) pts.push(toPage({ x: sub[i], y: sub[i + 1] }))
        return { pts, open: it.kind === 'stroke' && !sub.closed }
      }).filter((r) => r.pts.length > 1)
      const { k } = scaleFor(it.canvas)
      return { d: ringsPath(rings), stroke: it.kind === 'stroke' ? Math.max(1, (it.lineWidth || 1) / k) : 0, rect: pageRect(it) }
    }
    const el = spec.el ?? state.sel?.el
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const rad = (p) => Math.min(parseFloat(cs[p]) || 0, r.width / 2, r.height / 2)
    const [tl, tr, br, bl] = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'].map(rad)
    const { left: L, top: T, right: R, bottom: B } = r
    const d = `M${L + tl},${T} H${R - tr} A${tr},${tr} 0 0 1 ${R},${T + tr} V${B - br} A${br},${br} 0 0 1 ${R - br},${B} H${L + bl} A${bl},${bl} 0 0 1 ${L},${B - bl} V${T + tl} A${tl},${tl} 0 0 1 ${L + tl},${T} Z`
    return { d, stroke: 0, rect: r }
  }

  /**
   * Mark where a colour sits: `{ item, stop }` for a drawing (the area its
   * gradient gives that stop, or the whole drawing for a plain colour),
   * `{ css: true, stop }` for the selection's CSS gradient, `{ el }` or
   * nothing for a whole element. The area is cut to the SHAPE, not its box:
   * the band's edges are drawn where they cross the shape, and the shape's
   * own outline where it bounds the band, so together they trace exactly
   * the part of the shape that colour paints.
   *
   * For a drawing on a canvas this is the FALLBACK. What is wanted there is
   * the part of the colour that can be seen, and that is found in pixels
   * (`pixelTone`); this runs when the pixels cannot be read or say nothing.
   */
  // which hover is current: kept on the function, which exists before this line runs
  function showTone(spec) {
    clearTone()
    const my = (showTone.n = (showTone.n ?? 0) + 1)
    if (spec.item) {
      // a short wait, so running the pointer down a list of colours works out only the one it stops on
      setTimeout(() => {
        if (my !== showTone.n) return
        pixelTone(spec, my)
          .then((r) => {
            if (my !== showTone.n) return
            // covered everywhere it would be: said so, never drawn as if it showed
            if (r === 'covered') vectorTone(spec, { covered: true })
            else if (!r) vectorTone(spec)
            spec.onResult?.({ visible: r !== 'covered' })
          })
          .catch(() => my === showTone.n && vectorTone(spec))
      }, 50)
      return
    }
    vectorTone(spec)
  }

  function vectorTone(spec, { covered = false } = {}) {
    const shape = shapeOf(spec)
    if (!shape) return
    const rect = shape.rect
    let mark = null
    // the stop asked for, by its offset: the nearest of the gradient's own
    const nearest = (offsets, t) => offsets.reduce((best, o, k) => (Math.abs(o - t) < Math.abs(offsets[best] - t) ? k : best), 0)
    if (spec.item) {
      if (spec.stop != null && spec.item.gradient && spec.item.stops?.length) {
        const offsets = spec.item.stops.map((x) => Number(x[0])).sort((p, q) => p - q)
        mark = canvasToneArea(spec.item.gradient, offsets, nearest(offsets, spec.stop), canvasToPage(spec.item.canvas), rect)
      }
    } else if (spec.css && spec.stop != null) {
      const el = spec.el ?? state.sel?.el
      const g = el && parseCssGradient(getComputedStyle(el).backgroundImage)
      if (g) mark = cssToneArea(g, nearest(g.stops.map((x) => x.at), spec.stop), rect)
    }
    const svg = (tag, attrs) => {
      const n = document.createElementNS(SVGNS, tag)
      for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v)
      return n
    }
    // the masks cover the window and no more: a browser will not paint a mask the size of a city
    const big = { maskUnits: 'userSpaceOnUse', x: -20, y: -20, width: innerWidth + 40, height: innerHeight + 40 }
    // the shape as a mask: its fill, or for a line the line at its own width
    const shapeMask = svg('mask', { id: 'rt-tone-shape', ...big })
    shapeMask.append(shape.stroke ? svg('path', { d: shape.d, fill: 'none', stroke: '#fff', 'stroke-width': shape.stroke + 0.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }) : svg('path', { d: shape.d, fill: '#fff' }))
    const defs = svg('defs', {})
    defs.append(shapeMask)
    const parts = [defs]
    const outline = (d, extra = {}) => ['under', 'over'].map((cls) => svg('path', { class: cls, d, ...extra }))
    if (!mark && !covered) {
      // a plain colour: the whole shape is that colour, so the shape is what is outlined
      if (shape.stroke) parts.push(...['under', 'over'].map((cls) => svg('path', { class: `${cls} line`, d: shape.d, style: `--lw:${shape.stroke}px` })))
      else parts.push(svg('path', { class: 'tint', d: shape.d }), ...outline(shape.d))
    } else if (covered) {
      // where it would be, dashed and untinted, and named as covered: nothing of it can be seen
      const band = mark ? ringsPath(mark.rings.map((pts) => ({ pts }))) : shape.d
      const g = svg('g', { mask: 'url(#rt-tone-shape)' })
      g.append(svg('path', { class: 'covered', d: band, 'fill-rule': 'evenodd' }))
      const pts = mark ? mark.rings.flat() : [{ x: rect.left, y: rect.top }]
      const xs = pts.map((p) => p.x).filter((x) => x >= rect.left && x <= rect.right)
      const ys = pts.map((p) => p.y).filter((y) => y >= rect.top && y <= rect.bottom)
      const tx = Math.max(rect.left, Math.min(...xs, rect.right)) + 8
      const ty = Math.max(rect.top, Math.min(...ys, rect.bottom)) + 18
      const tag = svg('text', { class: 'covtag', x: tx, y: Math.min(ty, innerHeight - 8) })
      tag.textContent = 'Covered here: drawn over by what is on top'
      parts.push(g, tag)
    } else {
      const band = ringsPath(mark.rings.map((pts) => ({ pts })))
      const bandMask = svg('mask', { id: 'rt-tone-band', ...big })
      bandMask.append(svg('path', { d: band, fill: '#fff', 'fill-rule': 'evenodd' }))
      defs.append(bandMask)
      if (shape.stroke) {
        // a line: the stretch of it that carries this colour, drawn over it
        const g = svg('g', { mask: 'url(#rt-tone-band)' })
        g.append(...['under', 'over'].map((cls) => svg('path', { class: `${cls} line`, d: shape.d, style: `--lw:${shape.stroke}px` })))
        parts.push(g)
      } else {
        // the area inside the shape tinted; its edges: the band's inside the shape, the shape's inside the band
        const tint = svg('g', { mask: 'url(#rt-tone-shape)' })
        tint.append(svg('path', { class: 'tint', d: band, 'fill-rule': 'evenodd' }), ...outline(band, { 'fill-rule': 'evenodd' }))
        const rim = svg('g', { mask: 'url(#rt-tone-band)' })
        rim.append(...outline(shape.d))
        parts.push(tint, rim)
      }
      // the rest of the shape, faintly, for where the colour sits in it
      parts.push(svg('path', { class: 'shape', d: shape.d }))
    }
    toneLayer().replaceChildren(...parts)
    toneLayer().style.display = 'block'
  }
  function clearTone() {
    showTone.n = (showTone.n ?? 0) + 1
    if (toneCanvas.el) toneCanvas.el.style.display = 'none'
    if (!toneLayer.el) return
    toneLayer.el.replaceChildren()
    toneLayer.el.style.display = 'none'
  }

  /** The canvas the pixel mark is shown on, made the first time it is asked for. */
  function toneCanvas() {
    if (!toneCanvas.el) {
      toneCanvas.el = document.createElement('canvas')
      toneCanvas.el.className = 'tonecanvas'
      ui.root.append(toneCanvas.el)
    }
    return toneCanvas.el
  }

  const rgbaOf = (text) => {
    const c = parseColor(String(text ?? ''))
    return c ? [c.r, c.g, c.b, (c.a ?? 1) * 255] : null
  }
  const gridCanvas = (w, h) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }

  // the canvas's own pixels, read once per still frame
  let pixelRead = null
  function canvasPixels(canvas) {
    const t = boot.isFrozen?.() ? boot.time?.() : null
    if (pixelRead && pixelRead.canvas === canvas && t != null && pixelRead.t === t) return pixelRead.data
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    pixelRead = { canvas, t, data }
    return data
  }

  /**
   * THE COLOUR WHERE IT CAN BE SEEN (tonemask.js has the rule). Reads the
   * drawing's canvas, rasters its own path and everything painted above the
   * canvas at one cell per page pixel, keeps the cells that are in the
   * stop's band, inside the shape, uncovered and still this drawing's
   * colour, and shows them tinted with a light edge and a dark rim. True
   * when it drew something (or a newer hover took over).
   */
  const toneMasks = new WeakMap()
  async function pixelTone(spec, my) {
    const it = spec.item
    const canvas = it.canvas
    const ctx = canvas.getContext?.('2d')
    if (!ctx || !canvas.width || !canvas.height) return false
    const { r: cr, k } = scaleFor(canvas)
    const bx0 = Math.max(0, Math.floor(it.bbox.x))
    const by0 = Math.max(0, Math.floor(it.bbox.y))
    const w = Math.min(canvas.width, Math.ceil(it.bbox.x + it.bbox.w)) - bx0
    const h = Math.min(canvas.height, Math.ceil(it.bbox.y + it.bbox.h)) - by0
    if (w < 1 || h < 1) return false
    let step = Math.max(1, k)
    while ((w / step) * (h / step) > 1.5e6) step *= 1.5
    const stops = (it.stops ?? []).map(([at, c]) => ({ at: Number(at), rgba: rgbaOf(c) })).filter((x) => x.rgba).sort((p, q) => p.at - q.at)
    const grad = it.gradient && stops.length ? it.gradient : null
    const tAt = grad ? offsetAt(grad) : null
    if (grad && !tAt) return false
    let index = -1
    if (grad && spec.stop != null) index = stops.reduce((best, x, i) => (Math.abs(x.at - spec.stop) < Math.abs(stops[best].at - spec.stop) ? i : best), 0)
    const key = `${index}|${boot.time?.() ?? 0}|${step}`
    let made = toneMasks.get(it)?.get(key)
    if (!made) {
      let inBand = null
      let expected
      if (grad) {
        if (index >= 0) {
          const [lo, hi] = bandOf(stops.map((x) => x.at), index)
          inBand = (x, y) => {
            const t = tAt(x, y)
            return t >= lo && t <= hi
          }
        }
        expected = (x, y) => colorAt(stops, tAt(x, y))
      } else {
        const c = it.kind === 'image' ? null : rgbaOf(it.color)
        expected = () => c
      }
      const translucent = it.kind === 'image' || it.alpha < 0.97 || (grad ? stops.some((x) => x.rgba[3] < 250) : !expected() || expected()[3] < 250)
      let pixels
      try {
        pixels = canvasPixels(canvas)
      } catch {
        return false
      }
      const mw = Math.max(1, Math.ceil(w / step))
      const mh = Math.max(1, Math.ceil(h / step))
      // the drawing's own path, one cell each
      const sc = gridCanvas(mw, mh).getContext('2d')
      sc.setTransform(1 / step, 0, 0, 1 / step, -bx0 / step, -by0 / step)
      const path = new Path2D()
      for (const sub of it.subs ?? []) {
        if (sub.length < 2) continue
        path.moveTo(sub[0], sub[1])
        for (let j = 2; j + 1 < sub.length; j += 2) path.lineTo(sub[j], sub[j + 1])
        if (sub.closed) path.closePath()
      }
      if (it.kind === 'stroke') {
        sc.strokeStyle = '#fff'
        sc.lineWidth = Math.max(1, it.lineWidth || 1)
        sc.lineCap = sc.lineJoin = 'round'
        sc.stroke(path)
      } else {
        sc.fillStyle = '#fff'
        sc.fill(path)
      }
      const shapeData = sc.getImageData(0, 0, mw, mh).data
      const cover = await coverAbove(canvas, cr, k, bx0, by0, step, mw, mh)
      if (my !== showTone.n) return true
      const res = buildMask({
        x0: bx0,
        y0: by0,
        w,
        h,
        step,
        pixels,
        width: canvas.width,
        cover: cover ? (gx, gy) => cover[(gy * mw + gx) * 4 + 3] / 255 : null,
        inShape: (gx, gy) => shapeData[(gy * mw + gx) * 4 + 3] > 100,
        inBand,
        expected,
        compare: !translucent,
      })
      if (res.count < 3) {
        // none of this colour shows. Covered, if the colour test works on this drawing at all - it finds the
        // drawing's other colours somewhere - otherwise the test is what failed, and geometry is the better answer
        const seen = buildMask({ x0: bx0, y0: by0, w, h, step: Math.max(step, Math.sqrt((w * h) / 6000)), pixels, width: canvas.width, expected, compare: !translucent, clean: false })
        return !translucent && seen.count >= 3 ? 'covered' : false
      }
      made = { image: new ImageData(paintMask(res), res.mw, res.mh), bx0, by0, w, h }
      if (!toneMasks.has(it)) toneMasks.set(it, new Map())
      toneMasks.get(it).set(key, made)
    }
    if (my !== showTone.n) return true
    const el = toneCanvas()
    el.width = made.image.width
    el.height = made.image.height
    el.getContext('2d').putImageData(made.image, 0, 0)
    const now = scaleFor(canvas)
    Object.assign(el.style, { display: 'block', left: `${now.r.left + made.bx0 / now.k}px`, top: `${now.r.top + made.by0 / now.k}px`, width: `${made.w / now.k}px`, height: `${made.h / now.k}px` })
    return true
  }

  /**
   * What is painted ABOVE a canvas over a region of it, as one raster at
   * the mask's resolution: other canvases and pictures as they are drawn,
   * an SVG as its own silhouette, a box with a fill as its rounded box.
   * Text is left out: it is not what a colour hides behind. Which things
   * are above is asked of the browser's own stacking, with every element
   * made hit-testable for the question; null when nothing is.
   */
  async function coverAbove(canvas, cr, k, bx0, by0, step, mw, mh) {
    const region = { left: cr.left + bx0 / k, top: cr.top + by0 / k }
    region.right = region.left + (mw * step) / k
    region.bottom = region.top + (mh * step) / k
    const cands = []
    for (const el of document.body.querySelectorAll('*')) {
      if (el === canvas || el.contains(canvas) || ui.host.contains(el) || el instanceof SVGElement && el.ownerSVGElement) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1 || r.right < region.left || r.left > region.right || r.bottom < region.top || r.top > region.bottom) continue
      let kind = null
      if (el.tagName === 'CANVAS') kind = 'canvas'
      else if (el.tagName === 'IMG' || el.tagName === 'VIDEO') kind = 'image'
      else if (el.tagName.toLowerCase() === 'svg') kind = 'svg'
      else {
        const cs = getComputedStyle(el)
        const bg = parseColor(cs.backgroundColor)
        if ((bg && bg.a > 0.85) || cs.backgroundImage !== 'none') kind = 'box'
      }
      if (!kind) continue
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
      cands.push({ el, r, kind })
    }
    if (!cands.length) return null
    const above = stackingProbe(() =>
      cands.filter((c) => {
        const L = Math.max(c.r.left, region.left, 0)
        const T = Math.max(c.r.top, region.top, 0)
        const R = Math.min(c.r.right, region.right, innerWidth - 1)
        const B = Math.min(c.r.bottom, region.bottom, innerHeight - 1)
        if (R <= L || B <= T) return false
        for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
          const stack = document.elementsFromPoint(L + (R - L) * fx, T + (B - T) * fy)
          const iE = stack.findIndex((e) => e === c.el || c.el.contains(e))
          if (iE < 0) continue
          const iC = stack.indexOf(canvas)
          return iC < 0 || iE < iC
        }
        return false
      }),
    )
    if (!above.length) return null
    const o = gridCanvas(mw, mh).getContext('2d')
    const sx = k / step
    o.setTransform(sx, 0, 0, sx, -region.left * sx, -region.top * sx)
    o.fillStyle = '#000'
    for (const c of above) {
      const r = c.r
      try {
        if (c.kind === 'canvas') o.drawImage(c.el, r.left, r.top, r.width, r.height)
        else if (c.kind === 'image') {
          const src = c.el.currentSrc || c.el.src || ''
          // a picture from elsewhere would make the raster unreadable: its box stands in for it
          if (src && new URL(src, location.href).origin !== location.origin) o.fillRect(r.left, r.top, r.width, r.height)
          else o.drawImage(c.el, r.left, r.top, r.width, r.height)
        } else if (c.kind === 'svg') {
          const img = await svgSilhouette(c.el)
          if (img) o.drawImage(img, r.left, r.top, r.width, r.height)
        } else {
          const rad = Math.min(parseFloat(getComputedStyle(c.el).borderTopLeftRadius) || 0, r.width / 2, r.height / 2)
          o.beginPath()
          if (o.roundRect) o.roundRect(r.left, r.top, r.width, r.height, rad)
          else o.rect(r.left, r.top, r.width, r.height)
          o.fill()
        }
      } catch {}
    }
    try {
      return o.getImageData(0, 0, mw, mh).data
    } catch {
      return null
    }
  }

  /** The browser's stacking, asked with every element hit-testable: pointer-events: none is how pages layer art. */
  function stackingProbe(fn) {
    const st = document.createElement('style')
    st.textContent = '*,*::before,*::after{pointer-events:auto!important}'
    document.head.append(st)
    try {
      return passThrough(fn)
    } finally {
      st.remove()
    }
  }

  /**
   * An SVG's silhouette as a picture: a copy with every element's computed
   * paint written onto it (the page's stylesheets do not travel with a
   * copy), loaded as an image. Kept per element and size.
   */
  const silhouettes = new WeakMap()
  async function svgSilhouette(svgEl) {
    const r = svgEl.getBoundingClientRect()
    const key = `${Math.round(r.width)}x${Math.round(r.height)}`
    const hit = silhouettes.get(svgEl)
    if (hit?.key === key) return hit.img
    const copy = svgEl.cloneNode(true)
    const from = [svgEl, ...svgEl.querySelectorAll('*')]
    const to = [copy, ...copy.querySelectorAll('*')]
    from.forEach((el, i) => {
      const cs = getComputedStyle(el)
      for (const p of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'display', 'visibility']) {
        const v = cs.getPropertyValue(p)
        if (v) to[i].setAttribute(p, v)
      }
    })
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    copy.setAttribute('width', String(r.width))
    copy.setAttribute('height', String(r.height))
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }))
    const img = new Image()
    img.src = url
    try {
      await img.decode()
    } catch {
      URL.revokeObjectURL(url)
      return null
    }
    URL.revokeObjectURL(url)
    silhouettes.set(svgEl, { key, img })
    return img
  }

  /** The selection's CSS gradient, as Properties lists it. */
  function gradientOfSel() {
    const s = state.sel
    if (!s || s.canvas) return null
    const g = parseCssGradient(getComputedStyle(s.el).backgroundImage)
    if (!g) return null
    return { ...g, stops: g.stops.map((x) => ({ ...x, rgb: parseColor(x.text) })).filter((x) => x.rgb) }
  }

  /* ================================================================ */
  /*  words, from the panel                                            */
  /* ================================================================ */

  /**
   * New words for the selection, typed into Properties. Only what changed is
   * written: the comparison is made on the words as they read (runs of
   * spaces and line breaks as one space), and mapped back onto the text as
   * it is written, so a source file's own line breaks and every styled span
   * around the change stay as they were.
   */
  function rewriteWords(old, next) {
    const norm = []
    const map = []
    let lastSpace = true
    for (let i = 0; i < old.length; i++) {
      const sp = /\s/.test(old[i])
      if (sp && lastSpace) continue
      norm.push(sp ? ' ' : old[i])
      map.push(i)
      lastSpace = sp
    }
    while (norm.length && norm[norm.length - 1] === ' ') {
      norm.pop()
      map.pop()
    }
    const a = norm.join('')
    const b = next.replace(/\s+/g, ' ').trim()
    if (a === b) return old
    let p = 0
    while (p < a.length && p < b.length && a[p] === b[p]) p++
    let s = 0
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
    const from = p < map.length ? map[p] : old.replace(/\s+$/, '').length
    const to = a.length - s > 0 ? (a.length - s < map.length ? map[a.length - s] : old.replace(/\s+$/, '').length) : 0
    return old.slice(0, from) + b.slice(p, b.length - s) + old.slice(Math.max(from, to))
  }

  async function setWords(next) {
    const s = state.sel
    if (!s || s.canvas) return
    const nodes = textNodes(s.el)
    const old = nodes.map((n) => n.data).join('')
    const target = rewriteWords(old, String(next ?? ''))
    if (target === old) return
    const changes = applyText(nodes, target)
    if (changes.length && (await onTextCommit(s.el, changes)) === false) for (const c of changes) c.node.data = c.before
    renderInspector()
  }

  /* ================================================================ */
  /*  drawings on a canvas                                             */
  /* ================================================================ */

  const recorder = createCanvasRecorder(boot, realRaf)
  let drawings = { at: 0, frames: new Map(), stacks: false, time: null }
  let capturing = null
  let canvasSeq = 0

  /** What every canvas drew in its latest frame: recorded again once it may have moved on. */
  async function drawingsNow({ stacks = false, fresh = false } = {}) {
    const frozen = !!boot.isFrozen?.()
    const time = boot.time?.()
    const stale = fresh || (stacks && !drawings.stacks) || (frozen ? time !== drawings.time : Date.now() - drawings.at > 600)
    if (!stale) return drawings.frames
    if (!capturing) {
      capturing = recorder.capture({ stacks }).then((frames) => {
        drawings = { at: Date.now(), frames, stacks, time: boot.time?.() }
        capturing = null
        return frames
      })
    }
    return capturing
  }
  const groundOf = (it) => it.bbox.w * it.bbox.h >= it.canvas.width * it.canvas.height * 0.85

  /**
   * What is under the pointer, looking through canvases where they are
   * clear: a drawing when a canvas has one there, otherwise the first
   * element that draws. A canvas's full-size ground is offered only when
   * nothing on it or under it is.
   */
  /**
   * THE DRAWING WHOSE COLOUR IS SHOWING comes first. Pages pre-render
   * layers into a canvas off screen and stamp the picture over everything
   * each frame - a sky with its dawn glow, say - so the top drawing at a
   * point is often that picture, which carries no colours of its own. Where
   * the canvas shows exactly the colour a drawing under it paints there,
   * that drawing is what a person is pointing at.
   */
  function showingFirst(hits, canvas, x, y) {
    if (hits.length < 2) return hits
    const px = pixelOf(canvas, x, y)
    if (!px) return hits
    const { r, k } = scaleFor(canvas)
    const cx = (x - r.left) * k
    const cy = (y - r.top) * k
    const shows = (it) => {
      if (it.kind === 'image') return false
      let want = null
      if (it.gradient && it.stops?.length) {
        const stops = it.stops.map(([at, c]) => ({ at: Number(at), rgba: rgbaOf(c) })).filter((s) => s.rgba).sort((p, q) => p.at - q.at)
        const tAt = stops.length ? offsetAt(it.gradient) : null
        want = tAt ? colorAt(stops, tAt(cx, cy)) : null
      } else want = rgbaOf(it.color)
      return !!want && Math.abs(want[0] - px.r) <= 10 && Math.abs(want[1] - px.g) <= 10 && Math.abs(want[2] - px.b) <= 10
    }
    const first = hits.findIndex(shows)
    return first > 0 ? [hits[first], ...hits.slice(0, first), ...hits.slice(first + 1)] : hits
  }

  async function resolveHit(stack, x, y) {
    const hasCanvas = stack.some((e) => e.tagName === 'CANVAS')
    const frames = hasCanvas ? await drawingsNow() : null
    let ground = null
    for (const el of stack) {
      if (el.tagName === 'CANVAS') {
        const hits = showingFirst(itemsAt(frames?.get(el) ?? [], x, y), el, x, y)
        const solid = hits.filter((i) => !groundOf(i))
        if (solid.length) return { drawings: solid }
        if (hits.length && !ground) ground = hits
        const px = pixelOf(el, x, y)
        if (px && px.a > 0.02 && !hits.length) return { el }
        continue
      }
      if (drawsAt(el, x, y)) return ground && !REPLACED.test(el.tagName) && el.getBoundingClientRect().width >= innerWidth * 0.9 ? { drawings: ground } : { el }
    }
    return ground ? { drawings: ground } : { el: visibleHit(stack, x, y) }
  }

  /**
   * Select one drawing. The page is frozen first - a drawing that moves on
   * every frame cannot be looked at, let alone compared with its code - and
   * the frame is recorded once more with stacks, so the drawing knows the
   * line that drew it and which others that same line drew.
   */
  async function selectCanvasItem(item) {
    await holdStill('Froze the page so the drawing holds still. Play it again from Motion, or the timeline.')
    const frames = await drawingsNow({ stacks: true, fresh: !drawings.stacks })
    const list = frames.get(item.canvas) ?? []
    const it = list.includes(item) ? item : findAgain(item, list) ?? item
    const site = siteOf(it, boot.tool)
    const group = site ? list.filter((o) => siteOf(o, boot.tool)?.key === site.key) : [it]
    const stamp = `drawing:${++canvasSeq}`
    const name = itemName(it)
    infoCache.set(stamp, {
      stamp,
      base: stamp,
      readonly: true,
      drawing: true,
      why: 'Drawn on a canvas by a script. Its colour can be changed where it is written, and its size and shape in the code that draws it (Settings).',
      file: null,
      name,
      strategies: { transform: { kind: 'none' }, delete: { kind: 'none' }, color: { kind: 'none' } },
    })
    const unit = { el: it.canvas, stamps: [stamp], names: [name], label: name, tag: 'canvas', svg: false, propsByStamp: {}, foreign: true, canvasItem: it }
    let base
    try {
      base = await chainFor(it.canvas)
    } catch {
      base = { chain: [], info: {}, counts: new Map() }
    }
    select(unit, stamp, { chain: [unit, ...base.chain], info: { ...base.info, [stamp]: infoCache.get(stamp) }, counts: base.counts, hit: it.canvas })
    const sel = state.sel
    if (!sel) return
    sel.canvas = { item: it, group, site, where: null, chain: [], at: 0, showGroup: false }
    renderSelection()
    position()
    if (site) {
      // the whole call chain, each frame mapped to the line written: the helper that drew it, and what called it
      try {
        const { frames: mapped } = await api.post('/trace/frames', { frames: site.frames.map((f, i) => ({ key: String(i), url: f.url, line: f.line, col: f.col })) })
        if (state.sel === sel) {
          sel.canvas.chain = site.frames.map((f, i) => (mapped[String(i)] ? { ...mapped[String(i)], name: mapped[String(i)].fn ?? f.name } : null)).filter(Boolean)
          sel.canvas.where = sel.canvas.chain[0] ?? null
        }
      } catch {}
    }
    renderInspector()
  }

  /** The drawing's colours, each searchable where it is written. */
  function drawingColors(it) {
    const out = []
    if (it.color && it.color !== 'gradient' && it.color !== 'pattern') {
      const rgb = parseColor(it.color)
      if (rgb) out.push({ label: it.kind === 'stroke' ? 'Line' : 'Fill', rgb, text: it.color })
    }
    for (const [off, c] of it.stops ?? []) {
      const rgb = parseColor(String(c))
      if (rgb) out.push({ label: `Gradient at ${Math.round(off * 100)}%`, stop: off, rgb, text: String(c) })
    }
    return out
  }

  /* ================================================================ */
  /*  everything under the pointer: the right-click list               */
  /* ================================================================ */

  async function openStackMenu(x, y) {
    const inBoxAt = (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    // a right-click acts on what is under it: that is selected first, unless it is what is selected already
    if (!state.group && !(state.sel && inBoxAt(selRect(state.sel)))) await selectAt(x, y)
    const stack = pageStack(x, y)
    const frames = stack.some((e) => e.tagName === 'CANVAS') ? await drawingsNow() : null
    const rows = []
    // words the hit test cannot see (pointer-events: none) are still here, and first
    const words = textAt(x, y)
    const wordsBlock = words ? textBlockOf(words.node) ?? words.el : null
    if (wordsBlock && !stack.includes(wordsBlock)) {
      const u = unitFor(wordsBlock)
      rows.push({ el: wordsBlock, label: u.stamps.length ? u.label : labelOf(wordsBlock), kind: u.stamps.length || fiberOf(wordsBlock) ? 'jsx' : 'str', sub: 'the words here' })
    }
    for (const el of stack) {
      if (el.tagName === 'CANVAS') for (const it of itemsAt(frames?.get(el) ?? [], x, y).slice(0, 8)) rows.push({ item: it, label: itemName(it), kind: 'drawing', sub: `on ${labelOf(el)}` })
      const u = unitFor(el)
      rows.push({ el, label: u.stamps.length ? u.label : labelOf(el), kind: u.stamps.length ? 'jsx' : fiberOf(el) ? 'jsx' : 'str', sub: u.stamps.length && u.label !== el.tagName.toLowerCase() ? labelOf(el) : '' })
      if (rows.length >= 18) break
    }
    const m = ui.stackMenu
    const s = state.sel
    const act = (label, keys, fn, on = true) =>
      h(
        'button',
        {
          class: `act${on ? '' : ' off'}`,
          onclick: () => {
            m.style.display = 'none'
            if (on) fn()
          },
        },
        h('span', { class: 'nm', text: label }),
        keys ? h('kbd', { text: keys }) : null,
      )
    const acts =
      s && !s.canvas && !state.group
        ? [
            act('Add text', 'T', () => addText(), !s.info.readonly),
            words ? act('Edit text', 'Enter', () => editTextAt(x, y)) : null,
            act('Copy', 'Ctrl C', () => copySelection(), !s.info.readonly),
            act('Cut', 'Ctrl X', () => copySelection({ cut: true }), !s.info.readonly),
            act(copied ? `Paste ${copied.label} after it` : 'Paste', 'Ctrl V', () => pasteAfter(), !!copied && !s.info.readonly),
            act('Duplicate', 'Ctrl D', () => duplicate(), !s.info.readonly),
            act('Copy style', 'Ctrl Alt C', () => copyStyle()),
            act(copiedStyle ? `Paste the style of ${copiedStyle.from}` : 'Paste style', 'Ctrl Alt V', () => pasteStyle(), !!copiedStyle),
          ].filter(Boolean)
        : []
    m.replaceChildren(
      ...(acts.length ? [h('h6', { text: s ? labelOfSel(s) : 'Here' }), ...acts] : []),
      h('h6', { text: 'Everything here, top first' }),
      ...rows.map((r) =>
        h(
          'button',
          {
            class: `srow ${r.kind}`,
            onpointerenter: () => ctl.hover(r.el ?? null, r.item),
            onpointerleave: () => ctl.hover(null),
            onclick: () => {
              m.style.display = 'none'
              ctl.hover(null)
              if (r.item) selectCanvasItem(r.item)
              else selectElement(r.el, { exact: true, scroll: false })
            },
          },
          h('i'),
          h('span', { class: 'nm', text: r.label }),
          r.sub ? h('span', { class: 'sb', text: r.sub }) : null,
        ),
      ),
    )
    m.style.display = 'block'
    m.style.left = `${Math.max(4, Math.min(innerWidth - 270, x + 6))}px`
    m.style.top = `${Math.max(4, Math.min(innerHeight - Math.min(560, 60 + (rows.length + acts.length) * 29), y + 6))}px`
  }

  /* ================================================================ */
  /*  search                                                           */
  /* ================================================================ */

  let fileIds = null
  async function filesById() {
    if (!fileIds) {
      try {
        fileIds = (await api.get('/files')).files
      } catch {
        fileIds = {}
      }
    }
    return fileIds
  }
  filesById()

  const ACTIONS = [
    { label: 'Save to source', keys: 'save write', key: 'Ctrl S', run: () => save() },
    { label: 'Undo', keys: 'undo back', key: 'Ctrl Z', run: () => undo() },
    { label: 'Redo', keys: 'redo', key: 'Ctrl Shift Z', run: () => redo() },
    { label: 'Pick a colour off the page', keys: 'pick colour color eyedropper pipette', key: 'I', run: () => togglePick() },
    { label: 'Freeze motion', keys: 'freeze pause stop animation motion', run: () => setFrozen(true) },
    { label: 'Play motion', keys: 'play resume unfreeze animation motion', run: () => setFrozen(false) },
    { label: 'Step one frame', keys: 'step frame next', run: () => ctl.step() },
    { label: 'Slow motion: quarter speed', keys: 'slow motion speed quarter', run: () => setSpeed(0.25) },
    { label: 'Normal speed', keys: 'normal speed real', run: () => setSpeed(1) },
    { label: 'Snapping on or off', keys: 'snap guides magnet', run: () => setSnap(!state.snap) },
    { label: 'View mode: use the page', keys: 'view mode browse use links', run: () => setMode('view') },
    { label: 'Edit mode', keys: 'edit mode select', run: () => setMode('edit') },
    { label: 'Reload the page', keys: 'reload refresh', run: () => reloadInPlace() },
  ]

  /**
   * Find things on the page by what they say, what they are called, or the
   * file they are written in; colours by value; and the editor's own
   * commands. Results carry the element, so the panel can show it as it
   * is hovered and select it when chosen.
   */
  async function search(q) {
    q = String(q ?? '').trim()
    const lower = q.toLowerCase()
    const groups = []
    if (!q) return groups
    const words = lower.split(/\s+/).filter(Boolean)
    const matches = (s) => {
      const t = s.toLowerCase()
      return words.every((w) => t.includes(w))
    }
    // the words on the page
    const textHits = []
    const seen = new Set()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n && textHits.length < 40; n = walker.nextNode()) {
      if (!n.data.trim() || ui.host.contains(n.parentElement) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement?.tagName)) continue
      const block = blockFor(n)
      if (!block || seen.has(block)) continue
      const text = (block.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (!matches(text)) continue
      seen.add(block)
      const i = text.toLowerCase().indexOf(words[0])
      const s = Math.max(0, i - 32)
      textHits.push({ el: block, label: labelOf(block), snippet: (s ? '...' : '') + text.slice(s, i + 90) + (i + 90 < text.length ? '...' : ''), mark: q, kind: 'text' })
    }
    if (textHits.length) groups.push({ title: 'Words on the page', items: textHits })
    // elements by what they are called
    const els = []
    for (const el of document.body.querySelectorAll('*')) {
      if (ui.host.contains(el) || /^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue
      const u = unitFor(el)
      const name = `${u.stamps.length ? u.label : ''} ${labelOf(el)} ${typeof el.className === 'string' ? el.className : ''} ${el.id}`
      if (!matches(name)) continue
      els.push({ el, label: u.stamps.length && u.label !== el.tagName.toLowerCase() ? u.label : labelOf(el), sub: labelOf(el), kind: u.stamps.length ? 'jsx' : fiberOf(el) ? 'jsx' : 'str' })
      if (els.length >= 30) break
    }
    if (els.length) groups.push({ title: 'Elements', items: els })
    // what each file puts on this page
    const ids = await filesById()
    const files = Object.entries(ids).filter(([, rel]) => matches(rel)).slice(0, 6)
    for (const [pid, rel] of files) {
      const on = [...document.querySelectorAll(`[data-rt^="${pid}."]`)].filter((e) => !ui.host.contains(e))
      if (!on.length) continue
      groups.push({ title: `From ${rel} (${on.length})`, file: rel, items: on.slice(0, 12).map((el) => ({ el, label: unitFor(el).label ?? labelOf(el), sub: labelOf(el), kind: 'jsx' })) })
    }
    // a colour: where it is written
    const rgb = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\()/i.test(q) ? parseColor(q) : null
    if (rgb) groups.unshift({ title: 'Colour', items: [{ kind: 'color', label: `Where ${q} is written`, rgb, run: () => onPicked({ rgb, source: 'search', prop: null, el: null, what: `a search for ${q}` }) }] })
    const acts = ACTIONS.filter((a) => matches(`${a.label} ${a.keys}`)).map((a) => ({ ...a, kind: 'action' }))
    if (acts.length) groups.push({ title: 'Commands', items: acts })
    return groups
  }

  /* ================================================================ */
  /*  settings: the values in code that decide how the selection works */
  /* ================================================================ */

  let settingsCache = new WeakMap()
  async function settingsData() {
    const sel = state.sel
    if (!sel) return []
    const key = sel.canvas ? sel.canvas.item : sel.el
    const frame = sel.canvas?.chain?.[sel.canvas.at] ?? sel.canvas?.where
    const cacheKey = `${sel.stamp}:${frame?.file}:${frame?.line}`
    if (settingsCache.has(key) && settingsCache.get(key).stamp === cacheKey) return settingsCache.get(key).data
    // its own stamps, then the component usages above it in React's tree: a bar's header shows the <Bar> it is in
    const own = sel.canvas ? [] : sel.unit.stamps.slice().reverse().filter((s) => !s.startsWith('none:') && !s.startsWith('drawing:'))
    const above = []
    if (!sel.canvas) {
      for (let f = fiberOf(sel.el)?.return; f && above.length < 2; f = f.return) {
        const s = typeof f.type === 'function' || typeof f.type === 'object' ? f.memoizedProps?.['data-rt'] : null
        if (typeof s === 'string' && !own.includes(s) && !above.includes(s)) above.push(s)
      }
    }
    const stamps = [...above, ...own]
    const at = frame?.file ? { file: frame.file, line: frame.line } : null
    if (!stamps.length && !at) return []
    try {
      const { settings } = await api.post('/settings', { stamps, at })
      settingsCache.set(key, { stamp: cacheKey, data: settings })
      return settings
    } catch (e) {
      return [{ error: e.message, groups: [] }]
    }
  }

  /**
   * A setting is code, which cannot be previewed: it is saved at once (with
   * any unsaved edits, so the history stays one line), and the page shows
   * it through hot reload - or, for code a build step bundles, by reloading
   * in place.
   */
  async function setSetting(it, value) {
    const op = it.add
      ? { kind: 'prop', stamp: it.add.stamp, name: it.add.name, value, type: it.kind, _label: `${it.add.name} on <${it.add.name}>` }
      : { kind: 'literal', target: it.target, value, type: it.kind, _label: `${it.label} to ${value}` }
    settingOps.push(op)
    const keep = state.sel
    const res = await save({ keepSelection: true, label: `setting ${it.label}` })
    settingOps.length = 0
    settingsCache = new WeakMap()
    if (res?.rebuilt?.length && !res.rebuilt.some((r) => !r.ok)) {
      toast('Rebuilt. Reloading in place to show it...', 'info', 2000)
      setTimeout(() => reloadInPlace(), 400)
    } else if (keep && keep === state.sel) renderInspector()
  }
  const settingOps = []

  /* ================================================================ */
  /*  keyframes: CSS animations, frame by frame                        */
  /* ================================================================ */

  function keyframesRule(name) {
    let found = null
    const visit = (rules) => {
      for (const r of rules) {
        if (found) return
        if (typeof CSSKeyframesRule !== 'undefined' && r instanceof CSSKeyframesRule && r.name === name) found = r
        else if (r.cssRules) {
          try {
            visit(r.cssRules)
          } catch {}
        }
      }
    }
    for (const s of document.styleSheets) {
      try {
        visit(s.cssRules)
      } catch {}
    }
    return found
  }

  /** Every keyframe of every CSS animation on the selection, with where each declaration is written. */
  async function keyframesData() {
    const sel = state.sel
    if (!sel || sel.canvas) return []
    const out = []
    for (const a of animationsOf(sel.el, false).filter((x) => x.kind === 'css').slice(0, 4)) {
      const rule = keyframesRule(a.name)
      if (!rule) continue
      const frames = [...rule.cssRules].map((k) => ({ rule: k, keyText: k.keyText, offsets: k.keyText.split(',').map((t) => parseFloat(t) / 100), props: [...k.style].map((p) => [p, k.style.getPropertyValue(p)]) }))
      let located = {}
      try {
        located = (await api.post('/trace/rules', { rules: frames.map((f, i) => ({ key: String(i), chain: [f.keyText], keyframes: a.name, sheet: rule.parentStyleSheet ? sheetIdOf(rule.parentStyleSheet) : null, props: f.props.map(([p]) => p) })) })).rules
      } catch {}
      frames.forEach((f, i) => (f.where = located[String(i)]?.found?.[0] ?? null))
      const timing = a.anim.effect?.getComputedTiming?.() ?? {}
      out.push({ name: a.name, anim: a.anim, duration: timing.duration, delay: timing.delay, easing: a.anim.effect?.getTiming?.().easing, iterations: timing.iterations, frames, progress: timing.progress ?? 0 })
    }
    return out
  }
  const sheetIdOf = (sheet) => sheet?.ownerNode?.getAttribute?.('data-vite-dev-id') || sheet?.href || null

  /** One declaration of one keyframe, changed: shown at once, saved with the rest. */
  function setKeyframe(frame, prop, value) {
    const d = frame.where?.decls?.[prop]
    const was = frame.rule.style.getPropertyValue(prop)
    if (value && !CSS.supports(prop, value)) return toast(`"${value}" is not a value ${prop} accepts.`, 'warn', 4000)
    if (!d) {
      frame.rule.style.setProperty(prop, value)
      return toast('Shown, but this keyframe is not in a file Retouch can edit, so it cannot be saved.', 'warn', 5000)
    }
    const imp = /\s*!important\s*$/i.exec(d.value)
    const text = imp ? d.value.slice(0, imp.index) : d.value
    const key = `${frame.where.file}:${d.start}`
    const before = declEdits.get(key) ?? null
    const after = { target: { file: frame.where.file, start: d.start, end: d.start + text.length, text }, value, was: before?.was ?? was, rule: frame.rule, prop, pri: '', label: `${prop} at ${frame.keyText}`, el: state.sel?.el }
    const apply = (e) => frame.rule.style.setProperty(prop, e ? e.value : after.was)
    declEdits.set(key, after)
    apply(after)
    history.push({
      kind: 'decl',
      label: after.label,
      undo: () => {
        if (before) declEdits.set(key, before)
        else declEdits.delete(key)
        apply(before)
      },
      redo: () => {
        declEdits.set(key, after)
        apply(after)
      },
    })
    renderBar()
    renderInspector()
  }

  /* ================================================================ */
  /*  reload, keeping the place                                        */
  /* ================================================================ */

  const pathOf = (el) => {
    const parts = []
    for (let e = el; e && e !== document.body && parts.length < 12; e = e.parentElement) {
      const i = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0
      parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${i + 1})`)
    }
    return parts.join('>')
  }
  /** Reload, then scroll everything back to where it was: a scene-by-scene page comes back on the same scene. */
  function reloadInPlace() {
    const scrolls = [{ path: '', x: scrollX, y: scrollY }]
    for (const el of document.querySelectorAll('*')) {
      if (ui.host.contains(el)) continue
      if (el.scrollTop > 0 || el.scrollLeft > 0) scrolls.push({ path: pathOf(el), x: el.scrollLeft, y: el.scrollTop })
      if (scrolls.length > 20) break
    }
    store.set('scrolls', JSON.stringify(scrolls))
    location.reload()
  }
  function restoreScrolls() {
    let saved
    try {
      saved = JSON.parse(store.get('scrolls') ?? 'null')
    } catch {}
    if (!saved) return
    store.set('scrolls', '')
    const until = Date.now() + 4000
    const tryNow = () => {
      let left = 0
      for (const s of saved) {
        if (s.done) continue
        const el = s.path ? document.querySelector(`body>${s.path}`) : null
        if (!s.path) {
          window.scrollTo(s.x, s.y)
          if (Math.abs(scrollY - s.y) < 2) s.done = true
        } else if (el && el.scrollHeight > s.y) {
          el.scrollLeft = s.x
          el.scrollTop = s.y
          if (Math.abs(el.scrollTop - s.y) < 2) s.done = true
        }
        if (!s.done) left++
      }
      if (left && Date.now() < until) setTimeout(tryNow, 120)
    }
    setTimeout(tryNow, 60)
  }
  restoreScrolls()
  // new words written into a page a build step makes: found again once it has reloaded, and opened for typing
  try {
    const after = JSON.parse(store.get('afterReload') || 'null')
    store.set('afterReload', '')
    if (after?.edit) {
      setTimeout(() => {
        const el = [...document.body.querySelectorAll('*')].reverse().find((e) => !ui.host.contains(e) && !e.children.length && (e.textContent ?? '').trim() === after.edit)
        if (el && state.mode === 'edit') Promise.resolve(selectElement(el, { scroll: true })).then(() => el.isConnected && editTextOf(el, { all: true }))
      }, 900)
    }
  } catch {}

  /* ================================================================ */
  /*  the editor, for the panels                                       */
  /* ================================================================ */

  /** The studio: this page in a frame, with layers and properties beside it. */
  async function goStudio() {
    if (embedded) return
    if (!(await readyToLeave())) return
    location.href = `/__retouch/studio?path=${encodeURIComponent(location.pathname + location.search + location.hash)}`
  }

  /** Open a project file at a line, in whatever editor Vite finds running (or LAUNCH_EDITOR names). */
  function openInEditor(file, line = 1, col = 1) {
    if (!file) return
    const root = String(state.config.root ?? '').replace(/\/$/, '')
    const abs = /^([a-z]:)?\//i.test(file) ? file : `${root}/${file}`
    fetch(`/__open-in-editor?file=${encodeURIComponent(`${abs}:${line || 1}:${col || 1}`)}`).catch(() => {})
    toast(`Opening ${file}:${line || 1}`, 'info', 1600)
  }

  async function findColorFor(rgb, prop) {
    const el = state.sel?.el
    const hints = { vars: [], selectors: [] }
    if (el) {
      try {
        hints.vars = varsFor(el, rgb)
        hints.selectors = matchedRules(el)
          .filter((m) => m.props.includes(prop) || (SHORTHAND[prop] && m.props.includes(SHORTHAND[prop])))
          .map((m) => m.selector)
      } catch {}
    }
    try {
      return (await api.post('/color/find', { rgb, hints })).candidates
    } catch (e) {
      toast(e.message, 'err')
      return []
    }
  }

  const ctl = {
    events,
    embedded,
    get state() {
      return state
    },
    config: () => state.config,
    // what the panels show
    selection: selectionSummary,
    version: () => inspectorVersion,
    picked: () => state.picked,
    transformState: () => transformState(),
    setTransform,
    styles: styleInfo,
    previewStyle,
    setStyle,
    scopeOf,
    setScope,
    openColor: (prop) => openColor(prop),
    findColor: findColorFor,
    recolor: (c) => recolor(c),
    colorPickedElement: () => {
      const p = state.picked
      if (p) openColor(p.prop?.startsWith('border') ? 'border-color' : p.prop, p.rgb)
    },
    clearPicked: () => {
      state.picked = null
      renderInspector()
    },
    startPick: () => togglePick(),
    isPicking: () => !!picker?.active,
    copy: (t) =>
      navigator.clipboard?.writeText(t).then(
        () => toast(`Copied ${t}`, 'ok', 1500),
        () => toast('The clipboard is not available here.', 'warn'),
      ),
    trace: traceData,
    motion: motionData,
    rewatch: () => {
      if (state.sel) motionCache.delete(state.sel.el)
      renderInspector()
    },
    seekAnimation: (i, ms) => {
      const a = state.anims[i]?.anim
      try {
        a?.pause()
        if (a) a.currentTime = ms
      } catch {}
    },
    toggleAnimation: (i) => {
      const a = state.anims[i]?.anim
      try {
        if (a?.playState === 'running') a.pause()
        else a?.play()
      } catch {}
      renderInspector()
    },
    speedState: () => ({ frozen: !!boot.isFrozen?.(), speed: boot.speed?.() ?? 1 }),
    setSpeed,
    setFrozen: (on) => {
      setFrozen(on)
      renderInspector()
    },
    step: () => {
      boot.step?.()
      renderBar()
      renderInspector()
    },
    // actions on the selection
    editText: () => {
      if (state.sel) editTextOf(state.sel.el)
    },
    flip: (axis) => flip(axis),
    remove: () => remove(),
    reset: () => {
      const rec = state.sel && recs.get(state.sel.el)
      if (rec) resetRec(rec)
    },
    selectParent,
    openLink: () => {
      const l = state.sel && linkOf(state.sel.el)
      if (l) go(l.href, l)
    },
    open: openInEditor,
    selectElement: (el, opts) => selectElement(el, { exact: true, ...opts }),
    selected: () => state.sel?.el ?? state.group?.members[0]?.el ?? null,
    selectedAll: () => (state.group ? state.group.members.map((m) => m.el) : state.sel ? [state.sel.el] : []),
    // several at once
    group: () => {
      if (!state.group) return null
      const ms = state.group.members
      const isStuck = (m) => !m.drawing && (!!m.info?.readonly || m.count > 1)
      const r = groupRect()
      // every colour the drawings use, once each, with how many use it: one "Where?" covers them all
      const colors = new Map()
      for (const m of ms) {
        if (!m.drawing) continue
        for (const c of drawingColors(m.drawing)) {
          const key = `${c.text}|${c.label.startsWith('Gradient') ? 'g' : c.label}`
          if (colors.has(key)) colors.get(key).count++
          else colors.set(key, { ...c, count: 1 })
        }
      }
      return {
        count: ms.length,
        drawings: ms.filter((m) => m.drawing).length,
        movable: ms.filter((m) => !m.drawing && !isStuck(m)).length,
        stuck: ms.filter(isStuck).length,
        width: Math.round(r.width),
        height: Math.round(r.height),
        colors: [...colors.values()].sort((a, b) => b.count - a.count).slice(0, 12),
        members: ms.map((m, i) => ({
          i,
          label: m.drawing ? itemName(m.drawing) : m.unit.names[m.unit.stamps.indexOf(m.stamp)] ?? m.unit.label,
          drawing: m.drawing ? { item: m.drawing, colors: drawingColors(m.drawing) } : null,
          file: m.drawing ? m.where?.file ?? null : m.info?.file ?? null,
          line: m.drawing ? m.where?.line : m.info?.line,
          col: m.drawing ? m.where?.col : m.info?.col,
          fn: m.drawing ? m.where?.fn ?? null : null,
          tracing: !!m.drawing && m.where === undefined,
          stuck: isStuck(m),
          el: m.el,
        })),
      }
    },
    unselectAll,
    // copy, cut, paste, duplicate, a style, new text
    addText,
    copySelection: () => copySelection(),
    cutSelection: () => copySelection({ cut: true }),
    paste: () => pasteAfter(),
    duplicate,
    copyStyle,
    pasteStyle,
    clipboard: () => ({ element: copied?.label ?? null, style: copiedStyle ? { from: copiedStyle.from, summary: styleSummary(copiedStyle.props), box: copiedStyle.box } : null }),
    // a key's other looks
    states: stateStyles,
    setStateStyle,
    showState,
    shownState: () => unshowState.cur?.name ?? null,
    // where a colour sits
    showTone,
    clearTone,
    drawingTone: (stop, onResult) => state.sel?.canvas && showTone({ item: state.sel.canvas.item, stop, onResult }),
    gradient: gradientOfSel,
    setWords,
    /** Where the selection is, in the page's own pixels: for zooming in on it. */
    selectionRect: () => {
      const r = state.group ? groupRect() : state.sel ? selRect(state.sel) : null
      return r && r.width + r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
    },
    /**
     * The scale the studio draws the page at. The editor's chrome is drawn at
     * the inverse, so a label, a handle or a tick is the same size on screen
     * at 25% as at 400%; what it outlines still scales with the page.
     */
    setViewScale: (k) => {
      const inv = 1 / Math.max(0.05, k || 1)
      ui.root.style.setProperty('--inv', String(inv))
    },
    alignGroup,
    distributeGroup,
    scaleGroup,
    nudgeGroup: (dx, dy) => moveMembers(() => ({ x: dx, y: dy }), `move ${state.group?.members.length ?? 0} items`),
    removeGroup,
    selectSiblings,
    selectMember: (i) => {
      const m = state.group?.members[i]
      if (m) setMembers([m])
    },
    dropMember: (i) => state.group && setMembers(state.group.members.filter((_, k) => k !== i), { keep: true }),
    /** Shift+click in the layers list: in or out of the selection. */
    toggleElement: async (el) => toggleMember(await memberFor(el)),
    /** Shift+click on drawings in the layers list: one in or out, or a whole line of code's worth in. */
    toggleDrawings: async (items) => {
      if (!items?.length) return
      if (await holdStill('Froze the page so the drawings hold still. Play it again from the timeline.')) {
        const frames = await drawingsNow({ fresh: true })
        items = items.map((it) => findAgain(it, frames.get(it.canvas) ?? []) ?? it)
      }
      if (items.length === 1) return toggleMember(drawingMember(items[0]))
      setMembers([...currentMembers(), ...items.map(drawingMember)], { keep: true })
    },
    hover: (el, item = null) => {
      if (item) return showHover(pageRect(item), itemName(item), { draw: true })
      if (!el || !el.isConnected) return (ui.hover.style.display = 'none')
      showHover(el.getBoundingClientRect(), labelOf(el))
    },
    /** Bring something into view, then outline it: for search results and layers. */
    reveal: (el) => {
      if (!el?.isConnected) return
      const r = el.getBoundingClientRect()
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) el.scrollIntoView({ block: 'center', inline: 'nearest' })
      ctl.hover(el)
    },
    search,
    settings: settingsData,
    setSetting,
    keyframes: keyframesData,
    setKeyframe,
    seekKeyframes: (k, progress) => {
      const a = k.anim
      try {
        a.pause()
        const t = a.effect.getComputedTiming()
        a.currentTime = (t.delay ?? 0) + progress * (t.duration ?? 0)
      } catch {}
    },
    // the drawing selected on a canvas
    colorOfDrawing: () => {
      const c = state.sel?.canvas && drawingColors(state.sel.canvas.item)[0]
      if (!c) return toast('This drawing has no plain colour to look for.', 'info', 3000)
      onPicked({ rgb: c.rgb, source: 'canvas', prop: null, el: null, what: `the ${c.label.toLowerCase()} of the selected drawing` })
    },
    findDrawingColor: (c) => onPicked({ rgb: c.rgb, source: 'canvas', prop: null, el: null, what: `${c.label.toLowerCase()} of the selected drawing` }),
    /** A canvas's drawings for the layers list, grouped by the line of code that drew them. */
    drawingsOf: async (canvas) => {
      const frames = await drawingsNow({ stacks: true })
      const groups = new Map()
      for (const it of frames.get(canvas) ?? []) {
        if (groundOf(it) && (frames.get(canvas)?.length ?? 0) > 1) continue
        const key = siteOf(it, boot.tool)?.key ?? `${it.kind}:${it.seq}`
        if (!groups.has(key)) groups.set(key, { label: itemName(it), items: [] })
        groups.get(key).items.push(it)
      }
      return [...groups.values()].map((g) => ({ ...g, label: g.items.length > 1 ? `${g.items.length} x ${g.label}` : g.label }))
    },
    selectDrawing: (it) => selectCanvasItem(it),
    /** Which frame of the drawing's call chain Settings reads the numbers of. */
    setDrawingFrame: (i) => {
      if (!state.sel?.canvas) return
      state.sel.canvas.at = i
      renderInspector()
    },
    /** For probes and agents: the last recording, and a fresh one. */
    debug: { drawings: () => drawings, capture: (o) => recorder.capture(o), itemsAt, resolveHit: (x, y) => resolveHit(pageStack(x, y), x, y) },
    toggleGroup: () => {
      if (!state.sel?.canvas) return
      state.sel.canvas.showGroup = !state.sel.canvas.showGroup
      position()
      renderInspector()
    },
    // the page's clock, for the timeline
    time: () => boot.time?.() ?? 0,
    seekBy: (ms) => {
      boot.step?.(ms)
      drawings.time = null
      renderBar()
    },
    // the page's scroll, for the timeline's bar (scroll.js): where it is, as a fraction of its range
    scroll: () => {
      const s = scrollState(window)
      return s && { p: s.p, range: s.range, screen: s.screen }
    },
    // and a move there, let go of on the bar: a frozen page draws nothing by itself, so it is shown the new place
    scrollTo: (p) => {
      if (!scrollToFraction(window, p)) return
      if (boot.isFrozen?.()) boot.step?.(0)
      drawings.time = null
      renderBar()
    },
    reloadInPlace,
    openFinder: () => (embedded && shell?.openFinder ? shell.openFinder() : openFinder()),
    deselect,
    labelOf,
    isForeign: (el) => !fiberOf(el),
    unitLabel: (el) => {
      const u = unitFor(el)
      return u.stamps.length ? u.label : null
    },
    isLocked,
    // the bar
    mode: () => state.mode,
    setMode,
    undo,
    redo,
    save,
    saving: () => state.saving,
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    undoLabel: () => history.peekUndo()?.label ?? null,
    redoLabel: () => history.peekRedo()?.label ?? null,
    pending: () => pending().map((op) => ({ label: describeOp(op), el: op._el ?? null, kind: op.kind })),
    check: () => (state.config.check ? { label: state.config.check.label, ...(state.check ?? {}) } : null),
    snap: () => state.snap,
    setSnap,
    go,
    goHistory,
    readyToLeave,
    path: () => location.pathname + location.search + location.hash,
    pages: () => sitePages(),
  }

  picker = createPicker({ ui, stackAt: pageStack, realRaf, onPick: (s) => onPicked(s), onEnd: () => renderBar() })
  // the clock can change by itself (frozen again after a reload): the bar and panels follow
  boot.onchange = () => {
    renderBar()
    renderInspector()
  }

  let finder = null
  function openFinder() {
    if (!finder) {
      ui.shadow.append(h('style', { text: FINDER_CSS }))
      finder = createFinder(ui.root, () => ctl)
    }
    finder.open()
  }
  if (window.__RETOUCH__) window.__RETOUCH__.app = ctl

  api
    .get('/config')
    .then((c) => {
      state.config = c
      state.check = c.lastCheck ?? null
      renderBar()
    })
    .catch((e) => toast(`Retouch could not reach its server: ${e.message}`, 'err', 8000))
  seedHistory()
  setMode(state.mode)
  renderBar()
  shell?.attach?.(ctl, window)
  return { state, recs, blocks, history, pending, save, select: selectAt, ctl }
}
