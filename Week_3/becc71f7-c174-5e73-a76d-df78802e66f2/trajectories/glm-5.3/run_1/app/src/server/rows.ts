// Database row shapes and the loaders every endpoint shares.

import type { Client, Pool } from './db.js';

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'assistant' | 'bookkeeper';
  created_at: Date;
}

export interface ConsignorRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  iban: string | null;
  status: 'active' | 'erasing' | 'erased';
  created_at: Date;
}

export interface PieceRow {
  id: string;
  tag_digits: string;
  consignor_id: string;
  category: string;
  brand: string;
  description: string;
  size: string;
  condition: string;
  asking_price_cents: number;
  intake_date: string;
  ladder_id: string;
  version: number;
  status: string;
  choice: string | null;
  archived_at: Date | null;
  collected_at: Date | null;
  import_item_no: string | null;
  created_at: Date;
}

export interface PhotoRow {
  id: string;
  piece_id: string;
  content_type: string;
  width: number;
  height: number;
  position: number;
  created_at: Date;
}

export interface HoldRow {
  id: string;
  piece_id: string;
  shopper_name: string;
  shopper_email: string;
  starts_at: Date;
  ends_at: Date;
  status: 'active' | 'released' | 'ended' | 'sold';
  token: string;
}

export interface SaleRow {
  id: string;
  piece_id: string;
  sold_at: Date;
  price_cents: number;
  consignor_share_cents: number;
  commission_cents: number;
  vat_cents: number;
  payment: 'card' | 'cash';
  sold_by: string;
  refunded_at: Date | null;
  refundable_until: Date;
}

export interface LadderRow {
  id: string;
  effective_on: string;
  first_markdown_percent: number;
  first_markdown_day: number;
  second_markdown_percent: number;
  second_markdown_day: number;
  period_end_day: number;
}

export const memberFields = 'id, name, email, role, created_at';
export const consignorFields = 'id, name, email, phone, iban, status, created_at';
export const pieceFields = `id, tag_digits, consignor_id, category, brand, description, size, condition,
  asking_price_cents, intake_date, ladder_id, version, status, choice, archived_at, collected_at, import_item_no, created_at`;
export const photoFields = 'id, piece_id, content_type, width, height, position, created_at';

export async function findMemberById(pool: Pool | Client, id: string): Promise<MemberRow | null> {
  const { rows } = await pool.query<MemberRow>(
    `SELECT ${memberFields} FROM members WHERE id = $1 AND removed_at IS NULL`, [id]
  );
  return rows[0] ?? null;
}

export async function findConsignorById(pool: Pool | Client, id: string): Promise<ConsignorRow | null> {
  const { rows } = await pool.query<ConsignorRow>(
    `SELECT ${consignorFields} FROM consignors WHERE id = $1`, [id]
  );
  return rows[0] ?? null;
}

export async function findPieceById(pool: Pool | Client, id: string): Promise<PieceRow | null> {
  const { rows } = await pool.query<PieceRow>(
    `SELECT ${pieceFields} FROM pieces WHERE id = $1`, [id]
  );
  return rows[0] ?? null;
}

export async function findLadderById(pool: Pool | Client, id: string): Promise<LadderRow | null> {
  const { rows } = await pool.query<LadderRow>('SELECT * FROM ladders WHERE id = $1', [id]);
  return rows[0] ?? null;
}

/** The ladder in force on a Brussels date: the latest effective on or before it. */
export async function ladderInForceOn(pool: Pool | Client, date: string): Promise<LadderRow | null> {
  const { rows } = await pool.query<LadderRow>(
    'SELECT * FROM ladders WHERE effective_on <= $1 ORDER BY effective_on DESC LIMIT 1', [date]
  );
  return rows[0] ?? null;
}

/** The price history of a piece, in order from earliest. */
export async function priceHistory(pool: Pool | Client, pieceId: string): Promise<{ askingPriceCents: number; effectiveFrom: Date }[]> {
  const { rows } = await pool.query<{ asking_price_cents: number; effective_from: Date }>(
    'SELECT asking_price_cents, effective_from FROM price_history WHERE piece_id = $1 ORDER BY effective_from ASC',
    [pieceId]
  );
  return rows.map((r) => ({ askingPriceCents: r.asking_price_cents, effectiveFrom: new Date(r.effective_from) }));
}

export async function photosOf(pool: Pool | Client, pieceId: string): Promise<PhotoRow[]> {
  const { rows } = await pool.query<PhotoRow>(
    `SELECT ${photoFields} FROM photos WHERE piece_id = $1 ORDER BY position ASC, created_at ASC`, [pieceId]
  );
  return rows;
}

export async function activeHoldOf(pool: Pool | Client, pieceId: string): Promise<HoldRow | null> {
  const { rows } = await pool.query<HoldRow>(
    "SELECT * FROM holds WHERE piece_id = $1 AND status = 'active' LIMIT 1", [pieceId]
  );
  return rows[0] ?? null;
}

export async function liveSaleOf(pool: Pool | Client, pieceId: string): Promise<SaleRow | null> {
  const { rows } = await pool.query<SaleRow>(
    'SELECT * FROM sales WHERE piece_id = $1 AND refunded_at IS NULL LIMIT 1', [pieceId]
  );
  return rows[0] ?? null;
}
