/**
 * THE EDITOR'S OWN SURFACES, in a shadow root so the page's CSS cannot
 * reach them and theirs cannot reach the page. Everything is fixed to the
 * viewport and passes the pointer through except the parts meant to be
 * touched.
 */

export const ICONS = {
  pencil: '<path d="M10.8 2.7l2.5 2.5L5.6 12.9 2.5 13.5l.6-3.1z"/><path d="M9.4 4.1l2.5 2.5"/>',
  eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  undo: '<path d="M5.5 3.5L2.5 6.5l3 3"/><path d="M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7"/>',
  redo: '<path d="M10.5 3.5l3 3-3 3"/><path d="M13.5 6.5H6a3.5 3.5 0 0 0 0 7h3"/>',
  freeze: '<path d="M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5"/><path d="M6.2 2.6L8 4.2l1.8-1.6M6.2 13.4L8 11.8l1.8 1.6"/>',
  flipH: '<path d="M8 1.5v13" stroke-dasharray="1.6 1.6"/><path d="M6 4L2 12h4zM10 4l4 8h-4z"/>',
  flipV: '<path d="M1.5 8h13" stroke-dasharray="1.6 1.6"/><path d="M4 6l8-4v4zM4 10l8 4v-4z"/>',
  drop: '<path d="M8 1.8s4.3 4.6 4.3 7.7a4.3 4.3 0 0 1-8.6 0C3.7 6.4 8 1.8 8 1.8z"/>',
  trash: '<path d="M2.5 4.5h11M6.3 4.5V2.8h3.4v1.7M4.2 4.5l.7 8.7h6.2l.7-8.7"/>',
  open: '<path d="M9.5 2.5h4v4M13.5 2.5L8 8M11.5 9v4.5h-9v-9H7"/>',
  check: '<path d="M3 8.5l3.2 3L13 4.5"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  chevron: '<path d="M4.5 6.5L8 10l3.5-3.5"/>',
  pipette: '<path d="M10.2 2.4a1.9 1.9 0 0 1 2.7 2.7l-1.5 1.5-2.7-2.7z"/><path d="M8.9 4.6l2.5 2.5-5.6 5.6-2.8.6.6-2.8z"/>',
  reload: '<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 2.5v3h-3"/>',
  help: '<circle cx="8" cy="8" r="6.2"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4"/><circle cx="8" cy="11.6" r=".4" fill="currentColor"/>',
  reset: '<path d="M3 3v3.5h3.5"/><path d="M3.3 6.3A5 5 0 1 1 3 8.5"/>',
  up: '<path d="M4.5 9.5L8 6l3.5 3.5"/>',
  min: '<path d="M3.5 8h9"/>',
  back: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
  fwd: '<path d="M6 3.5L10.5 8 6 12.5"/>',
  link: '<path d="M6.6 9.4l2.8-2.8"/><path d="M7.4 4.6l1-1a2.6 2.6 0 0 1 3.7 3.7l-1 1"/><path d="M8.6 11.4l-1 1a2.6 2.6 0 0 1-3.7-3.7l1-1"/>',
  magnet: '<path d="M3.5 2.5v5.5a4.5 4.5 0 0 0 9 0V2.5"/><path d="M3.5 5.5h2.5M10 5.5h2.5"/><path d="M6 2.5v5.5a2 2 0 0 0 4 0V2.5"/>',
  search: '<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2l3.3 3.3"/>',
  play: '<path d="M5 3.2v9.6L12.6 8z"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  dock: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M5.6 2.8v10.4M10.4 2.8v10.4"/>',
  expand: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
  layers: '<path d="M8 2.2L14 5.4 8 8.6 2 5.4z"/><path d="M2 8.2l6 3.2 6-3.2"/><path d="M2 11l6 3.2 6-3.2"/>',
  monitor: '<rect x="1.8" y="2.6" width="12.4" height="8.4" rx="1.2"/><path d="M5.5 13.6h5M8 11v2.6"/>',
  tablet: '<rect x="3.2" y="1.8" width="9.6" height="12.4" rx="1.4"/><path d="M7.2 12.2h1.6"/>',
  phone: '<rect x="4.6" y="1.6" width="6.8" height="12.8" rx="1.4"/><path d="M7.3 12.5h1.4"/>',
  sideL: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M5.8 2.8v10.4"/>',
  sideR: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M10.2 2.8v10.4"/>',
  eyeOff: '<path d="M2 2l12 12"/><path d="M6.4 3.8A6.8 6.8 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a11.6 11.6 0 0 1-1.9 2.4M4.2 5.2A11.4 11.4 0 0 0 1.5 8S4 12.5 8 12.5a6.4 6.4 0 0 0 2.6-.6"/>',
  code: '<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5"/>',
  alignL: '<path d="M2.5 2v12"/><rect x="4.5" y="4" width="8" height="3" rx="1"/><rect x="4.5" y="9" width="5" height="3" rx="1"/>',
  alignC: '<path d="M8 2v12"/><rect x="3" y="4" width="10" height="3" rx="1"/><rect x="5" y="9" width="6" height="3" rx="1"/>',
  alignR: '<path d="M13.5 2v12"/><rect x="3.5" y="4" width="8" height="3" rx="1"/><rect x="6.5" y="9" width="5" height="3" rx="1"/>',
  alignT: '<path d="M2 2.5h12"/><rect x="4" y="4.5" width="3" height="8" rx="1"/><rect x="9" y="4.5" width="3" height="5" rx="1"/>',
  alignM: '<path d="M2 8h12"/><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="5" width="3" height="6" rx="1"/>',
  alignB: '<path d="M2 13.5h12"/><rect x="4" y="3.5" width="3" height="8" rx="1"/><rect x="9" y="6.5" width="3" height="5" rx="1"/>',
  distH: '<path d="M2 2.5v11M14 2.5v11"/><rect x="6" y="5" width="4" height="6" rx="1"/>',
  distV: '<path d="M2.5 2h11M2.5 14h11"/><rect x="5" y="6" width="6" height="4" rx="1"/>',
  text: '<path d="M3.5 4h9M8 4v8.5M6.2 12.5h3.6"/>',
  minus: '<path d="M4 8h8"/>',
  plus: '<path d="M4 8h8M8 4v8"/>',
  target: '<path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3"/><rect x="5.5" y="5.5" width="5" height="5" rx="1"/>',
}

export const icon = (name, size = 16) =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`

/**
 * The studio's zoom keys, read the same way in the studio and in the page:
 * Ctrl + and Ctrl - step, Ctrl 0 is 100%; Shift 1 fits, Shift 2 closes in
 * on the selection and Shift 0 is 100%, as in design tools. By the key's
 * position (`code`), so a keyboard whose Shift+1 is not ! still works.
 */
export function zoomKeyOf(e) {
  const mod = e.ctrlKey || e.metaKey
  if (mod && !e.altKey && (e.key === '=' || e.key === '+')) return 'in'
  if (mod && !e.altKey && (e.key === '-' || e.key === '_')) return 'out'
  if (mod && !e.altKey && e.key === '0') return 'actual'
  if (e.shiftKey && !mod && !e.altKey) return { Digit1: 'fit', Digit2: 'selection', Digit0: 'actual' }[e.code] ?? null
  return null
}

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'html') el.innerHTML = v
    else if (k === 'text') el.textContent = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  return el
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.14) transparent; }
/* slim and quiet: a thin thumb on nothing, where a browser still draws its own */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.26); background-clip: padding-box; }
::-webkit-scrollbar-button { display: none; }
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font: 500 12.5px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #f4f4f5; -webkit-font-smoothing: antialiased; }
.panel { pointer-events: auto; background: rgba(22, 22, 27, 0.94); border: 1px solid rgba(255,255,255,0.09); border-radius: 12px; box-shadow: 0 10px 34px rgba(0,0,0,0.38), 0 1px 0 rgba(255,255,255,0.04) inset; backdrop-filter: blur(16px) saturate(1.4); -webkit-backdrop-filter: blur(16px) saturate(1.4); }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; min-width: 28px; padding: 0 8px; border-radius: 8px; white-space: nowrap; }
button:hover { background: rgba(255,255,255,0.08); }
button:active { background: rgba(255,255,255,0.13); }
button:disabled { opacity: 0.35; pointer-events: none; }
button.on { background: rgba(13,153,255,0.18); color: #7cc5ff; }
button.primary { background: #0D99FF; color: #fff; padding: 0 12px; font-weight: 650; }
button.primary:hover { background: #2aa5ff; }
button.danger:hover { background: rgba(239,68,68,0.18); color: #fca5a5; }
input { font: inherit; color: inherit; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); border-radius: 7px; height: 26px; padding: 0 8px; outline: none; min-width: 0; }
input:focus { border-color: #0D99FF; background: rgba(13,153,255,0.08); }
.sep { width: 1px; height: 18px; background: rgba(255,255,255,0.1); margin: 0 3px; flex: none; }
.muted { color: #a1a1aa; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }

/* toolbar: docked at the BOTTOM, because the top of a page is where its own navigation lives */
.bar { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 2px; padding: 5px; max-width: calc(100vw - 20px); }
.bar.free { bottom: auto; transform: none; }
.root.view .edit-only { display: none; }
.root.view .bar .pending:not(.has), .root.view .bar .primary:disabled { display: none; }
.brand { display: flex; align-items: center; gap: 7px; padding: 0 8px 0 4px; font-weight: 700; letter-spacing: -0.01em; cursor: grab; height: 28px; border-radius: 8px; user-select: none; touch-action: none; }
.brand:hover { background: rgba(255,255,255,0.06); }
.brand:active { cursor: grabbing; }
.dot { width: 14px; height: 14px; border-radius: 50%; background: conic-gradient(from 210deg, #0D99FF, #8b5cf6, #ec4899, #0D99FF); box-shadow: 0 0 0 2px rgba(255,255,255,0.08); flex: none; }
.seg { display: flex; background: rgba(255,255,255,0.05); border-radius: 9px; padding: 2px; }
.seg button { height: 24px; padding: 0 9px; }
.seg button.on { background: rgba(255,255,255,0.12); color: #fff; }
.path { width: 190px; }
.pending { color: #a1a1aa; }
.pending.has { color: #fde68a; }
.badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: rgba(253,230,138,0.16); color: #fde68a; font-size: 11px; font-weight: 700; }
.check { gap: 6px; color: #a1a1aa; }
.check i { width: 8px; height: 8px; border-radius: 50%; background: #52525b; display: inline-block; }
.check.passed i { background: #22c55e; } .check.failed i { background: #ef4444; } .check.running i { background: #f59e0b; animation: pulse 1s infinite; }
.check.failed { color: #fca5a5; }
@keyframes pulse { 50% { opacity: .35; } }
.collapsed .bar > :not(.brand) { display: none; }

/* overlays on the page */
.hover { position: absolute; border: 1px solid rgba(13,153,255,0.75); border-radius: 2px; display: none; }
.hover .tag { position: absolute; left: -1px; top: -19px; height: 17px; padding: 0 6px; border-radius: 4px 4px 4px 0; background: rgba(13,153,255,0.9); color: #fff; font-size: 10.5px; font-weight: 650; line-height: 17px; white-space: nowrap; }
.sel { position: absolute; display: none; }
.sel .box { position: absolute; inset: 0; border: 1.5px solid #0D99FF; pointer-events: auto; cursor: move; }
.sel.shared .box { border-color: #f59e0b; }
.sel .handle { position: absolute; width: 9px; height: 9px; background: #fff; border: 1.5px solid #0D99FF; border-radius: 2px; pointer-events: auto; transform: translate(-50%, -50%); }
.sel.shared .handle { border-color: #f59e0b; }
.sel .nw { left: 0; top: 0; cursor: nwse-resize; } .sel .ne { left: 100%; top: 0; cursor: nesw-resize; }
.sel .sw { left: 0; top: 100%; cursor: nesw-resize; } .sel .se { left: 100%; top: 100%; cursor: nwse-resize; }
.sel .stem { position: absolute; left: 50%; top: -22px; width: 1px; height: 22px; background: #0D99FF; }
.sel.shared .stem { background: #f59e0b; }
.sel .rot { position: absolute; left: 50%; top: -30px; width: 13px; height: 13px; border-radius: 50%; background: #fff; border: 1.5px solid #0D99FF; transform: translate(-50%, 0); pointer-events: auto; cursor: grab; }
.sel.shared .rot { border-color: #f59e0b; }
.sel .label { position: absolute; left: -1.5px; top: -42px; height: 18px; display: flex; align-items: center; gap: 5px; padding: 0 7px; border-radius: 5px; background: #0D99FF; color: #fff; font-size: 11px; font-weight: 650; white-space: nowrap; }
.sel.shared .label { background: #f59e0b; color: #1c1917; }
.sel .label .dims { opacity: 0.75; font-weight: 600; padding-left: 6px; border-left: 1px solid rgba(255,255,255,0.35); }
.sel.shared .label .dims { border-left-color: rgba(28,25,23,0.3); }

/* exact numbers in the inspector */
.nfs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-top: 10px; }
.nf { display: flex; align-items: center; gap: 3px; height: 28px; padding: 0 6px; border-radius: 7px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.06); }
.nf:focus-within { border-color: #0D99FF; background: rgba(13,153,255,0.08); }
.nf span { color: #a1a1aa; font-size: 10.5px; font-weight: 650; }
.nf input { width: 100%; min-width: 0; height: 22px; padding: 0; border: 0; background: none; text-align: right; font-size: 11.5px; }
.nf input:focus { background: none; }
.nf i { font-style: normal; color: #71717a; font-size: 10px; }
.sel.notransform .handle, .sel.notransform .rot, .sel.notransform .stem { display: none; }
.sel.notransform .box { cursor: default; }
.sel .actions { position: absolute; left: 50%; top: calc(100% + 10px); transform: translateX(-50%); display: flex; gap: 1px; padding: 3px; }
.sel .actions button { height: 26px; min-width: 26px; padding: 0 6px; }
.readout { position: absolute; padding: 3px 7px; border-radius: 6px; background: rgba(22,22,27,0.92); color: #fff; font-size: 11px; display: none; white-space: nowrap; }
.editing { position: absolute; border: 1.5px dashed #0D99FF; border-radius: 3px; display: none; }
.peer { position: absolute; border: 1px dashed rgba(245,158,11,0.8); border-radius: 2px; }
.edited { position: absolute; border: 1px dashed rgba(13,153,255,0.55); border-radius: 2px; }

/* smart guides: thin, pink, crisp; faint on a still selection, full while dragging */
.guides { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.guides .g { stroke: #ff3b8d; stroke-width: 1; fill: none; shape-rendering: crispEdges; }
.guides .g.dashed { stroke-dasharray: 4 3; }
.guides .g.x { shape-rendering: auto; }
.guides.faint .g { opacity: 0.4; }
.guides.faint .label { opacity: 0.6; }
.guides .label rect { fill: #ff3b8d; }
.guides .label text { fill: #fff; font: 650 10.5px ui-sans-serif, system-ui, sans-serif; text-anchor: middle; }

/* inspector */
.inspector { position: absolute; left: 14px; bottom: 64px; width: 340px; max-height: calc(100vh - 120px); overflow: auto; padding: 10px 12px; display: none; overscroll-behavior: contain; }
.inspector h3 { margin: 0; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 6px; }
.inspector .where { margin-top: 2px; display: flex; align-items: center; gap: 4px; }
.inspector .where a { color: #7cc5ff; text-decoration: none; cursor: pointer; }
.inspector .where a:hover { text-decoration: underline; }
.rows { margin-top: 10px; display: grid; gap: 6px; }
.row { display: grid; grid-template-columns: 64px 1fr; gap: 8px; align-items: baseline; }
.row b { font-weight: 600; color: #a1a1aa; font-size: 11.5px; }
.note { margin-top: 10px; padding: 8px 9px; border-radius: 8px; background: rgba(245,158,11,0.12); color: #fde68a; font-size: 12px; }
.note.info { background: rgba(13,153,255,0.12); color: #bae6fd; }
.crumbs { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 3px; }
.crumbs button { height: 22px; padding: 0 7px; font-size: 11px; background: rgba(255,255,255,0.05); }
.crumbs button.on { background: rgba(13,153,255,0.2); color: #7cc5ff; }
.tools { margin-top: 10px; display: flex; gap: 2px; flex-wrap: wrap; }

/* lists, dialogs, toasts */
.menu { position: absolute; left: 50%; bottom: 62px; width: 380px; max-width: calc(100vw - 20px); max-height: 50vh; overflow: auto; padding: 6px; display: none; }
.menu .item { padding: 7px 8px; border-radius: 7px; display: flex; gap: 8px; align-items: baseline; }
.menu .item:hover { background: rgba(255,255,255,0.05); }
.menu .page { display: flex; width: 100%; height: auto; min-height: 30px; justify-content: space-between; align-items: center; gap: 12px; padding: 5px 8px; text-align: left; white-space: normal; }
.menu .page .mono { color: #7cc5ff; flex: none; }
.menu .page.here .mono { color: #a1a1aa; }
.menu .page span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu h6 { margin: 4px 8px 6px; font-size: 11px; font-weight: 650; color: #a1a1aa; }
.menu .empty { padding: 10px; color: #a1a1aa; }
.menu pre { margin: 0; padding: 8px; white-space: pre-wrap; word-break: break-word; max-height: 40vh; overflow: auto; font-size: 11px; color: #d4d4d8; }
.dialog { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); width: 400px; max-width: calc(100vw - 28px); padding: 14px; display: none; }
.dialog h4 { margin: 0 0 6px; font-size: 14px; }
.dialog p { margin: 0 0 12px; color: #d4d4d8; }
.dialog .choices { display: grid; gap: 5px; margin-bottom: 12px; max-height: 40vh; overflow: auto; }
.dialog .choice { display: block; width: 100%; height: auto; text-align: left; padding: 8px 9px; background: rgba(255,255,255,0.04); border-radius: 8px; white-space: normal; }
.dialog .choice:hover { background: rgba(13,153,255,0.14); }
.dialog .btns { display: flex; justify-content: flex-end; gap: 6px; }
.toasts { position: absolute; bottom: 66px; left: 50%; transform: translateX(-50%); display: grid; gap: 6px; justify-items: center; }
.toast { padding: 9px 12px; max-width: min(560px, calc(100vw - 40px)); display: flex; gap: 8px; align-items: flex-start; animation: rise .18s ease-out; }
.toast.ok { border-color: rgba(34,197,94,0.35); } .toast.warn { border-color: rgba(245,158,11,0.4); } .toast.err { border-color: rgba(239,68,68,0.45); }
.toast .mark { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex: none; background: #0D99FF; }
.toast.ok .mark { background: #22c55e; } .toast.warn .mark { background: #f59e0b; } .toast.err .mark { background: #ef4444; }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } }
.help { position: absolute; bottom: 62px; right: 14px; width: 300px; padding: 12px; display: none; }
.help table { width: 100%; border-collapse: collapse; }
.help td { padding: 3px 0; vertical-align: top; }
.help td:first-child { width: 112px; color: #a1a1aa; }
kbd { font-family: inherit; font-size: 11px; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); }

/* colour panel */
.color { position: absolute; width: 284px; padding: 12px; display: none; }
.color .tabs { display: flex; gap: 2px; margin-bottom: 10px; }
.color .tabs button { height: 24px; font-size: 12px; }
.color .wheelwrap { position: relative; width: 176px; height: 176px; margin: 0 auto; }
.color canvas { width: 176px; height: 176px; border-radius: 50%; cursor: crosshair; display: block; }
.color .knob { position: absolute; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.4); transform: translate(-50%, -50%); pointer-events: none; }
.color .slider { position: relative; height: 12px; border-radius: 6px; margin-top: 12px; cursor: pointer; }
.color .slider .thumb { position: absolute; top: 50%; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.45); transform: translate(-50%, -50%); pointer-events: none; }
.color .checker { background-image: linear-gradient(45deg, #3f3f46 25%, transparent 25%, transparent 75%, #3f3f46 75%), linear-gradient(45deg, #3f3f46 25%, transparent 25%, transparent 75%, #3f3f46 75%); background-size: 8px 8px; background-position: 0 0, 4px 4px; background-color: #71717a; }
.color .hexrow { display: flex; gap: 6px; align-items: center; margin-top: 12px; }
.color .hexrow input { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-transform: uppercase; }
.color .swatch-now { width: 26px; height: 26px; border-radius: 7px; flex: none; border: 1px solid rgba(255,255,255,0.15); overflow: hidden; display: grid; grid-template-columns: 1fr 1fr; }
.color h5 { margin: 12px 0 6px; font-size: 11px; font-weight: 650; color: #a1a1aa; letter-spacing: 0.02em; display: flex; justify-content: space-between; }
.color .grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
.color .sw { width: 100%; aspect-ratio: 1; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14); cursor: pointer; padding: 0; height: auto; min-width: 0; }
.color .sw:hover { outline: 2px solid #fff; outline-offset: 1px; }
.color .sugg { display: grid; gap: 3px; }
.color .sugg button { justify-content: flex-start; height: 26px; padding: 0 6px; gap: 8px; width: 100%; }
.color .sugg .chip { width: 16px; height: 16px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.18); flex: none; }
.color .sugg .src { color: #a1a1aa; margin-left: auto; font-size: 11px; }
.color .warn { margin-top: 8px; padding: 6px 8px; border-radius: 7px; background: rgba(245,158,11,0.13); color: #fde68a; font-size: 11.5px; display: none; }
.color .foot { display: flex; justify-content: flex-end; gap: 6px; margin-top: 12px; }
.color .chead { margin-bottom: 8px; padding: 7px 9px; border-radius: 8px; background: rgba(255,255,255,0.05); display: none; overflow-wrap: anywhere; }
.color .chead .small { font-size: 11.5px; }
.color .tabs { flex-wrap: wrap; }

/* the colour picker's loupe */
.loupe { position: absolute; display: none; align-items: center; gap: 10px; padding: 8px 10px; width: 260px; pointer-events: none; }
.loupe .chip { width: 34px; height: 34px; border-radius: 9px; flex: none; position: relative; overflow: hidden; border: 1px solid rgba(255,255,255,0.2); background-image: linear-gradient(45deg, #3f3f46 25%, transparent 25%, transparent 75%, #3f3f46 75%), linear-gradient(45deg, #3f3f46 25%, transparent 25%, transparent 75%, #3f3f46 75%); background-size: 8px 8px; background-position: 0 0, 4px 4px; background-color: #71717a; }
.loupe .chip i { position: absolute; inset: 0; }
.loupe > div { display: grid; gap: 1px; min-width: 0; }
.loupe b { font-size: 13px; }
.loupe span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.small { font-size: 11px; }

/* inside the studio's frame: the studio draws the bar and the panels */
.root.embedded .bar, .root.embedded .inspector, .root.embedded .help, .root.embedded .menu { display: none !important; }
.root.embedded .toasts { bottom: 18px; }

/* ---------------- the look: one accent, quiet glass, crisp edges ---------------- */
.root { --acc: #4c8dff; --acc-2: #8b7bff; --acc-soft: rgba(76,141,255,0.16); --draw: #2dd4bf; --ink: #ededf2; --mut: #8e8e9a; color: var(--ink); }
.panel { background: rgba(20,20,25,0.92); border-color: rgba(255,255,255,0.08); box-shadow: 0 16px 48px rgba(0,0,0,0.42), 0 0 0 1px rgba(0,0,0,0.35); }
button.on { background: var(--acc-soft); color: #9ec0ff; }
button.primary { background: var(--acc); box-shadow: 0 1px 0 rgba(255,255,255,0.18) inset; }
button.primary:hover { background: #6199ff; }
button.off { opacity: 0.4; }
input:focus { border-color: var(--acc); background: rgba(76,141,255,0.08); }
.bar { padding: 5px 6px; border-radius: 14px; }
.dot { background: conic-gradient(from 210deg, var(--acc), var(--acc-2), #f472b6, var(--acc)); }
.hover { border: 1px solid rgba(76,141,255,0.9); border-radius: 3px; box-shadow: 0 0 0 1px rgba(76,141,255,0.15); }
.hover .tag { top: -21px; height: 18px; line-height: 18px; padding: 0 7px; border-radius: 5px; background: var(--acc); font-weight: 650; }
.hover.draw { border-color: var(--draw); border-style: dashed; }
.hover.draw .tag { background: #0f766e; }
.sel .box { border-color: var(--acc); border-radius: 2px; }
.sel .handle { border-color: var(--acc); width: 8px; height: 8px; border-radius: 2.5px; box-shadow: 0 1px 3px rgba(0,0,0,0.35); }
.sel .stem { background: var(--acc); }
.sel .rot { border-color: var(--acc); }
.sel.readonly .box { border-style: dashed; cursor: default; }
.sel.readonly .handle, .sel.readonly .rot, .sel.readonly .stem { display: none; }
.sel.drawing .box { border-color: var(--draw); }
.peer { border: 1px dashed rgba(45,212,191,0.75); }
.sel:not(.drawing) ~ .peers .peer, .peers .peer { border-radius: 3px; }

/* the depth rail: what the selection sits in, and what is inside it */
.sel .label { top: -34px; height: 26px; padding: 0 3px 0 3px; gap: 2px; background: rgba(20,20,25,0.94); color: var(--ink); border: 1px solid rgba(255,255,255,0.1); border-radius: 9px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); pointer-events: auto; max-width: min(640px, calc(100vw - 24px)); overflow: hidden; }
.sel.below .label { top: auto; bottom: -34px; }
.sel.below .actions { top: calc(100% + 40px); }
.sel.shared .label { background: rgba(20,20,25,0.94); color: var(--ink); }
.sel .rail { display: flex; align-items: center; gap: 1px; min-width: 0; overflow: hidden; }
.sel .rail .step { height: 20px; padding: 0 7px; border-radius: 6px; font-size: 11px; font-weight: 600; color: var(--mut); flex: none; max-width: 160px; overflow: hidden; text-overflow: ellipsis; display: inline-block; line-height: 20px; }
.sel .rail .step:hover { color: var(--ink); background: rgba(255,255,255,0.08); }
.sel .rail .step.on { background: var(--acc); color: #fff; }
.sel .rail .step.str { color: #b5a4ff; }
.sel .rail .step.draw { color: #5eead4; }
.sel .rail .step.on.draw { background: #0f766e; color: #fff; }
.sel .rail .step + .step::before, .sel .rail .fold + .step::before { content: ''; }
.sel .rail .fold { color: #5c5c66; padding: 0 3px; font-size: 11px; }
.sel .label .dims { border-left: 1px solid rgba(255,255,255,0.12); padding: 0 6px 0 8px; color: var(--mut); opacity: 1; font-variant-numeric: tabular-nums; flex: none; }
.sel.shared .label .dims { border-left-color: rgba(255,255,255,0.12); }
.sel .actions { border-radius: 10px; }

/* several at once */
.marquee { position: absolute; display: none; border: 1px solid var(--acc); background: rgba(76,141,255,0.08); border-radius: 2px; }
.members .member { position: absolute; border: 1.5px solid var(--acc); border-radius: 3px; background: rgba(76,141,255,0.07); }
.members .member.hint { border-width: 1px; border-style: dashed; border-color: rgba(76,141,255,0.55); background: none; }
.members .member.stuck { border-color: rgba(245,184,74,0.85); border-style: dashed; background: rgba(245,184,74,0.06); }
.members .member.drawing { border-color: var(--draw); background: rgba(45,212,191,0.1); }
/* the tick: what is selected, at its top right corner, ringed so it reads on any page */
.members .member .tick { position: absolute; top: -8px; right: -8px; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; background: var(--acc); color: #fff; box-shadow: 0 0 0 1.5px #fff, 0 1px 3px rgba(0,0,0,0.4); }
.members .member .tick svg { width: 10px; height: 10px; }
.members .member .tick svg path { stroke-width: 2.6; }
.members .member.drawing .tick { background: #0f766e; }
.members .member.stuck .tick { background: #b7791f; }
.members .member.small .tick { top: -10px; right: -10px; width: 12px; height: 12px; }
.members .member.small .tick svg { width: 8px; height: 8px; }
.hover.add { border-style: solid; }
.hover.takeout { border-color: #f87171; border-style: dashed; }
.hover.takeout .tag { background: #b42318; }
.sel .label .unsel { flex: none; height: 20px; min-width: 0; gap: 4px; padding: 0 8px 0 6px; margin-left: 2px; border-radius: 6px; font-size: 11px; font-weight: 600; color: var(--mut); border-left: 1px solid rgba(255,255,255,0.12); border-top-left-radius: 0; border-bottom-left-radius: 0; }
.sel .label .unsel:hover { color: var(--ink); }
.sel.group .rot, .sel.group .stem { display: none; }
.sel.group .box { border-style: solid; border-color: var(--acc); background: rgba(76,141,255,0.03); }
.sel .label .count { padding: 0 8px; font-size: 11px; font-weight: 650; color: var(--ink); }

/* right-click: everything under the pointer */
.stackmenu { position: absolute; width: 260px; max-height: 460px; overflow: auto; padding: 5px; display: none; }
.stackmenu h6 { margin: 4px 7px 5px; font-size: 10.5px; font-weight: 700; color: #6f6f7b; text-transform: uppercase; letter-spacing: 0.06em; }
.stackmenu .srow { display: grid; grid-template-columns: 10px 1fr; grid-template-rows: auto auto; column-gap: 8px; width: 100%; height: auto; min-height: 28px; padding: 4px 8px; justify-content: stretch; text-align: left; border-radius: 7px; }
.stackmenu .srow i { width: 7px; height: 7px; border-radius: 50%; background: var(--acc); align-self: center; grid-row: 1 / span 2; }
.stackmenu .srow.str i { background: var(--acc-2); }
.stackmenu .srow.drawing i { background: var(--draw); border-radius: 2px; }
.stackmenu .srow .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stackmenu .srow .sb { grid-column: 2; color: var(--mut); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stackmenu .srow:hover { background: var(--acc-soft); }
.stackmenu { max-height: min(560px, calc(100vh - 8px)); }
.stackmenu .act { display: flex; width: 100%; height: 28px; padding: 0 8px; justify-content: space-between; gap: 10px; border-radius: 7px; font-weight: 600; }
.stackmenu .act:hover { background: var(--acc-soft); }
.stackmenu .act.off { opacity: 0.38; }
.stackmenu .act .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stackmenu kbd { flex: none; font: 600 10px/1 inherit; font-family: inherit; padding: 3px 5px; border-radius: 5px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1); color: #a1a1aa; }
.stackmenu h6 + .act { margin-top: 1px; }
.stackmenu .act + h6 { margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.07); }

/* where a hovered colour sits: its shape dashed, and the area that colour owns tinted and outlined, dark under light */
.tones { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; display: none; pointer-events: none; }
.tonecanvas { position: absolute; display: none; pointer-events: none; }
/* a colour nothing shows: where it would be, dashed and untinted, with a word saying so */
.tones .covered { fill: none; stroke: rgba(255,255,255,0.85); stroke-width: calc(1.5px * var(--inv, 1)); stroke-dasharray: 6 5; }
.tones .covtag { fill: #fff; font: 650 calc(12px * var(--inv, 1)) ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; paint-order: stroke; stroke: rgba(0,0,0,0.8); stroke-width: calc(3px * var(--inv, 1)); stroke-linejoin: round; }
.tones .shape { fill: none; stroke: rgba(255,255,255,0.7); stroke-width: calc(1px * var(--inv, 1)); stroke-dasharray: 4 3; }
.tones .tint { fill: rgba(255,255,255,0.16); stroke: none; }
.tones .under { fill: none; stroke: rgba(0,0,0,0.7); stroke-width: calc(5px * var(--inv, 1)); stroke-linejoin: round; }
.tones .over { fill: none; stroke: #fff; stroke-width: calc(2.5px * var(--inv, 1)); stroke-linejoin: round; }
/* a line that carries the colour: drawn over itself, wider, light on dark */
.tones .under.line { stroke-width: calc(var(--lw, 1px) + 6px * var(--inv, 1)); stroke-linecap: round; }
.tones .over.line { stroke-width: calc(var(--lw, 1px) + 2px * var(--inv, 1)); stroke-linecap: round; }

/* the studio's zoom (--inv is one over the page's scale): the chrome stays one size on screen, what it outlines scales */
.sel .label, .sel .actions, .sel .handle, .sel .rot, .sel .stem, .hover .tag, .members .member .tick { zoom: var(--inv, 1); }
.sel .box, .members .member, .editing { border-width: calc(1.5px * var(--inv, 1)); }
.hover, .peer, .edited, .marquee, .members .member.hint { border-width: calc(1px * var(--inv, 1)); }
.guides .g { stroke-width: calc(1px * var(--inv, 1)); }
`

export function createUI() {
  const host = document.createElement('retouch-editor')
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block;'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.append(h('style', { text: CSS }))
  const root = h('div', { class: 'root' })
  shadow.append(root)
  document.documentElement.append(host)

  const hover = h('div', { class: 'hover' }, h('span', { class: 'tag' }))
  const sel = h(
    'div',
    { class: 'sel' },
    h('div', { class: 'box' }),
    h('div', { class: 'stem' }),
    h('div', { class: 'rot', title: 'Rotate (hold Shift to snap)' }),
    ...['nw', 'ne', 'sw', 'se'].map((c) => h('div', { class: `handle ${c}`, 'data-corner': c, title: 'Resize' })),
    h('div', { class: 'label' }),
    h('div', { class: 'actions panel' }),
  )
  const readout = h('div', { class: 'readout' })
  const editing = h('div', { class: 'editing' })
  const peers = h('div', { class: 'peers' })
  const edited = h('div', { class: 'edited-boxes' })
  const guidesHost = h('div', { class: 'guides-host' })
  const bar = h('div', { class: 'bar panel' })
  const menu = h('div', { class: 'menu panel' })
  const inspector = h('div', { class: 'inspector panel' })
  const dialog = h('div', { class: 'dialog panel' })
  const help = h('div', { class: 'help panel' })
  const color = h('div', { class: 'color panel' })
  const toasts = h('div', { class: 'toasts' })
  const stackMenu = h('div', { class: 'stackmenu panel' })
  // several at once: the box being dragged out, and an outline on every item it takes
  const marquee = h('div', { class: 'marquee' })
  const members = h('div', { class: 'members' })
  root.append(edited, peers, members, hover, guidesHost, editing, marquee, sel, readout, bar, menu, inspector, color, dialog, help, stackMenu, toasts)

  const place = (el, r) => {
    el.style.left = `${r.left}px`
    el.style.top = `${r.top}px`
    el.style.width = `${Math.max(0, r.width)}px`
    el.style.height = `${Math.max(0, r.height)}px`
  }

  function toast(message, kind = 'info', ms = 4200) {
    const t = h('div', { class: `toast panel ${kind}` }, h('span', { class: 'mark' }), h('span', { text: message }))
    toasts.append(t)
    while (toasts.children.length > 4) toasts.firstChild.remove()
    setTimeout(() => t.remove(), ms)
    return t
  }

  /**
   * A small modal: a question, optional choices, buttons. Resolves with what
   * was picked: true for OK, a choice's value, a button's value, or null.
   */
  function ask({ title, text, choices, buttons, ok = 'OK', cancel = 'Cancel', danger = false }) {
    return new Promise((done) => {
      dialog.replaceChildren()
      const finish = (v) => {
        dialog.style.display = 'none'
        done(v)
      }
      dialog.append(h('h4', { text: title }))
      if (text) dialog.append(h('p', { text }))
      if (choices?.length) {
        dialog.append(
          h(
            'div',
            { class: 'choices' },
            choices.map((c) => h('button', { class: 'choice', onclick: () => finish(c.value) }, h('div', { class: 'mono', text: c.title }), c.detail ? h('div', { class: 'muted', text: c.detail }) : null)),
          ),
        )
      }
      const btns = h('div', { class: 'btns' })
      if (cancel) btns.append(h('button', { text: cancel, onclick: () => finish(null) }))
      if (buttons?.length) for (const b of buttons) btns.append(h('button', { class: b.primary ? 'primary' : b.danger ? 'danger' : '', text: b.label, onclick: () => finish(b.value) }))
      else if (ok && !choices?.length) btns.append(h('button', { class: danger ? 'primary danger' : 'primary', text: ok, onclick: () => finish(true) }))
      dialog.append(btns)
      dialog.style.display = 'block'
      dialog.querySelector('button.primary, button.choice')?.focus()
    })
  }

  const isOurs = (e) => e.composedPath?.().includes(host)

  return { host, shadow, root, hover, sel, readout, editing, peers, edited, guidesHost, bar, menu, inspector, dialog, help, color, toasts, stackMenu, marquee, members, place, toast, ask, isOurs }
}
