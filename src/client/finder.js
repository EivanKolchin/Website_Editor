import { h, icon } from './ui.js'

/**
 * SEARCH THE PAGE (Ctrl+K, or /).
 *
 * One box for everything: words a person can see, things by what they are
 * called (a component, a class, a tag), everything a file puts on the page,
 * a colour by its value, and the editor's own commands. Results arrive as
 * they are typed; the highlighted one is shown on the page as it is reached,
 * so the arrow keys can be used to look as well as to choose. Drawn in the
 * studio or over the page; the search itself is the editor's (`ctl.search`).
 */

export const FINDER_CSS = `
.fd-back { position: fixed; inset: 0; background: var(--scrim); backdrop-filter: blur(2px); display: none; z-index: 30; pointer-events: auto; }
.fd { position: fixed; left: 50%; top: 12vh; transform: translateX(-50%); width: min(640px, calc(100vw - 32px)); max-height: 70vh; display: none; flex-direction: column; z-index: 31; pointer-events: auto;
  background: var(--panel-2); border: 1px solid rgba(255,255,255,0.09); border-radius: 14px; box-shadow: 0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.4); overflow: hidden; font: 500 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); }
.fd .fd-in { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,0.07); color: var(--mut); }
.fd .fd-in input { flex: 1; background: none; border: 0; outline: none; color: var(--ink); font: 500 15px/1.3 inherit; font-family: inherit; height: 26px; padding: 0; }
.fd .fd-in input::placeholder { color: var(--faint); }
.fd kbd { font: 600 10.5px/1 inherit; font-family: inherit; padding: 3px 5px; border-radius: 5px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1); color: var(--mut); }
.fd .fd-list { overflow: auto; padding: 6px; overscroll-behavior: contain; }
.fd h6 { margin: 8px 8px 4px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint); }
.fd .fd-row { display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 10px; width: 100%; min-height: 38px; padding: 6px 10px; border: 0; border-radius: 9px; background: none; color: inherit; text-align: left; cursor: pointer; font: inherit; }
.fd .fd-row.on { background: rgba(var(--acc-rgb),0.16); }
.fd .fd-row .ic { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; background: rgba(255,255,255,0.06); color: var(--mut); font-size: 11px; font-weight: 800; }
.fd .fd-row .ic.jsx { color: var(--acc); background: rgba(var(--acc-rgb),0.14); }
.fd .fd-row .ic.str { color: var(--source); background: rgba(var(--source-rgb),0.14); }
.fd .fd-row .ic.action { color: var(--ink); }
.fd .fd-row .tx { min-width: 0; }
.fd .fd-row .t1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd .fd-row .t2 { color: var(--mut); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd .fd-row mark { background: var(--warning-soft); color: var(--warning); border-radius: 3px; padding: 0 1px; }
.fd .fd-row .rt { color: var(--faint); font-size: 11.5px; }
.fd .fd-tips { padding: 14px 16px 18px; color: var(--mut); line-height: 1.7; }
.fd .fd-tips b { color: var(--ink); font-weight: 600; }
.fd .fd-foot { display: flex; gap: 14px; padding: 8px 14px; border-top: 1px solid rgba(255,255,255,0.07); color: var(--faint); font-size: 11.5px; }
`

/** Words of a query marked in a text, as nodes: never as HTML. */
function marked(text, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [text]
  const lower = text.toLowerCase()
  const spans = []
  for (const w of words) for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + w.length)) spans.push([i, i + w.length])
  spans.sort((a, b) => a[0] - b[0])
  const out = []
  let at = 0
  for (const [s, e] of spans) {
    if (s < at) continue
    if (s > at) out.push(text.slice(at, s))
    out.push(h('mark', { text: text.slice(s, e) }))
    at = e
  }
  out.push(text.slice(at))
  return out
}

export function createFinder(host, getCtl) {
  const input = h('input', { placeholder: 'Search the page: words, elements, files, colours, commands', spellcheck: 'false', 'aria-label': 'Search the page' })
  const list = h('div', { class: 'fd-list', role: 'listbox' })
  const back = h('div', { class: 'fd-back' })
  const panel = h(
    'div',
    { class: 'fd', role: 'dialog', 'aria-label': 'Search' },
    h('div', { class: 'fd-in' }, h('span', { html: icon('search', 18) }), input, h('kbd', { text: 'Esc' })),
    list,
    h('div', { class: 'fd-foot' }, h('span', {}, h('kbd', { text: 'Up' }), ' ', h('kbd', { text: 'Down' }), ' to look'), h('span', {}, h('kbd', { text: 'Enter' }), ' to select'), h('span', {}, h('kbd', { text: 'Esc' }), ' to close')),
  )
  host.append(back, panel)
  let rows = []
  let active = 0
  let token = 0
  let timer = 0

  function tips() {
    list.replaceChildren(
      h(
        'div',
        { class: 'fd-tips' },
        h('div', {}, h('b', { text: 'Words you can see' }), ' - "teach it", "join the waitlist"'),
        h('div', {}, h('b', { text: 'What things are called' }), ' - a component (Bar), a class (hero), a tag (h2)'),
        h('div', {}, h('b', { text: 'A file' }), ' - Bar.tsx lists everything it puts on this page'),
        h('div', {}, h('b', { text: 'A colour' }), ' - #f97316 finds where it is written'),
        h('div', {}, h('b', { text: 'A command' }), ' - freeze, save, pick colour, slow motion'),
      ),
    )
    rows = []
  }

  function setActive(i, look = true) {
    if (!rows.length) return
    active = (i + rows.length) % rows.length
    rows.forEach((r, k) => r.node.classList.toggle('on', k === active))
    rows[active].node.scrollIntoView({ block: 'nearest' })
    const it = rows[active].item
    if (look && it.el) getCtl()?.reveal(it.el)
  }

  function choose(i = active) {
    const it = rows[i]?.item
    if (!it) return
    close()
    const ctl = getCtl()
    if (it.run) it.run()
    else if (it.el) {
      ctl?.hover(null)
      ctl?.selectElement(it.el)
    }
  }

  async function run() {
    const q = input.value
    const my = ++token
    if (!q.trim()) return tips()
    const groups = (await getCtl()?.search(q)) ?? []
    if (my !== token) return
    const kids = []
    rows = []
    for (const g of groups) {
      kids.push(h('h6', { text: g.title }))
      for (const item of g.items) {
        const i = rows.length
        const ic = item.kind === 'text' ? h('span', { class: 'ic', text: 'T' }) : item.kind === 'color' ? h('span', { class: 'ic', style: { background: `rgb(${item.rgb.r},${item.rgb.g},${item.rgb.b})` } }) : item.kind === 'action' ? h('span', { class: 'ic action', html: icon('fwd', 12) }) : h('span', { class: `ic ${item.kind}`, html: icon(item.kind === 'jsx' ? 'code' : 'layers', 12) })
        const node = h(
          'button',
          { class: 'fd-row', role: 'option', onpointermove: () => active !== i && setActive(i), onclick: () => choose(i) },
          ic,
          h('div', { class: 'tx' }, h('div', { class: 't1' }, ...(item.snippet ? marked(item.snippet, q) : marked(item.label, q))), item.snippet || item.sub ? h('div', { class: 't2', text: item.snippet ? item.label : item.sub }) : null),
          h('span', { class: 'rt', text: item.key ?? '' }),
        )
        rows.push({ node, item })
        kids.push(node)
      }
    }
    if (!rows.length) kids.push(h('div', { class: 'fd-tips', text: `Nothing on this page matches "${q}".` }))
    list.replaceChildren(...kids)
    active = 0
    setActive(0, false)
  }

  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(run, 90)
  })
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(active + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(active - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })
  back.addEventListener('pointerdown', () => close())

  function open(q = '') {
    back.style.display = 'block'
    panel.style.display = 'flex'
    input.value = q
    input.focus()
    input.select()
    if (q) run()
    else tips()
  }
  function close() {
    back.style.display = 'none'
    panel.style.display = 'none'
    getCtl()?.hover(null)
  }
  return {
    open,
    close,
    get isOpen() {
      return panel.style.display === 'flex'
    },
  }
}
