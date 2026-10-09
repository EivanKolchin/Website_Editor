import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { TOOL_DIR } from '../src/server/config.mjs'

const host = resolve(TOOL_DIR, '..')
const require = createRequire(join(host, 'package.json'))
const puppeteer = require('puppeteer')

const browser = await puppeteer.launch({
  executablePath: process.env.RETOUCH_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-first-run', '--disable-features=msEdgeSidebarV2']
})
const page = await browser.newPage()
try {
  await page.setViewport({ width: 1200, height: 800 })
  // Connect to the running dev server on 5199 if running, or launch one
  await page.goto('http://127.0.0.1:5199/__retouch/studio', { waitUntil: 'networkidle0', timeout: 5000 }).catch(() => null)
  const frame = page.frames().find((f) => f.url().includes('5199'))
  if (!frame) {
    console.log('Server not running on 5199')
  } else {
    await frame.waitForFunction(() => !!window.__RETOUCH__?.app, { timeout: 5000 })
    const info = await frame.evaluate(async () => {
      const c = window.__RETOUCH__.app
      c.setFrozen(true)
      const rec = await c.debug.capture({ stacks: true })
      const canvases = [...document.querySelectorAll('canvas')]
      return canvases.map((cv) => {
        const items = rec.get(cv) || []
        return {
          className: cv.className,
          width: cv.width,
          height: cv.height,
          itemsCount: items.length,
          items: items.map((it) => ({
            kind: it.kind,
            color: it.color,
            lineWidth: it.lineWidth,
            bbox: it.bbox,
            subsCount: it.subs?.length,
            arcsCount: it.arcs?.length,
          }))
        }
      })
    })
    console.log('Canvases info:', JSON.stringify(info, null, 2))
  }
} finally {
  await browser.close()
}
