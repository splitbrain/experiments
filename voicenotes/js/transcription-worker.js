// Web Worker: loads transformers.js + a Whisper pipeline and transcribes audio
// jobs off the main thread. Jobs are processed sequentially by a single
// pipeline instance; results are posted back keyed by job id.

import {
  pipeline,
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';

// Whisper model. Multilingual "base" balances size/accuracy. Swap to
// 'Xenova/whisper-tiny' for speed or 'Xenova/whisper-base.en' for English only.
const MODEL = 'Xenova/whisper-base';

// Let the library fetch models from the Hugging Face Hub (default) and cache
// them in the browser's Cache storage.
env.allowLocalModels = false;

let pipePromise = null;

async function getPipeline() {
  if (pipePromise) return pipePromise;
  // Run on the WASM backend with q8 weights. This combination is verified to
  // produce correct transcriptions. The WebGPU + fp16 path was found to fail
  // silently on many GPUs — returning a degenerate token such as "I" instead
  // of erroring — so it is intentionally not used.
  pipePromise = pipeline('automatic-speech-recognition', MODEL, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (p) => {
      // p: { status, file, progress, loaded, total, ... }
      self.postMessage({ type: 'progress', payload: p });
    },
  });
  try {
    await pipePromise;
    self.postMessage({ type: 'ready' });
  } catch (err) {
    pipePromise = null;
    throw err;
  }
  return pipePromise;
}

const queue = [];
let working = false;

async function drain() {
  if (working) return;
  working = true;
  try {
    const transcriber = await getPipeline();
    while (queue.length) {
      const job = queue.shift();
      try {
        const out = await transcriber(job.audio, {
          chunk_length_s: 30,
          stride_length_s: 5,
        });
        const text = (out && out.text ? out.text : '').trim();
        self.postMessage({ type: 'result', id: job.id, text });
      } catch (err) {
        self.postMessage({
          type: 'error',
          id: job.id,
          message: String(err && err.message ? err.message : err),
        });
      }
    }
  } catch (err) {
    // Pipeline failed to load — fail every queued job so the UI can recover.
    const message = String(err && err.message ? err.message : err);
    self.postMessage({ type: 'error', id: null, message });
    while (queue.length) {
      const job = queue.shift();
      self.postMessage({ type: 'error', id: job.id, message });
    }
  } finally {
    working = false;
  }
}

self.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'transcribe') {
    queue.push({ id: msg.id, audio: msg.audio });
    drain();
  } else if (msg.type === 'preload') {
    getPipeline().catch(() => {});
  }
});
