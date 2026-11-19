import { config } from '../config.js';
import { makeId, makeToken, one, query } from '../db.js';
import { Pennies } from '../../domain/money.js';

export type BidStatus = 'asked' | 'open' | 'withdrawn' | 'closed';

export type BidRecord = {
  id: string;
  enquiryId: string;
  operatorId: string;
  token: string;
  sentAt: number;
  closesAt: number;
  prices: Pennies[] | null;
  receivedAt: number | null;
  withdrawn: boolean;
  closingMailed: boolean;
};

type BidRow = {
  id: string;
  enquiry_id: string;
  operator_id: string;
  token: string;
  sent_at: string;
  closes_at: string;
  prices: number[] | null;
  received_at: string | null;
  withdrawn: boolean;
  closing_mailed: boolean;
};

function fromRow(row: BidRow): BidRecord {
  return {
    id: row.id,
    enquiryId: row.enquiry_id,
    operatorId: row.operator_id,
    token: row.token,
    sentAt: Number(row.sent_at),
    closesAt: Number(row.closes_at),
    prices: row.prices,
    receivedAt: row.received_at === null ? null : Number(row.received_at),
    withdrawn: row.withdrawn,
    closingMailed: row.closing_mailed,
  };
}

const COLUMNS =
  'id, enquiry_id, operator_id, token, sent_at, closes_at, prices, received_at, withdrawn, closing_mailed';

export async function bidsOf(deskId: string, enquiryId: string): Promise<BidRecord[]> {
  const rows = await query<BidRow>(
    `select ${COLUMNS} from bids where desk_id = $1 and enquiry_id = $2 order by operator_id`,
    [deskId, enquiryId],
  );
  return rows.map(fromRow);
}

export async function bidByToken(token: string): Promise<{ deskId: string; bid: BidRecord } | null> {
  const row = await one<BidRow & { desk_id: string }>(`select desk_id, ${COLUMNS} from bids where token = $1`, [token]);
  return row ? { deskId: row.desk_id, bid: fromRow(row) } : null;
}

export async function askOperator(
  deskId: string,
  enquiryId: string,
  operatorId: string,
  sentAt: number,
): Promise<BidRecord> {
  const closesAt = sentAt + config.bidWindowSeconds * 1000;
  const id = makeId('BD');
  const token = makeToken();
  await query(
    `insert into bids (desk_id, id, enquiry_id, operator_id, token, sent_at, closes_at)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [deskId, id, enquiryId, operatorId, token, sentAt, closesAt],
  );
  return {
    id,
    enquiryId,
    operatorId,
    token,
    sentAt,
    closesAt,
    prices: null,
    receivedAt: null,
    withdrawn: false,
    closingMailed: false,
  };
}

export async function savePrices(
  deskId: string,
  bidId: string,
  prices: Pennies[],
  receivedAt: number,
): Promise<void> {
  await query(
    'update bids set prices = $3, received_at = $4, withdrawn = false where desk_id = $1 and id = $2',
    [deskId, bidId, JSON.stringify(prices), receivedAt],
  );
}

export async function withdrawBid(deskId: string, bidId: string): Promise<void> {
  await query('update bids set withdrawn = true where desk_id = $1 and id = $2', [deskId, bidId]);
}

export async function markClosingMailed(deskId: string, bidId: string): Promise<void> {
  await query('update bids set closing_mailed = true where desk_id = $1 and id = $2', [deskId, bidId]);
}

/** A live price is one sent no later than the second of `closesAt` and not withdrawn. */
export function hasLivePrice(bid: BidRecord): boolean {
  return !bid.withdrawn && bid.prices !== null && bid.receivedAt !== null && bid.receivedAt <= bid.closesAt;
}

export function bidTotal(bid: BidRecord): Pennies | null {
  if (!hasLivePrice(bid) || !bid.prices) return null;
  return bid.prices.reduce((sum, price) => sum + price, 0);
}

/** The window limits the operator and not the arranger. */
export function windowOpen(bid: BidRecord, awardedAt: number | null, now: number): boolean {
  if (awardedAt !== null && awardedAt <= now) return false;
  return now <= bid.closesAt;
}

export function bidStatus(bid: BidRecord, awardedAt: number | null, now: number): BidStatus {
  if (!windowOpen(bid, awardedAt, now)) return 'closed';
  if (bid.withdrawn) return 'withdrawn';
  if (hasLivePrice(bid)) return 'open';
  return 'asked';
}

/** The moment the operator's page stopped working: the award if it came first, else `closesAt`. */
export function windowEndedAt(bid: BidRecord, awardedAt: number | null): number {
  if (awardedAt !== null && awardedAt <= bid.closesAt) return awardedAt;
  return bid.closesAt;
}

export type SortedBid = { bid: BidRecord; total: Pennies | null };

export function sortBids(bids: BidRecord[], sort: 'priceLowest' | 'priceHighest'): SortedBid[] {
  const withTotals = bids.map((bid) => ({ bid, total: bidTotal(bid) }));
  const priced = withTotals.filter((row) => row.total !== null);
  const unpriced = withTotals.filter((row) => row.total === null);
  priced.sort((a, b) => {
    const difference = sort === 'priceHighest' ? (b.total as number) - (a.total as number) : (a.total as number) - (b.total as number);
    if (difference !== 0) return difference;
    return (a.bid.receivedAt ?? 0) - (b.bid.receivedAt ?? 0);
  });
  unpriced.sort((a, b) => (a.bid.operatorId < b.bid.operatorId ? -1 : 1));
  return [...priced, ...unpriced];
}
