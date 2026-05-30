import { listNotes, createNote } from '../storage.js';
import { navigate } from '../router.js';
import { versionLabel, VERSION, BUILD_DATE } from '../version.js';
import { icon } from '../icons.js';

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function preview(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function renderList(root) {
  const notes = listNotes();
  root.innerHTML = '';

  const header = document.createElement('header');
  header.className = 'app-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'Voice Notes';
  const ver = document.createElement('span');
  ver.className = 'app-version';
  ver.textContent = versionLabel();
  if (!VERSION.includes('__')) ver.title = `${VERSION}\nbuilt ${BUILD_DATE}`;
  header.append(h1, ver);
  root.appendChild(header);

  const main = document.createElement('main');
  main.className = 'list-main';

  if (notes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML =
      '<p>No notes yet.</p><p>Tap <strong>New note</strong> to start recording.</p>';
    main.appendChild(empty);
  } else {
    const ul = document.createElement('ul');
    ul.className = 'note-list';
    for (const note of notes) {
      const li = document.createElement('li');
      li.className = 'note-card';
      li.tabIndex = 0;
      li.setAttribute('role', 'button');

      const info = document.createElement('div');
      info.className = 'note-info';

      const title = document.createElement('p');
      title.className = 'note-title';
      title.textContent = note.title || 'Untitled';
      info.appendChild(title);

      // The title is the creation time, so only show an "Edited" line once the
      // note has actually changed (avoids two identical timestamps).
      if (note.updatedAt - note.createdAt > 60000) {
        const meta = document.createElement('p');
        meta.className = 'note-meta';
        meta.textContent = 'Edited ' + formatDate(note.updatedAt);
        info.appendChild(meta);
      }

      if (note.text) {
        const prev = document.createElement('p');
        prev.className = 'note-preview';
        prev.textContent = preview(note.text);
        info.appendChild(prev);
      }

      li.appendChild(info);

      const chevron = document.createElement('span');
      chevron.className = 'icon-btn';
      chevron.appendChild(icon('chevronRight'));
      li.appendChild(chevron);

      const open = () => navigate('/note/' + note.id);
      li.addEventListener('click', open);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
      ul.appendChild(li);
    }
    main.appendChild(ul);
  }

  root.appendChild(main);

  const fab = document.createElement('button');
  fab.className = 'fab';
  const fabLabel = document.createElement('span');
  fabLabel.textContent = 'New note';
  fab.append(icon('add'), fabLabel);
  fab.addEventListener('click', () => {
    const note = createNote();
    navigate('/note/' + note.id);
  });
  root.appendChild(fab);
}
