// localStorage-backed note store. Text only — audio is never persisted.

const KEY = 'voicenotes:notes';

/** @typedef {{id:string,title:string,text:string,createdAt:number,updatedAt:number}} Note */

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to read notes from localStorage', err);
    return [];
  }
}

function writeAll(notes) {
  localStorage.setItem(KEY, JSON.stringify(notes));
}

function uid() {
  return (
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  );
}

/** @returns {Note[]} notes sorted by most recently updated first */
export function listNotes() {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** @returns {Note|undefined} */
export function getNote(id) {
  return readAll().find((n) => n.id === id);
}

/** Default note title: the creation date and time, in the user's locale. */
function defaultTitle(ts) {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** @returns {Note} a freshly created, persisted note */
export function createNote(title) {
  const now = Date.now();
  const note = {
    id: uid(),
    title: title || defaultTitle(now),
    text: '',
    createdAt: now,
    updatedAt: now,
  };
  const notes = readAll();
  notes.push(note);
  writeAll(notes);
  return note;
}

export function deleteNote(id) {
  writeAll(readAll().filter((n) => n.id !== id));
}

/**
 * Update only a note's title, re-reading from storage so an in-flight
 * transcription's appended text is never clobbered. @returns {Note|undefined}
 */
export function renameNote(id, title) {
  const notes = readAll();
  const note = notes.find((n) => n.id === id);
  if (!note) return undefined;
  note.title = title;
  note.updatedAt = Date.now();
  writeAll(notes);
  return note;
}

/**
 * Replace a note's full text (used for manual edits and appended transcripts).
 * @returns {Note|undefined}
 */
export function updateText(id, text) {
  const notes = readAll();
  const note = notes.find((n) => n.id === id);
  if (!note) return undefined;
  note.text = text;
  note.updatedAt = Date.now();
  writeAll(notes);
  return note;
}
