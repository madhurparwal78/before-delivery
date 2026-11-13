import { one, rows, type Tx } from "./db.js";
import { toInstant } from "./time.js";

// The double-entry ledger. A posting is a set of legs; within one posting the legs of each asset sum to zero.
// Postings are only ever inserted. An account's balance is the sum of its legs, kept in account_balances by
// the same statement batch that writes the legs, so the two can never disagree.

type PostingKind =
  | "transfer_in"
  | "supply"
  | "withdrawal"
  | "lock"
  | "release"
  | "draw"
  | "accrual"
  | "repay"
  | "swap"
  | "liquidation";

export interface Leg {
  account: string;
  asset: string;
  amount: bigint;
}

export interface LegJson {
  account: string;
  asset: string;
  amount: string;
}

export const account = {
  custody: "custody",
  supply: "supply",
  reserve: "reserve",
  swap: "swap",
  wallet: (actorId: string) => `wallet:${actorId}`,
  collateral: (positionId: string) => `collateral:${positionId}`,
  loan: (positionId: string) => `loan:${positionId}`,
};

export function legJson(leg: Leg): LegJson {
  return { account: leg.account, asset: leg.asset, amount: leg.amount.toString() };
}

/** A posting waiting to be written: what it refers to and its legs. */
export interface PostingDraft {
  ref: string;
  legs: Leg[];
}

/**
 * Writes balanced postings of one kind and returns their ids and kept legs. Zero legs are dropped; an unbalanced
 * posting is a bug. Postings, legs and balances are each written in one statement, whatever the count, so the many
 * postings of an interest accrual cost three round trips rather than four each.
 */
export async function postAll(tx: Tx, kind: PostingKind, at: Date, drafts: PostingDraft[]): Promise<{ postingId: string; legs: Leg[] }[]> {
  if (drafts.length === 0) return [];
  const kept = drafts.map((draft) => draft.legs.filter((leg) => leg.amount !== 0n));
  for (const legs of kept) {
    const sums = new Map<string, bigint>();
    for (const leg of legs) sums.set(leg.asset, (sums.get(leg.asset) ?? 0n) + leg.amount);
    if ([...sums.values()].some((sum) => sum !== 0n)) throw new Error(`unbalanced ${kind} posting`);
  }
  const seqs = await rows<{ seq: string }>(tx, "SELECT nextval('posting_seq')::text AS seq FROM generate_series(1, $1)", [drafts.length]);
  const ids = seqs.map((row) => `pst-${row.seq.padStart(6, "0")}`);
  await tx.query(
    `INSERT INTO postings (posting_id, seq, kind, ref, created_at)
     SELECT * FROM unnest($1::text[], $2::bigint[], $3::text[], $4::text[], $5::timestamptz[])`,
    [ids, seqs.map((row) => row.seq), drafts.map(() => kind), drafts.map((draft) => draft.ref), drafts.map(() => at.toISOString())],
  );
  const flat = kept.flatMap((legs, index) => legs.map((leg, legNo) => ({ ...leg, postingId: ids[index] ?? "", seq: seqs[index]?.seq ?? "", legNo: legNo + 1 })));
  await tx.query(
    `INSERT INTO legs (posting_id, posting_seq, leg_no, account, asset, amount)
     SELECT * FROM unnest($1::text[], $2::bigint[], $3::int[], $4::text[], $5::text[], $6::numeric[])`,
    [flat.map((l) => l.postingId), flat.map((l) => l.seq), flat.map((l) => l.legNo), flat.map((l) => l.account), flat.map((l) => l.asset), flat.map((l) => l.amount.toString())],
  );
  const net = new Map<string, Leg>();
  for (const leg of flat) {
    const key = `${leg.account}\u0000${leg.asset}`;
    net.set(key, { account: leg.account, asset: leg.asset, amount: (net.get(key)?.amount ?? 0n) + leg.amount });
  }
  const totals = [...net.values()];
  await tx.query(
    `INSERT INTO account_balances (account, asset, balance)
     SELECT * FROM unnest($1::text[], $2::text[], $3::numeric[])
     ON CONFLICT (account, asset) DO UPDATE SET balance = account_balances.balance + EXCLUDED.balance`,
    [totals.map((l) => l.account), totals.map((l) => l.asset), totals.map((l) => l.amount.toString())],
  );
  return ids.map((postingId, index) => ({ postingId, legs: kept[index] ?? [] }));
}

/** Writes one balanced posting and returns its id and kept legs. */
export async function post(tx: Tx, kind: PostingKind, ref: string, at: Date, legs: Leg[]): Promise<{ postingId: string; legs: Leg[] }> {
  const [written] = await postAll(tx, kind, at, [{ ref, legs }]);
  if (!written) throw new Error(`${kind} posting was not written`);
  return written;
}

export async function balance(tx: Tx, accountName: string, asset: string): Promise<bigint> {
  const row = await one<{ balance: string }>(tx, "SELECT balance::text FROM account_balances WHERE account = $1 AND asset = $2", [accountName, asset]);
  return BigInt(row?.balance ?? "0");
}

export async function walletBalances(tx: Tx, actorId: string): Promise<Map<string, bigint>> {
  const found = await rows<{ asset: string; balance: string }>(tx, "SELECT asset, balance::text FROM account_balances WHERE account = $1", [account.wallet(actorId)]);
  return new Map(found.map((row) => [row.asset, BigInt(row.balance)]));
}

interface PostingJson {
  posting_id: string;
  kind: string;
  ref: string;
  created_at: string;
  legs: LegJson[];
}

interface PostingFilter {
  asset: string | null;
  limit: number;
  /** A half-open window [from, to) on the posting's instant. */
  from: Date | null;
  to: Date | null;
}

export async function latestPostings(tx: Tx, filter: PostingFilter): Promise<PostingJson[]> {
  const heads = await rows<{ posting_id: string; kind: string; ref: string; created_at: Date; seq: string }>(
    tx,
    `SELECT p.posting_id, p.kind, p.ref, p.created_at, p.seq FROM postings p
     WHERE ($2::text IS NULL OR EXISTS (SELECT 1 FROM legs l WHERE l.posting_seq = p.seq AND l.asset = $2))
       AND ($3::timestamptz IS NULL OR p.created_at >= $3) AND ($4::timestamptz IS NULL OR p.created_at < $4)
     ORDER BY p.seq DESC LIMIT $1`,
    [filter.limit, filter.asset, filter.from, filter.to],
  );
  const legs = await rows<{ posting_id: string; account: string; asset: string; amount: string }>(
    tx,
    "SELECT posting_id, account, asset, amount::text FROM legs WHERE posting_id = ANY($1) ORDER BY posting_seq DESC, leg_no",
    [heads.map((h) => h.posting_id)],
  );
  return heads.map((head) => ({
    posting_id: head.posting_id,
    kind: head.kind,
    ref: head.ref,
    created_at: toInstant(head.created_at),
    legs: legs.filter((leg) => leg.posting_id === head.posting_id).map(({ account: a, asset: s, amount }) => ({ account: a, asset: s, amount })),
  }));
}

export async function accountsOf(tx: Tx, asset: string): Promise<{ account: string; asset: string; balance: string }[]> {
  return rows(tx, "SELECT account, asset, balance::text AS balance FROM account_balances WHERE asset = $1 ORDER BY account", [asset]);
}

export async function totals(tx: Tx): Promise<{ asset: string; debits: string; credits: string; net: string }[]> {
  return rows(
    tx,
    `SELECT a.asset,
            COALESCE(SUM(l.amount) FILTER (WHERE l.amount > 0), 0)::text AS debits,
            COALESCE(-SUM(l.amount) FILTER (WHERE l.amount < 0), 0)::text AS credits,
            COALESCE(SUM(l.amount), 0)::text AS net
     FROM assets a LEFT JOIN legs l ON l.asset = a.asset
     GROUP BY a.asset, a.listing ORDER BY a.listing`,
  );
}
