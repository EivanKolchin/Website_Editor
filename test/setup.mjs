import { createServer } from 'node:http'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PROVIDERS, createProvider, wiringCredentials } from '../src/ai/providers.mjs'
import { WIRING_TOOLS, createReader, setupPrompt, validateProposal, wireProject } from '../src/ai/wire.mjs'
import { createProjects } from '../src/server/projects.mjs'
import { startSetup } from '../src/server/setup.mjs'
import { retouchPlugin } from '../src/server/plugin.mjs'
import { parse, walk } from '../src/server/ast.mjs'
import { posix } from '../src/server/util.mjs'
import { TOOL_DIR } from '../src/server/config.mjs'

const key = 'fixture-key-that-must-never-be-saved'
export function toolResponse(provider, calls) {
  if (provider === 'openai') return { status: 'completed', output: [{ type: 'reasoning', encrypted_content: 'opaque-signature' }, ...calls.map((c, i) => ({ type: 'function_call', call_id: `call-${i}`, name: c.name, arguments: JSON.stringify(c.args) }))] }
  if (provider === 'claude') return { stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: 'private reasoning', signature: 'opaque-signature' }, ...calls.map((c, i) => ({ type: 'tool_use', id: `call-${i}`, name: c.name, input: c.args }))] }
  if (provider === 'gemini') return { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'private reasoning', thought: true, thoughtSignature: 'opaque-signature' }, ...calls.map((c, i) => ({ functionCall: { id: `call-${i}`, name: c.name, args: c.args } }))] } }] }
  return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', reasoning_content: 'opaque-signature', tool_calls: calls.map((c, i) => ({ id: `call-${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }] }
}
export function fixtureTransport(provider, { activityDelay = 0, capture = [] } = {}) {
  let turn = 0
  return async (url, options) => {
    capture.push({ url, body: JSON.parse(options.body), headers: options.headers })
    if (activityDelay) await new Promise((r) => setTimeout(r, activityDelay))
    const calls = turn++ === 0 ? [{ name: 'read_file', args: { path: 'package.json' } }, { name: 'read_file', args: { path: 'vite.config.mjs' } }, { name: 'read_file', args: { path: 'src/App.jsx' } }]
      : [{ name: 'propose_config', args: { json: JSON.stringify({ name: 'Connected fixture', vite: { configFile: 'vite.config.mjs' }, stamp: { include: ['src/**/*.jsx'] }, check: { command: 'npm run lint', label: 'lint' }, colors: { tokensFirst: true } }), summary: 'Read the app and Vite config. Native HTML and SVG need no custom adapters. No generated sources were found.' } }]
    return { ok: true, json: async () => toolResponse(provider, calls) }
  }
}

export async function setupTests(test, eq, ok) {
  const raises = async (fn, re) => {
    let error
    try { await fn() } catch (e) { error = e }
    ok(error && re.test(error.message), `Expected ${re}, got ${error?.message ?? 'no error'}`)
  }
  const fixture = () => {
    const root = posix(mkdtempSync(join(tmpdir(), 'retouch-setup-')))
    const pkg = { name: 'Setup fixture', scripts: { dev: 'vite', lint: 'node lint.mjs', deploy: 'node deploy.mjs' } }
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
    writeFileSync(join(root, 'vite.config.mjs'), 'export default {}')
    writeFileSync(join(root, 'src/App.jsx'), 'export default function App(){return <main><h1>Setup website</h1></main>}')
    writeFileSync(join(root, '.env'), 'API_KEY=private')
    for (const name of ['vite', 'react', 'react-dom']) { const dir = join(root, 'node_modules', name); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: name === 'vite' ? '6.0.0' : '19.0.0' })) }
    return { root, pkg }
  }
  for (const provider of PROVIDERS) await test(`${provider.name} setup carries native tool results and opaque signatures across turns without exposing a key`, async () => {
    const { root, pkg } = fixture(), calls = [], activity = []
    try {
      const result = await wireProject({ root, pkg, credentials: { provider: provider.id, apiKey: key }, onActivity: (a) => activity.push(a) }, { fetchImpl: fixtureTransport(provider.id, { capture: calls }) })
      eq(calls.length, 2)
      eq(result.config.root, root)
      ok(calls[1].body && JSON.stringify(calls[1].body).includes('opaque-signature'), 'reasoning signature survives native protocol')
      ok(JSON.stringify(calls[1].body).includes('Setup fixture'), 'file tool result reaches the next turn')
      ok(!JSON.stringify(calls.map((c) => c.body)).includes(key), 'key is not part of the conversation')
      ok(!JSON.stringify(activity).includes('private reasoning'), 'private reasoning is not displayed')
      ok(!result.source.includes(key) && !JSON.stringify(activity).includes(key), 'credential not written or displayed')
      const file = join(root, 'safe.config.mjs'); writeFileSync(file, result.source)
      const loaded = await import(pathToFileURL(file).href)
      eq(loaded.default.root, root); eq(loaded.default.vite.configFile, 'vite.config.mjs')
      ok(calls.every((c) => /https:\/\//.test(c.url) && (c.headers.Authorization === `Bearer ${key}` || c.headers['x-api-key'] === key || c.headers['x-goog-api-key'] === key)))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  await test('setup config data rejects executable modules, unrelated commands, unread adapters and unsafe fields', async () => {
    const { root, pkg } = fixture(), read = new Set(['package.json', 'vite.config.mjs'])
    const check = (raw, extra = {}) => validateProposal(JSON.stringify(raw), { root, pkg, read, ...extra })
    try {
      await raises(() => validateProposal('export default { root: process.cwd() }', { root, pkg, read }), /valid JSON/)
      await raises(() => check({ root: '/elsewhere' }), /unsupported/)
      await raises(() => check({ before: ['npm run deploy'] }), /Preparation/)
      await raises(() => check({ check: { command: 'npm run deploy' } }), /fast package/)
      await raises(() => check({ vite: { configFile: 'missing.mjs' } }), /must match/)
      await raises(() => check({ vite: { host: '0.0.0.0' } }), /Invalid vite/)
      await raises(() => check({ adapters: [{ component: 'Sprite', move: { x: 'x' } }] }), /Read the complete definition/)
      await raises(() => check({ name: key }, { key }), /without credentials/)
      const proposal = check({ textRules: [{ pattern: '!', message: 'Avoid exclamations.' }], colorRules: [{ pattern: '^#', message: 'Use a token.' }] })
      eq(proposal.config.colorRules[0]('#fff'), 'Use a token.')
      const file = join(root, 'rules.mjs'); writeFileSync(file, proposal.source)
      const saved = (await import(pathToFileURL(file).href)).default
      eq(saved.textRules[0].pattern.test('hi!'), true); eq(saved.colorRules[0]('#abc'), 'Use a token.')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  await test('assisted setup follows the selected dev pipeline and lets a model repair invalid config data', async () => {
    const { root, pkg } = fixture(); let turn = 0
    pkg.scripts.dev = 'node generate.mjs && vite'; writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
    try {
      const read = new Set(['package.json', 'vite.config.mjs'])
      const proposal = validateProposal(JSON.stringify({ before: ['node generate.mjs'], rebuild: [{ from: ['src/**'], run: 'node generate.mjs', outputs: ['public/**'] }] }), { root, pkg, read })
      eq(proposal.config.before[0], 'node generate.mjs')
      await raises(() => validateProposal('{}', { root, pkg, read }), /rebuild/)
      pkg.scripts.dev = 'vite'; writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
      const transport = async () => ({ ok: true, json: async () => toolResponse('claude', turn++ === 0 ? [{ name: 'propose_config', args: { json: '{}', summary: 'Not read yet' } }] : turn === 2 ? [{ name: 'read_file', args: { path: 'package.json' } }, { name: 'read_file', args: { path: 'vite.config.mjs' } }] : [{ name: 'propose_config', args: { json: '{}', summary: 'No adapters needed.' } }]) })
      const activity = []
      await wireProject({ root, pkg, credentials: { provider: 'claude', apiKey: key }, onActivity: (a) => activity.push(a) }, { fetchImpl: transport })
      eq(turn, 3); ok(activity.some((a) => a.kind === 'validation' && /Read package/.test(a.detail)))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  await test('setup file tools exclude dependencies, secrets and traversal and redact inline credentials', async () => {
    const { root } = fixture()
    try {
      const reader = createReader(root, key)
      const list = reader.run('list_files', { path: '.', depth: 5 })
      ok(!/node_modules|\.env/.test(list))
      await raises(() => reader.run('read_file', { path: '.env' }), /excluded/)
      await raises(() => reader.run('read_file', { path: '../package.json' }), /excluded/)
      writeFileSync(join(root, 'src/keys.js'), `const API_KEY = '${key}'; const password = 'secret-value';`)
      const text = reader.run('read_file', { path: 'src/keys.js' })
      ok(!text.includes(key) && !text.includes('secret-value'))
      await raises(() => reader.run('search', { query: '' }), /substring/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  await test('an adapter needs its complete definition read, rather than just a component usage or a partial file', async () => {
    const { root, pkg } = fixture(), reader = createReader(root)
    try {
      writeFileSync(join(root, 'src/App.jsx'), 'export default function App(){return <Sprite x={50} y={60} w={20}/>}')
      writeFileSync(join(root, 'src/Sprite.jsx'), '// introduction\n'.repeat(301) + 'export function Sprite({x,y,w}){return <rect x={x} y={y} width={w} height={w}/> }')
      for (const path of ['package.json', 'vite.config.mjs', 'src/App.jsx']) reader.run('read_file', { path })
      const json = JSON.stringify({ adapters: [{ component: 'Sprite', move: { x: 'x', y: 'y' }, size: ['w'] }] })
      const validate = () => validateProposal(json, { root, pkg, read: reader.read, ranges: reader.ranges })
      await raises(validate, /complete definition/)
      reader.run('read_file', { path: 'src/Sprite.jsx' })
      await raises(validate, /complete definition/)
      reader.run('read_file', { path: 'src/Sprite.jsx', start_line: 301 })
      eq(validate().config.adapters[0].component, 'Sprite')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  await test('provider errors redact upstream bodies, reject bad credentials and cancellation aborts in-flight requests', async () => {
    await raises(() => wiringCredentials({ provider: 'other', apiKey: key }), /Choose/)
    await raises(() => wiringCredentials({ provider: 'gemini', apiKey: 'a\nb' }), /valid/)
    const credentials = wiringCredentials({ provider: 'openai', apiKey: key })
    const options = { system: '', prompt: '', tools: WIRING_TOOLS }
    const denied = createProvider(credentials, { ...options, fetchImpl: async () => ({ ok: false, status: 401, text: () => key }) })
    await raises(() => denied.next(), /HTTP 401.*key/)
    const abort = new AbortController()
    const pending = createProvider(credentials, { ...options, signal: abort.signal, fetchImpl: async (_, o) => new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(new Error(key)), { once: true })) })
    const response = pending.next(); abort.abort()
    await raises(() => response, /^Wiring cancelled\.$/)
  })
  await test('assisted import validates rendered source before remembering a project and never persists credentials', async () => {
    const { root, pkg } = fixture(), storageDir = join(root, '.library'); let session
    const source = readFileSync(join(root, 'src/App.jsx'), 'utf8')
    const projects = createProjects({ storageDir, wire: (args) => wireProject(args, { fetchImpl: fixtureTransport('gemini') }), command: async () => '', launch: async ({ loaded, projects }) => {
      const plugin = retouchPlugin({ config: loaded.config })
      const http = createServer((_, res) => res.end('<script>window.__RETOUCH__={}</script>'))
      await new Promise((r) => http.listen(0, '127.0.0.1', r))
      const page = `http://127.0.0.1:${http.address().port}/`
      session = { ...loaded, plugin, page, url: page + '__retouch/studio', server: { config: { plugins: [{ name: 'vite:react' }] }, close: () => new Promise((r) => http.close(r)) } }
      projects.register(session); return session
    } })
    try {
      const input = { root, wiring: { provider: 'gemini', apiKey: key } }
      const { id } = projects.begin(input)
      for (let i = 0; i < 200 && projects.status(id).state === 'running'; i++) await new Promise((r) => setTimeout(r, 10))
      const state = projects.status(id)
      eq(state.state, 'awaiting-browser'); eq(projects.list().length, 0)
      ok(state.activity.some((a) => a.kind === 'config')); ok(!JSON.stringify(state).includes(key)); eq(input.wiring, undefined)
      const f = join(root, 'src/App.jsx'), recorded = session.plugin.api.sources.record(f, source), samples = []
      walk(parse(source, f), (n) => { if (n.type === 'JSXElement') samples.push({ stamp: `${recorded.pid}.${recorded.vid}:${n.start}-${n.end}`, text: n.openingElement.name.name === 'h1' ? 'Setup website' : '' }) })
      const report = await projects.verify({ id, react: true, samples }, { config: session.config, ...session.plugin.api })
      eq(report.state, 'passed'); eq(projects.list().length, 1)
      eq(readFileSync(f, 'utf8'), source)
      ok(!readFileSync(session.file, 'utf8').includes(key) && !readFileSync(join(storageDir, 'recent.json'), 'utf8').includes(key))
    } finally { await projects.close(); rmSync(root, { recursive: true, force: true }) }
  })
  await test('welcome host runs without a website or Vite, guards setup APIs and produces a prompt with both repositories', async () => {
    const storage = mkdtempSync(join(tmpdir(), 'retouch-welcome-'))
    const welcome = await startSetup({ port: 0, noOpen: true, projects: createProjects({ storageDir: storage }) })
    try {
      const html = await (await fetch(welcome.url)).text()
      ok(html.includes('setup.js') && html.includes('welcome":true'))
      const token = /"token":"([a-f0-9]+)"/.exec(html)[1], base = new URL(welcome.url).origin
      eq((await fetch(base + '/__retouch/projects/setup')).status, 403)
      const info = await (await fetch(base + '/__retouch/projects/setup', { headers: { 'x-retouch-token': token } })).json()
      eq(info.providers.length, 5)
      eq((await fetch(base + '/__retouch/client/../../server/config.mjs')).status, 404)
      const prompt = setupPrompt('C:/web/my site')
      ok(prompt.includes(info.repo) && prompt.includes('my site') && prompt.includes('AGENTS.md') && prompt.includes('byte') && prompt.includes('doctor'))
      eq((await fetch(base + '/__retouch/client/projects.js')).status, 200)
    } finally { await welcome.close(); rmSync(storage, { recursive: true, force: true }) }
  })
  await test('first launch with no attached config or dependencies opens setup through the normal CLI', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'retouch-first-launch-')), tool = join(temp, 'retouch')
    mkdirSync(tool)
    cpSync(join(TOOL_DIR, 'src'), join(tool, 'src'), { recursive: true })
    cpSync(join(TOOL_DIR, 'bin'), join(tool, 'bin'), { recursive: true })
    const child = spawn(process.execPath, [join(tool, 'bin/retouch.mjs'), '--no-open', '--port', '0'], { cwd: tool, windowsHide: true })
    const ended = new Promise((r) => child.once('close', r))
    let output = ''
    try {
      const url = await new Promise((done, fail) => {
        const timer = setTimeout(() => fail(new Error('First launch did not open setup. ' + output)), 10000)
        child.once('exit', (code) => { clearTimeout(timer); fail(new Error('First launch exited ' + code + ': ' + output)) })
        child.once('error', (e) => { clearTimeout(timer); fail(e) })
        child.stdout.on('data', (s) => { output += s; const url = /setup (http:\/\/[^\s]+)/.exec(output)?.[1]; if (url) { clearTimeout(timer); done(url) } })
        child.stderr.on('data', (s) => { output += s })
      })
      const html = await (await fetch(url)).text()
      ok(html.includes('welcome":true') && !output.includes('Vite is not installed'), 'no project dependencies are needed for first setup')
    } finally { child.kill(); await ended; rmSync(temp, { recursive: true, force: true }) }
  })
}
