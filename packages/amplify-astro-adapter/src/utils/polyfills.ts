// Polyfill for @astrojs/internal-helpers/path

const WITH_FILE_EXT = /\/[^/]+\.\w+$/;

export function hasFileExtension(path: string): boolean {
  return WITH_FILE_EXT.test(path);
}

const INTERNAL_PREFIXES = new Set(['/_', '/@', '/.', '//']);
const JUST_SLASHES = /^\/{2,}$/;

export function isInternalPath(path: string): boolean {
  return INTERNAL_PREFIXES.has(path.slice(0, 2)) && !JUST_SLASHES.test(path);
}
