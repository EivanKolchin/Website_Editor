import { h, icon } from './ui.js'
import { createProjectMenu } from './projects.js'
import { THEME_CSS } from './theme.js'

document.head.append(h('style', { text: `
${THEME_CSS}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--bg);color:var(--ink);font:13px/1.5 'Segoe UI',system-ui,sans-serif}
body{min-height:100dvh;background:var(--bg);display:grid;place-items:center;padding:32px}
button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer;border:0;border-radius:7px;background:transparent;display:inline-flex;align-items:center;justify-content:center;gap:8px}button:hover{background:#ffffff0b}button:disabled{opacity:.5;cursor:default}button.primary{background:var(--acc);color:var(--on-acc);font-weight:650}button.primary:hover{background:var(--acc-hover)}input,select,textarea{border:1px solid var(--line);padding:0 12px;outline:none}input:focus,select:focus,textarea:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
.welcome{max-width:600px;text-align:center}.welcome-brand{display:inline-flex;gap:12px;align-items:center;font-size:28px;font-weight:650;letter-spacing:-.04em}.welcome h1{font-size:40px;line-height:1.1;letter-spacing:-.045em;font-weight:600;margin:35px 0 18px}.welcome p{color:var(--mut);line-height:1.7;font-size:15px;margin:0 auto 28px;max-width:450px}.welcome button{padding:12px 20px}.welcome small{display:block;color:var(--faint);margin-top:25px}.welcome-recent{display:grid;gap:6px;margin-top:22px;text-align:left}.welcome-recent button{border:1px solid var(--line);padding:12px 16px;justify-content:space-between}.welcome-recent span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.welcome-recent small{margin:0;font-size:11px}
` }))
const projects = createProjectMenu({ getCtl: () => null, getPage: () => null })
// An open stream keeps setup alive even when its browser window is minimised.
fetch('/__retouch/setup/events', { headers: { 'x-retouch-token': window.__RETOUCH_STUDIO__.token } }).then(async (res) => {
  if (!res.ok) return
  const reader = res.body.getReader()
  while (!(await reader.read()).done) {}
}).catch(() => {})
const recent = h('div', { class: 'welcome-recent' })
document.body.append(h('main', { class: 'welcome' }, h('div', { class: 'welcome-brand' }, h('span', { html: icon('layers', 28) }), 'Retouch'), h('h1', { text: 'Your website.\nYour workspace.' }), h('p', { text: 'Connect a website, bring its source into focus, and make every edit where it belongs.' }), h('button', { class: 'primary', text: 'Connect a website', onclick: projects.importProject }), recent, h('small', { text: 'Local Vite + React projects · Source files stay yours' })))
fetch('/__retouch/projects', { headers: { 'x-retouch-token': window.__RETOUCH_STUDIO__.token } }).then((r) => r.json()).then((r) => {
  for (const p of r.projects ?? []) recent.append(h('button', { title: p.root, onclick: () => projects.importProject(p) }, h('span', { text: p.name }), h('small', { text: 'Open recent →' })))
}).catch(() => {})
projects.importProject({ root: window.__RETOUCH_STUDIO__.root || '' })
