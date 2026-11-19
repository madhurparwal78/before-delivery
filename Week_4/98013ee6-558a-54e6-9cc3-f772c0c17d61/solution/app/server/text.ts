import { codePoints } from "../shared/text.js";
import { ALT_MAX, SOURCE_MAX, config } from "./config.js";
import { validation } from "./errors.js";

const TAG_PATTERN = /(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]+)/gu;
const TAG_RUN_MAX = 30;
const WORD_PATTERN = /[\p{L}\p{N}]+/gu;

/** Tags from the title, then the description: lowercase, unique, in order of first appearance. */
export function extractTags(title: string, description: string): string[] {
  const tags: string[] = [];
  for (const text of [title, description]) {
    for (const match of text.matchAll(TAG_PATTERN)) {
      const tag = match[1].toLowerCase();
      if ([...tag].length <= TAG_RUN_MAX && !tags.includes(tag)) tags.push(tag);
    }
  }
  return tags;
}

export function wordsOf(text: string): string[] {
  return [...new Set(text.toLowerCase().match(WORD_PATTERN) ?? [])];
}

export const searchWordsOf = (title: string, description: string, tags: string[]): string[] =>
  wordsOf(`${title} ${description} ${tags.join(" ")}`);

/** The source link as shown: lowercased host, no leading www., no default port. Null when it is not an absolute http(s) URL. */
export function sourceHost(source: string): string | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.host.replace(/^www\./, "");
}

export interface PinText {
  title: string;
  description: string;
  alt: string;
  source: string | null;
}

function checked(value: unknown, field: string): string {
  if (typeof value !== "string") throw validation(field);
  return value.trim();
}

/** Validates in the published field order: title, description, alt, source. */
export function validatePinText(raw: { title: unknown; description: unknown; alt: unknown; source: unknown }): PinText {
  const title = checked(raw.title, "title");
  if (title === "" || codePoints(title) > config.limits.title_max) throw validation("title");
  const description = raw.description === undefined || raw.description === null ? "" : checked(raw.description, "description");
  if (codePoints(description) > config.limits.description_max) throw validation("description");
  const alt = checked(raw.alt, "alt");
  if (alt === "" || codePoints(alt) > ALT_MAX) throw validation("alt");
  let source: string | null = null;
  if (raw.source !== undefined && raw.source !== null) {
    const text = checked(raw.source, "source");
    if (text !== "") {
      if (text.length > SOURCE_MAX || sourceHost(text) === null) throw validation("source");
      source = text;
    }
  }
  return { title, description, alt, source };
}

export function validateName(value: unknown): string {
  const name = checked(value, "name");
  if (name === "" || codePoints(name) > config.limits.board_name_max) throw validation("name");
  return name;
}

export function validateComment(value: unknown): string {
  const text = checked(value, "text");
  if (text === "" || codePoints(text) > config.limits.comment_max) throw validation("text");
  return text;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (value: string): boolean => EMAIL.test(value) && value.length <= 254;
export const normalizeEmail = (value: string): string => value.trim().toLowerCase();
