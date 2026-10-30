// Global search (brief: Business rules › Search): literal case-insensitive match and the snippet window.
import { splitsSurrogatePair } from "../../shared/noteText.js";
import type { Queryable } from "../db.js";

export const SEARCH_GROUP_CAP = 10;
const SNIPPET_LEAD = 40;
const SNIPPET_LENGTH = 120;

/** SQL predicate: `column` contains parameter $n literally, ignoring case (no LIKE wildcards involved). */
export const containsLiterally = (column: string, param: number): string => `strpos(lower(${column}), lower($${param})) > 0`;

/** The note snippet: 40 characters before the first match in the text (0 when the match is only in the title), 120 long. */
export function snippet(text: string, query: string): string {
  const match = text.toLowerCase().indexOf(query.toLowerCase());
  let start = match < 0 ? 0 : Math.max(0, match - SNIPPET_LEAD);
  if (splitsSurrogatePair(text, start)) start -= 1;
  let end = Math.min(text.length, start + SNIPPET_LENGTH);
  if (splitsSurrogatePair(text, end)) end += 1;
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** Ids of the workspace's features whose name (and, for global search, public description) contains the query. */
export async function featuresMatching(q: Queryable, workspaceId: string, query: string, withDescription: boolean): Promise<Set<string>> {
  const rows = await q.query<{ id: string }>(
    `SELECT id FROM features WHERE workspace_id = $1 AND (${containsLiterally("name", 2)}${withDescription ? ` OR ${containsLiterally("public_description", 2)}` : ""})`,
    [workspaceId, query],
  );
  return new Set(rows.map((r) => r.id));
}
