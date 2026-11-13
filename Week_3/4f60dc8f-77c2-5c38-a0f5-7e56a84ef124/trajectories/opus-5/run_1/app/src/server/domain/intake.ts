import type { IntakeKind } from '../../shared/domain.js';

export type IntakeType = {
  kind: IntakeKind;
  extensions: readonly string[];
  capBytes: number;
  contentType: string;
  matches: (prefix: Buffer) => boolean | 'need-more';
};

const startsWithText = (prefix: Buffer, text: string): boolean | 'need-more' => {
  const expected = Buffer.from(text, 'ascii');
  if (prefix.length < expected.length) {
    return prefix.equals(expected.subarray(0, prefix.length)) ? 'need-more' : false;
  }
  return prefix.subarray(0, expected.length).equals(expected);
};

export const INTAKE_TYPES: readonly IntakeType[] = [
  {
    kind: 'model',
    extensions: ['glb'],
    capBytes: 250_000_000,
    contentType: 'model/gltf-binary',
    matches: (prefix) => startsWithText(prefix, 'glTF'),
  },
  {
    kind: 'step',
    extensions: ['step', 'stp'],
    capBytes: 250_000_000,
    contentType: 'model/step',
    matches: (prefix) => {
      const text = prefix.toString('latin1');
      const trimmed = text.replace(/^[\s]+/, '');
      if (trimmed === '' && /^\s*$/.test(text)) return 'need-more';
      return startsWithText(Buffer.from(trimmed, 'latin1'), 'ISO-10303-21;');
    },
  },
  {
    kind: 'reference',
    extensions: ['pdf'],
    capBytes: 25_000_000,
    contentType: 'application/pdf',
    matches: (prefix) => startsWithText(prefix, '%PDF-'),
  },
];

export const STILL_CAP_BYTES = 20_000_000;

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

export const stillContentType = (prefix: Buffer): 'image/png' | 'image/jpeg' | null => {
  if (prefix.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'image/png';
  if (prefix.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return 'image/jpeg';
  return null;
};

export const extensionOf = (displayName: string): string => {
  const dot = displayName.lastIndexOf('.');
  return dot === -1 ? '' : displayName.slice(dot + 1).toLowerCase();
};

export const typeForExtension = (extension: string): IntakeType | null =>
  INTAKE_TYPES.find((type) => type.extensions.includes(extension)) ?? null;

export const objectExtension: Record<IntakeKind, string> = {
  model: 'glb',
  step: 'step',
  reference: 'pdf',
};

/**
 * The published display name: no directory part, no path separators, no control
 * characters, cut to 120 characters, non-ASCII kept.
 */
export const displayNameOf = (uploadedName: string): string => {
  const withoutDirectories = uploadedName.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = withoutDirectories.replace(/[\u0000-\u001f\u007f]/g, '');
  return cleaned.slice(0, 120);
};

/** RFC 6266 headers: an ASCII fallback plus the exact display name, percent-encoded. */
export const contentDisposition = (displayName: string): string => {
  const fallback = displayName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(displayName).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

export const intakeObjectKey = (
  engagementId: string,
  fileId: string,
  kind: IntakeKind,
): string => `intake/${engagementId}/${fileId}.${objectExtension[kind]}`;

export const stillObjectKey = (
  engagementId: string,
  milestone: string,
  stillId: string,
  contentType: string,
): string =>
  `stills/${engagementId}/${milestone}/${stillId}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
