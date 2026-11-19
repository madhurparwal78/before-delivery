import { rows, type Db } from '../db.js';
import { validation } from '../errors.js';
import { memberVisibleTo } from './visibility.js';

export interface ResolvedMention {
  handle: string;
  member_id: string;
}

export interface MentionObject extends ResolvedMention {
  name: string;
}

interface ParsedText {
  mentions: ResolvedMention[];
  /** Hashtags as typed, without the `#`, in order of appearance, one per tag ignoring case. */
  hashtags: string[];
}

const MENTION = /(^|\s)@([a-z0-9-]{3,30})(?![a-z0-9-])/g;
const HASHTAG = /(^|\s)#([A-Za-z0-9_]{1,50})(?![A-Za-z0-9_])/g;

/** Text is counted in Unicode code points. */
export const codePointLength = (text: string): number => [...text].length;

/** `1 other` or `<n> others`: the tail of every "<name> and ..." summary line. */
export const others = (count: number): string => (count === 1 ? '1 other' : `${count} others`);

/** Escapes a word for use inside a regular expression pattern. */
export const escapeRegex = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the text's length in code points lies outside `min` to `max`. */
export const lengthOutside = (text: string, min: number, max: number): boolean => {
  const length = codePointLength(text);
  return length < min || length > max;
};

/** Returns the text unchanged, or throws the published field message: blank, or over `max` code points. */
export function checkedText(value: unknown, max: number, tooLong: string): string {
  const text = typeof value === 'string' ? value : '';
  if (text.trim() === '') throw validation({ text: 'Write something first.' });
  if (codePointLength(text) > max) throw validation({ text: tooLong });
  return text;
}

export function hashtagsIn(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const match of text.matchAll(HASHTAG)) {
    const tag = match[2] as string;
    if (!seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  }
  return tags;
}

/**
 * Finds the mentions and hashtags in post or comment text. A mention resolves only when its handle belongs to a
 * 1st-degree connection of the author at this moment; anything else stays plain text.
 */
export async function parseText(db: Db, authorId: string, text: string): Promise<ParsedText> {
  const handles = [...new Set([...text.matchAll(MENTION)].map((match) => match[2] as string))];
  const connected =
    handles.length === 0
      ? []
      : await rows<{ handle: string; id: string }>(
          db,
          `SELECT m.handle, m.id FROM members m
            WHERE m.handle = ANY($2) AND m.confirmed
              AND EXISTS (SELECT 1 FROM connections c WHERE c.member_lo = LEAST($1::text, m.id) AND c.member_hi = GREATEST($1::text, m.id))`,
          [authorId, handles],
        );
  const byHandle = new Map(connected.map((member) => [member.handle, member.id]));
  const mentions = handles.flatMap((handle) => {
    const memberId = byHandle.get(handle);
    return memberId ? [{ handle, member_id: memberId }] : [];
  });
  return { mentions, hashtags: hashtagsIn(text) };
}

/** Replaces the hashtag index of a post with the lowercase form of its tags. */
export async function saveHashtags(db: Db, postId: string, hashtags: string[]): Promise<void> {
  await db.query('DELETE FROM post_hashtags WHERE post_id = $1', [postId]);
  const tags = [...new Set(hashtags.map((tag) => tag.toLowerCase()))];
  if (tags.length > 0) {
    await db.query('INSERT INTO post_hashtags (post_id, tag) SELECT $1, unnest($2::text[])', [postId, tags]);
  }
}

/** Stored mentions with the member's current name; members the viewer may not see stay plain text. */
export async function mentionObjects(db: Db, viewerId: string, stored: ResolvedMention[][]): Promise<MentionObject[][]> {
  const ids = [...new Set(stored.flatMap((mentions) => mentions.map((mention) => mention.member_id)))];
  if (ids.length === 0) return stored.map(() => []);
  const visible = await rows<{ id: string; name: string }>(
    db,
    `SELECT m.id, m.name FROM members m WHERE m.id = ANY($2) AND ${memberVisibleTo('$1', 'm')}`,
    [viewerId, ids],
  );
  const names = new Map(visible.map((member) => [member.id, member.name]));
  return stored.map((mentions) =>
    mentions.flatMap((mention) => {
      const name = names.get(mention.member_id);
      return name === undefined ? [] : [{ ...mention, name }];
    }),
  );
}
