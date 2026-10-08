import { describeColor } from './pick.js'
import { h, icon } from './ui.js'

/**
 * THE PROPERTIES PANEL.
 *
 * Everything about the selection that can be read or changed, in tabs:
 *
 *   Design    where it sits, its size and spacing, its type, its fill and border
 *   Settings  the values in CODE that decide how it works: this instance's
 *             props, its component's defaults and named constants, its timing
 *   Motion    the page's clock, its animations as keyframe timelines, and what
 *             script moves it
 *   Source    where every part of it is written
 *
 * A drawing on a canvas gets its own first tab (Drawing). The panel is drawn
 * into the studio's side panel or the page's own inspector - the same code
 * in either document - and asks the editor (`ctl`, see app.js) for every
 * value and every change, so nothing here holds state of its own beyond
 * which tab and sections are open.
 *
 * A style is changed on THIS element by default: an inline style (JSX) or
 * a style attribute (HTML). Where the value comes from a rule that is
 * written in the project, the row offers to change the rule instead, and
 * says how many elements that reaches.
 */

const LAYOUT = [
  { prop: 'width', label: 'Width' },
  { prop: 'height', label: 'Height' },
  { prop: 'margin', label: 'Margin', box: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] },
  { prop: 'padding', label: 'Padding', box: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] },
  { prop: 'gap', label: 'Gap', when: (s) => /flex|grid/.test(s.display) },
  { prop: 'z-index', label: 'Layer' },
]
const TYPE = [
  { prop: 'font-size', label: 'Size' },
  { prop: 'font-weight', label: 'Weight', options: ['100', '200', '300', '400', '500', '600', '700', '800', '900'] },
  { prop: 'font-style', label: 'Style', options: ['normal', 'italic', 'oblique'] },
  { prop: 'text-decoration-line', label: 'Underline', options: ['none', 'underline', 'line-through', 'overline'] },
  { prop: 'line-height', label: 'Line height' },
  { prop: 'letter-spacing', label: 'Tracking' },
  { prop: 'text-align', label: 'Align', options: ['left', 'center', 'right', 'justify', 'start', 'end'] },
  { prop: 'text-transform', label: 'Case', options: ['none', 'uppercase', 'lowercase', 'capitalize'] },
  { prop: 'color', label: 'Colour', color: true },
  { prop: 'font-family', label: 'Font' },
]
const FILL = [
  { prop: 'background-color', label: 'Fill', color: true },
  { prop: 'opacity', label: 'Opacity', range: [0, 1, 0.01] },
  { prop: 'border-radius', label: 'Corners' },
  { prop: 'border-width', label: 'Border' },
  { prop: 'border-style', label: 'Line', options: ['none', 'solid', 'dashed', 'dotted', 'double'] },
  { prop: 'border-color', label: 'Border colour', color: true },
  { prop: 'box-shadow', label: 'Shadow' },
]
const SVG_FILL = [
  { prop: 'fill', label: 'Fill', color: true },
  { prop: 'stroke', label: 'Stroke', color: true },
  { prop: 'stroke-width', label: 'Stroke W' },
  { prop: 'opacity', label: 'Opacity', range: [0, 1, 0.01] },
]
const TIMING = [
  { prop: 'animation-duration', label: 'Duration' },
  { prop: 'animation-delay', label: 'Delay' },
  { prop: 'animation-timing-function', label: 'Easing' },
  { prop: 'animation-iteration-count', label: 'Repeats' },
  { prop: 'transition-duration', label: 'Transition' },
  { prop: 'transition-delay', label: 'Trans. delay' },
]

export const INSPECTOR_CSS = `
.ix { --acc: #4c8dff; --acc-soft: rgba(76,141,255,0.15); --draw: #2dd4bf; --ink: #ededf2; --mut: #8e8e9a; --faint: #5c5c66; --line: rgba(255,255,255,0.07); --field: rgba(255,255,255,0.045);
  font: 500 12.5px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); }
.ix .mono, .ix input.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.ix, .ix * { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.14) transparent; }
.ix .muted { color: var(--mut); }
.ix .small { font-size: 11.5px; }
.ix button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 26px; min-width: 26px; padding: 0 7px; border-radius: 7px; white-space: nowrap; }
.ix button:hover { background: rgba(255,255,255,0.07); }
.ix button.on { background: var(--acc-soft); color: #9ec0ff; }
.ix button.danger:hover { background: rgba(255,107,107,0.16); color: #ffb4b4; }
.ix button:disabled { opacity: 0.32; pointer-events: none; }
.ix button.ghost { color: var(--mut); }
.ix input, .ix select { font: inherit; color: inherit; background: var(--field); border: 1px solid var(--line); border-radius: 7px; height: 26px; padding: 0 7px; outline: none; min-width: 0; width: 100%; box-sizing: border-box; transition: border-color .12s, background .12s; }
.ix input:hover, .ix select:hover { border-color: rgba(255,255,255,0.12); }
.ix select { padding: 0 3px; }
.ix select option { background: #1c1c22; }
.ix input:focus, .ix select:focus { border-color: var(--acc); background: rgba(76,141,255,0.07); box-shadow: 0 0 0 3px rgba(76,141,255,0.15); }
.ix a.loc { color: #8db4ff; text-decoration: none; cursor: pointer; word-break: break-all; }
.ix a.loc:hover { text-decoration: underline; }

/* header */
.ix .head { padding: 4px 2px 10px; }
.ix .head h3 { margin: 0; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; letter-spacing: -0.01em; }
.ix .kind { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 6px; letter-spacing: 0.04em; text-transform: uppercase; }
.ix .kind.jsx { background: rgba(76,141,255,0.16); color: #9ec0ff; }
.ix .kind.html { background: rgba(139,123,255,0.18); color: #c6bbff; }
.ix .kind.script { background: rgba(245,184,74,0.14); color: #f7d38e; }
.ix .kind.drawing { background: rgba(45,212,191,0.15); color: #7ee8d8; }
.ix .where { margin-top: 3px; font-size: 11.5px; }
.ix .crumbs { display: flex; gap: 2px; margin-top: 8px; overflow-x: auto; scrollbar-width: none; padding-bottom: 1px; }
.ix .crumbs button { height: 22px; font-size: 11.5px; color: var(--mut); padding: 0 7px; flex: none; }
.ix .crumbs button + button::before { content: ''; }
.ix .crumbs button.on { background: var(--acc); color: #fff; }
.ix .crumbs button.draw { color: #7ee8d8; }
.ix .crumbs button.on.draw { background: #0f766e; color: #fff; }
.ix .acts { display: flex; flex-wrap: wrap; gap: 1px; padding: 2px 0 8px; }
.ix .acts button { color: #c9c9d2; }
.ix .acts button.unsel { margin-left: auto; gap: 5px; padding: 0 10px; font-size: 11.5px; font-weight: 600; border: 1px solid var(--line); border-radius: 8px; }
.ix .acts button.unsel:hover { color: var(--ink); border-color: rgba(255,255,255,0.18); }
.ix .wordsbox { display: grid; gap: 4px; margin: 2px 0 10px; }
.ix textarea.words { width: 100%; resize: vertical; min-height: 34px; padding: 7px 9px; border-radius: 8px; background: var(--field); border: 1px solid var(--line); color: var(--ink); font: inherit; font-size: 12.5px; line-height: 1.45; outline: none; }
.ix textarea.words:focus { border-color: var(--acc); }
.ix .stylecard { border: 1px solid var(--line); border-radius: 10px; padding: 8px 9px; margin: 0 0 8px; background: rgba(255,255,255,0.02); display: grid; gap: 6px; }
.ix .stylecard .sum { color: var(--ink); white-space: normal; overflow-wrap: anywhere; }
.ix .stylecard .btns { display: flex; gap: 4px; flex-wrap: wrap; }
.ix .stylecard .btns button { height: 26px; font-size: 11.5px; border: 1px solid var(--line); }
.ix button.off { opacity: 0.4; }
.ix .gradrows { margin: 0 0 6px; }
.ix .gradrows .row { border-radius: 7px; }
.ix .gradrows .row:hover, .ix .row[data-prop]:hover { background: rgba(255,255,255,0.03); }
.ix .statehead { display: flex; align-items: center; justify-content: space-between; margin: 12px 0 2px; }
.ix .statehead b { font-size: 12px; }
.ix .statehead button { height: 24px; font-size: 11px; border: 1px solid var(--line); }
.ix .statesel { margin: 0 0 2px; overflow-wrap: anywhere; }
.ix .gsw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 7px; vertical-align: -1px; box-shadow: 0 0 0 1px rgba(255,255,255,0.18); }

/* tabs */
.ix .tabs { position: sticky; top: -8px; z-index: 2; display: flex; gap: 2px; padding: 4px; margin: 0 -2px 8px; background: #141418; border: 1px solid var(--line); border-radius: 10px; }
.ix .tabs button { flex: 1; height: 26px; font-size: 12px; font-weight: 600; color: var(--mut); border-radius: 7px; }
.ix .tabs button.on { background: rgba(255,255,255,0.09); color: var(--ink); box-shadow: 0 1px 0 rgba(255,255,255,0.05) inset; }

/* sections and cards */
.ix .sec { border-top: 1px solid var(--line); }
.ix .sec:first-of-type { border-top: 0; }
.ix .sec > .sh { display: flex; align-items: center; width: 100%; justify-content: space-between; height: 34px; padding: 0 2px; font-weight: 700; font-size: 11px; color: var(--mut); text-transform: uppercase; letter-spacing: 0.06em; border-radius: 0; }
.ix .sec > .sh:hover { background: none; color: var(--ink); }
.ix .sec > .sh svg { transition: transform .15s; }
.ix .sec.shut > .sh svg { transform: rotate(-90deg); }
.ix .sec > .sb { padding: 0 2px 12px; }
.ix .sec.shut > .sb { display: none; }
.ix .card { border: 1px solid var(--line); border-radius: 11px; padding: 10px; margin-bottom: 8px; background: rgba(255,255,255,0.018); }
.ix .card > .ct { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 2px; }
.ix .card > .ct b { font-size: 12.5px; }
.ix .card > .cs { color: var(--mut); font-size: 11.5px; margin-bottom: 8px; }
.ix .hint { color: var(--mut); font-size: 11.5px; padding: 2px 2px 10px; line-height: 1.5; }

/* rows */
.ix .row { display: grid; grid-template-columns: 82px 1fr auto; align-items: center; gap: 6px; margin: 4px 0; }
.ix .row > label { color: var(--mut); font-size: 11.5px; display: flex; align-items: center; gap: 6px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ix .row > label.scrub { cursor: ew-resize; user-select: none; }
.ix .row > label.scrub:hover { color: var(--ink); }
.ix .row > label i { width: 6px; height: 6px; border-radius: 50%; flex: none; background: transparent; border: 1px solid rgba(255,255,255,0.18); }
.ix .row > label i.inline { background: var(--acc); border-color: var(--acc); }
.ix .row > label i.rule { background: #9a9aa6; border-color: #9a9aa6; }
.ix .row > label i.inherited { border-color: #9a9aa6; }
.ix .row > label i.edited { background: #fcd34d; border-color: #fcd34d; }
.ix .row .tail { display: flex; gap: 1px; }
.ix .row .tail button { height: 22px; min-width: 22px; padding: 0 5px; font-size: 10.5px; color: var(--mut); }
.ix .row .tail button.on { color: #9ec0ff; background: var(--acc-soft); }
.ix .row .desc { grid-column: 1 / -1; color: var(--faint); font-size: 11px; margin: -2px 0 2px; line-height: 1.4; }
.ix .row.unset > label { font-style: italic; }
.ix .box4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; }
.ix .colorrow { display: flex; gap: 6px; align-items: center; min-width: 0; }
.ix .colorrow > .mono { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ix .row.covered .colorrow::after { content: 'covered'; flex: none; font-size: 10px; font-weight: 650; color: var(--mut); padding: 1px 5px; border: 1px dashed rgba(255,255,255,0.25); border-radius: 5px; }
.ix .row > * { min-width: 0; }
/* a narrow panel: labels give up width first, and nothing runs into the button beside it */
.ix { container-type: inline-size; }
@container (max-width: 300px) {
  .ix .row { grid-template-columns: 60px minmax(0, 1fr) auto; gap: 4px; }
  .ix .row > button { padding: 0 6px; font-size: 11px; }
  .ix .acts button.unsel span { display: none; }
}
.ix .sw { width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.16); flex: none; padding: 0; min-width: 0; background-image: linear-gradient(45deg, #3f3f46 25%, transparent 25%, transparent 75%, #3f3f46 75%), linear-gradient(45deg, #3f3f46 25%, transparent 25%, transparent 75%, #3f3f46 75%); background-size: 8px 8px; background-position: 0 0, 4px 4px; background-color: #71717a; position: relative; overflow: hidden; }
.ix .sw > span { position: absolute; inset: 0; }
.ix .switch { width: 34px; height: 20px; min-width: 34px; padding: 0; border-radius: 10px; background: rgba(255,255,255,0.12); position: relative; }
.ix .switch::after { content: ''; position: absolute; left: 3px; top: 3px; width: 14px; height: 14px; border-radius: 50%; background: #d4d4d8; transition: left .15s; }
.ix .switch.on { background: var(--acc); }
.ix .switch.on::after { left: 17px; background: #fff; }
.ix .switch:hover { background: rgba(255,255,255,0.18); }
.ix .switch.on:hover { background: #6199ff; }
.ix .code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--mut); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 2px; }
.ix .nfs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.ix .nf { display: flex; align-items: center; gap: 4px; height: 28px; padding: 0 7px; border-radius: 8px; background: var(--field); border: 1px solid var(--line); }
.ix .nf:focus-within { border-color: var(--acc); }
.ix .nf span { color: var(--mut); font-size: 10.5px; font-weight: 700; }
.ix .nf input { border: 0; background: none; padding: 0; height: 22px; text-align: right; box-shadow: none !important; }
.ix .nf i { font-style: normal; color: var(--faint); font-size: 10px; }
.ix .note { margin: 8px 0 4px; padding: 8px 10px; border-radius: 9px; background: rgba(245,184,74,0.1); color: #f7d38e; font-size: 12px; line-height: 1.45; }
.ix .note.info { background: rgba(76,141,255,0.1); color: #bcd2ff; }
.ix .tr { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 7px 0; border-top: 1px solid rgba(255,255,255,0.045); }
.ix .tr:first-child { border-top: 0; }
.ix .tr .what { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.ix .tr .sub { grid-column: 1 / -1; color: var(--mut); font-size: 11.5px; overflow-wrap: anywhere; }
.ix .tag { font-size: 10px; padding: 1px 6px; border-radius: 5px; background: rgba(255,255,255,0.07); color: #d4d4d8; font-weight: 700; }
.ix .tag.ok { background: rgba(60,207,142,0.15); color: #86efc0; }
.ix .tag.warn { background: rgba(245,184,74,0.15); color: #f7d38e; }
.ix h6 { margin: 12px 0 5px; font-size: 10.5px; font-weight: 700; color: var(--mut); text-transform: uppercase; letter-spacing: 0.06em; }
.ix .empty { padding: 22px 8px; color: var(--mut); line-height: 1.6; text-align: center; }
.ix .empty .big { font-size: 13.5px; color: var(--ink); font-weight: 650; margin-bottom: 4px; }
.ix .empty .keys { margin-top: 14px; display: grid; gap: 6px; text-align: left; font-size: 11.5px; }
.ix .empty kbd { font: 600 10.5px/1 inherit; font-family: inherit; padding: 3px 5px; border-radius: 5px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1); color: #c9c9d2; }
.ix .spin { color: var(--faint); font-size: 11.5px; padding: 6px 0; }

/* motion */
.ix .clock { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }
.ix .clock .t { font-variant-numeric: tabular-nums; color: var(--mut); padding: 0 6px; font-size: 11.5px; min-width: 64px; }
.ix .seg { display: inline-flex; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 2px; }
.ix .seg button { height: 22px; font-size: 11px; padding: 0 7px; }
.ix .seg button.on { background: rgba(255,255,255,0.12); color: var(--ink); }
.ix .kf { margin-top: 8px; }
.ix .kf .kh { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.ix .track { position: relative; height: 30px; margin: 8px 6px 4px; border-radius: 7px; background: linear-gradient(rgba(255,255,255,0.04), rgba(255,255,255,0.02)); border: 1px solid var(--line); cursor: ew-resize; touch-action: none; }
.ix .track .ph { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: #ff5c8a; border-radius: 1px; pointer-events: none; }
.ix .track .dm { position: absolute; top: 50%; width: 11px; height: 11px; margin: -6px 0 0 -6px; transform: rotate(45deg); background: #9ec0ff; border: 1.5px solid #141418; border-radius: 2px; cursor: pointer; padding: 0; min-width: 0; }
.ix .track .dm:hover { background: #fff; }
.ix .track .dm.on { background: #fcd34d; }
.ix .ticks { display: flex; justify-content: space-between; margin: 0 6px; color: var(--faint); font-size: 10px; font-variant-numeric: tabular-nums; }
.ix .anim { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 8px; align-items: center; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.045); }
.ix .anim input[type=range] { grid-column: 1 / -1; height: 14px; padding: 0; background: none; border: 0; accent-color: var(--acc); box-shadow: none; }

/* colour */
.ix .picked { display: grid; grid-template-columns: 48px 1fr; gap: 10px; align-items: center; }
.ix .picked .big { width: 48px; height: 48px; border-radius: 12px; }
.ix .vals { display: grid; gap: 1px; }
.ix .vals button { justify-content: flex-start; height: 20px; padding: 0 4px; font-size: 11.5px; }
.ix .cand { display: grid; grid-template-columns: 22px 1fr auto; gap: 2px 8px; align-items: center; padding: 7px 0; border-top: 1px solid rgba(255,255,255,0.045); }
.ix .cand .sub { grid-column: 2 / -1; color: var(--mut); font-size: 11px; overflow-wrap: anywhere; }
.ix .dl { display: grid; grid-template-columns: 82px 1fr; gap: 5px 8px; font-size: 12px; }
.ix .dl dt { color: var(--mut); }
.ix .dl dd { margin: 0; font-variant-numeric: tabular-nums; }
`

const SECTIONS_KEY = 'retouch:sections'
const TAB_KEY = 'retouch:tab'
const load = (k, d) => {
  try {
    const v = localStorage.getItem(k)
    return v == null ? d : JSON.parse(v)
  } catch {
    return d
  }
}
const keep = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {}
}

/** Step the number in a CSS value with the arrow keys, keeping its unit. */
function stepValue(v, delta) {
  const m = /^(-?\d*\.?\d+)([a-z%]*)$/i.exec(String(v).trim())
  if (!m) return null
  const places = (m[1].split('.')[1] ?? '').length
  const next = Number((parseFloat(m[1]) + delta).toFixed(Math.max(places, Math.abs(delta) < 1 ? 2 : 0)))
  return `${next}${m[2]}`
}

/** How much one pixel of drag changes a number: a step that suits its size. */
const scrubStep = (v) => {
  const a = Math.abs(v)
  return a === 0 ? 1 : a < 1 ? 0.01 : a < 10 ? 0.1 : a < 200 ? 1 : 5
}
const tidy = (v, step) => Number(v.toFixed(Math.max(0, -Math.floor(Math.log10(step)))))

export function createInspector(host, ctl, { compact = false } = {}) {
  const doc = host.ownerDocument
  const shut = new Set(load(SECTIONS_KEY, ['numbers']))
  const tabs = load(TAB_KEY, {})
  let token = 0
  let deferred = false
  let kfPick = null // which keyframe is open: `${animation}|${keyText}`
  host.classList.add('ix')

  const loc = (where, text) =>
    where?.file ? h('a', { class: 'loc mono', text: text ?? `${where.file}:${where.line ?? 1}`, title: 'Open in your code editor', onclick: () => ctl.open(where.file, where.line, where.col) }) : null
  const openBtn = (where) => (where?.file ? h('button', { class: 'ghost', html: icon('open', 13), title: `Open ${where.file}:${where.line ?? 1}`, onclick: () => ctl.open(where.file, where.line, where.col) }) : null)
  const genNote = (g) => (g ? h('div', { class: 'sub' }, `Built by ${g.label} from ${[].concat(g.from).join(', ')}`) : null)
  const spin = (t) => h('div', { class: 'spin', text: t })

  function section(id, title, body, extra = null) {
    const sec = h('div', { class: `sec${shut.has(id) ? ' shut' : ''}`, 'data-sec': id })
    const head = h(
      'button',
      {
        class: 'sh',
        onclick: () => {
          sec.classList.toggle('shut')
          if (sec.classList.contains('shut')) shut.add(id)
          else shut.delete(id)
          keep(SECTIONS_KEY, [...shut])
        },
      },
      h('span', { text: title }),
      h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, extra, h('span', { html: icon('chevron', 14) })),
    )
    sec.append(head, h('div', { class: 'sb' }, body))
    return sec
  }

  /* ---------------- header ---------------- */

  function header(s) {
    const kinds = { jsx: ['JSX', 'Written in a component'], html: ['HTML', 'Written in an HTML file the page loads as a string'], script: ['no source', 'Made by a script at run time: it has no line of its own to edit'], drawing: ['drawing', 'Painted on a canvas by a script'] }
    const [kindText, kindTitle] = kinds[s.kind] ?? kinds.jsx
    const where = s.drawing ? s.drawing.where : s.file ? { file: s.file, line: s.line, col: s.col } : null
    return h(
      'div',
      { class: 'head' },
      h('h3', {}, h('span', { text: s.drawing ? s.drawing.name : s.label }), h('span', { class: `kind ${s.kind}`, text: kindText, title: kindTitle }), s.count > 1 ? h('span', { class: 'tag warn', text: `x${s.count}` }) : null),
      h('div', { class: 'where' }, where ? loc(where) : h('span', { class: 'muted', text: s.drawing ? 'Finding the code that drew it...' : s.readonlyWhy ?? 'Not written in the project' })),
      h(
        'div',
        { class: 'crumbs', title: 'What it sits in. Scroll over the rail on the page to step through depths.' },
        s.crumbs.map((c) => h('button', { class: `${c.on ? 'on' : ''}${c.draw ? ' draw' : ''}`, text: c.label, title: c.title, onclick: c.select })),
      ),
    )
  }

  function actions(s) {
    const b = (name, title, fn, cls = '', disabled = false) => h('button', { class: cls, html: icon(name, 15), title, onclick: fn, disabled })
    if (s.drawing) {
      return h(
        'div',
        { class: 'acts' },
        b('drop', 'Find where its colour is written', () => ctl.colorOfDrawing()),
        b('layers', s.drawing.showGroup ? 'Stop showing the others' : `Show the ${s.drawing.group - 1} others the same code drew`, () => ctl.toggleGroup(), s.drawing.showGroup ? 'on' : '', s.drawing.group < 2),
        b('up', 'Select the canvas it is drawn on', () => ctl.selectParent()),
        b('pipette', 'Pick a colour off the page (I)', () => ctl.startPick()),
        s.drawing.where ? b('open', 'Open the code that drew it', () => ctl.open(s.drawing.where.file, s.drawing.where.line, s.drawing.where.col)) : null,
      )
    }
    return h(
      'div',
      { class: 'acts' },
      b('pencil', 'Edit text (Enter)', () => ctl.editText(), '', !s.hasText),
      b('text', 'Add text after it (T)', () => ctl.addText(), '', s.readonly),
      b('layers', 'Duplicate (Ctrl+D)', () => ctl.duplicate(), '', s.readonly),
      b('flipH', 'Flip horizontally (Shift+H)', () => ctl.flip('h'), '', s.readonly),
      b('flipV', 'Flip vertically (Shift+V)', () => ctl.flip('v'), '', s.readonly),
      b('pipette', 'Pick a colour off the page (I)', () => ctl.startPick()),
      b('up', 'Select what this sits in (Shift+Enter)', () => ctl.selectParent()),
      s.link ? b('link', `Open link: ${s.link}`, () => ctl.openLink()) : null,
      s.edited ? b('reset', 'Drop the unsaved edits on this element', () => ctl.reset()) : null,
      s.file ? b('open', 'Open in your code editor', () => ctl.open(s.file, s.line, s.col)) : null,
      b('trash', 'Delete (Del)', () => ctl.remove(), 'danger', s.readonly),
    )
  }

  /* ---------------- design ---------------- */

  function transformFields(s) {
    const cur = ctl.transformState()
    const field = (key, label, unit, title) => {
      const input = h('input', { class: 'mono', value: String(cur[key]), title, 'aria-label': title, spellcheck: 'false', inputmode: 'decimal' })
      input.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Enter') input.blur()
        if (e.key === 'Escape') {
          input.value = String(cur[key])
          input.blur()
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
          input.value = String(Number(((parseFloat(input.value) || 0) + step).toFixed(1)))
        }
      })
      input.addEventListener('change', () => {
        const v = parseFloat(input.value)
        if (!Number.isFinite(v) || (key === 'size' && v <= 0)) {
          input.value = String(cur[key])
          return
        }
        if (v !== cur[key]) ctl.setTransform({ ...cur, [key]: v })
      })
      return h('label', { class: 'nf', title }, h('span', { text: label }), input, unit ? h('i', { text: unit }) : null)
    }
    return h(
      'div',
      {},
      h('div', { class: 'nfs' }, field('x', 'X', '', 'Moved across, from where the code puts it'), field('y', 'Y', '', 'Moved down, from where the code puts it'), field('size', 'W', '%', 'Size, as a percentage of what the code draws'), field('turn', 'R', 'deg', 'Turned, in degrees clockwise')),
      s.how?.length ? h('div', { class: 'small muted', style: { marginTop: '8px', lineHeight: '1.55' } }, s.how.map(([k, v]) => h('div', {}, h('span', { style: { color: '#c9c9d2' }, text: `${k}: ` }), v))) : null,
      ...(s.notes ?? []).map((n) => h('div', { class: `note${n.info ? ' info' : ''}`, text: n.text })),
    )
  }

  function styleRows(s, defs, my) {
    const wrap = h('div', {}, spin('Reading styles...'))
    const rows = defs.filter((d) => !d.when || d.when(s))
    const props = rows.flatMap((d) => d.box ?? [d.prop])
    ctl.styles(props).then((info) => {
      if (my !== token) return
      wrap.replaceChildren(...rows.map((d) => styleRow(s, d, info)))
    })
    return wrap
  }

  const dotFor = (w) => (w?.edited ? 'edited' : w?.kind === 'inline' ? 'inline' : w?.kind === 'rule' ? (w.inherited ? 'inherited' : 'rule') : '')
  const whereText = (w) => {
    if (!w) return ''
    if (w.edited) return 'Changed, not saved yet'
    if (w.kind === 'inline') return 'Set on this element'
    if (w.kind === 'rule') return `${w.inherited ? 'Inherited from ' : 'Set by '}${w.selector}${w.file ? `  (${w.file}:${w.line})` : w.sheetGenerated ? '  (in a generated stylesheet)' : ''}`
    return 'The browser default'
  }

  function valueInput(s, prop, v, def) {
    const scope = () => ctl.scopeOf(prop)
    if (def.options) {
      const sel = h('select', { title: whereText(v.winner) }, ...[...new Set([v.value, ...def.options])].map((o) => h('option', { value: o, text: o, selected: o === v.value })))
      sel.addEventListener('change', () => ctl.setStyle(prop, sel.value, scope()))
      return sel
    }
    if (def.range) {
      const [lo, hi, step] = def.range
      const r = h('input', { type: 'range', min: lo, max: hi, step, value: parseFloat(v.value) || 0, style: { padding: 0, background: 'none', border: 0, accentColor: '#4c8dff', boxShadow: 'none' }, title: `${v.value}  ${whereText(v.winner)}` })
      r.addEventListener('input', () => ctl.previewStyle(prop, r.value))
      r.addEventListener('change', () => ctl.setStyle(prop, r.value, scope()))
      return r
    }
    const input = h('input', { class: 'mono', value: v.value ?? '', spellcheck: 'false', title: whereText(v.winner) })
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') input.blur()
      if (e.key === 'Escape') {
        input.value = v.value ?? ''
        input.blur()
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const delta = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
        const next = stepValue(input.value, delta)
        if (next != null) {
          e.preventDefault()
          input.value = next
          ctl.previewStyle(prop, next)
        }
      }
    })
    input.addEventListener('change', () => {
      if (input.value.trim() !== (v.value ?? '')) ctl.setStyle(prop, input.value.trim(), scope())
    })
    return input
  }

  /** A label that changes its number when dragged sideways, the way design tools do. */
  function scrubLabel(text, getValue, onPreview, onCommit, title) {
    const label = h('label', { class: 'scrub', title: `${title ?? ''}${title ? '  ' : ''}Drag sideways to change it (Shift: faster, Alt: finer)` }, text)
    label.addEventListener('pointerdown', (e) => {
      const start = parseFloat(getValue())
      if (!Number.isFinite(start)) return
      e.preventDefault()
      label.setPointerCapture(e.pointerId)
      const x0 = e.clientX
      let last = start
      const base = scrubStep(start)
      const move = (ev) => {
        const step = base * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1)
        last = tidy(start + Math.round((ev.clientX - x0) / 2) * step, step)
        onPreview(last)
      }
      const up = () => {
        label.removeEventListener('pointermove', move)
        label.removeEventListener('pointerup', up)
        if (last !== start) onCommit(last)
      }
      label.addEventListener('pointermove', move)
      label.addEventListener('pointerup', up)
    })
    return label
  }

  function tail(prop, v) {
    const w = v.winner
    const bits = []
    if (w?.ruleEditable) {
      const on = ctl.scopeOf(prop) === 'rule'
      bits.push(h('button', { class: on ? 'on' : '', text: on ? `rule x${w.count}` : 'rule', title: on ? `Edits go to ${w.selector} in ${w.file}:${w.line}, which styles ${w.count} element${w.count === 1 ? '' : 's'} on this page. Click to edit only this element.` : `Edit ${w.selector} in ${w.file}:${w.line} instead (reaches ${w.count} element${w.count === 1 ? '' : 's'} on this page)`, onclick: () => ctl.setScope(prop, on ? 'element' : 'rule') }))
    }
    if (w?.file) bits.push(h('button', { html: icon('open', 12), title: `Open ${w.file}:${w.line}`, onclick: () => ctl.open(w.file, w.line, w.col) }))
    return h('div', { class: 'tail' }, bits)
  }

  function styleRow(s, def, info) {
    if (def.box) {
      const first = info[def.box[0]] ?? {}
      return h(
        'div',
        { class: 'row' },
        h('label', { title: whereText(first.winner) }, h('i', { class: dotFor(first.winner) }), def.label),
        h(
          'div',
          { class: 'box4' },
          def.box.map((p, k) => {
            const v = info[p] ?? {}
            const el = valueInput(s, p, v, {})
            el.title = `${['Top', 'Right', 'Bottom', 'Left'][k]}: ${v.value}  ${whereText(v.winner)}`
            return el
          }),
        ),
        tail(def.box[0], first),
      )
    }
    const v = info[def.prop] ?? { value: '' }
    let control = valueInput(s, def.prop, v, def)
    if (def.color) {
      const rgb = v.rgb
      const sw = h('button', { class: 'sw', title: `Change ${def.label.toLowerCase()} on this element`, onclick: () => ctl.openColor(def.prop) }, h('span', { style: { background: rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},${rgb.a})` : 'transparent' } }))
      const find = h('button', { class: 'ghost', html: icon('search', 13), title: 'Where is this colour written?', onclick: () => showWritten(control.parentElement.parentElement, rgb, def.prop) })
      control = h('div', { class: 'colorrow' }, sw, control, find)
    }
    const numeric = !def.options && !def.color && !def.range && /^-?\d*\.?\d+[a-z%]*$/i.test(String(v.value ?? '').trim())
    const label = numeric
      ? scrubLabel(
          [h('i', { class: dotFor(v.winner) }), def.label],
          () => parseFloat(control.value),
          (n) => {
            const unit = /[a-z%]*$/i.exec(String(v.value).trim())[0]
            control.value = `${n}${unit}`
            ctl.previewStyle(def.prop, control.value)
          },
          () => ctl.setStyle(def.prop, control.value, ctl.scopeOf(def.prop)),
          whereText(v.winner),
        )
      : h('label', { title: whereText(v.winner) }, h('i', { class: dotFor(v.winner) }), def.label)
    // a colour row outlines what it colours while the pointer is over it
    const hover = def.color ? { onpointerenter: () => ctl.showTone?.({}), onpointerleave: () => ctl.clearTone?.() } : {}
    return h('div', { class: 'row', 'data-prop': def.prop, ...hover }, label, control, tail(def.prop, v))
  }

  async function showWritten(row, rgb, prop) {
    if (!rgb) return
    const box = spin('Looking for where this colour is written...')
    row.after(box)
    const list = await ctl.findColor(rgb, prop)
    box.replaceWith(candidates(list, rgb))
  }

  function design(s, my) {
    const out = []
    if (s.readonly) out.push(h('div', { class: 'note info', text: `${s.readonlyWhy ?? 'This element is made by a script.'} Its styles can still be changed where their rules are written ("rule"), and Source traces every part of it.` }))
    // a key: what it says, its colours, and how it looks pressed, hovered and focused - first, as that is why it was tapped
    if (s.key) out.push(section('key', 'Key', keyPanel(s, my)))
    if (s.hasText) out.push(section('type', 'Text', h('div', {}, wordsField(s), styleCard(s), styleRows(s, TYPE, my))))
    if (!s.readonly) out.push(section('transform', 'Position', transformFields(s)))
    out.push(section('layout', 'Size and spacing', styleRows(s, LAYOUT, my)))
    out.push(section('fill', s.svg ? 'Fill and stroke' : 'Fill and border', h('div', {}, s.gradient && !s.key ? gradientRows() : null, styleRows(s, s.svg ? SVG_FILL : FILL, my))))
    return out
  }

  /* ---------------- words, a style, a key ---------------- */

  /** The words themselves, typed here: only what changes is written, and every styled part around it stays. */
  function wordsField(s) {
    if (s.words == null || s.readonly) return null
    const area = h('textarea', { class: 'words', rows: String(Math.min(5, Math.max(1, Math.ceil(s.words.length / 34)))), spellcheck: 'false', title: 'Type new words and press Enter (Shift+Enter for nothing: line breaks become spaces). Esc puts them back.' })
    area.value = s.words
    let done = false
    const commit = () => {
      if (done) return
      done = true
      if (area.value.trim() !== s.words) ctl.setWords(area.value)
    }
    area.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        area.blur()
      }
      if (e.key === 'Escape') {
        area.value = s.words
        done = true
        area.blur()
      }
    })
    area.addEventListener('blur', commit)
    return h('div', { class: 'wordsbox' }, h('label', { class: 'small muted', text: 'Words' }), area)
  }

  /** The text's style in one line, with Copy style and Paste style. */
  function styleCard(s) {
    const clip = ctl.clipboard?.() ?? {}
    return h(
      'div',
      { class: 'stylecard' },
      h('div', { class: 'mono sum', text: s.textStyle ?? '', title: 'Font, size, weight and colour, as the page draws them' }),
      h(
        'div',
        { class: 'btns' },
        h('button', { html: `${icon('drop', 12)}<span>Copy style</span>`, title: 'Copy this text style (Ctrl+Alt+C): font, size, weight, spacing, colour, and a key\'s fill and corners', onclick: () => ctl.copyStyle() }),
        h('button', { class: clip.style ? '' : 'off', html: `${icon('check', 12)}<span>Paste style</span>`, title: clip.style ? `Paste the style of ${clip.style.from} here (Ctrl+Alt+V): ${clip.style.summary}` : 'Copy a style first', onclick: () => clip.style && ctl.pasteStyle() }),
      ),
      clip.style ? h('div', { class: 'small muted', text: `Copied: ${clip.style.from}, ${clip.style.summary}${clip.style.box ? ', with its box' : ''}` }) : null,
    )
  }

  /** A CSS gradient's colours, each one marked on the element while the pointer is over it. */
  function gradientRows() {
    const g = ctl.gradient?.()
    if (!g?.stops.length) return null
    return h(
      'div',
      { class: 'gradrows' },
      h('div', { class: 'small muted', text: `A ${g.kind} gradient${g.kind === 'linear' ? ` at ${Math.round(g.angle)} degrees` : ''}. Point at a colour to see where it falls.` }),
      ...g.stops.map((st) => {
        const row = h(
          'div',
          { class: 'row', onpointerenter: () => ctl.showTone({ css: true, stop: st.at }), onpointerleave: () => ctl.clearTone() },
          h('label', { text: `${Math.round(st.at * 100)}%`, title: `The gradient at ${Math.round(st.at * 100)}%` }),
          h('div', { class: 'colorrow' }, h('span', { class: 'sw' }, h('span', { style: { background: `rgba(${st.rgb.r},${st.rgb.g},${st.rgb.b},${st.rgb.a})` } })), h('span', { class: 'mono', text: describeColor(st.rgb).hex })),
          h('button', { text: 'Where?', title: 'Find where this colour is written, and fine-tune it there', onclick: () => showWritten(row, st.rgb, 'background-image') }),
        )
        return row
      }),
    )
  }

  /**
   * A KEY: what it says, the colours it is drawn in, and the looks it takes
   * when pressed, hovered and focused - which are written in rules that do
   * not apply while it sits selected, so nothing else here would show them.
   */
  function keyPanel(s, my) {
    const states = h('div', {}, spin('Reading how it looks pressed and hovered...'))
    ctl.states?.().then((list) => {
      if (my !== token) return
      states.replaceChildren(...stateBlocks(list))
    })
    return h(
      'div',
      {},
      s.hasText ? null : h('div', { class: 'small muted', text: 'It has no words of its own.' }),
      s.gradient ? gradientRows() : null,
      styleRows(s, [FILL[0], TYPE.find((d) => d.prop === 'color'), FILL[5], FILL[2]], my),
      states,
    )
  }

  const STATE_TITLE = { pressed: 'When pressed', hover: 'When the pointer is over it', focus: 'When focused (keyboard)' }
  function stateBlocks(list) {
    if (!list.length) return [h('div', { class: 'note info', text: 'No pressed or hover look is written for this: it looks the same pressed as it does now. A rule with :active or :hover in its selector, in its stylesheet, gives it one.' })]
    const shown = ctl.shownState?.()
    const out = []
    for (const name of ['pressed', 'hover', 'focus']) {
      const rules = list.filter((r) => r.states.includes(name))
      if (!rules.length) continue
      const on = shown === name
      out.push(
        h(
          'div',
          { class: 'statehead' },
          h('b', { text: STATE_TITLE[name] }),
          h('button', { class: on ? 'on' : '', html: `${icon(on ? 'eyeOff' : 'eye', 12)}<span>${on ? 'Showing' : 'Show it'}</span>`, title: on ? 'Back to how it looks now' : 'Show this look on the page now, without pressing it', onclick: () => ctl.showState(name, !on) }),
        ),
      )
      for (const r of rules) {
        out.push(h('div', { class: 'small muted statesel', text: `${r.selector}${r.onAncestor ? ' (when what it is in is)' : ''}` }, r.file ? h('a', { class: 'mono', style: { marginLeft: '6px' }, text: `${r.file}:${r.line}`, onclick: () => ctl.open(r.file, r.line) }) : null))
        for (const row of r.rows) {
          const input = h('input', { class: 'mono', value: row.value, spellcheck: 'false', disabled: !row.editable, title: row.editable ? `Written in ${row.file}:${row.line}` : 'This rule is not in a file Retouch can edit' })
          input.addEventListener('keydown', (e) => {
            e.stopPropagation()
            if (e.key === 'Enter') input.blur()
            if (e.key === 'Escape') {
              input.value = row.value
              input.blur()
            }
          })
          input.addEventListener('change', () => input.value.trim() !== row.value && ctl.setStateStyle(r.i, row.prop, input.value.trim()))
          out.push(
            h(
              'div',
              { class: 'row' },
              h('label', { title: row.prop }, h('i', { class: row.edited ? 'edited' : 'rule' }), row.prop),
              row.rgb ? h('div', { class: 'colorrow' }, h('span', { class: 'sw' }, h('span', { style: { background: `rgba(${row.rgb.r},${row.rgb.g},${row.rgb.b},${row.rgb.a})` } })), input) : input,
              h('span'),
            ),
          )
        }
      }
    }
    return out
  }

  /* ---------------- colour ---------------- */

  function candidates(list, rgb) {
    if (!list?.length) {
      return h('div', { class: 'note info', text: 'No colour near this is written in the project files Retouch reads. It may be computed by a script, blended from other colours or come from an image.' })
    }
    return h(
      'div',
      {},
      list.map((c) => {
        const name = c.key ?? (c.selector ? `${c.selector}${c.prop ? ' ' + c.prop : ''}` : c.where === 'array' ? 'colour data' : c.where === 'string' ? 'string' : c.prop ?? '')
        return h(
          'div',
          { class: 'cand' },
          h('span', { class: 'sw' }, h('span', { style: { background: `rgba(${c.rgb.r},${c.rgb.g},${c.rgb.b},${c.rgb.a})` } })),
          h('div', { style: { minWidth: 0 } }, h('div', { class: 'mono', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: name || c.text }), loc({ file: c.file, line: c.line })),
          h(
            'div',
            { style: { display: 'flex', gap: '2px', alignItems: 'center' } },
            h('span', { class: `tag ${c.exact ? 'ok' : ''}`, text: c.exact ? 'exact' : `near ${Math.round(c.d * 1000) / 10}`, title: c.exact ? 'This is the colour on the page' : 'Close to it: blended, faded or part of a gradient' }),
            c.generatedOnly ? null : h('button', { text: 'Edit', title: 'Fine-tune this colour where it is written', onclick: () => ctl.recolor(c, rgb) }),
          ),
          h('div', { class: 'sub mono', text: c.lineText }),
          c.generatedOnly
            ? h('div', { class: 'sub', text: `A generated file${c.generatedBy ? `, built by ${c.generatedBy.label}` : ''}: an edit here would be overwritten. Add the file it is copied from to colors.include to edit it there.` })
            : c.generatedBy
              ? genNote(c.generatedBy)
              : null,
        )
      }),
    )
  }

  function pickedCard() {
    const p = ctl.picked()
    if (!p) return null
    const d = describeColor(p.rgb)
    const copy = (t) => h('button', { class: 'mono', text: t, title: 'Copy', onclick: () => ctl.copy(t) })
    return h(
      'div',
      {},
      h('div', { class: 'picked' }, h('span', { class: 'sw big' }, h('span', { style: { background: `rgba(${p.rgb.r},${p.rgb.g},${p.rgb.b},${p.rgb.a})` } })), h('div', { class: 'vals' }, copy(d.hex), copy(d.rgbText), copy(d.oklch))),
      h('div', { class: 'small muted', style: { margin: '6px 0' }, text: `From ${p.what}` }),
      p.stops?.length > 1 ? h('div', { class: 'small muted', text: `A gradient of ${p.stops.length} colours; the first is shown.` }) : null,
      h(
        'div',
        { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
        p.canElement ? h('button', { html: `${icon('drop', 13)}<span>This element only</span>`, title: 'Set this colour on the element alone', onclick: () => ctl.colorPickedElement() }) : null,
        h('button', { html: `${icon('pipette', 13)}<span>Pick again</span>`, onclick: () => ctl.startPick() }),
        h('button', { html: `${icon('x', 13)}<span>Clear</span>`, onclick: () => ctl.clearPicked() }),
      ),
      h('h6', { text: 'Written in' }),
      p.candidates ? candidates(p.candidates, p.rgb) : spin('Looking for where this colour is written...'),
    )
  }

  /* ---------------- a drawing on a canvas ---------------- */

  function drawingTab(s) {
    const d = s.drawing
    const dl = (pairs) => h('dl', { class: 'dl' }, ...pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]))
    const stops = d.colors.some((c) => c.stop != null)
    const colours = d.colors.length
      ? d.colors.map((c) =>
          h(
            'div',
            // where this colour falls on the drawing, marked while the pointer is over its row
            {
              class: 'row',
              // a colour that nothing shows (every part of it painted over) says so on its row
              onpointerenter: (e) => {
                const row = e.currentTarget
                ctl.drawingTone?.(c.stop ?? null, (res) => row.classList.toggle('covered', !res.visible))
              },
              onpointerleave: () => ctl.clearTone?.(),
            },
            h('label', { text: c.stop != null ? `${Math.round(c.stop * 100)}%` : c.label, title: c.stop != null ? `The gradient at ${Math.round(c.stop * 100)}%` : c.label }),
            h('div', { class: 'colorrow' }, h('span', { class: 'sw' }, h('span', { style: { background: `rgba(${c.rgb.r},${c.rgb.g},${c.rgb.b},${c.rgb.a})` } })), h('span', { class: 'mono', text: describeColor(c.rgb).hex })),
            h('button', { text: 'Where?', title: 'Find where this colour is written, and fine-tune it there', onclick: () => ctl.findDrawingColor(c) }),
          ),
        )
      : [h('div', { class: 'small muted', text: 'Painted with a pattern or an image, not a plain colour.' })]
    return [
      section('drawing', 'Drawing', dl([['Shape', d.name], ['Size', `${d.w} x ${d.h}`], ['Position', `${d.x}, ${d.y} on its canvas`], d.lineWidth ? ['Line', `${d.lineWidth} px`] : null, ['Opacity', String(d.alpha)], d.text ? ['Text', d.text] : null, ['Canvas', `${d.canvas}, ${d.canvasSize}`]])),
      section('dcolour', stops ? 'Colour: a gradient' : 'Colour', h('div', {}, ...colours, h('div', { class: 'hint', style: { paddingTop: '6px' }, text: 'A colour a script draws with is usually written as data. Where? lists every place near it; Edit there changes every drawing that uses it.' }))),
      section(
        'dgroup',
        'Drawn by the same code',
        h(
          'div',
          {},
          h('div', { class: 'small', text: d.group > 1 ? `${d.group} drawings, this one included, come from the same line of code. Change that code and they all change.` : 'Nothing else on this canvas comes from the same line.' }),
          d.group > 1 ? h('button', { class: d.showGroup ? 'on' : '', style: { marginTop: '6px' }, html: `${icon('layers', 13)}<span>${d.showGroup ? 'Hide them' : 'Show them'}</span>`, onclick: () => ctl.toggleGroup() }) : null,
        ),
      ),
      h('div', { class: 'note info', text: 'Size, shape and placement are numbers in the code that draws it: Settings lists them. Each change rebuilds the scenes and reloads the page where it is.' }),
    ]
  }

  /* ---------------- settings ---------------- */

  function settingControl(it) {
    if (it.kind === 'boolean') {
      const b = h('button', { class: `switch${it.value ? ' on' : ''}`, title: it.value ? 'On' : 'Off', 'aria-pressed': String(!!it.value), onclick: () => ctl.setSetting(it, !it.value) })
      return { control: b }
    }
    if (it.kind === 'enum') {
      const sel = h('select', {}, ...[...new Set([it.value, ...(it.options ?? [])])].map((o) => h('option', { value: o, text: String(o), selected: o === it.value })))
      sel.addEventListener('change', () => ctl.setSetting(it, sel.value))
      return { control: sel }
    }
    if (it.kind === 'code') return { control: h('div', { class: 'code', text: String(it.value), title: String(it.value) }) }
    const input = h('input', { class: it.kind === 'number' ? 'mono' : '', value: String(it.value ?? ''), spellcheck: 'false' })
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') input.blur()
      if (e.key === 'Escape') {
        input.value = String(it.value ?? '')
        input.blur()
      }
      if (it.kind === 'number' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const step = scrubStep(Number(input.value)) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
        input.value = String(tidy((Number(input.value) || 0) + step, Math.abs(step)))
      }
    })
    input.addEventListener('change', () => {
      const v = it.kind === 'number' ? Number(input.value) : input.value
      if (it.kind === 'number' && !Number.isFinite(v)) return (input.value = String(it.value))
      if (String(v) !== String(it.value)) ctl.setSetting(it, v)
    })
    return { control: input, input }
  }

  function settingRow(it) {
    const { control, input } = settingControl(it)
    const label =
      it.kind === 'number' && input
        ? scrubLabel(it.label, () => input.value, (n) => (input.value = String(n)), (n) => ctl.setSetting(it, n), it.context ?? it.desc)
        : h('label', { title: it.context ?? it.desc ?? it.label, text: it.label })
    return [
      h('div', { class: `row${it.unset ? ' unset' : ''}` }, label, control, openBtn(it.file ? { file: it.file, line: it.line, col: it.col } : null) ?? h('span')),
      it.desc || it.context ? h('div', { class: 'row', style: { margin: '-3px 0 6px' } }, h('div', { class: 'desc', text: it.desc ?? it.context })) : null,
    ]
  }

  function settingsGroup(g) {
    const body = h('div', {})
    const rows = g.items.flatMap(settingRow)
    const many = g.collapsed && g.items.length
    if (!g.items.length) body.append(h('div', { class: 'small muted', text: 'Nothing here is a plain value.' }))
    else if (many && !shut.has(`open:${g.id}`)) {
      body.append(
        h('button', {
          class: 'ghost',
          html: `${icon('chevron', 13)}<span>Show ${g.items.length} numbers</span>`,
          onclick: () => {
            shut.add(`open:${g.id}`)
            keep(SECTIONS_KEY, [...shut])
            body.replaceChildren(...rows.filter(Boolean))
          },
        }),
      )
    } else body.append(...rows.filter(Boolean))
    return h('div', { class: 'card' }, h('div', { class: 'ct' }, h('b', { text: g.title }), g.file ? loc({ file: g.file, line: g.line }, `${g.file.split('/').pop()}${g.line ? ':' + g.line : ''}`) : null), g.sub ? h('div', { class: 'cs', text: g.sub }) : null, body)
  }

  function settingsTab(s, my) {
    const wrap = h('div', {}, spin(s.drawing && !s.drawing.where ? 'Waiting to find the code that drew it...' : 'Reading the code...'))
    // a drawing's numbers are in its call chain: the helper that drew it, and the code that told it where and how big
    const frames =
      s.drawing?.chain?.length > 1
        ? h(
            'div',
            { class: 'card' },
            h('div', { class: 'ct' }, h('b', { text: 'Which code' })),
            h('div', { class: 'cs', text: 'A drawing helper is shared; what called it decides this drawing. Pick the code whose numbers to show.' }),
            h('div', { class: 'seg', style: { flexWrap: 'wrap' } }, ...s.drawing.chain.map((f, i) => h('button', { class: i === s.drawing.at ? 'on' : '', text: `${f.name ?? f.file.split('/').pop()}`, title: `${f.file}:${f.line}`, onclick: () => ctl.setDrawingFrame(i) }))),
          )
        : null
    ctl.settings().then((list) => {
      if (my !== token) return
      // one card per group: an element inside a component and the component's own usage read the same code
      const seen = new Set()
      const groups = list
        .flatMap((x) => x.groups ?? [])
        .filter((g) => {
          const key = `${g.id}|${g.file}|${g.title}`
          if (seen.has(key) || !g.items.length) return false
          seen.add(key)
          return true
        })
      const errors = list.filter((x) => x.error)
      const kids = [h('div', { class: 'hint', text: 'Values written in code. A change is saved at once (with any unsaved edits) and shows on the page through hot reload; Undo puts it back.' })]
      if (frames) kids.push(frames)
      for (const g of groups) kids.push(settingsGroup(g))
      for (const e of errors) kids.push(h('div', { class: 'note', text: e.error }))
      if (!groups.some((g) => g.items.length)) kids.push(h('div', { class: 'empty', text: s.drawing ? 'The code that drew this could not be read. Its script may have no source map; open it from Source.' : 'Nothing about this element is written as a plain value.' }))
      wrap.replaceChildren(...kids)
    })
    return [wrap]
  }

  /* ---------------- motion ---------------- */

  function clock() {
    const sp = ctl.speedState()
    const t = h('span', { class: 't', text: `${(ctl.time() / 1000).toFixed(2)} s` })
    const speeds = [0.1, 0.25, 0.5, 1]
    return h(
      'div',
      { class: 'card' },
      h('div', { class: 'ct' }, h('b', { text: "The page's clock" }), h('span', { class: 'small muted', text: sp.frozen ? 'frozen' : sp.speed === 1 ? 'playing' : `slow motion, ${sp.speed}x` })),
      h(
        'div',
        { class: 'clock', style: { marginTop: '6px' } },
        h('button', { class: sp.frozen ? '' : 'on', html: icon(sp.frozen ? 'play' : 'pause', 14), title: sp.frozen ? 'Play' : 'Freeze', onclick: () => ctl.setFrozen(!sp.frozen) }),
        h('button', { html: icon('back', 14), title: 'One frame back (,)', onclick: () => ctl.seekBy(-1000 / 60) }),
        h('button', { html: icon('fwd', 14), title: 'One frame on (.)', onclick: () => ctl.seekBy(1000 / 60) }),
        t,
        h('span', { style: { flex: '1' } }),
        h('div', { class: 'seg' }, ...speeds.map((v) => h('button', { class: !sp.frozen && sp.speed === v ? 'on' : '', text: `${v}x`, title: v === 1 ? 'Normal speed' : `Slow motion: ${v} of normal speed`, onclick: () => ctl.setSpeed(v) }))),
      ),
      h('div', { class: 'hint', style: { padding: '6px 0 0' }, text: 'Step back and forward a frame at a time with , and . - anything driven by time follows, canvases included.' }),
    )
  }

  function keyframeCard(k) {
    const dur = Number.isFinite(k.duration) ? k.duration : 0
    const track = h('div', { class: 'track', title: 'Drag to scrub this animation' })
    const ph = h('div', { class: 'ph', style: { left: `${(k.progress ?? 0) * 100}%` } })
    track.append(ph)
    const openKey = kfPick && kfPick.startsWith(`${k.name}|`) ? kfPick.slice(k.name.length + 1) : null
    for (const f of k.frames) {
      for (const off of f.offsets) {
        const dm = h('button', {
          class: `dm${openKey === f.keyText ? ' on' : ''}`,
          style: { left: `${off * 100}%` },
          title: `${f.keyText}: ${f.props.map(([p, v]) => `${p} ${v}`).join('; ')}`,
          onpointerdown: (e) => e.stopPropagation(),
          onclick: () => {
            kfPick = openKey === f.keyText ? null : `${k.name}|${f.keyText}`
            ctl.seekKeyframes(k, off)
            render()
          },
        })
        track.append(dm)
      }
    }
    const seek = (e) => {
      const r = track.getBoundingClientRect()
      const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
      ph.style.left = `${p * 100}%`
      ctl.seekKeyframes(k, p)
    }
    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture(e.pointerId)
      seek(e)
      const move = (ev) => seek(ev)
      const up = () => {
        track.removeEventListener('pointermove', move)
        track.removeEventListener('pointerup', up)
      }
      track.addEventListener('pointermove', move)
      track.addEventListener('pointerup', up)
    })
    const open = k.frames.find((f) => f.keyText === openKey)
    const editor = open
      ? h(
          'div',
          { style: { marginTop: '8px' } },
          h('div', { class: 'ct', style: { display: 'flex', justifyContent: 'space-between' } }, h('b', { class: 'small', text: `At ${open.keyText}` }), open.where ? loc(open.where) : h('span', { class: 'small muted', text: 'not in an editable file' })),
          ...open.props.map(([p, v]) => {
            const input = h('input', { class: 'mono', value: v, spellcheck: 'false' })
            input.addEventListener('keydown', (e) => {
              e.stopPropagation()
              if (e.key === 'Enter') input.blur()
            })
            input.addEventListener('change', () => input.value.trim() !== v && ctl.setKeyframe(open, p, input.value.trim()))
            return h('div', { class: 'row' }, h('label', { text: p, title: p }), input, open.where?.decls?.[p] ? openBtn({ file: open.where.file, line: open.where.decls[p].line }) : h('span'))
          }),
        )
      : h('div', { class: 'hint', style: { padding: '4px 0 0' }, text: 'Click a diamond to edit that keyframe. Changes show at once and are saved with the rest.' })
    return h(
      'div',
      { class: 'card kf' },
      h('div', { class: 'kh' }, h('b', { class: 'mono', text: k.name }), h('span', { class: 'small muted', text: `${Math.round(dur)} ms${k.delay ? `, after ${Math.round(k.delay)} ms` : ''}${k.iterations === Infinity ? ', loops' : k.iterations > 1 ? `, x${k.iterations}` : ''}` })),
      track,
      h('div', { class: 'ticks' }, h('span', { text: '0' }), h('span', { text: `${Math.round(dur / 2)} ms` }), h('span', { text: `${Math.round(dur)} ms` })),
      editor,
    )
  }

  function motionTab(s, my) {
    const out = [clock()]
    const kfBox = h('div', {}, spin('Reading animations...'))
    out.push(kfBox)
    ctl.keyframes().then((list) => {
      if (my !== token) return
      kfBox.replaceChildren(...(list.length ? list.map(keyframeCard) : [h('div', { class: 'small muted', style: { padding: '4px 2px 8px' }, text: 'No CSS animation runs on this element itself.' })]))
    })
    out.push(section('timing', 'Timing', styleRows(s, TIMING, my)))
    const list = h('div', {}, spin('Looking at what moves it...'))
    ctl.motion().then((m) => {
      if (my !== token) return
      list.replaceChildren(...motionRows(m))
    })
    out.push(section('movers', 'What moves it', list))
    return out
  }

  function motionRows(m) {
    const out = []
    const scripted = m.animations.filter((a) => a.kind !== 'css')
    if (scripted.length) out.push(h('h6', { text: 'Web Animations and transitions' }))
    for (const a of scripted) {
      const scrub = h('input', { type: 'range', min: 0, max: Math.max(1, Math.round(a.duration || 1000)), step: 1, value: Math.round(a.currentTime % (a.duration || 1)) || 0 })
      scrub.addEventListener('input', () => ctl.seekAnimation(a.index, Number(scrub.value)))
      out.push(
        h(
          'div',
          { class: 'anim' },
          h('span', { class: 'tag', text: a.kind === 'transition' ? 'transition' : 'script' }),
          h('div', { style: { minWidth: 0 } }, h('div', { class: 'mono', text: a.name }), h('div', { class: 'small muted', text: `${a.target}${a.duration ? `, ${Math.round(a.duration)} ms` : ''}${a.iterations === Infinity ? ', loops' : ''}` })),
          h('button', { html: icon(a.playState === 'running' ? 'pause' : 'play', 13), title: a.playState === 'running' ? 'Pause' : 'Play', onclick: () => ctl.toggleAnimation(a.index) }),
          scrub,
        ),
      )
    }
    out.push(h('h6', { text: 'Scripts writing its style' }))
    if (m.frozen) out.push(h('div', { class: 'small muted', text: 'The page is frozen, so nothing is moving it now. Play, then watch again.' }))
    else if (!m.movers.length) out.push(h('div', { class: 'small muted', text: 'Nothing wrote to its style while Retouch watched.' }))
    for (const mv of m.movers) {
      out.push(
        h(
          'div',
          { class: 'tr' },
          h('div', { class: 'what mono', text: `${mv.label}: ${mv.props.join(', ')}` }),
          h('span', { class: 'tag', text: `${mv.count}x` }),
          h('div', { class: 'sub' }, mv.frames.length ? mv.frames.map((f) => h('div', {}, loc(f), f.mapped === false && f.generatedBy ? genNote(f.generatedBy) : null)) : mv.library ? `by ${mv.library} (a library); the line that started it is not in the stack` : 'by code Retouch could not place'),
        ),
      )
    }
    out.push(h('button', { class: 'ghost', html: `${icon('reload', 13)}<span>Watch again</span>`, style: { marginTop: '6px' }, onclick: () => ctl.rewatch() }))
    return out
  }

  /* ---------------- source ---------------- */

  function sourceTab(s, my) {
    const out = []
    if (s.drawing) {
      out.push(h('h6', { text: 'Drawn by' }))
      if (!s.drawing.chain?.length) out.push(h('div', { class: 'small muted', text: s.drawing.where === null ? 'Its script could not be placed: it may have no source map. The canvas below is where it is drawn.' : 'Finding the code that drew it...' }))
      s.drawing.chain?.forEach((f, i) =>
        out.push(
          h(
            'div',
            { class: 'tr' },
            h('div', { class: 'what', text: i === 0 ? `${f.name ? f.name + '()' : 'The line'} that drew it` : `called from ${f.name ? f.name + '()' : 'here'}` }),
            openBtn(f),
            h('div', { class: 'sub' }, loc(f), i === 0 && f.via ? h('div', { text: `through the source map of ${f.via}` }) : null),
          ),
        ),
      )
    }
    const body = h('div', {}, spin('Tracing...'))
    ctl.trace().then((t) => {
      if (my !== token || !t) return
      body.replaceChildren(...traceRows(t, s))
    })
    out.push(body)
    return out
  }

  function traceRows(t, s) {
    const out = []
    out.push(h('h6', { text: s.drawing ? 'Its canvas' : 'Element' }))
    if (t.element.where) out.push(h('div', { class: 'tr' }, h('div', { class: 'what', text: t.element.label }), openBtn(t.element.where), h('div', { class: 'sub' }, loc(t.element.where), genNote(t.element.where.generatedBy))))
    else if (!s.drawing) out.push(h('div', { class: 'small muted', text: t.element.why }))
    for (const c of t.element.chain) out.push(h('div', { class: 'tr' }, h('div', { class: 'what muted', text: `in ${c.label}` }), openBtn(c), h('div', { class: 'sub' }, loc(c))))
    if (t.words && !s.drawing) {
      out.push(h('h6', { text: 'Words' }))
      out.push(h('div', { class: 'small mono muted', text: `"${t.words.text}"` }))
      if (!t.words.found.length) out.push(h('div', { class: 'small muted', text: 'Not written anywhere as they appear: put together by code, or in a file Retouch does not read (add it to text.include).' }))
      for (const f of t.words.found) out.push(h('div', { class: 'tr' }, h('div', { class: 'what mono', text: f.preview }), openBtn(f), h('div', { class: 'sub' }, loc(f), genNote(f.generatedBy))))
    }
    out.push(h('h6', { text: `Styles (${t.rules.length})` }))
    if (!t.rules.length) out.push(h('div', { class: 'small muted', text: 'No stylesheet rule applies to it.' }))
    for (const r of t.rules) {
      out.push(
        h(
          'div',
          { class: 'tr' },
          h('div', { class: 'what mono', text: r.selector, title: r.media?.join(' ') }),
          r.where ? openBtn(r.where) : null,
          h(
            'div',
            { class: 'sub' },
            r.media?.length ? h('div', { text: r.media.join(' ') }) : null,
            h('div', { class: 'mono', text: r.props.slice(0, 8).join(', ') + (r.props.length > 8 ? ` +${r.props.length - 8}` : '') }),
            r.where ? loc(r.where) : h('span', { text: r.sheet ? `in ${r.sheet}${r.sheetGenerated ? ' (generated)' : ''}, not found in source` : 'in a stylesheet with no file' }),
            r.sheetGenerated ? h('div', { text: `${r.where ? 'Served from' : 'In'} ${r.sheet}, built by ${r.sheetGenerated.label}` }) : null,
          ),
        ),
      )
    }
    return out
  }

  /* ---------------- several at once ---------------- */

  function groupPanel(g) {
    const b = (name, title, fn, cls = '') => h('button', { class: cls, html: icon(name, 15), title, onclick: fn })
    const pct = h('input', { class: 'mono', value: '100', inputmode: 'decimal', title: 'Resize all of them, their spacing too, as a percentage' })
    const applyPct = () => {
      const v = parseFloat(pct.value)
      if (Number.isFinite(v) && v > 0 && v !== 100) ctl.scaleGroup(v)
      pct.value = '100'
    }
    pct.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') pct.blur()
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        pct.value = String((parseFloat(pct.value) || 100) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1))
      }
    })
    pct.addEventListener('change', applyPct)
    const dx = h('input', { class: 'mono', value: '0', inputmode: 'decimal', title: 'Move all of them across, in pixels' })
    const dy = h('input', { class: 'mono', value: '0', inputmode: 'decimal', title: 'Move all of them down, in pixels' })
    for (const input of [dx, dy]) {
      input.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Enter') input.blur()
      })
      input.addEventListener('change', () => {
        const x = parseFloat(dx.value) || 0
        const y = parseFloat(dy.value) || 0
        if (x || y) ctl.nudgeGroup(x, y)
        dx.value = dy.value = '0'
      })
    }
    const onlyDrawn = g.drawings === g.count
    const title = onlyDrawn ? `${g.count} drawing${g.count === 1 ? '' : 's'}` : `${g.count} item${g.count === 1 ? '' : 's'}`
    const sub = onlyDrawn
      ? 'On a canvas: their colours and the code that drew them are below'
      : g.drawings || g.stuck
        ? `${g.movable} move together; ${g.drawings + g.stuck} stay where they are`
        : `${g.width} x ${g.height} together`
    const swatch = (rgb) => h('i', { class: 'gsw', style: { background: `rgb(${rgb.r},${rgb.g},${rgb.b})` } })
    return [
      h(
        'div',
        { class: 'head' },
        h('h3', {}, h('span', { text: title }), h('span', { class: `kind ${onlyDrawn ? 'drawing' : 'jsx'}`, text: 'several' })),
        h('div', { class: 'where muted', text: sub }),
      ),
      h(
        'div',
        { class: 'acts' },
        onlyDrawn
          ? null
          : [
              b('alignL', 'Align left edges', () => ctl.alignGroup('left')),
              b('alignC', 'Align centres across', () => ctl.alignGroup('center')),
              b('alignR', 'Align right edges', () => ctl.alignGroup('right')),
              b('alignT', 'Align top edges', () => ctl.alignGroup('top')),
              b('alignM', 'Align middles', () => ctl.alignGroup('middle')),
              b('alignB', 'Align bottom edges', () => ctl.alignGroup('bottom')),
              b('distH', 'Space out evenly across (three or more)', () => ctl.distributeGroup('x')),
              b('distV', 'Space out evenly down (three or more)', () => ctl.distributeGroup('y')),
              b('trash', `Delete all ${g.count}`, () => ctl.removeGroup(), 'danger'),
            ],
        h('button', { class: 'unsel', html: `${icon('x', 12)}<span>Unselect all</span>`, title: 'Unselect all (Esc)', onclick: () => ctl.unselectAll() }),
      ),
      g.colors?.length
        ? section(
            'gcolors',
            'Colours they use',
            h(
              'div',
              {},
              g.colors.map((c) =>
                h(
                  'div',
                  { class: 'tr' },
                  h('div', { class: 'what' }, swatch(c.rgb), h('span', { class: 'mono', text: c.text }), h('span', { class: 'muted', style: { marginLeft: '6px' }, text: c.count > 1 ? `${c.label.startsWith('Gradient') ? 'gradient' : c.label.toLowerCase()}, ${c.count} of them` : c.label.startsWith('Gradient') ? 'gradient' : c.label.toLowerCase() })),
                  h('button', { text: 'Where?', title: 'Find where this colour is written, and fine-tune it there', onclick: () => ctl.findDrawingColor(c) }),
                ),
              ),
              h('div', { class: 'hint', style: { paddingTop: '6px' }, text: 'A colour written once and used by many drawings changes them all.' }),
            ),
          )
        : null,
      onlyDrawn
        ? null
        : section(
            'gsize',
            'Together',
            h(
              'div',
              {},
              h('div', { class: 'row' }, scrubLabel('Size', () => pct.value, (n) => (pct.value = String(n)), () => applyPct(), 'Every member grows or shrinks about the middle of the group, and so does the space between them'), h('label', { class: 'nf' }, pct, h('i', { text: '%' })), h('span')),
              h('div', { class: 'row' }, h('label', { text: 'Move' }), h('div', { class: 'box4', style: { gridTemplateColumns: '1fr 1fr' } }, h('label', { class: 'nf' }, h('span', { text: 'X' }), dx), h('label', { class: 'nf' }, h('span', { text: 'Y' }), dy)), h('span')),
            ),
          ),
      h('div', { class: 'hint', text: onlyDrawn ? 'Tap a drawing to take it out, or another to add it. Drawings are placed by their script, so they are recoloured and traced here, not dragged. Ctrl+A takes everything the same code drew.' : 'Tap one on the page to take it out, or another to add it. Drag the box to move them together; a corner resizes them all with their spacing (Shift: 5% steps). Ctrl+A takes everything beside them.' }),
      section(
        'gmembers',
        `Selected (${g.count})`,
        h(
          'div',
          {},
          g.members.map((m) =>
            h(
              'div',
              { class: 'tr', onpointerenter: () => (m.drawing ? ctl.hover(null, m.drawing.item) : ctl.hover(m.el)), onpointerleave: () => ctl.hover(null) },
              h(
                'div',
                { class: 'what' },
                m.drawing?.colors[0] ? swatch(m.drawing.colors[0].rgb) : null,
                h('a', { class: 'loc', text: m.label, title: 'Select only this one', onclick: () => ctl.selectMember(m.i) }),
                m.stuck ? h('span', { class: 'tag warn', style: { marginLeft: '6px' }, text: 'stays' }) : null,
              ),
              h('button', { class: 'ghost', html: icon('x', 12), title: 'Unselect this one', onclick: () => ctl.dropMember(m.i) }),
              m.file ? h('div', { class: 'sub' }, loc({ file: m.file, line: m.line, col: m.col }), m.fn ? h('span', { class: 'muted', text: ` in ${m.fn}` }) : null) : m.tracing ? h('div', { class: 'sub muted', text: 'finding the code that drew it...' }) : null,
            ),
          ),
        ),
      ),
    ]
  }

  /* ---------------- the panel ---------------- */

  function empty() {
    const k = (keys, what) => h('div', {}, ...keys.split(' ').map((x) => h('kbd', { text: x })), ' ', what)
    return h(
      'div',
      { class: 'empty' },
      h('div', { class: 'big', text: 'Select anything on the page' }),
      h('div', { class: 'small', text: 'Text, boxes, images, and the drawings on a canvas. Its design, settings, motion and source show here.' }),
      h('div', { class: 'keys' }, k('Click', 'select, again to go deeper'), k('Drag', 'select several with a box'), k('Shift Click', 'add or take out'), k('Esc', 'unselect all'), k('Right-click', 'everything under the pointer'), k('Ctrl K', 'search the page'), k('I', 'pick a colour'), k(', .', 'step the page a frame back or on')),
      h('div', { style: { marginTop: '14px' } }, h('button', { html: `${icon('search', 13)}<span>Search the page</span>`, onclick: () => ctl.openFinder?.() }), h('button', { html: `${icon('pipette', 13)}<span>Pick a colour</span>`, onclick: () => ctl.startPick() })),
    )
  }

  function render() {
    const active = doc.activeElement
    if (active && host.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) {
      deferred = true
      return
    }
    deferred = false
    const my = ++token
    const s = ctl.selection()
    const g = ctl.group?.()
    const picked = ctl.picked()
    const kids = []
    if (g) kids.push(...groupPanel(g))
    else if (!s) kids.push(empty())
    if (picked) kids.push(section('picked', 'Picked colour', pickedCard()))
    if (s && !g) {
      kids.push(header(s), actions(s))
      const kind = s.drawing ? 'drawing' : 'element'
      const list = s.drawing
        ? [
            ['drawing', 'Drawing'],
            ['settings', 'Settings'],
            ['source', 'Source'],
          ]
        : [
            ['design', 'Design'],
            ['settings', 'Settings'],
            ['motion', 'Motion'],
            ['source', 'Source'],
          ]
      let tab = tabs[kind] ?? list[0][0]
      if (!list.some(([id]) => id === tab)) tab = list[0][0]
      kids.push(
        h(
          'div',
          { class: 'tabs', role: 'tablist' },
          list.map(([id, label]) =>
            h('button', {
              class: id === tab ? 'on' : '',
              role: 'tab',
              text: label,
              onclick: () => {
                tabs[kind] = id
                keep(TAB_KEY, tabs)
                render()
              },
            }),
          ),
        ),
      )
      const body = tab === 'drawing' ? drawingTab(s) : tab === 'design' ? design(s, my) : tab === 'settings' ? settingsTab(s, my) : tab === 'motion' ? motionTab(s, my) : sourceTab(s, my)
      kids.push(...body)
    }
    host.replaceChildren(...kids.flat().filter(Boolean))
    if (compact) host.scrollTop = 0
  }

  host.addEventListener('focusout', () => setTimeout(() => deferred && render(), 0))
  return { render }
}
