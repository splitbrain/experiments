// Keep transformers.js's model cache lean. transformers.js stores model files in
// a Cache Storage bucket named 'transformers-cache' (keyed by file URL) and never
// evicts anything on its own. We remove:
//   1. files of other Whisper models (e.g. an old whisper-base after upgrading), and
//   2. weight files of a different precision than the one in use — notably the
//      q4f16 GPU weights left over from the (removed) WebGPU experiment.
// Only the active model's q8 (`_quantized`) weights are kept.

// Known weight-file dtype suffixes; all but `keepDtype` are removed.
const KNOWN_DTYPES = ['quantized', 'q4f16'];

/**
 * @param {string} currentModel e.g. 'Xenova/whisper-small'
 * @param {string} keepDtype the dtype suffix to keep ('quantized')
 * @returns {Promise<number>} number of cache entries removed
 */
export async function cleanupModelCache(currentModel, keepDtype) {
  if (typeof caches === 'undefined') return 0;
  let removed = 0;
  try {
    const cache = await caches.open('transformers-cache');
    const current = currentModel.split('/').pop().toLowerCase();
    for (const req of await cache.keys()) {
      const url = req.url;
      const m = url.match(/\/(whisper-[\w.-]+?)\//i);
      if (!m) continue; // leave non-Whisper entries (e.g. the ONNX runtime) alone

      let drop = false;
      if (m[1].toLowerCase() !== current) {
        drop = true; // a different Whisper model entirely
      } else if (/\.onnx(_data)?$/.test(url)) {
        // Same model: drop weight files of a different precision than we use.
        drop = KNOWN_DTYPES.some(
          (d) => d !== keepDtype && new RegExp(`_${d}\\.onnx`).test(url)
        );
      }
      if (drop && (await cache.delete(req))) removed++;
    }
  } catch (err) {
    console.warn('Model cache cleanup failed', err);
  }
  return removed;
}
