// Persisted app settings. Currently just the transcription language, since
// transformers.js does not auto-detect it (it defaults to English otherwise).

const LANG_KEY = 'voicenotes:lang';

// Curated subset of Whisper's supported languages (code -> display name).
export const LANGUAGES = [
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

function defaultLanguage() {
  const nav = (navigator.language || 'en').toLowerCase().split('-')[0];
  return LANGUAGES.some((l) => l.code === nav) ? nav : 'en';
}

/** @returns {string} the selected Whisper language code (e.g. 'de') */
export function getLanguage() {
  return localStorage.getItem(LANG_KEY) || defaultLanguage();
}

export function setLanguage(code) {
  localStorage.setItem(LANG_KEY, code);
}
