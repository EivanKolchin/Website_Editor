import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseErrors } from './ast.mjs'
import { TOOL_DIR } from './config.mjs'
import { importConfig, projectFolder, readPackage, validateConfig } from './import-project.mjs'
import { hash, matcher, RetouchError, writeFileAtomic } from './util.mjs'
import { PROVIDERS, wiringCredentials } from '../ai/providers.mjs'
import { setupPrompt, wireProject } from '../ai/wire.mjs'

const STEPS = [
  ['project', 'Read project'], ['wiring', 'Wire sources'], ['prepare', 'Prepare website'],
  ['server', 'Start preview'], ['checks', 'Test wiring'], ['browser', 'Verify rendered page'],
]
const signature = (config) => JSON.stringify(config, (_, v) => typeof v === 'function' ? v.retouchRule ? { rule: v.retouchRule } : v.toString() : v instanceof RegExp ? v.toString() : v)

/** Run project-owned commands with bounded output, cancellation and a real exit result. */
export function runImportCommand(command, root, { signal, timeoutMs = 60000 } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, { cwd: root, shell: true, detached: process.platform !== 'win32', windowsHide: true, env: { ...process.env, RETOUCH: '1', FORCE_COLOR: '0' } })
    let output = '', stopped = null
    const take = (d) => { output = (output + d).slice(-12000) }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    const stop = (reason) => {
      stopped = reason
      if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {})
      else { try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') } }
    }
    const abort = () => stop('Import cancelled.')
    const timer = setTimeout(() => stop(`The command timed out after ${Math.round(timeoutMs / 1000)} seconds.`), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    child.on('error', (e) => { cleanup(); fail(new RetouchError(`Could not run ${command}: ${e.message}`)) })
    child.on('close', (code) => {
      cleanup()
      if (stopped || code !== 0) fail(new RetouchError(`${stopped ?? `${command} failed (exit ${code}).`}\n${output.trim()}`))
      else done(output.trim())
    })
  })
}

/** The same pure splice plan as Save, checked against fresh source; no source is written. */
export async function verifyEditPlan(ops, project, edits) {
  const splices = await ops.plan(edits)
  if (!splices.length) throw new RetouchError('The sample edit did not resolve to source.')
  const files = new Map()
  for (const s of splices) {
    const now = project.readFresh(s.file)
    if (!project.allowed(s.file) || now !== s.basis) throw new RetouchError('A sample edit resolved outside the project or to stale source.')
    if (!files.has(s.file)) files.set(s.file, { now, list: [] })
    files.get(s.file).list.push(s)
  }
  for (const [file, { now, list }] of files) {
    list.sort((a, b) => b.start - a.start || b.end - a.end)
    let next = now, last = now.length + 1
    for (const s of list) {
      if (s.start < 0 || s.end > now.length || s.end > last) throw new RetouchError('Sample edits overlap or have invalid source ranges.')
      next = next.slice(0, s.start) + s.text + next.slice(s.end)
      last = s.start
    }
    if (next === now || parseErrors(next, file) > parseErrors(now, file)) throw new RetouchError('The sample edit would not produce valid changed source.')
  }
  return files.size
}

export function createProjects({ storageDir = join(TOOL_DIR, 'local', 'projects'), launch, command = runImportCommand, wire = wireProject } = {}) {
  const sessions = new Map(), allSessions = new Set(), jobs = new Map(), counts = new Map()
  let recent = []
  const recentFile = join(storageDir, 'recent.json')
  try { recent = JSON.parse(readFileSync(recentFile, 'utf8')).filter((p) => p && typeof p.root === 'string').slice(0, 8) } catch {}
  let active = null, picker = null
  const checkAbort = (j) => { if (j.abort.signal.aborted) throw new RetouchError('Import cancelled.') }
  const snapshot = (j) => ({ id: j.id, root: j.root, name: j.name, state: j.state, progress: j.progress, steps: j.steps, error: j.error, notes: j.notes, activity: j.activity, url: j.url, returnUrl: j.returnUrl, report: j.report })
  const jobOf = (id) => {
    const j = jobs.get(String(id))
    if (!j) throw new RetouchError('This import is no longer available. Start a new import.')
    return j
  }
  const step = (j, i, detail) => {
    checkAbort(j)
    j.steps.forEach((s, n) => { s.status = n < i ? 'passed' : n === i ? 'running' : 'waiting' })
    j.steps[i].detail = detail
    j.progress = Math.round(i / STEPS.length * 100)
  }
  const fail = (j, e) => {
    if (j.state === 'cancelled') return
    clearTimeout(j.browserTimer)
    j.state = 'failed'
    j.error = e.message
    const current = j.steps.find((s) => s.status === 'running')
    if (current) current.status = 'failed'
    if (active === j.id) active = null
    manager.onClientsChange?.([...counts.values()].reduce((a, b) => a + b, 0))
  }
  const remember = (s) => {
    recent = [{ root: s.config.root, name: s.config.name, configPath: s.file }, ...recent.filter((p) => p.root !== s.config.root)].slice(0, 8)
    mkdirSync(storageDir, { recursive: true })
    writeFileAtomic(recentFile, JSON.stringify(recent, null, 2) + '\n')
  }
  async function run(j, input) {
    try {
      step(j, 0, 'Checking the folder, installed Vite and React version.')
      j.root = projectFolder(input.root)
      const pkg = readPackage(j.root)
      j.name = pkg.name ?? j.root.split('/').pop()
      step(j, 1, 'Reading the dev script and source configuration.')
      const current = sessions.get(j.root)
      const saved = recent.find((p) => p.root === j.root)
      let loaded
      if (input.wiring) {
        const proposal = await wire({ root: j.root, pkg, credentials: input.wiring, script: input.script, signal: j.abort.signal, onActivity: (event) => {
          checkAbort(j)
          j.activity.push({ ...event, at: Date.now() })
          j.activity = j.activity.slice(-60)
          j.steps[1].detail = event.detail
        } })
        checkAbort(j)
        const dir = join(storageDir, hash(j.root, 12))
        mkdirSync(dir, { recursive: true })
        const file = join(dir, `config-${j.id}.mjs`)
        writeFileAtomic(file, proposal.source)
        loaded = { file, config: proposal.config, inferred: false }
        j.notes.push(proposal.summary, 'Assisted wiring saved in Retouch’s project library. Your API key is not saved.')
      } else loaded = await importConfig(j.root, pkg, { ...input, configPath: input.configPath || current?.file || saved?.configPath })
      delete input.wiring
      validateConfig(loaded.config)
      const wiring = signature(loaded.config)
      if (loaded.inferred) {
        const dir = join(storageDir, hash(j.root, 12))
        mkdirSync(dir, { recursive: true })
        loaded.file = join(dir, 'config.mjs')
        writeFileAtomic(loaded.file, '// Automatically wired by Retouch. Project source files are unchanged.\nexport default ' + JSON.stringify(loaded.raw, null, 2) + '\n')
        j.notes.push('New wiring saved in Retouch’s project library. The website’s source files stay in the chosen folder.')
      }
      j.configPath = loaded.file
      step(j, 2, 'Running the project’s preparation commands.')
      for (const cmd of loaded.config.before) { checkAbort(j); j.steps[2].detail = cmd; await command(cmd, j.root, { signal: j.abort.signal, timeoutMs: 180000 }) }
      step(j, 3, 'Starting the project’s own Vite with source tracing enabled.')
      if (current?.wiring === wiring) j.session = current
      else {
        if (allSessions.size >= 4) throw new RetouchError('Four project previews are already open. Restart Retouch to free them before importing another.')
        if (current) loaded.config.vite.port = Math.max(loaded.config.vite.port, (current.server.config.server?.port ?? loaded.config.vite.port) + 1)
        const start = launch ?? (await import('./start.mjs')).start
        j.session = await start({ loaded, noOpen: true, skipBefore: true, managed: true, projects: manager })
        j.session.wiring = wiring
        j.ownsSession = true
      }
      checkAbort(j)
      const { server, plugin, config } = j.session
      const { project } = plugin.api
      step(j, 4, 'Checking editable sources, generators and the project’s check command.')
      const matches = matcher(config.stamp.include, ['**/node_modules/**', ...config.stamp.exclude])
      const jsx = project.glob(config.stamp.include, config.stamp.exclude).filter((f) => /\.[jt]sx$/.test(f) && project.allowed(f))
      let stamped = 0
      for (const f of jsx) {
        checkAbort(j)
        const code = project.readFresh(f)
        if (!matches(plugin.api.relTo(f))) continue
        const out = await plugin.transform.handler(code, f)
        if (out?.code.includes('data-rt=')) stamped++
        if (out && parseErrors(out.code, f) > parseErrors(code, f)) throw new RetouchError(`Stamping would break ${plugin.api.relTo(f)}.`)
      }
      if (!stamped) throw new RetouchError('No editable JSX was stamped. Fix stamp.include to cover this website’s React source.')
      for (const glob of [...config.text.include, ...config.colors.include]) {
        if (!project.glob([glob]).length) throw new RetouchError(`The source glob ${glob} matches no files. Fix the project wiring.`)
      }
      for (const r of config.rebuild) {
        if (!project.glob(r.from).length || !project.glob(r.outputs).length) throw new RetouchError(`The generator ${r.label ?? r.run} has missing sources or outputs. Check its before and rebuild rules.`)
      }
      if (config.check?.command) await command(config.check.command, j.root, { signal: j.abort.signal, timeoutMs: config.check.timeoutMs ?? 60000 })
      else j.notes.push('No project lint or typecheck command is configured. Retouch’s source and rendered-page checks still run.')
      const response = await fetch(j.session.page, { signal: AbortSignal.timeout(15000) })
      if (!response.ok || !(await response.text()).includes('__RETOUCH__')) throw new RetouchError('The opening page is not being served with the Retouch editor. Check the Vite root and opening path.')
      // Vite and the project's plugins must both be in the live server.
      if (!server.config.plugins.some((p) => /react/.test(p.name))) j.notes.push('No named React plugin was found; the rendered React check will confirm compatibility.')
      step(j, 5, 'Opening the page to test React, source stamps and sample edits.')
      const url = new URL(j.session.url)
      url.searchParams.set('importJob', j.id)
      j.url = url.href
      j.state = 'awaiting-browser'
      j.browserTimer = setTimeout(() => fail(j, new RetouchError('The rendered page did not finish verification within 90 seconds. Check its console and opening path, then retry.')), 90000)
      j.browserTimer.unref?.()
    } catch (e) {
      fail(j, e)
      if (j.ownsSession && j.state !== 'awaiting-browser') await release(j)
    } finally { delete input.wiring }
  }
  async function release(j) {
    if (!j.ownsSession || !j.session) return
    await j.session.server.close().catch(() => {})
    allSessions.delete(j.session)
    if (sessions.get(j.root) === j.session) {
      const prior = [...allSessions].reverse().find((s) => s.config.root === j.root)
      if (prior) sessions.set(j.root, prior)
      else sessions.delete(j.root)
    }
    counts.delete(j.session.plugin)
    j.ownsSession = false
  }
  const manager = {
    onClientsChange: null,
    clients(session, n) { counts.set(session, n); manager.onClientsChange?.([...counts.values()].reduce((a, b) => a + b, 0)) },
    busy: () => active !== null,
    register(s) { s.wiring ??= signature(s.config); sessions.set(s.config.root, s); allSessions.add(s) },
    list: () => recent,
    setup: () => ({ providers: PROVIDERS, repo: TOOL_DIR }),
    prompt(root) {
      if (root && (typeof root !== 'string' || root.length > 4096)) throw new RetouchError('Enter the website folder path.')
      return setupPrompt(root)
    },
    begin(input, fromRoot, fromServer) {
      if (!input || typeof input.root !== 'string' || input.root.length > 4096 || (input.configPath && typeof input.configPath !== 'string') || (input.script && typeof input.script !== 'string')) throw new RetouchError('Provide a project folder path and optional config path or dev script name.')
      if (active) throw new RetouchError('A project is already importing. Finish or cancel it first.')
      if (input.wiring) input.wiring = wiringCredentials(input.wiring)
      const from = [...allSessions].find((s) => s.server === fromServer) ?? sessions.get(fromRoot)
      const j = { id: randomBytes(12).toString('hex'), root: input.root, name: 'New project', state: 'running', progress: 0, steps: STEPS.map(([id, label]) => ({ id, label, status: 'waiting', detail: '' })), notes: [], activity: [], error: null, abort: new AbortController(), returnUrl: from?.url || manager.setupUrl }
      jobs.set(j.id, j)
      // Keep completed reports bounded for a long-running editor.
      for (const [id, old] of jobs) if (jobs.size > 12 && ['passed', 'failed', 'cancelled'].includes(old.state)) jobs.delete(id)
      active = j.id
      manager.onClientsChange?.([...counts.values()].reduce((a, b) => a + b, 0))
      setImmediate(() => run(j, input))
      return snapshot(j)
    },
    status(id) { return snapshot(jobOf(id)) },
    async cancel(id) {
      const j = jobOf(id)
      if (j.state === 'passed') return snapshot(j)
      j.state = 'cancelled'
      j.abort.abort()
      clearTimeout(j.browserTimer)
      if (active === j.id) active = null
      manager.onClientsChange?.([...counts.values()].reduce((a, b) => a + b, 0))
      // Let the response and browser navigation finish before closing their server.
      const cleanup = setTimeout(() => release(j), 500)
      cleanup.unref?.()
      return snapshot(j)
    },
    async verify(body, { config, project, ops, tracer }) {
      const j = jobOf(body.id)
      if (j.root !== config.root || !j.session || j.state !== 'awaiting-browser') throw new RetouchError('This verification does not belong to the active project.')
      try {
        checkAbort(j)
        if (body.error) throw new RetouchError(String(body.error).slice(0, 2000))
        if (!body.react || !Array.isArray(body.samples) || !body.samples.length) throw new RetouchError('The page rendered no editable React elements. Check the opening route and stamp.include.')
        const samples = body.samples.slice(0, 32)
        const byStamp = await ops.inspect(samples)
        const items = samples.map((s) => byStamp[s.stamp]).filter(Boolean)
        let plans = 0, text = 0, adapters = 0, drawings = 0
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (item.error) throw new RetouchError(`Source stamp verification failed: ${item.error}`)
          if (project.textExcluded(item.file)) continue
          const s = samples[i]
          const ad = item.strategies.transform
          if (!item.intrinsic && ad.unverified) {
            const note = `Style changes on ${item.name} depend on the component forwarding its style prop; the Properties panel flags this before editing.`
            if (!j.notes.includes(note)) j.notes.push(note)
            continue
          }
          const edit = ad.kind === 'adapter'
            ? { kind: 'transform', stamp: s.stamp, propEdits: { [ad.adapter.move.x || ad.adapter.move.y]: { add: 1 } } }
            : ad.kind === 'wrapper' ? { kind: 'transform', stamp: s.stamp, wrapper: 'translate(1 0)' }
            : { kind: 'style', stamp: s.stamp, props: { outlineOffset: s.outlineOffset === '1px' ? '2px' : '1px' } }
          await verifyEditPlan(ops, project, [edit])
          plans++
          if (ad.kind === 'adapter') {
            adapters++
            if (ad.adapter.size.length) { await verifyEditPlan(ops, project, [{ kind: 'transform', stamp: s.stamp, propEdits: Object.fromEntries(ad.adapter.size.map((p) => [p, { mul: 1.05 }])) }]); plans++ }
          }
          if (s.text?.trim().length >= 3 && s.text.length <= 500) {
            const req = { chain: [s.stamp], elementOld: s.text, nodeOld: s.text, nodeOffset: 0, from: 0, to: s.text.length }
            const resolved = ops.resolveText(req)
            if (resolved.status === 'ok') { await verifyEditPlan(ops, project, [{ ...req, kind: 'text', insert: s.text + ' ', choice: resolved.target?.id }]); text++ }
          }
        }
        if (!plans) throw new RetouchError('No editable DOM elements could be tested. Check component prop forwarding and source stamps.')
        const html = body.html?.slice(0, 6) ?? []
        if (html.length) {
          const located = tracer.locateHtml(html)
          const found = Object.values(located).filter((h) => h.stamp)
          if (found.length !== html.length) throw new RetouchError('Rendered markup could not be found unambiguously in text.include. Include its original HTML source or lock the generated widget in the Retouch config.')
          for (const h of found) { await verifyEditPlan(ops, project, [{ kind: 'style', stamp: h.stamp, props: { outlineOffset: '1px' } }]); plans++ }
        }
        if (!text) j.notes.push('No literal text sample could be resolved on this route. Computed or remote text remains read-only.')
        if (body.frames?.length) {
          const input = body.frames.slice(0, 40)
          const mapped = await tracer.frames(input)
          for (const group of new Set(input.map((f) => f.group))) {
            const traced = input.filter((f) => f.group === group).some((f) => {
              const at = mapped[f.key]
              return at?.file && project.allowed(resolve(config.root, at.file)) && (at.mapped || !at.generatedBy)
            })
            if (!traced) throw new RetouchError('A canvas drawing could not be traced to project source. Enable the generator’s RETOUCH source maps, then import again.')
            drawings++
          }
        }
        if (body.canvases && !body.recorded) j.notes.push('The canvases did not redraw during loading, so their drawing traces were not verified. Trigger a redraw and check Source before editing them.')
        if (body.recorded && !drawings) throw new RetouchError('Canvas drawings were recorded without source stacks. Check the drawing script and its source maps.')
        checkAbort(j)
        remember(j.session)
        j.report = `${items.length} elements linked to source; ${plans} sample ${plans === 1 ? 'edit' : 'edits'} and ${text} text ${text === 1 ? 'change' : 'changes'} verified.${adapters ? ` ${adapters} move and size ${adapters === 1 ? 'connection' : 'connections'} checked.` : ''}${drawings ? ` ${drawings} drawing ${drawings === 1 ? 'source' : 'sources'} located.` : ''}`
        clearTimeout(j.browserTimer)
        j.state = 'passed'
        j.progress = 100
        j.steps.forEach((s) => { s.status = 'passed' })
        j.steps[5].detail = j.report
        if (active === j.id) active = null
        manager.onClientsChange?.([...counts.values()].reduce((a, b) => a + b, 0))
      } catch (e) { fail(j, e) }
      return snapshot(j)
    },
    async pick() {
      if (picker) return picker
      picker = new Promise((done, failPick) => {
        const finish = (err, stdout) => {
          if (err && err.code !== 1) failPick(new RetouchError('The folder picker is unavailable. Paste the project’s full folder path instead.'))
          else done(stdout?.trim() || null)
        }
        if (process.platform === 'win32') execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = "Choose the website source folder"; $picker.ShowNewFolderButton = $false; if ($picker.ShowDialog() -eq "OK") { [Console]::Write($picker.SelectedPath) }; $picker.Dispose()'], { windowsHide: true, timeout: 120000 }, finish)
        else if (process.platform === 'darwin') execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose the website source folder")'], { timeout: 120000 }, finish)
        else execFile('zenity', ['--file-selection', '--directory', '--title=Choose the website source folder'], { timeout: 120000 }, finish)
      }).finally(() => { picker = null })
      return picker
    },
    async close() {
      for (const j of jobs.values()) { j.abort.abort(); clearTimeout(j.browserTimer) }
      await Promise.all([...allSessions].map((s) => s.server.close().catch(() => {})))
      sessions.clear()
      allSessions.clear()
    },
  }
  return manager
}
