// Mentions (brief: Comments): `@` then the longest run of letters, digits and . _ % + - @,
// with a trailing `.` dropped; it mentions a member only when it equals their email (any case).

const MENTION = /@([A-Za-z0-9._%+\-@]+)/g;

export function mentionedEmails(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION)) {
    const token = (match[1] ?? "").replace(/\.$/, "").toLowerCase();
    if (token) found.add(token);
  }
  return [...found];
}
