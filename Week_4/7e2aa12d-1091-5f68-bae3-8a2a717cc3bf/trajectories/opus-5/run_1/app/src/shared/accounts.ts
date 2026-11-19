import {
  LAYOUT_NAME_MESSAGE,
  PASSWORD_MESSAGE,
  USERNAME_MESSAGE,
  VERSION_NAME_MESSAGE,
} from './messages.js';

const USERNAME = /^[a-z][a-z0-9-]{2,23}$/;

export function checkUsername(username: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME.test(username)) return USERNAME_MESSAGE;
  return null;
}

export function checkPassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return PASSWORD_MESSAGE;
  }
  return null;
}

export function checkLayoutName(name: unknown): string | null {
  if (typeof name !== 'string') return LAYOUT_NAME_MESSAGE;
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) return LAYOUT_NAME_MESSAGE;
  return null;
}

export function checkVersionName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length < 1 || name.length > 60) return VERSION_NAME_MESSAGE;
  return null;
}
