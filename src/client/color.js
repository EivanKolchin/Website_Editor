import { COMMON, hexToRgb, hsvToRgb, inkOn, nearest, parseColor, rgbToHex, rgbToHsv } from './palette.js'
import { h, icon } from './ui.js'

/**
 * THE COLOUR PANEL.
 *
 * A hue and saturation wheel with brightness and opacity under it, a hex
 * field, the browser's eyedropper, the page's own colour tokens, and
 * suggestions: as the pointer moves over the wheel, the curated colours
 * nearest to the one under it are listed by name, so a hand-picked colour
 * can be snapped to a considered one. The edit lands on the one element
 * that was selected, never on the class or token it shares with others.
 */
export function createColorPanel({ ui }) {
  const panel = ui.color
  let session = null
  const R = 88

  const tabsEl = h('div', { class: 'tabs' })
  const headEl = h('div', { class: 'chead' })
  const canvas = h('canvas', { width: 176 * 2, height: 176 * 2 })
  const knob = h('div', { class: 'knob' })
  const wheelwrap = h('div', { class: 'wheelwrap' }, canvas, knob)
  const vThumb = h('div', { class: 'thumb' })
  const vSlider = h('div', { class: 'slider', title: 'Brightness' }, vThumb)
  const aThumb = h('div', { class: 'thumb' })
  const aFill = h('div', { style: { position: 'absolute', inset: '0', borderRadius: '6px' } })
  const aSlider = h('div', { class: 'slider checker', title: 'Opacity' }, aFill, aThumb)
  const nowA = h('span')
  const nowB = h('span')
  const swatch = h('div', { class: 'swatch-now checker', title: 'Before | after' }, nowA, nowB)
  const hex = h('input', { class: 'hex', spellcheck: 'false', maxlength: '24', 'aria-label': 'Hex colour' })
  const dropper = h('button', { title: 'Pick a colour from the screen', html: icon('pipette') })
  const warn = h('div', { class: 'warn' })
  const tokensHead = h('h5', {}, h('span', { text: 'This page' }), h('span', { class: 'muted', text: '' }))
  const tokens = h('div', { class: 'grid' })
  const suggHead = h('h5', {}, h('span', { text: 'Suggested' }), h('span', { class: 'mono muted', text: '' }))
  const sugg = h('div', { class: 'sugg' })
  const common = h('div', { class: 'grid' })
  const cancelBtn = h('button', { text: 'Cancel' })
  const applyBtn = h('button', { class: 'primary', text: 'Apply' })
  const tokenSection = h('div', {}, tokensHead, tokens)

  panel.append(
    headEl,
    tabsEl,
    wheelwrap,
    vSlider,
    aSlider,
    h('div', { class: 'hexrow' }, swatch, hex, window.EyeDropper ? dropper : null),
    warn,
    tokenSection,
    suggHead,
    sugg,
    h('h5', {}, h('span', { text: 'Common' })),
    common,
    h('div', { class: 'foot' }, cancelBtn, applyBtn),
  )
  panel.style.maxHeight = 'calc(100vh - 70px)'
  panel.style.overflow = 'auto'

  for (const c of COMMON) {
    common.append(h('button', { class: 'sw', title: c, style: { background: c }, onclick: () => choose({ rgb: hexToRgb(c), token: null }) }))
  }

  /* ---- state ---- */
  let hsv = { h: 0, s: 0, v: 1 }
  let alpha = 1
  let token = null
  let drawnV = -1

  const valueString = () => (token ? `var(${token})` : rgbToHex({ ...hsvToRgb(hsv.h, hsv.s, hsv.v), a: alpha }))
  const currentRgb = () => ({ ...hsvToRgb(hsv.h, hsv.s, hsv.v), a: alpha })

  function drawWheel() {
    if (drawnV === hsv.v) return
    drawnV = hsv.v
    const ctx = canvas.getContext('2d')
    const size = canvas.width
    const img = ctx.createImageData(size, size)
    const c = size / 2
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - c + 0.5
        const dy = y - c + 0.5
        const r = Math.hypot(dx, dy) / c
        const i = (y * size + x) * 4
        if (r > 1) {
          img.data[i + 3] = 0
          continue
        }
        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
        const rgb = hsvToRgb(hue, r, hsv.v)
        img.data[i] = rgb.r
        img.data[i + 1] = rgb.g
        img.data[i + 2] = rgb.b
        img.data[i + 3] = r > 1 - 1.5 / c ? Math.round(255 * ((1 - r) * c) / 1.5) : 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }

  function paint() {
    drawWheel()
    const a = (hsv.h * Math.PI) / 180
    knob.style.left = `${R + Math.cos(a) * hsv.s * R}px`
    knob.style.top = `${R + Math.sin(a) * hsv.s * R}px`
    const rgb = currentRgb()
    knob.style.background = rgbToHex({ ...rgb, a: 1 })
    const full = rgbToHex(hsvToRgb(hsv.h, hsv.s, 1))
    vSlider.style.background = `linear-gradient(90deg, #000, ${full})`
    vThumb.style.left = `${hsv.v * 100}%`
    aFill.style.background = `linear-gradient(90deg, transparent, ${rgbToHex({ ...rgb, a: 1 })})`
    aThumb.style.left = `${alpha * 100}%`
    nowB.style.background = token ? `var(${token})` : rgbToHex(rgb)
    if (document.activeElement !== ui.host || ui.shadow.activeElement !== hex) hex.value = token ? `var(${token})` : rgbToHex(rgb)
  }

  // Six buttons made once and relabelled in place. Rebuilding them on every
  // hover would swap the element under a pointer between its press and its
  // release, and a click needs both on the same element.
  const suggButtons = Array.from({ length: 6 }, () => {
    const chip = h('span', { class: 'chip' })
    const name = h('span')
    const code = h('span', { class: 'src mono' })
    const b = h('button', { onclick: () => b.dataset.hex && choose({ rgb: hexToRgb(b.dataset.hex), token: null }) }, chip, name, code)
    b._parts = { chip, name, code }
    sugg.append(b)
    return b
  })
  function showSuggestions(rgb, label) {
    suggHead.lastChild.textContent = label ?? rgbToHex(rgb)
    nearest(rgb, 6).forEach((c, i) => {
      const b = suggButtons[i]
      b.dataset.hex = c.hex
      b.title = `${c.source} ${c.name} ${c.hex}`
      b._parts.chip.style.background = c.hex
      b._parts.name.textContent = `${c.source} ${c.name}`
      b._parts.code.textContent = c.hex
    })
  }

  let warnTimer = null
  function checkWarnings() {
    clearTimeout(warnTimer)
    warnTimer = setTimeout(async () => {
      if (!session) return
      const list = (await session.warnings?.(valueString()).catch(() => [])) ?? []
      warn.textContent = list.join(' ')
      warn.style.display = list.length ? 'block' : 'none'
    }, 220)
  }

  /** Set the colour from anywhere: the wheel, a swatch, the hex field, the eyedropper. */
  function choose({ rgb, token: t = null }, { preview = true, keepHex = false } = {}) {
    token = t
    const x = rgbToHsv(rgb)
    hsv = { h: x.s === 0 ? hsv.h : x.h, s: x.s, v: x.v }
    alpha = rgb.a ?? 1
    if (keepHex) {
      const saved = hex.value
      paint()
      hex.value = saved
    } else paint()
    if (!session) return
    if (preview) session.preview(session.tab, valueString())
    session.dirty = true
    showSuggestions(currentRgb())
    checkWarnings()
  }

  /* ---- wheel ---- */
  const hsAt = (e) => {
    const r = canvas.getBoundingClientRect()
    const dx = e.clientX - r.left - r.width / 2
    const dy = e.clientY - r.top - r.height / 2
    return { h: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, s: Math.min(1, Math.hypot(dx, dy) / (r.width / 2)) }
  }
  let dragging = false
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true
    canvas.setPointerCapture(e.pointerId)
    const p = hsAt(e)
    choose({ rgb: { ...hsvToRgb(p.h, p.s, hsv.v === 0 ? 1 : hsv.v), a: alpha } })
  })
  canvas.addEventListener('pointermove', (e) => {
    const p = hsAt(e)
    if (dragging) choose({ rgb: { ...hsvToRgb(p.h, p.s, hsv.v), a: alpha } })
    else {
      // hovering: suggest what is near the colour under the pointer, without applying it
      const rgb = hsvToRgb(p.h, p.s, hsv.v)
      showSuggestions(rgb, `near ${rgbToHex(rgb)}`)
    }
  })
  canvas.addEventListener('pointerup', () => (dragging = false))
  canvas.addEventListener('pointerleave', () => {
    if (!dragging && session) showSuggestions(currentRgb())
  })

  const slider = (el, set) => {
    const at = (e) => {
      const r = el.getBoundingClientRect()
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    }
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId)
      set(at(e))
      const move = (ev) => set(at(ev))
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
    })
  }
  slider(vSlider, (v) => choose({ rgb: { ...hsvToRgb(hsv.h, hsv.s, v), a: alpha } }))
  slider(aSlider, (a) => choose({ rgb: { ...hsvToRgb(hsv.h, hsv.s, hsv.v), a } }))

  hex.addEventListener('input', () => {
    const v = hex.value.trim()
    const tok = /^var\((--[\w-]+)\)$/.exec(v)
    if (tok) {
      const rgb = parseColor(getComputedStyle(document.documentElement).getPropertyValue(tok[1]).trim())
      if (rgb) choose({ rgb, token: tok[1] }, { keepHex: true })
      return
    }
    const rgb = /^#?[0-9a-f]{3,8}$/i.test(v) && [3, 4, 6, 8].includes(v.replace('#', '').length) ? hexToRgb(v.startsWith('#') ? v : '#' + v) : parseColor(v)
    if (rgb) choose({ rgb }, { keepHex: true })
  })
  hex.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') apply()
    if (e.key === 'Escape') cancel()
  })
  dropper.addEventListener('click', async () => {
    try {
      const r = await new window.EyeDropper().open()
      choose({ rgb: hexToRgb(r.sRGBHex) })
    } catch {}
  })

  /* ---- page tokens ---- */
  function pageTokens() {
    const names = new Set()
    const visit = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules && !rule.selectorText) {
          try {
            visit(rule.cssRules)
          } catch {}
          continue
        }
        if (!rule.style || !/(:root|^html\b|\bbody\b|\[data-theme)/.test(rule.selectorText ?? '')) continue
        for (const p of rule.style) if (p.startsWith('--')) names.add(p)
      }
    }
    for (const sheet of document.styleSheets) {
      try {
        visit(sheet.cssRules)
      } catch {}
    }
    const cs = getComputedStyle(document.documentElement)
    const out = []
    for (const name of names) {
      const raw = cs.getPropertyValue(name).trim()
      if (!raw || /^(\d|var\()/.test(raw) && !/^#/.test(raw)) continue
      const rgb = parseColor(raw)
      if (rgb && rgb.a > 0.02) out.push({ name, rgb })
      if (out.length >= 60) break
    }
    return out
  }

  function open(opts) {
    close(false)
    session = { ...opts, tab: opts.tabs[0].id, dirty: false }
    tabsEl.replaceChildren(
      ...opts.tabs.map((t) =>
        h('button', {
          text: t.label,
          title: t.title ?? t.label,
          'data-tab': t.id,
          class: t.id === session.tab ? 'on' : '',
          onclick: () => switchTab(t.id),
        }),
      ),
    )
    // what is being changed, when it is not obvious from the selection: a colour where it is written
    headEl.replaceChildren(...(opts.header ? [].concat(opts.header) : []))
    headEl.style.display = opts.header ? 'block' : 'none'
    const list = opts.tokens === false ? [] : pageTokens()
    tokens.replaceChildren(
      ...list.map((t) =>
        h('button', {
          class: 'sw',
          title: `${t.name}  ${rgbToHex(t.rgb)}`,
          style: { background: `var(${t.name})`, color: inkOn(t.rgb) },
          onclick: () => choose({ rgb: t.rgb, token: t.name }),
        }),
      ),
    )
    tokensHead.lastChild.textContent = list.length ? `${list.length} tokens` : ''
    tokenSection.style.display = list.length ? 'block' : 'none'
    // a project with a token system wants its own colours first; otherwise
    // they follow the suggestions and the common picks
    panel.insertBefore(tokenSection, opts.tokensFirst ? suggHead : panel.querySelector('.foot'))
    loadTab()
    panel.style.display = 'block'
    placeNear(opts.rect, opts.avoid)
  }

  function loadTab() {
    const init = session.initial(session.tab)
    session.was = init.value
    nowA.style.background = init.value || 'transparent'
    token = null
    const x = rgbToHsv(init.rgb ?? { r: 255, g: 255, b: 255 })
    hsv = { h: x.h, s: x.s, v: x.v }
    alpha = init.rgb?.a ?? 1
    drawnV = -1
    paint()
    showSuggestions(currentRgb())
    warn.style.display = 'none'
    for (const b of tabsEl.children) b.classList.toggle('on', b.dataset.tab === session.tab)
    // opened with a colour already chosen (one picked off the page): show it at once, as an edit
    if (init.start) choose({ rgb: init.rgb })
  }

  function switchTab(id) {
    if (!session || id === session.tab) return
    if (session.dirty) session.commit(session.tab, valueString())
    session.dirty = false
    session.tab = id
    loadTab()
  }

  /** Beside the selection, inside the viewport, and clear of the toolbar's band. */
  function placeNear(rect, avoid) {
    const w = 284
    const room = window.innerWidth - (rect?.right ?? 0)
    const left = rect && room > w + 24 ? rect.right + 14 : rect && rect.left > w + 24 ? rect.left - w - 14 : window.innerWidth - w - 14
    panel.style.left = `${Math.max(10, left)}px`
    const barOnTop = avoid && avoid.top < window.innerHeight / 2
    const minTop = barOnTop ? avoid.bottom + 8 : 10
    const maxBottom = avoid && !barOnTop ? avoid.top - 8 : window.innerHeight - 10
    panel.style.maxHeight = `${Math.max(240, maxBottom - minTop)}px`
    const top = Math.max(minTop, Math.min((rect?.top ?? minTop) - 10, maxBottom - panel.offsetHeight))
    panel.style.top = `${top}px`
  }

  function apply() {
    if (!session) return
    const s = session
    session = null
    panel.style.display = 'none'
    if (s.dirty) s.commit(s.tab, valueString())
    else s.cancel?.()
  }

  function cancel() {
    if (!session) return
    const s = session
    session = null
    panel.style.display = 'none'
    s.cancel?.()
  }

  function close(commit = true) {
    if (commit) apply()
    else cancel()
  }

  cancelBtn.addEventListener('click', cancel)
  applyBtn.addEventListener('click', apply)

  return { open, close, apply, cancel, get isOpen() { return !!session } }
}
