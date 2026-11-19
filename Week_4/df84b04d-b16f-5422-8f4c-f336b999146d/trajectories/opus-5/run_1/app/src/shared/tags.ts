/** Tag and mention reading, used by saves, suggestions, search and downloads. */

const TAG = /(^|\s)#([A-Za-z0-9_-]+)/g;
const MENTION = /(^|\s)@([A-Za-z0-9_-]+)/g;

function collect(text: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[2]!.toLowerCase();
    if (!found.includes(value)) found.push(value);
    pattern.lastIndex = match.index + match[0].length;
  }
  return found;
}

export function readTags(text: string): string[] {
  return collect(text, TAG);
}

export function readMentions(text: string): string[] {
  return collect(text, MENTION);
}

export interface TextRun {
  kind: 'plain' | 'tag' | 'mention' | 'date';
  value: string;
}

/** Splits stored text into plain runs and the chip runs the outline draws. */
export function splitRuns(text: string): TextRun[] {
  const pattern = /(^|\s)([#@][A-Za-z0-9_-]+)|!\((\d{4}-\d{2}-\d{2})\)/g;
  const runs: TextRun[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const chipStart = match.index + (match[1]?.length ?? 0);
    if (chipStart > cursor) runs.push({ kind: 'plain', value: text.slice(cursor, chipStart) });
    if (match[2]) {
      runs.push({ kind: match[2].startsWith('#') ? 'tag' : 'mention', value: match[2] });
    } else {
      runs.push({ kind: 'date', value: match[3]! });
    }
    cursor = match.index + match[0].length;
    pattern.lastIndex = cursor;
  }
  if (cursor < text.length) runs.push({ kind: 'plain', value: text.slice(cursor) });
  return runs;
}
