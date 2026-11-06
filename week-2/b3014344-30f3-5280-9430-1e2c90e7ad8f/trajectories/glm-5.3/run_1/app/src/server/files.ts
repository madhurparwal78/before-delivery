import type { Db } from './db.js';
import { HttpError, newId, config } from './util.js';

export interface FileRow {
  id: string;
  projectId: string;
  kind: 'asset' | 'deliverable';
  name: string;
  type: string;
  size: number;
  uploadedBy: string | null;
  uploadedAt: Date;
}

const ALLOWED_TYPES = ['PNG', 'JPEG', 'WEBP', 'SVG', 'PDF', 'WOFF2', 'OTF', 'TTF'];
const EXTENSIONS: Record<string, string[]> = {
  PNG: ['png'],
  JPEG: ['jpg', 'jpeg'],
  WEBP: ['webp'],
  SVG: ['svg'],
  PDF: ['pdf'],
  WOFF2: ['woff2'],
  OTF: ['otf'],
  TTF: ['ttf'],
};

/** The one place that judges an upload's name: the publish allowlist. */
export function validFileName(name: string): boolean {
  if (name.length < 1 || name.length > 120) return false;
  if (name.startsWith('.')) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  return true;
}

/** The one place that detects a file's type from its first bytes. */
export function detectType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'PNG';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'WEBP';
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'PDF';
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'wOF2') return 'WOFF2';
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OTTO') return 'OTF';
  if (bytes.length >= 4 && bytes[0] === 0x00 && (bytes[1] === 0x01 || bytes[1] === 0x02) && bytes[2] === 0x00) return 'TTF';
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'true') return 'TTF';
  const head = bytes.subarray(0, 2048).toString('utf8');
  if (head.includes('<svg')) return 'SVG';
  return null;
}

/** SVG is accepted only when its root element is svg and it carries no script. */
export function safeSvg(bytes: Buffer): boolean {
  let text = bytes.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '');
  text = text.replace(/^<\?xml[^>]*\?>/, '').replace(/^<!--[\s\S]*?-->/g, '').trimStart();
  if (!/^<svg[\s>]/i.test(text)) return false;
  if (/<\s*script/i.test(text)) return false;
  if (/\son[a-z]+\s*=/i.test(text)) return false;
  if (/javascript\s*:/i.test(text)) return false;
  if (/<\s*foreignObject/i.test(text)) return false;
  return true;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

export interface UploadCheckResult {
  type: string;
}

/** The one place that decides whether an upload passes the allowlist. */
export function checkUpload(name: string, bytes: Buffer): UploadCheckResult {
  if (!validFileName(name)) {
    throw new HttpError(422, 'invalid_file_name', "That file name can't be stored. Rename the file and try again.", {
      file: "That file name can't be stored. Rename the file and try again.",
    });
  }
  const type = detectType(bytes);
  if (type === null) {
    throw new HttpError(415, 'unsupported_file_type', `${name} is not an accepted file type.`);
  }
  if (type === 'SVG' && !safeSvg(bytes)) {
    throw new HttpError(415, 'unsupported_file_type', `${name} is not an accepted file type.`);
  }
  const extension = extensionOf(name);
  if (!ALLOWED_TYPES.includes(type) || !EXTENSIONS[type]!.includes(extension)) {
    throw new HttpError(415, 'unsupported_file_type', `${name} is not an accepted file type.`);
  }
  if (bytes.length > 10_000_000) {
    throw new HttpError(413, 'file_too_large', `${name} is larger than 10 MB.`);
  }
  return { type };
}

export const UPLOAD_ALLOWLIST_SENTENCE = 'Accepted: PNG, JPEG, WebP, SVG, PDF, WOFF2, OTF and TTF, up to 10 MB each.';

export async function insertFile(db: Db, input: {
  projectId: string;
  kind: 'asset' | 'deliverable';
  name: string;
  type: string;
  size: number;
  uploadedBy: string | null;
}): Promise<FileRow> {
  const id = newId();
  await db.query(
    'INSERT INTO files (id, project_id, kind, name, type, size, uploaded_by, uploaded_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())',
    [id, input.projectId, input.kind, input.name, input.type, input.size, input.uploadedBy],
  );
  return {
    id,
    projectId: input.projectId,
    kind: input.kind,
    name: input.name,
    type: input.type,
    size: input.size,
    uploadedBy: input.uploadedBy,
    uploadedAt: new Date(),
  };
}

export async function listProjectFiles(db: Db, projectId: string, kind: 'asset' | 'deliverable'): Promise<FileRow[]> {
  const result = await db.query('SELECT * FROM files WHERE project_id = $1 AND kind = $2 ORDER BY uploaded_at ASC', [projectId, kind]);
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    projectId: row.project_id as string,
    kind: row.kind as 'asset' | 'deliverable',
    name: row.name as string,
    type: row.type as string,
    size: Number(row.size),
    uploadedBy: row.uploaded_by as string | null,
    uploadedAt: new Date(row.uploaded_at as Date),
  }));
}

export interface LinkRow {
  id: string;
  fileId: string | null;
  invoiceId: string | null;
  userId: string;
  expiresAt: Date;
}

export async function createDownloadLink(db: Db, input: { fileId: string | null; invoiceId: string | null; userId: string }): Promise<{ url: string; expiresAt: Date }> {
  const id = newId();
  const expiresAt = new Date(Date.now() + config.downloadLinkSeconds * 1000);
  await db.query('INSERT INTO download_links (id, file_id, invoice_id, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, now())', [
    id,
    input.fileId,
    input.invoiceId,
    input.userId,
    expiresAt.toISOString(),
  ]);
  return { url: `/download/${id}`, expiresAt };
}

export async function getDownloadLink(db: Db, linkId: string): Promise<LinkRow | null> {
  const result = await db.query('SELECT * FROM download_links WHERE id = $1', [linkId]);
  if (result.rowCount === 0) return null;
  const row = result.rows[0] as Record<string, unknown>;
  return {
    id: row.id as string,
    fileId: (row.file_id as string | null) ?? null,
    invoiceId: (row.invoice_id as string | null) ?? null,
    userId: row.user_id as string,
    expiresAt: new Date(row.expires_at as Date),
  };
}
