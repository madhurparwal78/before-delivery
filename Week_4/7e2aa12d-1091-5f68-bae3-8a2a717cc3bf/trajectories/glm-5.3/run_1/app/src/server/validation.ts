// The published validation messages for accounts, names and versions.

export const USERNAME_MESSAGE = 'Usernames use 3 to 24 lowercase letters, digits and hyphens and start with a letter.';
export const PASSWORD_MESSAGE = 'Passwords are 8 to 128 characters.';
export const LAYOUT_NAME_MESSAGE = 'Layout names are 1 to 80 characters.';
export const VERSION_NAME_MESSAGE = 'Version names are 1 to 60 characters.';
export const TEMPLATE_MESSAGE = 'Choose a starter template.';
export const TAKEN_MESSAGE = 'That username is taken.';
export const WRONG_CREDENTIALS_MESSAGE = 'Wrong username or password.';

const USERNAME_RE = /^[a-z][a-z0-9-]{2,23}$/;

export function usernameError(username: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) return USERNAME_MESSAGE;
  return null;
}

export function passwordError(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return PASSWORD_MESSAGE;
  return null;
}

export function layoutNameError(name: unknown): string | null {
  if (typeof name !== 'string') return LAYOUT_NAME_MESSAGE;
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) return LAYOUT_NAME_MESSAGE;
  return null;
}

export function versionNameError(name: unknown): string | null {
  if (typeof name !== 'string') return VERSION_NAME_MESSAGE;
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 60) return VERSION_NAME_MESSAGE;
  return null;
}
