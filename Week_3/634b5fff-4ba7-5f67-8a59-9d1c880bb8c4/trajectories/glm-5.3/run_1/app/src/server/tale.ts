export interface TalePassage { passageId: string; chapter: string; text: string }

/** The tale, split into lit sentences. */
export function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by a space and a capital or quote.
  const parts: string[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    buf += text[i];
    const c = text[i];
    if (c === '.' || c === '!' || c === '?') {
      const next = text[i + 1];
      if (next === ' ' || next === '"' || next === undefined) {
        // Avoid splitting on known abbreviations.
        const trimmed = buf.trim();
        if (trimmed.length > 0 && !/[Nn]ew-year/.test(buf.slice(-16))) {
          parts.push(trimmed);
          buf = '';
        }
      }
    }
  }
  if (buf.trim().length > 0) parts.push(buf.trim());
  return parts;
}
