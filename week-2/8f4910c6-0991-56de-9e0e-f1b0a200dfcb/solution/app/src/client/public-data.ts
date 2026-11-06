// Shapes of the public API (cards, profiles, boards) and the board address names.

import type { OfficeId } from "../shared/zones.js";

export type BoardId = "women" | "men" | "creators" | "new_faces";

export interface BoardInfo {
  board: BoardId;
  slug: string;
  title: string;
}

export const BOARDS: BoardInfo[] = [
  { board: "women", slug: "women", title: "Women" },
  { board: "men", slug: "men", title: "Men" },
  { board: "creators", slug: "creators", title: "Creators" },
  { board: "new_faces", slug: "new-faces", title: "New Faces" },
];

export function boardBySlug(slug: string): BoardInfo | undefined {
  return BOARDS.find((info) => info.slug === slug);
}

export function boardById(board: string): BoardInfo | undefined {
  return BOARDS.find((info) => info.board === board);
}

export const CITY: Record<OfficeId, string> = { toronto: "Toronto", vancouver: "Vancouver" };

export interface Card {
  slug: string;
  displayName: string;
  office: OfficeId;
  board: BoardId;
  measurements: { heightCm: number | null; chestCm: number | null; waistCm: number | null; hipsCm: number | null };
  reach: { instagram: number | null; tiktok: number | null; youtube: number | null; total: number | null };
  coverPhotoUrl: string | null;
}

export interface PortfolioPhoto {
  photoId: string;
  url: string;
  width: number;
  height: number;
}

export interface Profile extends Card {
  portfolio: PortfolioPhoto[];
}

export interface Listing {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  talent: Card[];
}

export const DEFAULT_QUERY = { office: "all", q: "", sort: "name", unit: "cm", page: "1" };

/** The board listing address with all five choices present. */
export function boardHref(slug: string, choices: Partial<typeof DEFAULT_QUERY> = {}): string {
  const merged = { ...DEFAULT_QUERY, ...choices };
  return `/boards/${slug}?${new URLSearchParams([["office", merged.office], ["q", merged.q], ["sort", merged.sort],
    ["unit", merged.unit], ["page", merged.page]]).toString()}`;
}
