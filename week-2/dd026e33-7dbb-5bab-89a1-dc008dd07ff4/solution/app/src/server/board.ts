// The house manager's board and staff access (brief: Screens › Board, Staff access; Business rules
// › Sessions and staff access).
import type { Member } from "../shared/api.js";
import type { Role } from "../shared/domain.js";
import { endSessionsForRevoke, requireRole } from "./auth.js";
import { isoOrNull, many, one, type Db } from "./db.js";
import { conflict, FieldErrors, notFound } from "./errors.js";
import type { Ctx, Reply } from "./http.js";
import { chf } from "./money.js";
import { allBays } from "./bays.js";
import { careRound } from "./care.js";
import { presentViews, readInvoices } from "./invoices.js";

export async function getBoard(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.user, "house_manager");
  const [bays, round, views] = await Promise.all([allBays(ctx.db), careRound(ctx.db), readInvoices(ctx.db, ctx.user)]);
  const unpaid = views.filter((v) => BigInt(v.row.balance_centimes) > 0n);
  const total = unpaid.reduce((sum, v) => sum + BigInt(v.row.balance_centimes), 0n);
  return {
    status: 200,
    body: {
      occupancy: { occupied: bays.filter((b) => b.car !== null).length, total: bays.length },
      bays,
      overdue: round
        .filter((r) => r.round.startup.status === "overdue")
        .sort((a, b) => a.round.bay_code.localeCompare(b.round.bay_code))
        .map((r) => r.round),
      unpaid: { invoices: await presentViews(ctx.db, ctx.user, unpaid), total: chf(total), live: unpaid.every((v) => v.live) },
    },
  };
}

interface MemberRow {
  [key: string]: unknown;
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  revoked_at: Date | null;
  last_sign_in_at: Date | null;
}

function presentMember(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    revoked_at: isoOrNull(row.revoked_at),
    last_sign_in_at: isoOrNull(row.last_sign_in_at),
  };
}

const MEMBER_SELECT = "SELECT id, name, email, role, active, revoked_at, last_sign_in_at FROM users WHERE role <> 'owner'";

async function member(db: Db, id: string): Promise<MemberRow> {
  const row = await one<MemberRow>(db, `${MEMBER_SELECT} AND id = $1`, [id]);
  if (!row) throw notFound();
  return row;
}

export async function listStaff(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.user, "house_manager");
  const rows = await many<MemberRow>(ctx.db, `${MEMBER_SELECT} ORDER BY position, name`);
  return { status: 200, body: { staff: rows.map(presentMember) } };
}

export async function changeAccess(ctx: Ctx): Promise<Reply> {
  const target = await member(ctx.db, ctx.params.id ?? "");
  requireRole(ctx.user, "house_manager");
  if (target.id === ctx.user.id) throw conflict("cannot_change_own_access");
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors = new FieldErrors();
  if (typeof body.active !== "boolean") errors.add("active", "Choose whether the member has access.");
  errors.throwIfAny();
  await ctx.db.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [target.id]);
  if (body.active === false) {
    // Revoking ends every session the member holds; restoring revives none of them.
    await ctx.db.query("UPDATE users SET active = false, revoked_at = coalesce(revoked_at, clock_timestamp()) WHERE id = $1", [target.id]);
    await endSessionsForRevoke(ctx.db, target.id);
  } else {
    await ctx.db.query("UPDATE users SET active = true, revoked_at = NULL WHERE id = $1", [target.id]);
  }
  return { status: 200, body: { member: presentMember(await member(ctx.db, target.id)) } };
}
