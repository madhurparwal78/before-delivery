import type { FeedEntry } from '../../types';

/** The loaded feed, kept while another page is open so Back finds the same entries, place and focus. */
interface FeedSnapshot {
  entries: FeedEntry[];
  nextCursor: string | null;
  topCursor: string;
  scrollY: number;
  /** The entry that held focus, or whose time link was followed, when the feed was left. */
  focusEntryId: string | null;
}

let snapshot: FeedSnapshot | null = null;

export const saveFeed = (next: FeedSnapshot): void => {
  snapshot = next;
};

export const savedFeed = (): FeedSnapshot | null => snapshot;

/** Posts this page deleted itself: their removal is announced as `Post deleted.`, not `Post removed.` */
const deletedHere = new Set<string>();

export const markDeletedHere = (postId: string): void => {
  deletedHere.add(postId);
};

export const wasDeletedHere = (postId: string): boolean => deletedHere.has(postId);
