import type { Post, Sort } from "./types";

interface Placement {
  postId: string;
  sectionId: string;
  position: number;
}

/**
 * Hand order. Takes the post out of whichever section holds it and inserts it at the 1-based position of the
 * target section; both sections end up with consecutive positions.
 */
export function relocate(orders: Record<string, string[]>, placement: Placement): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [sectionId, ids] of Object.entries(orders)) result[sectionId] = ids.filter((id) => id !== placement.postId);
  const target = result[placement.sectionId] ?? [];
  target.splice(placement.position - 1, 0, placement.postId);
  result[placement.sectionId] = target;
  return result;
}

/** The highest position a post may take in a section: one past the others already there. */
export const maxPosition = (othersInTarget: number): number => othersInTarget + 1;

type Sortable = Pick<Post, "id" | "likes" | "created_at" | "position">;

/** Displayed order of the posts of one section (or author group) under a sort. */
export function sortPosts<T extends Sortable>(posts: T[], sort: Sort): T[] {
  const byAge = (a: T, b: T): number => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1);
  const compare: Record<Sort, (a: T, b: T) => number> = {
    by_hand: (a, b) => (a.position ?? 0) - (b.position ?? 0),
    newest: (a, b) => byAge(b, a),
    oldest: byAge,
    most_liked: (a, b) => b.likes - a.likes || byAge(a, b),
  };
  return [...posts].sort(compare[sort]);
}
