import { randomInt } from 'node:crypto';

const VIEWER_CODE_LENGTH = 24;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A viewer code: letters and digits drawn from a secure source. */
export const newViewerCode = (): string => Array.from({ length: VIEWER_CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
