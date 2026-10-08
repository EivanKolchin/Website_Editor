import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { colorDistance, lineAt, lineStarts } from './colors.mjs'
import { findRules, normSelector } from './css.mjs'
import { locateElement } from './html.mjs'
import { originalPosition } from './sourcemap.mjs'
import { cleanId, hash, isUnder, posix, relTo } from './util.mjs'

/**
 * WHERE IS THIS WRITTEN?
 *
 * The client can see a page; only the server can see the project. Every
 * question the trace panel and the colour picker ask comes here as facts
 * the browser knows - a tag and its classes, a rule's selector and the
 * sheet it was in, the URL and line of a stack frame, a colour - and goes
 * back as files and lines. Nothing is guessed silently: when an answer is
 * a match rather than a certainty, it says how good a match it is.
 */
export function createTracer({ project, config, rebuilder, getServer }) {
  const root = project.root
  const rel = (f) => relTo(root, f)
  const lineOf = (code, offset) => {
    const starts = lineStarts(code)
    const l = lineAt(starts, offset)
    return { line: l + 1, col: offset - starts[l] + 1 }
  }

  /** A file reference as the client can show and open it. */
  const ref = (file, code, offset, extra = {}) => ({ file: rel(file), ...lineOf(code, offset), ...extra, generatedBy: generatedBy(rel(file)) })

  function generatedBy(r) {
    const rule = rebuilder?.producerOf(r)
    return rule ? { label: rule.label, from: [].concat(rule.from) } : null
  }

  const htmlFiles = () => project.sourceFiles().filter((f) => /\.html?$/i.test(f))
  const cssFiles = () => project.sourceFiles().filter((f) => /\.(css|pcss|scss|less)$/i.test(f))

  /** The pseudo-stamp an HTML element is edited by: file, offset and a hash of its start tag, so a moved file can be re-read. */
  const htmlStamp = (file, code, el) => `html:${rel(file)}|${el.start}|${hash(code.slice(el.start, el.tagEnd), 6)}`

  /**
   * Page elements that came from an HTML file rather than JSX, found by
   * what the page can tell about each. One best answer per element, or
   * none when two places fit equally well.
   */
  function locateHtml(items) {
    const out = {}
    const files = htmlFiles()
    for (const it of items ?? []) {
      let best = null
      let second = null
      for (const file of files) {
        const { code, value: els } = project.html(file)
        if (!els) continue
        for (const c of locateElement(code, els, it)) {
          const cand = { ...c, file, code }
          if (!best || cand.score > best.score) {
            second = best
            best = cand
          } else if (!second || cand.score > second.score) second = cand
        }
      }
      if (!best || best.score < 1 || (second && second.score === best.score)) {
        out[it.key] = { found: false, ambiguous: !!(best && second && second.score === best.score) }
        continue
      }
      const { el, file, code } = best
      out[it.key] = { found: true, stamp: htmlStamp(file, code, el), tag: el.tag, ...ref(file, code, el.start), score: best.score }
    }
    return out
  }

  /** The element an HTML pseudo-stamp names, in the file as it is now. */
  function resolveHtmlStamp(stamp) {
    const m = /^html:(.+)\|(\d+)\|([0-9a-f]+)$/.exec(stamp ?? '')
    if (!m) return null
    const file = posix(resolve(root, m[1]))
    if (!project.allowed(file)) return null
    const code = project.readFresh(file)
    if (code == null) return null
    const els = project.html(file).value ?? []
    const at = Number(m[2])
    const same = (e) => hash(code.slice(e.start, e.tagEnd), 6) === m[3]
    let el = els.find((e) => e.start === at && same(e))
    if (!el) {
      // the file moved on: the same start tag nearest where it was
      const alike = els.filter(same).sort((x, y) => Math.abs(x.start - at) - Math.abs(y.start - at))
      el = alike[0] ?? null
    }
    return el ? { file, code, el, els } : null
  }

  /** The file a stylesheet on the page was loaded from, by Vite's dev id or its URL. */
  async function sheetFile(sheet) {
    if (!sheet) return null
    const s = cleanId(String(sheet))
    if (isAbsolute(s) && existsSync(s) && isUnder(root, posix(s))) return posix(s)
    return await fileOfUrl(sheet)
  }

  async function fileOfUrl(url) {
    let path
    try {
      path = new URL(url, 'http://localhost').pathname
    } catch {
      return null
    }
    path = decodeURIComponent(path)
    if (path.startsWith('/@fs/')) {
      const f = posix(path.slice(4).replace(/^\/([A-Za-z]:)/, '$1'))
      return existsSync(f) && project.allowed(f) ? f : null
    }
    const mod = await moduleByUrl(url)
    if (mod?.file && project.allowed(mod.file)) return posix(mod.file)
    const server = getServer()
    const pub = server?.config?.publicDir
    if (pub) {
      const f = posix(join(pub, path))
      if (existsSync(f) && project.allowed(f)) return f
    }
    const viteRoot = server?.config?.root ?? root
    const f = posix(join(viteRoot, path))
    return existsSync(f) && project.allowed(f) ? f : null
  }

  async function moduleByUrl(url) {
    const server = getServer()
    if (!server) return null
    let path
    try {
      const u = new URL(url, 'http://localhost')
      path = u.pathname + u.search.replace(/[?&]t=\d+/, '').replace(/^&/, '?')
    } catch {
      return null
    }
    const graph = server.environments?.client?.moduleGraph ?? server.moduleGraph
    try {
      return (await graph.getModuleByUrl(path)) ?? (await graph.getModuleByUrl(path.split('?')[0])) ?? null
    } catch {
      return null
    }
  }

  /**
   * CSS rules from the page's stylesheets, found in source. A rule in a
   * sheet that is itself generated is looked for in the files that
   * generate it, then anywhere in the project's CSS.
   */
  async function rules(list) {
    const out = {}
    for (const r of list ?? []) {
      const found = []
      const own = await sheetFile(r.sheet)
      const ownRel = own ? rel(own) : null
      const generated = own ? project.textExcluded(ownRel) : false
      const look = (file) => {
        const parsed = project.css(file)
        if (!parsed.value) return
        // a keyframe is found by its stop within its @keyframes, "from" and "to" being 0% and 100% to the browser
        const normKey = (s) => String(s).split(',').map((x) => x.trim().toLowerCase().replace(/^from$/, '0%').replace(/^to$/, '100%')).join(',')
        const candidates = r.keyframes
          ? parsed.value.rules.filter((x) => x.keyframes === r.keyframes && normKey(x.selector) === normKey((r.chain ?? [r.selector])[0]))
          : findRules(parsed.value, r.chain ?? [r.selector])
        for (const rule of candidates) {
          if (r.keyframes && rule.keyframes !== r.keyframes) continue
          // every asked-for declaration, the last of each winning as it does in the browser
          const decls = {}
          for (const p of r.props ?? []) {
            const d = [...rule.decls].reverse().find((x) => x.prop === p)
            if (d) decls[p] = { start: d.valueStart, end: d.valueEnd, value: d.value, ...lineOf(parsed.code, d.start) }
          }
          found.push(ref(file, parsed.code, rule.selStart, { selector: rule.selector, at: rule.at, decls }))
        }
      }
      if (own && !generated) look(own)
      if (!found.length) {
        const from = own ? rebuilder?.producerOf(ownRel) : null
        const preferred = from ? project.glob([].concat(from.from)).filter((f) => /\.(css|pcss|scss|less)$/i.test(f)) : []
        for (const f of preferred) look(f)
        if (!found.length) for (const f of cssFiles()) if (f !== own) look(f)
      }
      out[r.key] = { sheet: ownRel, sheetGenerated: generated ? generatedBy(ownRel) ?? { label: 'a generator', from: [] } : null, found: found.slice(0, 4) }
    }
    return out
  }

  function keyframes(names) {
    const out = {}
    const files = cssFiles()
    for (const name of names ?? []) {
      const found = []
      for (const f of files) {
        const parsed = project.css(f)
        for (const k of parsed.value?.keyframes ?? []) if (k.name === name) found.push(ref(f, parsed.code, k.start))
      }
      out[name] = found.slice(0, 4)
    }
    return out
  }

  /** Stack frames from the page, as source lines: through Vite's source maps for modules, as provenance for generated scripts. */
  async function frames(list) {
    const out = {}
    for (const fr of list ?? []) {
      const key = fr.key ?? `${fr.url}:${fr.line}:${fr.col}`
      let res = null
      const mod = await moduleByUrl(fr.url)
      const map = mod?.transformResult?.map
      if (mod?.file && map) {
        const pos = originalPosition(typeof map.toJSON === 'function' ? map.toJSON() : map, fr.line, Math.max(0, fr.col - 1))
        if (pos) {
          let src = pos.source ? cleanId(pos.source) : mod.file
          if (!isAbsolute(src)) src = resolve(dirname(mod.file), src)
          src = posix(src)
          if (existsSync(src) && project.allowed(src)) res = { file: rel(src), line: pos.line, col: pos.column + 1, mapped: true }
        }
      }
      if (!res) {
        const f = await fileOfUrl(fr.url)
        if (f) res = throughOwnMap(f, fr) ?? { file: rel(f), line: fr.line, col: fr.col, mapped: false, generatedBy: generatedBy(rel(f)) }
      }
      if (res?.mapped) res.fn = functionAt(res.file, res.line)
      out[key] = res
    }
    return out
  }

  /** The name of the function a line is written in, read from the file itself: a minified stack only knows short names. */
  function functionAt(fileRel, line) {
    const code = project.read(posix(resolve(root, fileRel)))
    if (!code) return null
    const starts = lineStarts(code)
    const at = starts[Math.min(starts.length - 1, Math.max(0, line - 1))]
    const end = starts[Math.min(starts.length - 1, line)] ?? code.length
    // up to the end of the line itself: a function declared further on is not the one this line is in
    const before = code.slice(Math.max(0, at - 20000), end > at ? end : code.length)
    let name = null
    for (const m of before.matchAll(/function\s+([\w$]+)\s*\(|([\w$]+)\s*[:=]\s*(?:async\s+)?function\b|([\w$]+)\s*=\s*(?:async\s+)?\([^()]*\)\s*=>/g)) name = m[1] ?? m[2] ?? m[3]
    return name
  }

  /**
   * A script that is not a Vite module (one a build step wrote into
   * public/) mapped through its own source map, when it names one: the way a
   * bundled script can still be traced to the files it was built from.
   */
  const ownMaps = new Map()
  function throughOwnMap(file, fr) {
    if (!/\.m?js$/i.test(file)) return null
    const code = project.read(file)
    if (!code) return null
    const m = /\/\/[#@] sourceMappingURL=(\S+)\s*$/.exec(code.slice(-4096))
    if (!m) return null
    const key = `${file}\0${code.length}`
    let map = ownMaps.get(key)
    if (map === undefined) {
      map = null
      try {
        if (m[1].startsWith('data:')) map = JSON.parse(Buffer.from(m[1].split(',')[1], m[1].includes(';base64') ? 'base64' : 'utf8').toString('utf8'))
        else {
          const at = resolve(dirname(file), decodeURIComponent(m[1]))
          if (project.allowed(at) && existsSync(at)) map = JSON.parse(readFileSync(at, 'utf8'))
          if (map) map.__dir = dirname(at)
        }
      } catch {
        map = null
      }
      ownMaps.set(key, map)
      if (ownMaps.size > 20) ownMaps.delete(ownMaps.keys().next().value)
    }
    if (!map) return null
    const pos = originalPosition(map, fr.line, Math.max(0, fr.col - 1))
    if (!pos?.source) return null
    const src = posix(resolve(map.__dir ?? dirname(file), map.sourceRoot ?? '', pos.source))
    if (!existsSync(src) || !project.allowed(src)) return null
    return { file: rel(src), line: pos.line, col: pos.column + 1, mapped: true, via: rel(file) }
  }

  /**
   * Where a colour picked off the page is written. Exact matches first,
   * then near ones (a gradient between two written colours, an opacity
   * over a background) by how close they look; hints from the page - the
   * custom properties that resolve to this colour on that element, the
   * rules that style it, the files its component is written in - lift the
   * likely ones.
   */
  function findColors({ rgb, hints = {} }) {
    const want = { r: +rgb.r, g: +rgb.g, b: +rgb.b, a: rgb.a == null ? 1 : +rgb.a }
    const vars = new Set(hints.vars ?? [])
    const sels = new Set((hints.selectors ?? []).map(normSelector))
    const files = new Set(hints.files ?? [])
    const found = []
    for (const file of project.sourceFiles()) {
      const { value: list } = project.colors(file)
      if (!list) continue
      const r = rel(file)
      for (const c of list) {
        const d = colorDistance(want, c.rgb)
        if (d > (hints.radius ?? 0.09)) continue
        let score = d
        if (c.key && vars.has(c.key)) score -= 0.06
        if (c.selector && sels.has(normSelector(c.selector))) score -= 0.03
        if (files.has(r)) score -= 0.01
        found.push({
          id: `${r}:${c.start}`,
          file: r,
          line: c.line,
          start: c.start,
          end: c.end,
          text: c.text,
          rgb: c.rgb,
          d: Number(d.toFixed(4)),
          exact: d < 0.004,
          score,
          where: c.where,
          prop: c.prop ?? null,
          selector: c.selector ?? null,
          key: c.key ?? null,
          lineText: c.lineText,
          generatedBy: generatedBy(r),
        })
      }
    }
    // A colour the page shows may only be written in a generated file - copied there by a build
    // step from a source Retouch does not read. Where the same text is in a source, that was
    // listed above; where it is not, say where it is and that it cannot be edited there.
    const texts = new Set(found.map((c) => c.text.toLowerCase()))
    for (const file of project.generatedFiles()) {
      const { value: list } = project.colors(file)
      for (const c of list ?? []) {
        const d = colorDistance(want, c.rgb)
        if (d > (hints.radius ?? 0.09) || texts.has(c.text.toLowerCase())) continue
        const r = rel(file)
        found.push({ id: `${r}:${c.start}`, file: r, line: c.line, start: c.start, end: c.end, text: c.text, rgb: c.rgb, d: Number(d.toFixed(4)), exact: d < 0.004, score: d + 0.02 - (c.key && vars.has(c.key) ? 0.06 : 0), where: c.where, prop: c.prop ?? null, selector: c.selector ?? null, key: c.key ?? null, lineText: c.lineText, generatedOnly: true, generatedBy: generatedBy(r) })
      }
    }
    found.sort((x, y) => x.score - y.score || x.d - y.d)
    return found.slice(0, hints.limit ?? 14)
  }

  /** Every file the page's stamps come from, by the id at the front of each stamp: for "everything from Bar.tsx". */
  const fileIds = (sources) => Object.fromEntries([...sources.byPid.entries()].map(([pid, f]) => [pid, f.rel]))

  return { locateHtml, resolveHtmlStamp, rules, keyframes, frames, findColors, generatedBy, sheetFile, fileIds, throughOwnMap }
}
