import type { ErrorCode } from "../../shared/errors";

const REVIEW_PATH = /\/companies\/[\w-]+\/reviews\/[\w-]+/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /\+?\d(?:[ .-]?\d){6,}/;

type ContactFinding = { code: Extract<ErrorCode, "contains_email" | "contains_phone">; field: string };

/** Fields are checked in the order given: every field for an email address first, then every field for a phone number. */
export function findContactDetail(fields: readonly (readonly [string, string])[]): ContactFinding | undefined {
  const visible = fields.map(([name, value]) => [name, value.replace(REVIEW_PATH, " ")] as const);
  const emailField = visible.find(([, value]) => EMAIL.test(value));
  if (emailField) return { code: "contains_email", field: emailField[0] };
  const phoneField = visible.find(([, value]) => PHONE.test(value));
  if (phoneField) return { code: "contains_phone", field: phoneField[0] };
  return undefined;
}

export function reviewPathIn(body: string): { slug: string; id: string } | undefined {
  const match = /\/companies\/([\w-]+)\/reviews\/([\w-]+)/.exec(body);
  return match && match[1] && match[2] ? { slug: match[1], id: match[2] } : undefined;
}
