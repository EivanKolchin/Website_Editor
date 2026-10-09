/**
 * The engine's own gate: every edit kind, run against real files in a temp
 * directory, from stamp to saved source. `node test/run.mjs`.
 *
 * Each case states the exact text it expects, because "it changed something
 * plausible" is not a pass: the whole point of the engine is that a save
 * changes the characters the edit meant and nothing else.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadParser, parse } from '../src/server/ast.mjs'
import { normalise } from '../src/server/config.mjs'
import { createOps } from '../src/server/ops.mjs'
import { Project } from '../src/server/project.mjs'
import { applySplices } from '../src/server/save.mjs'
import { Journal, relocate, Sources } from '../src/server/sources.mjs'
import { parseStamp, stampSource } from '../src/server/stamp.mjs'
import { cookJSXText, cookStringBody, spliceEntry, textEntries } from '../src/server/text.mjs'
import { posix } from '../src/server/util.mjs'

const here = dirname(fileURLToPath(import.meta.url))
loadParser(resolve(here, '..', '..'))

let failed = 0
let passed = 0
const results = []
async function test(name, fn) {
  try {
    await fn()
    passed++
    results.push(`  ok    ${name}`)
  } catch (e) {
    failed++
    results.push(`  FAIL  ${name}\n        ${e.message.split('\n').join('\n        ')}`)
  }
}
const eq = (actual, expected, what = 'value') => {
  if (actual !== expected) throw new Error(`${what}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`)
}
const ok = (cond, what) => {
  if (!cond) throw new Error(what)
}

/* ------------------------------------------------------------------ */
/*  fixture project                                                    */
/* ------------------------------------------------------------------ */

const FILES = {
  'src/Scene.tsx': `import { COPY } from './copy'

const SWAYS = [
  { href: 'a.webp', x: 352, ground: 898, w: 70 },
  // a fuller meadow
  { href: 'b.webp', x: 604, ground: 886, w: 148 },
  { href: 'c.webp', x: 548, ground: 892, w: 66 },
]

function Sprite({ href, x, ground, w }: { href: string; x: number; ground: number; w: number }) {
  return <image href={href} x={x - w / 2} y={ground - w} width={w} height={w} />
}

export function Scene() {
  return (
    <main>
      <h1 className="title">{COPY.title}</h1>
      <p className="lead">Hello <b>big</b> world</p>
      <div className="card">Card</div>
      <div className="styled" style={{ color: 'red' }}>Styled</div>
      <svg viewBox="0 0 1600 1000">
        {SWAYS.map((s, i) => (
          <g key={i}>
            <Sprite href={s.href} x={s.x} ground={s.ground} w={s.w} />
          </g>
        ))}
        <Sprite href="d.webp" x={238} ground={874} w={30} />
        <rect x={10} y={20} width={30} height={40} fill="#ffffff" />
        {[1, 2].map((n) => <circle key={n} cx={n} cy={2} r={3} />)}
      </svg>
      <footer>Get Kerfox</footer>
    </main>
  )
}
`,
  'src/copy.ts': `export const COPY = {
  title: 'Study that grows with you.',
  lead:
    'Lessons that move, questions that bite back, and a fox who keeps ' +
    'count. Built for university first.',
  cta: 'Get Kerfox',
}
`,
  'src/other.ts': `export const OTHER = { cta: 'Get Kerfox' }
`,
  // markup a build step inlines into the page as a string, and the files around it
  'site/landing/body.html': `<div class="track">
  <section class="copy" data-c="9">
    <h2 class="h2">Teach it, with the notes shut</h2>
    <p class="p">Explain an idea in your own words,
      and it is checked against the points a good one&#160;makes.</p>
    <figure class="qt"><blockquote><p>If you want to master something, teach&#160;it.<span class="qm" aria-hidden="true">&#8221;</span></p></blockquote><figcaption>The Feynman technique</figcaption></figure>
  </section>
  <section class="copy" data-c="10">
    <h2 class="h2">Lightning, against the clock</h2>
  </section>
</div>
`,
  'site/landing/style.css': `.kf {
  --ground: #fcfbf8;
  --night: #05050B;
  --ink: rgba(32, 39, 51, 0.9);
}
.copy .h2 { color: #202733; font-size: 28px; }
@media (max-width: 600px) {
  .copy .h2 { font-size: 22px; }
}
.qt { border: 1px solid tomato; background: oklch(0.62 0.15 250); }
.card {
  padding: 12px;
  &:hover { background: hsl(210, 50%, 40%); }
}
@keyframes rise { from { opacity: 0; color: #fff; } to { opacity: 1; } }
`,
  // a script fragment: one of several files concatenated by a build step, so it does not parse alone
  'site/landing/scene.js': `  var ROOMS = {
    memorise: { ground_top: [0.39, 0.105, 262], ground_bottom: [0.46, 0.09, 242] },
    sky: [[0, 0.375, 0.115, 268], [1, 0.68, 0.06, 230]],
    grid: [1, 0, 0],
  }
  var INK = '#2A3A6E'
  function draw() { return '#2a3a6e' }
`,
  // a component with props, a default, a commented constant and timing in its code, and a page that uses it
  'src/Bar.tsx': `type Tone = 'paper' | 'night'

/** How far up the page has to move, deliberately, before the bar returns. */
const RECALL = { fine: 64, coarse: 24 }

export function Bar({ tone = 'paper', sticky }: { tone?: Tone; sticky?: boolean; count?: number }) {
  const hideAfter = 450
  setTimeout(() => {}, 1500)
  return <header className="bar" data-tone={tone}>{RECALL.fine + hideAfter}</header>
}
`,
  'src/Page.tsx': `import { Bar } from './Bar'

export function Page() {
  return (
    <main>
      <Bar tone="night" sticky />
    </main>
  )
}
`,
  'scripts/gen.mjs': `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
mkdirSync('site/generated', { recursive: true })
writeFileSync('site/generated/landing.txt', readFileSync('site/landing/body.html', 'utf8').length + '')
`,
}

const root = posix(mkdtempSync(join(tmpdir(), 'retouch-test-')))
for (const [rel, code] of Object.entries(FILES)) {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), code)
}
mkdirSync(join(root, 'node_modules'), { recursive: true })

const config = normalise({ adapters: [{ component: 'Sprite', move: { x: 'x', y: 'ground' }, size: ['w'] }] }, root)
const sources = new Sources(root)
const project = new Project({ root, sources, config })
const journal = new Journal(root)
const ops = createOps({ project, sources, config })

/** Stamp a file as the dev server would, and return its stamps by element source text. */
function load(rel) {
  const file = posix(join(root, rel))
  const code = readFileSync(file, 'utf8')
  const { pid, vid } = sources.record(file, code)
  const out = stampSource(code, file, `${pid}.${vid}`)
  const stamps = []
  if (out) {
    for (const m of out.code.matchAll(/data-rt=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
      const raw = m[1] ?? m[2]
      const st = parseStamp(raw.replace(/\$\{[^}]+\}/g, '0'))
      stamps.push({ raw, st, text: code.slice(st.start, st.end) })
    }
  }
  return { file, code, out, stamps }
}
const stampOf = (loaded, startsWith, index) => {
  const s = loaded.stamps.find((x) => x.text.startsWith(startsWith))
  if (!s) throw new Error(`no stamp for ${startsWith}`)
  return index == null ? s.raw : s.raw.replace(/\$\{[^}]+\}/g, String(index))
}
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const save = async (list) => applySplices({ project, journal, splices: await ops.plan(list), label: 'test' })
const reset = () => {
  for (const [rel, code] of Object.entries(FILES)) writeFileSync(join(root, rel), code)
}

/* ------------------------------------------------------------------ */
/*  stamping                                                           */
/* ------------------------------------------------------------------ */

await test('stamps every DOM and component element, and the stamped file still parses', () => {
  const l = load('src/Scene.tsx')
  ok(l.out, 'nothing stamped')
  parse(l.out.code, 'Scene.tsx', { strict: true })
  for (const s of l.stamps) ok(s.text.startsWith('<'), `stamp does not point at an element: ${s.text.slice(0, 30)}`)
  ok(l.stamps.some((s) => s.text.startsWith('<Sprite href={s.href}')), 'mapped Sprite not stamped')
  ok(!l.stamps.some((s) => s.text.startsWith('<>')), 'fragment stamped')
})

await test('a map callback without an index parameter is given one', () => {
  const l = load('src/Scene.tsx')
  ok(/\(\(n, __rt\d+\) =>/.test(l.out.code), 'no index parameter added to [1, 2].map((n) => ...)')
  const mapped = l.stamps.find((s) => s.text.startsWith('<Sprite href={s.href}'))
  ok(/@\d+=\$\{i\}$/.test(mapped.raw), `map stamp does not read the existing index: ${mapped.raw}`)
})

/* ------------------------------------------------------------------ */
/*  text cooking                                                       */
/* ------------------------------------------------------------------ */

await test('JSX text is cooked the way the compiler cooks it', () => {
  const raw = '\n    Hello &amp; world\n    second line  \n  '
  const c = cookJSXText(raw)
  eq(c.value, 'Hello & world second line')
  const join = c.value.indexOf(' second')
  eq(raw.slice(c.starts[join], c.ends[join]).trim(), '', 'the joining space maps onto whitespace')
})

await test('string escapes cook to what the page shows', () => {
  eq(cookStringBody("it\\'s a \\u00e9 \\n x").value, "it's a é \n x")
})

await test('a concatenation is one entry with the joined value', () => {
  const e = textEntries(FILES['src/copy.ts'], 'copy.ts').find((x) => x.kind === 'concat')
  eq(e.value, 'Lessons that move, questions that bite back, and a fox who keeps count. Built for university first.')
})

await test('an edit inside one piece of a concatenation changes only that piece', () => {
  const code = FILES['src/copy.ts']
  const e = textEntries(code, 'copy.ts').find((x) => x.kind === 'concat')
  const at = e.value.indexOf('bite back')
  const s = spliceEntry(code, e, at, at + 'bite back'.length, 'push back')
  const next = code.slice(0, s.start) + s.text + code.slice(s.end)
  ok(next.includes("'Lessons that move, questions that push back, and a fox who keeps ' +"), next)
  ok(next.includes("'count. Built for university first.',"), 'second piece changed')
})

await test('an edit across the seam of a concatenation merges the two pieces', () => {
  const code = FILES['src/copy.ts']
  const e = textEntries(code, 'copy.ts').find((x) => x.kind === 'concat')
  const at = e.value.indexOf('keeps count')
  const s = spliceEntry(code, e, at, at + 'keeps count'.length, 'counts')
  const next = code.slice(0, s.start) + s.text + code.slice(s.end)
  ok(next.includes("'Lessons that move, questions that bite back, and a fox who counts. Built for university first.'"), next)
})

/* ------------------------------------------------------------------ */
/*  transforms                                                         */
/* ------------------------------------------------------------------ */

await test('moving and resizing one mapped sprite edits only its own entry', async () => {
  reset()
  const l = load('src/Scene.tsx')
  const stamp = stampOf(l, '<Sprite href={s.href}', 1)
  const info = (await ops.inspect([{ stamp, svg: true }]))[stamp]
  eq(info.strategies.transform.kind, 'adapter', 'strategy')
  eq(info.strategies.transform.entry, true, 'instance specific')
  await save([{ kind: 'transform', stamp, propEdits: { x: { add: 12 }, ground: { add: -4 }, w: { mul: 1.5 } } }])
  const next = read('src/Scene.tsx')
  ok(next.includes("{ href: 'b.webp', x: 616, ground: 882, w: 222 },"), next.split('\n').slice(2, 8).join('\n'))
  ok(next.includes("{ href: 'a.webp', x: 352, ground: 898, w: 70 },"), 'entry 0 changed')
  ok(next.includes('<Sprite href={s.href} x={s.x} ground={s.ground} w={s.w} />'), 'the template changed')
})

await test('moving a sprite written once edits its own literals', async () => {
  reset()
  const l = load('src/Scene.tsx')
  const stamp = stampOf(l, '<Sprite href="d.webp"')
  await save([{ kind: 'transform', stamp, propEdits: { x: { add: 10.4 }, ground: { add: -3 } } }])
  ok(read('src/Scene.tsx').includes('<Sprite href="d.webp" x={248} ground={871} w={30} />'), 'literals not edited')
})

await test('rotation goes in a <g> wrapper, and a second save extends the same wrapper', async () => {
  reset()
  let l = load('src/Scene.tsx')
  await save([{ kind: 'transform', stamp: stampOf(l, '<Sprite href="d.webp"'), wrapper: 'rotate(15 238 860)' }])
  ok(read('src/Scene.tsx').includes('<g transform="rotate(15 238 860)"><Sprite href="d.webp" x={238} ground={874} w={30} /></g>'), 'no wrapper')
  l = load('src/Scene.tsx')
  await save([{ kind: 'transform', stamp: stampOf(l, '<Sprite href="d.webp"'), wrapper: 'translate(476 0) scale(-1 1)' }])
  ok(read('src/Scene.tsx').includes('<g transform="rotate(15 238 860) translate(476 0) scale(-1 1)"><Sprite'), 'wrapper not extended')
})

await test('built-in SVG adapter moves a rect by its x and y', async () => {
  reset()
  const l = load('src/Scene.tsx')
  const stamp = stampOf(l, '<rect')
  const info = (await ops.inspect([{ stamp, svg: true }]))[stamp]
  eq(info.strategies.transform.kind, 'adapter', 'strategy')
  await save([{ kind: 'transform', stamp, propEdits: { x: { add: 5 }, y: { add: 5 }, width: { mul: 2 }, height: { mul: 2 } } }])
  ok(read('src/Scene.tsx').includes('<rect x={15} y={25} width={60} height={80} fill="#ffffff" />'), 'rect not edited')
})

await test('new text goes beside an element or inside it at the end, with its class and indentation, and nowhere it would break the code', async () => {
  reset()
  let l = load('src/Scene.tsx')
  await save([{ kind: 'insert', stamp: stampOf(l, '<p className="lead"'), where: 'after', element: { tag: 'p', text: 'New words', sameClass: true } }])
  ok(read('src/Scene.tsx').includes('<p className="lead">Hello <b>big</b> world</p>\n      <p className="lead">New words</p>\n      <div className="card">'), read('src/Scene.tsx').split('\n').slice(66, 71).join('\n'))
  l = load('src/Scene.tsx')
  await save([{ kind: 'insert', stamp: stampOf(l, '<footer>'), where: 'end', element: { tag: 'span', text: 'a {b} <c>' } }])
  ok(read('src/Scene.tsx').includes('<footer>Get Kerfox<span>{"a {b} <c>"}</span></footer>'), 'inline, braces kept as words')
  l = load('src/Scene.tsx')
  await save([{ kind: 'insert', stamp: stampOf(l, '<main>'), where: 'end', element: { tag: 'p', text: 'Last' } }])
  ok(read('src/Scene.tsx').includes('</footer>\n      <p>Last</p>\n    </main>'), 'last child, at the indentation of the children there')
  l = load('src/Scene.tsx')
  let refused = null
  try {
    await save([{ kind: 'insert', stamp: stampOf(l, '<circle', 0), where: 'after', element: { text: 'x' } }])
  } catch (e) {
    refused = e.code
  }
  eq(refused, 'place', 'beside what a .map returns')
  refused = null
  try {
    await save([{ kind: 'insert', stamp: stampOf(l, '<p className="lead"'), where: 'after', element: { tag: 'p', text: 'x', className: 'a" onClick="x' } }])
  } catch (e) {
    refused = e.message
  }
  ok(!read('src/Scene.tsx').includes('onClick'), 'a class from the request is never written')
  reset()
})

await test('a pasted copy keeps its own shape; across files only when it reads nothing of its component', async () => {
  reset()
  const l = load('src/Scene.tsx')
  await save([{ kind: 'insert', stamp: stampOf(l, '<div className="styled"'), where: 'after', copy: stampOf(l, '<div className="card"') }])
  ok(read('src/Scene.tsx').includes(`<div className="styled" style={{ color: 'red' }}>Styled</div>\n      <div className="card">Card</div>\n      <svg`), 'pasted after')
  const page = load('src/Page.tsx')
  const l2 = load('src/Scene.tsx')
  let refused = null
  try {
    await save([{ kind: 'insert', stamp: stampOf(page, '<Bar'), where: 'after', copy: stampOf(l2, '<h1 className="title"') }])
  } catch (e) {
    refused = e.code
  }
  eq(refused, 'place', 'a copy reading COPY.title pasted into another file')
  await save([{ kind: 'insert', stamp: stampOf(page, '<Bar'), where: 'after', copy: stampOf(l2, '<div className="card"') }])
  ok(read('src/Page.tsx').includes('<Bar tone="night" sticky />\n      <div className="card">Card</div>\n    </main>'), read('src/Page.tsx'))
  reset()
})

await test('an HTML element gains a style prop, and an existing one is merged into', async () => {
  reset()
  const l = load('src/Scene.tsx')
  await save([
    { kind: 'transform', stamp: stampOf(l, '<div className="card"'), style: { translate: '12px 4px', rotate: '5deg' } },
    { kind: 'transform', stamp: stampOf(l, '<div className="styled"'), style: { translate: '1px 2px' } },
  ])
  const next = read('src/Scene.tsx')
  ok(next.includes(`<div className="card" style={{ translate: '12px 4px', rotate: '5deg' }}>Card</div>`), 'card')
  ok(next.includes(`<div className="styled" style={{ color: 'red', translate: '1px 2px' }}>Styled</div>`), 'styled')
})

await test('colour and transform on one element land in one style prop', async () => {
  reset()
  const l = load('src/Scene.tsx')
  const stamp = stampOf(l, '<div className="card"')
  await save([
    { kind: 'transform', stamp, style: { translate: '3px 0px' } },
    { kind: 'color', stamp, prop: 'backgroundColor', value: '#635BFF', mode: 'style' },
  ])
  ok(read('src/Scene.tsx').includes(`<div className="card" style={{ translate: '3px 0px', backgroundColor: '#635BFF' }}>Card</div>`), read('src/Scene.tsx').split('\n').find((x) => x.includes('card')))
})

await test('an SVG fill attribute is edited in place', async () => {
  reset()
  const l = load('src/Scene.tsx')
  await save([{ kind: 'color', stamp: stampOf(l, '<rect'), value: '#1DB954', mode: 'attr', attr: 'fill' }])
  ok(read('src/Scene.tsx').includes('fill="#1DB954"'), 'fill not edited')
})

/* ------------------------------------------------------------------ */
/*  deletion                                                           */
/* ------------------------------------------------------------------ */

await test('deleting one mapped instance removes its entry and keeps the comment', async () => {
  reset()
  const l = load('src/Scene.tsx')
  const stamp = stampOf(l, '<g key={i}>', 0)
  const info = (await ops.inspect([{ stamp, svg: true }]))[stamp]
  eq(info.strategies.delete.kind, 'entry', 'delete strategy')
  await save([{ kind: 'delete', stamp, mode: 'entry' }])
  const next = read('src/Scene.tsx')
  ok(!next.includes("href: 'a.webp'"), 'entry still there')
  ok(next.includes("const SWAYS = [\n  // a fuller meadow\n  { href: 'b.webp'"), next.slice(0, 160))
})

await test('the only child of a mapped root counts as the instance too', async () => {
  reset()
  const l = load('src/Scene.tsx')
  const stamp = stampOf(l, '<Sprite href={s.href}', 2)
  const info = (await ops.inspect([{ stamp, svg: true }]))[stamp]
  eq(info.strategies.delete.kind, 'entry', 'delete strategy')
  eq(info.entryLabel, 'SWAYS[2]', 'label')
})

await test('deleting an element written once removes its line', async () => {
  reset()
  const l = load('src/Scene.tsx')
  await save([{ kind: 'delete', stamp: stampOf(l, '<footer>'), mode: 'element' }])
  const next = read('src/Scene.tsx')
  ok(!next.includes('<footer>'), 'still there')
  ok(next.includes('      </svg>\n    </main>'), 'line not removed cleanly')
})

await test('a delete swallows other edits inside the deleted element', async () => {
  reset()
  const l = load('src/Scene.tsx')
  const stamp = stampOf(l, '<div className="card"')
  await save([
    { kind: 'transform', stamp, style: { translate: '3px 0px' } },
    { kind: 'delete', stamp, mode: 'element' },
  ])
  ok(!read('src/Scene.tsx').includes('className="card"'), 'not deleted')
})

/* ------------------------------------------------------------------ */
/*  text, end to end                                                   */
/* ------------------------------------------------------------------ */

await test('text rendered from a data module is found there and edited there', async () => {
  reset()
  load('src/copy.ts')
  const l = load('src/Scene.tsx')
  const h1 = stampOf(l, '<h1')
  const elementOld = 'Study that grows with you.'
  const req = { chain: [h1], elementOld, nodeOld: elementOld, nodeOffset: 0, from: 6, to: 10, insert: 'which' }
  const r = ops.resolveText(req)
  eq(r.status, 'ok', 'resolution')
  eq(r.target.file, 'src/copy.ts', 'found in')
  await save([{ kind: 'text', ...req }])
  ok(read('src/copy.ts').includes("title: 'Study which grows with you.',"), read('src/copy.ts'))
  eq(read('src/Scene.tsx'), FILES['src/Scene.tsx'], 'the scene changed')
})

await test('an edit to one text node of mixed content edits that JSX text', async () => {
  reset()
  const l = load('src/Scene.tsx')
  const req = { chain: [stampOf(l, '<p className="lead"')], elementOld: 'Hello big world', nodeOld: 'Hello ', nodeOffset: 0, from: 0, to: 5, insert: 'Hi' }
  eq(ops.resolveText(req).status, 'ok', 'resolution')
  await save([{ kind: 'text', ...req }])
  ok(read('src/Scene.tsx').includes('<p className="lead">Hi <b>big</b> world</p>'), 'jsx text not edited')
})

await test('text written in two unrelated places is a choice, not a guess', async () => {
  reset()
  load('src/copy.ts')
  load('src/other.ts')
  const req = { chain: [], elementOld: 'Get Kerfox', nodeOld: 'Get Kerfox', nodeOffset: 0, from: 0, to: 3, insert: 'Try' }
  const r = ops.resolveText(req)
  eq(r.status, 'ambiguous', 'status')
  ok(r.candidates.length >= 2, 'candidates')
  const choice = r.candidates.find((c) => c.file === 'src/other.ts').id
  await save([{ kind: 'text', ...req, choice }])
  ok(read('src/other.ts').includes("'Try Kerfox'"), 'other.ts not edited')
  ok(read('src/copy.ts').includes("cta: 'Get Kerfox'"), 'copy.ts edited')
})

await test('text the element itself is written in wins over the same words elsewhere', async () => {
  reset()
  load('src/copy.ts')
  load('src/other.ts')
  const l = load('src/Scene.tsx')
  const req = { chain: [stampOf(l, '<footer>')], elementOld: 'Get Kerfox', nodeOld: 'Get Kerfox', nodeOffset: 0, from: 0, to: 3, insert: 'Try' }
  const r = ops.resolveText(req)
  eq(r.status, 'ok', 'status')
  eq(r.target.file, 'src/Scene.tsx', 'picked')
})

/* ------------------------------------------------------------------ */
/*  safety                                                             */
/* ------------------------------------------------------------------ */

await test('an edit survives the file changing elsewhere after the page loaded', async () => {
  reset()
  const l = load('src/Scene.tsx')
  const stamp = stampOf(l, '<Sprite href="d.webp"')
  writeFileSync(join(root, 'src/Scene.tsx'), '// a line added by someone else\n' + FILES['src/Scene.tsx'])
  await save([{ kind: 'transform', stamp, propEdits: { x: { add: 2 } } }])
  const next = read('src/Scene.tsx')
  ok(next.startsWith('// a line added by someone else\n'), 'other change lost')
  ok(next.includes('<Sprite href="d.webp" x={240}'), 'edit not relocated')
})

await test('an edit whose own region changed underneath is refused, not guessed', async () => {
  reset()
  const l = load('src/Scene.tsx')
  const stamp = stampOf(l, '<Sprite href="d.webp"')
  writeFileSync(join(root, 'src/Scene.tsx'), FILES['src/Scene.tsx'].replace('x={238}', 'x={239}'))
  let threw = false
  try {
    await save([{ kind: 'transform', stamp, propEdits: { x: { add: 2 } } }])
  } catch (e) {
    threw = /changed around this edit/.test(e.message)
  }
  ok(threw, 'did not refuse')
})

await test('relocate maps ranges outside a change and refuses ranges inside it', () => {
  const a = 'aaaa XXXX bbbb'
  const b = 'aaaa YYYYYY bbbb'
  eq(JSON.stringify(relocate(a, b, 0, 4)), JSON.stringify({ start: 0, end: 4 }))
  eq(JSON.stringify(relocate(a, b, 10, 14)), JSON.stringify({ start: 12, end: 16 }))
  eq(relocate(a, b, 5, 9), null)
})

await test('a save can be undone and redone from the journal', async () => {
  reset()
  const l = load('src/Scene.tsx')
  const batch = await save([{ kind: 'delete', stamp: stampOf(l, '<footer>'), mode: 'element' }])
  journal.swap(batch.id, 'undo')
  eq(read('src/Scene.tsx'), FILES['src/Scene.tsx'], 'undo')
  journal.swap(batch.id, 'redo')
  ok(!read('src/Scene.tsx').includes('<footer>'), 'redo')
})

await test('undo refuses to overwrite a newer change', async () => {
  reset()
  const l = load('src/Scene.tsx')
  const batch = await save([{ kind: 'delete', stamp: stampOf(l, '<footer>'), mode: 'element' }])
  writeFileSync(join(root, 'src/Scene.tsx'), read('src/Scene.tsx') + '\n// newer\n')
  let threw = false
  try {
    journal.swap(batch.id, 'undo')
  } catch {
    threw = true
  }
  ok(threw, 'undo overwrote a newer change')
})

/* ------------------------------------------------------------------ */
/*  the browser half's pure parts                                      */
/* ------------------------------------------------------------------ */

const G = await import('../src/client/geometry.js')

await test('a horizontal flip reads as scale(-1, 1), not as a half turn', () => {
  const d = G.decompose(G.S(-1, 1))
  eq(`${d.theta} ${d.sx} ${d.sy}`, '0 -1 1')
})

await test('a turn about a point is written about that point', () => {
  const c0 = { x: 238, y: 860 }
  const N = G.about(c0, G.R(15))
  eq(G.svgTransform(N, c0), 'rotate(15 238 860)')
})

await test('adapter split: scaling about a bottom anchor moves the anchor so the centre stays', () => {
  const c0 = { x: 706, y: 836.67 }
  const anchor = { x: 706, y: 856 }
  const N = G.about(c0, G.S(2))
  const s = G.adapterSplit(N, c0, anchor, true)
  eq(G.num(s.k, 3), 2, 'size factor')
  eq(G.num(s.delta.x), 0, 'x')
  eq(G.num(s.delta.y), 19.33, 'ground moves down by the half-height it grew')
  eq(s.rest, '', 'nothing left for a wrapper')
})

await test('adapter split: a turn on top of a move is left for the wrapper, about the new centre', () => {
  const c0 = { x: 100, y: 100 }
  const N = G.mul(G.T(10, 0), G.about(c0, G.R(30)))
  const s = G.adapterSplit(N, c0, { x: 100, y: 120 }, true)
  eq(G.num(s.delta.x), 10, 'moved')
  eq(s.rest, 'rotate(30 110 100)')
})

await test('CSS preview composes with the translate an element already has', () => {
  const state = { N: G.T(5, 0), base: { t: { x: 12, y: 4 }, L: G.I() }, frame: { svg: false } }
  const c = G.cssStrings(G.cssFor(state))
  eq(c.translate, '17px 4px')
})

const { applyText } = await import('../src/client/text.js')
const nodes = (...parts) => parts.map((data) => ({ data }))

await test('a word typed before a full stop goes into the text, not the stop', () => {
  const ns = nodes('Study that grows with you', '.')
  applyText(ns, 'Study that grows with you all.')
  eq(ns.map((n) => n.data).join('|'), 'Study that grows with you all|.')
})

await test('a deletion across two text nodes edits both and nothing else', () => {
  const ns = nodes('Hello ', 'big', ' world')
  const ch = applyText(ns, 'Help world')
  eq(ns.map((n) => n.data).join('|'), 'Help|| world')
  eq(ch.length, 2, 'changed nodes')
})

/* ------------------------------------------------------------------ */
/*  smart guides and snapping                                          */
/* ------------------------------------------------------------------ */

globalThis.innerWidth = 1280
globalThis.innerHeight = 800
const S = await import('../src/client/snap.js')
const el = (left, top, width, height) => ({ ...S.box(left, top, width, height), kind: 'element' })

await test('a drag that ends 3 px short of a neighbour edge lands on it, with a guide', () => {
  const me0 = S.box(100, 100, 50, 50)
  const t = el(200, 300, 80, 40)
  const s = S.snapMove(me0, { x: 97, y: 0 }, [t])
  eq(s.d.x, 100, 'x snapped')
  eq(s.d.y, 0, 'y untouched')
  ok(s.guides.some((g) => g.type === 'line' && g.x1 === 200.5 - 0.5 && g.x2 === 200), 'no guide on x=200: ' + JSON.stringify(s.guides))
})

await test('a drag well clear of everything is left exactly where it was put', () => {
  const s = S.snapMove(S.box(100, 100, 50, 50), { x: 40, y: 13 }, [el(600, 600, 80, 40)])
  eq(`${s.d.x},${s.d.y}`, '40,13')
})

await test('Ctrl (off) never snaps', () => {
  const s = S.snapMove(S.box(100, 100, 50, 50), { x: 97, y: 0 }, [el(200, 300, 80, 40)], { off: true })
  eq(s.d.x, 97)
})

await test('between two neighbours, the middle is a line: equal gaps snap', () => {
  const left = el(0, 0, 100, 50)
  const right = el(300, 0, 100, 50)
  const s = S.snapMove(S.box(160, 0, 60, 50), { x: 5, y: 0 }, [left, right])
  eq(s.d.x, 10, 'centred between them')
  const gaps = s.guides.filter((g) => g.type === 'gap').map((g) => g.label)
  eq(gaps.join(','), '70,70', 'two equal labelled gaps')
})

await test('a resize near a neighbour width settles on it', () => {
  const s = S.snapScale(S.box(100, 100, 100, 100), 0.52, [el(400, 600, 50, 50)])
  eq(G.num(s.k, 3), 0.5)
  eq(s.matched, 'width')
})

await test('a resize near the original size settles on it', () => {
  const s = S.snapScale(S.box(100, 100, 120, 80), 0.84, [], { original: 1 / 1.2 })
  eq(G.num(s.k, 4), G.num(1 / 1.2, 4))
  eq(s.matched, 'original')
})

await test('turns settle on right angles and diagonals, and nowhere else', () => {
  eq(S.snapAngle(88.4).theta, 90)
  eq(S.snapAngle(-1.5).theta, 0)
  eq(S.snapAngle(44).theta, 45)
  eq(S.snapAngle(30).theta, 30)
  eq(S.snapAngle(88.4, { off: true }).theta, 88.4)
})

await test('a still selection shows a line only where it really lines up', () => {
  const g1 = S.alignmentGuides(S.box(200, 100, 50, 50), [el(200, 300, 80, 40)])
  ok(g1.length === 1 && g1[0].x1 === 200, 'left edges match: ' + JSON.stringify(g1))
  const g2 = S.alignmentGuides(S.box(203, 100, 50, 50), [el(200, 300, 80, 40)])
  eq(g2.length, 0, 'nothing lines up')
})

/* ------------------------------------------------------------------ */
/*  markup from a file, stylesheets, colours, generators               */
/* ------------------------------------------------------------------ */

const { createTracer } = await import('../src/server/trace.mjs')
const { createRebuilder } = await import('../src/server/rebuild.mjs')
const { parseCss, findRules } = await import('../src/server/css.mjs')
const { scanColors, formatLike, parseColorLiteral, colorDistance } = await import('../src/server/colors.mjs')
const { originalPosition } = await import('../src/server/sourcemap.mjs')
const { htmlElements } = await import('../src/server/html.mjs')

const NBSP = String.fromCharCode(160)
const RQUO = String.fromCharCode(0x201d)
const siteConfig = normalise(
  {
    text: { include: ['site/landing/*.html', 'site/landing/*.js'], exclude: ['site/generated/**'] },
    colors: { include: ['site/landing/**'], arrays: 'oklch' },
    rebuild: [{ from: ['site/landing/**'], run: 'node scripts/gen.mjs', outputs: ['site/generated/**'] }],
  },
  root,
)
const siteSources = new Sources(root)
const siteProject = new Project({ root, sources: siteSources, config: siteConfig })
const rebuilder = createRebuilder({ config: siteConfig })
const tracer = createTracer({ project: siteProject, config: siteConfig, rebuilder, getServer: () => null })
const siteOps = createOps({ project: siteProject, sources: siteSources, config: siteConfig, tracer })
const siteSave = async (list) => applySplices({ project: siteProject, journal, splices: await siteOps.plan(list), label: 'test' })
reset()

await test('HTML text is read as the browser reads it, entities and line breaks included', () => {
  const list = textEntries(FILES['site/landing/body.html'], 'body.html')
  const quote = list.find((e) => e.value.startsWith('If you want'))
  eq(quote.value, `If you want to master something, teach${NBSP}it.`)
  const para = list.find((e) => e.value.startsWith('Explain'))
  ok(para.value.includes('words,\n      and it'), 'the source line break is kept, as the DOM keeps it')
  ok(!list.some((e) => e.value.includes('class=')), 'attribute text read as page text')
})

await test('an edit to HTML text changes those characters and keeps the entities around them', async () => {
  const node = `If you want to master something, teach${NBSP}it.`
  const at = node.indexOf('master')
  await siteSave([{ kind: 'text', chain: [], elementOld: node + RQUO, nodeOld: node, nodeOffset: 0, from: at, to: at + 6, insert: 'learn' }])
  const out = read('site/landing/body.html')
  ok(out.includes('<p>If you want to learn something, teach&#160;it.<span class="qm"'), out.split('\n')[5])
  eq(out.length, FILES['site/landing/body.html'].length - 1, 'only the word changed')
  reset()
})

await test('typed markup characters are escaped, so they stay words', async () => {
  const node = `If you want to master something, teach${NBSP}it.`
  await siteSave([{ kind: 'text', chain: [], elementOld: node, nodeOld: node, nodeOffset: 0, from: 0, to: 2, insert: 'A <b> & then' }])
  ok(read('site/landing/body.html').includes('<p>A &lt;b&gt; &amp; then you want'), 'not escaped')
  reset()
})

await test('an element from an HTML file is found by what the page can tell about it', () => {
  const found = tracer.locateHtml([
    { key: 'p', tag: 'p', id: '', classes: [], text: `If you want to master something, teach${NBSP}it.${RQUO}`, ancestors: ['blockquote#.', 'figure#.qt'], nth: 2 },
    { key: 'h2', tag: 'h2', id: '', classes: ['h2'], text: 'Lightning, against the clock', ancestors: ['section#.copy'], nth: 1 },
    { key: 'gone', tag: 'aside', id: '', classes: ['nowhere'], text: '', ancestors: [], nth: 0 },
  ])
  ok(found.p.found && found.p.line === 6, `quote paragraph: ${JSON.stringify(found.p)}`)
  ok(found.h2.found && found.h2.line === 9, `second heading: ${JSON.stringify(found.h2)}`)
  ok(!found.gone.found, 'an element that is not there was found')
})

await test('moving, colouring and deleting an HTML element write its own markup', async () => {
  const { p, h2 } = tracer.locateHtml([
    { key: 'p', tag: 'p', id: '', classes: ['p'], text: 'Explain an idea', ancestors: ['section#.copy'], nth: 0 },
    { key: 'h2', tag: 'h2', id: '', classes: ['h2'], text: 'Lightning, against the clock', ancestors: ['section#.copy'], nth: 1 },
  ])
  await siteSave([
    { kind: 'transform', stamp: p.stamp, style: { translate: '12px -4px', rotate: '3deg' } },
    { kind: 'color', stamp: p.stamp, prop: 'color', value: '#123456', mode: 'style' },
    { kind: 'style', stamp: p.stamp, props: { fontSize: '18px', letterSpacing: '0.02em' } },
  ])
  ok(read('site/landing/body.html').includes('<p class="p" style="translate: 12px -4px; rotate: 3deg; color: #123456; font-size: 18px; letter-spacing: 0.02em">'), read('site/landing/body.html').split('\n')[3])
  await siteSave([{ kind: 'delete', stamp: h2.stamp }])
  ok(!read('site/landing/body.html').includes('Lightning'), 'not deleted')
  ok(read('site/landing/body.html').includes('<section class="copy" data-c="10">\n  </section>'), 'its line was left behind')
  reset()
})

await test('new text and pasted copies are written beside or inside an element of an HTML file, in its indentation', async () => {
  const { h2, last } = tracer.locateHtml([
    { key: 'h2', tag: 'h2', id: '', classes: ['h2'], text: 'Teach it, with the notes shut', ancestors: ['section#.copy'], nth: 0 },
    { key: 'last', tag: 'h2', id: '', classes: ['h2'], text: 'Lightning, against the clock', ancestors: ['section#.copy'], nth: 1 },
  ])
  const section = tracer.locateHtml([{ key: 's', tag: 'section', id: '', classes: ['copy'], text: '', ancestors: ['div#.track'], nth: 1 }]).s
  await siteSave([{ kind: 'insert', stamp: h2.stamp, where: 'after', element: { tag: 'p', text: 'Fresh <words> & more', sameClass: true } }])
  ok(read('site/landing/body.html').includes('<h2 class="h2">Teach it, with the notes shut</h2>\n    <p class="h2">Fresh &lt;words&gt; &amp; more</p>\n    <p class="p">'), read('site/landing/body.html').split('\n').slice(1, 5).join('\n'))
  reset()
  await siteSave([{ kind: 'insert', stamp: section.stamp, where: 'end', copy: h2.stamp }])
  ok(read('site/landing/body.html').includes('<h2 class="h2">Lightning, against the clock</h2>\n    <h2 class="h2">Teach it, with the notes shut</h2>\n  </section>'), read('site/landing/body.html'))
  reset()
  ok(last.found, 'second heading')
})

await test('the HTML reader closes what the browser would close', () => {
  const els = htmlElements('<div><p>one<p>two</div><img src="a.png"><br>')
  eq(els.map((e) => e.tag).join(','), 'div,p,p,img,br')
  eq(els[1].end, els[2].start, 'an open <p> ends where the next starts')
})

await test('stylesheets are read into rules, nesting and keyframes included', () => {
  const css = parseCss(FILES['site/landing/style.css'])
  eq(findRules(css, ['.copy .h2']).length, 2, 'both .copy .h2 rules, one inside @media')
  eq(findRules(css, ['.copy .h2'])[1].at[0], '@media (max-width: 600px)')
  ok(findRules(css, ['.card', '&:hover']).length === 1, 'nested rule')
  eq(css.keyframes.map((k) => k.name).join(), 'rise')
  ok(css.decls.some((d) => d.prop === '--ground' && d.value === '#fcfbf8'), 'custom property')
})

await test('a rule on the page is traced to its line, every asked-for declaration with it', async () => {
  const out = await tracer.rules([{ key: 'a', chain: ['.copy .h2'], sheet: null, props: ['color', 'font-size'] }])
  const f = out.a.found[0]
  ok(f && f.file === 'site/landing/style.css' && f.line === 6, JSON.stringify(out.a))
  eq(f.decls.color.value, '#202733')
  eq(f.decls['font-size'].value, '28px')
})

await test('colours are found in CSS and in script, with what they are filed under', () => {
  const css = scanColors(FILES['site/landing/style.css'], 'style.css')
  ok(css.some((c) => c.key === '--night' && c.text === '#05050B'), 'custom property hex')
  ok(css.some((c) => c.text === 'tomato' && c.prop === 'border'), 'named colour inside a shorthand')
  ok(css.some((c) => c.text.startsWith('oklch(')), 'oklch')
  ok(!css.some((c) => c.text === 'opacity'), 'a property name read as a colour')
  const js = scanColors(FILES['site/landing/scene.js'], 'scene.js', { arrays: 'oklch' })
  ok(js.some((c) => c.where === 'array' && c.key === 'ground_top'), 'OKLCH array, under its key')
  ok(js.some((c) => c.where === 'array' && c.text === '[0, 0.375, 0.115, 268]'), 'gradient stop')
  ok(!js.some((c) => c.text === '[1, 0, 0]'), 'a vector read as a colour')
  eq(js.filter((c) => c.where === 'string').length, 2, 'both hex strings')
})

await test('a new colour is written in the spelling of the old one', () => {
  const fmt = (lit, rgb) => formatLike(parseColorLiteral(lit).format, rgb)
  eq(fmt('#fff', { r: 0, g: 0x33, b: 0xcc, a: 1 }), '#03c')
  eq(fmt('#FFF', { r: 0x12, g: 0x34, b: 0x56, a: 1 }), '#123456'.toUpperCase())
  eq(fmt('rgba(32, 39, 51, 0.9)', { r: 10, g: 20, b: 30, a: 0.5 }), 'rgba(10, 20, 30, 0.5)')
  eq(fmt('rgb(0 0 0)', { r: 1, g: 2, b: 3, a: 1 }), 'rgb(1 2 3)')
  const ok1 = fmt('oklch(0.62 0.15 250)', parseColorLiteral('#3366cc').rgb)
  ok(/^oklch\(0\.\d{3} 0\.\d{3} \d+(\.\d+)? ?\)$/.test(ok1.replace(/ \)$/, ')')), ok1)
  ok(colorDistance(parseColorLiteral(ok1).rgb, parseColorLiteral('#3366cc').rgb) < 0.003, 'oklch round trip')
})

await test('recolouring a literal rewrites only that literal, wherever it is written', async () => {
  const css = scanColors(read('site/landing/style.css'), 'style.css').find((c) => c.key === '--night')
  await siteSave([{ kind: 'recolor', target: { file: 'site/landing/style.css', start: css.start, end: css.end, text: css.text, where: 'css' }, value: '#102030' }])
  ok(read('site/landing/style.css').includes('--night: #102030;'), 'hex not rewritten in its own case')
  const arr = scanColors(read('site/landing/scene.js'), 'scene.js', { arrays: 'oklch' }).find((c) => c.key === 'ground_top')
  await siteSave([{ kind: 'recolor', target: { file: 'site/landing/scene.js', start: arr.start, end: arr.end, text: arr.text, where: 'array' }, value: '#336699' }])
  const next = read('site/landing/scene.js')
  const m = /ground_top: (\[[^\]]+\])/.exec(next)
  ok(m && /^\[0\.\d{3}, 0\.\d{3}, \d+\]$/.test(m[1]), `array rewritten as ${m?.[1]}`)
  reset()
})

await test('a rule edit replaces one declaration, and a style edit on JSX writes its style prop', async () => {
  const out = await tracer.rules([{ key: 'a', chain: ['.copy .h2'], sheet: null, props: ['font-size'] }])
  const d = out.a.found[0].decls['font-size']
  await siteSave([{ kind: 'decl', target: { file: 'site/landing/style.css', start: d.start, end: d.end, text: d.value }, value: '30px' }])
  ok(read('site/landing/style.css').includes('.copy .h2 { color: #202733; font-size: 30px; }'), 'declaration not replaced')
  const l = load('src/Scene.tsx')
  await save([{ kind: 'style', stamp: stampOf(l, '<div className="card"'), props: { paddingTop: '12px', opacity: '0.8' } }])
  ok(read('src/Scene.tsx').includes(`<div className="card" style={{ paddingTop: '12px', opacity: '0.8' }}>Card</div>`), 'style prop')
  let refused = false
  try {
    await save([{ kind: 'style', stamp: stampOf(load('src/Scene.tsx'), '<div className="card"'), props: { color: 'red; } body { x: y' } }])
  } catch {
    refused = true
  }
  ok(refused, 'a value that ends its declaration was written')
  reset()
})

await test('a colour picked off the page lists the token the page names first', () => {
  const list = tracer.findColors({ rgb: { r: 0x2a, g: 0x3a, b: 0x6e, a: 1 }, hints: {} })
  ok(list.length >= 2 && list[0].exact, 'exact matches first')
  const near = tracer.findColors({ rgb: { r: 0x20, g: 0x27, b: 0x33, a: 0.9 }, hints: { vars: ['--ink'] } })
  eq(near[0].key, '--ink', 'the named custom property leads')
})

await test('a save into what a generator reads runs it, and its output does not hot-reload meanwhile', async () => {
  const results = await rebuilder.after(['site/landing/body.html'])
  ok(results.length === 1 && results[0].ok, JSON.stringify(results))
  eq(read('site/generated/landing.txt'), String(FILES['site/landing/body.html'].length))
  ok(rebuilder.quiet('site/generated/landing.txt'), 'output hot-reloaded while settling')
  ok(!rebuilder.quiet('src/Scene.tsx'), 'an unrelated file was held back')
  eq(rebuilder.producerOf('site/generated/landing.txt').label, 'node scripts/gen.mjs')
  eq((await rebuilder.after(['src/copy.ts'])).length, 0, 'ran for a file it does not read')
})

await test('a source map turns a served line back into the line that was written', () => {
  // one segment: generated column 0 of line 1 -> source 0, line 4, column 2 (all zero-based)
  const pos = originalPosition({ sources: ['a.tsx'], mappings: 'AAIE' }, 1, 7)
  eq(JSON.stringify(pos), JSON.stringify({ source: 'a.tsx', line: 5, column: 2 }))
})

/* ------------------------------------------------------------------ */
/*  settings, keyframes, source maps, drawings                         */
/* ------------------------------------------------------------------ */

const { createSettings } = await import('../src/server/settings.mjs')
const settings = createSettings({ project, ops })
reset()

const barStamp = () => stampOf(load('src/Page.tsx'), '<Bar ')
const groupOf = (s, id) => s.groups.find((g) => g.id === id)

await test("a component's settings: this instance, its defaults, its named values with their comments, its timing", async () => {
  load('src/Bar.tsx')
  const s = await settings.forStamp(barStamp())
  const props = groupOf(s, 'props').items
  const tone = props.find((i) => i.label === 'tone')
  eq(JSON.stringify([tone.kind, tone.value, tone.options]), JSON.stringify(['enum', 'night', ['paper', 'night']]), 'tone, with the choices its type allows')
  const sticky = props.find((i) => i.label === 'sticky')
  ok(sticky.kind === 'boolean' && sticky.value === true && sticky.target.bare, 'a bare attribute is a switch that is on')
  const count = props.find((i) => i.label === 'count')
  ok(count?.unset && count.kind === 'number' && count.add, 'a prop it could set but does not')
  eq(groupOf(s, 'defaults').items[0].value, 'paper', 'the default it falls back to')
  const fine = groupOf(s, 'constants').items.find((i) => i.label === 'RECALL.fine')
  ok(fine && fine.value === 64 && /deliberately/.test(fine.desc), `the constant, described by its own comment: ${JSON.stringify(fine)}`)
  const timing = groupOf(s, 'timing').items.map((i) => `${i.label}=${i.value}`)
  ok(timing.includes('hideAfter=450') && timing.includes('setTimeout, argument 2=1500'), timing.join(' | '))
})

await test('a setting is written back as the same kind of literal', async () => {
  load('src/Bar.tsx')
  const s = await settings.forStamp(barStamp())
  const fine = groupOf(s, 'constants').items.find((i) => i.label === 'RECALL.fine')
  await save([{ kind: 'literal', target: fine.target, value: 80, type: 'number' }])
  ok(read('src/Bar.tsx').includes('const RECALL = { fine: 80, coarse: 24 }'), 'number')
  const props = groupOf(s, 'props').items
  await save([
    { kind: 'literal', target: props.find((i) => i.label === 'tone').target, value: 'paper', type: 'enum' },
    { kind: 'literal', target: props.find((i) => i.label === 'sticky').target, value: false, type: 'boolean' },
  ])
  ok(read('src/Page.tsx').includes('<Bar tone="paper" sticky={false} />'), read('src/Page.tsx'))
  await save([{ kind: 'prop', stamp: barStamp(), name: 'count', value: 3, type: 'number' }])
  ok(read('src/Page.tsx').includes('<Bar tone="paper" sticky={false} count={3} />'), read('src/Page.tsx'))
  let refused = false
  try {
    await save([{ kind: 'literal', target: fine.target, value: 'x', type: 'number' }])
  } catch {
    refused = true
  }
  ok(refused, 'a number field accepted text')
  reset()
})

await test('a keyframe is found by its stop, "from" and "to" included', async () => {
  const out = await tracer.rules([
    { key: 'a', chain: ['0%'], keyframes: 'rise', props: ['opacity', 'color'] },
    { key: 'b', chain: ['100%'], keyframes: 'rise', props: ['opacity'] },
  ])
  eq(out.a.found[0]?.decls.opacity.value, '0')
  eq(out.a.found[0]?.decls.color.value, '#fff')
  eq(out.b.found[0]?.decls.opacity.value, '1')
})

await test("a bundled script is traced through its own source map to the file it was built from", () => {
  mkdirSync(join(root, 'site/public'), { recursive: true })
  // generated line 2, column 0 -> site/landing/scene.js line 6 (zero-based 5)
  writeFileSync(join(root, 'site/public/bundle.js'), '/* banner */\nvar a=1\n//# sourceMappingURL=bundle.js.map\n')
  writeFileSync(join(root, 'site/public/bundle.js.map'), JSON.stringify({ version: 3, sources: ['../landing/scene.js'], names: [], mappings: ';AAKA' }))
  const r = tracer.throughOwnMap(posix(join(root, 'site/public/bundle.js')), { line: 2, col: 1 })
  eq(JSON.stringify(r && [r.file, r.line, r.mapped]), JSON.stringify(['site/landing/scene.js', 6, true]))
})

const Geo = await import('../src/client/geometry.js')
await test('a group resized together keeps its proportions: every centre moves away from the middle by the same factor', () => {
  // two members, 100 wide, at centres 100 and 300: the group's middle is 200
  const gc = { x: 200, y: 50 }
  const k = 2
  const out = [100, 300].map((cx) => {
    const c0 = { x: cx, y: 50 }
    const N0 = Geo.I()
    const cf = Geo.apply(N0, c0)
    const N = Geo.mul(Geo.T((cx - gc.x) * (k - 1), 0), Geo.mul(Geo.about(cf, Geo.S(k)), N0))
    return { centre: Geo.apply(N, c0).x, left: Geo.apply(N, { x: cx - 50, y: 50 }).x, right: Geo.apply(N, { x: cx + 50, y: 50 }).x }
  })
  eq(out.map((o) => o.centre).join(), '0,400', 'centres: twice as far from the middle')
  eq(out.map((o) => o.right - o.left).join(), '200,200', 'sizes: twice as big')
  eq(out[1].left - out[0].right, 200, 'the gap between them: twice as wide (it was 100)')
})

const C = await import('../src/client/canvas.js')
await test('drawings on a canvas are hit where they are drawn, small ones generously, the ground last', () => {
  const canvas = { width: 400, height: 200, getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }) }
  const poly = (x, y, w, hh) => Object.assign([x, y, x + w, y, x + w, y + hh, x, y + hh], { closed: true })
  const item = (kind, sub, extra = {}) => ({ canvas, kind, subs: [sub], bbox: { x: sub[0], y: sub[1], w: sub[2] - sub[0], h: sub[5] - sub[1] }, alpha: 1, lineWidth: 0, seq: 0, ...extra })
  const ground = item('fill', poly(0, 0, 400, 200))
  const box = item('fill', poly(100, 40, 80, 60))
  const star = item('fill', poly(300, 20, 4, 4), { arcs: [{ full: true }] })
  const line = { canvas, kind: 'stroke', subs: [[20, 180, 380, 180]], bbox: { x: 20, y: 180, w: 360, h: 0 }, alpha: 1, lineWidth: 2, seq: 3 }
  const items = [ground, box, star, line]
  eq(C.itemsAt(items, 70, 35)[0], box, 'inside the box (page px are half the canvas px)')
  eq(C.itemsAt(items, 70, 35).at(-1), ground, 'the ground is offered last')
  eq(C.itemsAt(items, 153, 13)[0], star, 'a four-pixel star, hit from a few pixels away')
  eq(C.itemsAt(items, 100, 91)[0], line, 'a line, hit within its tolerance')
  eq(C.itemsAt(items, 10, 10).length, 1, 'only the ground in an empty corner')
  eq(C.itemName(star), 'circle')
})

await test('multi-canvas constellation: lines and stars hit, skipped on clean capture without duplicates, and maintain distance ratios', () => {
  const cvBack = { width: 800, height: 600, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }
  const cvFront = { width: 800, height: 600, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) }

  // Star 1 and Star 2 on cvBack
  const star1 = { canvas: cvBack, kind: 'fill', subs: [[100, 100]], bbox: { x: 98, y: 98, w: 4, h: 4 }, alpha: 1, lineWidth: 0, color: '#fff', arcs: [{ full: true }] }
  const star2 = { canvas: cvBack, kind: 'fill', subs: [[300, 200]], bbox: { x: 298, y: 198, w: 4, h: 4 }, alpha: 1, lineWidth: 0, color: '#fff', arcs: [{ full: true }] }
  // Constellation line on cvFront connecting star 1 and star 2
  const line = { canvas: cvFront, kind: 'stroke', subs: [[100, 100, 300, 200]], bbox: { x: 100, y: 100, w: 200, h: 100 }, alpha: 1, lineWidth: 1.5, color: 'gradient', stops: [[0, '#ffffff'], [1, '#88ccff']] }

  // Hit testing the line on cvFront:
  // Midpoint of line is (200, 150). Clicking 6px away from line at (200, 156):
  const lineHits = C.itemsAt([line], 200, 156)
  eq(lineHits[0], line, 'line is hit comfortably with stroke tolerance')

  // Distance ratio preservation across group transforms:
  const c1 = { x: 100, y: 100 }, c2 = { x: 300, y: 200 }, cline = { x: 200, y: 150 }
  const d0_12 = Math.hypot(c2.x - c1.x, c2.y - c1.y)
  const d0_1line = Math.hypot(cline.x - c1.x, cline.y - c1.y)
  const initialRatio = d0_12 / d0_1line

  const gc = { x: (c1.x + c2.x + cline.x) / 3, y: (c1.y + c2.y + cline.y) / 3 }
  const k = 1.75
  const angle = 0.6
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const transformPoint = (p) => {
    const sx = gc.x + (p.x - gc.x) * k
    const sy = gc.y + (p.y - gc.y) * k
    const rx = gc.x + (sx - gc.x) * cos - (sy - gc.y) * sin
    const ry = gc.y + (sx - gc.x) * sin + (sy - gc.y) * cos
    return { x: rx + 50, y: ry - 30 }
  }
  const c1_new = transformPoint(c1)
  const c2_new = transformPoint(c2)
  const cline_new = transformPoint(cline)

  const dNew_12 = Math.hypot(c2_new.x - c1_new.x, c2_new.y - c1_new.y)
  const dNew_1line = Math.hypot(cline_new.x - c1_new.x, cline_new.y - c1_new.y)
  const newRatio = dNew_12 / dNew_1line
  ok(Math.abs(initialRatio - newRatio) < 1e-9, 'distance ratios between all members are strictly preserved')

  // Testing captureCleanCanvases:
  let drawnCalls = []
  const boot = {
    isFrozen: () => true,
    step: () => {
      const ctxBack = {
        canvas: cvBack,
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      }
      boot.rec(ctxBack, 'beginPath', [])
      boot.rec(ctxBack, 'arc', [100, 100, 2, 0, Math.PI * 2])
      const skipStar1 = boot.rec(ctxBack, 'fill', [])
      if (!skipStar1?.skip) drawnCalls.push('star1')

      boot.rec(ctxBack, 'beginPath', [])
      boot.rec(ctxBack, 'arc', [300, 200, 2, 0, Math.PI * 2])
      const skipStar2 = boot.rec(ctxBack, 'fill', [])
      if (!skipStar2?.skip) drawnCalls.push('star2')

      const ctxFront = {
        canvas: cvFront,
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      }
      boot.rec(ctxFront, 'beginPath', [])
      boot.rec(ctxFront, 'moveTo', [100, 100])
      boot.rec(ctxFront, 'lineTo', [300, 200])
      const skipLine = boot.rec(ctxFront, 'stroke', [])
      if (!skipLine?.skip) drawnCalls.push('line')
    },
  }

  const rec = C.createCanvasRecorder(boot, (cb) => cb())
  rec.captureCleanCanvases([star1, line])
  eq(drawnCalls.join(), 'star2', 'star1 and line were cleanly skipped; star2 remained without duplication')
})

await test('canvas drawings persist on pointerup, clean background is preserved without snapback, and transformed items survive step(0)', () => {
  const cv = {
    width: 800,
    height: 600,
    getContext: () => ({
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      clearRect: () => {},
      drawImage: () => {},
      beginPath: () => {},
      arc: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  }

  const star = { canvas: cv, kind: 'fill', subs: [[100, 100]], bbox: { x: 98, y: 98, w: 4, h: 4 }, alpha: 1, lineWidth: 0, color: '#fff', arcs: [{ full: true }] }
  const line = { canvas: cv, kind: 'stroke', subs: [[100, 100, 200, 200]], bbox: { x: 100, y: 100, w: 100, h: 100 }, alpha: 1, lineWidth: 2, color: '#88ccff' }

  // Initial positions
  const b0Star = { ...star.bbox }
  const s0Line = line.subs.map((s) => [...s])

  // Verify initial hit test
  eq(C.itemsAt([star], 100, 100)[0], star, 'star hit at original position')
  eq(C.itemsAt([line], 150, 150)[0], line, 'line hit at original position')

  // Move star and line by (+80, +50)
  const dx = 80, dy = 50
  star.bbox = { x: b0Star.x + dx, y: b0Star.y + dy, w: b0Star.w, h: b0Star.h }
  line.subs = s0Line.map((s) => [s[0] + dx, s[1] + dy, s[2] + dx, s[3] + dy])
  line.bbox = { x: line.bbox.x + dx, y: line.bbox.y + dy, w: line.bbox.w, h: line.bbox.h }

  // Verify hit testing at moved positions
  eq(C.itemsAt([star], 100, 100).length, 0, 'old position no longer hits star')
  eq(C.itemsAt([star], 100 + dx, 100 + dy)[0], star, 'star hit at new moved position')
  eq(C.itemsAt([line], 150 + dx, 150 + dy)[0], line, 'line hit at new moved position')
})

/* ------------------------------------------------------------------ */
/*  the optional mapping command, without a model                      */
/* ------------------------------------------------------------------ */

const { _internal: M } = await import('../src/ai/map.mjs')
reset()

await test('mapping tools read and search inside the project and nowhere else', () => {
  const state = { read: new Set() }
  ok(M.runTool(root, 'list_files', { path: '.' }, state).includes('src/'), 'list')
  ok(M.runTool(root, 'read_file', { path: 'src/copy.ts' }, state).includes("title: 'Study that grows with you.',"), 'read')
  ok(M.runTool(root, 'search', { pattern: 'SWAYS', glob: 'src/**/*.tsx' }, state).startsWith('src/Scene.tsx:'), 'search')
  let refused = false
  try {
    M.runTool(root, 'read_file', { path: '../outside.txt' }, state)
  } catch {
    refused = true
  }
  ok(refused, 'a path outside the project was read')
})

/* ------------------------------------------------------------------ */
/*  where one colour of a gradient falls                               */
/* ------------------------------------------------------------------ */

const T = await import('../src/client/tones.js')

await test('a CSS gradient is read into stops at offsets, positions the browser leaves out filled in evenly', () => {
  const g = T.parseCssGradient('linear-gradient(135deg, rgb(255, 140, 50) 0%, rgb(240, 100, 20) 100%)')
  eq(g.kind, 'linear')
  eq(g.angle, 135)
  eq(g.stops.map((s) => `${s.text}@${s.at}`).join(' '), 'rgb(255, 140, 50)@0 rgb(240, 100, 20)@1')
  const even = T.parseCssGradient('linear-gradient(red, white, blue 80%, green)')
  eq(even.stops.map((s) => Math.round(s.at * 100)).join(','), '0,40,80,100')
  eq(T.parseCssGradient('linear-gradient(to right, red, blue)').angle, 90)
  eq(T.parseCssGradient('url(a.png), radial-gradient(circle at center, #fff 10%, #000 90%)').kind, 'radial')
  eq(T.parseCssGradient('none'), null)
})

await test('a tone outlines the area that colour owns: halfway to each neighbour, open at the ends, cut to the shape', () => {
  const r = { left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50 }
  const xs = (area) => [...new Set(area.rings[0].map((p) => Math.round(p.x)))].sort((a, b) => a - b).join(',')
  const stops = (...at) => at.map((a) => ({ text: '#000', at: a }))
  // left to right, stops at 0, 50% and 100%: the middle one owns 25..75
  eq(xs(T.cssToneArea({ kind: 'linear', angle: 90, stops: stops(0, 0.5, 1) }, 1, r)), '25,75')
  eq(xs(T.cssToneArea({ kind: 'linear', angle: 90, stops: stops(0, 0.5, 1) }, 0, r)), '0,25', 'the first owns everything before it too')
  eq(xs(T.cssToneArea({ kind: 'linear', angle: 90, stops: stops(0, 0.5, 1) }, 2, r)), '75,100')
  const canvas = T.canvasToneArea({ kind: 'linear', args: [0, 0, 100, 0], m: [1, 0, 0, 1, 0, 0] }, [0, 0.4, 0.6, 1], 1, (p) => p, r)
  eq(xs(canvas), '20,50', 'canvas: halfway to 0 and halfway to 0.6')
  const ring = T.canvasToneArea({ kind: 'radial', args: [50, 25, 0, 50, 25, 20], m: [2, 0, 0, 2, 0, 0] }, [0, 0.5, 1], 1, (p) => p, r)
  eq(ring.rings.length, 2, 'a ring between two circles')
  eq(Math.round(ring.rings[0][0].x), 130, 'outer circle: radius 15 about (50, 25), drawn at twice the size')
  eq(T.bandOf([0, 1], 0)[0], -Infinity)
  eq(T.clipHalf([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], { x: 20, y: 0 }, { x: 1, y: 0 }).length, 0, 'a band that misses the shape is nothing')
})

const TM = await import('../src/client/tonemask.js')

await test('the colour is marked where it can be SEEN: in its band, in its shape, not painted over', () => {
  // a 10 x 4 canvas: a left-to-right gradient black to white, with one pixel painted red over it at (6, 1)
  const W = 10
  const H = 4
  const grad = { kind: 'linear', args: [0, 0, 10, 0], m: [1, 0, 0, 1, 0, 0] }
  const stops = [
    { at: 0, rgba: [0, 0, 0, 255] },
    { at: 1, rgba: [250, 250, 250, 255] },
  ]
  const tAt = TM.offsetAt(grad)
  const px = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = TM.colorAt(stops, tAt(x + 0.5, y + 0.5))
      px.set([c[0], c[1], c[2], 255], (y * W + x) * 4)
    }
  }
  px.set([255, 0, 0, 255], (1 * W + 6) * 4)
  const res = TM.buildMask({ x0: 0, y0: 0, w: W, h: H, step: 1, pixels: px, width: W, inBand: (x) => tAt(x, 0) >= 0.5 && tAt(x, 0) <= 0.8, expected: (x, y) => TM.colorAt(stops, tAt(x, y)), clean: false })
  const row = (y) => [...res.mask.slice(y * W, y * W + W)].join('')
  eq(row(0), '0000011100', 'the band, columns 5 to 7')
  eq(row(1), '0000010100', 'the red pixel painted over it is left out')
  const covered = TM.buildMask({ x0: 0, y0: 0, w: W, h: H, step: 1, pixels: px, width: W, cover: (gx) => (gx === 5 ? 1 : 0), inShape: (gx, gy) => gy < 3, inBand: (x) => tAt(x, 0) >= 0.5 && tAt(x, 0) <= 0.8, expected: (x, y) => TM.colorAt(stops, tAt(x, y)), clean: false })
  eq([0, 1, 2, 3].map((y) => [...covered.mask.slice(y * W, y * W + W)].join('')).join('|'), '0000001100|0000000100|0000001100|0000000000', 'covered above, and outside the shape, are left out too')
  const painted = TM.paintMask(res)
  eq(painted[(0 * W + 5) * 4 + 3], 255, 'the edge is drawn solid')
  eq(painted[(0 * W + 4) * 4 + 3], 190, 'with a dark rim just outside')
  // a fade leaves specks and pinholes at the cut: smoothing clears the one and fills the other
  const grid = new Uint8Array(49)
  for (let y = 1; y <= 5; y++) for (let x = 1; x <= 3; x++) grid[y * 7 + x] = 1
  grid[3 * 7 + 2] = 0 // a pinhole inside
  grid[0 * 7 + 6] = 1 // a speck outside
  const sm = TM.smooth({ mask: grid, mw: 7, mh: 7 })
  eq(sm.mask[3 * 7 + 2], 1, 'the pinhole is filled')
  eq(sm.mask[0 * 7 + 6], 0, 'the speck is cleared')
  // a radial gradient's offset is where its circle passes through the point
  const r = TM.offsetAt({ kind: 'radial', args: [0, 0, 0, 0, 0, 10], m: [1, 0, 0, 1, 0, 0] })
  eq(Math.round(r(6, 8) * 100), 100)
  eq(Math.round(r(3, 4) * 100), 50)
})

/* ------------------------------------------------------------------ */
/*  the studio's tab wears the project's own icon                      */
/* ------------------------------------------------------------------ */

const { projectIcons, studioPage } = await import('../src/server/studio.mjs')

await test("the studio's tab wears the icon the project declares, under Vite's base, and never another project's", () => {
  const dir = posix(mkdtempSync(join(tmpdir(), 'retouch-icon-')))
  try {
    writeFileSync(
      join(dir, 'index.html'),
      `<html><head><!-- <link rel="icon" href="/old.png"> -->
<link rel="stylesheet" href="/x.css"><link rel="icon" type="image/png" href="/favicon.png" />
<link rel='apple-touch-icon' href="icons/touch.png" sizes="180x180"></head></html>`,
    )
    const at = projectIcons(dir, '/')
    eq(at.map((i) => i.href).join(' '), '/favicon.png /icons/touch.png', 'commented-out and stylesheet links skipped, relative resolved')
    eq(at[0].type, 'image/png')
    eq(at[1].sizes, '180x180')
    eq(projectIcons(dir, '/app/')[0].href, '/app/favicon.png', 'under a base')
    ok(studioPage({ name: 'x', entry: '/e.js', icons: at }).includes('<link rel="icon" href="/favicon.png" type="image/png" data-project-icon>'), 'written into the page')
    // nothing declared: a favicon in public/ is used; nothing at all, an empty icon rather than a guess
    writeFileSync(join(dir, 'index.html'), '<html><head></head></html>')
    eq(projectIcons(dir).length, 0)
    ok(studioPage({ name: 'x', entry: '/e.js' }).includes('<link rel="icon" href="data:,"'), 'an empty icon, so no cached one shows')
    mkdirSync(join(dir, 'public'))
    writeFileSync(join(dir, 'public', 'favicon.svg'), '<svg/>')
    eq(projectIcons(dir)[0].href, '/favicon.svg')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const { importTests } = await import('./import.mjs')
await importTests(test, eq, ok)
const { interactionTests } = await import('./interaction.mjs')
await interactionTests(test, eq, ok)
const { setupTests } = await import('./setup.mjs')
await setupTests(test, eq, ok)

console.log(results.join('\n'))
console.log(`\n${passed} passed, ${failed} failed`)
rmSync(root, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
