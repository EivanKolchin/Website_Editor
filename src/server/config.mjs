import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { posix } from './util.mjs'

export const TOOL_DIR = posix(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'))

/**
 * WHERE A PROJECT'S WIRING LIVES, IN THE ORDER IT IS LOOKED FOR:
 *
 *   1. --config <file>
 *   2. <this tool>/local/config.mjs   - gitignored here, so the tool's own
 *      repo stays generic however many projects it has been wired into
 *   3. <project>/retouch.config.mjs   - when a project would rather track
 *      its wiring in its own history
 *   4. nothing: the project is the folder above this one, and its Vite
 *      config is found by name
 */
export async function loadConfig({ configPath, root: rootArg } = {}) {
  const candidates = [configPath && resolve(configPath), join(TOOL_DIR, 'local', 'config.mjs')]
  const guessRoot = rootArg ? resolve(rootArg) : resolve(TOOL_DIR, '..')
  candidates.push(join(guessRoot, 'retouch.config.mjs'))
  let file = null
  let raw = {}
  for (const c of candidates) {
    if (c && existsSync(c)) {
      file = c
      const mod = await import(pathToFileURL(c).href + `?t=${Date.now()}`)
      raw = (typeof mod.default === 'function' ? await mod.default() : mod.default) ?? {}
      break
    }
  }
  const base = file ? dirname(file) : guessRoot
  const root = posix(resolve(rootArg ? rootArg : raw.root ? resolve(base, raw.root) : guessRoot))
  return { file: file && posix(file), config: normalise(raw, root) }
}

const VITE_NAMES = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'vite.config.cts']

export function normalise(raw, root) {
  const vite = { ...(raw.vite ?? {}) }
  if (vite.configFile === undefined) vite.configFile = VITE_NAMES.find((n) => existsSync(join(root, n))) ?? null
  const pkg = readPkg(root)
  return {
    name: raw.name ?? pkg?.name ?? root.split('/').pop(),
    root,
    vite: { mode: 'development', port: 5199, ...vite },
    open: raw.open ?? '/',
    before: [].concat(raw.before ?? []),
    stamp: {
      include: raw.stamp?.include ?? ['**/*.{jsx,tsx}'],
      exclude: raw.stamp?.exclude ?? [],
      skipComponents: raw.stamp?.skipComponents ?? [],
    },
    text: { include: raw.text?.include ?? [], exclude: raw.text?.exclude ?? [] },
    adapters: raw.adapters ?? [],
    locked: raw.locked ?? [],
    check: raw.check ? (typeof raw.check === 'string' ? { command: raw.check, label: 'check' } : { label: 'check', ...raw.check }) : null,
    textRules: raw.textRules ?? [],
    colorRules: raw.colorRules ?? [],
    colors: { tokens: true, tokensFirst: false, tokenPrefix: '', include: [], arrays: null, ...(raw.colors ?? {}) },
    rebuild: [].concat(raw.rebuild ?? []).filter((r) => r && r.run && r.from).map((r) => ({ ...r, from: [].concat(r.from), outputs: r.outputs ? [].concat(r.outputs) : null })),
    studio: raw.studio ?? true,
    ai: { model: 'claude-opus-5-5', effort: 'high', ...(raw.ai ?? {}) },
    window: { browser: 'auto', app: true, width: 1440, height: 920, ...(raw.window ?? {}) },
    exitOnClose: raw.exitOnClose ?? true,
  }
}

function readPkg(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}
