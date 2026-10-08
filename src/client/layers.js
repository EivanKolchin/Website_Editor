import { h, icon } from './ui.js'

/**
 * THE LAYERS PANEL: the page as a tree, so anything can be selected even
 * when it is under something else, moving, tiny or invisible.
 *
 * Built from the page's live DOM and only as deep as it is opened, because
 * a real page has thousands of elements. Each row says what kind of thing
 * it is (a component, text, an image, a drawing surface, a box); a blue dot
 * is written in JSX, a violet one came from markup set as a string or a
 * script. A canvas opens into its DRAWINGS, grouped by the line of code
 * that drew them - the one way to reach a star two pixels wide. The eye
 * hides an element for a moment to see past it: a view, never an edit.
 */

const SKIP = /^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE|HEAD|TITLE|RETOUCH-EDITOR|BR|WBR)$/

export const LAYERS_CSS = `
.layers { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.layers .lsearch { padding: 8px 8px 6px; }
.layers .lsearch input { width: 100%; box-sizing: border-box; height: 28px; padding: 0 9px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.07); color: #ededf2; font: inherit; outline: none; }
.layers .lsearch input:focus { border-color: #4c8dff; box-shadow: 0 0 0 3px rgba(76,141,255,0.15); }
.layers .tree { flex: 1; overflow: auto; padding: 2px 4px 24px; overscroll-behavior: contain; }
.layers .ln { display: flex; align-items: center; gap: 5px; height: 26px; padding-right: 6px; cursor: default; white-space: nowrap; font-size: 12px; border-radius: 7px; position: relative; }
.layers .ln:hover { background: rgba(255,255,255,0.045); }
.layers .ln.on { background: rgba(76,141,255,0.18); }
.layers .ln.on .nm { color: #fff; }
.layers .ln .tw { width: 16px; height: 16px; min-width: 16px; padding: 0; display: inline-flex; align-items: center; justify-content: center; color: #5c5c66; border-radius: 4px; background: none; border: 0; cursor: pointer; }
.layers .ln .tw:hover { color: #ededf2; background: rgba(255,255,255,0.08); }
.layers .ln .tw.shut svg { transform: rotate(-90deg); }
.layers .ln .tw.leaf { visibility: hidden; }
.layers .ln .ic { width: 16px; height: 16px; flex: none; display: inline-flex; align-items: center; justify-content: center; color: #8e8e9a; position: relative; }
.layers .ln .ic.jsx { color: #7aa7ff; }
.layers .ln .ic.str { color: #b5a4ff; }
.layers .ln .ic.draw { color: #5eead4; }
.layers .ln .nm { overflow: hidden; text-overflow: ellipsis; color: #d4d4d8; }
.layers .ln .nm b { font-weight: 650; color: #ededf2; }
.layers .ln .tx { color: #5c5c66; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.layers .ln .eye { margin-left: auto; width: 22px; height: 22px; min-width: 22px; padding: 0; opacity: 0; color: #8e8e9a; background: none; border: 0; border-radius: 5px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.layers .ln:hover .eye, .layers .ln .eye.off { opacity: 1; }
.layers .ln .eye:hover { background: rgba(255,255,255,0.08); color: #ededf2; }
.layers .ln.hid .nm, .layers .ln.hid .tx, .layers .ln.hid .ic { opacity: 0.4; }
.layers .ln.draw .nm { color: #a7f3e6; }
.layers .lempty { padding: 14px 12px; color: #8e8e9a; font-size: 12px; line-height: 1.5; }
`

const GLYPHS = {
  component: '<path d="M8 2.5L13.5 8 8 13.5 2.5 8z"/>',
  text: '<path d="M3.5 4h9M8 4v8.5"/>',
  image: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="M4.5 11l2.8-3 2 2 1.4-1.4 2 2.4"/>',
  shape: '<circle cx="6.5" cy="6.5" r="3.5"/><rect x="7.5" y="7.5" width="6" height="6" rx="1"/>',
  canvas: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M5 10.5c1.5-3 3-3 6-5"/>',
  box: '<rect x="2.5" y="3" width="11" height="10" rx="2"/>',
  link: '<path d="M6.6 9.4l2.8-2.8"/><path d="M7.4 4.6l1-1a2.6 2.6 0 0 1 3.7 3.7l-1 1"/><path d="M8.6 11.4l-1 1a2.6 2.6 0 0 1-3.7-3.7l1-1"/>',
  dot: '<circle cx="8" cy="8" r="2.4" fill="currentColor"/>',
}
const glyph = (name) => `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</svg>`

export function createLayers(host, { ctl: getCtl, doc: getDoc }) {
  const search = h('input', { placeholder: 'Filter layers  (Ctrl K searches everything)', spellcheck: 'false', 'aria-label': 'Filter layers' })
  const tree = h('div', { class: 'tree' })
  host.classList.add('layers')
  host.replaceChildren(h('div', { class: 'lsearch' }, search), tree)
  let open = new WeakSet()
  const hidden = new WeakMap() // element -> its visibility before the eye hid it
  const drawn = new WeakMap() // canvas -> its drawings, grouped
  const openGroups = new WeakSet()
  let rows = new Map() // element -> row
  let observer = null
  let timer = 0

  const kids = (el) => [...el.children].filter((c) => !SKIP.test(c.tagName))
  const ownText = (el) => {
    let t = ''
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.data
    return t.replace(/\s+/g, ' ').trim().slice(0, 60)
  }
  const kindOf = (el, comp) => {
    const t = el.tagName
    if (t === 'CANVAS') return 'canvas'
    if (t === 'IMG' || t === 'PICTURE' || t === 'VIDEO') return 'image'
    if (el.namespaceURI === 'http://www.w3.org/2000/svg') return 'shape'
    if (comp && comp.toLowerCase() !== t.toLowerCase()) return 'component'
    if (t === 'A') return 'link'
    if (ownText(el)) return 'text'
    return 'box'
  }

  function eyeFor(el) {
    const eye = h('button', { class: `eye${hidden.has(el) ? ' off' : ''}`, html: icon(hidden.has(el) ? 'eyeOff' : 'eye', 13), title: hidden.has(el) ? 'Show it again' : 'Hide it for a moment, to see past it (not saved)', tabindex: '-1' })
    eye.addEventListener('click', (e) => {
      e.stopPropagation()
      if (hidden.has(el)) {
        el.style.visibility = hidden.get(el)
        hidden.delete(el)
      } else {
        hidden.set(el, el.style.visibility)
        el.style.visibility = 'hidden'
      }
      render()
    })
    return eye
  }

  function row(el, depth) {
    const ctl = getCtl()
    const list = kids(el)
    const comp = ctl?.unitLabel(el)
    const tag = el.tagName.toLowerCase()
    const label = ctl?.labelOf(el) ?? tag
    const kind = kindOf(el, comp)
    const expandable = list.length > 0 || el.tagName === 'CANVAS'
    const tw = h('button', { class: `tw${expandable ? (open.has(el) ? '' : ' shut') : ' leaf'}`, html: icon('chevron', 12), tabindex: '-1' })
    const source = comp ? 'jsx' : ctl?.isForeign(el) ? 'str' : ''
    const r = h(
      'div',
      { class: `ln${hidden.has(el) ? ' hid' : ''}${(ctl?.selectedAll?.() ?? []).includes(el) ? ' on' : ''}`, style: { paddingLeft: `${4 + depth * 13}px` } },
      tw,
      h('span', { class: `ic ${source}`, html: glyph(kind), title: source === 'jsx' ? 'Written in JSX' : source === 'str' ? 'From markup set as a string, or a script' : '' }),
      h('span', { class: 'nm' }, comp && comp !== tag && comp !== label ? h('b', { text: comp + ' ' }) : null, label),
      h('span', { class: 'tx', text: ownText(el) }),
      eyeFor(el),
    )
    const toggle = () => {
      if (open.has(el)) open.delete(el)
      else open.add(el)
      render()
    }
    tw.addEventListener('click', (e) => {
      e.stopPropagation()
      toggle()
    })
    r.addEventListener('mouseenter', () => getCtl()?.hover(el))
    r.addEventListener('mouseleave', () => getCtl()?.hover(null))
    // Shift+click: in or out of the selection, for moving several together
    r.addEventListener('click', (e) => (e.shiftKey ? getCtl()?.toggleElement(el) : getCtl()?.selectElement(el)))
    r.addEventListener('dblclick', () => expandable && toggle())
    rows.set(el, r)
    return r
  }

  /** A canvas, opened: its drawings, one row per line of code that drew them, each group opening into its drawings. */
  function drawingRows(canvas, depth) {
    const data = drawn.get(canvas)
    if (!data) {
      getCtl()
        ?.drawingsOf(canvas)
        .then((groups) => {
          drawn.set(canvas, groups)
          render()
        })
      return [h('div', { class: 'ln', style: { paddingLeft: `${4 + depth * 13}px` } }, h('span', { class: 'tx', text: 'Reading what it draws...' }))]
    }
    if (!data.length) return [h('div', { class: 'ln', style: { paddingLeft: `${4 + depth * 13}px` } }, h('span', { class: 'tx', text: 'Nothing drawn on it in this frame.' }))]
    const out = []
    for (const g of data) {
      const many = g.items.length > 1
      const tw = h('button', { class: `tw${many ? (openGroups.has(g) ? '' : ' shut') : ' leaf'}`, html: icon('chevron', 12), tabindex: '-1' })
      const r = h('div', { class: 'ln draw', style: { paddingLeft: `${4 + depth * 13}px` } }, tw, h('span', { class: 'ic draw', html: glyph(many ? 'shape' : 'dot') }), h('span', { class: 'nm', text: g.label }), h('span', { class: 'tx', text: many ? 'one line of code' : '' }))
      tw.addEventListener('click', (e) => {
        e.stopPropagation()
        if (openGroups.has(g)) openGroups.delete(g)
        else openGroups.add(g)
        render()
      })
      r.addEventListener('mouseenter', () => getCtl()?.hover(null, g.items[0]))
      r.addEventListener('mouseleave', () => getCtl()?.hover(null))
      // Shift: all of them in or out of the selection, the way Shift+click works on the page
      r.addEventListener('click', (e) => (e.shiftKey ? getCtl()?.toggleDrawings(g.items) : getCtl()?.selectDrawing(g.items[0])))
      out.push(r)
      if (many && openGroups.has(g)) {
        g.items.slice(0, 80).forEach((it, i) => {
          const ir = h('div', { class: 'ln draw', style: { paddingLeft: `${4 + (depth + 1) * 13}px` } }, h('span', { class: 'tw leaf' }), h('span', { class: 'ic draw', html: glyph('dot') }), h('span', { class: 'nm', text: `${g.label.replace(/^\d+ x /, '')} ${i + 1}` }))
          ir.addEventListener('mouseenter', () => getCtl()?.hover(null, it))
          ir.addEventListener('mouseleave', () => getCtl()?.hover(null))
          ir.addEventListener('click', (e) => (e.shiftKey ? getCtl()?.toggleDrawings([it]) : getCtl()?.selectDrawing(it)))
          out.push(ir)
        })
      }
    }
    return out
  }

  function render() {
    const doc = getDoc()
    rows = new Map()
    if (!doc?.body) {
      tree.replaceChildren(h('div', { class: 'lempty', text: 'Loading the page...' }))
      return
    }
    const q = search.value.trim().toLowerCase()
    const out = []
    if (q) {
      const ctl = getCtl()
      for (const el of doc.body.querySelectorAll('*')) {
        if (SKIP.test(el.tagName) || el.closest('retouch-editor')) continue
        const hay = `${ctl?.labelOf(el) ?? ''} ${ctl?.unitLabel(el) ?? ''} ${ownText(el)}`.toLowerCase()
        if (q.split(/\s+/).every((w) => hay.includes(w))) out.push(row(el, 0))
        if (out.length >= 300) break
      }
      if (!out.length) out.push(h('div', { class: 'lempty', text: 'No layer matches. Ctrl K searches the words on the page, files and colours too.' }))
    } else {
      const walk = (el, depth) => {
        for (const c of kids(el)) {
          out.push(row(c, depth))
          if (open.has(c)) {
            if (c.tagName === 'CANVAS') out.push(...drawingRows(c, depth + 1))
            else walk(c, depth + 1)
          }
          if (out.length > 4000) return
        }
      }
      walk(doc.body, 0)
    }
    tree.replaceChildren(...out)
  }

  /** Open the tree down to the selection and bring its row into view. */
  function reveal(el) {
    const doc = getDoc()
    if (!el || !doc?.body?.contains(el)) return render()
    for (let p = el.parentElement; p && p !== doc.body; p = p.parentElement) open.add(p)
    render()
    rows.get(el)?.scrollIntoView({ block: 'nearest' })
  }

  function watch() {
    observer?.disconnect()
    const doc = getDoc()
    if (!doc?.body) return
    const Obs = doc.defaultView?.MutationObserver ?? MutationObserver
    // a page that animates by rewriting itself would rebuild this list every frame; once a second is plenty
    observer = new Obs(() => {
      clearTimeout(timer)
      timer = setTimeout(render, 900)
    })
    observer.observe(doc.body, { childList: true, subtree: true })
  }

  search.addEventListener('input', () => render())
  search.addEventListener('keydown', (e) => e.stopPropagation())

  return {
    render,
    reveal,
    /** Drawings move: forget them when the page's clock moves, so an opened canvas is read again. */
    forgetDrawings() {
      const doc = getDoc()
      for (const c of doc?.querySelectorAll('canvas') ?? []) drawn.delete(c)
    },
    attach() {
      open = new WeakSet()
      watch()
      render()
    },
  }
}
