// Co-funding: funder lists, sponsor invite links, acceptance and the sponsor's own share
// (brief: API › Funders and invites, Business rules › Funders, Sponsor links).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { STUDIO_NAME } from "../../shared/catalog.js";
import { formatDay, percent, usd } from "../../shared/format.js";
import { renewSessionRoles, requireCaller, type Caller } from "../auth.js";
import {
  activeFunders, commissionFor, currentQuote, dueText, funderAmounts, funderView, installDayOf, loadCommission, queueDueEmail,
  queueInvoiceDocument, userById, type Commission, type Funder,
} from "../commissions.js";
import { config } from "../config.js";
import { one, pool, query, tx, type Db } from "../db.js";
import { fail, invalid, jsonBody, noContent, ok, record, UUID, type Request, type Router } from "../http.js";
import { enqueue } from "../jobs.js";
import { grantRole } from "../keycloak.js";
import { ensureAccount, invoiceCharges } from "../providers/killbill.js";
import { dueAt, inviteExpiresAt, inviteValid, isoInZone } from "../rules/calendar.js";

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Marks invites that passed their expiry unaccepted as expired. */
export async function expireInvites(db: Db, now: number): Promise<void> {
  const invited = await query<{ id: string; invite_expires_at: Date }>("SELECT id, invite_expires_at FROM funders WHERE state = 'invited'", [], db);
  const lapsed = invited.filter((f) => !inviteValid(f.invite_expires_at.getTime(), now)).map((f) => f.id);
  if (lapsed.length) await db.query("UPDATE funders SET state = 'expired' WHERE id = ANY($1::uuid[]) AND state = 'invited'", [lapsed]);
}

async function depositPaid(db: Db, commissionId: string): Promise<boolean> {
  return Boolean(await one("SELECT 1 FROM milestones WHERE commission_id = $1 AND position = 0 AND state = 'paid'", [commissionId], db));
}

async function fundersView(db: Db, c: Commission): Promise<Record<string, unknown>[]> {
  const funders = await activeFunders(db, c.id);
  const amounts = funderAmounts(funders, await currentQuote(db, c));
  return funders.map((f, i) => funderView(f, amounts[i]));
}

function expiryText(expiresAt: number, zone: string): string {
  const local = isoInZone(expiresAt, zone);
  return `${formatDay(local.slice(0, 10))}, ${local.slice(11, 19)} (${zone})`;
}

/** Issues a fresh link (the old one stops working) and emails it. */
async function sendInvite(db: Db, c: Commission, funder: Funder, amountCents: number): Promise<number> {
  const token = randomBytes(24).toString("base64url");
  const sentAt = Math.floor(Date.now() / 1000) * 1000;
  const expiresAt = inviteExpiresAt(sentAt);
  await db.query("UPDATE funders SET invite_token_hash = $2, invite_sent_at = $3, invite_expires_at = $4, state = 'invited' WHERE id = $1",
    [funder.id, tokenHash(token), new Date(sentAt), new Date(expiresAt)]);
  await enqueue(db, "email", c.id, {
    to: [funder.email],
    subject: `You're invited to co-fund ${c.title}`,
    text: [
      `Hello ${funder.name},`, "",
      `${STUDIO_NAME} invites you to co-fund ${c.title} at ${c.venue.name}.`, "",
      `Your share: ${usd(amountCents)} (${percent(funder.bp)}%)`,
      `Open your invite: ${config.publicUrl}/i/${token}`,
      `This link works until ${expiryText(expiresAt, c.venue.timeZone)}`, "",
    ].join("\n"),
  });
  return expiresAt;
}

async function readFunders(req: Request) {
  const caller = await requireCaller(req);
  const c = await commissionFor(pool, caller, req.params.id, ["owner", "producer"]);
  if (!caller.roles.includes("producer")) fail(403, "forbidden");
  await expireInvites(pool, Date.now());
  return ok({ funders: await fundersView(pool, c) });
}

interface FunderInput {
  kind: "client" | "sponsor";
  name: string;
  email: string;
  bp: number;
}

function parseFunders(body: Record<string, unknown>): FunderInput[] {
  const list = Array.isArray(body.funders) ? body.funders.map(record) : [];
  const errors: Record<string, string> = {};
  if (!list.length || list[0].kind !== "client" || list.slice(1).some((f) => f.kind !== "sponsor")) errors.funders = "List the client first, then the sponsors.";
  if (list.length > 4) errors.funders = "Up to three sponsors per commission.";
  list.forEach((f, i) => {
    if (!Number.isInteger(f.bp) || (f.bp as number) < 1 || (f.bp as number) > 10_000) errors[`funders[${i}].bp`] = "Each share must be at least 0.01%.";
    if (i > 0 && (typeof f.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()))) errors[`funders[${i}].email`] = "Enter a valid email.";
    if (i > 0 && (typeof f.name !== "string" || !f.name.trim() || f.name.trim().length > 80)) errors[`funders[${i}].name`] = "Enter the sponsor's name.";
  });
  const sum = list.reduce((s, f) => s + (Number.isInteger(f.bp) ? (f.bp as number) : 0), 0);
  if (!errors.funders && sum !== 10_000) errors.funders = "Shares must add up to 100.00%.";
  if (Object.keys(errors).length) invalid(errors);
  return list.map((f, i) => ({
    kind: i === 0 ? "client" : "sponsor", name: String(f.name ?? "").trim(), email: String(f.email ?? "").trim().toLowerCase(), bp: f.bp as number,
  }));
}

async function saveFunders(req: Request) {
  const caller = await requireCaller(req);
  const body = record(jsonBody(req));
  return tx(async (db) => {
    const c = await commissionFor(db, caller, req.params.id, ["owner", "producer"], true);
    if (!caller.roles.includes("producer")) fail(403, "forbidden");
    const current = await activeFunders(db, c.id);
    if ((await depositPaid(db, c.id)) || current.some((f) => f.kind === "sponsor" && f.acceptedAt)) fail(409, "funders_locked");
    const wanted = parseFunders(body);
    const client = await userById(db, c.clientId);
    const now = new Date();
    const invited: string[] = [];
    for (const [position, f] of wanted.entries()) {
      const same = current.find((x) => x.kind === f.kind && (f.kind === "client" || x.email === f.email));
      if (same) {
        await db.query("UPDATE funders SET name = $2, bp = $3, position = $4 WHERE id = $1", [same.id, f.kind === "client" ? client.name : f.name, f.bp, position]);
        continue;
      }
      const id = randomUUID();
      await db.query(
        "INSERT INTO funders (id, commission_id, position, kind, name, email, bp, state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [id, c.id, position, f.kind, f.kind === "client" ? client.name : f.name, f.kind === "client" ? client.email : f.email, f.bp, f.kind === "client" ? "lead" : "invited"],
      );
      if (f.kind === "sponsor") invited.push(id);
    }
    const removed = current.filter((x) => !wanted.some((f) => f.kind === x.kind && (x.kind === "client" || f.email === x.email)));
    for (const gone of removed) await db.query("UPDATE funders SET removed_at = $2, invite_token_hash = NULL WHERE id = $1", [gone.id, now]);
    const funders = await activeFunders(db, c.id);
    const amounts = funderAmounts(funders, await currentQuote(db, c));
    for (const id of invited) {
      const index = funders.findIndex((x) => x.id === id);
      await sendInvite(db, c, funders[index], amounts[index].amountCents);
    }
    return ok({ funders: await fundersView(db, c) });
  });
}

async function producerFunder(db: Db, caller: Caller, id: string): Promise<{ c: Commission; funder: Funder; amountCents: number }> {
  if (!UUID.test(id)) fail(404, "not_found");
  const row = await one<{ commission_id: string }>("SELECT commission_id FROM funders WHERE id = $1 AND kind = 'sponsor' AND removed_at IS NULL FOR UPDATE", [id], db);
  if (!row) fail(404, "not_found");
  const c = await commissionFor(db, caller, row.commission_id, ["owner", "producer"]);
  if (!caller.roles.includes("producer")) fail(403, "forbidden");
  const funders = await activeFunders(db, c.id);
  const index = funders.findIndex((f) => f.id === id);
  return { c, funder: funders[index], amountCents: funderAmounts(funders, await currentQuote(db, c))[index].amountCents };
}

async function resend(req: Request) {
  const caller = await requireCaller(req);
  return tx(async (db) => {
    const { c, funder, amountCents } = await producerFunder(db, caller, req.params.id);
    if (funder.acceptedAt || funder.state === "paid") fail(409, "invite_used");
    const expiresAt = await sendInvite(db, c, funder, amountCents);
    return ok({ inviteExpiresAt: new Date(expiresAt).toISOString() });
  });
}

async function revoke(req: Request) {
  const caller = await requireCaller(req);
  return tx(async (db) => {
    const { funder } = await producerFunder(db, caller, req.params.id);
    if (funder.state === "paid") fail(409, "already_paid");
    await db.query("UPDATE funders SET state = 'revoked', invite_token_hash = NULL WHERE id = $1", [funder.id]);
    return noContent();
  });
}

interface InviteRow {
  id: string; commission_id: string; state: string; user_id: string | null; invite_expires_at: Date; name: string; bp: number;
}

async function inviteFor(db: Db, token: string, lock = false): Promise<{ invite: InviteRow; c: Commission }> {
  const invite = await one<InviteRow & Record<string, unknown>>(
    `SELECT * FROM funders WHERE invite_token_hash = $1 AND removed_at IS NULL AND state <> 'revoked'${lock ? " FOR UPDATE" : ""}`, [tokenHash(token)], db,
  );
  if (!invite) fail(404, "invite_invalid");
  if (!inviteValid(invite.invite_expires_at.getTime(), Date.now()) && !invite.user_id) {
    await db.query("UPDATE funders SET state = 'expired' WHERE id = $1 AND state = 'invited'", [invite.id]);
    fail(410, "invite_expired");
  }
  const c = (await loadCommission(db, invite.commission_id)) ?? fail(404, "invite_invalid");
  return { invite, c };
}

async function publicSummary(db: Db, c: Commission): Promise<Record<string, unknown>> {
  const day = await installDayOf(db, c.id);
  return { title: c.title, venueName: c.venue.name, installationType: c.installationType, installDate: day?.date ?? null, studioName: STUDIO_NAME };
}

async function viewInvite(req: Request) {
  const { invite, c } = await inviteFor(pool, req.params.token);
  const funders = await activeFunders(pool, c.id);
  const index = funders.findIndex((f) => f.id === invite.id);
  const share = funderAmounts(funders, await currentQuote(pool, c))[index];
  return ok({
    commission: await publicSummary(pool, c),
    share: { sponsorName: invite.name, bp: invite.bp, ...share },
    expiresAt: invite.invite_expires_at.toISOString(),
  });
}

async function accept(req: Request) {
  const caller = await requireCaller(req);
  const result = await tx(async (db) => {
    const { invite, c } = await inviteFor(db, req.params.token, true);
    await db.query("SELECT 1 FROM commissions WHERE id = $1 FOR UPDATE", [c.id]);
    if (invite.user_id) {
      if (invite.user_id !== caller.id) fail(409, "invite_used");
      return { commissionId: c.id, funderId: invite.id };
    }
    const now = Date.now();
    const funders = await activeFunders(db, c.id);
    const index = funders.findIndex((f) => f.id === invite.id);
    const share = funderAmounts(funders, await currentQuote(db, c))[index];
    const sponsor = await userById(db, caller.id);
    const accountId = await ensureAccount(sponsor);
    const issued = await invoiceCharges(accountId, c.title, "Sponsor share", share.subtotalCents, share.taxCents);
    const due = dueAt(now, c.venue.timeZone);
    const documentId = await queueInvoiceDocument(db, c, sponsor, "Sponsor share", issued, share, due);
    await db.query(
      `UPDATE funders SET user_id = $2, accepted_at = $3, state = 'accepted', subtotal_cents = $4, tax_cents = $5, amount_cents = $6,
         invoiced_at = $3, due_at = $7, killbill_invoice_id = $8, killbill_invoice_number = $9, document_id = $10 WHERE id = $1`,
      [invite.id, caller.id, new Date(now), share.subtotalCents, share.taxCents, share.amountCents, new Date(due), issued.invoiceId, issued.invoiceNumber, documentId],
    );
    await queueDueEmail(db, c, sponsor.email, "Sponsor share", share.amountCents, due);
    return { commissionId: c.id, funderId: invite.id };
  });
  if (!caller.roles.includes("sponsor")) {
    await grantRole(caller.id, "sponsor");
    await renewSessionRoles(req);
  }
  return ok(result);
}

async function share(req: Request) {
  const caller = await requireCaller(req);
  if (!UUID.test(req.params.id)) fail(404, "not_found");
  const row = await one<{ id: string }>("SELECT id FROM funders WHERE commission_id = $1 AND user_id = $2 AND kind = 'sponsor' AND removed_at IS NULL", [req.params.id, caller.id]);
  if (!row) fail(404, "not_found");
  const c = (await loadCommission(pool, req.params.id)) ?? fail(404, "not_found");
  const funder = (await activeFunders(pool, c.id)).find((f) => f.id === row.id) as Funder;
  const amounts = funder.frozen ?? { subtotalCents: 0, taxCents: 0, amountCents: 0 };
  return ok({
    commission: await publicSummary(pool, c),
    share: {
      id: funder.id, sponsorName: funder.name, bp: funder.bp, ...amounts, state: funder.state,
      dueAt: funder.dueAt ? isoInZone(funder.dueAt.getTime(), c.venue.timeZone) : null,
      dueText: funder.dueAt ? dueText(funder.dueAt.getTime(), c.venue.timeZone) : null,
      killbillInvoiceId: funder.killbillInvoiceId, documentId: funder.documentId,
    },
  });
}

export function registerFunders(router: Router): void {
  router.add("GET", "/api/commissions/:id/funders", readFunders);
  router.add("PUT", "/api/commissions/:id/funders", saveFunders);
  router.add("POST", "/api/funders/:id/invite", resend);
  router.add("DELETE", "/api/funders/:id/invite", revoke);
  router.add("GET", "/api/invites/:token", viewInvite);
  router.add("POST", "/api/invites/:token/accept", accept);
  router.add("GET", "/api/commissions/:id/share", share);
}
