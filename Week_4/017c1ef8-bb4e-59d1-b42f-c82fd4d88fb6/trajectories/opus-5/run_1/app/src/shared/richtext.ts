/**
 * The one rendering allowlist for post, comment and message text: plain text,
 * line breaks, mention links, hashtag links and web links. Nothing else.
 */
export type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; handle: string; raw: string }
  | { kind: 'hashtag'; tag: string; raw: string }
  | { kind: 'link'; href: string; raw: string };

const MENTION = /^@([a-z0-9-]{3,30})/;
const HASHTAG = /^#([A-Za-z0-9_]{1,50})/;
const WEB_LINK = /^(https?:\/\/\S+|mailto:[^\s]+)/;

function atBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  return /\s/.test(text[index - 1]);
}

export function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let plain = '';
  let i = 0;
  const pushPlain = (): void => {
    if (plain !== '') {
      segments.push({ kind: 'text', value: plain });
      plain = '';
    }
  };
  while (i < text.length) {
    const rest = text.slice(i);
    if (atBoundary(text, i)) {
      const link = WEB_LINK.exec(rest);
      if (link) {
        pushPlain();
        segments.push({ kind: 'link', href: link[0], raw: link[0] });
        i += link[0].length;
        continue;
      }
      if (text[i] === '@') {
        const mention = MENTION.exec(rest);
        const next = rest[mention ? mention[0].length : 0];
        if (mention && (next === undefined || !/[a-z0-9-]/i.test(next))) {
          pushPlain();
          segments.push({ kind: 'mention', handle: mention[1], raw: mention[0] });
          i += mention[0].length;
          continue;
        }
      }
      if (text[i] === '#') {
        const hashtag = HASHTAG.exec(rest);
        if (hashtag) {
          pushPlain();
          segments.push({ kind: 'hashtag', tag: hashtag[1], raw: hashtag[0] });
          i += hashtag[0].length;
          continue;
        }
      }
    }
    plain += text[i];
    i += 1;
  }
  pushPlain();
  return segments;
}

export function mentionHandles(text: string): string[] {
  const handles: string[] = [];
  for (const segment of parseSegments(text)) {
    if (segment.kind === 'mention' && !handles.includes(segment.handle)) {
      handles.push(segment.handle);
    }
  }
  return handles;
}

export function hashtagsOf(text: string): string[] {
  const tags: string[] = [];
  for (const segment of parseSegments(text)) {
    if (segment.kind === 'hashtag' && !tags.some((tag) => tag.toLowerCase() === segment.tag.toLowerCase())) {
      tags.push(segment.tag);
    }
  }
  return tags;
}
