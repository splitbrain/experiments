import { route, setNotFound, startRouter, navigate } from './router.js';
import { renderList } from './views/listView.js';
import { renderNote } from './views/noteView.js';
import { showUpdatePrompt } from './ui.js';

const app = document.getElementById('app');

route('/', () => renderList(app));
route('/note/:id', ({ id }) => renderNote(app, id));
setNotFound(() => navigate('/'));

startRouter();

// Register the service worker and surface updates via a tap-to-reload prompt.
if ('serviceWorker' in navigator) {
  // Whether a worker already controlled this page at load time. If not, the
  // first controllerchange is the initial takeover (first visit) and must NOT
  // trigger a reload; later controllerchanges are genuine updates.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const promptFor = (worker) =>
        showUpdatePrompt(() => worker.postMessage({ type: 'SKIP_WAITING' }));

      // An update may already be waiting when the page loads.
      if (reg.waiting && navigator.serviceWorker.controller) promptFor(reg.waiting);

      // Or one arrives while the page is open.
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            promptFor(installing);
          }
        });
      });
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
  });
}
