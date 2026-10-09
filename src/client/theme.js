// Retouch's dark chrome theme. The middle stage canvas uses a deeper neutral
// grey with a canvas dot grid, framed by dark panel surfaces.
// Website colours and the colour picker's source palettes stay independent.
export const THEME = Object.freeze({
  bg: '#141414',
  stage: '#0f0f0f',
  stageDot: '#363636',
  panel: '#181818',
  raised: '#222222',
  field: '#131313',
  line: '#2c2c2c',
  lineStrong: '#3e3e3e',
  ink: '#f0f0f0',
  muted: '#b3b3b3',
  faint: '#a3a3a3',
  accent: '#68b0ff',
  accentHover: '#8ac3ff',
  accentSoft: 'rgba(104,176,255,0.13)',
  accentInk: '#acd2ff',
  onAccent: '#172431',
  source: '#8ac8bd',
  sourceSoft: 'rgba(138,200,189,0.12)',
  success: '#9bd0af',
  successSoft: 'rgba(155,208,175,0.12)',
  warning: '#e8c183',
  warningSoft: 'rgba(232,193,131,0.12)',
  danger: '#f19896',
  dangerSoft: 'rgba(241,152,150,0.12)',
  playhead: '#f07878',
  playheadSoft: 'rgba(240,120,120,0.1)',
  scrim: 'rgba(18,18,18,0.66)',
})

const channels = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(',')

export const THEME_CSS = `
:root, :host, .root {
  --bg: ${THEME.bg}; --stage: ${THEME.stage}; --stage-dot: ${THEME.stageDot}; --panel: ${THEME.panel}; --panel-2: ${THEME.raised}; --field: ${THEME.field};
  --line: ${THEME.line}; --line-strong: ${THEME.lineStrong};
  --ink: ${THEME.ink}; --mut: ${THEME.muted}; --faint: ${THEME.faint};
  --acc: ${THEME.accent}; --acc-hover: ${THEME.accentHover}; --acc-soft: ${THEME.accentSoft}; --acc-ink: ${THEME.accentInk}; --on-acc: ${THEME.onAccent};
  --acc-rgb: ${channels(THEME.accent)}; --source-rgb: ${channels(THEME.source)}; --warning-rgb: ${channels(THEME.warning)}; --success-rgb: ${channels(THEME.success)}; --danger-rgb: ${channels(THEME.danger)};
  --source: ${THEME.source}; --source-soft: ${THEME.sourceSoft}; --draw: ${THEME.source};
  --success: ${THEME.success}; --success-soft: ${THEME.successSoft};
  --warning: ${THEME.warning}; --warning-soft: ${THEME.warningSoft};
  --danger: ${THEME.danger}; --danger-soft: ${THEME.dangerSoft};
  --playhead: ${THEME.playhead}; --playhead-soft: ${THEME.playheadSoft}; --scrim: ${THEME.scrim};
  color-scheme: dark;
}
`
