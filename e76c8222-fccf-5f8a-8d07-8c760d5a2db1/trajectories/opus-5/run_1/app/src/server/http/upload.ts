import busboy from 'busboy';
import { Request } from 'express';
import { fail } from './errors';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface UploadedFile {
  partName: string;
  filename: string;
  declaredType: string;
  bytes: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: UploadedFile[];
}

export async function readMultipart(req: Request): Promise<MultipartBody> {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.includes('multipart/form-data')) {
    throw fail('unsupported_media_type');
  }
  return new Promise<MultipartBody>((resolve, reject) => {
    const parser = busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD_BYTES, files: 4 } });
    const fields: Record<string, string> = {};
    const files: UploadedFile[] = [];
    let settled = false;
    const settle = (error: Error | null, body?: MultipartBody): void => {
      if (settled) return;
      settled = true;
      req.unpipe(parser);
      if (error) reject(error);
      else if (body) resolve(body);
    };

    parser.on('field', (name, value) => {
      fields[name] = value;
    });
    parser.on('file', (name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => settle(fail('payload_too_large')));
      stream.on('end', () => {
        files.push({
          partName: name,
          filename: info.filename ?? 'upload',
          declaredType: info.mimeType,
          bytes: Buffer.concat(chunks),
        });
      });
    });
    parser.on('error', () => settle(fail('bad_json')));
    parser.on('close', () => settle(null, { fields, files }));
    req.pipe(parser);
  });
}

type FileFamily = 'pdf' | 'png' | 'jpeg' | 'zip' | 'text';

const FAMILY_BY_TYPE: Record<string, FileFamily> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'zip',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'zip',
  'text/plain': 'text',
};

export const PREP_TYPES: readonly string[] = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'image/png',
  'image/jpeg',
];

export const SCAN_TYPES: readonly string[] = ['application/pdf', 'image/png', 'image/jpeg'];

function sniff(bytes: Buffer): FileFamily | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg';
  if (bytes.subarray(0, 2).toString('latin1') === 'PK') return 'zip';
  const text = bytes.toString('utf8');
  if (!text.includes('\uFFFD') && !text.includes('\u0000') && bytes.length > 0) return 'text';
  return null;
}

function typeFromExtension(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.pptx')) {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  if (lower.endsWith('.txt')) return 'text/plain';
  return null;
}

/** The stored content type, decided from the bytes and the declared type together. */
export function resolveContentType(file: UploadedFile, allowed: readonly string[]): string {
  const family = sniff(file.bytes);
  if (!family) throw fail('unsupported_media_type');
  const declared = (file.declaredType.split(';')[0] ?? '').trim().toLowerCase();
  const candidate = FAMILY_BY_TYPE[declared] ? declared : typeFromExtension(file.filename);
  if (!candidate || !allowed.includes(candidate)) throw fail('unsupported_media_type');
  if (FAMILY_BY_TYPE[candidate] !== family) throw fail('unsupported_media_type');
  return candidate;
}

export function singleFile(body: MultipartBody, partName: string): UploadedFile {
  const file = body.files.find((item) => item.partName === partName);
  if (!file) throw fail('unsupported_media_type');
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw fail('payload_too_large');
  return file;
}
