import { pool, rows, transaction } from "../db.js";
import { loadCalendar, today } from "../domain/calendar.js";
import { membershipStatus, type MembershipRow } from "../domain/membership.js";
import { hashPassword } from "../domain/session.js";
import { ApiError, conflict, MEMBER, route, STAFF, type Fields, type Reply } from "../http/pipeline.js";
import { isEmail, text } from "../http/values.js";
import { cancelAtEndOfTerm, ensureAccount, ensureSubscription, PLANS, type Tier } from "../providers/killbill.js";
import { ProviderDown } from "../providers/status.js";
import { membershipView } from "../views.js";
import { kickMembershipSync } from "../workers.js";
import { startSession } from "./session.js";

export const BILLING_DOWN = "Billing is down. Nothing was charged; try again when it is back.";

/** Runs Kill Bill work, answering 503 with the screen's billing-down copy when Kill Bill is unreachable. */
export async function withBilling<T>(copy: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ProviderDown) throw new ApiError(503, copy);
    throw error;
  }
}

const isTier = (value: unknown): value is Tier => typeof value === "string" && Object.hasOwn(PLANS, value);

export const memberRoutes = [
  route({
    method: "POST",
    path: "/api/members",
    access: "signed-out",
    body: "json",
    validate: (ctx) => {
      const body = ctx.json ?? {};
      const fields: Fields = {};
      const name = text(body.name)?.trim() ?? "";
      if (name.length < 1 || name.length > 80) fields.name = "Enter your name, up to 80 characters.";
      if (!isEmail(body.email)) fields.email = "Enter an email address like name@example.com.";
      if ((text(body.password) ?? "").length < 10) fields.password = "Use at least 10 characters.";
      if (!isTier(body.tier)) fields.tier = "Choose a membership tier.";
      return fields;
    },
    handle: async (ctx): Promise<Reply> => {
      const body = ctx.json!;
      const name = (body.name as string).trim();
      const email = (body.email as string).trim().toLowerCase();
      const tier = body.tier as Tier;
      const passwordHash = await hashPassword(body.password as string);
      const { user, cookie } = await transaction(async (client) => {
        // One join per email at a time, across every app process.
        await client.query(`SELECT pg_advisory_xact_lock(1, hashtext($1))`, [email]);
        const taken = await client.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
        if (taken.rowCount) throw conflict("An account with this email already exists.");
        const { accountId, subscriptionId } = await withBilling(BILLING_DOWN, async () => {
          const accountId = await ensureAccount(name, email);
          return { accountId, subscriptionId: await ensureSubscription(accountId, tier) };
        });
        const [created] = await rows<{ id: number }>(
          client,
          `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'member') RETURNING id`,
          [name, email, passwordHash],
        );
        await client.query(
          `INSERT INTO memberships (user_id, tier, status, killbill_account_id, killbill_subscription_id) VALUES ($1, $2, 'pending-payment', $3, $4)`,
          [created!.id, tier, accountId, subscriptionId],
        );
        return { user: { id: created!.id, name, email, role: "member" as const }, cookie: await startSession(client, created!.id) };
      });
      kickMembershipSync(user.id);
      const calendar = await loadCalendar(pool);
      const membership = membershipView({ tier, status: "pending-payment", ends_at_term: false, active_until: null }, calendar, ctx.now);
      return { status: 202, body: { user, membership }, headers: { "Set-Cookie": cookie } };
    },
  }),
  route({
    method: "GET",
    path: "/api/members",
    access: "signed-in",
    roles: STAFF,
    body: "none",
    handle: async (ctx): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      const day = today(calendar, ctx.now);
      const members = await rows<MembershipRow & { id: number; name: string; email: string }>(
        pool,
        `SELECT u.id, u.name, u.email, m.tier, m.status, m.ends_at_term, m.active_until
         FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.role = 'member' ORDER BY u.name, u.id`,
      );
      return {
        status: 200,
        body: { members: members.map((m) => ({ id: m.id, name: m.name, email: m.email, membership_status: membershipStatus(m, day) })) },
      };
    },
  }),
  route({
    method: "POST",
    path: "/api/membership/cancel",
    access: "signed-in",
    roles: MEMBER,
    body: "json",
    handle: async (ctx): Promise<Reply> => {
      const calendar = await loadCalendar(pool);
      const membership = await transaction(async (client) => {
        const [row] = await rows<MembershipRow & { killbill_subscription_id: string | null }>(
          client,
          `SELECT tier, status, ends_at_term, active_until, killbill_subscription_id FROM memberships WHERE user_id = $1 FOR UPDATE`,
          [ctx.caller!.id],
        );
        if (membershipStatus(row!, today(calendar, ctx.now)) !== "active") throw conflict("Only an active membership can be cancelled.");
        if (row!.ends_at_term) throw conflict("This membership already ends at the end of its term.");
        const activeUntil = await withBilling(BILLING_DOWN, () => cancelAtEndOfTerm(row!.killbill_subscription_id!));
        await client.query(`UPDATE memberships SET ends_at_term = true, active_until = $2 WHERE user_id = $1`, [ctx.caller!.id, activeUntil]);
        return { ...row!, ends_at_term: true, active_until: activeUntil };
      });
      return { status: 200, body: { membership: membershipView(membership, calendar, ctx.now) } };
    },
  }),
];
