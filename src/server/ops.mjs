import { analysed, attr, elementName, findElementAt } from './ast.mjs'
import { deleteElementSplices, numericSplices, removeArrayEntrySplices, SAFE, setAttrExprSplices, setAttrSplices, styleSplices, wrapperSplices } from './edits.mjs'
import { inMapTemplate, instanceEntry, propSite } from './resolve.mjs'
import { relocate } from './sources.mjs'
import { parseStamp } from './stamp.mjs'
import { excerpt, rewriteJSXText, spliceEntry, verifyEntry } from './text.mjs'
import { resolve } from 'node:path'
import { formatLike, kindOf, parseColorLiteral, parseOklchArray } from './colors.mjs'
import { removeElementSplice, styleAttributeSplice } from './html.mjs'
import { htmlInsertSplice, htmlSnippet, jsxInsertSplice, jsxSnippet, newElementMarkup, writtenClass } from './insert.mjs'
import { lineCol, posix, RetouchError, relTo } from './util.mjs'
import { createDrawingEdits } from './drawings.mjs'

/**
 * WHAT CAN BE DONE TO AN ELEMENT, AND THEN DOING IT.
 *
 * `inspect` answers the client's question on selection - for each stamp in
 * the chain under the pointer: what is it, where is it written, and which
 * strategy will each tool use. `resolveText` finds where a piece of text is
 * written. `plan` turns a batch of edits into splices. None of them writes
 * anything; save.mjs does that.
 */

const SVG_BUILTIN = {
  image: { move: { x: 'x', y: 'y' }, size: ['width', 'height'] },
  use: { move: { x: 'x', y: 'y' }, size: ['width', 'height'] },
  rect: { move: { x: 'x', y: 'y' }, size: ['width', 'height'] },
  foreignObject: { move: { x: 'x', y: 'y' }, size: ['width', 'height'] },
  circle: { move: { x: 'cx', y: 'cy' }, size: ['r'] },
  ellipse: { move: { x: 'cx', y: 'cy' }, size: ['rx', 'ry'] },
  text: { move: { x: 'x', y: 'y' }, size: [] },
}
const SVG_DEFAULT_ZERO = new Set(['x', 'y', 'cx', 'cy'])

export function createOps({ project, sources, config, tracer = null }) {
  const drawings = createDrawingEdits({ project, sources, tracer })
  const adapters = (config.adapters ?? []).map((ad) => ({ ...ad, names: [].concat(ad.component ?? []) }))
  const isHtml = (stamp) => typeof stamp === 'string' && stamp.startsWith('html:')

  /** An element written in an HTML file: edited through its style attribute, deleted as a range of markup. */
  function htmlInfo(stamp) {
    const hit = tracer?.resolveHtmlStamp(stamp)
    if (!hit) return { stamp, error: 'This element is no longer where it was in its HTML file. Reload the page.', code: 'stale' }
    const { line, col } = lineCol(hit.code, hit.el.start)
    const svg = /^(svg|g|path|rect|circle|ellipse|line|polyline|polygon|text|tspan|use|image)$/.test(hit.el.tag)
    return {
      stamp,
      base: stamp,
      file: relTo(project.root, hit.file),
      line,
      col,
      name: hit.el.tag,
      intrinsic: true,
      inMap: false,
      entryLabel: null,
      stale: false,
      html: true,
      strategies: {
        transform: { kind: 'style', entry: false, html: true, svgAttr: svg },
        delete: { kind: 'element', entry: false },
        color: { kind: 'style', entry: false },
      },
    }
  }
  const kebab = (k) => (k.startsWith('--') ? k : k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()))

  function locate(stamp) {
    const st = parseStamp(stamp)
    if (!st) throw new RetouchError('That element has no readable source stamp.', { code: 'stamp' })
    const f = sources.file(st.pid)
    const code = sources.snapshot(st.pid, st.vid)
    if (!f || code == null) throw new RetouchError('This page is older than its code. Reload the page and try again.', { code: 'stale' })
    const a = analysed(code, f.file)
    const el = findElementAt(a, st.start, st.end)
    if (!el) throw new RetouchError('Could not find that element in its source file.', { code: 'stale' })
    const instance = new Map(st.maps.filter((m) => m.index != null).map((m) => [m.fn, m.index]))
    return { st, f, a, el, instance }
  }

  function adapterFor(el, svg) {
    const name = elementName(el)
    const own = adapters.find((ad) => ad.names.includes(name))
    if (own) return { ...own, builtin: false }
    if (svg && SVG_BUILTIN[name] && !attr(el, 'transform')) return { ...SVG_BUILTIN[name], builtin: true }
    return null
  }

  async function transformStrategy(a, el, instance, svg, intrinsic) {
    const ad = adapterFor(el, svg)
    if (ad) {
      const sites = {}
      let ok = true
      for (const ch of ['x', 'y']) {
        const prop = ad.move?.[ch]
        if (!prop) continue
        const site = await propSite(project, a, el, prop, instance)
        if (site.kind === 'none' || site.kind === 'opaque' || (site.kind === 'missing' && !(ad.builtin && SVG_DEFAULT_ZERO.has(prop)))) {
          ok = false
          break
        }
        sites[prop] = describe(site)
      }
      const size = []
      if (ok) {
        for (const prop of ad.size ?? []) {
          const site = await propSite(project, a, el, prop, instance)
          if (site.kind === 'none' || site.kind === 'missing' || site.kind === 'opaque') {
            size.length = 0
            break
          }
          sites[prop] = describe(site)
          size.push(prop)
        }
      }
      if (ok && ad.move) {
        const all = Object.values(sites)
        return {
          kind: 'adapter',
          adapter: { move: ad.move, size, anchor: ad.anchor ?? 'props' },
          sites,
          entry: all.length > 0 && all.every((s) => s.entry),
          rest: svg ? 'wrapper' : 'style',
        }
      }
    }
    if (svg) return { kind: 'wrapper', entry: false }
    return { kind: 'style', entry: false, unverified: !intrinsic }
  }

  const describe = (site) => ({ kind: site.kind, entry: !!site.entry, label: site.label ?? null, file: site.a ? relTo(project.root, site.a.file) : null })

  async function inspectOne({ stamp, svg }) {
    if (isHtml(stamp)) return htmlInfo(stamp)
    try {
      const { st, f, a, el, instance } = locate(stamp)
      const name = elementName(el)
      const intrinsic = /^[a-z]/.test(name)
      const { line, col } = lineCol(a.code, el.start)
      const tmpl = inMapTemplate(a, el)
      const entry = await instanceEntry(project, a, el, instance)
      const transform = await transformStrategy(a, el, instance, !!svg, intrinsic)
      const fillAttr = intrinsic && svg ? attr(el, 'fill') : null
      return {
        stamp,
        base: st.base,
        file: f.rel,
        line,
        col,
        name,
        intrinsic,
        inMap: !!tmpl,
        entryLabel: entry?.label ?? null,
        stale: project.read(f.file) !== a.code,
        strategies: {
          transform,
          delete: entry ? { kind: 'entry', entry: true, label: entry.label } : { kind: 'element', entry: false },
          color: { kind: fillAttr?.value?.type === 'StringLiteral' ? 'attr' : 'style', entry: false, unverified: !intrinsic },
        },
      }
    } catch (e) {
      return { stamp, error: e.message, code: e.code ?? 'error' }
    }
  }

  async function inspect(items) {
    const out = {}
    for (const item of items ?? []) {
      if (!item?.stamp || out[item.stamp]) continue
      out[item.stamp] = await inspectOne(item)
    }
    return out
  }

  /* ---------------------------------------------------------------- */
  /*  text                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Find where a piece of rendered text is written. Tried in order, and the
   * first that finds anything wins:
   *   1. a literal whose value IS the element's whole text
   *   2. a literal whose value is the edited text node's text
   *   3. a literal containing the node's text exactly once
   *   4. a literal containing the element's text exactly once
   * Ties are broken by nearness: inside the element's own JSX first, then
   * the files the element's chain is written in, then the modules they
   * import, by import distance. A tie that survives that goes back to the
   * person as a choice; nothing is ever picked at random.
   */
  function textCandidates(req) {
    const chain = (req.chain ?? []).map(parseStamp).filter(Boolean)
    const chainFiles = [...new Set(chain.map((s) => sources.file(s.pid)?.file).filter(Boolean))]
    const dist = project.distances(chainFiles)
    let host = null
    if (chain[0]) {
      const f = sources.file(chain[0].pid)
      const snap = sources.snapshot(chain[0].pid, chain[0].vid)
      const now = f && project.read(f.file)
      if (f && snap != null && now != null) {
        const r = relocate(snap, now, chain[0].start, chain[0].end)
        if (r) host = { file: f.file, ...r }
      }
    }
    const { elementOld = '', nodeOld = '', nodeOffset = 0 } = req
    const from = req.from
    const to = req.to
    const inNode = from >= nodeOffset && to <= nodeOffset + nodeOld.length
    const tiers = [
      { base: 'element', match: (v, e) => !e.partial && v === elementOld && elementOld.length > 0 ? 0 : -1 },
      inNode && nodeOld !== elementOld && { base: 'node', match: (v, e) => !e.partial && v === nodeOld && nodeOld.length > 0 ? 0 : -1 },
      inNode && nodeOld.trim().length >= 3 && { base: 'node', match: (v) => unique(v, nodeOld) },
      elementOld.trim().length >= 3 && { base: 'element', match: (v) => unique(v, elementOld) },
    ].filter(Boolean)

    const files = project.textFiles()
    for (const tier of tiers) {
      const found = []
      for (const file of files) {
        const { code, list } = project.entries(file)
        if (code == null) continue
        for (const e of list) {
          const at = tier.match(e.value, e)
          if (at < 0) continue
          const inside = host && host.file === file && e.start >= host.start && e.end <= host.end
          const rank = inside ? 0 : dist.has(file) ? 1 + dist.get(file) : 20
          const rf = (tier.base === 'element' ? from : from - nodeOffset) + at
          const rt = (tier.base === 'element' ? to : to - nodeOffset) + at
          found.push({ file, code, entry: e, rf, rt, rank })
        }
      }
      if (found.length) return found.sort((x, y) => x.rank - y.rank || x.entry.start - y.entry.start)
    }
    return []
  }

  const unique = (value, needle) => {
    const i = value.indexOf(needle)
    return i >= 0 && value.indexOf(needle, i + 1) < 0 && value !== needle ? i : -1
  }

  const candidateInfo = (c) => {
    const { line } = lineCol(c.code, c.entry.start)
    return { id: `${relTo(project.root, c.file)}:${c.entry.start}`, file: relTo(project.root, c.file), line, kind: c.entry.kind, preview: excerpt(c.entry.value, c.rf), rank: c.rank }
  }

  function pickCandidate(req, list) {
    if (!list.length) return { status: 'missing' }
    if (req.choice) {
      const [file, start] = splitId(req.choice)
      const same = list.filter((c) => relTo(project.root, c.file) === file)
      if (same.length) {
        same.sort((x, y) => Math.abs(x.entry.start - start) - Math.abs(y.entry.start - start))
        return { status: 'ok', candidate: same[0] }
      }
    }
    const best = list.filter((c) => c.rank === list[0].rank)
    if (best.length === 1) return { status: 'ok', candidate: best[0] }
    return { status: 'ambiguous', candidates: list.slice(0, 8).map(candidateInfo) }
  }

  const splitId = (id) => {
    const k = id.lastIndexOf(':')
    return [id.slice(0, k), Number(id.slice(k + 1))]
  }

  /** The splice for one text edit, verified: the edited literal must re-read as the intended text. */
  function textSplice(c, insert) {
    const { file, code, entry, rf, rt } = c
    if (rf < 0 || rt > entry.value.length || rf > rt) throw new RetouchError('That edit no longer lines up with the source text.')
    const expected = entry.value.slice(0, rf) + insert + entry.value.slice(rt)
    const a = { file, code }
    let s = spliceEntry(code, entry, rf, rt, insert)
    const apply = (x) => code.slice(0, x.start) + x.text + code.slice(x.end)
    if (!verifyEntry(apply(s), file, entry, s, expected)) {
      if (entry.kind !== 'jsxtext') throw new RetouchError('That text could not be written back faithfully.')
      s = rewriteJSXText(code, entry, expected)
      if (!verifyEntry(apply(s), file, entry, s, expected)) throw new RetouchError('That text could not be written back faithfully.')
    }
    return { a, file, basis: code, start: s.start, end: s.end, text: s.text }
  }

  function textWarnings(text) {
    const out = []
    for (const rule of config.textRules ?? []) {
      try {
        if (typeof rule === 'function') {
          const m = rule(text)
          if (m) out.push(String(m))
        } else if (rule?.pattern && new RegExp(rule.pattern.source ?? rule.pattern, rule.pattern.flags ?? 'u').test(text)) out.push(rule.message)
      } catch {}
    }
    return out
  }

  function resolveText(req) {
    const picked = pickCandidate(req, textCandidates(req))
    const newText = (req.elementOld ?? '').slice(0, req.from) + (req.insert ?? '') + (req.elementOld ?? '').slice(req.to)
    const warnings = textWarnings(newText)
    if (picked.status !== 'ok') return { ...picked, warnings }
    const c = picked.candidate
    try {
      textSplice(c, req.insert ?? '')
    } catch (e) {
      return { status: 'missing', reason: e.message, warnings }
    }
    return { status: 'ok', target: candidateInfo(c), warnings }
  }

  /* ---------------------------------------------------------------- */
  /*  planning a save                                                  */
  /* ---------------------------------------------------------------- */

  const quote = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

  /** A file named by the client, root-relative, refused when it is outside the project. */
  function projectFile(rel) {
    const file = posix(resolve(project.root, String(rel ?? '')))
    if (!project.allowed(file)) throw new RetouchError(`Refusing to edit ${rel}: it is outside the project.`)
    return file
  }

  /** Where `text` stands in `code` now: at `start` if it still does, else its nearest occurrence. */
  function findAgain(code, start, text) {
    if (code.slice(start, start + text.length) === text) return start
    let best = -1
    for (let k = code.indexOf(text); k >= 0; k = code.indexOf(text, k + 1)) if (best < 0 || Math.abs(k - start) < Math.abs(best - start)) best = k
    return best
  }

  /** A colour written over another colour literal, in that literal's own spelling. */
  function recolorSplice(op) {
    const t = op.target ?? {}
    const file = projectFile(t.file)
    const code = project.readFresh(file)
    if (code == null) throw new RetouchError(`${t.file} no longer exists.`)
    const at = findAgain(code, Number(t.start), String(t.text ?? ''))
    if (at < 0 || !t.text) throw new RetouchError(`That colour is no longer written in ${t.file}. Reload and pick it again.`, { code: 'stale' })
    const value = String(op.value ?? '').trim()
    let text
    if (/^var\(--[\w-]+\)$/.test(value)) {
      if (t.where !== 'css' && !(t.where === 'attr' && kindOf(file) === 'html')) throw new RetouchError('A token can only be written into a stylesheet; this colour is read by a script.')
      text = value
    } else {
      const rgb = parseColorLiteral(value)?.rgb
      if (!rgb) throw new RetouchError('That is not a colour Retouch can write.')
      const parsed = t.where === 'array' ? parseOklchArray(String(t.text).match(/-?\d*\.?\d+/g) ?? []) : parseColorLiteral(t.text)
      if (!parsed) throw new RetouchError('That colour could not be read where it is written.')
      text = formatLike(parsed.format, rgb)
    }
    return { file, basis: code, start: at, end: at + t.text.length, text }
  }

  /** A declaration's value in a stylesheet, replaced. */
  function declSplice(op) {
    const t = op.target ?? {}
    const file = projectFile(t.file)
    const code = project.readFresh(file)
    if (code == null) throw new RetouchError(`${t.file} no longer exists.`)
    const value = String(op.value ?? '').trim()
    if (!SAFE.style(value)) throw new RetouchError('That value cannot be written into a stylesheet.')
    const at = findAgain(code, Number(t.start), String(t.text ?? ''))
    if (at < 0) throw new RetouchError(`That rule changed in ${t.file}. Reload and try again.`, { code: 'stale' })
    return { file, basis: code, start: at, end: at + String(t.text).length, text: value }
  }

  /**
   * One literal in code, rewritten as the same kind of literal: a number as
   * a number, a string in its own quotes (JSX and HTML attribute strings
   * escaped their own way), a boolean as a boolean - and a bare JSX
   * attribute switched off by writing ={false} after its name.
   */
  function literalSplice(op) {
    const t = op.target ?? {}
    const file = projectFile(t.file)
    const code = project.readFresh(file)
    if (code == null) throw new RetouchError(`${t.file} no longer exists.`)
    const at = t.bare ? Number(t.start) : findAgain(code, Number(t.start), String(t.text ?? ''))
    if (at < 0) throw new RetouchError(`That value changed in ${t.file}. Reload and try again.`, { code: 'stale' })
    const end = at + String(t.text ?? '').length
    const kind = op.type
    let text
    if (kind === 'number') {
      const n = Number(op.value)
      if (!Number.isFinite(n)) throw new RetouchError('That is not a number.')
      text = String(Number(n.toFixed(6)))
    } else if (kind === 'boolean') {
      const on = op.value === true || op.value === 'true'
      text = t.bare ? (on ? '' : '={false}') : String(on)
    } else if (kind === 'string' || kind === 'enum') {
      const v = String(op.value ?? '')
      if (/[\n\r]/.test(v)) throw new RetouchError('A value on one line, please.')
      if (t.htmlAttr) text = v.replace(/&/g, '&amp;').replace(new RegExp(t.htmlAttr, 'g'), t.htmlAttr === '"' ? '&quot;' : '&#39;')
      else {
        const q = /^["'`]/.test(t.text) ? t.text[0] : "'"
        if (q === '`' && /\$\{|`/.test(v)) throw new RetouchError('That text cannot go in a template string.')
        text = t.jsxAttr ? q + v.replace(/&(?=#?\w+;)/g, '&amp;').replace(new RegExp(q, 'g'), q === '"' ? '&quot;' : '&apos;') + q : q + v.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q) + q
      }
    } else throw new RetouchError('Unknown kind of value.')
    return { file, basis: code, start: at, end: t.bare ? at : end, text }
  }

  /** A prop this instance does not set yet, written onto it. */
  function propSplices(op) {
    const name = String(op.name ?? '')
    if (!/^[A-Za-z_][\w-]*$/.test(name)) throw new RetouchError('That is not a prop name.')
    const loc = locate(op.stamp)
    if (op.type === 'string' || op.type === 'enum') {
      const v = String(op.value ?? '')
      if (/["\n\r]/.test(v)) throw new RetouchError('That value cannot be written as an attribute.')
      return setAttrSplices(loc.a, loc.el, name, v)
    }
    if (op.type === 'number') {
      const n = Number(op.value)
      if (!Number.isFinite(n)) throw new RetouchError('That is not a number.')
      return setAttrExprSplices(loc.a, loc.el, name, String(n))
    }
    if (op.type === 'boolean') return setAttrExprSplices(loc.a, loc.el, name, op.value === true || op.value === 'true' ? 'true' : 'false')
    throw new RetouchError('Unknown kind of value.')
  }

  async function plan(ops) {
    const splices = []
    const styles = new Map() // element key -> { loc, props }
    const styleFor = (loc) => {
      const key = loc.st.base
      if (!styles.has(key)) styles.set(key, { loc, props: {}, ops: [] })
      return styles.get(key)
    }
    // an HTML element's style attribute gets every edit to it in one splice
    const htmlStyles = new Map()
    const htmlFor = (stamp) => {
      if (!htmlStyles.has(stamp)) {
        const hit = tracer?.resolveHtmlStamp(stamp)
        if (!hit) throw new RetouchError('That element is no longer where it was in its HTML file. Reload the page.', { code: 'stale' })
        htmlStyles.set(stamp, { hit, props: {}, ops: [] })
      }
      return htmlStyles.get(stamp)
    }
    const setStyle = (i, stamp, props) => {
      for (const [k, v] of Object.entries(props)) {
        if (!/^[a-z][a-zA-Z]*$/.test(k)) throw new RetouchError(`"${k}" is not a style property Retouch can write.`)
        if (v != null && !SAFE.style(String(v))) throw new RetouchError(`That value for ${k} cannot be written.`)
      }
      if (isHtml(stamp)) {
        const slot = htmlFor(stamp)
        for (const [k, v] of Object.entries(props)) slot.props[kebab(k)] = v == null ? null : String(v).trim()
        slot.ops.push(i)
      } else {
        const slot = styleFor(locate(stamp))
        for (const [k, v] of Object.entries(props)) slot.props[k] = v == null ? null : quote(String(v).trim())
        slot.ops.push(i)
      }
    }
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      const tag = (list) => list.map((s) => ({ ...s, op: i }))
      try {
        if (op.kind === 'drawing-transform') {
          splices.push(...tag(drawings.plan(op)))
        } else if (op.kind === 'text') {
          const picked = pickCandidate(op, textCandidates(op))
          if (picked.status === 'ambiguous') throw new RetouchError('That text appears in more than one place; pick one first.', { code: 'ambiguous', candidates: picked.candidates })
          if (picked.status !== 'ok') throw new RetouchError('Could not find that text in the source any more.', { code: 'missing' })
          splices.push(...tag([textSplice(picked.candidate, op.insert ?? '')]))
        } else if (op.kind === 'recolor') {
          splices.push(...tag([recolorSplice(op)]))
        } else if (op.kind === 'decl') {
          splices.push(...tag([declSplice(op)]))
        } else if (op.kind === 'literal') {
          splices.push(...tag([literalSplice(op)]))
        } else if (op.kind === 'prop') {
          splices.push(...tag(propSplices(op)))
        } else if (op.kind === 'style') {
          setStyle(i, op.stamp, op.props ?? {})
        } else if (op.kind === 'insert') {
          splices.push(...tag([insertSplice(op)]))
        } else if (isHtml(op.stamp)) {
          if (op.kind === 'delete') {
            const { hit } = htmlFor(op.stamp)
            splices.push(...tag([{ file: hit.file, basis: hit.code, ...removeElementSplice(hit.code, hit.el) }]))
            htmlStyles.delete(op.stamp)
          } else if (op.kind === 'transform') {
            const style = {}
            for (const k of ['translate', 'rotate', 'scale']) {
              if (!(k in (op.style ?? {}))) continue
              const v = op.style[k]
              if (v != null && !SAFE.css(v)) throw new RetouchError('Invalid style value.')
              style[k] = v
            }
            setStyle(i, op.stamp, style)
          } else if (op.kind === 'color') {
            if (!SAFE.color(op.value)) throw new RetouchError('That is not a colour Retouch can write.')
            const prop = ['backgroundColor', 'background', 'color', 'fill', 'stroke', 'borderColor'].includes(op.prop) ? op.prop : 'backgroundColor'
            setStyle(i, op.stamp, prop === 'background' ? { background: op.value.trim(), backgroundColor: null } : { [prop]: op.value.trim() })
          } else throw new RetouchError('Unknown edit.')
        } else if (op.kind === 'delete') {
          const loc = locate(op.stamp)
          if (op.mode === 'entry') {
            const entry = await instanceEntry(project, loc.a, loc.el, loc.instance)
            if (!entry) throw new RetouchError('That list entry could not be found in the source.')
            splices.push(...tag(removeArrayEntrySplices(entry.a, entry.array, entry.index)))
          } else splices.push(...tag(deleteElementSplices(loc.a, loc.el)))
        } else if (op.kind === 'transform') {
          const loc = locate(op.stamp)
          for (const [prop, e] of Object.entries(op.propEdits ?? {})) {
            const delta = e.add != null ? { add: Number(e.add) } : { mul: Number(e.mul) }
            if (!Number.isFinite(delta.add ?? delta.mul)) throw new RetouchError('Invalid number.')
            if ((delta.add != null && Math.abs(delta.add) < 1e-6) || (delta.mul != null && Math.abs(delta.mul - 1) < 1e-6)) continue
            const site = await propSite(project, loc.a, loc.el, prop, loc.instance)
            splices.push(...tag(numericSplices(site, delta, prop)))
          }
          if (op.wrapper) splices.push(...tag(wrapperSplices(loc.a, loc.el, op.wrapper)))
          if (op.style) {
            const slot = styleFor(loc)
            for (const k of ['translate', 'rotate', 'scale']) {
              if (!(k in op.style)) continue
              const v = op.style[k]
              if (v != null && !SAFE.css(v)) throw new RetouchError('Invalid style value.')
              slot.props[k] = v == null ? null : quote(v)
            }
            slot.ops.push(i)
          }
        } else if (op.kind === 'color') {
          const loc = locate(op.stamp)
          if (!SAFE.color(op.value)) throw new RetouchError('That is not a colour Retouch can write.')
          if (op.mode === 'attr') splices.push(...tag(setAttrSplices(loc.a, loc.el, op.attr ?? 'fill', op.value.trim())))
          else {
            const prop = ['backgroundColor', 'background', 'color', 'fill', 'stroke', 'borderColor'].includes(op.prop) ? op.prop : 'backgroundColor'
            const slot = styleFor(loc)
            slot.props[prop] = quote(op.value.trim())
            if (prop === 'background') slot.props.backgroundColor = null
            slot.ops.push(i)
          }
        } else throw new RetouchError('Unknown edit.')
      } catch (e) {
        e.op = i
        throw e
      }
    }
    for (const { loc, props, ops: which } of styles.values()) {
      for (const s of styleSplices(loc.a, loc.el, props)) splices.push({ ...s, op: which[0] })
    }
    for (const { hit, props, ops: which } of htmlStyles.values()) {
      const s = styleAttributeSplice(hit.code, hit.el, props)
      if (s) splices.push({ file: hit.file, basis: hit.code, ...s, op: which[0] })
    }
    return splices
  }

  /**
   * A new element beside the target (`after`) or inside it at the end
   * (`end`): new text, `{ element: { tag, text, sameClass } }`, which takes
   * the target's own class when it is written as plain text; or a copy of
   * another element, `{ copy: stamp }`. HTML goes into HTML and JSX into
   * JSX; a copy never crosses between the two.
   */
  function insertSplice(op) {
    const where = op.where === 'end' ? 'end' : 'after'
    const stale = () => new RetouchError('That element is no longer where it was in its file. Reload the page.', { code: 'stale' })
    if (isHtml(op.stamp)) {
      const hit = tracer?.resolveHtmlStamp(op.stamp)
      if (!hit) throw stale()
      let snippet
      if (op.copy) {
        if (!isHtml(op.copy)) throw new RetouchError('A copy from a component cannot be pasted into an HTML file.', { code: 'place' })
        const from = tracer.resolveHtmlStamp(op.copy)
        if (!from) throw stale()
        snippet = htmlSnippet(from.code, from.el)
      } else {
        const cls = op.element?.sameClass ? (hit.el.attrs.find((x) => x.name.toLowerCase() === 'class')?.value ?? '') : ''
        snippet = { text: newElementMarkup({ ...op.element, className: cls }, { jsx: false }), base: '' }
      }
      return { file: hit.file, basis: hit.code, ...htmlInsertSplice(hit.code, hit.el, snippet.text, where, snippet.base, hit.els) }
    }
    const loc = locate(op.stamp)
    let snippet
    if (op.copy) {
      if (isHtml(op.copy)) throw new RetouchError('A copy from an HTML file cannot be pasted into a component.', { code: 'place' })
      const from = locate(op.copy)
      snippet = jsxSnippet(from.a, from.el, { sameFile: from.a.file === loc.a.file })
    } else {
      const cls = op.element?.sameClass ? writtenClass(loc.a, loc.el) : ''
      snippet = { text: newElementMarkup({ ...op.element, className: cls }, { jsx: true }), base: '' }
    }
    return { a: loc.a, file: loc.a.file, basis: loc.a.code, ...jsxInsertSplice(loc.a, loc.el, snippet.text, where, snippet.base) }
  }

  /** Where some words on the page are written, for the trace: every candidate, nearest first, without editing anything. */
  function findText(req) {
    const at = req.nodeOffset ?? 0
    const list = textCandidates({ ...req, from: at, to: at })
    return list.slice(0, 6).map(candidateInfo)
  }

  return { inspect, resolveText, plan, locate, findText, inspectDrawing: drawings.inspect }
}
