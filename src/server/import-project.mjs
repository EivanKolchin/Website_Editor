import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadParser, parse, walk } from './ast.mjs'
import { normalise } from './config.mjs'
import { isUnder, posix, RetouchError } from './util.mjs'

const SKIP = new Set(['node_modules', 'retouch', 'dist', 'build', 'out', 'coverage', 'android', 'ios'])
const VITE_CONFIG = /^vite(?:\.[\w-]+)?\.config\.[cm]?[jt]s$/

export function projectFolder(input) {
  if (typeof input !== 'string' || !isAbsolute(input.trim()) || /^https?:/i.test(input)) {
    throw new RetouchError('Choose the local website source folder, using its full path. A website address does not contain editable source code.')
  }
  let root
  try { root = posix(realpathSync(input.trim())) } catch { throw new RetouchError('That folder could not be found. Check the path and try again.') }
  if (!lstatSync(root).isDirectory() || !existsSync(join(root, 'package.json'))) {
    throw new RetouchError('Choose the project folder containing package.json.')
  }
  return root
}

export function readPackage(root) {
  let pkg
  try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) } catch { throw new RetouchError('package.json is not valid JSON.') }
  const require = createRequire(join(root, 'package.json'))
  for (const name of ['react', 'react-dom', 'vite']) {
    let installed
    try { installed = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')) } catch {
      throw new RetouchError(`${name} is not installed in this project. Install its dependencies, then import again.`)
    }
    if (name === 'react' && !/^(18|19)\./.test(installed.version)) throw new RetouchError('Retouch supports Vite with React 18 or 19. This project uses another React version.')
  }
  return pkg
}

/** Only direct Vite scripts are inferred. Shell logic is preserved or refused, never reconstructed. */
export function devWiring(pkg, root, scriptName, { allowBefore = false } = {}) {
  const scripts = pkg.scripts ?? {}
  const direct = Object.keys(scripts).filter((k) => /(?:^|&&\s*)vite(?:\s|$)/.test(scripts[k]))
  const selected = scriptName || (direct.includes('dev') ? 'dev' : direct.length === 1 ? direct[0] : null)
  if (!selected || !direct.includes(selected)) throw new RetouchError(`Choose the website's Vite dev script in Advanced options. Available scripts: ${direct.join(', ') || 'none'}. For custom launchers, supply an existing Retouch config.`)
  const parts = scripts[selected].split(/\s*&&\s*/)
  const run = parts.pop().trim()
  if (!/^vite(?:\s|$)/.test(run) || /[|;&<>`$\n\r]/.test(run)) throw new RetouchError('This dev script uses shell options that need an existing Retouch config.')
  const args = run.match(/"[^"]*"|'[^']*'|\S+/g).slice(1).map((s) => s.replace(/^(['"])(.*)\1$/, '$2'))
  let configFile = null, mode = 'development', viteRoot = '.'
  for (let i = 0; i < args.length; i++) {
    const [flag, value] = args[i].split('=')
    if (flag === '--config' || flag === '-c') configFile = value ?? args[++i]
    else if (flag === '--mode' || flag === '-m') mode = value ?? args[++i]
    else if (['--port', '--host'].includes(flag)) { if (value === undefined && args[i + 1] && !args[i + 1].startsWith('-')) i++ }
    else if (['--open', '--strictPort', '--force'].includes(flag)) continue
    else if (!flag.startsWith('-') && viteRoot === '.') viteRoot = flag
    else throw new RetouchError(`The dev option ${flag} needs an existing Retouch config.`)
  }
  if (viteRoot !== '.') throw new RetouchError('A positional Vite root needs an existing Retouch config so the same page is served.')
  if (!configFile) {
    const configs = readdirSync(root).filter((f) => VITE_CONFIG.test(f))
    if (configs.length > 1) throw new RetouchError('Several Vite configs were found. Choose a dev script that names its config, or supply a Retouch config.')
    configFile = configs[0] ?? null
  }
  if (configFile && (!isUnder(root, resolve(root, configFile)) || !existsSync(resolve(root, configFile)))) throw new RetouchError('The dev script names a Vite config that is missing or outside the project.')
  const before = [...(scripts[`pre${selected}`] ? [scripts[`pre${selected}`]] : []), ...parts]
  if (before.length && !allowBefore) throw new RetouchError('This project runs generators before Vite. Supply a Retouch config with before and rebuild rules so edits reach their original sources. See AGENTS.md, Wiring Retouch into a project.')
  return { configFile, mode, script: selected, before }
}

export function sourceFiles(root) {
  const out = []
  function visit(dir, depth) {
    if (depth > 16) throw new RetouchError('The source tree is too deep to check automatically. Supply a Retouch config with a narrower stamp.include.')
    for (const n of readdirSync(dir)) {
      if (n.startsWith('.') || SKIP.has(n)) continue
      const f = join(dir, n), st = lstatSync(f)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) visit(f, depth + 1)
      else if (/\.(?:[cm]?[jt]sx?|html|css|json|md)$/.test(n)) out.push(posix(f))
      if (out.length > 12000) throw new RetouchError('This project is too large to infer safely. Supply a Retouch config with source globs for this website.')
    }
  }
  visit(root, 0)
  return out
}

/** New configs are intentionally conservative. Complex sites use their explicit, reviewable wiring. */
export async function importConfig(root, pkg, { configPath, script } = {}) {
  const existing = configPath ? resolve(root, configPath) : join(root, 'retouch.config.mjs')
  if (configPath || existsSync(existing)) {
    if (!isUnder(root, existing) && !isAbsolute(configPath ?? '')) throw new RetouchError('The config path must be a full path or relative to the project.')
    if (!existsSync(existing)) throw new RetouchError('The Retouch config could not be found.')
    const module = await import(pathToFileURL(existing).href + `?import=${Date.now()}`)
    const raw = typeof module.default === 'function' ? await module.default() : module.default
    if (!raw || typeof raw !== 'object') throw new RetouchError('The Retouch config must export a config object.')
    if (raw.root && posix(realpathSync(resolve(existing, '..', raw.root))) !== root) throw new RetouchError('This Retouch config points at a different project. Choose that project folder or its correct config.')
    return { file: posix(existing), config: normalise(raw, root), inferred: false }
  }
  const wiring = devWiring(pkg, root, script)
  loadParser(root)
  const files = sourceFiles(root)
  if (['AGENTS.md', 'CLAUDE.md'].some((f) => existsSync(join(root, f)))) throw new RetouchError('This project has written agent or design rules. Supply a Retouch config that maps its copy and colour rules before importing. See AGENTS.md, Wiring Retouch into a project.')
  const jsx = files.filter((f) => /\.[jt]sx$/.test(f))
  if (!jsx.length) throw new RetouchError('No JSX source files were found. Retouch needs a Vite + React website.')
  // Generators, runtime resources and custom renderers require source relationships a generic scan cannot prove.
  const externalText = new Set()
  for (const f of files.filter((f) => /\.[cm]?[jt]sx?$/.test(f))) {
    const code = readFileSync(f, 'utf8')
    if (/dangerouslySetInnerHTML|@react-three\/fiber|writeFile(?:Sync)?\s*\(/.test(code)) {
      throw new RetouchError(`This project has external text, generated output, or custom rendering in ${posix(f).slice(root.length + 1)}. Supply a Retouch config covering text, colours, generators and skipped components before importing.`)
    }
    const ast = parse(code, f)
    walk(ast, (node) => {
      if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'fetch') return
      const arg = node.arguments[0]
      if (arg?.type !== 'StringLiteral' || !/\.(?:json|md|html)(?:[?#]|$)/.test(arg.value) || /^(?:https?:|\/\/)/.test(arg.value)) return
      const rel = arg.value.split(/[?#]/)[0].replace(/^\.\//, '').replace(/^\//, '')
      if (existsSync(join(root, 'public', rel))) externalText.add(`public/${rel}`)
      else if (existsSync(join(root, rel))) externalText.add(rel)
      else throw new RetouchError(`The runtime text file ${arg.value} is missing. Supply a Retouch config that includes its original source.`)
    })
  }
  const checkName = ['typecheck', 'check', 'lint'].find((n) => pkg.scripts?.[n] && !/\b(?:build|vite\s+build)\b/.test(pkg.scripts[n]))
  const pm = existsSync(join(root, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(root, 'yarn.lock')) ? 'yarn' : existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock')) ? 'bun' : 'npm'
  const raw = {
    name: pkg.name,
    root,
    vite: { configFile: wiring.configFile, mode: wiring.mode },
    stamp: { include: ['**/*.{jsx,tsx}'], exclude: ['**/generated/**', '**/*.gen.*', '**/*.test.*', '**/*.spec.*', '**/dist/**', '**/build/**'] },
    text: { include: [...externalText], exclude: ['**/generated/**', '**/*.gen.*', '**/dist/**', '**/build/**'] },
    colors: { tokens: true, tokensFirst: true },
    locked: ['.katex', '.MathJax'],
    ...(checkName ? { check: { command: `${pm} run ${checkName}`, label: checkName, timeoutMs: 60000 } } : {}),
  }
  return { file: null, config: normalise(raw, root), raw, inferred: true }
}

export function validateConfig(config) {
  loadParser(config.root)
  if (config.vite.configFile && !existsSync(resolve(config.root, config.vite.configFile))) throw new RetouchError('The configured Vite file is missing.')
  if (!config.stamp.include?.length) throw new RetouchError('stamp.include must cover the website JSX files.')
  for (const list of [config.stamp.include, config.stamp.exclude, config.stamp.skipComponents, config.text.include, config.text.exclude, config.colors.include, config.locked, config.before]) {
    if (!Array.isArray(list) || !list.every((v) => typeof v === 'string' && v.length > 0)) throw new RetouchError('Source globs, skipped components, locked selectors and preparation commands must be lists of strings.')
  }
  for (const a of config.adapters) {
    if (![].concat(a.component).every((n) => typeof n === 'string' && n.length) || !a.move || !(a.move.x || a.move.y) || !Object.values(a.move).every((p) => typeof p === 'string' && p.length) || (a.size && (!Array.isArray(a.size) || !a.size.every((n) => typeof n === 'string' && n.length)))) throw new RetouchError('An adapter has invalid component, move or size fields.')
    if (a.anchor && a.anchor !== 'props' && (!Array.isArray(a.anchor) || a.anchor.length !== 2 || !a.anchor.every(Number.isFinite))) throw new RetouchError('An adapter anchor must be props or two box fractions.')
  }
  for (const r of config.rebuild) if (!r.outputs?.length) throw new RetouchError('Every rebuild rule must list its outputs to protect generated files during reloads.')
  if (!config.open.startsWith('/') || config.open.startsWith('//')) throw new RetouchError('The opening page must be a path within this website.')
  return config
}
