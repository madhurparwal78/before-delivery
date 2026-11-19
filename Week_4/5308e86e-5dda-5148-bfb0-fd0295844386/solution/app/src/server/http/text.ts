/** Text-in-requests rules: where NUL, lone surrogates, control and direction characters are refused. */

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const SINGLE_LINE_REFUSED = /[\u0001-\u001f\u007f‪-‮⁦-⁩]/;
const MULTI_LINE_REFUSED = /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

type TextKind = "single-line" | "multi-line" | "plain";

/** True when the text holds a character its kind of field refuses. */
export function hasRefusedCharacter(text: string, kind: TextKind): boolean {
  if (text.includes("\u0000") || LONE_SURROGATE.test(text)) return true;
  if (kind === "single-line") return SINGLE_LINE_REFUSED.test(text);
  if (kind === "multi-line") return MULTI_LINE_REFUSED.test(text);
  return false;
}

/** Length in Unicode code points. */
export function codePointLength(text: string): number {
  let length = 0;
  for (const _ of text) length += 1;
  return length;
}

/** An address of at most `max` code points: one @, a local part, and a dotted domain without spaces. */
export function isEmailAddress(text: string, max: number): boolean {
  if (codePointLength(text) > max) return false;
  const at = text.indexOf("@");
  if (at < 1 || at !== text.lastIndexOf("@")) return false;
  const domain = text.slice(at + 1);
  return domain.includes(".") && !/\s/.test(text) && !domain.startsWith(".") && !domain.endsWith(".");
}
