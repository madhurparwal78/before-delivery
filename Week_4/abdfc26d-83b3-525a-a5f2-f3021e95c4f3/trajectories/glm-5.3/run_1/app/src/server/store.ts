import { holdExpired, orderMoveLegal, secondsLeft, saleShares, type SplitParty } from '../domain.js';
import type { Asset, Order, Piece, RemixLink, Render, Timeline, Uniform } from '../types.js';
import { one, query, transaction, type SqlValue, type Tx } from './db.js';

export interface PieceRow {
  slug: string;
  title: string;
  state: 'draft' | 'published' | 'withdrawn';
  version: number;
  engine: 'GLSL';
  creator_id: string;
  creator_name: string;
  fragment_source: string;
  uniforms: Uniform[];
  timeline: Timeline;
  remix_of_slug: string | null;
  remix_of_title: string | null;
  remix_of_creator: string | null;
  edition_count: number | null;
  price_cents: number | null;
  export_render_id: string | null;
  published_at: Date | null;
}

const PIECE_SELECT = `
  SELECT p.slug, p.title, p.state, p.version, p.engine, p.creator_id, p.fragment_source,
         p.uniforms::text AS uniforms_json, p.timeline::text AS timeline_json,
         p.remix_of_slug, rp.title AS remix_of_title, rc.display_name AS remix_of_creator,
         p.edition_count, p.price_cents, p.export_render_id, p.published_at,
         u.display_name AS creator_name
  FROM pieces p
  JOIN users u ON u.id = p.creator_id
  LEFT JOIN pieces rp ON rp.slug = p.remix_of_slug
  LEFT JOIN users rc ON rc.id = rp.creator_id`;

function pieceFromRow(row: Record<string, unknown>): PieceRow {
  return {
    slug: row.slug as string,
    title: row.title as string,
    state: row.state as PieceRow['state'],
    version: row.version as number,
    engine: 'GLSL',
    creator_id: row.creator_id as string,
    creator_name: row.creator_name as string,
    fragment_source: row.fragment_source as string,
    uniforms: JSON.parse(row.uniforms_json as string) as Uniform[],
    timeline: JSON.parse(row.timeline_json as string) as Timeline,
    remix_of_slug: (row.remix_of_slug as string | null) ?? null,
    remix_of_title: (row.remix_of_title as string | null) ?? null,
    remix_of_creator: (row.remix_of_creator as string | null) ?? null,
    edition_count: (row.edition_count as number | null) ?? null,
    price_cents: (row.price_cents as number | null) ?? null,
    export_render_id: (row.export_render_id as string | null) ?? null,
    published_at: (row.published_at as Date | null) ?? null
  };
}

export async function getPiece(slug: string): Promise<PieceRow | null> {
  const row = await one(`${PIECE_SELECT} WHERE p.slug = $1`, [slug]);
  return row ? pieceFromRow(row) : null;
}

export async function getPieceTx(tx: Tx, slug: string): Promise<PieceRow | null> {
  const row = await tx.one(`${PIECE_SELECT} WHERE p.slug = $1`, [slug]);
  return row ? pieceFromRow(row) : null;
}

export function pieceBody(piece: PieceRow, opts: { owner: boolean; editionsLeft: number | null }): Piece {
  const remixOf: RemixLink | null = piece.remix_of_slug && piece.remix_of_title && piece.remix_of_creator
    ? { slug: piece.remix_of_slug, title: piece.remix_of_title, creator_display_name: piece.remix_of_creator }
    : null;
  const body: Piece = {
    slug: piece.slug,
    title: piece.title,
    state: piece.state,
    version: piece.version,
    engine: 'GLSL',
    creator: { id: piece.creator_id, display_name: piece.creator_name },
    fragment_source: piece.fragment_source,
    uniforms: piece.uniforms,
    timeline: piece.timeline,
    assets: [],
    remix_of: remixOf,
    edition_count: piece.edition_count,
    price_cents: piece.price_cents,
    editions_left: opts.editionsLeft,
    export_render_id: piece.export_render_id
  };
  return body;
}

export async function pieceAssets(slug: string): Promise<Asset[]> {
  const rows = await query<Asset>(`SELECT id, kind, filename, bytes FROM assets WHERE piece_slug = $1 ORDER BY created_at`, [slug]);
  return rows;
}

// ------------------------------------------------------------------- editions

export interface EditionRow {
  number: number;
  status: 'available' | 'held' | 'collected';
  held_by_you: boolean;
}

export async function editionStatuses(slug: string, viewerId: string | null): Promise<{ edition_count: number; editions: EditionRow[] }> {
  const piece = await getPiece(slug);
  if (!piece || piece.edition_count === null) return { edition_count: 0, editions: [] };
  const rows = await query<{ edition: number; state: string; collector_id: string }>(
    `SELECT edition, state, collector_id FROM orders WHERE piece_slug = $1 AND edition BETWEEN 1 AND $2`,
    [slug, piece.edition_count]
  );
  const map = new Map<number, { status: EditionRow['status']; holder: string }>();
  for (const row of rows) {
    if (row.state === 'held' || row.state === 'paying') map.set(row.edition, { status: 'held', holder: row.collector_id });
    else if (['paid', 'invoiced', 'receipted'].includes(row.state)) map.set(row.edition, { status: 'collected', holder: row.collector_id });
    else if (row.state === 'refunded') map.delete(row.edition);
  }
  const editions: EditionRow[] = [];
  for (let n = 1; n <= piece.edition_count; n++) {
    const entry = map.get(n);
    editions.push({
      number: n,
      status: entry?.status ?? 'available',
      held_by_you: entry?.status === 'held' && entry.holder === viewerId
    });
  }
  return { edition_count: piece.edition_count, editions };
}

export async function editionsLeft(slug: string): Promise<number | null> {
  const piece = await getPiece(slug);
  if (!piece || piece.edition_count === null) return null;
  const row = await one<{ taken: string }>(
    `SELECT count(*)::text AS taken FROM orders WHERE piece_slug = $1 AND state IN ('held','paying','paid','invoiced','receipted')`,
    [slug]
  );
  return piece.edition_count - Number(row?.taken ?? 0);
}

export async function editionsLeftTx(tx: Tx, slug: string): Promise<number | null> {
  const piece = await getPieceTx(tx, slug);
  if (!piece || piece.edition_count === null) return null;
  const row = await tx.one<{ taken: string }>(
    `SELECT count(*)::text AS taken FROM orders WHERE piece_slug = $1 AND state IN ('held','paying','paid','invoiced','receipted')`,
    [slug]
  );
  return piece.edition_count - Number(row?.taken ?? 0);
}

// ------------------------------------------------------------------- renders

export interface RenderRow {
  id: string;
  piece_slug: string;
  state: Render['state'];
  failure_reason: Render['failure_reason'];
  cost_credits: number;
  attempts: number;
  format: Render['format'];
  resolution: Render['resolution'];
  duration_s: number;
  aspect: Render['aspect'];
  sha256: string | null;
  history: Render['history'];
  created_at: Date;
}

export function renderBody(row: RenderRow): Render {
  return {
    id: row.id,
    piece_slug: row.piece_slug,
    state: row.state,
    failure_reason: row.failure_reason,
    cost_credits: row.cost_credits,
    attempts: row.attempts,
    format: row.format,
    resolution: row.resolution,
    duration_s: row.duration_s,
    aspect: row.aspect,
    sha256: row.sha256,
    history: row.history,
    created_at: row.created_at.toISOString()
  };
}

export async function getRender(id: string): Promise<RenderRow | null> {
  const row = await one<Record<string, unknown>>(
    `SELECT id, piece_slug, state, failure_reason, cost_credits, attempts, format, resolution, duration_s, aspect, sha256, history::text AS history_json, created_at
     FROM renders WHERE id = $1`,
    [id]
  );
  if (!row) return null;
  return renderFrom(row);
}

function renderFrom(row: Record<string, unknown>): RenderRow {
  return {
    id: row.id as string,
    piece_slug: row.piece_slug as string,
    state: row.state as RenderRow['state'],
    failure_reason: (row.failure_reason as RenderRow['failure_reason']) ?? null,
    cost_credits: row.cost_credits as number,
    attempts: row.attempts as number,
    format: row.format as Render['format'],
    resolution: row.resolution as Render['resolution'],
    duration_s: row.duration_s as number,
    aspect: row.aspect as Render['aspect'],
    sha256: (row.sha256 as string | null) ?? null,
    history: JSON.parse(row.history_json as string) as Render['history'],
    created_at: new Date(row.created_at as string)
  };
}

// ------------------------------------------------------------------- orders

export interface OrderRow {
  id: string;
  piece_slug: string;
  piece_title: string;
  edition: number;
  edition_count: number;
  collector_id: string;
  state: Order['state'];
  expires_at: Date | null;
  seconds_left: number | null;
  billing_name: string;
  email: string;
  billing_country: string;
  net_cents: number;
  vat_rate_percent: number;
  vat_cents: number;
  gross_cents: number;
  invoice_number: string | null;
  invoice_status: Order['invoice_status'];
  receipt_status: Order['receipt_status'];
  refunded_net_cents: number;
  paid_at: Date | null;
  killbill_invoice_id: string | null;
  created_at: Date;
}

const ORDER_SELECT = `
  SELECT o.id, o.piece_slug, p.title AS piece_title, o.edition, p.edition_count, o.collector_id, o.state,
         o.expires_at, o.billing_name, o.email, o.billing_country, o.net_cents, o.vat_rate_percent, o.vat_cents, o.gross_cents,
         o.invoice_number, o.invoice_status, o.receipt_status, o.refunded_net_cents, o.paid_at, o.killbill_invoice_id, o.created_at
  FROM orders o JOIN pieces p ON p.slug = o.piece_slug`;

function orderFrom(row: Record<string, unknown>, now = new Date()): OrderRow {
  const expires = row.expires_at ? new Date(row.expires_at as string) : null;
  return {
    id: row.id as string,
    piece_slug: row.piece_slug as string,
    piece_title: row.piece_title as string,
    edition: row.edition as number,
    edition_count: row.edition_count as number,
    collector_id: row.collector_id as string,
    state: row.state as OrderRow['state'],
    expires_at: expires,
    seconds_left: expires && (row.state === 'held') ? secondsLeft(expires, now) : null,
    billing_name: row.billing_name as string,
    email: row.email as string,
    billing_country: row.billing_country as string,
    net_cents: row.net_cents as number,
    vat_rate_percent: row.vat_rate_percent as number,
    vat_cents: row.vat_cents as number,
    gross_cents: row.gross_cents as number,
    invoice_number: (row.invoice_number as string | null) ?? null,
    invoice_status: row.invoice_status as Order['invoice_status'],
    receipt_status: row.receipt_status as Order['receipt_status'],
    refunded_net_cents: row.refunded_net_cents as number,
    paid_at: row.paid_at ? new Date(row.paid_at as string) : null,
    killbill_invoice_id: (row.killbill_invoice_id as string | null) ?? null,
    created_at: new Date(row.created_at as string)
  };
}

export function orderBody(row: OrderRow): Order {
  return {
    id: row.id,
    piece_slug: row.piece_slug,
    piece_title: row.piece_title,
    edition: row.edition,
    edition_count: row.edition_count,
    state: row.state,
    expires_at: row.expires_at ? row.expires_at.toISOString() : null,
    seconds_left: row.state === 'held' ? secondsLeft(row.expires_at ?? new Date(), new Date()) : null,
    billing_name: row.billing_name,
    email: row.email,
    billing_country: row.billing_country,
    net_cents: row.net_cents,
    vat_rate_percent: row.vat_rate_percent,
    vat_cents: row.vat_cents,
    gross_cents: row.gross_cents,
    currency: 'USD',
    invoice_number: row.invoice_number,
    invoice_status: row.invoice_status,
    receipt_status: row.receipt_status,
    refunded_net_cents: row.refunded_net_cents,
    paid_at: row.paid_at ? row.paid_at.toISOString() : null,
    created_at: row.created_at.toISOString()
  };
}

export async function getOrder(id: string): Promise<OrderRow | null> {
  const row = await one(`${ORDER_SELECT} WHERE o.id = $1`, [id]);
  return row ? orderFrom(row) : null;
}

export async function getOrderTx(tx: Tx, id: string): Promise<OrderRow | null> {
  const row = await tx.one(`${ORDER_SELECT} WHERE o.id = $1`, [id]);
  return row ? orderFrom(row) : null;
}

export async function moveOrder(tx: Tx, id: string, from: Order['state'], to: Order['state']): Promise<void> {
  if (!orderMoveLegal(from, to)) throw new Error(`illegal_order_move_${from}_to_${to}`);
  const moved = await tx.query<{ id: string }>(`UPDATE orders SET state = $2 WHERE id = $1 AND state = $3 RETURNING id`, [id, to, from]);
  if (moved.length === 0) throw new Error(`order_state_raced_${id}`);
}

// ------------------------------------------------------------------- splits

export interface SplitRowRecord {
  id: string;
  party: SplitParty;
  holder_id: string;
  holder_name: string;
  kind: 'sale' | 'refund';
  amount_cents: number;
  refund_id: string | null;
}

export async function saleSplitRows(tx: Tx, orderId: string): Promise<{ party: SplitParty; holder_id: string; amount_cents: number }[]> {
  const rows = await tx.query<{ party: SplitParty; holder_id: string; amount_cents: number }>(
    `SELECT party, holder_id, amount_cents FROM split_rows WHERE order_id = $1 AND kind = 'sale'`,
    [orderId]
  );
  return rows;
}

export async function writeSaleSplits(tx: Tx, orderId: string, piece: PieceRow, netCents: number): Promise<void> {
  const isRemix = piece.remix_of_slug !== null;
  const shares = saleShares(netCents, isRemix);
  const original = piece.remix_of_slug ? await getPieceTx(tx, piece.remix_of_slug) : null;
  for (const share of shares) {
    let holderId: string;
    if (share.party === 'platform') holderId = 'platform';
    else if (share.party === 'royalty') holderId = original?.creator_id ?? piece.creator_id;
    else if (share.party === 'remixer') holderId = piece.creator_id;
    else holderId = piece.creator_id;
    await tx.query(
      `INSERT INTO split_rows (order_id, party, holder_id, kind, amount_cents) VALUES ($1,$2,$3,'sale',$4)`,
      [orderId, share.party, holderId, share.amount_cents]
    );
  }
}

// ------------------------------------------------------------------- holds

export async function expireHolds(now = new Date()): Promise<void> {
  await query(`UPDATE orders SET state = 'expired' WHERE state = 'held' AND expires_at <= $1`, [now]);
}

export function holdStillValid(order: OrderRow, now = new Date()): boolean {
  if (order.state !== 'held') return false;
  return order.expires_at !== null && !holdExpired(order.expires_at, now);
}

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return transaction(fn);
}

export type { SqlValue };
