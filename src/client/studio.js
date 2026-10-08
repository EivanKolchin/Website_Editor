import { createFinder, FINDER_CSS } from './finder.js'
import { createInspector, INSPECTOR_CSS } from './inspector.js'
import { createLayers, LAYERS_CSS } from './layers.js'
import { h, icon, zoomKeyOf } from './ui.js'

/**
 * THE STUDIO: the page in a frame, the editor's panels around it.
 *
 *   above   the bar: mode, page, search, devices, history, tools, save
 *   left    Layers (the page as a tree, canvases opening into their
 *           drawings) and Changes (what is not saved yet)
 *   right   Properties: Design, Settings, Motion, Source
 *   below   the timeline: the page's clock, played, frozen, stepped and
 *           scrubbed a frame at a time
 *
 * The editor itself still runs INSIDE the page (src/client/app.js) - the
 * selection box, the handles, the guides, the depth rail and the text
 * editing are drawn over the page where they belong - and this document
 * only draws the panels, reading and driving that editor through the
 * controller it hands over (`attach`). Same origin, so that is a plain
 * object, not a message channel. "Full page" leaves the studio for the page
 * itself, where the same editor draws its own bar and inspector.
 */

const params = new URLSearchParams(location.search)
let ctl = null
let pageWin = null

const DEVICES = [
  { id: 'fit', label: 'Fit', icon: 'monitor', title: 'Fill the space between the panels' },
  { id: 'desktop', label: '1440', icon: 'monitor', w: 1440, h: 900, title: 'Desktop, 1440 x 900' },
  { id: 'laptop', label: '1280', icon: 'monitor', w: 1280, h: 800, title: 'Laptop, 1280 x 800' },
  { id: 'tablet', label: '820', icon: 'tablet', w: 820, h: 1180, title: 'Tablet, 820 x 1180' },
  { id: 'phone', label: '390', icon: 'phone', w: 390, h: 844, title: 'Phone, 390 x 844' },
]

const local = {
  get(k, d) {
    try {
      const v = localStorage.getItem('retouch:studio:' + k)
      return v == null ? d : JSON.parse(v)
    } catch {
      return d
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('retouch:studio:' + k, JSON.stringify(v))
    } catch {}
  },
}

const CSS = `
* { box-sizing: border-box; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.14) transparent; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.26); background-clip: padding-box; }
::-webkit-scrollbar-button { display: none; }
:root { --bg: #0c0c0f; --panel: #131317; --panel-2: #18181d; --line: rgba(255,255,255,0.07); --ink: #ededf2; --mut: #8e8e9a; --faint: #5c5c66; --acc: #4c8dff; --acc-2: #8b7bff; --acc-soft: rgba(76,141,255,0.16); }
body { font: 500 12.5px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: var(--bg); -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; min-width: 28px; padding: 0 8px; border-radius: 8px; white-space: nowrap; transition: background .12s, color .12s; }
button:hover { background: rgba(255,255,255,0.07); }
button.on { background: var(--acc-soft); color: #9ec0ff; }
button.primary { background: var(--acc); color: #fff; font-weight: 650; padding: 0 14px; box-shadow: 0 1px 0 rgba(255,255,255,0.2) inset, 0 4px 14px rgba(76,141,255,0.25); }
button.primary:hover { background: #6199ff; }
button:disabled { opacity: 0.32; pointer-events: none; box-shadow: none; }
input, select { font: inherit; color: inherit; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 8px; height: 28px; padding: 0 9px; outline: none; min-width: 0; }
input:focus, select:focus { border-color: var(--acc); box-shadow: 0 0 0 3px rgba(76,141,255,0.15); }
select option { background: #1c1c22; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.muted { color: var(--mut); }
.studio { position: fixed; inset: 0; display: grid; grid-template-columns: var(--lw, 268px) 1fr var(--rw, 352px); grid-template-rows: 50px 1fr 40px; }
.studio.noleft { grid-template-columns: 0 1fr var(--rw, 352px); }
.studio.noright { grid-template-columns: var(--lw, 268px) 1fr 0; }
.studio.noleft.noright { grid-template-columns: 0 1fr 0; }
.studio.noleft .left, .studio.noright .right { display: none; }
/* a narrow window: the page keeps the width, and the panels open over it */
.studio.narrow { grid-template-columns: 0 1fr 0; }
/* placed by name, not by order: a panel lifted out to float over a narrow window leaves its column, and the stage would slide into it */
.left { grid-column: 1; grid-row: 2; } .stage { grid-column: 2; grid-row: 2; } .right { grid-column: 3; grid-row: 2; }
.studio.narrow .left, .studio.narrow .right { position: fixed; top: 50px; bottom: 40px; width: min(352px, 88vw); z-index: 10; box-shadow: 0 0 48px rgba(0,0,0,0.6); display: none; }
.studio.narrow .left { left: 0; }
.studio.narrow .right { right: 0; }
.studio.narrow.show-left .left { display: flex; }
.studio.narrow.show-right .right { display: block; }
.studio.narrow .grip { display: none; }
.studio.narrow .top .wide { display: none; }
.top { overflow-x: auto; scrollbar-width: none; }

/* the bar */
.top { grid-column: 1 / -1; display: flex; align-items: center; gap: 4px; padding: 0 10px; background: var(--panel); border-bottom: 1px solid var(--line); min-width: 0; }
.top .grp { display: flex; align-items: center; gap: 2px; flex: none; }
.top .sep { width: 1px; height: 22px; background: var(--line); margin: 0 6px; flex: none; }
.top .brand { display: flex; align-items: center; gap: 8px; font-weight: 750; letter-spacing: -0.01em; padding: 0 10px 0 4px; flex: none; font-size: 13px; }
.top .brand i { width: 16px; height: 16px; border-radius: 5px; background: conic-gradient(from 210deg, var(--acc), var(--acc-2), #f472b6, var(--acc)); box-shadow: 0 0 0 1px rgba(255,255,255,0.12) inset; }
.seg { display: inline-flex; background: rgba(255,255,255,0.045); border: 1px solid var(--line); border-radius: 9px; padding: 2px; flex: none; }
.seg button { height: 24px; font-size: 12px; padding: 0 9px; border-radius: 7px; color: var(--mut); }
.seg button.on { background: rgba(255,255,255,0.11); color: var(--ink); box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset; }
.top .path { width: 180px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.top .find { flex: 1 1 260px; max-width: 420px; min-width: 140px; justify-content: flex-start; height: 30px; padding: 0 10px; border-radius: 9px; background: rgba(255,255,255,0.045); border: 1px solid var(--line); color: var(--faint); margin: 0 auto; }
.top .find:hover { background: rgba(255,255,255,0.07); color: var(--mut); }
/* squeezed, the search box gives up its shortcut and then its words, and never draws them over its neighbours */
.top .find { overflow: hidden; container-type: inline-size; }
.top .find span { flex: none; display: inline-flex; }
.top .find span + span { flex: 1 1 auto; min-width: 0; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.top .find kbd { flex: none; }
@container (max-width: 210px) { .top .find kbd { display: none; } }
@container (max-width: 110px) { .top .find span + span { display: none; } }
.top .find kbd, .bottom kbd, .menu kbd { font: 600 10.5px/1 inherit; font-family: inherit; padding: 3px 5px; border-radius: 5px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1); color: #a1a1aa; }
.top .pending { color: var(--mut); }
.top .pending.has { color: #fcd34d; }
.top .badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: rgba(252,211,77,0.16); color: #fcd34d; font-size: 11px; font-weight: 700; }
.check i { width: 8px; height: 8px; border-radius: 50%; background: #52525b; }
.check.passed i { background: #3ccf8e; } .check.failed i { background: #ff6b6b; } .check.running i { background: #f5b84a; animation: pulse 1s infinite; }
@keyframes pulse { 50% { opacity: .35; } }
.check.failed { color: #ffb4b4; }

/* panels */
.left, .right { background: var(--panel); min-height: 0; overflow: hidden; position: relative; }
.left { border-right: 1px solid var(--line); display: flex; flex-direction: column; }
.right { border-left: 1px solid var(--line); overflow: auto; padding: 10px 14px 48px; overscroll-behavior: contain; scrollbar-width: thin; }
.ltabs { display: flex; gap: 2px; padding: 8px 8px 0; }
.ltabs button { height: 28px; font-weight: 650; font-size: 12px; color: var(--mut); padding: 0 10px; }
.ltabs button.on { background: rgba(255,255,255,0.08); color: var(--ink); }
.ltabs .count { font-size: 10.5px; color: #fcd34d; }
.lbody { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.changes { padding: 10px; overflow: auto; }
.changes .item { display: flex; width: 100%; height: auto; min-height: 34px; padding: 7px 9px; justify-content: flex-start; text-align: left; white-space: normal; border-radius: 8px; gap: 9px; }
.changes .item i { width: 7px; height: 7px; border-radius: 50%; background: #fcd34d; flex: none; }
.changes .empty { color: var(--mut); padding: 14px 6px; line-height: 1.6; }
.changes .acts { display: flex; gap: 6px; margin-top: 10px; }
.grip { position: absolute; top: 0; bottom: 0; width: 7px; cursor: col-resize; z-index: 3; }
.grip:hover, .grip.on { background: linear-gradient(90deg, transparent 3px, var(--acc) 3px, var(--acc) 4px, transparent 4px); }
.left .grip { right: -4px; }

/* the stage */
.stage { position: relative; overflow: auto; background: #09090b; background-image: radial-gradient(rgba(255,255,255,0.045) 1px, transparent 1px); background-size: 18px 18px; display: block; min-width: 0; }
.stage.fit { overflow: hidden; }
.stage.panning, .shield.panning { cursor: grabbing; }
.sizer { position: relative; }
.stage.fit .sizer { width: 100%; height: 100%; }
.frame { position: absolute; transform-origin: 0 0; background: #fff; box-shadow: 0 18px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08); border-radius: 6px; overflow: hidden; }
.stage.fit .frame { inset: 0; width: 100%; height: 100%; box-shadow: none; border-radius: 0; }
.shield { position: fixed; display: none; z-index: 15; cursor: grab; }
.zoomer { margin-left: 4px; }
.zoomer button { padding: 0 6px; min-width: 24px; }
.zoomer .zoomval { min-width: 50px; font-variant-numeric: tabular-nums; color: var(--ink); }
.menu .zrow { display: flex; width: 100%; justify-content: space-between; height: 30px; padding: 0 9px; border-radius: 8px; font-size: 12.5px; }
.menu .zrow:hover { background: rgba(255,255,255,0.07); }
.menu .zrow kbd { color: var(--mut); font-size: 11px; }
.menu .zrow.on { color: #9ec0ff; }
.menu .zhint { padding: 8px 9px 4px; color: var(--mut); font-size: 11.5px; line-height: 1.5; border-top: 1px solid var(--line); margin-top: 4px; }
.frame iframe { border: 0; width: 100%; height: 100%; display: block; background: #fff; }
.devlabel { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); color: var(--faint); font-size: 11px; pointer-events: none; }

/* the timeline */
.bottom { grid-column: 1 / -1; display: flex; align-items: center; gap: 4px; padding: 0 10px; background: var(--panel); border-top: 1px solid var(--line); color: var(--mut); font-size: 12px; white-space: nowrap; min-width: 0; }
.bottom .time { font-variant-numeric: tabular-nums; color: var(--ink); min-width: 70px; text-align: right; padding-right: 4px; }
.bottom .jog { position: relative; flex: 0 1 320px; min-width: 120px; height: 24px; border-radius: 7px; background: rgba(255,255,255,0.04); border: 1px solid var(--line); cursor: ew-resize; overflow: hidden; touch-action: none; }
.bottom .jog::before { content: ''; position: absolute; inset: 0; background-image: repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0 1px, transparent 1px 12px); background-position: var(--jx, 0) 0; opacity: 0.6; }
.bottom .jog::after { content: 'drag to move the clock'; position: absolute; inset: 0; display: grid; place-items: center; color: var(--faint); font-size: 10.5px; }
.bottom .jog .needle { position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; margin-left: -1px; background: #ff5c8a; }
.bottom .sel { overflow: hidden; text-overflow: ellipsis; color: var(--ink); min-width: 0; flex: 1 1 auto; padding-left: 10px; }
.bottom .sel a { color: #8db4ff; cursor: pointer; }
.bottom .sep { width: 1px; height: 18px; background: var(--line); margin: 0 6px; flex: none; }

/* menus */
.menu { position: fixed; top: 54px; width: 400px; max-width: calc(100vw - 20px); max-height: 64vh; overflow: auto; padding: 8px; display: none; z-index: 20; background: rgba(23,23,28,0.98); border: 1px solid rgba(255,255,255,0.09); border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,0.5); }
.menu h6 { margin: 4px 8px 8px; font-size: 10.5px; font-weight: 700; color: var(--mut); text-transform: uppercase; letter-spacing: 0.06em; }
.menu pre { margin: 0; padding: 8px; white-space: pre-wrap; word-break: break-word; font-size: 11px; color: #d4d4d8; }
.menu table { width: 100%; border-collapse: collapse; } .menu td { padding: 4px 6px; vertical-align: top; line-height: 1.45; } .menu td:first-child { color: var(--mut); width: 130px; }
`

/* ---------------- the document ---------------- */

document.head.append(h('style', { text: CSS + INSPECTOR_CSS + LAYERS_CSS + FINDER_CSS }))
if (!document.title) document.title = 'Retouch studio'

/**
 * The tab wears the PAGE'S OWN icon and name: the site being edited, never
 * Retouch's and never another project's that the browser cached for this
 * address. The server writes the icons index.html declares; this follows
 * the page itself, so an icon a script or another page sets is the one shown.
 */
let iconKey = ''
function mirrorPage() {
  let doc
  try {
    doc = frame.contentDocument
  } catch {
    return
  }
  if (!doc?.head) return
  if (doc.title) document.title = `Retouch - ${doc.title}`
  const links = [...doc.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')]
  if (!links.length) return
  const key = links.map((l) => l.href).join(' ')
  if (key === iconKey) return
  iconKey = key
  for (const l of document.querySelectorAll('link[data-project-icon]')) l.remove()
  for (const l of links) document.head.append(h('link', { rel: l.rel, href: l.href, type: l.type || null, sizes: l.getAttribute('sizes') || null, 'data-project-icon': '' }))
}

const btn = (name, title, onclick, cls = '') => h('button', { class: cls, title, html: icon(name, 15), onclick })
const editBtn = h('button', { html: `${icon('pencil', 13)}<span>Edit</span>`, title: 'Edit mode: click to select (Ctrl+Shift+E)', onclick: () => ctl?.setMode('edit') })
const viewBtn = h('button', { html: `${icon('eye', 13)}<span>View</span>`, title: 'View mode: use the page normally, links included (Ctrl+Shift+E)', onclick: () => ctl?.setMode('view') })
const pathInput = h('input', { class: 'path', spellcheck: 'false', title: 'Go to a page: type an address and press Enter', 'aria-label': 'Page', list: 'retouch-pages' })
const pagesList = h('datalist', { id: 'retouch-pages' })
const findBtn = h('button', { class: 'find', title: 'Search the page: words, elements, files, colours, commands', onclick: () => finder.open() }, h('span', { html: icon('search', 14) }), h('span', { text: 'Search the page' }), h('kbd', { text: 'Ctrl K' }))
const undoBtn = btn('undo', 'Undo (Ctrl+Z)', () => ctl?.undo())
const redoBtn = btn('redo', 'Redo (Ctrl+Shift+Z)', () => ctl?.redo())
const snapBtn = btn('magnet', 'Snap to guides', () => ctl?.setSnap(!ctl.snap()))
const pickBtn = btn('pipette', 'Pick a colour off the page (I)', () => ctl?.startPick())
const pendingBtn = h('button', { class: 'pending', onclick: () => showLeft('changes') })
const saveBtn = h('button', { class: 'primary', html: `${icon('check', 14)}<span>Save</span>`, title: 'Save to source (Ctrl+S)', onclick: () => ctl?.save() })
const checkBtn = h('button', { class: 'check', title: 'Project check', onclick: () => menu('check') })
const leftBtn = btn('sideL', 'Layers and changes', () => toggleSide('left'))
const rightBtn = btn('sideR', 'Properties', () => toggleSide('right'))
const fullBtn = h('button', { html: `${icon('expand', 14)}<span class="wide">Full page</span>`, title: 'Leave the studio for the page at full size, with the editor over it', onclick: () => fullPage() })
const zoomOut = btn('minus', 'Zoom out (Ctrl -)', () => zoomStep(-1))
const zoomIn = btn('plus', 'Zoom in (Ctrl +)', () => zoomStep(1))
const zoomBtn = h('button', { class: 'zoomval', title: 'Zoom: fit, the selection, or a size', onclick: () => menu('zoom') })
const zoomSeg = h('div', { class: 'seg zoomer' }, zoomOut, zoomBtn, zoomIn)
const devBtns = DEVICES.map((d) => h('button', { html: `${icon(d.icon, 13)}<span>${d.label}</span>`, title: d.title, onclick: () => setDevice(d.id) }))
const deviceSeg = h('div', { class: 'seg' }, ...devBtns)

const top = h(
  'header',
  { class: 'top' },
  h('div', { class: 'brand', title: 'Retouch studio' }, h('i'), h('span', { text: 'Retouch' })),
  h('div', { class: 'seg' }, editBtn, viewBtn),
  h('span', { class: 'sep' }),
  h('div', { class: 'grp' }, btn('back', 'Back', () => ctl?.goHistory(-1)), btn('fwd', 'Forward', () => ctl?.goHistory(1)), pathInput, pagesList, btn('reload', 'Reload, keeping the place', () => ctl?.reloadInPlace())),
  findBtn,
  h('div', { class: 'grp' }, deviceSeg, zoomSeg),
  h('span', { class: 'sep' }),
  h('div', { class: 'grp' }, undoBtn, redoBtn, snapBtn, pickBtn, btn('text', 'Add text after what is selected (T). Right-click the page for copy, paste and styles', () => ctl?.addText())),
  h('span', { class: 'sep' }),
  h('div', { class: 'grp' }, pendingBtn, saveBtn, checkBtn),
  h('span', { class: 'sep' }),
  h('div', { class: 'grp' }, leftBtn, rightBtn, btn('help', 'Shortcuts and tips', () => menu('help')), fullBtn),
)

const frame = h('iframe', { title: 'The page', allow: 'clipboard-read; clipboard-write' })
const frameBox = h('div', { class: 'frame' }, frame)
const devLabel = h('div', { class: 'devlabel' })
// the sizer is the size the page is DRAWN at, so the stage scrolls over all of it at any zoom
const sizer = h('div', { class: 'sizer' }, frameBox)
const stage = h('main', { class: 'stage' }, devLabel, sizer)
// while Space is held the stage is a surface to drag around, over the page as well
const shield = h('div', { class: 'shield' })

// left: layers and changes
const layersHost = h('div', { class: 'lbody' })
const changesHost = h('div', { class: 'lbody changes' })
const tabLayers = h('button', { text: 'Layers', onclick: () => showLeft('layers') })
const tabChanges = h('button', { onclick: () => showLeft('changes') })
const left = h('aside', { class: 'left' }, h('div', { class: 'ltabs' }, tabLayers, tabChanges), layersHost, changesHost, h('div', { class: 'grip', 'data-side': 'left' }))
const right = h('aside', { class: 'right' })
const rightGrip = h('div', { class: 'grip', 'data-side': 'right', style: { position: 'fixed' } })

// below: the timeline
const playBtn = btn('pause', 'Freeze or play everything that moves', () => ctl?.setFrozen(!ctl.speedState().frozen))
const backBtn = btn('back', 'One frame back (,)', () => ctl?.seekBy(-1000 / 60))
const fwdBtn = btn('fwd', 'One frame on (.)', () => ctl?.seekBy(1000 / 60))
const timeEl = h('span', { class: 'time' })
const jog = h('div', { class: 'jog', title: 'Drag to move the clock of the page (Shift: faster)' }, h('div', { class: 'needle' }))
const speedSeg = h('div', { class: 'seg' }, ...[0.1, 0.25, 0.5, 1].map((v) => h('button', { text: `${v}x`, 'data-speed': v, title: v === 1 ? 'Normal speed' : `Slow motion: ${v} of normal speed`, onclick: () => ctl?.setSpeed(v) })))
const selInfo = h('div', { class: 'sel' })
const bottom = h('footer', { class: 'bottom' }, playBtn, backBtn, fwdBtn, timeEl, jog, speedSeg, h('span', { class: 'sep' }), selInfo)

const menuEl = h('div', { class: 'menu' })
const studio = h('div', { class: 'studio' }, top, left, stage, right, bottom)
document.body.append(studio, menuEl, rightGrip, shield)

const layers = createLayers(layersHost, { ctl: () => ctl, doc: () => pageWin?.document ?? null })
const finder = createFinder(document.body, () => ctl)
let inspector = null

/* ---------------- the page, and the editor inside it ---------------- */

window.__RETOUCH_SHELL__ = {
  /** Called by the editor in the frame each time the page in it loads. */
  attach(c, win) {
    ctl = c
    pageWin = win
    c.events.addEventListener('change', () => schedule())
    inspector = createInspector(right, c)
    layers.attach()
    lastSel = undefined
    pagesList.replaceChildren(...(c.pages?.() ?? []).map((p) => h('option', { value: p.path, label: p.label })))
    c.setViewScale?.(drawnAt)
    schedule()
  },
  openFinder: () => finder.open(),
  // the zoom, from inside the page: Ctrl+wheel and pinch there, in the page's own pixels
  zoomWheel: (deltaY, deltaMode, x, y) => {
    const p = fromPage(x, y)
    wheelZoom(deltaY, deltaMode, p.x, p.y)
  },
  zoomKey: (which) => zoomKey(which),
  space: (on) => holdSpace(on),
  /**
   * A plain wheel over the page: the view takes it while it can still move
   * that way (zoomed in, not at its edge), and says so; otherwise the page
   * scrolls as it would. Alt+wheel always goes to the page.
   */
  panWheel: (dx, dy, mode) => {
    const unit = mode === 1 ? 16 : mode === 2 ? stage.clientHeight : 1
    const x0 = stage.scrollLeft
    const y0 = stage.scrollTop
    stage.scrollLeft = x0 + dx * unit
    stage.scrollTop = y0 + dy * unit
    return Math.abs(stage.scrollLeft - x0) > 0.5 || Math.abs(stage.scrollTop - y0) > 0.5
  },
}

frame.src = params.get('path') || '/'

let queued = false
function schedule() {
  if (queued) return
  queued = true
  requestAnimationFrame(() => {
    if (!queued) return
    queued = false
    render()
  })
  // a window in the background gets no frames; the panels must still follow
  setTimeout(() => {
    if (queued) {
      queued = false
      render()
    }
  }, 120)
}

let lastSel
let lastVersion = -1
let lastTime = null
function render() {
  if (!ctl) return
  const mode = ctl.mode()
  editBtn.classList.toggle('on', mode === 'edit')
  viewBtn.classList.toggle('on', mode === 'view')
  undoBtn.disabled = !ctl.canUndo()
  redoBtn.disabled = !ctl.canRedo()
  undoBtn.title = ctl.undoLabel() ? `Undo ${ctl.undoLabel()} (Ctrl+Z)` : 'Undo (Ctrl+Z)'
  redoBtn.title = ctl.redoLabel() ? `Redo ${ctl.redoLabel()} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)'
  snapBtn.classList.toggle('on', ctl.snap())
  pickBtn.classList.toggle('on', ctl.isPicking())
  const pend = ctl.pending()
  const n = pend.length
  pendingBtn.classList.toggle('has', n > 0)
  pendingBtn.innerHTML = n ? `<span class="badge">${n}</span><span>unsaved</span>` : '<span>All saved</span>'
  tabChanges.innerHTML = n ? `Changes <span class="count">${n}</span>` : 'Changes'
  saveBtn.disabled = n === 0 || ctl.saving()
  const c = ctl.check()
  checkBtn.style.display = c ? '' : 'none'
  if (c) {
    checkBtn.className = `check ${c.status ?? ''}`
    checkBtn.innerHTML = `<i></i><span>${c.label}${c.status ? ` ${c.status}` : ''}</span>`
  }
  // the clock
  const sp = ctl.speedState()
  playBtn.innerHTML = icon(sp.frozen ? 'play' : 'pause', 15)
  playBtn.title = sp.frozen ? 'Play everything that moves' : 'Freeze everything that moves'
  playBtn.classList.toggle('on', sp.frozen)
  for (const b of speedSeg.children) b.classList.toggle('on', !sp.frozen && Number(b.dataset.speed) === sp.speed)
  const t = ctl.time()
  timeEl.textContent = `${(t / 1000).toFixed(2)} s`
  if (lastTime != null && Math.abs(t - lastTime) > 1) layers.forgetDrawings()
  lastTime = t
  // the panels follow the selection
  const sel = ctl.selected()
  const version = ctl.version?.() ?? 0
  if (sel !== lastSel || version !== lastVersion) {
    if (sel !== lastSel) layers.reveal(sel)
    lastSel = sel
    lastVersion = version
    inspector?.render()
  }
  if (leftTab === 'changes') renderChanges(pend)
  const g = ctl.group?.()
  const s = g ? null : ctl.selection()
  const where = s?.drawing ? s.drawing.where : s?.file ? { file: s.file, line: s.line, col: s.col } : null
  const kids = g
    ? [h('b', { text: `${g.count} selected` }), h('span', { text: '  Tap one on the page to take it out, another to add it.  ' }), h('a', { text: 'Unselect all', onclick: () => ctl.unselectAll() })]
    : [
        s ? h('b', { text: s.drawing ? s.drawing.name : s.label }) : h('span', { text: 'Nothing selected. Click anything, or press Ctrl K to search.' }),
        where ? h('span', {}, '  ', h('a', { class: 'mono', text: `${where.file}:${where.line}`, onclick: () => ctl.open(where.file, where.line, where.col) })) : null,
      ]
  selInfo.replaceChildren(...kids.filter(Boolean))
}

/* ---------------- left: layers and changes ---------------- */

let leftTab = local.get('lefttab', 'layers')
function showLeft(which, { open = true } = {}) {
  leftTab = which
  local.set('lefttab', which)
  if (open && (isNarrow() ? !over.left : !sides.left)) toggleSide('left')
  tabLayers.classList.toggle('on', which === 'layers')
  tabChanges.classList.toggle('on', which === 'changes')
  layersHost.style.display = which === 'layers' ? '' : 'none'
  changesHost.style.display = which === 'changes' ? '' : 'none'
  if (which === 'changes') renderChanges(ctl?.pending() ?? [])
}
function renderChanges(list) {
  if (!list.length) {
    changesHost.replaceChildren(h('div', { class: 'empty', text: 'Nothing unsaved. Every edit you make lands here until you save it; Undo reaches past a save too.' }))
    return
  }
  changesHost.replaceChildren(
    ...list.map((op) =>
      h(
        'button',
        {
          class: 'item',
          onclick: () => {
            if (op.el?.isConnected) {
              op.el.scrollIntoView({ block: 'center' })
              ctl.selectElement(op.el)
            }
          },
          onpointerenter: () => op.el && ctl.hover(op.el),
          onpointerleave: () => ctl.hover(null),
        },
        h('i'),
        h('span', { text: op.label }),
      ),
    ),
    h('div', { class: 'acts' }, h('button', { class: 'primary', html: `${icon('check', 14)}<span>Save all</span>`, onclick: () => ctl.save() }), h('button', { html: `${icon('undo', 14)}<span>Undo last</span>`, onclick: () => ctl.undo() })),
  )
}

/* ---------------- path ---------------- */

function syncPath() {
  if (!pageWin) return
  let p
  try {
    p = pageWin.location.pathname + pageWin.location.search + pageWin.location.hash
  } catch {
    return
  }
  if (document.activeElement !== pathInput) pathInput.value = p
  if (params.get('path') !== p) {
    params.set('path', p)
    history.replaceState(null, '', `${location.pathname}?${params}`)
  }
}
setInterval(syncPath, 500)
pathInput.addEventListener('keydown', (e) => {
  e.stopPropagation()
  if (e.key === 'Enter') {
    const v = pathInput.value.trim() || '/'
    pathInput.blur()
    ctl?.go(v.startsWith('/') || /^[a-z]+:/i.test(v) ? v : '/' + v)
  } else if (e.key === 'Escape') pathInput.blur()
})
frame.addEventListener('load', () => {
  mirrorPage()
  // a page that is not served through Retouch has no editor in it: say so rather than show dead panels
  setTimeout(() => {
    mirrorPage()
    if (!pageWin || pageWin !== frame.contentWindow) {
      pageWin = frame.contentWindow
      if (!pageWin?.__RETOUCH__) selInfo.replaceChildren(h('span', { text: 'This page has no editor in it (it was not served by this Retouch server).' }))
    }
    syncPath()
  }, 1500)
})

/* ---------------- the timeline's jog ---------------- */

jog.addEventListener('pointerdown', (e) => {
  if (!ctl) return
  jog.setPointerCapture(e.pointerId)
  let last = e.clientX
  let offset = 0
  const move = (ev) => {
    const dx = ev.clientX - last
    last = ev.clientX
    offset += dx
    jog.style.setProperty('--jx', `${offset}px`)
    // 10 ms of the page's time per pixel; Shift for a tenth of a second
    if (dx) ctl.seekBy(dx * (ev.shiftKey ? 100 : 10))
  }
  const up = () => {
    jog.removeEventListener('pointermove', move)
    jog.removeEventListener('pointerup', up)
  }
  jog.addEventListener('pointermove', move)
  jog.addEventListener('pointerup', up)
})

/* ---------------- devices and zoom ---------------- */

/**
 * ZOOM IS A LENS, NOT A WINDOW SIZE. The page always lays out at the size
 * it would really have - the device's, or the stage's for Fit - and is
 * DRAWN larger or smaller, so zooming in on a heading never sets off a
 * breakpoint. The editor inside works in the page's own pixels throughout:
 * a browser maps the pointer through the frame's scale, so a drag moves
 * things by the page's pixels at any zoom. Its chrome (labels, handles,
 * ticks) is drawn at the inverse scale, so it stays one size on screen.
 */
const ZOOMS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8]
let device = local.get('device', 'fit')
// 'fit' or a number; a zoom made with the wheel is not remembered, a chosen one is
let zoom = local.get('zoom', 'fit')
let drawnAt = 1
let place = { left: 0, top: 0 }
function setDevice(id) {
  device = id
  local.set('device', id)
  layout()
}
const currentDevice = () => DEVICES.find((x) => x.id === device) ?? DEVICES[0]
/** The size the page lays out at: the device's, or for Fit the stage's own. */
function pageSize(d) {
  if (d.w) return { w: d.w, h: d.h }
  const r = stage.getBoundingClientRect()
  return { w: Math.max(240, Math.floor(r.width)), h: Math.max(240, Math.floor(r.height)) }
}
function scaleFor(d) {
  if (zoom !== 'fit') return Number(zoom)
  if (!d.w) return 1
  const pad = 28
  return Math.min(1, (stage.clientWidth - pad * 2) / d.w, (stage.clientHeight - pad * 2) / d.h)
}
function layout() {
  const d = currentDevice()
  devBtns.forEach((b, k) => b.classList.toggle('on', DEVICES[k].id === d.id))
  const k = scaleFor(d)
  drawnAt = k
  // always a number: "Fit" here beside the Fit device button read as the same control twice
  zoomBtn.textContent = `${Math.round(k * 100)}%`
  zoomBtn.title = `Zoom ${Math.round(k * 100)}%: fit, the selection, or a size. Ctrl+wheel or pinch zooms where the pointer is; Space+drag moves around`
  ctl?.setViewScale?.(k)
  // Fit at its own size: the frame IS the stage, nothing to scroll
  if (!d.w && k === 1) {
    stage.classList.add('fit')
    sizer.style.width = sizer.style.height = ''
    Object.assign(frameBox.style, { width: '', height: '', left: '', top: '', transform: '' })
    place = { left: 0, top: 0 }
    devLabel.textContent = ''
    return
  }
  stage.classList.remove('fit')
  const { w, h: ht } = pageSize(d)
  const pad = 28
  const sw = w * k
  const sh = ht * k
  // centred while it fits; once it is larger, a margin all round to scroll to
  const left = Math.max(pad, Math.floor((stage.clientWidth - sw) / 2))
  const top = Math.max(pad, Math.floor((stage.clientHeight - sh) / 2))
  place = { left, top }
  sizer.style.width = `${Math.floor(left * 2 + sw)}px`
  sizer.style.height = `${Math.floor(top * 2 + sh)}px`
  Object.assign(frameBox.style, { width: `${w}px`, height: `${ht}px`, left: `${left}px`, top: `${top}px`, transform: k === 1 ? '' : `scale(${k})` })
  devLabel.textContent = d.w ? `${d.title}${k !== 1 ? `  at ${Math.round(k * 100)}%` : ''}` : `${w} x ${ht} at ${Math.round(k * 100)}%`
}
new ResizeObserver(() => layout()).observe(stage)
layout()

/** Zoom to `k`, keeping the point of the page under (px, py) - in the stage's own box - where it is. */
function zoomTo(k, px = stage.clientWidth / 2, py = stage.clientHeight / 2, { remember = false } = {}) {
  k = Math.min(8, Math.max(0.1, k))
  const fx = (stage.scrollLeft + px - place.left) / drawnAt
  const fy = (stage.scrollTop + py - place.top) / drawnAt
  zoom = Math.abs(k - 1) < 0.004 ? 1 : Math.round(k * 1000) / 1000
  if (remember) local.set('zoom', zoom)
  layout()
  stage.scrollLeft = place.left + fx * drawnAt - px
  stage.scrollTop = place.top + fy * drawnAt - py
}
/** The next stop up or down: 100%, 150%, 200%... */
function zoomStep(dir) {
  const k = drawnAt
  const next = dir > 0 ? ZOOMS.find((z) => z > k * 1.01) : [...ZOOMS].reverse().find((z) => z < k * 0.99)
  if (next) zoomTo(next, undefined, undefined, { remember: next <= 1 })
}
function zoomFit() {
  zoom = 'fit'
  local.set('zoom', zoom)
  layout()
  stage.scrollLeft = stage.scrollTop = 0
}
/** Close in on what is selected, centred, with room round it. */
function zoomToSelection() {
  const r = ctl?.selectionRect?.()
  if (!r) return
  const k = Math.min(8, Math.max(0.25, Math.min((stage.clientWidth * 0.6) / Math.max(r.width, 8), (stage.clientHeight * 0.6) / Math.max(r.height, 8))))
  zoom = Math.round(k * 1000) / 1000
  layout()
  stage.scrollLeft = place.left + (r.left + r.width / 2) * drawnAt - stage.clientWidth / 2
  stage.scrollTop = place.top + (r.top + r.height / 2) * drawnAt - stage.clientHeight / 2
}
/** A wheel or pinch: a notch is about a fifth; a trackpad's small steps are smooth. */
function wheelZoom(deltaY, deltaMode, px, py) {
  const dy = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  zoomTo(drawnAt * Math.exp(-Math.max(-120, Math.min(120, dy)) * 0.0022), px, py)
}
/** Where a point in the page's own pixels is in the stage's box. */
const fromPage = (x, y) => ({ x: place.left + x * drawnAt - stage.scrollLeft, y: place.top + y * drawnAt - stage.scrollTop })
function zoomKey(which) {
  if (which === 'in') zoomStep(1)
  else if (which === 'out') zoomStep(-1)
  else if (which === 'actual') zoomTo(1, undefined, undefined, { remember: true })
  else if (which === 'fit') zoomFit()
  else if (which === 'selection') zoomToSelection()
}
stage.addEventListener(
  'wheel',
  (e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    const r = stage.getBoundingClientRect()
    wheelZoom(e.deltaY, e.deltaMode, e.clientX - r.left, e.clientY - r.top)
  },
  { passive: false },
)

/* ---------------- moving around: Space+drag anywhere, or a drag on the empty stage ---------------- */

function pan(e, from) {
  const start = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop }
  let moved = false
  from.setPointerCapture?.(e.pointerId)
  from.classList.add('panning')
  const move = (ev) => {
    if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return
    moved = true
    stage.scrollLeft = start.sl - (ev.clientX - start.x)
    stage.scrollTop = start.st - (ev.clientY - start.y)
  }
  return new Promise((done) => {
    const up = () => {
      from.removeEventListener('pointermove', move)
      from.removeEventListener('pointerup', up)
      from.removeEventListener('pointercancel', up)
      from.classList.remove('panning')
      done(moved)
    }
    from.addEventListener('pointermove', move)
    from.addEventListener('pointerup', up)
    from.addEventListener('pointercancel', up)
  })
}
let spaceDown = false
function holdSpace(on) {
  if (on === spaceDown) return
  spaceDown = on
  if (on) {
    const r = stage.getBoundingClientRect()
    Object.assign(shield.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
  } else shield.style.display = 'none'
}
shield.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  pan(e, shield)
})
window.addEventListener('blur', () => holdSpace(false))
// THE EMPTY STAGE round the page: a click there unselects everything; a drag there moves the view
stage.addEventListener('pointerdown', async (e) => {
  if (e.button !== 0 || frameBox.contains(e.target)) return
  // the stage's own scrollbars are not empty space
  const r = stage.getBoundingClientRect()
  if (e.clientX - r.left >= stage.clientWidth || e.clientY - r.top >= stage.clientHeight) return
  e.preventDefault()
  const moved = await pan(e, stage)
  if (!moved) ctl?.unselectAll?.()
})

/* ---------------- panels ---------------- */

const sides = { left: local.get('left', true), right: local.get('right', true) }
// in a narrow window the panels lie over the page, closed until asked for
const over = { left: false, right: false }
const isNarrow = () => innerWidth < widths.left + widths.right + 480
function toggleSide(which) {
  if (isNarrow()) {
    over[which] = !over[which]
    if (over[which]) over[which === 'left' ? 'right' : 'left'] = false
  } else {
    sides[which] = !sides[which]
    local.set(which, sides[which])
  }
  applySides()
}
function applySides() {
  const narrow = isNarrow()
  studio.classList.toggle('narrow', narrow)
  studio.classList.toggle('show-left', narrow && over.left)
  studio.classList.toggle('show-right', narrow && over.right)
  studio.classList.toggle('noleft', !narrow && !sides.left)
  studio.classList.toggle('noright', !narrow && !sides.right)
  leftBtn.classList.toggle('on', narrow ? over.left : sides.left)
  rightBtn.classList.toggle('on', narrow ? over.right : sides.right)
  rightGrip.style.display = !narrow && sides.right ? '' : 'none'
  placeRightGrip()
  layout()
}
window.addEventListener('resize', () => applySides())
const widths = { left: local.get('lw', 268), right: local.get('rw', 352) }
function applyWidths() {
  studio.style.setProperty('--lw', `${widths.left}px`)
  studio.style.setProperty('--rw', `${widths.right}px`)
  placeRightGrip()
}
function placeRightGrip() {
  const r = right.getBoundingClientRect()
  rightGrip.style.left = `${r.left - 4}px`
  rightGrip.style.top = `${r.top}px`
  rightGrip.style.height = `${r.height}px`
}
for (const grip of [left.querySelector('.grip'), rightGrip]) {
  grip.addEventListener('pointerdown', (e) => {
    const side = grip.dataset.side
    grip.setPointerCapture(e.pointerId)
    grip.classList.add('on')
    const x0 = e.clientX
    const w0 = widths[side]
    // the frame would swallow the pointer as it crosses it
    frame.style.pointerEvents = 'none'
    const move = (ev) => {
      const dx = ev.clientX - x0
      widths[side] = Math.max(220, Math.min(600, w0 + (side === 'left' ? dx : -dx)))
      applyWidths()
      layout()
    }
    const up = () => {
      frame.style.pointerEvents = ''
      grip.classList.remove('on')
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
      local.set(side === 'left' ? 'lw' : 'rw', widths[side])
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
  })
}
window.addEventListener('resize', placeRightGrip)
applyWidths()
applySides()
showLeft(leftTab, { open: false })

/* ---------------- menus ---------------- */

function menu(which) {
  if (menuEl.style.display === 'block' && menuEl.dataset.which === which) {
    menuEl.style.display = 'none'
    return
  }
  menuEl.dataset.which = which
  menuEl.replaceChildren()
  if (which === 'zoom') {
    const k = drawnAt
    const row = (label, keys, fn, on = false) =>
      h('button', { class: `zrow${on ? ' on' : ''}`, onclick: () => ((menuEl.style.display = 'none'), fn()) }, h('span', { text: label }), keys ? h('kbd', { text: keys }) : null)
    menuEl.append(
      h('h6', { text: 'Zoom' }),
      row('Fit', 'Shift 1', zoomFit, zoom === 'fit'),
      row('Zoom to the selection', 'Shift 2', zoomToSelection),
      row('Actual size, 100%', 'Shift 0', () => zoomTo(1, undefined, undefined, { remember: true }), zoom !== 'fit' && Math.abs(k - 1) < 0.004),
      row('Zoom in', 'Ctrl +', () => zoomStep(1)),
      row('Zoom out', 'Ctrl -', () => zoomStep(-1)),
      ...[0.5, 2, 4].map((z) => row(`${z * 100}%`, '', () => zoomTo(z, undefined, undefined, { remember: z <= 1 }), zoom !== 'fit' && Math.abs(k - z) < 0.004)),
      h('div', { class: 'zhint', text: 'Ctrl+wheel or a pinch zooms in on the point under the pointer. Zoomed in, in Edit mode, the wheel moves the view (Shift+wheel sideways) and scrolls the page once the view is at its edge; Alt+wheel always scrolls the page. In View mode the wheel scrolls the site, and the scrollbars move the view. Hold Space and drag to move around, or drag the dark space round the page. A click there unselects everything.' }),
    )
    const r = zoomBtn.getBoundingClientRect()
    Object.assign(menuEl.style, { display: 'block', width: '280px', left: `${Math.max(10, Math.min(innerWidth - 290, r.left + r.width / 2 - 140))}px`, right: 'auto' })
    return
  }
  menuEl.style.width = ''
  if (which === 'check') {
    const c = ctl?.check()
    menuEl.append(h('h6', { text: `${c?.label}: ${c?.status ?? 'not run yet'}${c?.ms ? `, ${(c.ms / 1000).toFixed(1)} s` : ''}` }))
    if (c?.output) menuEl.append(h('pre', { text: c.output }))
  } else {
    menuEl.innerHTML = `<h6>Shortcuts and tips</h6><table>
      <tr><td>Click</td><td>Select; click again to go deeper</td></tr>
      <tr><td>Click, then drag</td><td>Move. Only what is selected moves</td></tr>
      <tr><td>Drag on the page</td><td>A box: select everything inside it, drawings on a canvas too, then move, resize, align or space them out together</td></tr>
      <tr><td>Tap, with several selected</td><td>Each selected thing has a tick. Tap one to take it out, tap another to add it; another box adds more</td></tr>
      <tr><td><kbd>Esc</kbd>, or the dark space</td><td>Unselect all. A drag on the dark space round the page moves the view</td></tr>
      <tr><td>Tap words</td><td>Selects the heading, paragraph or key they are in; tap again to type there</td></tr>
      <tr><td><kbd>T</kbd></td><td>Add text after what is selected, styled like it (also on right-click)</td></tr>
      <tr><td><kbd>Ctrl</kbd> <kbd>C</kbd> <kbd>X</kbd> <kbd>V</kbd> <kbd>D</kbd></td><td>Copy, cut, paste after the selection, duplicate: written into the source</td></tr>
      <tr><td><kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>C</kbd> / <kbd>V</kbd></td><td>Copy a text style, paste it onto something else</td></tr>
      <tr><td><kbd>Ctrl</kbd> + wheel, pinch</td><td>Zoom where the pointer is. <kbd>Ctrl</kbd> <kbd>+</kbd> <kbd>-</kbd> <kbd>0</kbd>; <kbd>Shift</kbd> <kbd>1</kbd> fits, <kbd>Shift</kbd> <kbd>2</kbd> zooms to the selection</td></tr>
      <tr><td>Zoomed in</td><td>In Edit mode the wheel moves the view (<kbd>Shift</kbd> sideways) before it scrolls the page; <kbd>Space</kbd> + drag moves around. In View mode the wheel scrolls the site</td></tr>
      <tr><td>A key</td><td>Properties shows its words, colours, and how it looks pressed, hovered and focused (Show it)</td></tr>
      <tr><td>A gradient's colours</td><td>Point at one in Properties to see the area of the shape it paints</td></tr>
      <tr><td><kbd>Shift</kbd> + click</td><td>Add to the selection or take out of it (in Layers too)</td></tr>
      <tr><td><kbd>Ctrl</kbd> <kbd>A</kbd></td><td>Everything beside what is selected</td></tr>
      <tr><td>Right-click</td><td>Everything under the pointer, top first: pick the depth you mean</td></tr>
      <tr><td>The rail</td><td>Above the selection: what it sits in. Click a step, or scroll over it</td></tr>
      <tr><td><kbd>Ctrl</kbd> <kbd>K</kbd> or <kbd>/</kbd></td><td>Search the page: words, elements, files, colours, commands</td></tr>
      <tr><td>Layers</td><td>Anything, even hidden or moving. A canvas opens into its drawings</td></tr>
      <tr><td>Drawings</td><td>Stars, lines and shapes on a canvas: hover, select, find their colour and the code that drew them</td></tr>
      <tr><td>Double-click</td><td>Edit text</td></tr>
      <tr><td>Corners</td><td>Resize; the dot above rotates. A group's corners keep its spacing</td></tr>
      <tr><td><kbd>I</kbd></td><td>Pick a colour, then fine-tune it where it is written</td></tr>
      <tr><td>Settings</td><td>Props, defaults, named values and timing in code; saved at once</td></tr>
      <tr><td>Motion</td><td>Keyframes on a timeline; click a diamond to edit that moment</td></tr>
      <tr><td><kbd>,</kbd> <kbd>.</kbd></td><td>The page's clock a frame back or on; the timeline below scrubs it</td></tr>
      <tr><td><kbd>Ctrl</kbd> <kbd>Z</kbd></td><td>Undo, saves included</td></tr>
      <tr><td><kbd>Ctrl</kbd> <kbd>S</kbd></td><td>Save to source</td></tr>
      <tr><td>Full page</td><td>The page at full size with the editor over it; its studio button comes back</td></tr>
    </table>`
  }
  menuEl.style.display = 'block'
  menuEl.style.right = '10px'
  menuEl.style.left = 'auto'
}
document.addEventListener('pointerdown', (e) => {
  if (!menuEl.contains(e.target) && !top.contains(e.target)) menuEl.style.display = 'none'
})

/* ---------------- keys: the studio's own, and the editor's when focus is out here ---------------- */

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    return finder.isOpen ? finder.close() : finder.open()
  }
  if (finder.isOpen) return
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) return
  if (e.key === '/') {
    e.preventDefault()
    return finder.open()
  }
  const zk = zoomKeyOf(e)
  if (zk) {
    e.preventDefault()
    return zoomKey(zk)
  }
  if (e.code === 'Space') {
    e.preventDefault()
    return holdSpace(true)
  }
  if (!pageWin) return
  const ev = new pageWin.KeyboardEvent('keydown', { key: e.key, code: e.code, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true })
  pageWin.dispatchEvent(ev)
  if (ev.defaultPrevented || ((e.ctrlKey || e.metaKey) && /^[szy]$/i.test(e.key))) e.preventDefault()
})
window.addEventListener('keyup', (e) => e.code === 'Space' && holdSpace(false))

/* ---------------- full page ---------------- */

async function fullPage() {
  if (!pageWin) return
  if (ctl && !(await ctl.readyToLeave())) return
  location.href = pageWin.location.href
}
