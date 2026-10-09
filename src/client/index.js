import { createApp } from './app.js'

// Served by the project's own dev server, so import.meta.hot is the page's
// HMR channel: save results, check results and hot updates all arrive on it.
// The studio's timeline preview is a second copy of the page, framed with
// this name: it is only looked at, so it carries no editor - one would
// attach itself to the studio in place of the real page's.
if (window.__RETOUCH__ && !window.__RETOUCH_APP__ && window.name !== 'retouch-preview') {
  window.__RETOUCH_APP__ = createApp(window.__RETOUCH__, import.meta.hot)
}
