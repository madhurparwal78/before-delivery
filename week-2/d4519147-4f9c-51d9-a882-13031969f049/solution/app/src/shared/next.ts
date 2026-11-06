/** A valid `next` starts with exactly one `/` not followed by `/` or `\`, and holds no backslash or control character. */
function isValidNext(next: string): boolean {
  if (!next.startsWith("/") || next[1] === "/" || next[1] === "\\") return false;
  return !/[\\\u0000-\u001f\u007f-\u009f]/.test(next);
}

export function landingFor(next: string | null): string {
  return next !== null && isValidNext(next) ? next : "/";
}

/** Every character other than letters, digits and -_.!~*'() percent-encoded in uppercase hex. */
export function encodeNext(path: string): string {
  return Array.from(new TextEncoder().encode(path))
    .map((byte) => {
      const ch = String.fromCharCode(byte);
      return byte < 128 && /[A-Za-z0-9\-_.!~*'()]/.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
}
