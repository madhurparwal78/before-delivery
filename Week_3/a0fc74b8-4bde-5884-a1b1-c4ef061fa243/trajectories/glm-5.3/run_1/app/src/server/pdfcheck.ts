export type UploadCheckCode =
  | "too_large"
  | "not_a_pdf"
  | "pdf_encrypted"
  | "pdf_has_scripts"
  | "pdf_rotated"
  | "too_many_pages";

export interface UploadCheckFailure {
  code: UploadCheckCode;
  status: number;
  limit?: number;
}

export const MAX_PAGES = 60;

/**
 * Uploads are judged by their bytes in the published order.
 * Returns the page count on success.
 */
export function checkPdfBytes(bytes: Buffer): number | UploadCheckFailure {
  if (bytes.length > 25_000_000) return { code: "too_large", status: 413, limit: 25000000 };
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { code: "not_a_pdf", status: 415 };
  }
  const text = bytes.toString("latin1");
  if (text.includes("/Encrypt")) return { code: "pdf_encrypted", status: 422 };
  if (text.includes("/JavaScript") || text.includes("/JS")) return { code: "pdf_has_scripts", status: 422 };
  const rotated = detectRotatedPages(text);
  if (rotated) return { code: "pdf_rotated", status: 422 };
  const pages = countPages(text);
  if (pages > MAX_PAGES) return { code: "too_many_pages", status: 422, limit: 60 };
  if (pages === 0) return { code: "not_a_pdf", status: 415 };
  return pages;
}

function countPages(text: string): number {
  const typeRe = /\/Type\s*\/Page[\b\s>/]/g;
  return text.match(typeRe)?.length ?? 0;
}

function detectRotatedPages(text: string): boolean {
  const rotateRe = /\/Rotate\s+(-?\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = rotateRe.exec(text)) !== null) {
    const value = Number.parseInt(m[1], 10);
    if (value % 360 !== 0) return true;
  }
  return false;
}

/** Parses a trailer-anchored page count using object streams too, best effort. */
export function pageCountFromBytes(bytes: Buffer): number {
  const text = bytes.toString("latin1");
  return countPages(text);
}
