import { SEARCH_MAX } from "./config.js";
import { visiblePinSql } from "./access.js";
import { rows, pool } from "./db.js";
import { selectPins } from "./pins.js";
import { wordsOf } from "./text.js";
import type { SearchResult } from "../shared/types.js";

/**
 * Word-prefix search: a pin matches when, for every query word, its title, description or tags
 * contain a word that starts with it. `tag` and `board` narrow the results; each facet ignores its own filter.
 */
export async function search(viewerId: number, rawQuery: string, rawTag: string, rawBoard: string): Promise<SearchResult> {
  const words = wordsOf(rawQuery);
  const tag = rawTag.replace(/^#/, "").trim().toLowerCase();
  const boardId = /^[1-9][0-9]{0,15}$/.test(rawBoard) ? Number(rawBoard) : null;

  /** The match conditions with their own numbered parameters (`$1` is the viewer). */
  const scope = (withTag: boolean, withBoard: boolean): { where: string; params: unknown[] } => {
    const params: unknown[] = [];
    const next = (value: unknown): string => {
      params.push(value);
      return `$${params.length + 1}`;
    };
    const clauses = words.map((word) => `EXISTS (SELECT 1 FROM unnest(p.search_words) w WHERE starts_with(w, ${next(word)}))`);
    if (withTag && tag !== "") clauses.push(`${next(tag)} = ANY(p.tags)`);
    if (withBoard && boardId !== null) clauses.push(`p.board_id = ${next(boardId)}`);
    return { where: ["TRUE", ...clauses].join(" AND "), params };
  };

  const visible = visiblePinSql("p", "b", "$1");
  const results = scope(true, true);
  const pins =
    words.length === 0 && tag === ""
      ? []
      : await selectPins(pool, viewerId, results.where, results.params, "p.created_at DESC, p.id ASC", SEARCH_MAX);
  const forTags = scope(false, true);
  const tags = await rows<{ tag: string; count: number }>(
    pool,
    `SELECT t AS tag, count(*)::int AS count FROM pins p JOIN boards b ON b.id = p.board_id, unnest(p.tags) AS t
      WHERE ${visible} AND ${forTags.where} GROUP BY t ORDER BY count(*) DESC, t ASC`,
    [viewerId, ...forTags.params],
  );
  const forBoards = scope(true, false);
  const boards = await rows<{ id: number; name: string; count: number }>(
    pool,
    `SELECT b.id, b.name, count(*)::int AS count FROM pins p JOIN boards b ON b.id = p.board_id
      WHERE ${visible} AND ${forBoards.where} GROUP BY b.id, b.name ORDER BY count(*) DESC, lower(b.name) ASC, b.id ASC`,
    [viewerId, ...forBoards.params],
  );
  return { pins, tags, boards };
}
