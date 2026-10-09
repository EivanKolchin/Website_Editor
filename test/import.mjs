import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadParser, parse, walk } from '../src/server/ast.mjs'
import { normalise } from '../src/server/config.mjs'
import { devWiring, importConfig, projectFolder, readPackage } from '../src/server/import-project.mjs'
import { retouchPlugin } from '../src/server/plugin.mjs'
import { stampSource } from '../src/server/stamp.mjs'
import { createProjects, runImportCommand } from '../src/server/projects.mjs'
import { posix } from '../src/server/util.mjs'
import { studioPage } from '../src/server/studio.mjs'
import { createTracer } from '../src/server/trace.mjs'

export async function importTests(test, eq, ok) {
  await test('stamping a bare or async map callback preserves the callback and adds its index inside its own parentheses', () => {
    loadParser(tmpdir())
    for (const callback of ['item =>', 'async item =>', '(item) =>']) {
      const source = `const App = () => <div>{items.map(${callback} <span>{item.label}</span>)}</div>`
      const out = stampSource(source, 'App.jsx', '123abc.123abcde')
      let map
      walk(parse(out.code, 'App.jsx'), (n) => { if (n.type === 'CallExpression' && n.callee.property?.name === 'map') map = n })
      eq(map.arguments.length, 1, 'one callback remains the only map argument')
      eq(map.arguments[0].type, 'ArrowFunctionExpression')
      eq(map.arguments[0].params.length, 2, 'item and injected index are both callback parameters')
      eq(map.arguments[0].params[0].name, 'item')
      eq(map.arguments[0].async, callback.startsWith('async'))
    }
  })
  const raises = async (fn, pattern) => {
    let error
    try { await fn() } catch (e) { error = e }
    ok(error && pattern.test(error.message), `Expected ${pattern}, got ${error?.message ?? 'no error'}`)
  }
  function fixture() {
    const root = posix(mkdtempSync(join(tmpdir(), 'retouch-import-')))
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'Test website', scripts: { dev: 'vite', lint: 'node lint.mjs' } }))
    writeFileSync(join(root, 'src', 'App.jsx'), 'export default function App() { return <main><h1>Imported website</h1><svg><rect x={10} y={20} width={40} height={50} /></svg></main> }\n')
    for (const name of ['react', 'react-dom', 'vite']) {
      const dir = join(root, 'node_modules', name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: name === 'vite' ? '6.0.0' : '19.0.0' }))
    }
    return root
  }
  const wait = async (manager, id) => {
    for (let i = 0; i < 150; i++) {
      const j = manager.status(id)
      if (j.state !== 'running') return j
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error('Import job timed out in test')
  }
  const fakeLaunch = async ({ loaded, projects }) => {
    const plugin = retouchPlugin({ config: loaded.config })
    const http = createServer((req, res) => res.end('<html><script>window.__RETOUCH__={}</script></html>'))
    await new Promise((r) => http.listen(0, '127.0.0.1', r))
    const page = `http://127.0.0.1:${http.address().port}/`
    const session = { ...loaded, plugin, page, url: page + '__retouch/studio', server: { config: { plugins: [{ name: 'vite:react' }] }, close: () => new Promise((r) => http.close(r)) } }
    projects.register(session)
    return session
  }
  const samples = (session) => {
    const f = join(session.config.root, 'src', 'App.jsx'), code = readFileSync(f, 'utf8')
    const { pid, vid } = session.plugin.api.sources.record(f, code)
    const result = []
    walk(parse(code, f), (n) => {
      if (n.type !== 'JSXElement') return
      const name = n.openingElement.name.name
      result.push({ stamp: `${pid}.${vid}:${n.start}-${n.end}`, svg: ['svg', 'rect'].includes(name), text: name === 'h1' ? 'Imported website' : '' })
    })
    return result
  }

  await test('import reads the exact Vite config and mode from the website dev script', () => {
    const root = fixture()
    try {
      writeFileSync(join(root, 'vite.site.config.ts'), 'export default {}')
      const w = devWiring({ scripts: { 'dev:site': 'vite --config "vite.site.config.ts" --mode local --port 9999' } }, root)
      eq(w.configFile, 'vite.site.config.ts'); eq(w.mode, 'local'); eq(w.script, 'dev:site')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  await test('import refuses ambiguous apps, custom launchers and unmapped generators', async () => {
    const root = fixture()
    try {
      await raises(() => devWiring({ scripts: { 'dev:a': 'vite', 'dev:b': 'vite' } }, root), /Choose.*dev script/)
      await raises(() => devWiring({ scripts: { dev: 'node gen.mjs && vite' } }, root), /generators/)
      await raises(() => devWiring({ scripts: { dev: 'vite --unknown' } }, root), /existing Retouch config/)
      writeFileSync(join(root, 'vite.config.ts'), 'export default {}')
      writeFileSync(join(root, 'vite.site.config.ts'), 'export default {}')
      await raises(() => devWiring({ scripts: { dev: 'vite' } }, root), /Several Vite configs/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  await test('import refuses URL input, missing dependencies and unsupported React versions', async () => {
    const root = fixture()
    try {
      await raises(() => projectFolder('https://example.com'), /local website source/)
      writeFileSync(join(root, 'node_modules', 'react', 'package.json'), '{"name":"react","version":"17.0.0"}')
      await raises(() => readPackage(root), /React 18 or 19/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  await test('import preserves an existing project config and includes local runtime text in inferred wiring', async () => {
    const root = fixture()
    try {
      mkdirSync(join(root, 'public'))
      writeFileSync(join(root, 'public', 'copy.json'), '{"title":"Hello"}')
      writeFileSync(join(root, 'src', 'data.js'), "fetch('/copy.json'); fetch('https://example.com/api')")
      const inferred = await importConfig(root, readPackage(root))
      eq(inferred.config.text.include[0], 'public/copy.json')
      const source = "export default { name: 'Configured site', stamp: { include: ['src/**/*.jsx'] }, adapters: [{ component: 'Sprite', move: { x: 'x', y: 'ground' }, size: ['w'] }] }\n"
      writeFileSync(join(root, 'retouch.config.mjs'), source)
      const existing = await importConfig(root, readPackage(root))
      eq(existing.config.name, 'Configured site'); eq(existing.config.adapters[0].move.y, 'ground')
      eq(readFileSync(join(root, 'retouch.config.mjs'), 'utf8'), source)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  await test('a full import waits for rendered checks, verifies text and SVG edits without writing source, and records a recent project', async () => {
    const root = fixture(), storage = join(root, '.library')
    let session
    const calls = []
    const manager = createProjects({ storageDir: storage, launch: async (opts) => (session = await fakeLaunch(opts)), command: async (cmd) => calls.push(cmd) })
    try {
      loadParser(root)
      const file = join(root, 'src', 'App.jsx'), before = readFileSync(file, 'utf8')
      const first = manager.begin({ root })
      eq(first.progress, 0)
      const loaded = await wait(manager, first.id)
      eq(loaded.state, 'awaiting-browser'); ok(loaded.progress < 100, 'not passed without browser verification')
      eq(manager.list().length, 0); eq(calls[0], 'npm run lint')
      const ctx = { config: session.config, ...session.plugin.api }
      const result = await manager.verify({ id: first.id, react: true, samples: samples(session) }, ctx)
      eq(result.state, 'passed'); eq(result.progress, 100)
      ok(/1 text change/.test(result.report), 'literal text round-trip ran')
      eq(readFileSync(file, 'utf8'), before, 'source unchanged byte for byte')
      eq(manager.list()[0].root, root)
      ok(existsSyncForTest(join(storage, 'recent.json')), 'recent project saved')
      ok(createProjects({ storageDir: storage }).list()[0].configPath, 'recent config survives restart')
    } finally { await manager.close(); rmSync(root, { recursive: true, force: true }) }
  })
  await test('a failing project check stops import before browser verification and never adds it to recents', async () => {
    const root = fixture()
    const manager = createProjects({ storageDir: join(root, '.library'), launch: fakeLaunch, command: async () => { throw new Error('lint found invalid code') } })
    try {
      const j = manager.begin({ root })
      const result = await wait(manager, j.id)
      eq(result.state, 'failed'); ok(result.error.includes('lint found invalid code'), 'actionable failure shown')
      eq(result.steps[4].status, 'failed'); eq(manager.list().length, 0)
    } finally { await manager.close(); rmSync(root, { recursive: true, force: true }) }
  })
  await test('stale rendered source stamps fail verification, and cancelling before work starts prevents launching', async () => {
    const root = fixture()
    let session, launches = 0
    const manager = createProjects({ storageDir: join(root, '.library'), launch: async (opts) => { launches++; return (session = await fakeLaunch(opts)) }, command: async () => {} })
    try {
      const j = manager.begin({ root })
      await manager.cancel(j.id)
      await new Promise((r) => setTimeout(r, 30))
      eq(launches, 0); eq(manager.status(j.id).state, 'cancelled')
      const next = manager.begin({ root }); await wait(manager, next.id)
      const result = await manager.verify({ id: next.id, react: true, samples: [{ stamp: 'bad', svg: false }] }, { config: session.config, ...session.plugin.api })
      eq(result.state, 'failed'); ok(/stamp/.test(result.error), 'source error reported'); eq(manager.list().length, 0)
    } finally { await manager.close(); rmSync(root, { recursive: true, force: true }) }
  })
  await test('project commands report nonzero exits and stop when their import is cancelled', async () => {
    await raises(() => runImportCommand('node -e "process.exit(7)"', tmpdir()), /exit 7/)
    const controller = new AbortController()
    const command = runImportCommand('node -e "setInterval(()=>{},1000)"', tmpdir(), { signal: controller.signal, timeoutMs: 5000 })
    setTimeout(() => controller.abort(), 80)
    await raises(() => command, /cancelled/)
  })
  await test('a changed project config starts a new preview and cancelling it preserves the previous server', async () => {
    const root = fixture()
    const sessions = []
    const manager = createProjects({ storageDir: join(root, '.library'), launch: async (opts) => { const s = await fakeLaunch(opts); sessions.push(s); return s }, command: async () => {} })
    try {
      const first = manager.begin({ root }); await wait(manager, first.id)
      await manager.verify({ id: first.id, react: true, samples: samples(sessions[0]) }, { config: sessions[0].config, ...sessions[0].plugin.api })
      const saved = manager.list()[0].configPath
      writeFileSync(saved, readFileSync(saved, 'utf8').replace('Test website', 'Updated website'))
      const next = manager.begin({ root }, root, sessions[0].server)
      const pending = await wait(manager, next.id)
      eq(sessions.length, 2, 'new wiring gets a new preview')
      eq(pending.returnUrl, sessions[0].url, 'back returns to the exact original server')
      await manager.cancel(next.id)
      await new Promise((r) => setTimeout(r, 550))
      ok((await fetch(sessions[0].page)).ok, 'previous server stays alive')
    } finally { await manager.close(); rmSync(root, { recursive: true, force: true }) }
  })
  await test('cancelling while a preview starts closes the late server and prevents a concurrent import', async () => {
    const root = fixture()
    let proceed, began, late
    const started = new Promise((r) => { began = r })
    const gate = new Promise((r) => { proceed = r })
    const manager = createProjects({ storageDir: join(root, '.library'), launch: async (opts) => { began(); await gate; return (late = await fakeLaunch(opts)) }, command: async () => {} })
    try {
      const first = manager.begin({ root })
      await started
      await raises(() => manager.begin({ root }), /already importing/)
      await manager.cancel(first.id)
      proceed()
      for (let i = 0; i < 100 && !late; i++) await new Promise((r) => setTimeout(r, 10))
      await new Promise((r) => setTimeout(r, 30))
      eq(manager.status(first.id).state, 'cancelled')
      await raises(() => fetch(late.page), /fetch failed/)
    } finally { proceed(); await manager.close(); rmSync(root, { recursive: true, force: true }) }
  })
  await test('studio boot data escapes script-closing project names while providing the import token independently of the page', () => {
    const html = studioPage({ name: '</script><script>alert(1)</script>', entry: '/e.js', boot: { name: '</script>', token: 'test-token', api: '/__retouch' } })
    ok(html.includes('window.__RETOUCH_STUDIO__='), 'studio can import even when framed page is broken')
    ok(html.includes('\\u003c/script>'), 'unsafe names escaped within script data')
    ok(!html.includes('<script>alert(1)'), 'project name is never executed')
    const tags = retouchPlugin({ config: normalise({ name: '</script>' }, tmpdir()) }).transformIndexHtml()
    ok(tags.find((t) => t.children?.includes('window.__RETOUCH__')).children.includes('\\u003c/script>'), 'framed page boot data is escaped too')
  })
  await test('source traces and stylesheets strip the website URL base before looking up Vite modules or disk files', async () => {
    const root = fixture()
    try {
      const file = posix(join(root, 'src', 'draw.js'))
      writeFileSync(file, 'export function draw() {}')
      const css = posix(join(root, 'src', 'style.css'))
      writeFileSync(css, 'h1 { color: red }')
      const config = normalise({}, root)
      const project = retouchPlugin({ config }).api.project
      const lookedUp = []
      const server = { config: { root, base: '/showcase/', publicDir: join(root, 'public') }, moduleGraph: { getModuleByUrl: async (p) => {
        lookedUp.push(p)
        return p === '/src/draw.js' ? { file, transformResult: { map: { version: 3, sources: ['draw.js'], names: [], mappings: 'AAAA' } } } : null
      } } }
      const tracer = createTracer({ project, config, getServer: () => server })
      const traced = await tracer.frames([{ key: 'draw', url: 'http://localhost/showcase/src/draw.js?t=123', line: 1, col: 1 }])
      eq(traced.draw.file, 'src/draw.js'); eq(traced.draw.mapped, true)
      eq(lookedUp[0], '/src/draw.js')
      eq(await tracer.sheetFile('http://localhost/showcase/src/style.css'), css)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  await test('a custom Vite dependency cache cannot become an editable text candidate during import', async () => {
    const root = fixture()
    try {
      const cacheDir = posix(join(root, 'cache'))
      mkdirSync(cacheDir)
      const cache = posix(join(cacheDir, 'react.js'))
      writeFileSync(cache, "export const text = 'Cached dependency words'")
      const app = posix(join(root, 'src', 'App.jsx'))
      const config = normalise({}, root), plugin = retouchPlugin({ config })
      plugin.api.project.attach({ config: { cacheDir }, moduleGraph: { idToModuleMap: new Map([[cache, { file: cache }], [app, { file: app }]]) } })
      await plugin.transform.handler(readFileSync(cache, 'utf8'), cache)
      const request = (text) => ({ elementOld: text, nodeOld: text, from: 0, to: text.length, insert: 'Changed' })
      eq(plugin.api.ops.resolveText(request('Cached dependency words')).status, 'missing')
      eq(plugin.api.ops.resolveText(request('Imported website')).status, 'ok')
      eq(plugin.api.sources.byPid.size, 0, 'compiled dependency never receives a source snapshot')
      eq(readFileSync(cache, 'utf8'), "export const text = 'Cached dependency words'")
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

function existsSyncForTest(file) { try { return readFileSync(file).length > 0 } catch { return false } }
