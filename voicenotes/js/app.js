import { route, setNotFound, startRouter, navigate } from './router.js';
import { renderList } from './views/listView.js';
import { renderNote } from './views/noteView.js';

const app = document.getElementById('app');

route('/', () => renderList(app));
route('/note/:id', ({ id }) => renderNote(app, id));
setNotFound(() => navigate('/'));

startRouter();

// Register the service worker for offline support / installability.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed', err);
    });
  });
}
