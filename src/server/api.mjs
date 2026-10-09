import { applySplices } from './save.mjs'
import { readJson, RetouchError, sendJson } from './util.mjs'

/**
 * THE LOCAL API, mounted at /__retouch on the dev server.
 *
 * It can write source files, so it is guarded twice. The server is bound
 * to localhost only (start.mjs), and every request must carry the token
 * printed into the page when it was served: a web page from anywhere else
 * that knows the port still cannot read that token, so it cannot ask this
 * server to change a file.
 */
export function createApi({ ops, project, journal, checker, config, token, notify, rebuilder, tracer, settings, sources, projects }) {
  /** After files change: their generators, then the project's check. */
  async function afterWrite(files) {
    const rebuilt = rebuilder ? await rebuilder.after(files) : []
    if (rebuilt.length) project.rescan()
    checker.run()
    return rebuilt.map((r) => ({ label: r.label, ok: r.ok, output: r.ok ? '' : r.output }))
  }

  const routes = {
    ...(projects ? {
      'GET /projects': () => ({ projects: projects.list(), current: { name: config.name, root: config.root } }),
      'POST /projects/pick': async () => ({ root: await projects.pick() }),
      'GET /projects/setup': () => projects.setup(),
      'POST /projects/prompt': (body) => ({ prompt: projects.prompt(body.root) }),
      'POST /projects/import': (body) => ({ job: projects.begin(body, config.root, project.server) }),
      'POST /projects/status': (body) => ({ job: projects.status(body.id) }),
      'POST /projects/cancel': async (body) => ({ job: await projects.cancel(body.id) }),
      'POST /projects/verify': async (body) => ({ job: await projects.verify(body, { config, project, sources, ops, tracer }) }),
    } : {}),
    'GET /config': () => ({
      name: config.name,
      root: project.root,
      locked: config.locked,
      colors: { tokens: config.colors.tokens, tokensFirst: config.colors.tokensFirst },
      check: config.check ? { label: config.check.label } : null,
      lastCheck: checker.last,
      adapters: (config.adapters ?? []).map((a) => ({ component: a.component })),
      rebuild: (rebuilder?.rules ?? []).map((r) => ({ label: r.label, from: [].concat(r.from) })),
    }),
    'GET /history': () => ({ batches: journal.summary() }),
    'POST /inspect': async (body) => ({ items: await ops.inspect(body.items) }),
    'POST /drawing/inspect': async (body) => ({ scopes: await ops.inspectDrawing(body.frames) }),
    'POST /text/resolve': async (body) => ops.resolveText(body),
    'POST /text/find': async (body) => ({ candidates: ops.findText(body) }),
    'POST /color/check': async (body) => ({ warnings: colorWarnings(config, body.value) }),
    'POST /color/find': async (body) => ({ candidates: tracer.findColors(body) }),
    'POST /html/locate': async (body) => ({ items: tracer.locateHtml(body.items) }),
    'POST /trace/rules': async (body) => ({ rules: await tracer.rules(body.rules) }),
    'POST /trace/keyframes': async (body) => ({ keyframes: tracer.keyframes(body.names) }),
    'POST /trace/frames': async (body) => ({ frames: await tracer.frames(body.frames) }),
    'POST /settings': async (body) => {
      const out = []
      for (const stamp of (body.stamps ?? []).slice(0, 6)) {
        try {
          if (String(stamp).startsWith('html:')) {
            const hit = tracer.resolveHtmlStamp(stamp)
            if (hit) out.push({ stamp, ...settings.forHtml(hit) })
          } else if (!String(stamp).startsWith('none:')) out.push(await settings.forStamp(stamp))
        } catch (e) {
          out.push({ stamp, error: e.message, groups: [] })
        }
      }
      if (body.at?.file) {
        const s = settings.forLine(body.at.file, Number(body.at.line) || 1)
        if (s) out.push({ stamp: null, ...s })
      }
      return { settings: out }
    },
    'GET /files': () => ({ files: tracer.fileIds(sources) }),
    'POST /trace/files': async (body) => ({ files: (body.files ?? []).map((f) => ({ file: f, generatedBy: tracer.generatedBy(f) })) }),
    'POST /save': async (body) => {
      const list = Array.isArray(body.ops) ? body.ops : []
      if (!list.length) throw new RetouchError('Nothing to save.')
      const splices = await ops.plan(list)
      const batch = applySplices({ project, journal, splices, label: String(body.label ?? '').slice(0, 120) })
      const rels = batch.files.map((f) => f.rel)
      const rebuilt = await afterWrite(rels)
      notify({ type: 'saved', id: batch.id })
      return { batch: { id: batch.id, time: batch.time, label: batch.label, files: rels }, rebuilt }
    },
    'POST /revert': async (body) => {
      const b = journal.swap(String(body.id), 'undo')
      const rebuilt = await afterWrite(b.files.map((f) => f.rel))
      return { batch: { id: b.id, undone: true }, rebuilt }
    },
    'POST /reapply': async (body) => {
      const b = journal.swap(String(body.id), 'redo')
      const rebuilt = await afterWrite(b.files.map((f) => f.rel))
      return { batch: { id: b.id, undone: false }, rebuilt }
    },
  }

  return async function handle(req, res, next) {
    const path = (req.url ?? '/').split('?')[0]
    const route = routes[`${req.method} ${path}`]
    if (!route) return next()
    if (req.headers['x-retouch-token'] !== token) return sendJson(res, 403, { error: 'Missing or wrong Retouch token. Reload the page.' })
    try {
      const body = req.method === 'POST' ? await readJson(req) : {}
      const result = await route(body)
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      const known = e instanceof RetouchError
      if (!known) console.error('[retouch]', e)
      sendJson(res, known ? 409 : 500, { ok: false, error: known ? e.message : `Retouch hit an internal error: ${e.message}`, code: e.code ?? 'error', op: e.op ?? null, candidates: e.candidates ?? null })
    }
  }
}

export function colorWarnings(config, value) {
  const out = []
  for (const rule of config.colorRules ?? []) {
    try {
      const m = rule(String(value ?? ''))
      if (m) out.push(String(m))
    } catch {}
  }
  return out
}
