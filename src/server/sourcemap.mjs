/**
 * A SOURCE MAP, READ JUST ENOUGH TO ANSWER ONE QUESTION: which line of
 * which original file produced this line and column of served code. Used
 * to turn a stack frame from the page (where a script set a style, say)
 * into the line a person would open. No dependency: base64 VLQ is small.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const VAL = new Map([...B64].map((c, i) => [c, i]))

function decodeLine(line) {
  const segs = []
  let i = 0
  while (i < line.length) {
    const seg = []
    while (i < line.length && line[i] !== ',') {
      let value = 0
      let shift = 0
      let digit
      do {
        digit = VAL.get(line[i++]) ?? 0
        value += (digit & 31) << shift
        shift += 5
      } while (digit & 32 && i < line.length)
      seg.push(value & 1 ? -(value >>> 1) : value >>> 1)
    }
    segs.push(seg)
    i++
  }
  return segs
}

const decoded = new WeakMap()

/** Every mapped segment, as [genCol, source, origLine, origCol] per generated line (all zero-based). */
function decode(map) {
  if (decoded.has(map)) return decoded.get(map)
  const lines = []
  let source = 0
  let oline = 0
  let ocol = 0
  for (const raw of String(map.mappings ?? '').split(';')) {
    let col = 0
    const out = []
    for (const seg of decodeLine(raw)) {
      if (!seg.length) continue
      col += seg[0]
      if (seg.length >= 4) {
        source += seg[1]
        oline += seg[2]
        ocol += seg[3]
        out.push([col, source, oline, ocol])
      }
    }
    lines.push(out)
  }
  decoded.set(map, lines)
  return lines
}

/** Original { source, line, column } (line 1-based) for a generated line (1-based) and column (0-based), or null. */
export function originalPosition(map, line, column) {
  if (!map?.mappings) return null
  const lines = decode(map)
  const segs = lines[line - 1]
  if (!segs?.length) return null
  let best = segs[0]
  for (const s of segs) {
    if (s[0] <= column) best = s
    else break
  }
  return { source: map.sources?.[best[1]] ?? null, line: best[2] + 1, column: best[3] }
}
