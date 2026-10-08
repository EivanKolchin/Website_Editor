import { spawn } from 'node:child_process'

/**
 * The project's own gate, run after every save. Retouch never decides
 * whether an edit is acceptable for a project - the project does, with the
 * command it already trusts - and the result is shown on the toolbar
 * without blocking anything: a failing gate is information, and the undo
 * button is right there.
 */
export function createChecker({ config, send }) {
  if (!config.check?.command) return { run() {}, last: null }
  let child = null
  let queued = false
  let timer = null
  const state = { last: null }

  function start() {
    queued = false
    const began = Date.now()
    send({ status: 'running', label: config.check.label })
    let out = ''
    child = spawn(config.check.command, { cwd: config.root, shell: true, env: { ...process.env, FORCE_COLOR: '0' } })
    const take = (d) => {
      out += d.toString()
      if (out.length > 64000) out = out.slice(-32000)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    const kill = setTimeout(() => child?.kill(), (config.check.timeoutMs ?? 180000))
    child.on('close', (code) => {
      clearTimeout(kill)
      child = null
      state.last = { status: code === 0 ? 'passed' : 'failed', label: config.check.label, output: out.trim().slice(-6000), ms: Date.now() - began, exit: code }
      send(state.last)
      if (queued) start()
    })
    child.on('error', (e) => {
      state.last = { status: 'failed', label: config.check.label, output: e.message, ms: 0 }
      send(state.last)
    })
  }

  return {
    run() {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (child) queued = true
        else start()
      }, 400)
    },
    get last() {
      return state.last
    },
  }
}
