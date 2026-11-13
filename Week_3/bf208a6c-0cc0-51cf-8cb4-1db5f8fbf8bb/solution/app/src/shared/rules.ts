import type { FieldErrors, Sort } from "./types";

export const LIMITS = {
  title: 80,
  body: 2000,
  comment: 500,
  displayName: 40,
  boardTitle: 80,
  sectionTitle: 40,
  sectionsMax: 12,
  accountPassword: { min: 8, max: 72 },
  boardPassword: { min: 8, max: 64 },
} as const;

export const SORT_LABELS: Record<Sort, string> = {
  by_hand: "By hand",
  newest: "Newest first",
  oldest: "Oldest first",
  most_liked: "Most liked",
};

export const MESSAGES = {
  titleBlank: "Give your post a title.",
  titleLong: "Titles can be at most 80 characters.",
  bodyLong: "Text can be at most 2,000 characters.",
  commentBlank: "Write a comment first.",
  commentLong: "Comments can be at most 500 characters.",
  boardTitleBlank: "Give your board a title.",
  boardTitleLong: "Board titles can be at most 80 characters.",
  sectionCount: "Add between 1 and 12 sections.",
  sectionLong: "Section titles can be at most 40 characters.",
  displayName: "Display names are 1 to 40 characters.",
  email: "Enter an email address.",
  accountPassword: "Passwords are 8 to 72 characters.",
  boardPassword: "Passwords are 8 to 64 characters.",
  movingOffByAuthor: "Moving is off while posts are grouped by author.",
  ownerRole: "The owner's role can't change.",
  staleEdit: "Someone changed this post first. Your edit was not saved.",
  emailTaken: "That email already has an account.",
  codeWrong: "That code is wrong or has expired.",
  uploadsDown: "Uploads are unavailable right now. Your post was not saved.",
  version: "Version is required.",
} as const;

export const orderLockedMessage = (sort: Sort): string => `Order is set by ${SORT_LABELS[sort]}. Choose By hand to reorder.`;
export const positionRangeMessage = (max: number): string => `Position must be between 1 and ${max}.`;
export const emailOnBoardMessage = (email: string): string => `${email} is already on this board.`;
export const fileTooLargeMessage = (name: string, limit: number): string => `${name} is over the ${limit.toLocaleString("en-US")} byte limit.`;
export const fileTypeMessage = (name: string): string => `${name} isn't a PNG, JPEG, GIF, WebP, PDF or plain-text file.`;

export const isImageType = (contentType: string): boolean => contentType.startsWith("image/");

/** Lengths count Unicode code points. */
export const length = (value: string): number => Array.from(value).length;

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
export const looksLikeEmail = (value: string): boolean => EMAIL.test(value) && value.length <= 254;

export function postFieldErrors(title: string, body: string): FieldErrors {
  const errors: FieldErrors = {};
  const titleLength = length(title.trim());
  if (titleLength === 0) errors["title"] = MESSAGES.titleBlank;
  else if (titleLength > LIMITS.title) errors["title"] = MESSAGES.titleLong;
  if (length(body.trim()) > LIMITS.body) errors["body"] = MESSAGES.bodyLong;
  return errors;
}

export function commentErrors(text: string): FieldErrors {
  const used = length(text.trim());
  if (used === 0) return { text: MESSAGES.commentBlank };
  if (used > LIMITS.comment) return { text: MESSAGES.commentLong };
  return {};
}

export function boardTitleError(title: string): string | null {
  const used = length(title.trim());
  if (used === 0) return MESSAGES.boardTitleBlank;
  return used > LIMITS.boardTitle ? MESSAGES.boardTitleLong : null;
}

export function boardFieldErrors(title: string, sections: string[]): FieldErrors {
  const errors: FieldErrors = {};
  const titleError = boardTitleError(title);
  if (titleError) errors["title"] = titleError;
  const lengths = sections.map((section) => length(section.trim()));
  if (lengths.length < 1 || lengths.length > LIMITS.sectionsMax || lengths.includes(0)) errors["sections"] = MESSAGES.sectionCount;
  else if (lengths.some((used) => used > LIMITS.sectionTitle)) errors["sections"] = MESSAGES.sectionLong;
  return errors;
}

export function signupErrors(displayName: string, email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  const used = length(displayName.trim());
  if (used < 1 || used > LIMITS.displayName) errors["display_name"] = MESSAGES.displayName;
  if (!looksLikeEmail(email.trim())) errors["email"] = MESSAGES.email;
  if (length(password) < LIMITS.accountPassword.min || length(password) > LIMITS.accountPassword.max) errors["password"] = MESSAGES.accountPassword;
  return errors;
}

export function boardPasswordError(password: string): string | null {
  const used = length(password);
  return used < LIMITS.boardPassword.min || used > LIMITS.boardPassword.max ? MESSAGES.boardPassword : null;
}
