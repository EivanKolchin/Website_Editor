/**
 * COLOURS WORTH STARTING FROM.
 *
 * The published palettes of products people already trust - Apple's system
 * colours, Material 3, Tailwind's scale, and the brand colours of apps whose
 * interfaces are well regarded - so a colour picked on the wheel can be
 * snapped to a considered neighbour. Suggestions are ranked by distance in
 * OKLab, where equal steps look equally different, not in RGB, where they
 * do not.
 */
const RAW = [
  // Apple system colours (light, dark)
  ['Apple', 'Red', '#FF3B30'], ['Apple', 'Orange', '#FF9500'], ['Apple', 'Yellow', '#FFCC00'], ['Apple', 'Green', '#34C759'],
  ['Apple', 'Mint', '#00C7BE'], ['Apple', 'Teal', '#30B0C7'], ['Apple', 'Cyan', '#32ADE6'], ['Apple', 'Blue', '#007AFF'],
  ['Apple', 'Indigo', '#5856D6'], ['Apple', 'Purple', '#AF52DE'], ['Apple', 'Pink', '#FF2D55'], ['Apple', 'Brown', '#A2845E'],
  ['Apple', 'Gray', '#8E8E93'], ['Apple', 'Grouped background', '#F2F2F7'], ['Apple', 'Dark elevated', '#1C1C1E'], ['Apple', 'Dark secondary', '#2C2C2E'],
  ['Apple', 'Red (dark)', '#FF453A'], ['Apple', 'Orange (dark)', '#FF9F0A'], ['Apple', 'Yellow (dark)', '#FFD60A'], ['Apple', 'Green (dark)', '#30D158'],
  ['Apple', 'Blue (dark)', '#0A84FF'], ['Apple', 'Indigo (dark)', '#5E5CE6'], ['Apple', 'Purple (dark)', '#BF5AF2'], ['Apple', 'Pink (dark)', '#FF375F'],
  // Material 3 baseline
  ['Material 3', 'Primary', '#6750A4'], ['Material 3', 'Secondary', '#625B71'], ['Material 3', 'Tertiary', '#7D5260'], ['Material 3', 'Error', '#B3261E'],
  // product brands
  ['Stripe', 'Blurple', '#635BFF'], ['Stripe', 'Navy', '#0A2540'], ['Stripe', 'Cyan', '#00D4FF'], ['Stripe', 'Background', '#F6F9FC'],
  ['Linear', 'Indigo', '#5E6AD2'], ['Vercel', 'Blue', '#0070F3'], ['Vercel', 'Black', '#000000'], ['Vercel', 'Gray 50', '#FAFAFA'],
  ['Notion', 'Text', '#37352F'], ['Notion', 'Warm gray', '#F7F6F3'], ['Notion', 'Blue', '#2383E2'],
  ['Figma', 'Red', '#F24E1E'], ['Figma', 'Coral', '#FF7262'], ['Figma', 'Purple', '#A259FF'], ['Figma', 'Blue', '#1ABCFE'], ['Figma', 'Green', '#0ACF83'],
  ['Spotify', 'Green', '#1DB954'], ['Spotify', 'Bright green', '#1ED760'], ['Spotify', 'Black', '#191414'], ['Spotify', 'Dark', '#121212'],
  ['Airbnb', 'Rausch', '#FF385C'], ['Airbnb', 'Hof', '#222222'],
  ['Duolingo', 'Feather', '#58CC02'], ['Duolingo', 'Macaw', '#1CB0F6'], ['Duolingo', 'Cardinal', '#FF4B4B'], ['Duolingo', 'Bee', '#FFC800'], ['Duolingo', 'Fox', '#FF9600'], ['Duolingo', 'Beetle', '#CE82FF'],
  ['Slack', 'Aubergine', '#4A154B'], ['Slack', 'Blue', '#36C5F0'], ['Slack', 'Green', '#2EB67D'], ['Slack', 'Yellow', '#ECB22E'], ['Slack', 'Red', '#E01E5A'],
  ['Discord', 'Blurple', '#5865F2'], ['Discord', 'Dark', '#313338'], ['Discord', 'Green', '#57F287'], ['Discord', 'Yellow', '#FEE75C'], ['Discord', 'Fuchsia', '#EB459E'], ['Discord', 'Red', '#ED4245'],
  ['GitHub', 'Blue', '#0969DA'], ['GitHub', 'Green', '#1F883D'], ['GitHub', 'Danger', '#CF222E'], ['GitHub', 'Done', '#8250DF'], ['GitHub', 'Canvas subtle', '#F6F8FA'], ['GitHub', 'Dark canvas', '#0D1117'], ['GitHub', 'Dark overlay', '#161B22'],
  ['Microsoft', 'Communication blue', '#0078D4'], ['Google', 'Blue', '#4285F4'], ['Google', 'Red', '#EA4335'], ['Google', 'Yellow', '#FBBC05'], ['Google', 'Green', '#34A853'],
  ['IBM Carbon', 'Blue 60', '#0F62FE'], ['Atlassian', 'Blue', '#0052CC'], ['Shopify Polaris', 'Green', '#008060'], ['Twitch', 'Purple', '#9146FF'],
  ['Netflix', 'Red', '#E50914'], ['Netflix', 'Black', '#141414'], ['Dropbox', 'Blue', '#0061FF'], ['Mailchimp', 'Yellow', '#FFE01B'], ['Trello', 'Blue', '#0079BF'],
  ['LinkedIn', 'Blue', '#0A66C2'], ['Facebook', 'Blue', '#1877F2'], ['WhatsApp', 'Green', '#25D366'], ['Reddit', 'Orange', '#FF4500'], ['Pinterest', 'Red', '#E60023'],
  ['TikTok', 'Red', '#FE2C55'], ['TikTok', 'Cyan', '#25F4EE'], ['YouTube', 'Red', '#FF0000'], ['Snapchat', 'Yellow', '#FFFC00'], ['Instagram', 'Pink', '#E1306C'],
  // Tailwind - neutrals
  ['Tailwind', 'slate-50', '#F8FAFC'], ['Tailwind', 'slate-100', '#F1F5F9'], ['Tailwind', 'slate-200', '#E2E8F0'], ['Tailwind', 'slate-300', '#CBD5E1'], ['Tailwind', 'slate-400', '#94A3B8'],
  ['Tailwind', 'slate-500', '#64748B'], ['Tailwind', 'slate-600', '#475569'], ['Tailwind', 'slate-700', '#334155'], ['Tailwind', 'slate-800', '#1E293B'], ['Tailwind', 'slate-900', '#0F172A'], ['Tailwind', 'slate-950', '#020617'],
  ['Tailwind', 'gray-50', '#F9FAFB'], ['Tailwind', 'gray-100', '#F3F4F6'], ['Tailwind', 'gray-200', '#E5E7EB'], ['Tailwind', 'gray-300', '#D1D5DB'], ['Tailwind', 'gray-400', '#9CA3AF'],
  ['Tailwind', 'gray-500', '#6B7280'], ['Tailwind', 'gray-600', '#4B5563'], ['Tailwind', 'gray-700', '#374151'], ['Tailwind', 'gray-800', '#1F2937'], ['Tailwind', 'gray-900', '#111827'],
  ['Tailwind', 'zinc-50', '#FAFAFA'], ['Tailwind', 'zinc-100', '#F4F4F5'], ['Tailwind', 'zinc-200', '#E4E4E7'], ['Tailwind', 'zinc-400', '#A1A1AA'], ['Tailwind', 'zinc-500', '#71717A'],
  ['Tailwind', 'zinc-700', '#3F3F46'], ['Tailwind', 'zinc-800', '#27272A'], ['Tailwind', 'zinc-900', '#18181B'], ['Tailwind', 'zinc-950', '#09090B'],
  ['Tailwind', 'stone-50', '#FAFAF9'], ['Tailwind', 'stone-100', '#F5F5F4'], ['Tailwind', 'stone-200', '#E7E5E4'], ['Tailwind', 'stone-400', '#A8A29E'], ['Tailwind', 'stone-500', '#78716C'],
  ['Tailwind', 'stone-700', '#44403C'], ['Tailwind', 'stone-800', '#292524'], ['Tailwind', 'stone-900', '#1C1917'],
  // Tailwind - hues
  ['Tailwind', 'red-100', '#FEE2E2'], ['Tailwind', 'red-500', '#EF4444'], ['Tailwind', 'red-600', '#DC2626'], ['Tailwind', 'red-900', '#7F1D1D'],
  ['Tailwind', 'orange-100', '#FFEDD5'], ['Tailwind', 'orange-500', '#F97316'], ['Tailwind', 'amber-100', '#FEF3C7'], ['Tailwind', 'amber-400', '#FBBF24'], ['Tailwind', 'amber-500', '#F59E0B'], ['Tailwind', 'amber-900', '#78350F'],
  ['Tailwind', 'yellow-100', '#FEF9C3'], ['Tailwind', 'yellow-400', '#FACC15'], ['Tailwind', 'lime-100', '#ECFCCB'], ['Tailwind', 'lime-500', '#84CC16'],
  ['Tailwind', 'green-100', '#DCFCE7'], ['Tailwind', 'green-500', '#22C55E'], ['Tailwind', 'green-600', '#16A34A'], ['Tailwind', 'green-900', '#14532D'],
  ['Tailwind', 'emerald-100', '#D1FAE5'], ['Tailwind', 'emerald-500', '#10B981'], ['Tailwind', 'emerald-600', '#059669'], ['Tailwind', 'emerald-900', '#064E3B'],
  ['Tailwind', 'teal-100', '#CCFBF1'], ['Tailwind', 'teal-500', '#14B8A6'], ['Tailwind', 'teal-900', '#134E4A'], ['Tailwind', 'cyan-100', '#CFFAFE'], ['Tailwind', 'cyan-500', '#06B6D4'],
  ['Tailwind', 'sky-100', '#E0F2FE'], ['Tailwind', 'sky-500', '#0EA5E9'], ['Tailwind', 'sky-900', '#0C4A6E'],
  ['Tailwind', 'blue-100', '#DBEAFE'], ['Tailwind', 'blue-500', '#3B82F6'], ['Tailwind', 'blue-600', '#2563EB'], ['Tailwind', 'blue-900', '#1E3A8A'],
  ['Tailwind', 'indigo-100', '#E0E7FF'], ['Tailwind', 'indigo-500', '#6366F1'], ['Tailwind', 'indigo-600', '#4F46E5'], ['Tailwind', 'indigo-900', '#312E81'],
  ['Tailwind', 'violet-100', '#EDE9FE'], ['Tailwind', 'violet-500', '#8B5CF6'], ['Tailwind', 'violet-900', '#4C1D95'], ['Tailwind', 'purple-100', '#F3E8FF'], ['Tailwind', 'purple-500', '#A855F7'],
  ['Tailwind', 'fuchsia-100', '#FAE8FF'], ['Tailwind', 'fuchsia-500', '#D946EF'], ['Tailwind', 'pink-100', '#FCE7F3'], ['Tailwind', 'pink-500', '#EC4899'],
  ['Tailwind', 'rose-100', '#FFE4E6'], ['Tailwind', 'rose-500', '#F43F5E'], ['Tailwind', 'rose-900', '#881337'],
  ['Basics', 'White', '#FFFFFF'], ['Basics', 'Black', '#000000'],
]

export const PALETTE = RAW.map(([source, name, hex]) => ({ source, name, hex, lab: toOklab(hexToRgb(hex)) }))

/** The everyday picks shown before anything is hovered. */
export const COMMON = ['#FFFFFF', '#F6F9FC', '#F2F2F7', '#E5E7EB', '#9CA3AF', '#4B5563', '#1C1C1E', '#000000', '#007AFF', '#635BFF', '#5E6AD2', '#0D99FF', '#34C759', '#1DB954', '#FFCC00', '#FF9500', '#FF3B30', '#FF385C', '#AF52DE', '#EC4899']

export function hexToRgb(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a }
}

export const rgbToHex = ({ r, g, b, a = 1 }) => {
  const h = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return ('#' + h(r) + h(g) + h(b) + (a < 0.999 ? h(a * 255) : '')).toUpperCase()
}

export function toOklab({ r, g, b }) {
  const lin = (c) => {
    c /= 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

const dist = (p, q) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b)

/** The palette colours nearest a colour, nearest first, at most one per name. */
export function nearest(rgb, n = 8) {
  const lab = toOklab(rgb)
  return PALETTE.map((c) => ({ ...c, d: dist(lab, c.lab) }))
    .sort((x, y) => x.d - y.d)
    .filter((c, i, all) => all.findIndex((o) => o.hex === c.hex) === i)
    .slice(0, n)
}

export function hsvToRgb(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return { r: f(5) * 255, g: f(3) * 255, b: f(1) * 255 }
}

export function rgbToHsv({ r, g, b }) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max ? d / max : 0, v: max }
}

/** Parse anything CSS accepts as a colour, through the browser's own parser. */
let probe = null
export function parseColor(value) {
  if (!value) return null
  if (!probe) {
    probe = document.createElement('i')
    probe.style.display = 'none'
    document.documentElement.appendChild(probe)
  }
  probe.style.color = ''
  probe.style.color = value
  if (!probe.style.color) return null
  const c = getComputedStyle(probe).color
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(c)
  if (m) {
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return { r: +m[1], g: +m[2], b: +m[3], a }
  }
  // oklch(), color(), lab(): computed styles keep their own space, so let a canvas convert it to sRGB
  return viaCanvas(c)
}

let pixel = null
function viaCanvas(value) {
  try {
    if (!pixel) {
      const cv = document.createElement('canvas')
      cv.width = cv.height = 1
      pixel = cv.getContext('2d', { willReadFrequently: true })
    }
    pixel.clearRect(0, 0, 1, 1)
    pixel.fillStyle = '#000'
    pixel.fillStyle = value
    pixel.fillRect(0, 0, 1, 1)
    const d = pixel.getImageData(0, 0, 1, 1).data
    const a = d[3] / 255
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
    return { r: d[0], g: d[1], b: d[2], a }
  } catch {
    return null
  }
}

export function toOklch(rgb) {
  const { L, a, b } = toOklab(rgb)
  let h = (Math.atan2(b, a) * 180) / Math.PI
  if (h < 0) h += 360
  return { L, C: Math.hypot(a, b), h }
}

/** How different two colours look (OKLab distance, opacity counted). */
export const colorDistance = (x, y) => dist(toOklab(x), toOklab(y)) + Math.abs((x.a ?? 1) - (y.a ?? 1)) * 0.5

/** Readable ink on a colour: black or white, by contrast. */
export function inkOn(rgb) {
  const lum = (c) => {
    c /= 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lum(rgb.r) + 0.7152 * lum(rgb.g) + 0.0722 * lum(rgb.b)
  return L > 0.4 ? '#111' : '#fff'
}
