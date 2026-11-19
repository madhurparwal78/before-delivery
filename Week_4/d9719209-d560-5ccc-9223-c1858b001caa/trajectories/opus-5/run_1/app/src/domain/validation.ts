import { copy } from '../shared/copy.js';
import { errors } from '../core/errors.js';

const RESERVED_COMMUNITY_NAMES = [
  'admin',
  'api',
  'mod',
  'mods',
  'moothall',
  'all',
  'popular',
  'home',
  'settings',
  'about',
  'u',
  'c',
  'new',
  'help',
  'login',
  'signup',
  'media',
];

export function normaliseEmail(email: string): string {
  return email.trim();
}

export function validEmail(email: string): boolean {
  const trimmed = email.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) return false;
  const domain = trimmed.slice(at + 1);
  if (domain.length === 0 || !domain.includes('.')) return false;
  if (/\s/.test(trimmed)) return false;
  const dot = domain.indexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

export function validUsername(username: string): boolean {
  return /^[A-Za-z0-9_-]{3,20}$/.test(username);
}

export function validPassword(password: string): boolean {
  return password.length >= 10 && password.length <= 128;
}

export function validCommunityName(name: string): boolean {
  return /^[A-Za-z0-9_]{3,21}$/.test(name);
}

export function reservedCommunityName(name: string): boolean {
  return RESERVED_COMMUNITY_NAMES.includes(name.toLowerCase());
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function parseSort<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  if (value === null || value === '') return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw errors.validation(copy.validation.sort, { sort: copy.validation.sort });
}

export function titleFieldError(title: string): string | null {
  const trimmed = title.trim();
  return trimmed.length >= 1 && trimmed.length <= 300 ? null : copy.post.titleInvalid;
}

export function postBodyFieldError(body: string): string | null {
  return body.length <= 40000 ? null : copy.post.bodyInvalid;
}

export function commentBodyFieldError(body: string): string | null {
  const trimmed = body.trim();
  return trimmed.length >= 1 && trimmed.length <= 10000 ? null : copy.comment.bodyInvalid;
}
