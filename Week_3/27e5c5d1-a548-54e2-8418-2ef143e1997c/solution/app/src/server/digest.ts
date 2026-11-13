import { createHash } from 'node:crypto';

/** Hex SHA-256 of a string or bytes: session-token hashes and request payload hashes. */
export const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
