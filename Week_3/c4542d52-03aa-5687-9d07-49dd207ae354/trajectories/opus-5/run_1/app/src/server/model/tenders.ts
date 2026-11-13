import type { Tender, TenderState, TenderSubmissionRow } from "../../shared/types.js";
import type { Transaction } from "../db.js";
import { allocateTender } from "../domain/allocation.js";
import { formatCents, parseDecimal, roundHalfUp } from "../domain/money.js";
import type { PersonRow } from "./people.js";

export interface TenderRow {
  id: string;
  title: string;
  buyer: string;
  price_per_share: string;
  share_cap: number;
  closes_at: Date;
  state: TenderState;
}

export const TENDER_COLUMNS = `id, title, buyer, price_per_share::text as price_per_share, share_cap, closes_at, state`;

export interface SubmissionRow {
  tender_id: string;
  person_id: string;
  holder_name: string;
  shares: number;
  submitted_at: Date;
  sequence: number;
  allocation: number | null;
  proceeds_cents: number | null;
}

export async function loadSubmissions(tx: Transaction, tenderId: string): Promise<SubmissionRow[]> {
  return tx.query<SubmissionRow>(
    `select s.tender_id, s.person_id, p.name as holder_name, s.shares, s.submitted_at, s.sequence,
            s.allocation, s.proceeds_cents
       from tender_submissions s join people p on p.id = s.person_id
      where s.tender_id = $1
      order by s.sequence`,
    [tenderId],
  );
}

export function proceedsCents(allocation: number, pricePerShare: string): bigint {
  const price = parseDecimal(pricePerShare, 4);
  if (price === null) throw new Error("the tender price is not an exact figure");
  return roundHalfUp(BigInt(allocation) * price, 100n);
}

export async function buildTender(tx: Transaction, row: TenderRow, person: PersonRow, now: Date): Promise<Tender> {
  const submissions = await loadSubmissions(tx, row.id);
  const totalTendered = submissions.reduce((sum, submission) => sum + submission.shares, 0);
  const tender: Tender = {
    id: row.id,
    title: row.title,
    buyer: row.buyer,
    price_per_share: row.price_per_share,
    share_cap: row.share_cap,
    closes_at: row.closes_at.toISOString(),
    state: row.state,
    total_tendered: totalTendered,
    remaining_cap: Math.max(0, row.share_cap - totalTendered),
    oversubscribed_by: Math.max(0, totalTendered - row.share_cap),
    server_time: now.toISOString(),
  };
  if (person.role === "founder_admin") {
    const rows: TenderSubmissionRow[] = submissions.map((submission) => ({
      holder_id: submission.person_id,
      holder_name: submission.holder_name,
      shares: submission.shares,
      submitted_at: submission.submitted_at.toISOString(),
      sequence: submission.sequence,
      allocation: submission.allocation,
      proceeds: submission.proceeds_cents === null ? null : formatCents(BigInt(submission.proceeds_cents)),
    }));
    return { ...tender, submissions: rows };
  }
  if (person.role !== "investor") return tender;

  const nda = await tx.queryOne<{ status: "none" | "pending" | "sealed"; document_id: string | null }>(
    "select status, document_id from tender_ndas where tender_id = $1 and person_id = $2",
    [row.id, person.id],
  );
  const draft = await tx.queryOne<{ shares: string | null }>(
    "select shares from tender_drafts where tender_id = $1 and person_id = $2",
    [row.id, person.id],
  );
  const mine = submissions.find((submission) => submission.person_id === person.id) ?? null;
  const projected =
    mine === null
      ? 0
      : allocateTender(
          submissions.map((submission) => ({
            holderId: submission.person_id,
            shares: submission.shares,
            sequence: submission.sequence,
          })),
          row.share_cap,
        ).get(person.id) ?? 0;
  return {
    ...tender,
    mine: {
      nda: { status: nda?.status ?? "none", document_id: nda?.document_id ?? null },
      draft_shares: draft?.shares ?? null,
      submission:
        mine === null
          ? null
          : { shares: mine.shares, submitted_at: mine.submitted_at.toISOString(), sequence: mine.sequence },
      projected_allocation: projected,
      allocation: mine?.allocation ?? null,
      proceeds: mine === null || mine.proceeds_cents === null ? null : formatCents(BigInt(mine.proceeds_cents)),
    },
  };
}
