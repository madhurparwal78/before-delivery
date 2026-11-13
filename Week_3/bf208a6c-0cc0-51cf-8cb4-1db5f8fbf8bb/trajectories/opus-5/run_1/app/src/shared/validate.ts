import { AUTH_COPY, COMMENT_COPY, LIMITS, MAKE_BOARD_COPY, POST_FORM_COPY, SETTINGS_COPY } from './copy';

export const charCount = (value: string): number => Array.from(value).length;

export const clean = (value: string): string => value.trim();

export const postTitleError = (title: string): string | null => {
  const value = clean(title);
  if (value.length === 0) return POST_FORM_COPY.titleRequired;
  if (charCount(value) > LIMITS.postTitle) return POST_FORM_COPY.titleTooLong;
  return null;
};

export const postBodyError = (body: string): string | null =>
  charCount(clean(body)) > LIMITS.postBody ? POST_FORM_COPY.bodyTooLong : null;

export const commentError = (text: string): string | null => {
  const value = clean(text);
  if (value.length === 0) return COMMENT_COPY.required;
  if (charCount(value) > LIMITS.comment) return COMMENT_COPY.tooLong;
  return null;
};

export const boardTitleError = (title: string): string | null => {
  const value = clean(title);
  if (value.length === 0) return MAKE_BOARD_COPY.titleRequired;
  if (charCount(value) > LIMITS.boardTitle) return MAKE_BOARD_COPY.titleTooLong;
  return null;
};

export const sectionsError = (sections: string[]): string | null => {
  if (sections.length < 1 || sections.length > LIMITS.sectionCount) return MAKE_BOARD_COPY.sectionCount;
  if (sections.some((title) => charCount(title) > LIMITS.sectionTitle)) return MAKE_BOARD_COPY.sectionTooLong;
  return null;
};

export const parseSections = (raw: string): string[] =>
  raw
    .split(',')
    .map((part) => clean(part))
    .filter((part) => part.length > 0);

export const displayNameError = (name: string): string | null => {
  const value = clean(name);
  if (value.length === 0 || charCount(value) > LIMITS.displayName) return AUTH_COPY.displayName;
  return null;
};

export const emailError = (email: string): string | null => {
  const value = clean(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return AUTH_COPY.emailRequired;
  return null;
};

export const accountPasswordError = (password: string): string | null => {
  const length = charCount(password);
  if (length < LIMITS.accountPasswordMin || length > LIMITS.accountPasswordMax) return AUTH_COPY.password;
  return null;
};

export const boardPasswordError = (password: string): string | null => {
  const length = charCount(password);
  if (length < LIMITS.boardPasswordMin || length > LIMITS.boardPasswordMax) return SETTINGS_COPY.boardPassword;
  return null;
};

export const normaliseEmail = (email: string): string => clean(email).toLowerCase();
