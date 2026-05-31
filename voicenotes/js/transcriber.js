// Main-thread interface to the transcription worker. Owns the worker, turns each
// job into a promise, and exposes lifecycle callbacks so the UI can surface
// model-download progress and readiness.
//
// Switching backend (CPU <-> GPU) recreates the worker. transformers.js can't
// cancel an in-flight model download, but terminating the worker aborts it — so
// toggling mid-download stops the old download instead of running both. In-flight
// transcription jobs are re-queued on the new worker (we keep each job's audio
// rather than transferring it, so a restart doesn't lose them).

let worker = null;
let workerGpu = null; // backend the current worker was created for (boolean | null)
let ready = false;
const pending = new Map(); // id -> { resolve, reject, audio, language }
const listeners = {
  progress: new Set(),
  ready: new Set(),
  error: new Set(),
  detected: new Set(),
  backend: new Set(),
};
let jobSeq = 0;

function handleMessage(e) {
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
}

function ensureWorker(gpu) {
  gpu = !!gpu;
  if (worker && workerGpu === gpu) return worker;

  // Backend changed (or first use): replace the worker. Terminating aborts any
  // in-flight model download in the old worker.
  if (worker) worker.terminate();
  worker = new Worker(new URL('./transcription-worker.js', import.meta.url), {
    type: 'module',
  });
  workerGpu = gpu;
  ready = false;
  worker.addEventListener('message', handleMessage);

  // Re-queue any in-flight jobs onto the new worker for the new backend.
  for (const [id, job] of pending) {
    worker.postMessage({ type: 'transcribe', id, audio: job.audio, language: job.language, gpu });
  }
  return worker;
}

/** Start loading the model now (e.g. on first note open) so it's warm. */
export function preload(gpu = false) {
  ensureWorker(gpu).postMessage({ type: 'preload', gpu });
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
  const w = ensureWorker(gpu);
  const id = ++jobSeq;
  return new Promise((resolve, reject) => {
    // Keep the audio (don't transfer) so the job can be re-queued if the worker
    // is replaced by a backend switch.
    pending.set(id, { resolve, reject, audio, language });
    w.postMessage({ type: 'transcribe', id, audio, language, gpu });
  });
}

export function on(event, fn) {
  if (listeners[event]) listeners[event].add(fn);
  return () => listeners[event] && listeners[event].delete(fn);
}
