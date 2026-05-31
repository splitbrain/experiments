// Main-thread interface to the transcription worker. Owns the (lazily created)
// worker, turns each job into a promise, and exposes lifecycle callbacks so the
// UI can surface model-download progress and readiness.

let worker = null;
let ready = false;
const pending = new Map(); // id -> { resolve, reject }
const listeners = {
  progress: new Set(),
  ready: new Set(),
  error: new Set(),
  detected: new Set(),
  backend: new Set(),
};
let jobSeq = 0;

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./transcription-worker.js', import.meta.url), {
    type: 'module',
  });
  worker.addEventListener('message', (e) => {
    const msg = e.data;
    switch (msg.type) {
      case 'progress':
        listeners.progress.forEach((fn) => fn(msg.payload));
        break;
      case 'ready':
        ready = true;
        listeners.ready.forEach((fn) => fn());
        break;
      case 'detected':
        listeners.detected.forEach((fn) => fn(msg.language));
        break;
      case 'backend':
        listeners.backend.forEach((fn) =>
          fn({ backend: msg.backend, requestedGpu: msg.requestedGpu, fellBack: msg.fellBack }));
        break;
      case 'result': {
        const job = pending.get(msg.id);
        if (job) { pending.delete(msg.id); job.resolve(msg.text); }
        break;
      }
      case 'error': {
        if (msg.id != null && pending.has(msg.id)) {
          const job = pending.get(msg.id);
          pending.delete(msg.id);
          job.reject(new Error(msg.message));
        }
        listeners.error.forEach((fn) => fn(msg.message));
        break;
      }
    }
  });
  return worker;
}

/** Start loading the model now (e.g. on first note open) so it's warm. */
export function preload(gpu = false) {
  ensureWorker().postMessage({ type: 'preload', gpu });
}

export function isReady() {
  return ready;
}

/**
 * Queue an audio clip for transcription.
 * @param {Float32Array} audio 16 kHz mono PCM
 * @param {string} language Whisper language code (e.g. 'de')
 * @param {boolean} gpu whether to use the WebGPU backend
 * @returns {Promise<string>} the transcribed text
 */
export function transcribe(audio, language, gpu = false) {
  const w = ensureWorker();
  const id = ++jobSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Transfer the underlying buffer to avoid a copy.
    w.postMessage({ type: 'transcribe', id, audio, language, gpu }, [audio.buffer]);
  });
}

export function on(event, fn) {
  if (listeners[event]) listeners[event].add(fn);
  return () => listeners[event] && listeners[event].delete(fn);
}
