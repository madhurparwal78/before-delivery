/** The upload type and size check: the one place bytes are judged against a declared type. */

export const MAX_UPLOAD_BYTES = 10_000_000;

export type DocumentKind = 'invoice' | 'packing-slip';
export type UploadType = 'application/pdf' | 'image/jpeg' | 'image/png';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

export function declaredUploadType(contentType: string | undefined): UploadType | null {
  const base = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (base === 'application/pdf') return 'application/pdf';
  if (base === 'image/jpeg') return 'image/jpeg';
  if (base === 'image/png') return 'image/png';
  return null;
}

function startsWith(bytes: Buffer, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

export function bytesMatchType(bytes: Buffer, type: UploadType): boolean {
  if (bytes.length === 0) return false;
  if (type === 'application/pdf') return startsWith(bytes, PDF_SIGNATURE);
  if (type === 'image/png') return startsWith(bytes, PNG_SIGNATURE);
  return startsWith(bytes, JPEG_SIGNATURE);
}

export function kindAcceptsType(kind: DocumentKind, type: UploadType): boolean {
  if (kind === 'invoice') return type === 'application/pdf';
  return type === 'image/jpeg' || type === 'image/png';
}

export function objectKeyFor(cycleId: string, kind: DocumentKind, type: UploadType): string {
  if (kind === 'invoice') return `cycles/${cycleId}/invoice.pdf`;
  return `cycles/${cycleId}/packing-slip.${type === 'image/png' ? 'png' : 'jpg'}`;
}

export function downloadFileName(key: string): string {
  const name = key.slice(key.lastIndexOf('/') + 1);
  return name;
}
