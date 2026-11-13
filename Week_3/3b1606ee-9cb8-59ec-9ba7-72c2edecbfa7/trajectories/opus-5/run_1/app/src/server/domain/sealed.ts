import {
  base64urlDecode,
  isBase64url,
  isValidCiphertextLength,
  IV_BYTES,
} from '../../shared/scheme.js';

/** Shape checks for the sealed values the browser sends. */

export function isIv(value: unknown): value is string {
  return isBase64url(value) && base64urlDecode(value).length === IV_BYTES;
}

export function isSealedBody(value: unknown): value is string {
  return isBase64url(value) && isValidCiphertextLength(base64urlDecode(value).length);
}

export function isSealedBytes(value: unknown, bytes: number): value is string {
  return isBase64url(value) && base64urlDecode(value).length === bytes;
}

export function isSealedBlob(value: unknown): value is string {
  return isBase64url(value) && value.length > 0;
}
