import { getNote, deleteNote, updateText, renameNote } from '../storage.js';
import { navigate } from '../router.js';
import { Recorder, isSupported } from '../recorder.js';
import { blobToPcm16k } from '../audio.js';
import * as transcriber from '../transcriber.js';
import { showToast } from '../ui.js';
import {
  LANGUAGES, getLanguage, setLanguage, languageName, getGpuEnabled, setGpuEnabled,
} from '../settings.js';
import { icon } from '../icons.js';

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
  back.appendChild(icon('back'));
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
  downloadBtn.appendChild(icon('download'));
  downloadBtn.addEventListener('click', () => downloadNote());

  const copyBtn = document.createElement('button');
  copyBtn.className = 'icon-btn';
  copyBtn.setAttribute('aria-label', 'Copy to clipboard');
  copyBtn.appendChild(icon('copy'));
  copyBtn.addEventListener('click', () => copyNote());

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn';
  deleteBtn.setAttribute('aria-label', 'Delete note');
  deleteBtn.appendChild(icon('delete'));
  deleteBtn.addEventListener('click', () => {
    if (confirm('Delete this note? This cannot be undone.')) {
      deleteNote(note.id);
      navigate('/');
    }
  });

  header.append(back, titleInput, copyBtn, downloadBtn, deleteBtn);
  root.appendChild(header);

  // ---- Main ----
  const main = document.createElement('main');
  main.className = 'note-main';

  const banner = document.createElement('div');
  banner.className = 'model-banner';
  banner.hidden = true;
  main.appendChild(banner);

  // Editable transcript. Manual edits are saved (debounced) to storage, and
  // background transcriptions append to it without disturbing the caret.
  const transcript = document.createElement('textarea');
  transcript.className = 'transcript';
  transcript.value = note.text;
  transcript.setAttribute('aria-label', 'Transcription');
  transcript.setAttribute('placeholder',
    'No transcription yet. Tap record and start speaking — or just type here.');

  let saveTimer = null;
  const flushSave = () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    updateText(note.id, transcript.value);
    note.text = transcript.value;
  };
  transcript.addEventListener('input', () => {
    note.text = transcript.value;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 400);
  });
  transcript.addEventListener('blur', flushSave);

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

  // GPU acceleration toggle (experimental; user verifies it works on their device).
  const gpuLabel = document.createElement('label');
  gpuLabel.className = 'gpu-toggle';
  gpuLabel.title =
    'Use GPU acceleration (experimental). Faster, but if transcriptions look wrong, turn this off.';
  const gpuCheck = document.createElement('input');
  gpuCheck.type = 'checkbox';
  gpuCheck.checked = getGpuEnabled();
  const gpuText = document.createElement('span');
  gpuText.textContent = 'GPU';
  gpuLabel.append(gpuCheck, gpuText);
  gpuCheck.addEventListener('change', () => {
    setGpuEnabled(gpuCheck.checked);
    modelDone = false; // a backend switch may download new weights; show progress
    dlFiles.clear();
    updateBanner(gpuCheck.checked ? 'Switching to GPU…' : 'Switching to CPU…');
    showToast(gpuCheck.checked ? 'Trying GPU acceleration…' : 'Switching to CPU…');
    transcriber.preload(getGpuEnabled());
  });

  const optsRow = document.createElement('div');
  optsRow.className = 'record-options';
  optsRow.append(langLabel, gpuLabel);

  const pendingCount = document.createElement('div');
  pendingCount.className = 'pending-count';

  const recordBtn = document.createElement('button');
  recordBtn.className = 'record-btn';
  recordBtn.setAttribute('aria-label', 'Start recording');
  recordBtn.innerHTML = '<span class="inner"></span>';

  const status = document.createElement('div');
  status.className = 'record-status';

  bar.append(optsRow, pendingCount, recordBtn, status);
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

  // Aggregate per-file download progress into one smooth bar (transformers.js
  // fires the callback for several files in parallel, so showing any single
  // file's percentage makes the bar jump around).
  const dlFiles = new Map(); // file -> { loaded, total }
  cleanups.push(transcriber.on('progress', (p) => {
    if (modelDone || !p) return;
    if (p.status === 'progress' && p.file && p.total) {
      dlFiles.set(p.file, { loaded: p.loaded || 0, total: p.total });
    } else if (p.status === 'done' && p.file && dlFiles.has(p.file)) {
      const f = dlFiles.get(p.file);
      f.loaded = f.total;
    } else {
      return; // ignore initiate/download and any file-less events
    }
    let loaded = 0, total = 0;
    for (const f of dlFiles.values()) { loaded += f.loaded; total += f.total; }
    if (total > 0) {
      updateBanner('Downloading speech model (one-time)…', Math.round((loaded / total) * 100));
    }
  }));
  cleanups.push(transcriber.on('ready', () => {
    modelDone = true;
    dlFiles.clear();
    updateBanner(null);
  }));
  cleanups.push(transcriber.on('detected', (code) => {
    showToast(`Detected language: ${languageName(code)}`);
  }));
  cleanups.push(transcriber.on('backend', (info) => {
    if (info.fellBack) {
      // GPU was requested but unavailable/failed — revert the toggle.
      showToast('GPU not available — using CPU');
      gpuCheck.checked = false;
      setGpuEnabled(false);
    } else if (info.backend === 'webgpu') {
      showToast('GPU acceleration active');
    }
  }));

  // Warm up the model as soon as a note is opened.
  transcriber.preload(getGpuEnabled());

  // ---- Transcript updates ----
  // Append a finished transcription to the (possibly hand-edited) text, keeping
  // the user's caret and selection intact.
  function appendResult(text) {
    const chunk = text.trim();
    if (!chunk) return;
    const current = transcript.value.trimEnd();
    const merged = current ? current + '\n\n' + chunk : chunk;
    const focused = document.activeElement === transcript;
    const start = transcript.selectionStart;
    const end = transcript.selectionEnd;
    transcript.value = merged;
    flushSave();
    if (focused) {
      transcript.selectionStart = start;
      transcript.selectionEnd = end;
    } else {
      transcript.scrollTop = transcript.scrollHeight;
    }
  }

  function updatePendingCount() {
    const n = pending.filter((s) => s.status === 'transcribing').length;
    pendingCount.textContent = n
      ? `${n} clip${n > 1 ? 's' : ''} transcribing…`
      : '';
  }

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
    updatePendingCount();
    try {
      const audio = await blobToPcm16k(blob);
      const text = await transcriber.transcribe(audio, getLanguage(), getGpuEnabled());
      appendResult(text);
    } catch (err) {
      console.error('Transcription failed', err);
      showToast('Transcription failed for one clip.');
    } finally {
      removeSegment(seg.id);
      updatePendingCount();
    }
  }

  function removeSegment(segId) {
    const i = pending.findIndex((s) => s.id === segId);
    if (i !== -1) pending.splice(i, 1);
  }

  // ---- Export ----
  const noteBody = () => `${note.title}\n\n${note.text}\n`;

  function downloadNote() {
    const safe = (note.title || 'voice-note')
      .replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'voice-note';
    const blob = new Blob([noteBody()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safe + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyNote() {
    const text = noteBody();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts / older browsers.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      showToast('Copied to clipboard');
    } catch (err) {
      console.error('Copy failed', err);
      showToast('Could not copy to clipboard');
    }
  }

  // ---- Cleanup on navigation away ----
  const detach = () => {
    flushSave();
    stopTimer();
    if (recorder.recording) recorder.stop();
    cleanups.forEach((fn) => fn && fn());
    window.removeEventListener('hashchange', detach);
  };
  window.addEventListener('hashchange', detach);
}
