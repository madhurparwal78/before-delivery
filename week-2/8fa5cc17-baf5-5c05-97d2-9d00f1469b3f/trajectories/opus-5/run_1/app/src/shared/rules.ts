/** Small domain rules with one home each. */

/* ----------------------------------------------- the safe return address */

export const RETURN_ADDRESS_MAX_CHARS = 2000;

export function safeReturnAddress(raw: string | null): string | null {
  if (raw === null) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.length > RETURN_ADDRESS_MAX_CHARS) return null;
  if (!decoded.startsWith('/')) return null;
  if (decoded.startsWith('//')) return null;
  if (decoded.includes('\\')) return null;
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) return null;
  const path = decoded.split(/[?#]/)[0];
  if (path === '/sign-in') return null;
  if (path === '/api' || path === '/s') return null;
  if (path.startsWith('/api/') || path.startsWith('/s/')) return null;
  return decoded;
}

/* --------------------------------------------- the upload type detection */

export const UPLOAD_MAX_BYTES = 10_000_000;
export const UPLOAD_REQUEST_MAX_BYTES = 10_100_000;
export const ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export function detectUploadType(bytes: Uint8Array): AttachmentType | null {
  const startsWith = (signature: number[]): boolean =>
    signature.every((byte, index) => bytes[index] === byte);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  const ascii = (offset: number, text: string): boolean =>
    Array.from(text).every((ch, index) => bytes[offset + index] === ch.charCodeAt(0));
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(0, '%PDF-')) return 'application/pdf';
  return null;
}

export function safeFilename(raw: string): string {
  let name = raw;
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (slash >= 0) name = name.slice(slash + 1);
  name = Array.from(name)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
  name = name.trim();
  if (name.length > 200) name = name.slice(0, 200);
  if (name === '' || name === '.' || name === '..') return 'attachment';
  return name;
}

export function isImageType(contentType: string): boolean {
  return contentType.startsWith('image/');
}

/* ------------------------------------------------ the share link status */

export type ShareLinkStatus = 'active' | 'expired' | 'revoked';

export function shareLinkStatus(
  link: { expiresAtUtc: Date; revokedAt: Date | null },
  now: Date = new Date(),
): ShareLinkStatus {
  if (link.revokedAt !== null) return 'revoked';
  return now.getTime() < link.expiresAtUtc.getTime() ? 'active' : 'expired';
}

/* ------------------------------------------------------- the lockout state */

export const LOCKOUT_EMAIL_FAILURES = 5;
export const LOCKOUT_ADDRESS_FAILURES = 50;

export type LockoutInput = { failureTimes: Date[]; windowSeconds: number; now: Date; threshold: number };

export function lockoutState(input: LockoutInput): { locked: boolean; retryAfterSeconds: number } {
  const windowMs = input.windowSeconds * 1000;
  const inWindow = input.failureTimes
    .filter((time) => input.now.getTime() - time.getTime() < windowMs)
    .sort((a, b) => a.getTime() - b.getTime());
  if (inWindow.length < input.threshold) return { locked: false, retryAfterSeconds: 0 };
  const last = inWindow[inWindow.length - 1];
  const liftsAt = last.getTime() + windowMs;
  const remaining = Math.max(1, Math.ceil((liftsAt - input.now.getTime()) / 1000));
  return { locked: true, retryAfterSeconds: remaining };
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/* ------------------------------------------------------ the idempotency key */

export const IDEMPOTENCY_KEY_MAX = 100;

export function isIdempotencyKey(value: string): boolean {
  if (value.length < 1 || value.length > IDEMPOTENCY_KEY_MAX) return false;
  return /^[\x21-\x7e]+$/.test(value);
}

export function isEditId(value: string): boolean {
  if (value.length < 1 || value.length > 64) return false;
  return /^[\x21-\x7e]+$/.test(value);
}
