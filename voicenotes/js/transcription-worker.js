// Web Worker: loads transformers.js + a Whisper pipeline and transcribes audio
// jobs off the main thread. Jobs are processed sequentially by a single
// pipeline instance; results are posted back keyed by job id.

import {
  pipeline,
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';
import { cleanupOtherModels } from './model-cache.js';

// Whisper model. Multilingual "small" (~244M) balances accuracy and on-device
// speed well. Swap to 'Xenova/whisper-base' for faster/lighter, or
// 'Xenova/whisper-medium' for higher accuracy at a much larger download.
const MODEL = 'Xenova/whisper-small';

// Let the library fetch models from the Hugging Face Hub (default) and cache
// them in the browser's Cache storage.
env.allowLocalModels = false;

// Backend configs. WASM (q8) is the safe default and is verified to work
// everywhere. WebGPU (q4f16) is much faster but only correct on sound GPUs —
// it's opt-in via the app's toggle, and we fall back to WASM if it can't load.
const BACKENDS = {
  wasm: { device: 'wasm', dtype: 'q8' },
  webgpu: { device: 'webgpu', dtype: 'q4f16' },
};

let pipePromise = null;
let builtForGpu = null; // the gpu setting (boolean) the current pipeline was built for
let detectLanguage = null; // (audio) => Promise<langCode>, built once the model loads

async function webgpuAvailable() {
  try {
    if (!self.navigator || !self.navigator.gpu) return false;
    return !!(await self.navigator.gpu.requestAdapter());
  } catch {
    return false;
  }
}

function loadPipeline(backend) {
  return pipeline('automatic-speech-recognition', MODEL, {
    ...BACKENDS[backend],
    progress_callback: (p) => self.postMessage({ type: 'progress', payload: p }),
  });
}

async function finishLoad(backend, requestedGpu) {
  const pipe = await pipePromise;
  builtForGpu = requestedGpu;
  buildDetector(pipe);
  self.postMessage({ type: 'ready' });
  self.postMessage({
    type: 'backend',
    backend,
    requestedGpu,
    // tell the UI if a GPU request silently became WASM
    fellBack: requestedGpu && backend !== 'webgpu',
  });
  // The active model is now cached; drop any other Whisper models to free space.
  cleanupOtherModels(MODEL).then((n) => {
    if (n) console.log(`Removed ${n} cached file(s) from unused Whisper models.`);
  });
  return pipe;
}

/**
 * Get (or build) the pipeline for the requested backend, rebuilding when the
 * gpu setting changes. Falls back to WASM if WebGPU is unavailable or fails.
 */
async function getPipeline(wantGpu) {
  wantGpu = !!wantGpu;
  if (pipePromise && builtForGpu === wantGpu) return pipePromise;

  if (wantGpu && !(await webgpuAvailable())) {
    pipePromise = loadPipeline('wasm');
    return finishLoad('wasm', true);
  }

  const backend = wantGpu ? 'webgpu' : 'wasm';
  pipePromise = loadPipeline(backend);
  try {
    return await finishLoad(backend, wantGpu);
  } catch (err) {
    pipePromise = null;
    builtForGpu = null;
    if (backend === 'webgpu') {
      // GPU pipeline failed to build — fall back to WASM.
      console.warn('WebGPU pipeline failed, falling back to WASM', err);
      pipePromise = loadPipeline('wasm');
      return finishLoad('wasm', true);
    }
    throw err;
  }
}

// transformers.js does not implement Whisper language detection, so we do it
// ourselves the same way whisper.cpp does: decode a single token from the
// start-of-transcript token and read which <|lang|> token the model predicts.
function buildDetector(pipe) {
  const gc = pipe.model.generation_config;
  const sot = gc.decoder_start_token_id;
  const idToLang = new Map(
    Object.entries(gc.lang_to_id).map(([tok, id]) => [Number(id), tok.slice(2, -2)])
  );
  detectLanguage = async (audio) => {
    const { input_features } = await pipe.processor(audio);
    const out = await pipe.model.generate({
      input_features,
      decoder_input_ids: [[sot]],
      max_new_tokens: 1,
    });
    const ids = Array.isArray(out)
      ? out.flat(Infinity)
      : out && out.tolist ? out.tolist().flat(Infinity) : Array.from(out.data || out);
    const predicted = Number(ids[ids.length - 1]);
    return idToLang.get(predicted) || 'en';
  };
}

const queue = [];
let working = false;

async function drain() {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      let transcriber;
      try {
        transcriber = await getPipeline(job.gpu);
      } catch (err) {
        self.postMessage({
          type: 'error', id: job.id,
          message: String(err && err.message ? err.message : err),
        });
        continue;
      }
      try {
        // transformers.js has no built-in auto-detect, so detect it ourselves
        // when requested; otherwise force the chosen language.
        let language = job.language;
        if (!language || language === 'auto') {
          language = await detectLanguage(job.audio);
          self.postMessage({ type: 'detected', id: job.id, language });
        }
        const out = await transcriber(job.audio, {
          language,
          task: 'transcribe',
          chunk_length_s: 30,
          stride_length_s: 5,
        });
        const text = (out && out.text ? out.text : '').trim();
        self.postMessage({ type: 'result', id: job.id, text });
      } catch (err) {
        self.postMessage({
          type: 'error', id: job.id,
          message: String(err && err.message ? err.message : err),
        });
      }
    }
  } finally {
    working = false;
  }
}

self.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'transcribe') {
    queue.push({ id: msg.id, audio: msg.audio, language: msg.language, gpu: msg.gpu });
    drain();
  } else if (msg.type === 'preload') {
    getPipeline(msg.gpu).catch(() => {});
  }
});
