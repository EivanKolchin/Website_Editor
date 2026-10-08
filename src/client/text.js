/**
 * EDITING TEXT WHERE IT IS.
 *
 * The element becomes contenteditable, so the words are edited in their own
 * font, size and line breaks. But the DOM belongs to React, which holds
 * references to the exact text nodes it created; contenteditable is free to
 * split, merge and replace them as a person types. So the element's whole
 * structure is snapshotted when editing starts and put back, node for node,
 * when it ends - and only then is the change written into React's own text
 * nodes, as a minimal edit of their data. React never finds a node it did
 * not make, and never loses one it did.
 */

const BLOCKISH = /^(block|flex|grid|list-item|table|table-cell|table-caption|flow-root|inline-block|inline-flex|inline-grid)$/

/** The block a text node belongs to: walk up past inline wrappers such as links and spans. */
export function blockFor(node) {
  let el = node.nodeType === 3 ? node.parentElement : node
  while (el && el.parentElement && el !== document.body) {
    const d = getComputedStyle(el).display
    if (BLOCKISH.test(d) || el instanceof SVGElement) break
    el = el.parentElement
  }
  return el
}

export function textNodes(el) {
  const out = []
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n)
  return out
}

function snapshot(el) {
  const kids = new Map()
  const visit = (n) => {
    kids.set(n, [...n.childNodes])
    for (const c of n.childNodes) if (c.nodeType === 1) visit(c)
  }
  visit(el)
  const data = new Map(textNodes(el).map((t) => [t, t.data]))
  return { kids, data }
}

function restore(snap) {
  for (const [n, list] of snap.kids) {
    const same = n.childNodes.length === list.length && list.every((c, i) => n.childNodes[i] === c)
    if (!same) n.replaceChildren(...list)
  }
  for (const [t, d] of snap.data) if (t.data !== d) t.data = d
}

/**
 * Write `next` over the text nodes as one minimal change: the common prefix
 * and suffix stay where they are, and only the nodes covering the changed
 * middle are touched. Returns the per-node changes.
 */
export function applyText(nodes, next) {
  const old = nodes.map((n) => n.data).join('')
  if (old === next) return []
  let p = 0
  const max = Math.min(old.length, next.length)
  while (p < max && old[p] === next[p]) p++
  let s = 0
  while (s < max - p && old[old.length - 1 - s] === next[next.length - 1 - s]) s++
  const from = p
  const to = old.length - s
  const insert = next.slice(p, next.length - s)

  const bounds = []
  let off = 0
  for (const n of nodes) {
    bounds.push([off, off + n.data.length])
    off += n.data.length
  }
  // a pure insertion at a boundary goes into the EARLIER node, so a word
  // typed before a coloured full stop is not coloured with it
  let first = from === to ? bounds.findIndex(([a, b]) => from >= a && from <= b) : bounds.findIndex(([a, b]) => from < b && to > a)
  if (first < 0) first = nodes.length - 1
  const changes = []
  for (let i = Math.max(first, 0); i < nodes.length; i++) {
    const [a, b] = bounds[i]
    if (i > first && a >= to) break
    const n = nodes[i]
    const before = n.data
    const lo = Math.max(from, a) - a
    const hi = Math.max(lo, Math.min(to, b) - a)
    n.data = before.slice(0, lo) + (i === first ? insert : '') + before.slice(hi)
    if (n.data !== before) changes.push({ node: n, before, after: n.data })
    if (to <= b) break
  }
  return changes
}

/**
 * One editing session. `onCommit(changes)` receives the per-node changes;
 * it may reject them (the text was not found in source) by returning false,
 * and then they are rolled back.
 */
export function startEditing(el, { caret, onCommit, onEnd }) {
  const snap = snapshot(el)
  const nodes = textNodes(el)
  const startText = nodes.map((n) => n.data).join('')
  const prev = { ce: el.getAttribute('contenteditable'), spell: el.getAttribute('spellcheck') }
  let mode = 'plaintext-only'
  try {
    el.contentEditable = 'plaintext-only'
    if (el.contentEditable !== 'plaintext-only') throw 0
  } catch {
    mode = 'true'
    el.contentEditable = 'true'
  }
  el.setAttribute('spellcheck', 'false')
  // a page that lets drags pass through its words (pointer-events: none) or stops them being
  // selected would leave a field nobody can click a caret into: opened up while it is edited
  const openUp = [
    ['pointer-events', 'auto'],
    ['user-select', 'text'],
    ['-webkit-user-select', 'text'],
    ['cursor', 'text'],
  ].map(([p, v]) => {
    const was = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]
    el.style.setProperty(p, v, 'important')
    return [p, was]
  })
  el.focus({ preventScroll: true })
  const sel = window.getSelection()
  if (caret) {
    sel.removeAllRanges()
    sel.addRange(caret)
  }

  const onPaste = (e) => {
    if (mode === 'plaintext-only') return
    e.preventDefault()
    const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s*\n\s*/g, ' ')
    document.execCommand('insertText', false, text)
  }
  el.addEventListener('paste', onPaste)

  let finished = false
  function finish(commit) {
    if (finished) return
    finished = true
    // Line breaks a person typed become spaces; line breaks that were in the
    // text all along (HTML from a file keeps its source whitespace) stay,
    // so only the words that changed are written back.
    const raw = el.textContent ?? ''
    let p = 0
    const max = Math.min(raw.length, startText.length)
    while (p < max && raw[p] === startText[p]) p++
    let s = 0
    while (s < max - p && raw[raw.length - 1 - s] === startText[startText.length - 1 - s]) s++
    const typed = startText.slice(0, p) + raw.slice(p, raw.length - s).replace(/\s*\n\s*/g, ' ') + startText.slice(startText.length - s)
    el.removeEventListener('paste', onPaste)
    for (const [p, [v, pri]] of openUp) {
      if (v) el.style.setProperty(p, v, pri)
      else el.style.removeProperty(p)
    }
    if (el.getAttribute('style') === '') el.removeAttribute('style')
    if (prev.ce == null) el.removeAttribute('contenteditable')
    else el.setAttribute('contenteditable', prev.ce)
    if (prev.spell == null) el.removeAttribute('spellcheck')
    else el.setAttribute('spellcheck', prev.spell)
    restore(snap)
    window.getSelection()?.removeAllRanges()
    let changes = []
    if (commit && typed !== startText) changes = applyText(nodes, typed)
    onEnd?.()
    if (changes.length) Promise.resolve(onCommit(changes)).then((kept) => {
      if (kept === false) for (const c of changes) c.node.data = c.before
    })
  }

  return {
    el,
    commit: () => finish(true),
    cancel: () => finish(false),
    get finished() {
      return finished
    },
  }
}
