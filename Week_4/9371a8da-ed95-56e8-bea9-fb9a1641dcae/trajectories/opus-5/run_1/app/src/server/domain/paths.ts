const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

export const PATH_MESSAGE =
  'Use letters, digits, dots, hyphens and underscores, separated by slashes.';

export const TEXT_EXTENSIONS = ['.tex', '.bib', '.sty', '.cls', '.bst', '.txt'];

export function isValidPath(path: string): boolean {
  if (path.length < 1 || path.length > 200) return false;
  if (path.startsWith('/') || path.endsWith('/')) return false;
  const segments = path.split('/');
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) return false;
    if (segment.startsWith('.')) return false;
  }
  return true;
}

/** A folder part of an upload target: a valid path, or the project root. */
export function isValidFolder(folder: string): boolean {
  return folder === '' || isValidPath(folder);
}

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

export function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.includes(extensionOf(path));
}

export function joinFolder(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`;
}

const DEVICE_NAME = /^[A-Za-z0-9._-]{1,100}$/;

export function isValidDeviceFileName(name: string): boolean {
  return DEVICE_NAME.test(name) && !name.startsWith('.');
}

/**
 * Resolves an include target from the project root, dropping `.` segments and
 * applying `..`. Targets that would leave the root are refused.
 */
export function resolveFromRoot(target: string): string | null {
  const raw = target.trim();
  if (raw === '') return null;
  const parts = raw.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  if (stack.length === 0) return null;
  return stack.join('/');
}

export function withTexExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.includes('.') ? path : `${path}.tex`;
}

export function withBibExtension(path: string): string {
  return path.toLowerCase().endsWith('.bib') ? path : `${path}.bib`;
}
