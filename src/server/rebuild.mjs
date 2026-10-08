import { spawn } from 'node:child_process'
import { matcher } from './util.mjs'

/**
 * GENERATORS, RUN AFTER A SAVE.
 *
 * Some of what a page shows is built by a script from files the dev server
 * never imports: markup kept in an .html file and inlined into a module,
 * scenes concatenated into one script. A save into those files changes
 * nothing on the page until the script runs again, so a `rebuild` rule
 * names the files that feed a generator and the command that runs it:
 *
 *   { from: ['site/landing/**'], run: 'node scripts/site-landing.mjs', outputs: ['site/generated/landing.*'] }
 *
 * Its outputs are NOT hot-reloaded while it runs. The edit is already on
 * the page - it was previewed there before it was saved - and swapping a
 * module under it would only throw away what the page has built since:
 * markup set as a string is replaced wholesale, and any script that had
 * hold of the old elements is left holding nothing. The next reload picks
 * the new output up. The same rules tell the tracer what an output is
 * built from (see trace.mjs).
 */
export function createRebuilder({ config }) {
  const rules = (config.rebuild ?? []).map((r) => ({
    ...r,
    label: r.label ?? r.run,
    feeds: matcher(r.from, []),
    makes: matcher(r.outputs?.length ? r.outputs : config.text?.exclude ?? [], []),
  }))
  let quietUntil = 0
  let quietRules = []
  const QUIET_AFTER_MS = 2000

  function run(cmd) {
    return new Promise((done) => {
      let out = ''
      const child = spawn(cmd, { cwd: config.root, shell: true, env: { ...process.env, FORCE_COLOR: '0', RETOUCH: '1' } })
      const take = (d) => {
        out += d.toString()
        if (out.length > 32000) out = out.slice(-16000)
      }
      child.stdout.on('data', take)
      child.stderr.on('data', take)
      const kill = setTimeout(() => child.kill(), config.rebuildTimeoutMs ?? 120000)
      child.on('close', (code) => {
        clearTimeout(kill)
        done({ ok: code === 0, output: out.trim().slice(-4000) })
      })
      child.on('error', (e) => {
        clearTimeout(kill)
        done({ ok: false, output: e.message })
      })
    })
  }

  return {
    rules,
    /** The rules a set of root-relative paths feed. */
    affected: (rels) => rules.filter((r) => rels.some((rel) => r.feeds(rel))),
    /** Run every generator these saved files feed, in config order. */
    async after(rels) {
      const todo = rules.filter((r) => rels.some((rel) => r.feeds(rel)))
      const results = []
      for (const r of todo) {
        quietRules = [...new Set([...quietRules, r])]
        quietUntil = Infinity
        const res = await run(r.run)
        results.push({ label: r.label, ...res })
        quietUntil = Date.now() + QUIET_AFTER_MS
      }
      if (!todo.length) return results
      setTimeout(() => {
        if (Date.now() >= quietUntil) quietRules = []
      }, QUIET_AFTER_MS + 50)
      return results
    },
    /** Should a change to this file reach the page by hot reload? Not while its generator is writing it. */
    quiet(rel) {
      return Date.now() < quietUntil && quietRules.some((r) => r.makes(rel))
    },
    /** The rule that builds a file, for tracing a generated file back to what it is made from. */
    producerOf(rel) {
      return rules.find((r) => r.makes(rel)) ?? null
    },
  }
}
