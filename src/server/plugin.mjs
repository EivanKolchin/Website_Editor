import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { createApi } from './api.mjs'
import { createChecker } from './check.mjs'
import { TOOL_DIR } from './config.mjs'
import { createOps } from './ops.mjs'
import { createRebuilder } from './rebuild.mjs'
import { createSettings } from './settings.mjs'
import { projectIcons, studioPage } from './studio.mjs'
import { createTracer } from './trace.mjs'
import { Project } from './project.mjs'
import { Journal, Sources } from './sources.mjs'
import { stampSource } from './stamp.mjs'
import { cleanId, matcher, posix, relTo } from './util.mjs'

const MODULE_RE = /\.(m?[jt]sx?|cts|json)$/i

/**
 * THE VITE PLUGIN. Three jobs:
 *
 *  - transform, ORDER 'pre': snapshot every module as written and stamp its
 *    JSX. It has to run before @vitejs/plugin-react, whose Babel pass
 *    reprints the file - offsets taken after that would point into code
 *    nobody wrote. A hook marked order:'pre' runs ahead of every hook that
 *    is not, whatever order the plugins are listed in.
 *  - transformIndexHtml: the token, the freeze switch and the editor.
 *  - configureServer: the /__retouch API.
 *
 * `apply: 'serve'`: nothing here ever reaches a production build.
 */
export function retouchPlugin({ config, onClientsChange, searchForWorkspaceRoot, projects }) {
  const root = config.root
  const token = randomBytes(18).toString('hex')
  const sources = new Sources(root)
  const project = new Project({ root, sources, config })
  const journal = new Journal(root)
  let server = null
  const rebuilder = createRebuilder({ config })
  const tracer = createTracer({ project, config, rebuilder, getServer: () => server })
  const ops = createOps({ project, sources, config, tracer })
  const settings = createSettings({ project, ops })
  const stampable = matcher(config.stamp.include, ['**/node_modules/**', ...config.stamp.exclude])
  const skip = new Set(config.stamp.skipComponents)
  const clientEntry = posix(join(TOOL_DIR, 'src', 'client', 'index.js'))
  const studioEntry = posix(join(TOOL_DIR, 'src', 'client', 'studio.js'))
  const send = (event, data) => server?.ws.send({ type: 'custom', event, data })
  const checker = createChecker({ config, send: (d) => send('retouch:check', d) })

  return {
    name: 'retouch',
    apply: 'serve',
    enforce: 'pre',

    config(user) {
      const viteRoot = resolve(root, user.root ?? '.')
      // ITS OWN DEPENDENCY CACHE. This server runs beside the project's own
      // dev server with a different config, and two servers optimising
      // into one cache overwrite each other's copy of React - which shows
      // up as "Invalid hook call" and a blank page on whichever lost.
      // and one per port: a second Retouch on another port is a second server with the same problem
      const suffix = Number(config.vite.port) === 5199 ? '-retouch' : `-retouch-${config.vite.port}`
      const cacheDir = posix(user.cacheDir ? resolve(viteRoot, user.cacheDir) + suffix : resolve(root, 'node_modules', '.vite' + suffix))
      const allow = user.server?.fs?.allow
      if (allow) return { cacheDir, server: { fs: { allow: [TOOL_DIR] } } }
      // Setting fs.allow replaces Vite's default, so the default has to be said again.
      const workspace = searchForWorkspaceRoot ? searchForWorkspaceRoot(viteRoot) : root
      return { cacheDir, server: { fs: { allow: [TOOL_DIR, posix(workspace), posix(resolve(root))] } } }
    },

    transform: {
      order: 'pre',
      handler(code, id) {
        if (id.startsWith('\0') || id.includes('/node_modules/')) return
        const file = cleanId(id)
        if (!MODULE_RE.test(file) || !project.allowed(file)) return
        const disk = project.readFresh(file)
        // a plugin ahead of us changed this module, so its offsets would not be the file's
        if (disk !== code) return
        const { pid, vid, rel } = sources.record(file, code)
        if (!stampable(rel)) return
        const out = stampSource(code, file, `${pid}.${vid}`, { skip })
        if (out) return { code: out.code, map: null }
      },
    },

    // a generator's outputs do not hot-reload while Retouch is running it: the page already shows the edit (rebuild.mjs)
    handleHotUpdate(ctx) {
      if (rebuilder.quiet(relTo(root, ctx.file))) return []
    },

    transformIndexHtml() {
      const boot = { token, api: '/__retouch', name: config.name, tool: TOOL_DIR }
      return [
        {
          tag: 'style',
          injectTo: 'head-prepend',
          children:
            'html[data-retouch-frozen] *,html[data-retouch-frozen] *::before,html[data-retouch-frozen] *::after{animation-play-state:paused!important;transition:none!important}' +
            'html[data-retouch-picking],html[data-retouch-picking] *{cursor:crosshair!important}',
        },
        { tag: 'script', injectTo: 'head-prepend', children: freezeSnippet(boot) },
        { tag: 'script', injectTo: 'body', attrs: { type: 'module', src: (server?.config.base ?? '/') + '@fs/' + clientEntry.replace(/^\//, '') } },
      ]
    },

    configureServer(s) {
      server = s
      project.attach(s)
      const api = createApi({ ops, project, journal, checker, config, token, rebuilder, tracer, settings, sources, projects, notify: (d) => send('retouch:event', d) })
      // the studio: the page in a frame with the editor's panels around it (studio.mjs)
      s.middlewares.use('/__retouch/studio', (req, res, next) => {
        if (req.method !== 'GET') return next()
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(studioPage({ name: config.name, entry: s.config.base + '@fs/' + studioEntry.replace(/^\//, ''), icons: projectIcons(s.config.root, s.config.base), boot: { token, api: '/__retouch', name: config.name, root } }))
      })
      s.middlewares.use('/__retouch', api)
      let clients = 0
      s.ws.on('connection', (socket) => {
        clients++
        onClientsChange?.(clients)
        socket.on?.('close', () => {
          clients = Math.max(0, clients - 1)
          onClientsChange?.(clients)
        })
      })
    },

    api: { sources, project, journal, ops, tracer, rebuilder, relTo: (f) => relTo(root, f) },
  }
}

/**
 * Runs in the page's head before any of its own scripts, and gives the
 * editor the page's clock.
 *
 * requestAnimationFrame is taken over, so "freeze" can stop every frame
 * loop on the page - the editor keeps the real one for itself - and CSS and
 * Web Animations are paused with it. A moving seed cannot be clicked; a
 * frozen one can. The time the page sees (rAF timestamps and
 * performance.now) runs on a VIRTUAL clock: real time while playing, slower
 * in slow motion, stopped while frozen, and advanced one frame at a time by
 * "step". So an animation resumes where it stopped instead of jumping by the
 * time it spent frozen, and anything driven by time can be watched slowly.
 */
function freezeSnippet(boot) {
  return `(() => {
  const R = (window.__RETOUCH__ = ${JSON.stringify(boot).replace(/</g, '\\u003c')});
  R.importErrors = [];
  try {
    if (new URLSearchParams(parent.location.search).has('importJob')) {
      addEventListener('error', (e) => { if (e.message && R.importErrors.length < 8) R.importErrors.push(e.message); });
      addEventListener('unhandledrejection', (e) => { if (R.importErrors.length < 8) R.importErrors.push(String(e.reason?.message || e.reason)); });
    }
  } catch {}
  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  let frozen = false, speed = 1, next = 1e9;
  let rAnchor = realNow(), vAnchor = rAnchor;
  const warp = (t) => vAnchor + (frozen ? 0 : (t - rAnchor) * speed);
  const reanchor = () => { const r = realNow(); vAnchor = warp(r); rAnchor = r; };
  try { performance.now = () => warp(realNow()); } catch (e) {}
  const queue = new Map();
  const scheduled = new Map();
  let paused = [];
  let animationClock = new WeakMap();
  const anims = () => (document.getAnimations ? document.getAnimations() : []);
  /* R.frameT names the frame being drawn, so a recording can tell one frame's drawing from the next */
  R.frameT = 0;
  const schedule = (id, cb) => {
    scheduled.set(id, raf((t) => {
      scheduled.delete(id);
      if (!queue.has(id) || frozen) return;
      queue.delete(id);
      R.frameT = t;
      cb(warp(t));
    }));
  };
  window.requestAnimationFrame = (cb) => {
    const id = next++;
    queue.set(id, cb);
    if (!frozen) schedule(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queue.delete(id);
    if (scheduled.has(id)) { caf(scheduled.get(id)); scheduled.delete(id); }
  };
  R.raf = raf;
  R.realNow = realNow;
  R.isFrozen = () => frozen;
  R.speed = () => speed;
  R.freeze = (on) => {
    on = !!on;
    if (on === frozen) return;
    reanchor();
    frozen = on;
    document.documentElement.toggleAttribute('data-retouch-frozen', on);
    if (on) {
      scheduled.forEach((id) => caf(id));
      scheduled.clear();
      paused = anims().filter((a) => a.playState === 'running');
      paused.forEach((a) => { try { a.pause(); } catch (e) {} });
      animationClock = new WeakMap();
      anims().forEach((a) => {
        if (typeof a.currentTime === 'number') animationClock.set(a, { clock: vAnchor, local: a.currentTime, last: a.currentTime, rate: a.playbackRate / speed });
      });
    } else {
      paused.forEach((a) => { try { a.play(); } catch (e) {} });
      paused = [];
      queue.forEach((cb, id) => schedule(id, cb));
    }
    try { if (R.onchange) R.onchange(); } catch (e) {}
  };
  let syncTimer = 0;
  const syncRates = () => anims().forEach((a) => { try { if (a.playbackRate !== speed) a.playbackRate = speed; } catch (e) {} });
  R.setSpeed = (s) => {
    s = Math.max(0.05, Math.min(4, Number(s) || 1));
    reanchor();
    speed = s;
    syncRates();
    clearInterval(syncTimer);
    // animations started later run at the same speed
    if (s !== 1) syncTimer = setInterval(syncRates, 400);
  };
  /* one frame forward (or back: a negative step), redrawn at once; 0 redraws the frame that is showing */
  R.step = (ms) => {
    ms = ms == null ? 1000 / 60 : ms;
    if (!frozen) R.freeze(true);
    const previous = vAnchor;
    vAnchor = Math.max(0, vAnchor + ms);
    const cbs = [...queue.values()];
    queue.clear();
    R.frameT = 'step' + realNow();
    cbs.forEach((cb) => { try { cb(vAnchor); } catch (e) { console.error(e); } });
    if (ms) anims().forEach((a) => {
      try {
        if (typeof a.currentTime !== 'number' || !['paused', 'finished'].includes(a.playState)) return;
        let at = animationClock.get(a);
        if (!at || Math.abs(a.currentTime - at.last) > 0.01) {
          at = { clock: previous, local: a.currentTime, last: a.currentTime, rate: a.playbackRate / speed };
          animationClock.set(a, at);
        }
        if (a.playState === 'finished') a.pause();
        // Negative local time is the state BEFORE an animation starts. Clamping
        // it to zero loses its start offset and makes a rewind/restore drift.
        at.last = at.local + (vAnchor - at.clock) * at.rate;
        a.currentTime = at.last;
      } catch (e) {}
    });
  };
  R.time = () => warp(realNow());
  /* What a canvas draws, for the editor to find and select: every drawing call goes through a hook that does
     nothing unless the editor is recording a frame (R.rec), so a page pays one property read per call. */
  const hook = (proto, names, key) => {
    if (!proto) return;
    for (const n of names) {
      const f = proto[n];
      if (typeof f !== 'function') continue;
      proto[n] = function () { const r = R[key]; if (!r) return f.apply(this, arguments); let after; try { after = r(this, n, arguments); } catch (e) {} if (after === false || (after && after.skip)) return; try { return f.apply(this, arguments); } finally { if (typeof after === 'function') after(); } };
    }
  };
  hook(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, ['save', 'restore', 'clip', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'bezierCurveTo', 'quadraticCurveTo', 'fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'drawImage'], 'rec');
  hook(window.Path2D && Path2D.prototype, ['moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'bezierCurveTo', 'quadraticCurveTo', 'closePath', 'addPath'], 'recPath');
  hook(window.CanvasGradient && CanvasGradient.prototype, ['addColorStop'], 'recStop');
  /* where a gradient runs, kept on the gradient itself: pages make one once and paint with it every frame, so
     this cannot wait for a recording. The editor uses it to show where on a drawing each colour of it falls. */
  const gp = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (gp) for (const n of ['createLinearGradient', 'createRadialGradient', 'createConicGradient']) {
    const f = gp[n];
    if (typeof f !== 'function') continue;
    gp[n] = function () { const g = f.apply(this, arguments); try { g.__rtGeom = { kind: n.slice(6, -8).toLowerCase(), args: Array.prototype.slice.call(arguments) }; } catch (e) {} return g; };
  }
  try {
    /* the studio's timeline preview is driven by the studio alone: it shares this tab's sessionStorage with the
       real page, and must not take that page's frozen clock or slow motion for its own */
    if (window.name === 'retouch-preview') return;
    /* frozen before a reload: frozen again once the page has drawn itself, not before its first frame, or a page
       painted on a canvas would come back blank */
    if (sessionStorage.getItem('retouch:frozen') === '1') {
      const later = () => setTimeout(() => R.freeze(true), 600);
      if (document.readyState === 'complete') later(); else window.addEventListener('load', later, { once: true });
    }
    const s = Number(sessionStorage.getItem('retouch:speed'));
    if (s && s !== 1) R.setSpeed(s);
  } catch (e) {}
})();`
}
