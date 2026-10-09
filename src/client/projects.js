import { h, icon } from './ui.js'

const CSS = `
.file-button { font-weight: 650; padding: 0 10px; }
.file-button:focus-visible, .file-menu button:focus-visible, .project-dialog button:focus-visible { outline: 2px solid var(--acc); outline-offset: 3px; }
.file-menu { position: fixed; top: 45px; left: 10px; width: 290px; max-width: calc(100vw - 20px); padding: 6px; z-index: 40; border: 1px solid var(--line); border-radius: 12px; background: var(--panel-2); box-shadow: 0 16px 50px #0008; }
.file-menu[hidden] { display: none; }
.file-menu button { display: flex; width: 100%; height: 36px; justify-content: flex-start; padding: 0 10px; border-radius: 6px; }
.file-menu button small { margin-left: auto; color: var(--mut); font-size: 10px; }
.file-menu .file-caption { color: var(--mut); font-size: 10px; padding: 10px 10px 5px; }
.file-menu .recent-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.file-menu hr { border: 0; border-top: 1px solid var(--line); margin: 5px; }
.project-dialog { width: 560px; max-width: calc(100vw - 32px); max-height: calc(100dvh - 40px); padding: 0; overflow: auto; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 20px; box-shadow: 0 24px 100px #0009; }
.project-dialog::backdrop { background: var(--scrim); backdrop-filter: blur(8px); }
.project-dialog:focus { outline: none; }
.project-dialog .project-inner { padding: 30px 32px; }
.project-dialog .project-eyebrow { display: flex; align-items: center; gap: 8px; color: var(--acc-ink); font-size: 10px; font-weight: 700; letter-spacing: .11em; text-transform: uppercase; margin-bottom: 20px; }
.project-dialog h2 { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 27px; font-weight: 620; line-height: 1.15; letter-spacing: -.035em; margin: 0 0 10px; }
.project-dialog p { color: var(--mut); font-size: 13px; line-height: 1.65; margin: 0 0 24px; }
.project-dialog label { display: block; font-size: 12px; margin-bottom: 8px; }
.project-dialog .folder-field { display: flex; gap: 8px; }
.project-dialog input { width: 100%; height: 40px; border-radius: 9px; background: var(--field); }
.project-dialog .folder-field button { height: 40px; padding: 0 12px; border: 1px solid var(--line); }
.project-dialog details { margin-top: 18px; }
.project-dialog summary { cursor: pointer; color: var(--mut); font-size: 12px; }
.project-dialog details label { margin-top: 16px; }
.project-dialog .project-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 26px; }
.project-dialog .project-actions button { height: 36px; padding: 0 14px; }
.project-dialog .project-error { color: var(--danger); font-size: 12px; line-height: 1.55; margin-top: 16px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow: auto; }
.project-dialog .project-path { color: var(--faint); font: 11px/1.6 ui-monospace, Consolas, monospace; overflow-wrap: anywhere; margin-bottom: 25px; }
.project-dialog .progress-caption { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; font-size: 12px; margin-bottom: 10px; }
.project-dialog .progress-caption output { color: var(--acc-ink); font: 12px ui-monospace, Consolas, monospace; }
.project-dialog .project-track { height: 6px; background: var(--line); border-radius: 8px; overflow: hidden; }
.project-dialog .project-fill { height: 100%; width: 0; background: var(--acc); border-radius: inherit; transition: width .35s ease; }
.project-dialog .project-track.complete .project-fill { background: var(--success); }
.project-dialog .project-steps { list-style: none; margin: 24px 0 0; padding: 0; display: grid; gap: 16px; }
.project-dialog .project-steps li { display: grid; grid-template-columns: 22px 1fr; gap: 10px; align-items: start; color: var(--faint); font-size: 12px; }
.project-dialog .project-step-mark { width: 18px; height: 18px; border: 1px solid var(--line-strong); border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.project-dialog li.running { color: var(--ink); }
.project-dialog li.running .project-step-mark { border: 2px solid var(--acc-soft); border-top-color: var(--acc); animation: project-spin 1s linear infinite; }
.project-dialog li.passed { color: var(--ink); }
.project-dialog li.passed .project-step-mark { border-color: var(--success); color: var(--success); background: var(--success-soft); }
.project-dialog li.failed { color: var(--danger); }
.project-dialog li.failed .project-step-mark { border-color: var(--danger); color: var(--danger); }
.project-dialog .project-step-detail { color: var(--mut); font-size: 11px; line-height: 1.6; margin-top: 4px; overflow-wrap: anywhere; }
.project-dialog .project-notes { color: var(--mut); font-size: 12px; line-height: 1.65; padding-left: 18px; }
.project-dialog .project-info { font-size: 12px; line-height: 1.8; color: var(--mut); white-space: pre-wrap; overflow-wrap: anywhere; }
.project-dialog { width: 640px; }
.project-dialog [hidden] { display: none !important; }
.project-dialog .setup-paths { display: grid; grid-template-columns: 1fr 1fr 1fr; padding: 4px; gap: 4px; background: var(--field); border: 1px solid var(--line); border-radius: 11px; margin: 24px 0 18px; }
.project-dialog .setup-paths button { height: 36px; color: var(--mut); font-size: 12px; white-space: nowrap; }
.project-dialog .setup-paths button[aria-pressed=true] { color: var(--acc-ink); background: var(--acc-soft); box-shadow: 0 1px 4px #0004; }
.project-dialog .setup-pane[hidden] { display: none; }
.project-dialog .setup-pane p { margin: 0 0 16px; font-size: 12px; }
.project-dialog .setup-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
.project-dialog select { width: 100%; height: 40px; padding: 0 10px; background: var(--field); color: var(--ink); border: 1px solid var(--line); border-radius: 9px; font: inherit; }
.project-dialog .key-label { display: flex; justify-content: space-between; align-items: center; }
.project-dialog a { color: var(--acc-ink); font-size: 11px; text-decoration: none; }
.project-dialog a:hover { text-decoration: underline; }
.project-dialog .key-field { display: flex; position: relative; }
.project-dialog .key-field input { padding-right: 62px; }
.project-dialog .key-field button { position: absolute; right: 6px; top: 4px; height: 32px; padding: 0 10px; font-size: 11px; color: var(--mut); }
.project-dialog .setup-footnote { font-size: 11px; color: var(--mut); line-height: 1.65; margin-top: 12px; }
.project-dialog .setup-prompt { width: 100%; height: 146px; min-height: 90px; padding: 14px; resize: vertical; border: 1px solid var(--line); border-radius: 10px; background: var(--field); color: var(--mut); font: 11px/1.65 ui-monospace,Consolas,monospace; }
.project-dialog .prompt-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; color: var(--mut); font-size: 11px; }
.project-dialog .prompt-actions button { border: 1px solid var(--line-strong); padding: 7px 12px; color: var(--acc-ink); }
.project-dialog .provider-plan { display: flex; align-items: center; gap: 8px; margin-top: 12px; color: var(--mut); }
.project-dialog .provider-plan input { width: 14px; height: 14px; }
.project-dialog .project-activity { margin-top: 24px; padding: 14px 16px; background: var(--field); border: 1px solid var(--line); border-radius: 10px; }
.project-dialog .project-activity strong { display: block; font-size: 11px; color: var(--acc-ink); margin-bottom: 8px; font-weight: 550; }
.project-dialog .project-activity ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 5px; font: 11px/1.65 ui-monospace,Consolas,monospace; color: var(--mut); overflow-wrap: anywhere; }
.project-dialog .project-activity li:last-child { color: var(--ink); }
@keyframes project-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .project-dialog .project-fill { transition: none; } .project-dialog li.running .project-step-mark { animation: none; border-color: var(--acc); } }
@media (max-width: 600px) { .project-dialog .project-inner { padding: 24px; } }
`

export function createProjectMenu({ getCtl, getPage }) {
  const boot = window.__RETOUCH_STUDIO__
  document.head.append(h('style', { text: CSS }))
  const button = h('button', { class: 'file-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'File: projects and saving' }, 'File', h('span', { html: icon('chevron', 11) }))
  const menu = h('div', { class: 'file-menu', role: 'menu', 'aria-label': 'File', hidden: true })
  const dialog = h('dialog', { class: 'project-dialog', 'aria-labelledby': 'project-title' })
  document.body.append(menu, dialog)
  let job = null, polling = false, verifying = false, lastInput = null, revision = ''
  let previousFocus = null, setupData = null
  async function api(route, body) {
    if (!boot?.token) throw new Error('Reload Retouch to enable project importing.')
    const res = await fetch(boot.api + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'x-retouch-token': boot.token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(route === '/projects/pick' ? 125000 : 20000) })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.error || 'Retouch could not complete this request.')
    return data
  }
  function closeMenu({ focus = false } = {}) { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); if (focus) button.focus() }
  function openDialog() { closeMenu(); previousFocus = document.activeElement; if (!dialog.open) dialog.showModal() }
  function closeDialog() { const key = dialog.querySelector('#setup-key'); if (key) key.value = ''; dialog.close(); previousFocus?.focus() }
  function title(text) { return h('h2', { id: 'project-title', text }) }
  const eyebrow = () => h('div', { class: 'project-eyebrow' }, h('span', { html: icon('code', 14) }), 'Retouch / Projects')
  async function showMenu() {
    if (!menu.hidden) return closeMenu({ focus: true })
    menu.replaceChildren()
    const row = (label, action, key = '') => h('button', { role: 'menuitem', onclick: () => { closeMenu(); action() } }, h('span', { text: label }), key ? h('small', { text: key }) : null)
    const ctl = getCtl()
    const save = row('Save changes', () => getCtl()?.save(), 'Ctrl S')
    save.disabled = !ctl || ctl.saving() || !ctl.pending().length
    menu.append(row('Import project…', () => showImport(), 'Ctrl O'), save, row('Reload page', () => getCtl()?.reloadInPlace()), h('hr'), row('Project details', showDetails), h('div', { class: 'file-caption', text: 'Recent projects' }))
    menu.hidden = false
    button.setAttribute('aria-expanded', 'true')
    const rect = button.getBoundingClientRect()
    menu.style.left = `${Math.max(10, Math.min(innerWidth - 300, rect.left))}px`
    menu.querySelector('button').focus()
    try {
      const { projects } = await api('/projects')
      if (menu.hidden) return
      if (!projects.length) menu.append(h('div', { class: 'file-caption', text: 'Imported projects will appear here.' }))
      for (const p of projects) menu.append(h('button', { role: 'menuitem', title: p.root, onclick: () => { closeMenu(); showImport(p) } }, h('span', { html: icon('code', 14) }), h('span', { class: 'recent-name', text: p.name || p.root })))
    } catch (e) { menu.append(h('div', { class: 'file-caption', text: e.message })) }
  }
  async function showDetails() {
    openDialog()
    const info = h('div', { class: 'project-info', text: 'Reading project details…' })
    dialog.replaceChildren(h('div', { class: 'project-inner' }, eyebrow(), title(boot?.name || 'Current project'), info, h('div', { class: 'project-actions' }, h('button', { text: 'Done', onclick: closeDialog }))))
    try {
      const c = await api('/config')
      info.textContent = `${c.root}\n\nAdapters: ${c.adapters.map((a) => [].concat(a.component).join(', ')).join('; ') || 'Built-in SVG and transform wrappers'}\nGenerators: ${c.rebuild.map((r) => r.label).join(', ') || 'None'}\nProject check: ${c.check?.label || 'Not configured'}`
    } catch (e) { info.textContent = e.message }
  }
  function showImport(prefill = {}) {
    job = null; revision = ''; verifying = false
    openDialog()
    let mode = prefill.configPath ? 'existing' : prefill.mode || 'api', promptRevision = 0
    const folder = h('input', { id: 'project-folder', required: true, autocomplete: 'off', spellcheck: 'false', placeholder: 'Full path to your website folder', value: prefill.root || '' })
    const config = h('input', { id: 'project-config', autocomplete: 'off', placeholder: 'Auto-detect retouch.config.mjs', value: prefill.configPath || '' })
    const script = h('input', { id: 'project-script', autocomplete: 'off', placeholder: 'Auto-detect dev', value: prefill.script || '' })
    const error = h('div', { class: 'project-error', role: 'alert' })
    const browse = h('button', { type: 'button', text: 'Browse…', onclick: async () => {
      browse.disabled = true
      try { const r = await api('/projects/pick', {}); if (r.root) { folder.value = r.root; await refreshPrompt() } } catch (e) { error.textContent = e.message } finally { browse.disabled = false; folder.focus() }
    } })
    const submit = h('button', { type: 'submit', class: 'primary' })
    const provider = h('select', { id: 'setup-provider', 'aria-label': 'LLM provider' })
    const model = h('input', { id: 'setup-model', autocomplete: 'off', spellcheck: 'false', placeholder: 'Provider model ID' })
    const apiKey = h('input', { id: 'setup-key', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'Paste your provider API key' })
    const keyLink = h('a', { target: '_blank', rel: 'noopener noreferrer', text: 'Get an API key ↗' })
    const reveal = h('button', { type: 'button', text: 'Show', 'aria-label': 'Show API key', onclick: () => {
      const show = apiKey.type === 'password'; apiKey.type = show ? 'text' : 'password'; reveal.textContent = show ? 'Hide' : 'Show'; reveal.setAttribute('aria-label', show ? 'Hide API key' : 'Show API key')
    } })
    const codingPlan = h('input', { type: 'checkbox', id: 'setup-coding-plan' })
    const plan = h('label', { class: 'provider-plan', for: 'setup-coding-plan', hidden: true }, codingPlan, 'Use my Z.ai Coding Plan API endpoint')
    const apiPane = h('div', { class: 'setup-pane' }, h('p', { text: 'Your chosen LLM reads the project, connects its source files, and prepares a config. Retouch then tests the result.' }), h('div', { class: 'setup-fields' }, h('div', {}, h('label', { for: 'setup-provider', text: 'Provider' }), provider), h('div', {}, h('label', { for: 'setup-model', text: 'Model' }), model)), h('div', { class: 'key-label' }, h('label', { for: 'setup-key', text: 'API key' }), keyLink), h('div', { class: 'key-field' }, apiKey, reveal), plan, h('div', { class: 'setup-footnote', text: 'Project source is sent to this provider. The key is used only for this run and is never saved. Your provider’s API charges apply.' }))
    const prompt = h('textarea', { class: 'setup-prompt', readonly: true, 'aria-label': 'Coding agent setup prompt', spellcheck: 'false' })
    const copy = h('button', { type: 'button', text: 'Copy setup prompt', onclick: async () => {
      try {
        await refreshPrompt()
        if (!prompt.value) return
        try { await navigator.clipboard.writeText(prompt.value) } catch { prompt.select(); if (!document.execCommand('copy')) throw new Error('Select the prompt and copy it with Ctrl+C.') }
        copy.textContent = 'Copied'; setTimeout(() => { if (copy.isConnected) copy.textContent = 'Copy setup prompt' }, 2000)
      } catch (e) { error.textContent = e.message }
    } })
    const agentPane = h('div', { class: 'setup-pane' }, h('p', { text: 'Give your coding agent access to the website repo and the Retouch repo, then paste this prompt. It follows Retouch’s wiring documentation and includes the checks to run.' }), prompt, h('div', { class: 'prompt-actions' }, h('span', { text: 'Both repo paths are included' }), copy), h('div', { class: 'setup-footnote', text: 'Once your agent has written retouch.config.mjs, return here and choose Verify and open.' }))
    const existingPane = h('div', { class: 'setup-pane' }, h('p', { text: 'Retouch finds retouch.config.mjs in the website folder, or reuses its saved wiring. Simple projects can also be connected without an API key.' }))
    const advanced = h('details', {}, h('summary', { text: 'Config and dev script options' }), h('label', { for: 'project-config', text: 'Retouch config path' }), config, h('label', { for: 'project-script', text: 'Website dev script' }), script)
    const paths = h('div', { class: 'setup-paths', role: 'group', 'aria-label': 'How to connect your website' })
    const tabs = [['api', 'Use an API key'], ['agent', 'Coding agent'], ['existing', 'Existing config']].map(([id, text]) => {
      const tab = h('button', { type: 'button', text, onclick: () => setMode(id) }); paths.append(tab); return { id, tab }
    })
    function setMode(next) {
      mode = next; error.textContent = ''
      tabs.forEach(({ id, tab }) => tab.setAttribute('aria-pressed', String(id === mode)))
      apiPane.hidden = mode !== 'api'; agentPane.hidden = mode !== 'agent'; existingPane.hidden = mode !== 'existing'; config.disabled = mode === 'api'
      apiKey.required = mode === 'api'; model.required = mode === 'api'; provider.required = mode === 'api'
      submit.textContent = mode === 'api' ? 'Wire and open' : mode === 'agent' ? 'Verify and open' : 'Import project'
      submit.disabled = mode === 'api' && !setupData
      if (mode !== 'api') { apiKey.value = ''; apiKey.type = 'password'; reveal.textContent = 'Show' }
      if (mode === 'agent') refreshPrompt().catch(() => {})
    }
    async function refreshPrompt() {
      if (mode !== 'agent') return
      const revision = ++promptRevision
      copy.disabled = true
      try { const r = await api('/projects/prompt', { root: folder.value.trim() }); if (revision === promptRevision) prompt.value = r.prompt }
      catch (e) { error.textContent = e.message; throw e }
      finally { if (revision === promptRevision) copy.disabled = false }
    }
    folder.addEventListener('change', () => { refreshPrompt()?.catch(() => {}) })
    function updateProvider() {
      const p = setupData?.providers.find((p) => p.id === provider.value)
      if (!p) return
      model.value = p.model; keyLink.href = p.keyUrl; plan.hidden = p.id !== 'zai'; codingPlan.checked = false
    }
    provider.addEventListener('change', updateProvider)
    const loadProviders = () => {
      provider.replaceChildren(...setupData.providers.map((p) => h('option', { value: p.id, text: p.name })))
      provider.value = prefill.provider || setupData.providers[0].id; updateProvider(); setMode(mode)
    }
    if (setupData) loadProviders()
    else api('/projects/setup').then((data) => { setupData = data; if (form.isConnected) loadProviders() }).catch((e) => { error.textContent = e.message })
    const form = h('form', { class: 'project-inner', onsubmit: async (e) => {
      e.preventDefault(); error.textContent = ''; submit.disabled = true
      try {
        const ctl = getCtl()
        if (ctl) {
          // Its Save/Discard prompt lives in the page frame; a modal here
          // would make that frame inert and leave the prompt unreachable.
          dialog.close()
          const leave = await ctl.readyToLeave()
          dialog.showModal()
          if (!leave) return
        }
        lastInput = { root: folder.value.trim(), configPath: mode === 'api' ? undefined : config.value.trim() || undefined, script: script.value.trim() || undefined, mode, provider: provider.value }
        const request = { root: lastInput.root, configPath: lastInput.configPath, script: lastInput.script, ...(mode === 'api' ? { wiring: { provider: provider.value, model: model.value.trim(), apiKey: apiKey.value.trim(), codingPlan: codingPlan.checked } } : {}) }
        apiKey.value = ''
        let r
        try { r = await api('/projects/import', request) } finally { if (request.wiring) request.wiring.apiKey = '' }
        job = r.job; revision = ''; renderJob(); poll()
      } catch (e) { error.textContent = e.message } finally { submit.disabled = false }
    } }, eyebrow(), title(boot?.welcome ? 'Connect your first website' : 'Connect a new website'), h('p', { text: 'Start with the website’s source folder. Choose how to wire it in, and we’ll test the wiring before you edit.' }), h('label', { for: 'project-folder', text: 'Website source folder' }), h('div', { class: 'folder-field' }, folder, browse), paths, apiPane, agentPane, existingPane, advanced, error, h('div', { class: 'project-actions' }, h('button', { type: 'button', text: boot?.welcome ? 'Set up later' : 'Cancel', onclick: () => { apiKey.value = ''; closeDialog() } }), submit))
    dialog.replaceChildren(form)
    setMode(mode)
    folder.focus()
  }
  function renderJob() {
    if (!job) return
    const key = JSON.stringify(job)
    if (key === revision) return
    revision = key
    const focusText = dialog.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON' ? document.activeElement.textContent : null
    const scroll = dialog.scrollTop
    const passed = job.state === 'passed', failed = job.state === 'failed', cancelled = job.state === 'cancelled'
    const progress = h('div', { class: `project-track${passed ? ' complete' : ''}`, role: 'progressbar', 'aria-label': 'Project import', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': job.progress }, h('div', { class: 'project-fill', style: { width: `${job.progress}%` } }))
    const list = h('ol', { class: 'project-steps' }, ...job.steps.map((s) => h('li', { class: s.status }, h('span', { class: 'project-step-mark', html: s.status === 'passed' ? icon('check', 11) : s.status === 'failed' ? icon('x', 10) : '' }), h('div', {}, h('span', { text: s.label }), s.detail && ['running', 'failed', 'passed'].includes(s.status) ? h('div', { class: 'project-step-detail', text: s.detail }) : null))))
    const actions = h('div', { class: 'project-actions' })
    if (passed) actions.append(h('button', { class: 'primary', text: 'Open project', onclick: () => { const u = new URL(location.href); u.searchParams.delete('importJob'); history.replaceState(null, '', u); closeDialog() } }))
    else if (failed || cancelled) {
      if (job.returnUrl && new URL(job.returnUrl).origin !== location.origin) actions.append(h('button', { text: 'Back to previous project', onclick: () => leaveJob(job.returnUrl) }))
      actions.append(h('button', { class: 'primary', text: 'Try again', onclick: () => showImport(lastInput || { root: job.root }) }))
    } else actions.append(h('button', { text: 'Cancel import', onclick: () => cancelJob() }))
    const notes = job.notes?.length ? h('details', {}, h('summary', { text: `${job.notes.length} project note${job.notes.length === 1 ? '' : 's'}` }), h('ul', { class: 'project-notes' }, ...job.notes.map((n) => h('li', { text: n })))) : null
    const activity = job.activity?.length ? h('div', { class: 'project-activity', role: 'log', 'aria-label': 'Wiring activity' }, h('strong', { text: job.activity.find((a) => a.kind === 'provider')?.detail || 'Wiring activity' }), h('ul', {}, ...job.activity.filter((a) => a.kind !== 'provider').slice(-5).map((a) => h('li', { text: a.detail })))) : null
    dialog.replaceChildren(h('div', { class: 'project-inner' }, eyebrow(), title(passed ? 'Your project is ready' : failed ? 'Import needs attention' : cancelled ? 'Import cancelled' : `Opening ${job.name || 'your project'}`), h('div', { class: 'project-path', text: job.root }), h('div', { class: 'progress-caption', 'aria-live': 'polite' }, h('span', { text: passed ? 'Wiring checks passed' : failed ? 'Resolve the issue below, then retry' : cancelled ? 'The import was stopped' : job.steps.find((s) => s.status === 'running')?.label || 'Preparing project' }), h('output', { text: `${job.progress}%` })), progress, list, activity, job.error ? h('div', { class: 'project-error', role: 'alert', text: job.error }) : null, notes, actions))
    if (focusText) [...dialog.querySelectorAll('button')].find((b) => b.textContent === focusText)?.focus({ preventScroll: true })
    dialog.scrollTop = scroll
  }
  async function leaveJob(url) {
    try { await api('/projects/cancel', { id: job.id }) } catch {}
    location.href = url
  }
  async function cancelJob() {
    if (!job) return closeDialog()
    const back = job.returnUrl
    try { await api('/projects/cancel', { id: job.id }) } catch {}
    if (back && new URL(back).origin !== location.origin) location.href = back
    else closeDialog()
  }
  async function poll() {
    if (polling) return
    polling = true
    try {
      while (job && !['passed', 'failed', 'cancelled'].includes(job.state)) {
        const r = await api('/projects/status', { id: job.id })
        job = r.job; renderJob()
        if (job.state === 'awaiting-browser') {
          if (new URL(job.url).origin !== location.origin || new URLSearchParams(location.search).get('importJob') !== job.id) {
            location.href = job.url
            return
          }
          if (!verifying) { verifying = true; await verifyBrowser() }
        }
        if (!['passed', 'failed', 'cancelled'].includes(job.state)) await new Promise((r) => setTimeout(r, 600))
      }
    } catch (e) {
      if (job) { job.state = 'failed'; job.error = `Connection interrupted: ${e.message}`; renderJob() }
    } finally { polling = false }
  }
  async function verifyBrowser() {
    let body
    try {
      const began = Date.now()
      let win, els
      while (Date.now() - began < 45000) {
        win = getPage()
        const overlay = win?.document.querySelector('vite-error-overlay')
        if (overlay) throw new Error(overlay.shadowRoot?.textContent?.trim().slice(0, 1800) || 'Vite could not compile this page.')
        els = [...(win?.document.querySelectorAll('[data-rt]') ?? [])]
        if (win?.__RETOUCH__?.app && els.length) break
        await new Promise((r) => setTimeout(r, 200))
      }
      if (!win?.__RETOUCH__?.app || !els?.length) throw new Error('The page did not render editable React elements. Check the opening route, dependencies and browser console.')
      // Wait for initial module requests and React effects before testing their stamps.
      await new Promise((r) => setTimeout(r, 800))
      const errors = win.__RETOUCH__.importErrors ?? []
      if (errors.length) throw new Error(`The website reported an error while loading:\n${errors.join('\n')}`)
      body = { id: job.id, ...(await win.__RETOUCH__.app.importProbe()) }
    } catch (e) { body = { id: job.id, error: e.message } }
    const r = await api('/projects/verify', body)
    job = r.job; renderJob()
  }
  button.addEventListener('click', showMenu)
  document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target) && !button.contains(e.target)) closeMenu() })
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu({ focus: true }) }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      const rows = [...menu.querySelectorAll('button:not(:disabled)')], at = rows.indexOf(document.activeElement)
      rows[e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus()
    }
  })
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); job && !['passed', 'failed', 'cancelled'].includes(job.state) ? cancelJob() : closeDialog() })
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); e.stopPropagation(); if (!dialog.open) showImport() }
  }, true)
  const resume = new URLSearchParams(location.search).get('importJob')
  if (resume) {
    openDialog()
    dialog.replaceChildren(h('div', { class: 'project-inner' }, eyebrow(), title('Verifying your project…')))
    api('/projects/status', { id: resume }).then((r) => { job = r.job; renderJob(); poll() }).catch((e) => { dialog.replaceChildren(h('div', { class: 'project-inner' }, title('Import needs attention'), h('p', { text: e.message }), h('button', { text: 'Close', onclick: closeDialog }))) })
  }
  return { button, isOpen: () => dialog.open || !menu.hidden, closeMenu, importProject: (prefill = {}) => { if (!dialog.open) showImport(prefill) } }
}
