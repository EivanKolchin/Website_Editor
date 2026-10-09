// An inert rendering of the actual page, including unsaved styles and canvas
// pixels. No second copy of the site's scripts, React app or editor is run.
// During scrubbing the stage holds its initial rendering; the small window
// receives the live page's proposed rendering. Releasing reveals that page.
export function paintSnapshot(win, frame, exclude) {
  const source = win.document
  const doc = frame.contentDocument
  if (!doc || !source.documentElement) return false
  const root = doc.importNode(source.documentElement, true)
  const originals = [source.documentElement, ...source.documentElement.querySelectorAll('*')]
  const copies = [root, ...root.querySelectorAll('*')]
  const map = new Map(originals.map((el, i) => [el, copies[i]]))
  for (const el of originals) {
    const copy = map.get(el)
    if (exclude?.contains(el) || /^(SCRIPT|IFRAME|OBJECT|EMBED|BASE)$/.test(el.tagName) || (el.tagName === 'META' && el.httpEquiv)) {
      copy.remove()
      continue
    }
    for (const attribute of [...copy.attributes]) if (/^on/i.test(attribute.name) || attribute.name === 'autofocus') copy.removeAttribute(attribute.name)
    if (el.tagName === 'INPUT') { copy.value = el.value; copy.checked = el.checked }
    if (el.tagName === 'TEXTAREA') copy.value = el.value
    if (el.tagName === 'SELECT') copy.selectedIndex = el.selectedIndex
    // Runtime stylesheets may live only in the CSSOM (insertRule), and URL
    // values in an external sheet are relative to that sheet, not the page.
    if ((el.tagName === 'STYLE' || (el.tagName === 'LINK' && el.rel === 'stylesheet')) && el.sheet) {
      try {
        const css = [...el.sheet.cssRules].map((rule) => rule.cssText).join('\n')
          .replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, (all, quote, url) => `url("${new URL(url, el.sheet.href || source.baseURI).href}")`)
        const style = doc.createElement('style')
        style.textContent = css
        copy.replaceWith(style)
      } catch {} // cross-origin stylesheets retain their original link
    }
  }
  const head = root.querySelector('head')
  const base = doc.createElement('base')
  base.href = source.baseURI
  head.prepend(base)
  const policy = doc.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "script-src 'none'; object-src 'none'; frame-src 'none'"
  head.prepend(policy)
  const still = doc.createElement('style')
  still.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}'
  // Capture animated values before disabling animations in the copy.
  let index = 0
  const pseudoIds = new Map()
  for (const animation of source.getAnimations?.() ?? []) {
    const effect = animation.effect, target = effect?.target
    const copy = map.get(target)
    if (!copy || !root.contains(copy)) continue
    const pseudo = effect.pseudoElement
    const computed = win.getComputedStyle(target, pseudo || null)
    const values = []
    for (const property of new Set((effect.getKeyframes?.() ?? []).flatMap((key) => Object.keys(key)))) {
      if (['offset', 'computedOffset', 'easing', 'composite'].includes(property)) continue
      const cssName = property.startsWith('--') ? property : property.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
      const value = computed.getPropertyValue(cssName)
      if (!value) continue
      if (pseudo) values.push(`${cssName}:${value}!important`)
      else copy.style.setProperty(cssName, value, 'important')
    }
    if (pseudo && values.length) {
      if (!pseudoIds.has(copy)) pseudoIds.set(copy, ++index)
      const id = pseudoIds.get(copy)
      copy.setAttribute('data-retouch-still', String(id))
      still.textContent += `[data-retouch-still="${id}"]${pseudo}{${values.join(';')}}`
    }
  }
  head.append(still)
  root.setAttribute('inert', '')
  doc.replaceChild(root, doc.documentElement)
  for (const [el, copy] of map) if (copy.isConnected) {
    if (el.scrollTop || el.scrollLeft) {
      copy.scrollTop = el.scrollTop
      copy.scrollLeft = el.scrollLeft
    }
    // Paint after attachment, so the iframe's compositor receives the canvas
    // invalidation as well as its backing pixels.
    if (el.tagName === 'CANVAS') {
      try { copy.getContext('2d')?.drawImage(el, 0, 0) } catch {}
    }
  }
  doc.defaultView.scrollTo(win.scrollX, win.scrollY)
  return true
}
