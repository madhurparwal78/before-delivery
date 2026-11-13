import { randomBytes } from "node:crypto";
import { one, pool, rows } from "../db.js";
import { fail, FIELD } from "../errors.js";
import { requireRole, valid, type Ctx, type Member, type PublicCall, type Reply, type Role, type Route, type PublicRoute } from "../http.js";
import { account, post, walletBalances } from "../ledger.js";
import { parseAmount } from "../money.js";
import { poolBalances, shareValue } from "../pools.js";

// Members, sessions, inbound transfers and wallets.

const ROLE_PREFIX: Record<Role, string> = {
  risk_steward: "stw",
  liquidity_provider: "lp",
  borrower: "br",
  trader: "tr",
  liquidator: "lq",
};

function parseName(value: unknown): string | null {
  const name = typeof value === "string" ? value.normalize("NFC").trim() : "";
  const length = [...name].length;
  return length >= 1 && length <= 80 ? name : null;
}

function parseEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.normalize("NFC") : "";
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function parseRole(value: unknown): Role | null {
  return typeof value === "string" && Object.hasOwn(ROLE_PREFIX, value) ? (value as Role) : null;
}

async function listMembers(): Promise<Reply> {
  const found = await pool.query<Member>("SELECT actor_id, name, email, role FROM members ORDER BY name, actor_id");
  return { status: 200, body: { actors: found.rows } };
}

/** Choosing a member opens a bearer-token session for them. The token is an opaque random string that does not expire. */
async function createSession({ body, bodyErrors }: PublicCall): Promise<Reply> {
  const actorId = body["actor_id"];
  const found = typeof actorId === "string" ? await pool.query<Member>("SELECT actor_id, name, email, role FROM members WHERE actor_id = $1", [actorId]) : undefined;
  const { actor_id: member } = valid(bodyErrors, { actor_id: [found?.rows[0], FIELD.actorId] });
  const token = randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions (token, actor_id, created_at) VALUES ($1, $2, now())", [token, member.actor_id]);
  return { status: 201, body: { token, actor_id: member.actor_id, role: member.role } };
}

async function me({ member }: Ctx): Promise<Reply> {
  return { status: 200, body: member };
}

async function addMember(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.member, "risk_steward");
  const name = parseName(ctx.body["name"]);
  const email = parseEmail(ctx.body["email"]);
  const role = parseRole(ctx.body["role"]);
  if (email !== null && (await one(ctx.tx, "SELECT 1 FROM members WHERE lower(email) = lower($1)", [email]))) throw fail("email_taken");
  const checked = valid(ctx.bodyErrors, { name: [name, FIELD.name], email: [email, FIELD.email], role: [role, FIELD.role] });
  const member: Member = { actor_id: `${ROLE_PREFIX[checked.role]}-${randomBytes(4).toString("hex")}`, name: checked.name, email: checked.email, role: checked.role };
  await ctx.tx.query("INSERT INTO members (actor_id, name, email, role, created_at) VALUES ($1, $2, $3, $4, $5)", [
    member.actor_id,
    member.name,
    member.email,
    member.role,
    ctx.now,
  ]);
  return { status: 201, body: member };
}

async function recordTransfer(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.member, "risk_steward");
  const amount = parseAmount(ctx.body["amount"]);
  const assetCode = ctx.body["asset"];
  const asset = typeof assetCode === "string" ? ctx.market.get(assetCode) : undefined;
  const actorId = ctx.body["actor_id"];
  const target = typeof actorId === "string" ? await one<{ actor_id: string }>(ctx.tx, "SELECT actor_id FROM members WHERE actor_id = $1", [actorId]) : undefined;
  const checked = valid(ctx.bodyErrors, { amount: [amount, FIELD.amount], asset: [asset, FIELD.asset], actor_id: [target, FIELD.actorId] });
  const transferId = `trf-${randomBytes(6).toString("hex")}`;
  const { postingId } = await post(ctx.tx, "transfer_in", transferId, ctx.now, [
    { account: account.custody, asset: checked.asset.asset, amount: -checked.amount },
    { account: account.wallet(checked.actor_id.actor_id), asset: checked.asset.asset, amount: checked.amount },
  ]);
  return {
    status: 201,
    body: { transfer_id: transferId, posting_id: postingId, actor_id: checked.actor_id.actor_id, asset: checked.asset.asset, amount: checked.amount.toString() },
  };
}

async function wallet(ctx: Ctx): Promise<Reply> {
  const balances = await walletBalances(ctx.tx, ctx.member.actor_id);
  const holdings = await rows<{ asset: string; shares: string }>(ctx.tx, "SELECT asset, shares::text FROM share_holdings WHERE actor_id = $1", [ctx.member.actor_id]);
  const lpHoldings = [];
  for (const asset of ctx.market.values()) {
    const shares = BigInt(holdings.find((h) => h.asset === asset.asset)?.shares ?? "0");
    const { supply } = await poolBalances(ctx.tx, asset.asset);
    lpHoldings.push({ asset: asset.asset, shares: shares.toString(), value: shareValue(shares, supply, asset.totalShares).toString() });
  }
  const positions = await rows<{ position_id: string }>(ctx.tx, "SELECT position_id FROM positions WHERE borrower_id = $1 ORDER BY seq", [ctx.member.actor_id]);
  return {
    status: 200,
    body: {
      actor_id: ctx.member.actor_id,
      balances: [...ctx.market.keys()].map((asset) => ({ asset, amount: (balances.get(asset) ?? 0n).toString() })),
      lp_holdings: lpHoldings,
      position_ids: positions.map((p) => p.position_id),
    },
  };
}

export const memberPublicRoutes: PublicRoute[] = [
  { method: "GET", pattern: /^\/api\/actors$/, handler: listMembers },
  { method: "POST", pattern: /^\/api\/sessions$/, fields: ["actor_id"], handler: createSession },
];

export const memberRoutes: Route[] = [
  { method: "GET", pattern: /^\/api\/me$/, handler: me },
  { method: "POST", pattern: /^\/api\/actors$/, fields: ["name", "email", "role"], handler: addMember },
  { method: "POST", pattern: /^\/api\/transfers$/, fields: ["actor_id", "asset", "amount"], handler: recordTransfer },
  { method: "GET", pattern: /^\/api\/wallet$/, handler: wallet },
];

