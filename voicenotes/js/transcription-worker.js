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
let detectLanguage = null; // (audio) => Promise<langCode>, built once the model loads

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
    const pipe = await pipePromise;
    buildDetector(pipe);
    self.postMessage({ type: 'ready' });
  } catch (err) {
    pipePromise = null;
    throw err;
  }
  return pipePromise;
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
    const transcriber = await getPipeline();
    while (queue.length) {
      const job = queue.shift();
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
    queue.push({ id: msg.id, audio: msg.audio, language: msg.language });
    drain();
  } else if (msg.type === 'preload') {
    getPipeline().catch(() => {});
  }
});
