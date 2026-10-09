import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { TOOL_DIR } from './config.mjs'
import { createProjects } from './projects.mjs'
import { openWindow } from './open.mjs'
import { readJson, RetouchError, sendJson } from './util.mjs'
import { THEME } from '../client/theme.js'

/** A small welcome host: setup does not need an attached Vite or React install. */
export async function startSetup({ port = 5199, noOpen = false, root = '', projects = createProjects() } = {}) {
  const token = randomBytes(24).toString('hex')
  const streams = new Set()
  let exitTimer = null, everConnected = false, closing = false
  const routes = {
    'GET /projects': () => ({ projects: projects.list(), current: null }),
    'GET /projects/setup': () => projects.setup(),
    'POST /projects/prompt': (b) => ({ prompt: projects.prompt(b.root) }),
    'POST /projects/pick': async () => ({ root: await projects.pick() }),
    'POST /projects/import': (b) => ({ job: projects.begin(b) }),
    'POST /projects/status': (b) => ({ job: projects.status(b.id) }),
    'POST /projects/cancel': async (b) => ({ job: await projects.cancel(b.id) }),
  }
  const assets = new Set(['setup.js', 'projects.js', 'ui.js', 'theme.js'])
  const server = createServer(async (req, res) => {
    // Serve only this tool's setup modules, never project files or credentials.
    const path = (req.url ?? '/').split('?')[0]
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(req.headers.host ?? '')) return sendJson(res, 403, { ok: false, error: 'Use the local Retouch address.' })
    res.setHeader('cache-control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (req.method === 'GET' && path === '/__retouch/setup/events') {
      if (req.headers['x-retouch-token'] !== token) return sendJson(res, 403, { ok: false, error: 'Reload setup.' })
      res.setHeader('Content-Type', 'text/event-stream')
      res.write(': connected\n\n')
      streams.add(res)
      projects.clients(server, streams.size)
      const keepAlive = setInterval(() => res.write(': alive\n\n'), 15000)
      res.on('close', () => { clearInterval(keepAlive); streams.delete(res); if (!closing) projects.clients(server, streams.size) })
      return
    }
    if (req.method === 'GET' && ['/', '/__retouch/setup'].includes(path)) {
      const boot = JSON.stringify({ token, api: '/__retouch', name: 'Retouch', root, welcome: true }).replace(/</g, '\\u003c')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><link rel="icon" href="data:,"><title>Set up Retouch</title><style>html,body{margin:0;background:${THEME.bg};color:${THEME.ink}}</style></head><body><script>window.__RETOUCH_STUDIO__=${boot}</script><script type="module" src="/__retouch/client/setup.js"></script></body></html>`)
    }
    const asset = path.replace('/__retouch/client/', '')
    if (req.method === 'GET' && path.startsWith('/__retouch/client/') && assets.has(asset)) {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
      return res.end(readFileSync(join(TOOL_DIR, 'src', 'client', asset)))
    }
    const route = routes[`${req.method} ${path.replace(/^\/__retouch/, '')}`]
    if (!route) { res.statusCode = 404; return res.end('Not found') }
    if (req.headers['x-retouch-token'] !== token) return sendJson(res, 403, { ok: false, error: 'Missing or wrong Retouch token. Reload the page.' })
    try {
      const body = req.method === 'POST' ? await readJson(req, 128 * 1024) : {}
      sendJson(res, 200, { ok: true, ...await route(body) })
    } catch (e) { sendJson(res, e instanceof RetouchError ? 409 : 500, { ok: false, error: e instanceof RetouchError ? e.message : 'Retouch could not complete setup. Check the folder and try again.' }) }
  })
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise((done, fail) => {
        const failed = (e) => { server.off('listening', listening); fail(e) }
        const listening = () => { server.off('error', failed); done() }
        server.once('error', failed); server.once('listening', listening)
        server.listen(Number(port) + attempt, '127.0.0.1')
      })
      break
    } catch (e) { if (e.code !== 'EADDRINUSE' || attempt >= 20) throw e }
  }
  const url = `http://127.0.0.1:${server.address().port}/__retouch/setup`
  projects.setupUrl = url
  const changed = (count) => {
    if (count > 0 || projects.busy()) { everConnected ||= count > 0; clearTimeout(exitTimer); exitTimer = null }
    else if (everConnected && !exitTimer) exitTimer = setTimeout(async () => { await close(); process.exit(0) }, 12000)
  }
  const stop = async () => { await close(); process.exit(0) }
  const close = async () => {
    if (closing) return
    closing = true; clearTimeout(exitTimer)
    process.off('SIGINT', stop); process.off('SIGTERM', stop)
    if (projects.onClientsChange === changed) projects.onClientsChange = null
    for (const res of streams) res.end()
    await projects.close(); await new Promise((r) => server.close(r))
  }
  console.log(`[retouch] setup ${url}`)
  if (!noOpen) {
    projects.onClientsChange = changed
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
    openWindow(url, { width: 1100, height: 900 })
  }
  return { url, server, projects, close }
}
