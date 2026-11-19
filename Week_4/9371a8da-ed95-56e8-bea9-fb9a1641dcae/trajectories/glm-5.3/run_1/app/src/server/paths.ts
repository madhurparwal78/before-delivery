const PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function isValidPath(path: string): boolean {
  if (typeof path !== 'string' || path.length < 1 || path.length > 200) return false;
  if (path.startsWith('/') || path.endsWith('/')) return false;
  const segments = path.split('/');
  if (segments.some((s) => s.length === 0 || s.length > 100)) return false;
  return segments.every((s) => PATH_RE.test(s));
}

export function isValidDeviceFileName(name: string): boolean {
  if (typeof name !== 'string' || name.length < 1 || name.length > 100) return false;
  return NAME_RE.test(name);
}

export function isValidFolderPath(path: string): boolean {
  return isValidPath(path);
}

export function extensionOf(path: string): string {
  const last = path.split('/').pop() ?? '';
  const i = last.lastIndexOf('.');
  return i < 0 ? '' : last.slice(i);
}

export function isTextPath(path: string): boolean {
  const exts = ['.tex', '.bib', '.sty', '.cls', '.bst', '.txt'];
  return exts.includes(extensionOf(path));
}
