// Reclaim space after a model upgrade: remove cached files belonging to Whisper
// models other than the active one from transformers.js's cache. transformers.js
// stores model files in a Cache Storage bucket named 'transformers-cache', keyed
// by file URL (e.g. .../Xenova/whisper-base/resolve/main/...), and never evicts
// old models on its own.

/**
 * @param {string} currentModel e.g. 'Xenova/whisper-small'
 * @returns {Promise<number>} number of cache entries removed
 */
export async function cleanupOtherModels(currentModel) {
  if (typeof caches === 'undefined') return 0;
  let removed = 0;
  try {
    const cache = await caches.open('transformers-cache');
    const current = currentModel.split('/').pop().toLowerCase();
    for (const req of await cache.keys()) {
      const m = req.url.match(/\/(whisper-[\w.-]+?)\//i);
      if (m && m[1].toLowerCase() !== current) {
        if (await cache.delete(req)) removed++;
      }
    }
  } catch (err) {
    console.warn('Model cache cleanup failed', err);
  }
  return removed;
}
