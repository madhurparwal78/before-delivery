import { randomBytes } from 'node:crypto';

// Identifiers: the shapes the app issues and accepts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_LENGTH = 10;
const REFERENCE_LENGTH = 8;
const NO_ROW = '00000000-0000-0000-0000-000000000000';

export const isUuid = (value: string | undefined): value is string => value !== undefined && UUID.test(value);

/** A path id that names nothing when it is not a uuid, so a lookup finds no row. */
export const uuidOr = (value: string | undefined): string => (isUuid(value) ? value : NO_ROW);

export const newSlug = (): string => Array.from(randomBytes(SLUG_LENGTH), (byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length]).join('');

/** The first 8 characters of the response id (brief: Formats). */
export const referenceOf = (id: string): string => id.slice(0, REFERENCE_LENGTH);
