import type { PenSummary } from '../../shared/api';
import { one, query } from '../db';
import { penSummary, PEN_SELECT, type PenRow } from './pens';

const SEARCH_LIMIT = 50;

const likePattern = (token: string): string =>
  `%${token.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

interface Conditions {
  sql: string[];
  values: unknown[];
}

const conditionsFor = (tokens: readonly string[]): Conditions => {
  const sql: string[] = [];
  const values: unknown[] = [];
  for (const token of tokens) {
    if (token.startsWith('tag:')) {
      values.push(token.slice(4));
      sql.push(`$${values.length} = any(p.tags)`);
    } else {
      values.push(likePattern(token));
      const placeholder = `$${values.length}`;
      sql.push(
        `(p.title ilike ${placeholder} escape '\\' or u.handle ilike ${placeholder} escape '\\'` +
          ` or exists (select 1 from unnest(p.tags) tag where tag ilike ${placeholder} escape '\\'))`,
      );
    }
  }
  return { sql, values };
};

/** Search runs in Postgres over public pens only. */
export const searchPens = async (
  queryText: string,
): Promise<{ query: string; total: number; pens: PenSummary[] }> => {
  const tokens = queryText.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return { query: queryText, total: 0, pens: [] };

  const { sql, values } = conditionsFor(tokens);
  const where = ["p.visibility = 'public'", ...sql].join(' and ');

  const counted = await one<{ total: number }>(
    `select count(*)::int as total from pens p join users u on u.id = p.owner_id where ${where}`,
    values,
  );
  const rows = await query<PenRow>(
    `${PEN_SELECT} where ${where} order by likes desc, p.updated_at desc, p.id asc limit ${SEARCH_LIMIT}`,
    values,
  );
  return { query: queryText, total: counted?.total ?? 0, pens: rows.map(penSummary) };
};
