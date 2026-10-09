#!/usr/bin/env node
/**
 * retouch [start]   open the editor on the project's dev server (default)
 * retouch map       optional: let an AI model explore the project and write
 *                   local/config.mjs (needs @anthropic-ai/sdk + an API key)
 * retouch doctor    print what Retouch found, without starting anything
 *
 *   --root <dir>     the project (default: the folder this tool sits in)
 *   --config <file>  a config file (default: local/config.mjs, then
 *                    <project>/retouch.config.mjs)
 *   --port <n>       dev server port (default 5199, next free one if taken)
 *   --path </page>   which page to open first
 *   --no-open        do not open a window (and do not stop when it closes)
 *   --page           open the page full size, without the studio's panels
 *   --skip-before    do not run the config's `before` commands (their output is current)
 */
const args = process.argv.slice(2)
const flags = {}
const rest = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--no-open') flags.noOpen = true
  else if (a === '--page') flags.page = true
  else if (a === '--skip-before') flags.skipBefore = true
  else if (a === '--yes' || a === '-y') flags.yes = true
  else if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=')
    flags[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v ?? args[++i]
  } else rest.push(a)
}
const command = rest[0] ?? 'start'
const opts = { root: flags.root, configPath: flags.config, port: flags.port, path: flags.path, noOpen: !!flags.noOpen, page: !!flags.page, skipBefore: !!flags.skipBefore }

try {
  if (command === 'start' || command === 'setup') {
    const { start } = await import('../src/server/start.mjs')
    await start({ ...opts, setup: command === 'setup' })
  } else if (command === 'map') {
    const { map } = await import('../src/ai/map.mjs')
    await map({ ...opts, model: flags.model, effort: flags.effort, yes: !!flags.yes })
  } else if (command === 'doctor') {
    const { doctor } = await import('../src/server/doctor.mjs')
    await doctor(opts)
  } else {
    console.log('usage: retouch [start|setup|map|doctor] [--root dir] [--config file] [--port n] [--path /page] [--no-open] [--page]')
    process.exit(command === 'help' || command === '--help' ? 0 : 1)
  }
} catch (e) {
  console.error('[retouch]', e.message)
  process.exit(1)
}
