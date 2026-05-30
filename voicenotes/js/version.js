// Build metadata. The __BUILD_ID__ / __BUILD_DATE__ tokens are replaced by the
// GitHub Actions deploy workflow (commit SHA and build date). In local
// development the literal placeholders remain, which we render as "dev".

export const VERSION = '__BUILD_ID__';
export const BUILD_DATE = '__BUILD_DATE__';

/** Short, human-friendly version label, e.g. "v1a2b3c4" or "dev". */
export function versionLabel() {
  if (VERSION.includes('__')) return 'dev';
  return 'v' + VERSION.slice(0, 7);
}
