// Damage reports, the owner's studio figures, member counter payments and a member's balance.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { DamageReport, Owed, OwedAccount, StudioSummary, User } from "../../shared/api";
import { allow, type UserRow } from "../auth";
import { studioLabel } from "../clock";
import { pool, tx, type Db } from "../db";
import { fieldsOf, HttpError, invalidFields, notFound, type Route } from "../http";
import { accountBalanceCents, BillingRefused, BillingUnavailable, balancesByKey, ensureAccount, externalCharge, payAccountBalance } from "../killbill";
import { fillPercent, kilnRows, placedRows } from "../load";
import { addHistory, pieceNumberText } from "../pieces";

interface ReportRow {
  id: number;
  piece_number: number;
  kind: DamageReport["kind"];
  note: string;
  status: DamageReport["status"];
  unload_photo_id: string;
  amount_cents: number | null;
  reported_by: string;
  reported_at: Date;
  intake_photo_id: string;
  account_name: string;
  kb_account_id: string;
}

const REPORTS = `SELECT d.*, p.intake_photo_id, p.kb_account_id, COALESCE(u.name, p.guest_name) AS account_name
  FROM damage_reports d JOIN pieces p ON p.number = d.piece_number LEFT JOIN users u ON u.id = p.member_id`;

function reportOut(row: ReportRow): DamageReport {
  return {
    id: row.id,
    piece_number: pieceNumberText(row.piece_number),
    kind: row.kind,
    note: row.note,
    status: row.status,
    intake_photo_id: row.intake_photo_id,
    unload_photo_id: row.unload_photo_id,
    account_name: row.account_name,
    amount_cents: row.amount_cents,
    reported_by: row.reported_by,
    reported_at: row.reported_at.toISOString(),
    reported_at_label: studioLabel(row.reported_at),
  };
}

const alreadySettled = () => new HttpError(409, "already_settled", "This report is already settled.");

/** Finds the report (404), checks the owner role (403), then locks it for settlement. */
async function settle(rawId: string, user: User, work: (client: pg.PoolClient, report: ReportRow) => Promise<void>): Promise<DamageReport> {
  const id = /^\d{1,9}$/.test(rawId) ? Number(rawId) : null;
  const exists = id === null ? undefined : (await pool.query<{ id: number }>("SELECT id FROM damage_reports WHERE id = $1", [id])).rows[0];
  if (!exists) throw notFound();
  allow(user, "owner");
  await tx(async (client) => {
    await client.query("SELECT id FROM damage_reports WHERE id = $1 FOR UPDATE", [exists.id]);
    const report = (await client.query<ReportRow>(`${REPORTS} WHERE d.id = $1`, [exists.id])).rows[0];
    if (report.status !== "reported") throw alreadySettled();
    await work(client, report);
  });
  return reportOut((await pool.query<ReportRow>(`${REPORTS} WHERE d.id = $1`, [exists.id])).rows[0]);
}

const billingDown = (message: string) => new HttpError(503, "billing_unavailable", message);

export async function userRow(db: Db, id: number): Promise<UserRow> {
  return (await db.query<UserRow>("SELECT * FROM users WHERE id = $1", [id])).rows[0];
}

/** A member's Kill Bill account, created on first need (or at start when billing is reachable). */
export async function memberAccountId(db: Db, member: UserRow): Promise<string> {
  if (member.kb_account_id) return member.kb_account_id;
  const id = await ensureAccount(`member-${member.member_number}`, member.name, member.email);
  await db.query("UPDATE users SET kb_account_id = $1 WHERE id = $2", [id, member.id]);
  return id;
}

/** Creates any missing member accounts (at start, when billing is reachable). */
export async function ensureMemberAccounts(): Promise<void> {
  const members = await pool.query<UserRow>("SELECT * FROM users WHERE role = 'member' AND kb_account_id IS NULL ORDER BY id");
  for (const member of members.rows) await memberAccountId(pool, member);
}

async function owed(): Promise<Owed> {
  const members = (await pool.query<UserRow>("SELECT * FROM users WHERE role = 'member' ORDER BY member_number")).rows;
  for (const member of members) member.kb_account_id = await memberAccountId(pool, member);
  const balances = await balancesByKey();
  const guests = await pool.query<{ number: number; guest_name: string }>("SELECT number, guest_name FROM pieces WHERE member_id IS NULL ORDER BY number");
  const accounts: OwedAccount[] = [
    ...members.map((m) => ({
      kind: "member" as const,
      member_number: m.member_number,
      piece_number: null,
      name: m.name,
      owed_cents: balances.get(`member-${m.member_number}`) ?? 0,
    })),
    ...guests.rows
      .map((g) => ({
        kind: "guest" as const,
        member_number: null,
        piece_number: pieceNumberText(g.number),
        name: g.guest_name,
        owed_cents: balances.get(`guest-${pieceNumberText(g.number)}`) ?? 0,
      }))
      .filter((g) => g.owed_cents > 0),
  ];
  return { accounts, total_owed_cents: accounts.reduce((sum, a) => sum + a.owed_cents, 0) };
}

export const studioRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/damage-reports",
    auth: true,
    body: "none",
    handler: async (ctx) => {
      allow(ctx.user, "owner");
      const rows = await pool.query<ReportRow>(`${REPORTS} ORDER BY (d.status = 'reported') DESC, d.reported_at DESC, d.id DESC`);
      return { status: 200, body: rows.rows.map(reportOut) };
    },
  },
  {
    method: "POST",
    path: "/api/damage-reports/:id/confirm",
    idempotent: true,
    auth: true,
    body: "json",
    handler: async (ctx) => {
      const report = await settle(ctx.params.id, ctx.user, async (client, row) => {
        const amount = fieldsOf(ctx.body).amount_cents;
        if (!(typeof amount === "number" && Number.isInteger(amount) && amount >= 100 && amount <= 20000)) {
          throw invalidFields({ amount_cents: "Enter a shelf charge from $1.00 to $200.00" });
        }
        try {
          await externalCharge(row.kb_account_id, amount, `Shelf damage Piece ${pieceNumberText(row.piece_number)}`);
        } catch (error) {
          if (error instanceof BillingUnavailable) throw billingDown("Charge not posted — billing is unreachable. The report stays open.");
          if (error instanceof BillingRefused) throw billingDown("Charge not posted — billing did not record it. The report stays open.");
          throw error;
        }
        await client.query("UPDATE damage_reports SET status = 'charged', amount_cents = $2 WHERE id = $1", [row.id, amount]);
        await addHistory(client, row.piece_number, ctx.user.name, "damage charged");
      });
      return { status: 200, body: report };
    },
  },
  {
    method: "POST",
    path: "/api/damage-reports/:id/waive",
    auth: true,
    body: "json",
    handler: async (ctx) => {
      const report = await settle(ctx.params.id, ctx.user, async (client, row) => {
        await client.query("UPDATE damage_reports SET status = 'waived' WHERE id = $1", [row.id]);
        await addHistory(client, row.piece_number, ctx.user.name, "damage waived");
      });
      return { status: 200, body: report };
    },
  },
  {
    method: "GET",
    path: "/api/studio/summary",
    auth: true,
    body: "none",
    handler: async (ctx) => {
      allow(ctx.user, "owner");
      const counts = await pool.query<{ ready: number; open: number }>(
        `SELECT (SELECT count(*) FROM pieces WHERE status = 'ready')::int AS ready,
                (SELECT count(*) FROM damage_reports WHERE status = 'reported')::int AS open`,
      );
      const open = await pool.query<{ id: number; kiln_id: string }>("SELECT id, kiln_id FROM firings WHERE status <> 'unloaded'");
      const kilns = await kilnRows(pool);
      const summary: StudioSummary = {
        awaiting_pickup: counts.rows[0].ready,
        open_damage_reports: counts.rows[0].open,
        kilns: await Promise.all(
          kilns.map(async (kiln) => {
            const firing = open.rows.find((f) => f.kiln_id === kiln.id);
            return {
              kiln_id: kiln.id,
              firing_id: firing?.id ?? null,
              fill_percent: firing ? fillPercent(await placedRows(pool, firing.id), kiln.usable_cubic_inches) : null,
            };
          }),
        ),
      };
      return { status: 200, body: summary };
    },
  },
  {
    method: "GET",
    path: "/api/studio/owed",
    auth: true,
    body: "none",
    handler: async (ctx) => {
      allow(ctx.user, "owner");
      try {
        return { status: 200, body: await owed() };
      } catch (error) {
        if (error instanceof BillingUnavailable || error instanceof BillingRefused) {
          throw billingDown("Billing is down — we can't show what's owed right now.");
        }
        throw error;
      }
    },
  },
  {
    method: "POST",
    path: "/api/members/:member_number/payments",
    idempotent: true,
    auth: true,
    body: "json",
    handler: async (ctx) => {
      const member = (await pool.query<UserRow>("SELECT * FROM users WHERE role = 'member' AND member_number = $1", [ctx.params.member_number])).rows[0];
      if (!member || (ctx.user.role === "member" && ctx.user.id !== member.id)) throw notFound();
      allow(ctx.user, "owner");
      const result = await tx(async (client) => {
        const locked = (await client.query<UserRow>("SELECT * FROM users WHERE id = $1 FOR UPDATE", [member.id])).rows[0];
        try {
          const accountId = await memberAccountId(client, locked);
          const balance = await accountBalanceCents(accountId);
          if (balance <= 0) throw new HttpError(409, "nothing_owed", "Nothing is owed.");
          const paid = await payAccountBalance(accountId, balance, `member-payment-${randomUUID()}`);
          return { paid_cents: paid, owed_cents: await accountBalanceCents(accountId) };
        } catch (error) {
          if (error instanceof BillingUnavailable) throw billingDown("Payment not recorded — billing is unreachable.");
          if (error instanceof BillingRefused) throw new HttpError(502, "payment_failed", "Payment not recorded — billing refused the payment.");
          throw error;
        }
      });
      return { status: 200, body: result };
    },
  },
  {
    method: "GET",
    path: "/api/me/balance",
    auth: true,
    body: "none",
    handler: async (ctx) => {
      allow(ctx.user, "member");
      const member = await userRow(pool, ctx.user.id);
      try {
        return { status: 200, body: { owed_cents: await accountBalanceCents(await memberAccountId(pool, member)) } };
      } catch (error) {
        if (error instanceof BillingUnavailable || error instanceof BillingRefused) throw billingDown("Balance unavailable while billing is down.");
        throw error;
      }
    },
  },
];
