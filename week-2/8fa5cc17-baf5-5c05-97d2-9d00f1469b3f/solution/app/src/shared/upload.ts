// Upload type detection from leading bytes, and the stored filename.

export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];

const startsWith = (bytes: Uint8Array, sig: number[], at = 0): boolean =>
  bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b);
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

export function detectUploadType(bytes: Uint8Array): UploadType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(bytes, ascii('%PDF-'))) return 'application/pdf';
  return null;
}

export function storedFilename(partName: string): string {
  const base = partName.split(/[/\\]/).pop() ?? '';
  const cut = [...base.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()].slice(0, 200).join('');
  return cut === '' || cut === '.' || cut === '..' ? 'attachment' : cut;
}

export const isImageType = (type: string): boolean => type.startsWith('image/');
