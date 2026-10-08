import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Open the editor as an app window - no tabs, no address bar - so it reads
 * as a tool rather than as one more browser tab. Any Chromium will do; the
 * default browser is the fallback, where the editor still works in a tab.
 */
export function openWindow(url, { browser = 'auto', width = 1440, height = 920, app = true } = {}) {
  const env = { ...process.env }
  // a compatibility shim some Windows shells set makes Chromium exit at once
  delete env.__COMPAT_LAYER
  if (app) {
    for (const exe of candidates(browser)) {
      if (!exe || !existsSync(exe)) continue
      try {
        spawn(exe, [`--app=${url}`, `--window-size=${width},${height}`, '--new-window'], { detached: true, stdio: 'ignore', env }).unref()
        return exe
      } catch {}
    }
  }
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true, env }).unref()
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore', env }).unref()
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore', env }).unref()
    return 'default browser'
  } catch {
    return null
  }
}

function candidates(pref) {
  const p = process.platform
  const chrome = []
  const edge = []
  if (p === 'win32') {
    const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter(Boolean)
    for (const r of roots) {
      chrome.push(join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'))
      edge.push(join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    }
  } else if (p === 'darwin') {
    chrome.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium')
    edge.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) chrome.push(which(name))
    edge.push(which('microsoft-edge'), which('microsoft-edge-stable'))
  }
  if (pref === 'edge') return [...edge, ...chrome]
  if (pref === 'default') return []
  return [...chrome, ...edge]
}

function which(name) {
  try {
    const r = spawnSync('which', [name], { encoding: 'utf8' })
    return r.status === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}
