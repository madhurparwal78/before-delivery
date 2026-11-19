import { decodeReferences, localName, parseXml, walk, XmlElement } from './xml.js';
import { isUnstorableText, TEXT_BYTE_LIMIT } from './validation.js';

export type UploadKind = 'png' | 'jpeg' | 'pdf' | 'svg' | 'bib';

export interface UploadType {
  kind: UploadKind;
  contentType: string;
  extensions: string[];
  maximumSize: number;
}

const TYPES: UploadType[] = [
  { kind: 'png', contentType: 'image/png', extensions: ['.png'], maximumSize: 10_000_000 },
  { kind: 'jpeg', contentType: 'image/jpeg', extensions: ['.jpg', '.jpeg'], maximumSize: 10_000_000 },
  { kind: 'pdf', contentType: 'application/pdf', extensions: ['.pdf'], maximumSize: 10_000_000 },
  { kind: 'svg', contentType: 'image/svg+xml', extensions: ['.svg'], maximumSize: 10_000_000 },
  { kind: 'bib', contentType: 'text/plain; charset=utf-8', extensions: ['.bib'], maximumSize: TEXT_BYTE_LIMIT },
];

export function uploadTypeFor(kind: UploadKind): UploadType {
  return TYPES.find((type) => type.kind === kind) as UploadType;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodeUtf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** True when the parsed SVG passes every SVG check. */
function svgIsSafe(root: XmlElement, hasDoctypeOrEntityDeclaration: boolean): boolean {
  if (hasDoctypeOrEntityDeclaration) return false;
  if (localName(root.name).toLowerCase() !== 'svg') return false;

  let safe = true;
  walk(root, (node) => {
    const element = localName(node.name).toLowerCase();
    if (element === 'script' || element === 'foreignobject') safe = false;
    if (element === 'style' && hasOutsideUrl(node.text)) safe = false;
    for (const attribute of node.attributes) {
      const name = localName(attribute.name);
      if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue;
      if (name.toLowerCase().startsWith('on')) safe = false;
      const value = normaliseAttributeValue(attribute.value);
      if (value.startsWith('javascript:')) safe = false;
      if (name === 'href' || name === 'src') {
        if (!value.startsWith('#')) safe = false;
      }
      if (name === 'style' && hasOutsideUrl(attribute.value)) safe = false;
    }
  });
  return safe;
}

/** Attribute values are judged with references decoded, spacing removed, case folded. */
function normaliseAttributeValue(value: string): string {
  const decoded = decodeReferences(value);
  let out = '';
  for (const ch of decoded) {
    const code = ch.codePointAt(0) as number;
    if (code <= 0x20 || code === 0x7f) continue;
    out += ch;
  }
  return out.toLowerCase();
}

function hasOutsideUrl(styleText: string): boolean {
  const decoded = decodeReferences(styleText);
  const pattern = /url\(([^)]*)\)/gi;
  let match = pattern.exec(decoded);
  while (match !== null) {
    const raw = match[1].trim().replace(/^["']|["']$/g, '');
    const value = normaliseAttributeValue(raw);
    if (!value.startsWith('#')) return true;
    match = pattern.exec(decoded);
  }
  return false;
}

export type UploadJudgement =
  | { outcome: 'accepted'; type: UploadType; text: string | null }
  | { outcome: 'too_large' }
  | { outcome: 'unsupported' };

/** Judges an upload from its bytes, then requires the extension to match. */
export function judgeUpload(bytes: Buffer, extension: string): UploadJudgement {
  const kind = detectKind(bytes);
  if (kind === null) return { outcome: 'unsupported' };
  const type = uploadTypeFor(kind);
  if (!type.extensions.includes(extension)) return { outcome: 'unsupported' };
  if (bytes.length > type.maximumSize) return { outcome: 'too_large' };

  if (kind === 'svg') {
    const text = decodeUtf8(bytes);
    if (text === null) return { outcome: 'unsupported' };
    const document = parseXml(text);
    if (document === null) return { outcome: 'unsupported' };
    if (!svgIsSafe(document.root, document.hasDoctypeOrEntityDeclaration)) {
      return { outcome: 'unsupported' };
    }
    return { outcome: 'accepted', type, text: null };
  }

  if (kind === 'bib') {
    const text = decodeUtf8(bytes);
    if (text === null || isUnstorableText(text)) return { outcome: 'unsupported' };
    return { outcome: 'accepted', type, text };
  }

  return { outcome: 'accepted', type, text: null };
}

function detectKind(bytes: Buffer): UploadKind | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const text = decodeUtf8(bytes);
  if (text === null) return null;
  const trimmed = text.replace(/^\ufeff/, '').trimStart();
  if (trimmed.startsWith('<')) return 'svg';
  if (!isUnstorableText(text)) return 'bib';
  return null;
}
