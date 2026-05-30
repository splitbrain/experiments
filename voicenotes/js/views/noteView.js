import { getNote, deleteNote, appendText, renameNote } from '../storage.js';
import { navigate } from '../router.js';
import { Recorder, isSupported } from '../recorder.js';
import { blobToPcm16k } from '../audio.js';
import * as transcriber from '../transcriber.js';
import { showToast } from '../ui.js';
import { LANGUAGES, getLanguage, setLanguage } from '../settings.js';

export function renderNote(root, id) {
  const note = getNote(id);
  if (!note) { navigate('/'); return; }

  const recorder = new Recorder();
  const pending = []; // { id, status: 'transcribing'|'error', text? }
  let segSeq = 0;
  let timerInt = null;
  let modelDone = transcriber.isReady();
  const cleanups = [];

  root.innerHTML = '';

  // ---- Header ----
  const header = document.createElement('header');
  header.className = 'app-header';

  const back = document.createElement('button');
  back.className = 'icon-btn';
  back.setAttribute('aria-label', 'Back to notes');
  back.textContent = '‹';
  back.addEventListener('click', () => navigate('/'));

  const titleInput = document.createElement('input');
  titleInput.className = 'title-input';
  titleInput.value = note.title;
  titleInput.setAttribute('aria-label', 'Note title');
  titleInput.addEventListener('change', () => {
    note.title = titleInput.value.trim() || 'Untitled';
    titleInput.value = note.title;
    renameNote(note.id, note.title);
  });

  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'icon-btn';
  downloadBtn.setAttribute('aria-label', 'Download as text file');
  downloadBtn.textContent = '⤓';
  downloadBtn.addEventListener('click', () => downloadNote());

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn';
  deleteBtn.setAttribute('aria-label', 'Delete note');
  deleteBtn.textContent = '🗑';
  deleteBtn.addEventListener('click', () => {
    if (confirm('Delete this note? This cannot be undone.')) {
      deleteNote(note.id);
      navigate('/');
    }
  });

  header.append(back, titleInput, downloadBtn, deleteBtn);
  root.appendChild(header);

  // ---- Main ----
  const main = document.createElement('main');
  main.className = 'note-main';

  const banner = document.createElement('div');
  banner.className = 'model-banner';
  banner.hidden = true;
  main.appendChild(banner);

  const transcript = document.createElement('div');
  transcript.className = 'transcript';
  main.appendChild(transcript);

  root.appendChild(main);

  // ---- Record bar ----
  const bar = document.createElement('div');
  bar.className = 'record-bar detached';

  // Spoken-language selector (Whisper needs it; there is no auto-detect).
  const langLabel = document.createElement('label');
  langLabel.className = 'lang-select';
  langLabel.append('Language');
  const langSel = document.createElement('select');
  for (const l of LANGUAGES) {
    const opt = document.createElement('option');
    opt.value = l.code;
    opt.textContent = l.name;
    langSel.appendChild(opt);
  }
  langSel.value = getLanguage();
  langSel.addEventListener('change', () => setLanguage(langSel.value));
  langLabel.appendChild(langSel);

  const pendingCount = document.createElement('div');
  pendingCount.className = 'pending-count';

  const recordBtn = document.createElement('button');
  recordBtn.className = 'record-btn';
  recordBtn.setAttribute('aria-label', 'Start recording');
  recordBtn.innerHTML = '<span class="inner"></span>';

  const status = document.createElement('div');
  status.className = 'record-status';

  bar.append(langLabel, pendingCount, recordBtn, status);
  root.appendChild(bar);

  if (!isSupported()) {
    recordBtn.disabled = true;
    status.textContent = 'Recording is not supported in this browser.';
  }

  // ---- Model load progress ----
  function updateBanner(text, pct) {
    if (text == null) { banner.hidden = true; banner.innerHTML = ''; return; }
    banner.hidden = false;
    let html = `<div>${text}</div>`;
    if (typeof pct === 'number') {
      html += `<div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`;
    }
    banner.innerHTML = html;
  }

  cleanups.push(transcriber.on('progress', (p) => {
    if (modelDone) return;
    if (p && p.status === 'progress' && p.total) {
      const pct = Math.round((p.loaded / p.total) * 100);
      updateBanner('Downloading speech model (one-time)…', pct);
    } else if (p && p.status === 'ready') {
      modelDone = true;
      updateBanner(null);
    }
  }));
  cleanups.push(transcriber.on('ready', () => {
    modelDone = true;
    updateBanner(null);
  }));

  // Warm up the model as soon as a note is opened.
  transcriber.preload();

  // ---- Rendering ----
  function renderTranscript() {
    transcript.innerHTML = '';
    if (note.text) {
      const finalized = document.createElement('span');
      finalized.textContent = note.text;
      transcript.appendChild(finalized);
    }
    for (const seg of pending) {
      if (note.text || transcript.childNodes.length) {
        transcript.appendChild(document.createTextNode('\n\n'));
      }
      const span = document.createElement('span');
      span.className = 'segment ' + (seg.status === 'error' ? 'error' : 'pending');
      if (seg.status === 'error') {
        span.textContent = '⚠ Transcription failed';
      } else {
        span.innerHTML = '<span class="spinner"></span> transcribing…';
      }
      transcript.appendChild(span);
    }
    main.scrollTop = main.scrollHeight;
    updatePendingCount();
  }

  function updatePendingCount() {
    const n = pending.filter((s) => s.status === 'transcribing').length;
    pendingCount.textContent = n
      ? `${n} clip${n > 1 ? 's' : ''} transcribing…`
      : '';
  }

  renderTranscript();

  // ---- Recording control ----
  let elapsed = 0;
  function startTimer() {
    elapsed = 0;
    status.innerHTML = '<span class="record-timer">0:00</span> · tap to stop';
    timerInt = setInterval(() => {
      elapsed++;
      const m = Math.floor(elapsed / 60);
      const s = String(elapsed % 60).padStart(2, '0');
      const timerEl = status.querySelector('.record-timer');
      if (timerEl) timerEl.textContent = `${m}:${s}`;
    }, 1000);
  }
  function stopTimer() {
    if (timerInt) { clearInterval(timerInt); timerInt = null; }
  }

  async function onRecordClick() {
    if (recorder.recording) {
      // Stop and hand off to background transcription.
      recordBtn.disabled = true;
      const blob = await recorder.stop();
      stopTimer();
      recordBtn.classList.remove('recording');
      recordBtn.setAttribute('aria-label', 'Start recording');
      recordBtn.disabled = false;
      status.textContent = '';
      transcribeClip(blob);
    } else {
      try {
        await recorder.start();
        recordBtn.classList.add('recording');
        recordBtn.setAttribute('aria-label', 'Stop recording');
        startTimer();
      } catch (err) {
        console.error(err);
        status.textContent = 'Microphone access was denied.';
        showToast('Could not access the microphone.');
      }
    }
  }
  recordBtn.addEventListener('click', onRecordClick);

  async function transcribeClip(blob) {
    if (!blob || blob.size === 0) return;
    const seg = { id: ++segSeq, status: 'transcribing' };
    pending.push(seg);
    renderTranscript();
    try {
      const audio = await blobToPcm16k(blob);
      const text = await transcriber.transcribe(audio, getLanguage());
      // Persist by re-reading the note so concurrent clips don't clobber.
      const updated = appendText(note.id, text);
      if (updated) note.text = updated.text;
      removeSegment(seg.id);
      renderTranscript();
    } catch (err) {
      console.error('Transcription failed', err);
      seg.status = 'error';
      renderTranscript();
      showToast('Transcription failed for one clip.');
    }
  }

  function removeSegment(segId) {
    const i = pending.findIndex((s) => s.id === segId);
    if (i !== -1) pending.splice(i, 1);
  }

  // ---- Download ----
  function downloadNote() {
    const safe = (note.title || 'voice-note')
      .replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'voice-note';
    const body = `${note.title}\n\n${note.text}\n`;
    const blob = new Blob([body], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safe + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- Cleanup on navigation away ----
  const detach = () => {
    stopTimer();
    if (recorder.recording) recorder.stop();
    cleanups.forEach((fn) => fn && fn());
    window.removeEventListener('hashchange', detach);
  };
  window.addEventListener('hashchange', detach);
}
