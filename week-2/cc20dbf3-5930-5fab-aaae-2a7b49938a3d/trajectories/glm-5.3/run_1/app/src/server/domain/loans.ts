import { PoolClient } from "pg";
import { LoanRow, PhotoView, SettlementView } from "./views";
import { closingInstant, LibraryCalendar } from "../calendar";
import { localDate } from "../time";

const LOAN_SELECT = `
  SELECT l.id::text AS id, l.item_id, i.name AS item_name, l.unit_id, u.label AS unit_label, u.lane_index,
         l.member_id, m.name AS member_name, m.email AS member_email, l.hold_id::text AS hold_id, l.status,
         l.checked_out_at, l.due_date::text AS due_date, l.renewed_at, l.returned_at, l.on_time, l.late_days,
         l.deposit_cents, l.replacement_cents
    FROM loans l
    JOIN items i ON i.id = l.item_id
    JOIN units u ON u.id = l.unit_id
    JOIN users m ON m.id = l.member_id
`;

async function decorateLoan(client: PoolClient, row: Record<string, unknown>, calendar: LibraryCalendar): Promise<LoanRow> {
  const loanId = row.id as string;
  const inspection = await client.query(
    "SELECT outcome, note, inspected_at FROM inspections WHERE loan_id = $1",
    [loanId],
  );
  const settlement = await client.query(
    `SELECT loan_id::text, deposit_cents, released_cents, damage_cents, damage_from_deposit_cents,
            extra_damage_cents, late_days, late_fee_cents, total_charged_cents, settled_at
       FROM settlements WHERE loan_id = $1`,
    [loanId],
  );
  const photos = await client.query(
    "SELECT id::text AS id, stage, content_type, size_bytes FROM photos WHERE loan_id = $1 ORDER BY created_at ASC, id ASC",
    [loanId],
  );
  const photoViews: PhotoView[] = (photos.rows as {
    id: string; stage: "checkout" | "return"; content_type: string; size_bytes: number;
  }[]).map((photo) => ({
    id: photo.id,
    stage: photo.stage,
    content_type: photo.content_type,
    size_bytes: photo.size_bytes,
    url: `/api/loans/${loanId}/photos/${photo.id}`,
  }));
  return {
    id: loanId,
    item_id: row.item_id as string,
    item_name: row.item_name as string,
    unit_id: row.unit_id as string,
    unit_label: row.unit_label as string,
    lane_index: row.lane_index as number,
    member_id: row.member_id as string,
    member_name: row.member_name as string,
    member_email: row.member_email as string,
    hold_id: (row.hold_id as string | null) ?? null,
    status: row.status as LoanRow["status"],
    checked_out_at: new Date(row.checked_out_at as Date),
    due_date: row.due_date as string,
    due_at: closingInstant(calendar, row.due_date as string),
    renewed_at: row.renewed_at === null ? null : new Date(row.renewed_at as Date),
    returned_at: row.returned_at === null ? null : new Date(row.returned_at as Date),
    on_time: row.on_time === null ? null : Boolean(row.on_time),
    late_days: row.late_days === null ? null : Number(row.late_days),
    deposit_cents: Number(row.deposit_cents),
    replacement_cents: Number(row.replacement_cents),
    inspection:
      inspection.rowCount === 0
        ? null
        : {
            outcome: inspection.rows[0].outcome as "ok" | "damaged",
            note: inspection.rows[0].note as string,
            inspected_at: toIso(inspection.rows[0].inspected_at as Date),
          },
    settlement: settlement.rowCount === 0 ? null : settlementViewFrom(settlement.rows[0]),
    photos: photoViews,
  };
}

function settlementViewFrom(row: Record<string, unknown>): SettlementView {
  return {
    loan_id: row.loan_id as string,
    deposit_cents: Number(row.deposit_cents),
    released_cents: Number(row.released_cents),
    damage_cents: Number(row.damage_cents),
    damage_from_deposit_cents: Number(row.damage_from_deposit_cents),
    extra_damage_cents: Number(row.extra_damage_cents),
    late_days: Number(row.late_days),
    late_fee_cents: Number(row.late_fee_cents),
    total_charged_cents: Number(row.total_charged_cents),
    settled_at: toIso(row.settled_at as Date),
  };
}

function toIso(value: Date): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function selectLoanById(
  client: PoolClient,
  loanId: string,
  calendar: LibraryCalendar,
): Promise<LoanRow | null> {
  const result = await client.query(`${LOAN_SELECT} WHERE l.id = $1`, [loanId]);
  if (result.rowCount === 0) return null;
  return decorateLoan(client, result.rows[0], calendar);
}

export async function selectLoanPage(
  client: PoolClient,
  calendar: LibraryCalendar,
  options: {
    memberId?: string;
    status?: string;
    limit: number;
    before?: { k: string; i: string } | null;
    viewerIsMember: boolean;
  },
): Promise<{ rows: LoanRow[]; nextCursor: { k: string; i: string } | null }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  // Members see only their own records; staff see all of them.
  if (options.viewerIsMember) {
    params.push(options.memberId);
    conditions.push(`l.member_id = $${params.length}`);
  }
  if (options.status !== undefined) {
    if (options.status === "overdue") {
      conditions.push(`l.status = 'out' AND now() > ((l.due_date::text || ' ' || lib.closing_time)::timestamp AT TIME ZONE lib.time_zone)`);
    } else if (options.status === "out") {
      conditions.push(`l.status = 'out' AND now() <= ((l.due_date::text || ' ' || lib.closing_time)::timestamp AT TIME ZONE lib.time_zone)`);
    } else {
      params.push(options.status);
      conditions.push(`l.status = $${params.length}`);
    }
  }
  if (options.before !== undefined && options.before !== null) {
    params.push(options.before.k, options.before.i);
    conditions.push(`(l.checked_out_at, l.id) < ($${params.length - 1}, $${params.length})`);
  }
  params.push(options.limit + 1);
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  const result = await client.query(
    `WITH lib AS (SELECT time_zone, closing_time FROM library WHERE id = 'library')
     ${LOAN_SELECT} CROSS JOIN lib ${where} ORDER BY l.checked_out_at DESC, l.id DESC LIMIT $${params.length}`,
    params,
  );
  const rows: LoanRow[] = [];
  for (const raw of result.rows) {
    rows.push(await decorateLoan(client, raw, calendar));
  }
  let nextCursor: { k: string; i: string } | null = null;
  if (rows.length > options.limit) {
    rows.length = options.limit;
    const last = rows[rows.length - 1];
    nextCursor = { k: last.checked_out_at.toISOString(), i: last.id };
  }
  return { rows, nextCursor };
}

export async function loansOutForUnit(client: PoolClient, unitId: string): Promise<{ id: string }[]> {
  const result = await client.query("SELECT id::text AS id FROM loans WHERE unit_id = $1 AND status = 'out'", [unitId]);
  return result.rows as { id: string }[];
}
