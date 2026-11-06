import type { CandidateNote } from './boundary';
import { MAX_HOP } from './boundary';
import { isValidTimeZone } from './time';

export type FieldErrors = Record<string, string>;

export const MAX_CANDIDATE_NOTES = 500;

export function validateEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return 'must be a valid address, up to 254 characters';
  const email = value.trim();
  if (email.length > 254) return 'must be a valid address, up to 254 characters';
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return 'must be a valid address, up to 254 characters';
  return null;
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string') return 'must be 10 to 128 characters';
  return value.length >= 10 && value.length <= 128 ? null : 'must be 10 to 128 characters';
}

export function validateDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return 'must be 1 to 60 characters';
  return value.trim().length >= 1 && value.trim().length <= 60 ? null : 'must be 1 to 60 characters';
}

export function validateTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || !isValidTimeZone(value)) return 'must be an IANA zone name';
  return value.includes('/') || value === 'UTC' ? null : 'must be an IANA zone name';
}

export function validateDeviceName(value: unknown): string | null {
  if (typeof value !== 'string') return 'must be 1 to 40 characters';
  return value.trim().length >= 1 && value.trim().length <= 40 ? null : 'must be 1 to 40 characters';
}

export function validateVaultName(value: unknown): string | null {
  if (typeof value !== 'string') return 'must be 1 to 80 characters';
  return value.trim().length >= 1 && value.trim().length <= 80 ? null : 'must be 1 to 80 characters';
}

function isBase64(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

export function validateKeyEnvelope(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'must hold salt, iterations, iv and wrapped_key';
  const envelope = value as Record<string, unknown>;
  if (!isBase64(envelope.salt) || !isBase64(envelope.iv) || !isBase64(envelope.wrapped_key)) {
    return 'must hold salt, iterations, iv and wrapped_key';
  }
  if (!Number.isInteger(envelope.iterations) || Number(envelope.iterations) <= 0) {
    return 'must hold salt, iterations, iv and wrapped_key';
  }
  return null;
}

export function validateSlug(value: unknown): string | null {
  if (typeof value !== 'string') return 'must be 3 to 48 characters from lowercase letters, digits and hyphens';
  return /^[a-z0-9-]{3,48}$/.test(value)
    ? null
    : 'must be 3 to 48 characters from lowercase letters, digits and hyphens';
}

export function validateIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'is required';
  return /^[A-Za-z0-9_-]{8,128}$/.test(value) ? null : 'must be 8 to 128 characters from letters, digits, - and _';
}

export function validateRadius(value: unknown): string | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= MAX_HOP
    ? null
    : `must be a whole number from 0 to ${MAX_HOP}`;
}

export function validateBaseRevision(value: unknown): string | null {
  if (value === null) return null;
  return Number.isInteger(value) && Number(value) > 0 ? null : 'must be a positive revision number or null';
}

export interface NotesValidation {
  notes: CandidateNote[] | null;
  message: string | null;
}

function normaliseNote(raw: unknown): CandidateNote | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const note = raw as Record<string, unknown>;
  if (typeof note.id !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(note.id)) return null;
  if (typeof note.title !== 'string') return null;
  if (typeof note.body !== 'string') return null;
  if (!Array.isArray(note.aliases) || note.aliases.some((alias) => typeof alias !== 'string')) return null;
  if (typeof note.frontmatter !== 'object' || note.frontmatter === null || Array.isArray(note.frontmatter)) return null;
  if (typeof note.private !== 'boolean') return null;
  return {
    id: note.id,
    title: note.title,
    aliases: note.aliases as string[],
    frontmatter: note.frontmatter as Record<string, unknown>,
    body: note.body,
    private: note.private,
  };
}

/** Checks the candidate list sent with a manifest preview, publish or preview link. */
export function validateCandidateNotes(value: unknown, rootNoteId: string): NotesValidation {
  if (!Array.isArray(value)) return { notes: null, message: 'must be a list of candidate notes' };
  if (value.length > MAX_CANDIDATE_NOTES) return { notes: null, message: `at most ${MAX_CANDIDATE_NOTES} notes` };

  const notes: CandidateNote[] = [];
  for (const raw of value) {
    const note = normaliseNote(raw);
    if (!note) return { notes: null, message: 'must be a list of candidate notes' };
    notes.push(note);
  }

  const ids = new Set<string>();
  for (const note of notes) {
    if (ids.has(note.id)) return { notes: null, message: 'duplicate id' };
    ids.add(note.id);
  }

  const names = new Set<string>();
  for (const note of notes) {
    for (const name of [note.title, ...note.aliases]) {
      const key = name.trim().toLowerCase();
      if (key.length === 0) continue;
      if (names.has(key)) return { notes: null, message: 'duplicate title or alias' };
      names.add(key);
    }
  }

  const root = notes.find((note) => note.id === rootNoteId);
  if (!root) return { notes: null, message: 'must include the root note' };
  if (root.private) return { notes: null, message: 'root note cannot be private' };

  return { notes, message: null };
}
