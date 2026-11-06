import { query } from '../db.js';
import { newId } from '../ids.js';
import type { Board, Media, RateCard, RateCardBoardRates } from '../../shared/types.js';

type RateCardRow = {
  id: string;
  name: string;
  effective_from: string;
  data: { boards: Record<Board, RateCardBoardRates>; usageBaseCents: Record<Media, number> };
};

function view(row: RateCardRow): RateCard {
  return {
    id: row.id,
    name: row.name,
    effectiveFrom: row.effective_from,
    boards: row.data.boards,
    usageBaseCents: row.data.usageBaseCents,
  };
}

export async function listRateCards(): Promise<RateCard[]> {
  const rows = await query<RateCardRow>('SELECT * FROM rate_cards ORDER BY effective_from');
  return rows.map((row) => view(row));
}

export async function insertRateCard(input: {
  name: string;
  effectiveFrom: string;
  boards: Record<Board, RateCardBoardRates>;
  usageBaseCents: Record<Media, number>;
}): Promise<RateCard> {
  const rows = await query<RateCardRow>(
    'INSERT INTO rate_cards (id, name, effective_from, data) VALUES ($1, $2, $3, $4) RETURNING *',
    [
      newId('rc'),
      input.name,
      input.effectiveFrom,
      { boards: input.boards, usageBaseCents: input.usageBaseCents },
    ],
  );
  return view(rows[0]);
}
