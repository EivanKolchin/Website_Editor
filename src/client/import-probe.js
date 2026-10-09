import { siteOf } from './canvas.js'

/** Read the rendered page through the same source chains the editor selects.
 * Runs inside the page: React fibers and SVG instances belong to this window.
 * No selections, previews or page DOM are changed by these checks.
 */
export async function probeImport({ unitFor, fiberOf, isLocked, locatorOf, record, boot }) {
  const els = [...document.querySelectorAll('[data-rt]')].filter((e) => {
    if (isLocked(e)) return false
    const box = e.getBoundingClientRect()
    return box.width + box.height > 0 && getComputedStyle(e).visibility !== 'hidden'
  })
  const priority = (el) => (el.ownerSVGElement ? 4 : 0) + (/@/.test(el.getAttribute('data-rt')) ? 3 : 0) + (/^H[1-6]$/.test(el.tagName) ? 2 : 0)
  els.sort((a, b) => priority(b) - priority(a))
  const kinds = new Set(), stamps = new Set(), samples = []
  for (const el of els) {
    const unit = unitFor(el)
    for (let i = 0; i < unit.stamps.length; i++) {
      const stamp = unit.stamps[i], kind = `${unit.svg}:${unit.names[i]}:${/@/.test(stamp)}`
      if (stamps.has(stamp) || kinds.has(kind) || samples.length >= 24) continue
      stamps.add(stamp); kinds.add(kind)
      samples.push({ stamp, svg: unit.svg, outlineOffset: getComputedStyle(el).outlineOffset, text: i === 0 && !el.children.length ? el.textContent : '' })
    }
  }
  const html = []
  for (const host of els) {
    if (!fiberOf(host)?.memoizedProps?.dangerouslySetInnerHTML) continue
    for (const el of host.querySelectorAll('*')) {
      if (html.length >= 6 || isLocked(el) || el.children.length || !el.textContent.trim()) continue
      html.push({ key: String(html.length), ...locatorOf(el, host) })
    }
  }
  const canvases = [...document.querySelectorAll('canvas')].filter((e) => !isLocked(e))
  const frames = [], sites = new Set()
  let recorded = 0
  if (canvases.length) {
    const drawings = await record({ stacks: true })
    for (const canvas of canvases.slice(0, 6)) {
      const items = drawings.get(canvas) ?? []
      if (items.length) recorded++
      for (const item of items) {
        const site = siteOf(item, boot.tool)
        if (!site || sites.has(site.key) || sites.size >= 8) continue
        sites.add(site.key)
        for (const fr of site.frames) frames.push({ ...fr, group: site.key, key: `${site.key}:${frames.length}` })
      }
    }
  }
  return { react: els.some((el) => !!fiberOf(el)), samples, html, canvases: canvases.length, recorded, frames }
}
