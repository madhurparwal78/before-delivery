import { limits } from '../config.js';

export type PathProblem = 'absolute_path' | 'path_traversal' | 'path_too_long' | 'disallowed_type';
export type ContentProblem = 'content_mismatch' | 'unsafe_svg' | 'file_too_large';

const ALLOWED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.html',
  '.css',
  '.json',
  '.md',
  '.txt',
  '.svg',
  '.yml',
  '.yaml',
]);

const ALLOWED_WHOLE_NAMES = new Set(['.gitignore', 'Makefile', 'README', 'LICENSE']);

/** The one place a path is normalised. */
export function normalisePath(raw: string): string {
  let path = raw.replaceAll('\\', '/');
  while (path.startsWith('./')) path = path.slice(2);
  path = path.replace(/\/{2,}/g, '/');
  return path.normalize('NFC');
}

/** The one place a normalised path is judged. */
export function checkPath(normalised: string): PathProblem | null {
  if (normalised.startsWith('/') || /^[A-Za-z]:/.test(normalised)) return 'absolute_path';
  if (normalised.split('/').includes('..')) return 'path_traversal';
  if (normalised.length > limits.pathChars) return 'path_too_long';
  if (!isAllowedName(normalised)) return 'disallowed_type';
  return null;
}

function isAllowedName(normalised: string): boolean {
  const segments = normalised.split('/');
  const name = segments[segments.length - 1] ?? '';
  if (name === '') return false;
  if (ALLOWED_WHOLE_NAMES.has(name)) return true;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return ALLOWED_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/** The one place file bytes are judged. */
export function checkContent(normalised: string, bytes: Buffer): ContentProblem | null {
  if (bytes.length > limits.fileContentBytes) return 'file_too_large';
  if (bytes.includes(0)) return 'content_mismatch';
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) return 'content_mismatch';
  if (normalised.toLowerCase().endsWith('.svg') && isUnsafeSvg(text)) return 'unsafe_svg';
  return null;
}

function isUnsafeSvg(text: string): boolean {
  if (/<\s*script[\s>/]/i.test(text)) return true;
  return /[\s"'/]on[a-z-]*\s*=/i.test(text);
}

export const pathProblemMessages: Record<PathProblem | ContentProblem, string> = {
  absolute_path: 'Use a path inside the project, not an absolute one.',
  path_traversal: 'Paths may not leave the project folder.',
  path_too_long: 'Use a path of at most 255 characters.',
  disallowed_type: 'That file type is not allowed.',
  content_mismatch: 'File contents must be readable UTF-8 text.',
  unsafe_svg: 'An SVG may not contain script.',
  file_too_large: 'That file is too large to save.',
};
