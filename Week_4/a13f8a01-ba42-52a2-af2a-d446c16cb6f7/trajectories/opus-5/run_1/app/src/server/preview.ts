import { readFileSync } from 'node:fs';
import type { Files } from '../shared/api';
import { assetPath } from './assets';
import { config } from './config';
import { guardLoops } from './domain/loop-guard';
import { shelfLibrary } from './shelf';

const RUNTIME = readFileSync(assetPath('preview-runtime.js'), 'utf8');

export const PREVIEW_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  `script-src 'unsafe-inline' ${config.appPublicUrl}/shelf/`,
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
].join('; ');

const ALLOWED_SRC = [/^\/shelf\//, new RegExp(`^${config.appPublicUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/shelf/`)];

const isShelfSrc = (src: string): boolean => ALLOWED_SRC.some((pattern) => pattern.test(src));

const readTag = (html: string, from: number): { end: number; attributes: string } | null => {
  let index = from;
  let quote = '';
  while (index < html.length) {
    const char = html[index]!;
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return { end: index + 1, attributes: html.slice(from, index) };
    }
    index += 1;
  }
  return null;
};

const srcOf = (attributes: string): string | null => {
  const match = /\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? null;
};

/** Script elements pointing outside the shelf are not loaded, and their address is reported. */
export const stripOutsideScripts = (html: string): { html: string; blocked: string[] } => {
  const blocked: string[] = [];
  let result = '';
  let cursor = 0;
  const lower = html.toLowerCase();
  for (;;) {
    const open = lower.indexOf('<script', cursor);
    if (open === -1) break;
    const after = html[open + 7];
    if (after !== undefined && /[A-Za-z0-9]/.test(after)) {
      result += html.slice(cursor, open + 7);
      cursor = open + 7;
      continue;
    }
    const tag = readTag(html, open + 7);
    if (!tag) break;
    const src = srcOf(tag.attributes);
    if (src === null || isShelfSrc(src)) {
      result += html.slice(cursor, tag.end);
      cursor = tag.end;
      continue;
    }
    const close = lower.indexOf('</script', tag.end);
    const elementEnd = close === -1 ? html.length : (readTag(html, close + 8)?.end ?? html.length);
    blocked.push(src);
    result += html.slice(cursor, open);
    cursor = elementEnd;
  }
  return { html: result + html.slice(cursor), blocked };
};

export interface RenderSpec {
  id: string;
  nonce: string;
  files: Files;
  libraries: readonly string[];
}

const escapeRawText = (text: string, tag: string): string =>
  text.replace(new RegExp(`</(?=${tag})`, 'gi'), '<\\/');

const countLines = (text: string): number => text.split('\n').length - 1;

export const previewDocument = (spec: RenderSpec): string => {
  const body = stripOutsideScripts(spec.files.html);
  const scripts = spec.libraries
    .map((id) => shelfLibrary(id))
    .filter((library): library is NonNullable<typeof library> => library !== undefined)
    .map((library) => `<script src="${library.entry.path}"></script>`)
    .join('\n');

  const settings = JSON.stringify({
    render: spec.id,
    nonce: spec.nonce,
    loopLimit: config.loopLimit,
    blockedScripts: body.blocked,
  });

  const head =
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<style>\n${escapeRawText(spec.files.css, 'style')}\n</style>\n` +
    `<script>window.__ASHLAR_PREVIEW__=${settings};</script>\n` +
    `<script>${RUNTIME}</script>\n</head>\n<body>\n`;

  // The line offset tells the runtime where the JS pane starts in the document. Its own digits
  // add no newlines, so the offset counted from a placeholder prefix is the final one.
  const prefixOf = (offset: number): string =>
    `${head}${body.html}\n${scripts}${scripts ? '\n' : ''}` +
    `<script>window.__ashlarJsLineOffset=${offset};</script>\n<script>\n`;
  const jsLineOffset = countLines(prefixOf(0));

  return (
    `${prefixOf(jsLineOffset)}${escapeRawText(guardLoops(spec.files.js), 'script')}\n</script>\n` +
    `</body>\n</html>\n`
  );
};
