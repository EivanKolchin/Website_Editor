import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { normalise, TOOL_DIR } from '../src/server/config.mjs'
import { retouchPlugin } from '../src/server/plugin.mjs'
import { loadParser } from '../src/server/ast.mjs'
import { importVite } from '../src/server/start.mjs'

const host = resolve(TOOL_DIR, '..')
const require = createRequire(join(host, 'package.json'))
const puppeteer = require('puppeteer')
const react = (await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)).default
const vite = await importVite(host)

const dir = mkdtempSync(join(tmpdir(), 'retouch-kerfox-repro-'))
const nodeModules = join(dir, 'node_modules')
symlinkSync(join(host, 'node_modules'), nodeModules, 'junction')
mkdirSync(join(dir, 'src'))
writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', name: 'Repro test' }))
writeFileSync(join(dir, 'index.html'), '<html><head><title>Repro</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>')

// Scene with two canvases:
// back canvas: sky background + 6 star dots
// front canvas: connecting line through the 6 dots
const source = `import React, { useEffect } from 'react'; import { createRoot } from 'react-dom/client';
function App() {
  useEffect(() => {
    const back = document.querySelector('.cv-back');
    const front = document.querySelector('.cv-front');
    const bctx = back.getContext('2d');
    const fctx = front.getContext('2d');
    let id;
    const stars = [
      [100, 100], [140, 110], [180, 120], [220, 130], [260, 140], [300, 150]
    ];
    function draw() {
      // 1. Back canvas: navy sky + stars
      bctx.fillStyle = '#0a192f'; // dark navy
      bctx.fillRect(0, 0, 800, 600);

      bctx.fillStyle = '#ffffff';
      for (const [x, y] of stars) {
        bctx.beginPath();
        bctx.arc(x, y, 4, 0, Math.PI * 2);
        bctx.fill();
      }

      // 2. Front canvas: line connecting stars
      fctx.clearRect(0, 0, 800, 600);
      fctx.beginPath();
      for (let i = 0; i < stars.length - 1; i++) {
        fctx.moveTo(stars[i][0], stars[i][1]);
        fctx.lineTo(stars[i+1][0], stars[i+1][1]);
      }
      fctx.strokeStyle = '#70a5d8';
      fctx.lineWidth = 1.5;
      fctx.stroke();

      id = requestAnimationFrame(draw);
    }
    id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div style={{position: 'relative', width: 800, height: 600}}>
      <canvas className="cv-back" width="800" height="600" style={{position:'absolute', inset:0, pointerEvents:'none', zIndex:0}}/>
      <canvas className="cv-front" width="800" height="600" style={{position:'absolute', inset:0, pointerEvents:'none', zIndex:3}}/>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App/>);`

writeFileSync(join(dir, 'src/main.jsx'), source)

let browser, server
const errors = []
try {
  loadParser(host)
  const config = normalise({ name: 'Repro test', vite: { port: 5293 } }, dir)
  server = await vite.createServer({
    configFile: false,
    root: dir,
    cacheDir: join(dir, '.cache/vite'),
    plugins: [react(), retouchPlugin({ config })],
    server: { port: 5293, strictPort: true, host: '127.0.0.1' }
  })
  await server.listen()

  browser = await puppeteer.launch({
    executablePath: process.env.RETOUCH_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-first-run', '--disable-features=msEdgeSidebarV2']
  })
  const page = await browser.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()))
  await page.setViewport({ width: 1000, height: 800 })
  await page.goto('http://127.0.0.1:5293/__retouch/studio', { waitUntil: 'networkidle0' })

  const frame = page.frames().find((f) => f.url().endsWith(':5293/'))
  await frame.waitForFunction(() => !!window.__RETOUCH__?.app)

  // Test what happens in Retouch
  const testInfo = await frame.evaluate(async () => {
    const c = window.__RETOUCH__.app
    // Let animation run a few frames before freezing
    await new Promise((r) => setTimeout(r, 100))

    // Freeze page
    c.setFrozen(true)
    const rec = await c.debug.capture({ stacks: true })
    const back = document.querySelector('.cv-back')
    const front = document.querySelector('.cv-front')
    const backItems = rec.get(back) || []
    const frontItems = rec.get(front) || []

    return {
      backCount: backItems.length,
      backItems: backItems.map((i) => ({ kind: i.kind, bbox: i.bbox, color: i.color, seq: i.seq })),
      frontCount: frontItems.length,
      frontItems: frontItems.map((i) => ({ kind: i.kind, bbox: i.bbox, color: i.color, seq: i.seq })),
    }
  })

  console.log('Test Info:', JSON.stringify(testInfo, null, 2))

  // Now test marquee selection over the constellation (stars + line)
  // Stars are at x: 100 to 300, y: 100 to 150.
  // Marquee box from (80, 80) to (320, 170).
  const marqueeRes = await frame.evaluate(async () => {
    const c = window.__RETOUCH__.app
    // Hit test or marquee
    // Simulate what finishMarquee does:
    const r = { left: 80, top: 80, right: 320, bottom: 170, width: 240, height: 90 }
    const frames = await c.debug.capture()
    const allDrawings = []
    for (const [cv, items] of frames) {
      for (const it of items) {
        if (it.bbox.w * it.bbox.h > cv.width * cv.height * 0.85) continue // ground
        // check if within
        const { r: cr, k } = { r: cv.getBoundingClientRect(), k: cv.width / cv.getBoundingClientRect().width }
        const pr = { left: cr.left + it.bbox.x / k, top: cr.top + it.bbox.y / k, right: cr.left + (it.bbox.x + it.bbox.w) / k, bottom: cr.top + (it.bbox.y + it.bbox.h) / k }
        const isWithin = pr.left >= r.left - 1 && pr.right <= r.right + 1 && pr.top >= r.top - 1 && pr.bottom <= r.bottom + 1
        allDrawings.push({
          canvas: cv.className,
          kind: it.kind,
          bbox: it.bbox,
          pr,
          isWithin,
        })
      }
    }
    return allDrawings
  })
  console.log('Marquee check for all drawings:', JSON.stringify(marqueeRes, null, 2))

  // Now test hit testing directly on the line!
  // Line passes through page (128, 113) (canvas (120, 105) + (8, 8) margin)
  const lineHitRes = await frame.evaluate(async () => {
    const c = window.__RETOUCH__.app
    const rec = await c.debug.capture()
    const front = document.querySelector('.cv-front')
    const back = document.querySelector('.cv-back')
    const frontHits = c.debug.itemsAt(rec.get(front), 128, 113)
    const backHits = c.debug.itemsAt(rec.get(back), 128, 113)
    const hit = await c.debug.resolveHit(128, 113)
    return {
      frontHits: frontHits.map(d => ({ kind: d.kind, bbox: d.bbox })),
      backHits: backHits.map(d => ({ kind: d.kind, bbox: d.bbox })),
      resolved: hit.drawings?.map(d => ({ canvas: d.canvas.className, kind: d.kind, bbox: d.bbox }))
    }
  })
  // Select ALL drawings (both back stars and front line) into a group!
  const groupRes = await frame.evaluate(async () => {
    const c = window.__RETOUCH__.app
    const back = document.querySelector('.cv-back')
    const front = document.querySelector('.cv-front')
    const rec = await c.debug.capture()
    const backItems = (rec.get(back) || []).filter(i => i.bbox.w < 500)
    const frontItems = rec.get(front) || []
    const all = [...backItems, ...frontItems]

    await c.toggleDrawings(all)
    const grp = c.group()
    return {
      membersCount: grp?.members?.length,
      members: grp?.members?.map(m => ({ canvas: m.drawing.canvas.className, kind: m.drawing.kind }))
    }
  })
  console.log('Group selected:', JSON.stringify(groupRes, null, 2))

  // Inspect initial pixels:
  // (128, 113) on front canvas is line color (#70a5d8 -> rgb(112, 165, 216))
  // (108, 108) on back canvas is star color (#ffffff)
  const getFrontPixel = async (x, y) => {
    return await frame.evaluate(([px, py]) => {
      const cv = document.querySelector('.cv-front')
      const ctx = cv.getContext('2d')
      const d = ctx.getImageData(px, py, 1, 1).data
      return [d[0], d[1], d[2], d[3]]
    }, [x, y])
  }
  const getBackPixel = async (x, y) => {
    return await frame.evaluate(([px, py]) => {
      const cv = document.querySelector('.cv-back')
      const ctx = cv.getContext('2d')
      const d = ctx.getImageData(px, py, 1, 1).data
      return [d[0], d[1], d[2], d[3]]
    }, [x, y])
  }

  const pLine_init = await getFrontPixel(120, 105)
  const pStar_init = await getBackPixel(100, 100)
  console.log('Initial line pixel on cv-front at (120, 105):', pLine_init)
  console.log('Initial star pixel on cv-back at (100, 100):', pStar_init)

  // Move group by dx=+50, dy=+50
  const dragRes = await frame.evaluate(async () => {
    const c = window.__RETOUCH__.app
    const gesture = await c.debug.beginGroupGesture({ x: 200, y: 150 }, 'move')
    if (!gesture) return { error: 'gesture is null' }
    gesture.move({ x: 250, y: 200 })
    gesture.end()
    return { ok: true }
  })
  console.log('Drag result:', dragRes)
  await frame.evaluate(() => new Promise((r) => setTimeout(r, 50)))

  // Inspect pixels AFTER move:
  // On front canvas:
  // Old line pixel (120, 105) should be CLEARED (alpha 0)
  // New line pixel (120+50=170, 105+50=155) should be LINE COLOR!
  const pLine_old = await getFrontPixel(120, 105)
  const pLine_new = await getFrontPixel(170, 155)
  console.log('After move, old line on cv-front at (120, 105):', pLine_old)
  console.log('After move, new line on cv-front at (170, 155):', pLine_new)

  // On back canvas:
  // Old star pixel (100, 100) should be NAVY SKY (#0a192f)
  // New star pixel (150, 150) should be WHITE!
  const pStar_old = await getBackPixel(100, 100)
  const pStar_new = await getBackPixel(150, 150)
  console.log('After move, old star on cv-back at (100, 100):', pStar_old)
  console.log('After move, new star on cv-back at (150, 150):', pStar_new)
} finally {
  await browser?.close()
  await server?.close()
  unlinkSync(nodeModules)
  rmSync(dir, { recursive: true, force: true })
}
