import { ALT_MAX, env } from '../env.js';
import { validation } from '../errors.js';
import { codePoints, parseSource } from '../../shared/text.js';
import type { MemberRole, ReactionType, Visibility } from '../../shared/types.js';
import { REACTION_TYPES } from '../../shared/types.js';

export function readString(body: unknown, key: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

export function readNumber(body: unknown, key: string): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

export function readValue(body: unknown, key: string): unknown {
  if (typeof body !== 'object' || body === null) return undefined;
  return (body as Record<string, unknown>)[key];
}

export function hasKey(body: unknown, key: string): boolean {
  return typeof body === 'object' && body !== null && key in (body as Record<string, unknown>);
}

export function requireTitle(raw: string | null): string {
  const title = (raw ?? '').trim();
  if (title.length === 0 || codePoints(title) > env.limits.titleMax) throw validation('title');
  return title;
}

export function requireDescription(raw: string | null): string {
  const description = raw ?? '';
  if (codePoints(description) > env.limits.descriptionMax) throw validation('description');
  return description;
}

export function requireAlt(raw: string | null): string {
  const alt = (raw ?? '').trim();
  if (alt.length === 0 || codePoints(alt) > ALT_MAX) throw validation('alt');
  return alt;
}

export function requireSource(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!parseSource(trimmed)) throw validation('source');
  return trimmed;
}

export function requireBoardName(raw: string | null, field = 'name'): string {
  const name = (raw ?? '').trim();
  if (name.length === 0 || codePoints(name) > env.limits.boardNameMax) throw validation(field);
  return name;
}

export function requireVisibility(raw: string | null): Visibility {
  if (raw === 'public' || raw === 'secret') return raw;
  throw validation('visibility');
}

export function requireRole(raw: string | null): MemberRole {
  if (raw === 'editor' || raw === 'viewer') return raw;
  throw validation('role');
}

export function requireReaction(raw: string | null): ReactionType {
  if (raw !== null && (REACTION_TYPES as readonly string[]).includes(raw)) {
    return raw as ReactionType;
  }
  throw validation('type');
}

export function requireComment(raw: string | null): string {
  const text = (raw ?? '').trim();
  if (text.length === 0 || codePoints(text) > env.limits.commentMax) throw validation('text');
  return text;
}

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function validEmail(raw: string | null): string | null {
  if (raw === null) return null;
  const email = raw.trim();
  if (!EMAIL.test(email) || email.length > 254) return null;
  return email;
}

export function requireEmail(raw: string | null): string {
  const email = validEmail(raw);
  if (!email) throw validation('email');
  return email;
}

export function requireHandle(raw: string | null): string {
  const handle = (raw ?? '').trim();
  if (!/^[a-z0-9_]{3,20}$/.test(handle)) throw validation('handle');
  return handle;
}

export function requirePassword(raw: string | null): string {
  const password = raw ?? '';
  if (password.length < 8) throw validation('password');
  return password;
}

export function requireName(raw: string | null): string {
  const name = (raw ?? '').trim();
  if (name.length === 0 || codePoints(name) > 50) throw validation('name');
  return name;
}
