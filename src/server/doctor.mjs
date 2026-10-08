import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadParser } from './ast.mjs'
import { loadConfig, TOOL_DIR } from './config.mjs'
import { importVite } from './start.mjs'

/** Say what Retouch would do here, and what is missing, without starting a server. */
export async function doctor(opts) {
  const { file, config } = await loadConfig(opts)
  const line = (k, v) => console.log(`  ${k.padEnd(14)} ${v}`)
  console.log('Retouch doctor')
  line('tool', TOOL_DIR)
  line('project', config.root)
  line('config', file ?? '(none - defaults)')
  line('vite config', config.vite.configFile ?? '(none found)')
  try {
    const vite = await importVite(config.root)
    line('vite', vite.version ?? 'found')
  } catch (e) {
    line('vite', 'MISSING - ' + e.message)
  }
  try {
    loadParser(config.root)
    line('parser', 'ok')
  } catch (e) {
    line('parser', 'MISSING - ' + e.message)
  }
  line('before', config.before.length ? config.before.join(' && ') : '(nothing)')
  line('stamps', config.stamp.include.join(', ') + (config.stamp.exclude.length ? `  minus ${config.stamp.exclude.join(', ')}` : ''))
  line('extra text', config.text.include.length ? config.text.include.join(', ') : '(module graph only)')
  line('extra colours', config.colors.include.length ? config.colors.include.join(', ') + (config.colors.arrays ? `  (+ ${config.colors.arrays} arrays)` : '') : '(module graph only)')
  line('rebuild', config.rebuild.length ? config.rebuild.map((r) => `${r.label ?? r.run} <- ${r.from.join(', ')}`).join('; ') : '(nothing)')
  line('opens', config.studio ? 'the studio (--page for the page alone)' : 'the page')
  line('adapters', config.adapters.length ? config.adapters.map((a) => [].concat(a.component).join('/')).join(', ') : '(built-in SVG only)')
  line('check', config.check?.command ?? '(none)')
  line('text rules', String(config.textRules.length))
  line('colour rules', String(config.colorRules.length))
  line('AI mapping', existsSync(join(TOOL_DIR, 'node_modules', '@anthropic-ai', 'sdk')) ? 'SDK installed' : 'SDK not installed (optional)')
}
