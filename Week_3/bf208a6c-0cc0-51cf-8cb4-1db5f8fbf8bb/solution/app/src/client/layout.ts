import { relocate, sortPosts } from "../shared/order";
import { may } from "../shared/permissions";
import type { Board, Listing, ListingSection, Post, Role } from "../shared/types";

/** A post picked up by key or by drag, and the place it is about to take. */
export interface Hold {
  postId: string;
  title: string;
  /** The version the person picked it up at; the drop is sent with it. */
  version: number;
  mode: "keyboard" | "pointer";
  /** Where the post sat when picked up. */
  origin: { sectionId: string; position: number };
  /** The place it has now: a displayed section id and a 1-based position. */
  sectionId: string;
  position: number;
  /** A dragged frame follows the pointer by this offset. */
  offset: { x: number; y: number };
  saving: boolean;
}

/** The sections as shown: the server's arrangement with a held post lifted out and set at its new place. */
export function withHold(listing: Listing, board: Board, hold: Hold | null): ListingSection[] {
  if (!hold) return listing.sections;
  const held = listing.sections.flatMap((section) => section.posts).find((post) => post.id === hold.postId);
  if (!held) return listing.sections;
  const orders: Record<string, string[]> = {};
  for (const section of listing.sections) orders[section.id] = section.posts.map((post) => post.id);
  if (board.sort === "by_hand") {
    const arranged = relocate(orders, { postId: hold.postId, sectionId: hold.sectionId, position: hold.position });
    const byId = new Map(listing.sections.flatMap((section) => section.posts).map((post) => [post.id, post] as const));
    return listing.sections.map((section) => {
      const posts = (arranged[section.id] ?? []).flatMap((id) => byId.get(id) ?? []);
      return { ...section, posts, count: posts.length };
    });
  }
  return listing.sections.map((section) => {
    const others = section.posts.filter((post) => post.id !== hold.postId);
    const posts = section.id === hold.sectionId ? sortPosts([...others, { ...held, position: Number.MAX_SAFE_INTEGER }], board.sort) : others;
    return { ...section, posts, count: posts.length };
  });
}

interface Place {
  section: ListingSection;
  position: number;
  count: number;
}

export function placeOf(sections: ListingSection[], postId: string): Place | null {
  for (const section of sections) {
    const index = section.posts.findIndex((post) => post.id === postId);
    if (index >= 0) return { section, position: index + 1, count: section.posts.length };
  }
  return null;
}

export const canMove = (post: Post, role: Role | null, userId: string | null): boolean =>
  post.state === "published" && may("changePost", role, userId, post.author.id);

export const ROLE_NAMES: Record<Role, string> = { viewer: "Viewer", contributor: "Contributor", moderator: "Moderator", owner: "Owner" };

export const lines = {
  pickedUp: (title: string, place: Place) => `Picked up ${title}. ${place.section.title}, position ${place.position} of ${place.count}.`,
  step: (title: string, place: Place) => `${title}: ${place.section.title}, position ${place.position} of ${place.count}.`,
  dropped: (title: string, place: Place) => `Dropped ${title}: ${place.section.title}, position ${place.position} of ${place.count}.`,
  cancelled: (title: string, place: Place) => `Move cancelled. ${title} is back in ${place.section.title}, position ${place.position} of ${place.count}.`,
  lost: (name: string, title: string, place: Place) => `${name} moved ${title} first. It is now in ${place.section.title}, position ${place.position} of ${place.count}.`,
  loupeMoved: (title: string, place: Place) => `${title} moved to ${place.section.title}, position ${place.position} of ${place.count}.`,
  deleted: (title: string) => `${title} was deleted.`,
  youDeleted: (title: string) => `Deleted ${title}.`,
  added: (name: string, title: string) => `${name} added ${title}.`,
  approved: (title: string) => `Your post ${title} was approved.`,
  rejected: (title: string) => `Your post ${title} was not approved.`,
  role: (boardTitle: string, role: Role) => `Your role on ${boardTitle} is now ${ROLE_NAMES[role]}.`,
  uploading: (name: string) => `Uploading ${name}…`,
  posted: (title: string) => `Posted ${title}.`,
  held: (title: string) => `Sent ${title} for approval.`,
};
