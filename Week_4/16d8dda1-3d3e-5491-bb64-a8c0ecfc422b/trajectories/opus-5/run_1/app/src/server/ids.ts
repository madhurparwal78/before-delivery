import { randomBytes, randomInt } from 'node:crypto';

const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';

export function newId(prefix: string): string {
  const bytes = randomBytes(12);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `${prefix}_${out}`;
}

export function newToken(): string {
  return `tok_${randomBytes(18).toString('base64url')}`;
}

/** Class codes are 6 characters from A-Z without I, L and O, and the digits 2-9. */
const codeAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newClassCode(): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) code += codeAlphabet[randomInt(codeAlphabet.length)];
  return code;
}

export function normaliseCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}
