import { createHmac, timingSafeEqual } from 'node:crypto';

/** The one signature check for counterparty exchange messages. */

const HEADER_SHAPE = /^t=(\d{1,19}),v1=([0-9a-f]{64})$/;
const TOLERANCE_SECONDS = 300;

export interface SignatureHeader {
  readonly timestampSeconds: number;
  readonly value: string;
}

export function parseSignatureHeader(header: string | undefined): SignatureHeader | null {
  if (header === undefined) return null;
  const match = HEADER_SHAPE.exec(header.trim());
  if (match === null) return null;
  return { timestampSeconds: Number.parseInt(match[1], 10), value: match[2] };
}

export function signBody(signingValue: string, timestampSeconds: number, body: Buffer): string {
  const hmac = createHmac('sha256', Buffer.from(signingValue, 'utf8'));
  hmac.update(Buffer.from(`${timestampSeconds}.`, 'utf8'));
  hmac.update(body);
  return hmac.digest('hex');
}

export function signatureMatches(
  header: SignatureHeader,
  signingValue: string,
  body: Buffer,
  now: Date,
): boolean {
  const skew = Math.abs(Math.floor(now.getTime() / 1000) - header.timestampSeconds);
  if (skew > TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signBody(signingValue, header.timestampSeconds, body), 'utf8');
  const given = Buffer.from(header.value, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
