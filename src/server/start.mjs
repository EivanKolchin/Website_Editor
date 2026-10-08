import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadParser } from './ast.mjs'
import { loadConfig, TOOL_DIR } from './config.mjs'
import { openWindow } from './open.mjs'
import { retouchPlugin } from './plugin.mjs'

/** The host project's own Vite, so the page is built exactly as its own dev server builds it. */
export async function importVite(root) {
  const require = createRequire(join(root, 'package.json'))
  let pkgPath
  try {
    pkgPath = require.resolve('vite/package.json')
  } catch {
    throw new Error(`Vite is not installed in ${root}. Retouch drives the project's own Vite dev server; run npm install there first.`)
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const exp = pkg.exports?.['.']
  let entry = typeof exp === 'string' ? exp : exp?.import ?? exp?.['module-sync'] ?? exp?.default
  if (entry && typeof entry === 'object') entry = entry.default
  entry = entry ?? pkg.module ?? pkg.main
  return import(pathToFileURL(join(dirname(pkgPath), entry)).href)
}

const say = (...a) => console.log('[retouch]', ...a)

export async function start(opts = {}) {
  const { file, config } = await loadConfig(opts)
  if (opts.port) config.vite.port = Number(opts.port)
  if (opts.path) config.open = opts.path
  say(`project  ${config.root}`)
  say(`config   ${file ?? '(none - using defaults; see AGENTS.md to wire this project)'}`)
  process.chdir(config.root)

  for (const cmd of opts.skipBefore ? [] : config.before) {
    say(`before   ${cmd}`)
    // RETOUCH=1: a generator may add what only the editor needs, such as a source map back to its inputs
    execSync(cmd, { cwd: config.root, stdio: 'inherit', env: { ...process.env, RETOUCH: '1' } })
  }

  loadParser(config.root)
  const vite = await importVite(config.root)

  const autoExit = config.exitOnClose && !opts.noOpen
  let everConnected = false
  let exitTimer = null
  const onClientsChange = (n) => {
    if (n > 0) {
      everConnected = true
      clearTimeout(exitTimer)
      exitTimer = null
    } else if (autoExit && everConnected && !exitTimer) {
      // a reload drops the socket for a moment; a closed window does not come back
      exitTimer = setTimeout(async () => {
        say('editor window closed - stopping.')
        await server.close().catch(() => {})
        process.exit(0)
      }, 12000)
    }
  }

  const plugin = retouchPlugin({ config, onClientsChange, searchForWorkspaceRoot: vite.searchForWorkspaceRoot })
  const server = await vite.createServer({
    configFile: config.vite.configFile ? resolve(config.root, config.vite.configFile) : false,
    mode: config.vite.mode,
    plugins: [plugin],
    clearScreen: false,
    // localhost only, whatever the project's own config says: this server can write files
    server: { port: config.vite.port, strictPort: false, host: 'localhost', open: false },
  })
  await server.listen()
  const local = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`
  const page = new URL(config.open.replace(/^\//, ''), local).href
  // the studio frames the page with the editor's panels; the page alone is the same editor, full size
  const url = config.studio && !opts.page ? new URL(`__retouch/studio?path=${encodeURIComponent(config.open)}`, local).href : page
  say(`editing  ${url}`)
  if (url !== page) say(`full page ${page}`)
  say(`tool     ${TOOL_DIR}`)
  if (!opts.noOpen) {
    const how = openWindow(url, config.window)
    say(how ? `opened   ${how}` : 'open the address above in a Chromium browser')
    if (autoExit) say('close the editor window to stop, or press Ctrl+C here.')
  }

  const stop = async () => {
    await server.close().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  return { server, url, config }
}
