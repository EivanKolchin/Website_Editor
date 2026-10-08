import { analysed, walk } from './ast.mjs'
import { parseCss } from './css.mjs'
import { htmlElements } from './html.mjs'

/**
 * COLOURS AS THEY ARE WRITTEN.
 *
 * Every colour literal in a source file - hex, rgb(), hsl(), oklch(),
 * oklab(), a CSS named colour, and, where the config asks for them, bare
 * OKLCH number arrays - with exact offsets, its value in sRGB, and enough
 * of its spelling to write a new colour back the same way: a #RGB stays
 * short where it can, rgb() keeps its commas, oklch() keeps its precision.
 * A colour picked off the page is matched to these by distance in OKLab,
 * the space where equal distances look equally different.
 */

/* ------------------------------------------------------------------ */
/*  colour spaces                                                      */
/* ------------------------------------------------------------------ */

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** sRGB 0-255 to OKLab. */
export function rgbToOklab({ r, g, b }) {
  const [R, G, B] = [r / 255, g / 255, b / 255].map(toLin)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** OKLab to sRGB 0-255, clipped into the gamut. */
export function oklabToRgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return { r: clamp(toGamma(R), 0, 1) * 255, g: clamp(toGamma(G), 0, 1) * 255, b: clamp(toGamma(B), 0, 1) * 255 }
}

export const oklchToRgb = (L, C, h) => oklabToRgb({ L, a: C * Math.cos((h * Math.PI) / 180), b: C * Math.sin((h * Math.PI) / 180) })

export function rgbToOklch(rgb) {
  const { L, a, b } = rgbToOklab(rgb)
  let h = (Math.atan2(b, a) * 180) / Math.PI
  if (h < 0) h += 360
  return { L, C: Math.hypot(a, b), h }
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360
  const f = (n) => {
    const k = (n + h / 30) % 12
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 }
}

function rgbToHsl({ r, g, b }) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s, l }
}

/** How different two colours look: distance in OKLab, with a difference in opacity counted too. */
export function colorDistance(x, y) {
  const p = rgbToOklab(x)
  const q = rgbToOklab(y)
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b) + Math.abs((x.a ?? 1) - (y.a ?? 1)) * 0.5
}

/* ------------------------------------------------------------------ */
/*  reading one literal                                                */
/* ------------------------------------------------------------------ */

const NAMED_RAW =
  'aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32'
export const NAMED = new Map()
for (let k = 0, w = NAMED_RAW.split(' '); k < w.length; k += 2) NAMED.set(w[k], w[k + 1])

function hexToRgba(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 }
}

const decimalsOf = (s) => {
  const m = /\.(\d+)/.exec(s)
  return m ? m[1].length : 0
}

function hueOf(tok) {
  const m = /^(-?[\d.]+)(deg|turn|rad|grad)?$/i.exec(tok)
  if (!m) return NaN
  const v = parseFloat(m[1])
  const unit = (m[2] ?? 'deg').toLowerCase()
  return unit === 'turn' ? v * 360 : unit === 'rad' ? (v * 180) / Math.PI : unit === 'grad' ? v * 0.9 : v
}

const num = (tok, pctScale = 1) => (tok === 'none' ? 0 : tok.endsWith('%') ? (parseFloat(tok) / 100) * pctScale : parseFloat(tok))

/**
 * One colour as written, or null:
 *   { rgb: {r, g, b, a}, format }
 * where `format` records what formatLike needs to write a new colour the same way.
 */
export function parseColorLiteral(text) {
  const t = text.trim()
  if (/^#[0-9a-f]{3,8}$/i.test(t) && [3, 4, 6, 8].includes(t.length - 1)) {
    return { rgb: hexToRgba(t), format: { kind: 'hex', len: t.length - 1, upper: /[A-F]/.test(t) && !/[a-f]/.test(t) } }
  }
  const named = NAMED.get(t.toLowerCase())
  if (named) return { rgb: hexToRgba('#' + named), format: { kind: 'named', name: t } }
  const fm = /^(rgba?|hsla?|oklch|oklab)\(\s*([^()]*)\)$/i.exec(t)
  if (!fm) return null
  const name = fm[1]
  const body = fm[2].trim()
  const comma = body.includes(',')
  let parts
  let alphaTok = null
  if (comma) {
    parts = body.split(',').map((s) => s.trim())
    if (parts.length === 4) alphaTok = parts.pop()
  } else {
    const [main, a] = body.split('/').map((s) => s.trim())
    parts = main.split(/\s+/)
    alphaTok = a ?? null
  }
  if (parts.length !== 3 || parts.some((p) => !/^(-?[\d.]+(%|deg|turn|rad|grad)?|none)$/i.test(p))) return null
  if (alphaTok != null && !/^([\d.]+%?|none)$/.test(alphaTok)) return null
  const a = alphaTok == null ? 1 : clamp(num(alphaTok), 0, 1)
  const lower = name.toLowerCase()
  let rgb
  if (lower.startsWith('rgb')) rgb = { r: num(parts[0], 255), g: num(parts[1], 255), b: num(parts[2], 255) }
  else if (lower.startsWith('hsl')) rgb = hslToRgb(hueOf(parts[0]), num(parts[1]) / (parts[1].endsWith('%') ? 1 : 100), num(parts[2]) / (parts[2].endsWith('%') ? 1 : 100))
  else if (lower === 'oklch') rgb = oklchToRgb(num(parts[0]), num(parts[1], 0.4), hueOf(parts[2]))
  else rgb = oklabToRgb({ L: num(parts[0]), a: num(parts[1], 0.4), b: num(parts[2], 0.4) })
  if (![rgb.r, rgb.g, rgb.b].every(Number.isFinite)) return null
  return {
    rgb: { r: clamp(rgb.r, 0, 255), g: clamp(rgb.g, 0, 255), b: clamp(rgb.b, 0, 255), a },
    format: { kind: 'fn', name, comma, hasAlpha: alphaTok != null, alphaPct: !!alphaTok?.endsWith('%'), pct: parts.map((p) => p.endsWith('%')), decimals: parts.map(decimalsOf), hue: lower === 'oklch' ? hueOf(parts[2]) : lower.startsWith('hsl') ? hueOf(parts[0]) : null },
  }
}

/** An OKLCH array ([L, C, h], or a gradient stop [t, L, C, h]) as a colour, or null when it cannot be one. */
export function parseOklchArray(nums) {
  const v = nums.map(Number)
  if (!(v.length === 3 || v.length === 4) || v.some((x) => !Number.isFinite(x))) return null
  const [L, C, h] = v.slice(-3)
  if (v.length === 4 && (v[0] < 0 || v[0] > 1)) return null
  if (L < 0 || L > 1 || C < 0 || C > 0.5 || h < 0 || h > 360) return null
  // a colour written as data has fractions: [1, 0, 0] is a vector, not a black
  if (!nums.slice(-3, -1).some((s) => String(s).includes('.'))) return null
  return { rgb: { ...oklchToRgb(L, C, h), a: 1 }, format: { kind: 'array', stop: v.length === 4, lead: v.length === 4 ? nums[0] : null, decimals: nums.slice(-3).map(decimalsOf), hue: h } }
}

/* ------------------------------------------------------------------ */
/*  writing one back, the same way                                     */
/* ------------------------------------------------------------------ */

const fixed = (v, d) => {
  const s = Number(v.toFixed(d)).toString()
  return s === '-0' ? '0' : s
}
const byte = (v) => Math.round(clamp(v, 0, 255))
const hex2 = (v) => byte(v).toString(16).padStart(2, '0')

/** `rgba` written in the spelling `format` came from. */
export function formatLike(format, rgba) {
  const a = rgba.a ?? 1
  const withAlpha = a < 0.9995
  if (format.kind === 'hex' || format.kind === 'named') {
    let s = hex2(rgba.r) + hex2(rgba.g) + hex2(rgba.b) + (withAlpha || format.len === 4 || format.len === 8 ? hex2(a * 255) : '')
    if (format.kind === 'hex' && format.len <= 4 && [...s].every((c, k) => k % 2 === 1 || c === s[k + 1])) s = [...s].filter((_, k) => k % 2 === 0).join('')
    if (format.kind === 'named') s = s.toLowerCase()
    else s = format.upper ? s.toUpperCase() : s.toLowerCase()
    return '#' + s
  }
  if (format.kind === 'array') {
    const { L, C, h } = rgbToOklch(rgba)
    const hue = C < 0.002 && format.hue != null ? format.hue : h
    const d = format.decimals
    const parts = [fixed(L, Math.max(3, d[0])), fixed(C, Math.max(3, d[1])), fixed(hue, d[2])]
    return `[${format.stop ? format.lead + ', ' : ''}${parts.join(', ')}]`
  }
  const lower = format.name.toLowerCase()
  let parts
  if (lower.startsWith('rgb')) parts = [rgba.r, rgba.g, rgba.b].map((v, k) => (format.pct[k] ? fixed((v / 255) * 100, 1) + '%' : String(byte(v))))
  else if (lower.startsWith('hsl')) {
    const { h, s, l } = rgbToHsl(rgba)
    const hue = s < 0.004 && format.hue != null ? format.hue : h
    parts = [fixed(hue, 1), fixed(s * 100, 1) + '%', fixed(l * 100, 1) + '%']
  } else if (lower === 'oklch') {
    const { L, C, h } = rgbToOklch(rgba)
    const hue = C < 0.002 && format.hue != null ? format.hue : h
    parts = [format.pct[0] ? fixed(L * 100, 2) + '%' : fixed(L, Math.max(3, format.decimals[0])), fixed(C, Math.max(3, format.decimals[1])), fixed(hue, Math.max(1, format.decimals[2]))]
  } else {
    const { L, a: A, b: B } = rgbToOklab(rgba)
    parts = [format.pct[0] ? fixed(L * 100, 2) + '%' : fixed(L, 3), fixed(A, 3), fixed(B, 3)]
  }
  const alpha = format.alphaPct ? fixed(a * 100, 1) + '%' : fixed(a, 3)
  if (format.comma) {
    const fn = lower.startsWith('rgb') ? (withAlpha || format.hasAlpha ? 'rgba' : 'rgb') : lower.startsWith('hsl') ? (withAlpha || format.hasAlpha ? 'hsla' : 'hsl') : format.name
    const name = format.name === format.name.toUpperCase() ? fn.toUpperCase() : fn
    return `${name}(${parts.join(', ')}${withAlpha || format.hasAlpha ? ', ' + alpha : ''})`
  }
  return `${format.name}(${parts.join(' ')}${withAlpha || format.hasAlpha ? ' / ' + alpha : ''})`
}

/* ------------------------------------------------------------------ */
/*  finding them in a file                                             */
/* ------------------------------------------------------------------ */

const HEX_RE = /(?<![\w&#$-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g
const FN_RE = /\b(?:rgba?|hsla?|oklch|oklab)\(\s*[^()]*\)/gi
const WORD_RE = /(?<![\w#.$-])[a-z]{3,20}(?![\w(-])/gi
// properties whose values name things that are not colours
const NOT_COLOR_PROP = /^(font|font-family|content|grid-area|grid-template-areas|animation|animation-name|transition|transition-property|will-change|counter-reset|counter-increment|quotes|list-style-type|text-overflow|cursor|src|unicode-range)$/i
const COLOR_ATTRS = /^(fill|stroke|color|bgcolor|stop-color|flood-color|lighting-color|background)$/i

export const kindOf = (file) =>
  /\.(css|pcss|postcss|scss|less)$/i.test(file) ? 'css' : /\.html?$/i.test(file) ? 'html' : /\.json$/i.test(file) ? 'json' : /\.(m?[jt]sx?|cts|vue|svelte)$/i.test(file) ? 'js' : null

/**
 * Every colour literal in a file:
 *   [{ start, end, text, rgb, format, where, prop, selector, key, at }]
 * `where` is 'css' (a declaration), 'attr' (an HTML attribute), 'string'
 * (a JS or JSON string) or 'array' (an OKLCH array).
 */
export function scanColors(code, file, opts = {}) {
  const kind = kindOf(file)
  const out = []
  const push = (start, end, parsed, ctx) => {
    if (!parsed) return
    out.push({ start, end, text: code.slice(start, end), rgb: parsed.rgb, format: parsed.format, ...ctx })
  }
  const scanRange = (s, e, ctx, named) => {
    const slice = code.slice(s, e)
    for (const m of slice.matchAll(HEX_RE)) push(s + m.index, s + m.index + m[0].length, parseColorLiteral(m[0]), ctx)
    for (const m of slice.matchAll(FN_RE)) push(s + m.index, s + m.index + m[0].length, parseColorLiteral(m[0]), ctx)
    if (named === 'words') {
      for (const m of slice.matchAll(WORD_RE)) if (NAMED.has(m[0].toLowerCase())) push(s + m.index, s + m.index + m[0].length, parseColorLiteral(m[0]), ctx)
    } else if (named === 'whole') {
      const t = slice.trim()
      if (NAMED.has(t.toLowerCase())) {
        const at = s + slice.indexOf(t)
        push(at, at + t.length, parseColorLiteral(t), ctx)
      }
    }
  }
  const scanCss = (parsed) => {
    for (const d of parsed.decls) {
      scanRange(d.valueStart, d.valueEnd, { where: 'css', prop: d.prop, selector: d.rule?.selector ?? null, at: d.rule?.at ?? [] }, NOT_COLOR_PROP.test(d.prop) ? null : 'words')
    }
  }

  if (kind === 'css') scanCss(parseCss(code))
  else if (kind === 'html') {
    for (const el of htmlElements(code)) {
      if (el.tag === 'style') {
        const close = code.toLowerCase().lastIndexOf('</style', el.end)
        scanCss(parseCss(code.slice(el.tagEnd, close > el.tagEnd ? close : el.end), el.tagEnd))
      }
      for (const at of el.attrs) {
        if (at.valueEnd <= at.valueStart) continue
        const name = at.name.toLowerCase()
        if (name === 'style') {
          // a declaration list: each value on its own, so a property name is never read as a colour
          let p = at.valueStart
          for (const part of code.slice(at.valueStart, at.valueEnd).split(';')) {
            const c = part.indexOf(':')
            if (c > 0) {
              const prop = part.slice(0, c).trim()
              scanRange(p + c + 1, p + part.length, { where: 'attr', prop, selector: `<${el.tag}>`, at: [] }, NOT_COLOR_PROP.test(prop) ? null : 'words')
            }
            p += part.length + 1
          }
        } else scanRange(at.valueStart, at.valueEnd, { where: 'attr', prop: name, selector: `<${el.tag}>`, at: [] }, COLOR_ATTRS.test(name) ? 'whole' : null)
      }
    }
  } else if (kind === 'js' || kind === 'json') {
    const { strings, arrays } = jsLiterals(code, file, opts.arrays === 'oklch')
    for (const [s, e] of strings) scanRange(s, e, { where: 'string' }, 'whole')
    for (const arr of arrays) push(arr.start, arr.end, parseOklchArray(arr.nums), { where: 'array' })
  }

  // line numbers and the name each colour is filed under
  const lines = lineStarts(code)
  for (const c of out) {
    const line = lineAt(lines, c.start)
    c.line = line + 1
    const ls = lines[line]
    const le = code.indexOf('\n', c.start)
    c.lineText = code.slice(ls, le < 0 ? code.length : le).trim().slice(0, 140)
    if (c.where === 'string' || c.where === 'array') {
      const before = code.slice(Math.max(ls, c.start - 160), c.start)
      c.key = /([\w$-]+)['"]?\s*:\s*\[?\s*['"`]?$/.exec(before)?.[1] ?? /([\w$]+)\s*=\s*\[?\s*['"`]?$/.exec(before)?.[1] ?? null
    } else c.key = c.prop?.startsWith('--') ? c.prop : null
  }
  return out
}

export function lineStarts(code) {
  const out = [0]
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) out.push(i + 1)
  return out
}
export function lineAt(starts, offset) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * The string bodies (as [start, end]) and, when asked, the number arrays
 * of a JS-like file. Read from the syntax tree when the file parses; from a
 * small lexer when it does not, which is the case for script fragments
 * concatenated by a build step.
 */
export function jsLiterals(code, file, wantArrays = false) {
  const strings = []
  const arrays = []
  let tree = null
  if (!/\.json$/i.test(file)) {
    try {
      tree = analysed(code, file)
    } catch {
      tree = null
    }
  }
  if (tree?.ast) {
    walk(tree.ast, (node) => {
      if (node.type === 'StringLiteral') strings.push([node.start + 1, node.end - 1])
      else if (node.type === 'TemplateElement') strings.push([node.start, node.end])
      else if (wantArrays && node.type === 'ArrayExpression' && (node.elements.length === 3 || node.elements.length === 4) && node.elements.every((e) => e?.type === 'NumericLiteral')) {
        arrays.push({ start: node.start, end: node.end, nums: node.elements.map((e) => code.slice(e.start, e.end)) })
      }
    })
    return { strings, arrays }
  }
  const lexed = lexStrings(code)
  strings.push(...lexed)
  if (wantArrays) {
    // mask the strings, then read number arrays from what is left
    let masked = code
    for (const [s, e] of lexed) masked = masked.slice(0, s) + ' '.repeat(e - s) + masked.slice(e)
    masked = masked.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    const NUM = '\\s*(-?\\d*\\.?\\d+)\\s*'
    const re = new RegExp(`\\[${NUM},${NUM},${NUM}(?:,${NUM})?\\]`, 'g')
    for (const m of masked.matchAll(re)) arrays.push({ start: m.index, end: m.index + m[0].length, nums: m.slice(1).filter((x) => x != null) })
  }
  return { strings, arrays }
}

/** String and template bodies in JS that may not parse on its own, as [start, end] pairs. */
export function lexStrings(code) {
  const out = []
  const n = code.length
  const KW = /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/
  const tpl = []
  let prev = ''
  let word = ''
  const regexOk = () => !prev || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || KW.test(word)
  const template = (from) => {
    let j = from
    while (j < n) {
      if (code[j] === '\\') {
        j += 2
        continue
      }
      if (code[j] === '`') {
        out.push([from, j])
        return { end: j + 1, open: false }
      }
      if (code[j] === '$' && code[j + 1] === '{') {
        out.push([from, j])
        return { end: j + 2, open: true }
      }
      j++
    }
    out.push([from, n])
    return { end: n, open: false }
  }
  let i = 0
  while (i < n) {
    const c = code[i]
    if (c === '/' && code[i + 1] === '/') {
      const e = code.indexOf('\n', i)
      i = e < 0 ? n : e
      continue
    }
    if (c === '/' && code[i + 1] === '*') {
      const e = code.indexOf('*/', i + 2)
      i = e < 0 ? n : e + 2
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
      out.push([i + 1, Math.min(j, n)])
      i = j + 1
      prev = c
      word = ''
      continue
    }
    if (c === '`' || (c === '}' && tpl.length && tpl[tpl.length - 1] === 0)) {
      if (c === '}') tpl.pop()
      const r = template(i + 1)
      if (r.open) tpl.push(0)
      i = r.end
      prev = r.open ? '{' : '`'
      word = ''
      continue
    }
    if (tpl.length && c === '{') tpl[tpl.length - 1]++
    if (tpl.length && c === '}') tpl[tpl.length - 1]--
    if (c === '/' && regexOk()) {
      let j = i + 1
      let cls = false
      while (j < n && code[j] !== '\n') {
        if (code[j] === '\\') {
          j += 2
          continue
        }
        if (code[j] === '[') cls = true
        else if (code[j] === ']') cls = false
        else if (code[j] === '/' && !cls) break
        j++
      }
      i = j + 1
      while (i < n && /[a-z]/i.test(code[i])) i++
      prev = ')'
      word = ''
      continue
    }
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[\w$]/.test(c)) {
      let j = i
      while (j < n && /[\w$]/.test(code[j])) j++
      word = code.slice(i, j)
      prev = 'a'
      i = j
      continue
    }
    prev = c
    word = ''
    i++
  }
  return out
}
