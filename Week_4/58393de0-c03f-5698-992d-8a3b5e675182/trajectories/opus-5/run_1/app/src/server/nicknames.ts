import { FIELD_COPY } from '../shared/copy.js';
import { validation } from './errors.js';

const ALLOWED = /^[\p{L}\p{N} \-']+$/u;

export interface Nickname {
  display: string;
  key: string;
}

/** One place decides what a nickname is and when two of them collide. */
export const normaliseNickname = (raw: unknown): Nickname => {
  const trimmed = typeof raw === 'string' ? raw.trim().replace(/ {2,}/g, ' ') : '';
  if (trimmed.length < 2 || trimmed.length > 24 || !ALLOWED.test(trimmed)) {
    throw validation({ nickname: FIELD_COPY.nickname });
  }
  return { display: trimmed, key: trimmed.toLowerCase() };
};
