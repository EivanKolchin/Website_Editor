// Optional integration gate: the host's Puppeteer and Chromium, mock provider
// responses, and an actual Vite + React website. No paid API calls or keys.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { TOOL_DIR } from '../src/server/config.mjs'
import { createProjects } from '../src/server/projects.mjs'
import { start } from '../src/server/start.mjs'
import { wireProject } from '../src/ai/wire.mjs'
import { fixtureTransport } from './setup.mjs'

const host = resolve(TOOL_DIR, '..'), require = createRequire(join(host, 'package.json'))
const puppeteer = require('puppeteer')
const root = mkdtempSync(join(tmpdir(), 'retouch-setup-browser-'))
const nodeModules = join(root, 'node_modules'), key = 'mock-browser-credential-not-real'
symlinkSync(join(host, 'node_modules'), nodeModules, 'junction')
mkdirSync(join(root, 'src'))
writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', name: 'Setup browser fixture', scripts: { dev: 'vite', lint: 'node lint.mjs' } }))
writeFileSync(join(root, 'vite.config.mjs'), 'import react from "@vitejs/plugin-react"; export default { plugins: [react()] }')
writeFileSync(join(root, 'lint.mjs'), 'process.exit(0)')
writeFileSync(join(root, 'index.html'), '<html><head><title>Setup fixture</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>')
const source = 'import React from "react"; export default function App(){return <main style={{padding:40,color:"#e1e9ff",background:"#202c41",minHeight:"100vh"}}><h1>Connected website</h1><p>All source connections checked before editing.</p><svg width="120" height="100"><rect x={10} y={15} width={70} height={50} fill="#8caee8" /></svg></main>}'
writeFileSync(join(root, 'src/App.jsx'), source)
writeFileSync(join(root, 'src/main.jsx'), 'import React from "react"; import {createRoot} from "react-dom/client"; import App from "./App.jsx"; createRoot(document.getElementById("root")).render(<App/>);')
const capture = [], errors = []
const projects = createProjects({ storageDir: join(root, '.library'), wire: (args) => wireProject(args, { fetchImpl: fixtureTransport(args.credentials.provider, { activityDelay: 1500, capture }) }) })
let welcome, browser
const clickText = async (page, text) => page.evaluate((text) => { const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text || b.querySelector('span')?.textContent.trim() === text); if (!el) throw new Error('Missing button: ' + text); el.click() }, text)
try {
  welcome = await start({ setup: true, noOpen: true, port: 0, projects })
  browser = await puppeteer.launch({ executablePath: process.env.RETOUCH_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-first-run'] })
  const page = await browser.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewport({ width: 1280, height: 940, deviceScaleFactor: 1 })
  await page.goto(welcome.url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('#setup-provider')?.options.length === 5)
  assert.equal(await page.$eval('#project-title', (e) => e.textContent), 'Connect your first website')
  assert.equal(await page.$eval('.provider-plan', (e) => getComputedStyle(e).display), 'none')
  await page.screenshot({ path: join(TOOL_DIR, 'local/setup-welcome.png') })
  for (const provider of ['claude', 'openai', 'deepseek', 'zai', 'gemini']) {
    await page.select('#setup-provider', provider)
    assert.ok(await page.$eval('#setup-model', (e) => e.value))
    assert.equal(await page.$eval('.provider-plan', (e) => getComputedStyle(e).display !== 'none'), provider === 'zai')
  }
  await page.type('#project-folder', root)
  await clickText(page, 'Coding agent')
  await page.waitForFunction((root) => document.querySelector('.setup-prompt')?.value.includes(root), {}, root)
  const prompt = await page.$eval('.setup-prompt', (e) => e.value)
  assert.ok(prompt.includes(TOOL_DIR) && prompt.includes('AGENTS.md') && prompt.includes('doctor'))
  await browser.defaultBrowserContext().overridePermissions(new URL(welcome.url).origin, ['clipboard-read', 'clipboard-write'])
  await clickText(page, 'Copy setup prompt')
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((e) => e.textContent === 'Copied'))
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), prompt)
  await page.screenshot({ path: join(TOOL_DIR, 'local/setup-agent.png') })
  await page.setViewport({ width: 390, height: 844 })
  await clickText(page, 'Use an API key')
  assert.ok(await page.$eval('.project-dialog', (e) => { const r = e.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && e.scrollWidth <= e.clientWidth + 1 }))
  await page.screenshot({ path: join(TOOL_DIR, 'local/setup-mobile.png') })
  // Keyboard can reach the primary action in a narrow, scrollable dialog.
  await page.focus('#setup-key'); await page.type('#setup-key', key)
  await page.setViewport({ width: 1280, height: 940 })
  await clickText(page, 'Wire and open')
  await page.waitForFunction(() => !!document.querySelector('.project-activity') && document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow') !== '0')
  assert.equal(await page.$('#setup-key'), null, 'credential field leaves the DOM once submitted')
  assert.ok(!(await page.content()).includes(key), 'progress UI has no credentials')
  await page.screenshot({ path: join(TOOL_DIR, 'local/setup-progress.png') })
  await page.waitForFunction(() => document.querySelector('#project-title')?.textContent === 'Your project is ready', { timeout: 60000 })
  assert.ok(page.url().includes('/__retouch/studio') && page.url().includes('importJob='))
  assert.equal(await page.$eval('[role="progressbar"]', (e) => e.getAttribute('aria-valuenow')), '100')
  const current = projects.list()[0]
  assert.ok(current.root.replace(/\\/g, '/').endsWith(root.replace(/\\/g, '/')))
  assert.ok(!readFileSync(current.configPath, 'utf8').includes(key))
  await clickText(page, 'Open project')
  assert.equal(await page.$eval('.project-dialog', (e) => e.open), false)
  const frame = page.frames().find((f) => /:\d+\/$/.test(f.url()))
  assert.equal(await frame.$eval('h1', (e) => e.textContent), 'Connected website')
  await clickText(page, 'File')
  await page.waitForFunction(() => !!document.querySelector('.file-menu button'))
  await clickText(page, 'Import project…')
  await page.waitForFunction(() => document.querySelector('#setup-provider')?.options.length === 5)
  assert.equal(await page.$eval('#project-title', (e) => e.textContent), 'Connect a new website')
  await page.screenshot({ path: join(TOOL_DIR, 'local/setup-in-studio.png') })
  await clickText(page, 'Existing config')
  assert.equal(await page.$eval('#setup-key', (e) => e.required), false)
  assert.equal(readFileSync(join(root, 'src/App.jsx'), 'utf8'), source)
  assert.equal(capture.length, 2, 'two mocked provider turns; no real provider calls')
  assert.deepEqual(errors, [], 'welcome and imported studio have no runtime errors')
  console.log('Setup browser gate passed: five providers, copied agent prompt, narrow layout, progress, real Vite import, source verification, and File setup.')
} finally {
  await browser?.close()
  await welcome?.close()
  unlinkSync(nodeModules)
  rmSync(root, { recursive: true, force: true })
}
