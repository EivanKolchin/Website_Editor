import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE STUDIO PAGE: a bare document the editor's panels are drawn into
 * (src/client/studio.js), with the project's page in a frame between them.
 * Same origin as the page, so the panels reach the editor running inside
 * the frame directly - no messages, no copies of its state.
 *
 * Its tab wears THE PROJECT'S OWN ICON, read from the project's index.html.
 * Never one of Retouch's, and never nothing: a page without an icon makes
 * the browser ask for /favicon.ico, and one that has cached another
 * project's icon for this same localhost address shows that instead.
 */
export function studioPage({ name, entry, icons = [] }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const links = (icons.length ? icons : [{ rel: 'icon', href: 'data:,' }])
    .map((i) => `<link rel="${esc(i.rel)}" href="${esc(i.href)}"${i.type ? ` type="${esc(i.type)}"` : ''}${i.sizes ? ` sizes="${esc(i.sizes)}"` : ''} data-project-icon>`)
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Retouch - ${esc(name)}</title>
${links}
<meta name="color-scheme" content="dark">
<style>html,body{margin:0;height:100%;background:#0e0e11;color:#f4f4f5;overflow:hidden}</style>
</head>
<body>
<script type="module" src="${esc(entry)}"></script>
</body>
</html>`
}

const attrOf = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? (m[1] ?? m[2] ?? m[3]) : null
}

/**
 * The icons the project's index.html declares, as the dev server serves
 * them: a path from the site's root under Vite's `base`, a relative one
 * resolved against it, anything with a scheme left alone. With none
 * declared, a favicon in public/ or the root is used if there is one.
 * Read on every request, since the file can change while Retouch runs.
 */
export function projectIcons(root, base = '/') {
  const b = base.endsWith('/') ? base : `${base}/`
  const at = (href) => {
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return href
    if (href.startsWith('/')) return href.startsWith(b) || b === '/' ? href : b + href.slice(1)
    return b + href.replace(/^\.\//, '')
  }
  let html = ''
  try {
    html = readFileSync(join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  } catch {}
  const out = []
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attrOf(tag, 'rel') ?? '').toLowerCase().split(/\s+/)
    const href = attrOf(tag, 'href')
    if (!href || !(rel.includes('icon') || rel.includes('apple-touch-icon'))) continue
    out.push({ rel: rel.join(' '), href: at(href), type: attrOf(tag, 'type'), sizes: attrOf(tag, 'sizes') })
  }
  if (out.length) return out
  for (const [dir, file, type] of [
    ['public', 'favicon.svg', 'image/svg+xml'],
    ['public', 'favicon.png', 'image/png'],
    ['public', 'favicon.ico', null],
    ['', 'favicon.ico', null],
  ]) {
    if (existsSync(join(root, dir, file))) return [{ rel: 'icon', href: b + file, type }]
  }
  return []
}
