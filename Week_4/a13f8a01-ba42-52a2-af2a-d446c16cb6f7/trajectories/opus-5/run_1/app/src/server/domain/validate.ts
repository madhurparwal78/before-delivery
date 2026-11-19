import type { Files, PaneName, Visibility } from '../../shared/api';
import { copy } from '../../shared/copy';
import { config } from '../config';
import { apiError } from '../errors';
import { isShelfId } from '../shelf';
import { PANES } from './diff';

const HANDLE = /^[a-z0-9-]{3,20}$/;
const TAG = /^[a-z0-9-]{1,24}$/;
const VISIBILITIES: readonly Visibility[] = ['private', 'unlisted', 'public'];

export const isHandle = (value: unknown): value is string =>
  typeof value === 'string' && HANDLE.test(value);

export const isEmail = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  return local.length > 0 && domain.length > 0 && domain.includes('.') && !/\s/.test(value);
};

export const isPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 10;

export const isTitle = (value: unknown): value is string =>
  typeof value === 'string' && [...value].length >= 1 && [...value].length <= 80;

export const isVisibility = (value: unknown): value is Visibility =>
  typeof value === 'string' && VISIBILITIES.includes(value as Visibility);

export const validationError = (fields: Record<string, string>): never => {
  throw apiError('validation', { fields });
};

export const requireTitle = (value: unknown): string => {
  if (!isTitle(value)) validationError({ title: copy.titleInvalid });
  return value as string;
};

export const requireTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) validationError({ tags: copy.tagFormat });
  const tags = value as unknown[];
  if (tags.length > config.maxTags) validationError({ tags: copy.tooManyTags(config.maxTags) });
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== 'string' || !TAG.test(tag)) validationError({ tags: copy.tagFormat });
    if (seen.has(tag as string)) validationError({ tags: copy.duplicateTag });
    seen.add(tag as string);
  }
  return tags as string[];
};

export const requireLibraries = (value: unknown): string[] => {
  if (!Array.isArray(value)) validationError({ libraries: 'Libraries must be a list of shelf ids.' });
  const libraries = value as unknown[];
  const seen = new Set<string>();
  for (const library of libraries) {
    if (typeof library !== 'string' || !isShelfId(library)) {
      validationError({ libraries: 'Pens load libraries only from the pinned shelf.' });
    }
    if (seen.has(library as string)) {
      validationError({ libraries: 'A library can be listed only once.' });
    }
    seen.add(library as string);
  }
  return libraries as string[];
};

export const requireFiles = (value: unknown): Files => {
  if (typeof value !== 'object' || value === null) {
    validationError({ files: 'Send the html, css and js panes.' });
  }
  const record = value as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const pane of PANES) {
    if (typeof record[pane] !== 'string') fields[pane] = 'This pane must be text.';
  }
  if (Object.keys(fields).length > 0) validationError(fields);
  for (const pane of PANES) {
    const bytes = Buffer.byteLength(record[pane] as string, 'utf8');
    if (bytes > config.paneLimitBytes) {
      fields[pane] = copy.savePaneTooBig(pane as PaneName, config.paneLimitBytes);
    }
  }
  if (Object.keys(fields).length > 0) validationError(fields);
  return { html: record.html as string, css: record.css as string, js: record.js as string };
};

export const requireVersionNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    validationError({ [field]: 'Send a whole version number.' });
  }
  return value as number;
};
