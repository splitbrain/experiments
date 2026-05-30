// Decode a recorded audio Blob into a 16 kHz mono Float32Array, the input
// format Whisper expects.

const TARGET_RATE = 16000;

/**
 * @param {Blob} blob recorded audio (webm/opus, mp4, etc.)
 * @returns {Promise<Float32Array>} mono PCM samples at 16 kHz
 */
export async function blobToPcm16k(blob) {
  const arrayBuffer = await blob.arrayBuffer();

  // Decode using a short-lived AudioContext (decodeAudioData needs a real one).
  const AC = window.AudioContext || window.webkitAudioContext;
  const decodeCtx = new AC();
  let decoded;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    decodeCtx.close();
  }

  // Downmix to mono.
  const channels = decoded.numberOfChannels;
  const length = decoded.length;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < channels; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }

  if (decoded.sampleRate === TARGET_RATE) return mono;

  // Resample to 16 kHz with an OfflineAudioContext.
  const duration = length / decoded.sampleRate;
  const targetLength = Math.max(1, Math.ceil(duration * TARGET_RATE));
  const offline = new OfflineAudioContext(1, targetLength, TARGET_RATE);
  const monoBuffer = offline.createBuffer(1, length, decoded.sampleRate);
  monoBuffer.copyToChannel(mono, 0);
  const src = offline.createBufferSource();
  src.buffer = monoBuffer;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}
