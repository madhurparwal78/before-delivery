/**
 * The mention token rule, in one place. An @ not preceded by a letter or digit,
 * followed by the longest run of letters, digits, dots, dashes and underscores;
 * trailing dots and dashes dropped; matched against handles ignoring case.
 */
export function extractMentionTokens(text: string): string[] {
  const tokens: string[] = [];
  const re = /(^|[^a-zA-Z0-9])@([a-zA-Z0-9._-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    let run = match[2];
    run = run.replace(/[.-]+$/, '');
    if (run.length > 0) tokens.push(run);
  }
  return tokens;
}

/** Distinct handles (lowercased) named by the text. */
export function mentionedHandles(text: string): string[] {
  const seen = new Set<string>();
  for (const token of extractMentionTokens(text)) {
    const handle = token.toLowerCase();
    if (!seen.has(handle)) seen.add(handle);
  }
  return [...seen];
}
