import { createApp } from './app.js'

// Served by the project's own dev server, so import.meta.hot is the page's
// HMR channel: save results, check results and hot updates all arrive on it.
if (window.__RETOUCH__ && !window.__RETOUCH_APP__) {
  window.__RETOUCH_APP__ = createApp(window.__RETOUCH__, import.meta.hot)
}
