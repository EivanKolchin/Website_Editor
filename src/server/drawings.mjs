import { resolve } from 'node:path'
import { analysed, walk } from './ast.mjs'
import { lineCol, posix, RetouchError } from './util.mjs'
import { mul } from '../client/geometry.js'

const CONTEXT = /^(ctx|context|bx|fx|cxt)$/
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const RESET = new Set(['clearRect', 'reset', 'resetTransform', 'setTransform', 'transform', 'translate', 'rotate', 'scale'])
const numberOf = (n) => n?.type === 'NumericLiteral' ? n.value : n?.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'NumericLiteral' ? -n.argument.value : NaN
const callIs = (n, ctx, method) => n?.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed && n.callee.object.name === ctx && n.callee.property.name === method

/** Our own balanced wrapper is updated, never nested on the next edit. */
function managed(body, ctx, code) {
  const [save, run] = body.body
  if (body.body.length !== 2 || !callIs(save?.expression, ctx, 'save') || run?.type !== 'TryStatement' || run.handler) return null
  const transform = run.block.body[0]?.expression
  if (!callIs(transform, ctx, 'transform') || transform.arguments.length !== 6 || !code.slice(body.start + 1, save.start).includes('retouch:canvas')) return null
  if (run.finalizer?.body.length !== 1 || !callIs(run.finalizer.body[0]?.expression, ctx, 'restore')) return null
  const matrix = transform.arguments.map(numberOf)
  return matrix.every(Number.isFinite) ? { matrix, transform, original: run.block.body.slice(1) } : null
}

function describe(code, file, start, end) {
  const a = analysed(code, file)
  let fn = null
  walk(a.ast, (node) => {
    if (FUNCTIONS.has(node.type) && node.body?.type === 'BlockStatement' && node.start <= start && node.end >= end && (!fn || node.end - node.start < fn.end - fn.start)) fn = node
  })
  if (!fn || fn.async || fn.generator || fn.body.directives?.length) return null
  const ctx = fn.params.find((p) => p.type === 'Identifier' && CONTEXT.test(p.name))?.name
  if (!ctx) return null
  const own = managed(fn.body, ctx, code)
  let unsafe = false, uses = false
  for (const statement of own?.original ?? fn.body.body) walk(statement, (node) => {
    if (FUNCTIONS.has(node.type)) return false
    if (node.type === 'MemberExpression' && node.object.name === ctx) {
      uses = true
      if (node.computed || RESET.has(node.property.name)) unsafe = true
    }
    if (node.type === 'CallExpression' && node.arguments.some((arg) => arg.type === 'Identifier' && arg.name === ctx)) uses = true
    if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier' && node.left.name === ctx) unsafe = true
  })
  if (!uses || unsafe) return null
  const parent = a.parents.get(fn)
  const name = fn.id?.name ?? (parent?.type === 'VariableDeclarator' ? parent.id.name : null) ?? 'drawing'
  return { fn, ctx, own, name, ...lineCol(code, fn.start) }
}

/** A mapped, read-only source inspection. The only output later written is a splice. */
export function createDrawingEdits({ project, sources, tracer }) {
  async function inspect(frames) {
    const mapped = await tracer.frames((frames ?? []).slice(0, 8).map((f, i) => ({ ...f, key: String(i) })))
    const scopes = [], seen = new Set()
    const allowed = new Set(project.sourceFiles().map(posix))
    for (let i = 0; i < (frames ?? []).length; i++) {
      const at = mapped[String(i)]
      if (!at?.mapped) continue
      const file = posix(resolve(project.root, at.file))
      if (!allowed.has(file) || !/\.[cm]?[jt]sx?$/.test(file)) continue
      const code = project.readFresh(file)
      if (code == null) continue
      const lines = code.split('\n'), offset = lines.slice(0, at.line - 1).reduce((n, s) => n + s.length + 1, 0) + Math.max(0, at.col - 1)
      let d
      try { d = describe(code, file, offset, offset) } catch { continue }
      if (!d || seen.has(file + ':' + d.fn.start)) continue
      seen.add(file + ':' + d.fn.start)
      const snap = sources.record(file, code)
      scopes.push({ name: d.name, file: at.file, line: d.line, col: d.col, depth: i, target: { pid: snap.pid, vid: snap.vid, start: d.fn.start, end: d.fn.end }, shared: true })
    }
    return scopes
  }
  function plan(op) {
    const t = op.target ?? {}, f = sources.file(t.pid), basis = sources.snapshot(t.pid, t.vid)
    if (!f || basis == null || !project.allowed(f.file) || !project.sourceFiles().includes(f.file)) throw new RetouchError('This drawing source is no longer available. Reload the page.', { code: 'stale' })
    const d = describe(basis, f.file, Number(t.start), Number(t.end))
    if (!d || d.fn.start !== t.start || d.fn.end !== t.end) throw new RetouchError('That drawing cannot be transformed safely.', { code: 'drawing' })
    const n = op.matrix
    if (!Array.isArray(n) || n.length !== 6 || !n.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6) || Math.abs(n[0] * n[3] - n[1] * n[2]) < 1e-8) throw new RetouchError('Invalid drawing transform.')
    const m = mul(n, d.own?.matrix ?? [1, 0, 0, 1, 0, 0]).map((v) => Number(v.toFixed(6)))
    const splice = (start, end, text) => ({ file: f.file, basis, start, end, text })
    if (d.own) return d.own.transform.arguments.map((arg, i) => splice(arg.start, arg.end, String(m[i])))
    const indent = /^\s*/.exec(basis.slice(basis.lastIndexOf('\n', d.fn.start) + 1, d.fn.start))[0] + '  '
    const nl = basis.includes('\r\n') ? '\r\n' : '\n'
    return [
      splice(d.fn.body.start + 1, d.fn.body.start + 1, `${nl}${indent}/* retouch:canvas */ ${d.ctx}.save();${nl}${indent}try { ${d.ctx}.transform(${m.join(', ')});`),
      splice(d.fn.body.end - 1, d.fn.body.end - 1, `${nl}${indent}} finally { ${d.ctx}.restore(); }${nl}${indent.slice(0, -2)}`),
    ]
  }
  return { inspect, plan }
}
