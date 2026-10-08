/**
 * A Retouch config. Copy to retouch/local/config.mjs (gitignored) or to
 * <project>/retouch.config.mjs, and keep what applies. Every field is
 * optional. AGENTS.md explains how to work each one out for a project.
 */
export default {
  /** Shown in the toolbar. */
  name: 'My site',

  /** The project, relative to this file. From retouch/local/ that is '../..'. */
  root: '../..',

  /** The project's own Vite config, mode and the port the editor runs on. */
  vite: { configFile: 'vite.config.ts', port: 5199 },

  /** The first page to open. */
  open: '/',

  /** Commands the project's dev script runs before vite, in order. */
  before: [],

  /** Which JSX files get source stamps, and components never to stamp. */
  stamp: { include: ['src/**/*.tsx'], skipComponents: [] },

  /**
   * Extra text outside the module graph (runtime-loaded markdown or JSON,
   * and .html files whose markup the page sets as a string - their elements
   * become editable in that file), and generated files edits must never be
   * saved into.
   */
  text: { include: [], exclude: ['src/generated/**'] },

  /**
   * Generators to run after a save to the files they read, when part of the
   * page is built by a script rather than imported. Their outputs do not
   * hot-reload while they run (the edit is already on the page), and a trace
   * that lands in an output names the files it is built from.
   */
  rebuild: [
    // { from: ['src/landing/**'], run: 'node scripts/build-landing.mjs', outputs: ['src/generated/landing.*'], label: 'landing' },
  ],

  /**
   * Components placed and sized by their own props. move names the props
   * holding the anchor point (in the parent's coordinates), size the props
   * that scale the element about that same point.
   */
  adapters: [
    // { component: 'Sprite', move: { x: 'x', y: 'ground' }, size: ['w'] },
    // { component: 'Card', move: { x: 'left', y: 'top' }, anchor: [0, 0] },
  ],

  /** CSS selectors that are never selected or edited. */
  locked: ['.katex'],

  /** The project's own quick check, run after every save and shown on the toolbar. */
  check: { command: 'npm run lint', label: 'lint' },

  /** Warnings on new text. A regex rule or a function returning a message. */
  textRules: [
    // { pattern: /[\u2013\u2014]/, message: 'House style: no em or en dashes.' },
  ],

  /** Warnings on a picked colour. */
  colorRules: [
    // (value) => (value.startsWith('#') ? 'Use a token from "This page".' : null),
  ],

  /**
   * Offer the page's CSS colour tokens, and list them first. `include`: where
   * else the colour picker looks for where a colour is written (a token file
   * a build step copies, scene scripts that draw on a canvas). `arrays:
   * 'oklch'` reads number arrays as colours: [L, C, h] and stops [t, L, C, h].
   */
  colors: { tokens: true, tokensFirst: false, include: [], arrays: null },

  /** Only for `retouch map`. */
  ai: { model: 'claude-opus-5-5', effort: 'high' },

  /** Which browser opens the editor window, and its size. */
  window: { browser: 'auto', width: 1440, height: 920 },

  /** Open the studio (layers and properties around the page). false, or --page, opens the page alone. */
  studio: true,
}
