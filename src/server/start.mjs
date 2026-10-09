import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadParser } from './ast.mjs'
import { loadConfig, TOOL_DIR } from './config.mjs'
import { openWindow } from './open.mjs'
import { retouchPlugin } from './plugin.mjs'
import { createProjects } from './projects.mjs'

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
  if (opts.setup) {
    const { startSetup } = await import('./setup.mjs')
    return startSetup(opts)
  }
  if (opts.configPath && !existsSync(resolve(opts.configPath))) throw new Error('The requested Retouch config does not exist. Use retouch setup to connect a website.')
  let loaded = opts.loaded ?? await loadConfig(opts)
  const projects = opts.projects ?? createProjects()
  // A setup-created attachment survives a restart without overwriting local/config.
  if (!loaded.file && !opts.loaded && !opts.root && !opts.configPath) {
    const attached = projects.list()[0]
    if (attached?.configPath) {
      try {
        const { importConfig, projectFolder, readPackage } = await import('./import-project.mjs')
        const root = projectFolder(attached.root)
        loaded = await importConfig(root, readPackage(root), { configPath: attached.configPath })
      } catch { /* The welcome screen lets a moved or unavailable project be reconnected. */ }
    }
  }
  const { file, config } = loaded
  if (!file && !opts.loaded) {
    const { startSetup } = await import('./setup.mjs')
    return startSetup({ ...opts, projects })
  }
  if (opts.port) config.vite.port = Number(opts.port)
  if (opts.path) config.open = opts.path
  say(`project  ${config.root}`)
  say(`config   ${file ?? '(none - using defaults; see AGENTS.md to wire this project)'}`)
  if (!opts.managed) process.chdir(config.root)

  for (const cmd of opts.skipBefore ? [] : config.before) {
    say(`before   ${cmd}`)
    // RETOUCH=1: a generator may add what only the editor needs, such as a source map back to its inputs
    execSync(cmd, { cwd: config.root, stdio: 'inherit', env: { ...process.env, RETOUCH: '1' } })
  }

  loadParser(config.root)
  const vite = await importVite(config.root)

  const autoExit = config.exitOnClose && !opts.noOpen && !opts.managed
  let everConnected = false
  let exitTimer = null
  const onClientsChange = (n) => {
    if (n > 0 || projects.busy()) {
      if (n > 0) everConnected = true
      clearTimeout(exitTimer)
      exitTimer = null
    } else if (autoExit && everConnected && !exitTimer && !projects.busy()) {
      // a reload drops the socket for a moment; a closed window does not come back
      exitTimer = setTimeout(async () => {
        say('editor window closed - stopping.')
        await projects.close()
        process.exit(0)
      }, 12000)
    }
  }

  if (autoExit) projects.onClientsChange = onClientsChange
  const plugin = retouchPlugin({ config, projects, onClientsChange: (n) => projects.clients(plugin, n), searchForWorkspaceRoot: vite.searchForWorkspaceRoot })
  // A second project must not change the cwd under the first project's Vite.
  const host = opts.managed && config.vite.configFile
    ? (await vite.loadConfigFromFile({ command: 'serve', mode: config.vite.mode }, resolve(config.root, config.vite.configFile), config.root))?.config ?? {}
    : {}
  const server = await vite.createServer({
    ...host,
    ...(opts.managed ? { root: resolve(config.root, host.root ?? '.') } : {}),
    configFile: !opts.managed && config.vite.configFile ? resolve(config.root, config.vite.configFile) : false,
    mode: config.vite.mode,
    plugins: [...(host.plugins ?? []), plugin],
    clearScreen: false,
    // localhost only, whatever the project's own config says: this server can write files
    server: { ...host.server, port: config.vite.port, strictPort: false, host: 'localhost', open: false },
  })
  try { await server.listen() } catch (e) { await server.close().catch(() => {}); throw e }
  const local = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`
  const page = new URL(config.open.startsWith(server.config.base) ? config.open : config.open.replace(/^\//, ''), local).href
  // the studio frames the page with the editor's panels; the page alone is the same editor, full size
  const pageAddress = new URL(page)
  const pagePath = pageAddress.pathname + pageAddress.search + pageAddress.hash
  const url = config.studio && !opts.page ? new URL(`/__retouch/studio?path=${encodeURIComponent(pagePath)}`, local).href : page
  const session = { server, plugin, url, page, config, file, projects }
  projects.register(session)
  say(`editing  ${url}`)
  if (url !== page) say(`full page ${page}`)
  say(`tool     ${TOOL_DIR}`)
  if (!opts.noOpen) {
    const how = openWindow(url, config.window)
    say(how ? `opened   ${how}` : 'open the address above in a Chromium browser')
    if (autoExit) say('close the editor window to stop, or press Ctrl+C here.')
  }

  const stop = async () => {
    await projects.close()
    process.exit(0)
  }
  if (!opts.managed) {
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  }
  return session
}
