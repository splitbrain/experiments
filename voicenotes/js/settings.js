// Persisted app settings. Currently just the transcription language. We add our
// own language auto-detection (the default), since transformers.js has none and
// otherwise falls back to English.

const LANG_KEY = 'voicenotes:lang';

// 'auto' lets the worker detect the language per clip. The rest is a curated
// subset of Whisper's supported languages (code -> display name).
export const LANGUAGES = [
  { code: 'auto', name: 'Auto-detect' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'German' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'ru', name: 'Russian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'cs', name: 'Czech' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'el', name: 'Greek' },
  { code: 'ro', name: 'Romanian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ca', name: 'Catalan' },
  { code: 'ar', name: 'Arabic' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
];

/** @returns {string} the selected language code ('auto' or e.g. 'de') */
export function getLanguage() {
  return localStorage.getItem(LANG_KEY) || 'auto';
}

/** @returns {string} human-readable name for a language code */
export function languageName(code) {
  const l = LANGUAGES.find((x) => x.code === code);
  return l ? l.name : code;
}

export function setLanguage(code) {
  localStorage.setItem(LANG_KEY, code);
}

const GPU_KEY = 'voicenotes:gpu';

/** @returns {boolean} whether GPU (WebGPU) acceleration is requested */
export function getGpuEnabled() {
  return localStorage.getItem(GPU_KEY) === '1';
}

export function setGpuEnabled(on) {
  localStorage.setItem(GPU_KEY, on ? '1' : '0');
}
