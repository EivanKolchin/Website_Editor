import { colorDistance, parseColor } from './palette.js'

/**
 * WHAT THE BROWSER KNOWS ABOUT AN ELEMENT, gathered for the trace.
 *
 * The browser can say which rules apply to an element, which of them wins
 * each property, what is animating it and - by listening for a moment -
 * which script is moving it. It cannot say which file any of that is
 * written in; that is the server's half (src/server/trace.mjs). Everything
 * here is read-only, apart from the brief listening, which puts every hook
 * back exactly as it found it.
 */

const SHEET_SKIP = /^html\[data-retouch-/

/** An id for the sheet a rule came from: Vite's dev id when it has one (the file itself), else its URL. */
export function sheetId(sheet) {
  const node = sheet?.ownerNode
  return node?.getAttribute?.('data-vite-dev-id') || sheet?.href || null
}

/** A selector as browsers serialise it (the same rule as the server's normSelector in css.mjs), so two spellings compare equal. */
export function normSelector(s) {
  return String(s ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*([>+~,])\s*/g, '$1')
    .replace(/'/g, '"')
    .replace(/\[\s*([\w-]+)\s*([~|^$*]?=)\s*([^"\]\s]+)\s*\]/g, '[$1$2"$3"]')
    .replace(/(^|[^:]):(before|after|first-line|first-letter)\b/g, '$1::$2')
}

/** Split a selector list at its top-level commas. */
export function splitList(sel) {
  const out = []
  let depth = 0
  let cur = ''
  for (const c of sel) {
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    if (c === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** A nested rule's selector, made absolute: `&:hover` inside `.a` is `:is(.a):hover`. */
function resolveNested(chain) {
  let sel = chain[0]
  for (const s of chain.slice(1)) {
    sel = splitList(s)
      .map((part) => (part.includes('&') ? part.replace(/&/g, `:is(${sel})`) : `:is(${sel}) ${part}`))
      .join(', ')
  }
  return sel
}

/** Specificity as one comparable number (ids, then classes, then types), close enough to rank rules the way the browser does. */
export function specificity(sel) {
  let s = sel.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')
  s = s.replace(/:(?:is|not|has|matches)\(((?:[^()]|\([^()]*\))*)\)/g, (_, inner) => {
    // these count as their most specific argument
    const best = splitList(inner).sort((a, b) => specificity(b) - specificity(a))[0] ?? ''
    return ' ' + best + ' '
  })
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []).length
  const types = (s.replace(/\[[^\]]*\]/g, '').match(/(?:^|[\s>+~(])([a-z][\w-]*)|::[\w-]+/gi) ?? []).length
  return ids * 10000 + classes * 100 + types
}

/**
 * Every style rule on the page that applies to `el`, in cascade order:
 *   [{ rule, chain, selector, sheet, order, media, spec, props }]
 * Rules in sheets that cannot be read (another origin) are skipped.
 */
export function matchedRules(el) {
  const out = []
  let order = 0
  const visit = (rules, sheet, chain, media) => {
    for (const rule of rules) {
      order++
      if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
        if (SHEET_SKIP.test(rule.selectorText)) continue
        const own = [...chain, rule.selectorText]
        const resolved = own.length > 1 ? resolveNested(own) : rule.selectorText
        let best = -1
        for (const part of splitList(resolved)) {
          if (part.includes('::')) continue
          try {
            if (el.matches(part)) best = Math.max(best, specificity(part))
          } catch {}
        }
        if (best >= 0) out.push({ rule, chain: own, selector: rule.selectorText, sheet, order, media, spec: best, props: [...rule.style] })
        if (rule.cssRules?.length) visit(rule.cssRules, sheet, own, media)
      } else if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
        if (matchMedia(rule.media.mediaText).matches) visit(rule.cssRules, sheet, chain, [...media, `@media ${rule.media.mediaText}`])
      } else if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) visit(rule.cssRules, sheet, chain, [...media, `@supports ${rule.conditionText}`])
      } else if (rule.cssRules && !(typeof CSSKeyframesRule !== 'undefined' && rule instanceof CSSKeyframesRule)) {
        visit(rule.cssRules, sheet, chain, media)
      }
    }
  }
  for (const sheet of document.styleSheets) {
    let rules
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    visit(rules, sheetId(sheet), [], [])
  }
  return out
}

const STATE_RE = /:(active|hover|focus-visible|focus-within|focus)(?![\w-])/g
const HAS_STATE = /:(active|hover|focus-visible|focus-within|focus)(?![\w-])/
const STATE_NAME = { active: 'pressed', hover: 'hover', 'focus-visible': 'focus', 'focus-within': 'focus', focus: 'focus' }

/**
 * The rules that style an element in a STATE it is not in now: pressed
 * (:active), hovered and focused. Found by taking the state out of each
 * selector and asking whether what is left matches - so `.key:active`
 * and `.card:hover .title` both count, the second as "when the card is
 * hovered". Same shape as matchedRules, so they are found in their files
 * and edited the same way.
 */
export function stateRules(el) {
  const out = []
  let order = 0
  const visit = (rules, sheet, chain, media) => {
    for (const rule of rules) {
      order++
      if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
        if (SHEET_SKIP.test(rule.selectorText)) continue
        const own = [...chain, rule.selectorText]
        const resolved = own.length > 1 ? resolveNested(own) : rule.selectorText
        for (const part of splitList(resolved)) {
          if (part.includes('::') || !HAS_STATE.test(part)) continue
          const states = [...new Set([...part.matchAll(STATE_RE)].map((m) => STATE_NAME[m[1]]))]
          const plain = part.replace(STATE_RE, '').trim() || '*'
          try {
            if (!el.matches(plain)) continue
          } catch {
            continue
          }
          // the state is the element's own when it is in the last part of the selector; otherwise something it is in
          const last = part.trim().split(/\s*[>+~]\s*|\s+/).pop() ?? ''
          out.push({ rule, chain: own, selector: rule.selectorText, sheet, order, media, spec: specificity(plain), props: [...rule.style], states, onAncestor: !HAS_STATE.test(last) })
          break
        }
        if (rule.cssRules?.length) visit(rule.cssRules, sheet, own, media)
      } else if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
        if (matchMedia(rule.media.mediaText).matches) visit(rule.cssRules, sheet, chain, [...media, `@media ${rule.media.mediaText}`])
      } else if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) visit(rule.cssRules, sheet, chain, [...media, `@supports ${rule.conditionText}`])
      } else if (rule.cssRules && !(typeof CSSKeyframesRule !== 'undefined' && rule instanceof CSSKeyframesRule)) {
        visit(rule.cssRules, sheet, chain, media)
      }
    }
  }
  for (const sheet of document.styleSheets) {
    let rules
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    visit(rules, sheetId(sheet), [], [])
  }
  return out
}

// properties a child takes from its parent when nothing sets them on it
const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-indent', 'white-space', 'visibility', 'cursor', 'fill', 'stroke', 'direction'])
// a longhand set through its shorthand is written under the shorthand's name
export const SHORTHAND = {
  'margin-top': 'margin', 'margin-right': 'margin', 'margin-bottom': 'margin', 'margin-left': 'margin',
  'padding-top': 'padding', 'padding-right': 'padding', 'padding-bottom': 'padding', 'padding-left': 'padding',
  'background-color': 'background', 'font-size': 'font', 'font-weight': 'font', 'font-family': 'font', 'line-height': 'font',
  'border-top-left-radius': 'border-radius', 'border-top-right-radius': 'border-radius', 'border-bottom-left-radius': 'border-radius', 'border-bottom-right-radius': 'border-radius',
  'border-top-width': 'border-width', 'border-top-color': 'border-color', 'border-top-style': 'border-style',
  'row-gap': 'gap', 'column-gap': 'gap',
}

/**
 * Where the value of `prop` on `el` comes from: its inline style, the
 * winning rule (by !important, then specificity, then order), its parent
 * for inherited properties, or nothing (the browser's default).
 */
export function winner(el, prop, matched = matchedRules(el)) {
  const inline = el.style?.getPropertyValue(prop)
  const cands = matched
    .filter((m) => m.rule.style.getPropertyValue(prop) !== '')
    .map((m) => ({ m, important: m.rule.style.getPropertyPriority(prop) === 'important' }))
    .sort((x, y) => Number(y.important) - Number(x.important) || y.m.spec - x.m.spec || y.m.order - x.m.order)
  const top = cands[0]
  if (inline && !(top?.important && el.style.getPropertyPriority(prop) !== 'important')) return { kind: 'inline', value: inline }
  if (top) {
    const declared = top.m.props.includes(prop) ? prop : SHORTHAND[prop] && top.m.props.some((p) => p === SHORTHAND[prop] || p.startsWith(SHORTHAND[prop] + '-')) ? SHORTHAND[prop] : prop
    return { kind: 'rule', value: top.m.rule.style.getPropertyValue(prop), important: top.important, match: top.m, declared }
  }
  if (INHERITED.has(prop) && el.parentElement && el.parentElement !== document.documentElement) {
    const up = winner(el.parentElement, prop)
    return up.kind === 'default' ? up : { ...up, inherited: true, from: up.from ?? el.parentElement }
  }
  return { kind: 'default' }
}

/* ------------------------------------------------------------------ */
/*  motion                                                             */
/* ------------------------------------------------------------------ */

/** Everything animating an element, as the Web Animations API sees it. */
export function animationsOf(el, subtree = false) {
  let list = []
  try {
    list = el.getAnimations({ subtree })
  } catch {
    return []
  }
  return list.map((anim) => {
    const kind = typeof CSSAnimation !== 'undefined' && anim instanceof CSSAnimation ? 'css' : typeof CSSTransition !== 'undefined' && anim instanceof CSSTransition ? 'transition' : 'script'
    let props = []
    try {
      props = [...new Set((anim.effect?.getKeyframes?.() ?? []).flatMap((k) => Object.keys(k).filter((x) => !['offset', 'computedOffset', 'easing', 'composite'].includes(x))))]
    } catch {}
    const timing = anim.effect?.getComputedTiming?.() ?? {}
    return {
      anim,
      kind,
      name: kind === 'css' ? anim.animationName : kind === 'transition' ? anim.transitionProperty : anim.id || props.join(', ') || 'animation',
      props,
      target: anim.effect?.target ?? null,
      duration: Number.isFinite(timing.duration) ? timing.duration : 0,
      iterations: timing.iterations,
      delay: timing.delay ?? 0,
    }
  })
}

/** The first frame of a stack that belongs to the project rather than to Retouch, Vite or a library. */
export function frameOf(stack, toolDir) {
  let library = null
  const tool = toolDir ? encodeURI(toolDir.replace(/^\//, '')).toLowerCase() : null
  for (const line of String(stack ?? '').split('\n').slice(1)) {
    const m = /\(?((?:https?):\/\/[^\s()]+?):(\d+):(\d+)\)?\s*$/.exec(line)
    if (!m) continue
    const url = m[1]
    const low = url.toLowerCase()
    if ((tool && low.includes(tool)) || low.includes('/@vite/') || low.includes('/__retouch')) continue
    if (low.includes('/node_modules/')) {
      library ??= /\/node_modules\/(?:\.[^/]+\/deps\/)?((?:@[^/]+\/)?[^/?]+?)(?:\.m?js)?(?:[?/]|$)/.exec(url)?.[1] ?? 'a library'
      continue
    }
    if (new URL(url).origin !== location.origin) continue
    return { url, line: Number(m[2]), col: Number(m[3]), library }
  }
  return library ? { library } : null
}

const WATCHED = ['transform', 'translate', 'rotate', 'scale', 'opacity', 'left', 'top', 'right', 'bottom', 'width', 'height', 'clipPath', 'filter', 'backgroundColor', 'color', 'strokeDashoffset', 'cssText']

/** The object up the prototype chain that owns a property, and its descriptor. */
function ownerOf(obj, name) {
  for (let p = obj; p; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, name)
    if (d) return { owner: p, d }
  }
  return null
}

/**
 * Listen for `ms` to what writes the styles of these elements, and return
 * who did: [{ el, props, count, frames, library }]. Every style setter and
 * setAttribute is wrapped for that moment, with a stack taken on each write
 * to a watched element, then put back. A frozen page writes nothing, so it
 * says nothing; that is reported by the caller, not guessed at here.
 */
export function watchMotion(targets, { ms = 700, toolDir = null } = {}) {
  return new Promise((done) => {
    const els = targets.filter(Boolean)
    const byStyle = new Map(els.map((t) => [t.style, t]))
    const hits = new Map()
    const record = (el, prop) => {
      let h = hits.get(el)
      if (!h) hits.set(el, (h = { el, props: new Set(), count: 0, frames: new Map(), library: null }))
      h.props.add(prop)
      h.count++
      if (h.frames.size < 4) {
        const fr = frameOf(new Error().stack, toolDir)
        if (fr?.url) h.frames.set(`${fr.url}:${fr.line}`, fr)
        if (fr?.library) h.library ??= fr.library
      }
    }
    const restore = []
    const sample = els[0]?.style
    const kebab = (n) => n.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
    if (sample) {
      for (const name of WATCHED) {
        const o = ownerOf(sample, name)
        if (!o?.d) continue
        if (o.d.set && o.d.configurable) {
          // a browser with style properties as accessors on the prototype: wrap them there
          const { owner, d } = o
          try {
            Object.defineProperty(owner, name, {
              ...d,
              set(v) {
                const el = byStyle.get(this)
                if (el) record(el, name)
                return d.set.call(this, v)
              },
            })
            restore.push(() => Object.defineProperty(owner, name, d))
          } catch {}
        } else if (o.owner === sample && 'value' in o.d) {
          // Chrome: each style object carries its properties as its own, so each watched one gets
          // an accessor of its own, which `delete` takes away again
          for (const el of els) {
            const st = el.style
            try {
              Object.defineProperty(st, name, {
                configurable: true,
                enumerable: true,
                get: () => st.getPropertyValue(kebab(name)),
                set: (v) => {
                  record(el, name)
                  st.setProperty(kebab(name), v)
                },
              })
              restore.push(() => delete st[name])
            } catch {}
          }
        }
      }
      const sp = ownerOf(sample, 'setProperty')
      if (sp?.d?.value) {
        const orig = sp.d.value
        sp.owner.setProperty = function (name, ...rest) {
          const el = byStyle.get(this)
          if (el) record(el, name)
          return orig.call(this, name, ...rest)
        }
        restore.push(() => (sp.owner.setProperty = orig))
      }
    }
    const setAttr = Element.prototype.setAttribute
    Element.prototype.setAttribute = function (name, value) {
      if (byStyle.has(this.style) && /^(style|transform|d|x|y|cx|cy|r|width|height|opacity|fill|points)$/i.test(name)) record(this, name)
      return setAttr.call(this, name, value)
    }
    restore.push(() => (Element.prototype.setAttribute = setAttr))
    // writes that bypass all of that (a library holding the setter it captured at load) are still counted
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        const el = m.target
        if (!byStyle.has(el.style)) continue
        let h = hits.get(el)
        if (!h) hits.set(el, (h = { el, props: new Set(), count: 0, frames: new Map(), library: null }))
        h.count++
        h.props.add(m.attributeName)
      }
    })
    for (const el of els) mo.observe(el, { attributes: true })
    setTimeout(() => {
      for (const r of restore.reverse()) r()
      mo.disconnect()
      done([...hits.values()].map((h) => ({ ...h, props: [...h.props], frames: [...h.frames.values()] })))
    }, ms)
  })
}

/* ------------------------------------------------------------------ */
/*  colours                                                            */
/* ------------------------------------------------------------------ */

let propCache = null
/** Every custom property any readable sheet declares, read once per set of sheets. */
export function customPropNames() {
  const sig = document.styleSheets.length
  if (propCache?.sig === sig) return propCache.names
  const names = new Set()
  const visit = (rules) => {
    for (const r of rules) {
      if (r.style) for (const p of r.style) if (p.startsWith('--')) names.add(p)
      if (r.cssRules) {
        try {
          visit(r.cssRules)
        } catch {}
      }
    }
  }
  for (const s of document.styleSheets) {
    try {
      visit(s.cssRules)
    } catch {}
  }
  propCache = { sig, names: [...names] }
  return propCache.names
}

/** The custom properties that resolve, on this element, to this colour. */
export function varsFor(el, rgb) {
  const cs = getComputedStyle(el)
  const out = []
  for (const name of customPropNames()) {
    const v = cs.getPropertyValue(name).trim()
    if (!v || v.length > 60) continue
    const c = parseColor(v)
    if (c && colorDistance(c, rgb) < 0.004) out.push(name)
    if (out.length >= 12) break
  }
  return out
}

/**
 * Colours in a CSS value string, each with where it stands, so a value can
 * have one colour swapped without disturbing the rest of it.
 */
export function colorsIn(value) {
  const out = []
  const re = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^()]*\)|\b[a-z]{3,20}\b/gi
  for (const m of String(value).matchAll(re)) {
    if (/^[a-z]+$/i.test(m[0]) && /^(none|auto|inherit|initial|unset|solid|dashed|dotted|inset|currentcolor|transparent|var)$/i.test(m[0])) continue
    const rgb = parseColor(m[0])
    if (rgb) out.push({ start: m.index, end: m.index + m[0].length, text: m[0], rgb })
  }
  return out
}
