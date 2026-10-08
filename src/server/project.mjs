import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { analysed } from './ast.mjs'
import { textEntries } from './text.mjs'
import { scanColors } from './colors.mjs'
import { TOOL_DIR } from './config.mjs'
import { htmlElements } from './html.mjs'
import { parseCss } from './css.mjs'
import { cleanId, isUnder, matcher, posix, relTo } from './util.mjs'

const CODE_EXT = /\.(m?[jt]sx?|cts|json)$/i
const SOURCE_EXT = /\.(m?[jt]sx?|cts|json|css|pcss|scss|less|html?)$/i

/** The folders a glob is fixed to before its first wildcard: `site/landing/*.js` walks from site/landing. */
function staticBase(glob) {
  const parts = glob.split('/')
  const fixed = []
  for (const p of parts.slice(0, -1)) {
    if (/[*?{[]/.test(p)) break
    fixed.push(p)
  }
  return fixed.join('/')
}
const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.jsx']

/**
 * The host project as the editor sees it: files on disk, the module graph
 * the dev server built, and Vite's own resolver for imports, so an alias
 * like `@/lib/copy` resolves exactly as the page's own bundle resolved it.
 */
export class Project {
  constructor({ root, sources, config }) {
    this.root = posix(resolve(root))
    this.sources = sources
    this.config = config
    this.server = null
    this.cache = new Map() // file -> { mtime, size, code }
    this.textInclude = matcher(config.text?.include ?? [], config.text?.exclude ?? [])
    this.textExcluded = matcher(config.text?.exclude?.length ? config.text.exclude : ['\0'], [])
    this.extraTextFiles = null
    this.extraColorFiles = null
  }

  attach(server) {
    this.server = server
  }

  allowed(file) {
    const f = posix(resolve(file))
    if (!isUnder(this.root, f)) return false
    // Retouch itself may sit inside the project it edits; its own files are not the project's
    if (isUnder(TOOL_DIR, f)) return false
    const rel = relTo(this.root, f)
    return !/(^|\/)(node_modules|\.git)(\/|$)/.test(rel)
  }

  /** Generated files the page loads (text.exclude): searched only to trace what they were copied from. */
  generatedFiles() {
    const out = new Set()
    const g = this.graph()
    if (g) {
      for (const mod of g.idToModuleMap.values()) {
        const f = mod.file && posix(mod.file)
        if (f && SOURCE_EXT.test(f) && this.allowed(f) && this.textExcluded(relTo(this.root, f))) out.add(f)
      }
    }
    return [...out]
  }

  /**
   * Cached by modification time and size - right for searching, which reads
   * every source file on every text edit. NOT for saving: a file rewritten
   * at the same size within one timestamp tick reads back stale, so
   * anything that writes uses readFresh.
   */
  read(file) {
    const f = posix(resolve(file))
    let st
    try {
      st = statSync(f)
    } catch {
      return null
    }
    const hit = this.cache.get(f)
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.code
    const code = readFileSync(f, 'utf8')
    this.cache.set(f, { mtime: st.mtimeMs, size: st.size, code })
    return code
  }

  readFresh(file) {
    const f = posix(resolve(file))
    try {
      const code = readFileSync(f, 'utf8')
      const st = statSync(f)
      this.cache.set(f, { mtime: st.mtimeMs, size: st.size, code })
      return code
    } catch {
      return null
    }
  }

  analysis(file) {
    const code = this.read(file)
    if (code == null) return null
    try {
      return analysed(code, posix(resolve(file)))
    } catch {
      return null
    }
  }

  async importTarget(fromFile, spec) {
    if (this.server) {
      try {
        const r = await this.server.pluginContainer.resolveId(spec, fromFile)
        if (r?.id && !r.external) {
          const f = cleanId(r.id)
          if (existsSync(f) && this.allowed(f)) return posix(f)
        }
      } catch {}
    }
    if (!spec.startsWith('.')) return null
    const base = resolve(dirname(fromFile), spec)
    for (const ext of RESOLVE_EXT) {
      const f = base + ext
      if (existsSync(f) && statSync(f).isFile() && this.allowed(f)) return posix(f)
    }
    return null
  }

  graph() {
    const s = this.server
    if (!s) return null
    return s.environments?.client?.moduleGraph ?? s.moduleGraph ?? null
  }

  /** Every source file the page is built from, plus the configured text files. */
  textFiles() {
    const files = new Set()
    const g = this.graph()
    if (g) {
      for (const mod of g.idToModuleMap.values()) {
        const f = mod.file && posix(mod.file)
        if (f && CODE_EXT.test(f) && this.allowed(f)) files.add(f)
      }
    }
    for (const pid of this.sources.byPid.keys()) {
      const f = this.sources.file(pid)?.file
      if (f && this.allowed(f)) files.add(f)
    }
    for (const f of this.extraText()) files.add(f)
    // generated files are rewritten by their generator: an edit saved there would not last
    return [...files].filter((f) => !this.textExcluded(relTo(this.root, f)))
  }

  /** Text that lives outside the module graph: markdown, HTML inlined by a build step, JSON fetched at runtime. Listed once per server. */
  extraText() {
    if (!this.extraTextFiles) this.extraTextFiles = this.glob(this.config.text?.include ?? [], this.config.text?.exclude ?? [])
    return this.extraTextFiles
  }

  /**
   * Every file whose colours, styles and text a trace or a colour search
   * reads: the module graph (stylesheets included), the configured text
   * files and the configured colour files. Generated files are left out:
   * they are found through what generates them.
   */
  sourceFiles() {
    const files = new Set()
    const g = this.graph()
    if (g) {
      for (const mod of g.idToModuleMap.values()) {
        const f = mod.file && posix(mod.file)
        if (f && SOURCE_EXT.test(f) && this.allowed(f)) files.add(f)
      }
    }
    for (const pid of this.sources.byPid.keys()) {
      const f = this.sources.file(pid)?.file
      if (f && this.allowed(f)) files.add(f)
    }
    for (const f of this.extraText()) files.add(f)
    if (!this.extraColorFiles) this.extraColorFiles = this.glob(this.config.colors?.include ?? [], this.config.text?.exclude ?? [])
    for (const f of this.extraColorFiles) files.add(f)
    return [...files].filter((f) => !this.textExcluded(relTo(this.root, f)))
  }

  /** Files under the project matching globs, walked only from each glob's fixed leading folders. */
  glob(include, exclude = []) {
    if (!include?.length) return []
    const match = matcher(include, exclude)
    const out = new Set()
    const bases = new Set(include.map(staticBase))
    const walkDir = (dir, depth) => {
      if (depth > 14) return
      let names
      try {
        names = readdirSync(dir)
      } catch {
        return
      }
      for (const n of names) {
        if (n === 'node_modules' || n === '.git' || n.startsWith('.')) continue
        const p = join(dir, n)
        let st
        try {
          st = statSync(p)
        } catch {
          continue
        }
        if (st.isDirectory()) walkDir(p, depth + 1)
        else if (match(relTo(this.root, p))) out.add(posix(p))
      }
    }
    for (const b of bases) walkDir(join(this.root, b), 0)
    return [...out]
  }

  /** Forget the listings made from globs, after files were added. */
  rescan() {
    this.extraTextFiles = null
    this.extraColorFiles = null
  }

  /** Import distance from a set of files, through the module graph, for ranking text candidates. */
  distances(fromFiles, maxDepth = 4) {
    const dist = new Map()
    const g = this.graph()
    let frontier = fromFiles.map((f) => posix(f))
    frontier.forEach((f) => dist.set(f, 0))
    if (!g) return dist
    for (let d = 1; d <= maxDepth && frontier.length; d++) {
      const next = []
      for (const f of frontier) {
        const mods = g.getModulesByFile?.(f) ?? new Set()
        for (const m of mods) {
          for (const imp of m.importedModules ?? []) {
            const file = imp.file && posix(imp.file)
            if (file && !dist.has(file) && this.allowed(file)) {
              dist.set(file, d)
              next.push(file)
            }
          }
        }
      }
      frontier = next
    }
    return dist
  }

  entries(file) {
    const code = this.read(file)
    if (code == null) return { code: null, list: [] }
    try {
      return { code, list: textEntriesCached(code, file) }
    } catch {
      return { code, list: [] }
    }
  }

  /** A file read once per version into whatever `make` builds from it: colours, rules, elements. */
  derived(file, kind, make) {
    const code = this.read(file)
    if (code == null) return { code: null, value: null }
    const key = `${kind}\0${file}`
    const hit = derivedCache.get(key)
    if (hit && hit.code === code) return { code, value: hit.value }
    let value
    try {
      value = make(code, file)
    } catch {
      value = null
    }
    derivedCache.set(key, { code, value })
    if (derivedCache.size > 600) derivedCache.delete(derivedCache.keys().next().value)
    return { code, value }
  }

  colors(file) {
    return this.derived(file, 'colors', (code, f) => scanColors(code, f, { arrays: this.config.colors?.arrays }))
  }

  css(file) {
    return this.derived(file, 'css', (code, f) => (/\.html?$/i.test(f) ? null : parseCss(code)))
  }

  html(file) {
    return this.derived(file, 'html', (code) => htmlElements(code))
  }
}

const derivedCache = new Map()

const entryCache = new Map()
function textEntriesCached(code, file) {
  const key = file + '\0' + code.length
  const hit = entryCache.get(key)
  if (hit && hit.code === code) return hit.list
  const list = textEntries(code, file)
  entryCache.set(key, { code, list })
  if (entryCache.size > 400) entryCache.delete(entryCache.keys().next().value)
  return list
}

export const isCodeFile = (f) => CODE_EXT.test(f) || extname(f) === ''
