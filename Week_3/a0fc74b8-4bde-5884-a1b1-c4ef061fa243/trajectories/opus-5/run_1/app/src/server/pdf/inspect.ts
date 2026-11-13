import { MAX_PAGES } from '../config.ts';
import { PdfReader } from './reader.ts';

export type UploadRefusal =
  | 'not_a_pdf'
  | 'pdf_encrypted'
  | 'pdf_has_scripts'
  | 'pdf_rotated'
  | 'too_many_pages';

export type UploadVerdict =
  | { ok: true; pageCount: number }
  | { ok: false; refusal: UploadRefusal };

const ROTATE_PATTERN = /\/Rotate\s+(-?\d+)/g;

const hasTurnedPage = (text: string): boolean => {
  ROTATE_PATTERN.lastIndex = 0;
  for (;;) {
    const match = ROTATE_PATTERN.exec(text);
    if (!match) return false;
    if (Number.parseInt(match[1] ?? '0', 10) % 360 !== 0) return true;
  }
};

/** Uploads are judged by their bytes, in the published order. */
export const inspectUpload = (bytes: Buffer): UploadVerdict => {
  if (bytes.toString('latin1', 0, 5) !== '%PDF-') return { ok: false, refusal: 'not_a_pdf' };
  const text = bytes.toString('latin1');
  if (/\/Encrypt\b/.test(text)) return { ok: false, refusal: 'pdf_encrypted' };
  if (/\/JavaScript\b/.test(text) || /\/JS\b/.test(text)) {
    return { ok: false, refusal: 'pdf_has_scripts' };
  }
  if (hasTurnedPage(text)) return { ok: false, refusal: 'pdf_rotated' };
  const pageCount = new PdfReader(bytes).pages().length;
  if (pageCount === 0) return { ok: false, refusal: 'not_a_pdf' };
  if (pageCount > MAX_PAGES) return { ok: false, refusal: 'too_many_pages' };
  return { ok: true, pageCount };
};
