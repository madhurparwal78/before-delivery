import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "./db.ts";
import { rows, one } from "./db.ts";
import { ApiError } from "./errors.ts";
import type { Actor, RuleSet, Tier } from "./domain/model.ts";
import { averageFramesTenths, tierForAverage, tierPriceCents, allocateSettlement, splitPayoutAcrossDrops } from "./domain/model.ts";
import { orderTransitionAllowed, dropTransitionAllowed, type OrderAction, type OrderStatus, type DropStatus, type SettlementStatus } from "./domain/states.ts";
import { pacificDateParts } from "./domain/dates.ts";
import { newId } from "./seed.ts";

export interface UserRow {
  id: string;
  role: Actor["role"];
  name: string;
  business: string | null;
  email: string;
  password_hash: string;
}

export interface GrowerRow { id: string; name: string; contact_name: string; email: string }
export interface OrchardRow { id: string; grower_id: string; name: string; county: string }
export interface BlockRow { id: string; orchard_id: string; name: string; acres: string; position: number }
export interface OrderRow {
  id: string; ref: string; orchard_id: string; grower_id: string; status: OrderStatus;
  settlement_status: SettlementStatus; bloom_start: string; bloom_end: string; delivery_deadline: string;
  rule_set_id: string; deposit_cents: number;
  kb_account_id: string | null; kb_deposit_invoice_id: string | null; kb_balance_invoice_id: string | null;
  kb_credit_invoice_id: string | null; report_key: string | null; signed_at: Date | null;
  created_at: Date;
}
export interface OrderBlockRow { block_id: string; hives: number }
export interface DropRow {
  id: string; order_id: string; beekeeper_id: string; yard_name: string; hives: number;
  status: DropStatus; block_id: string | null; delivered_at: Date | null; delivered_on: string | null;
  dispute_reason: string | null; resolution_note: string | null;
}
export interface SampleRow { id: string; order_id: string; block_id: string; drop_id: string; colony_label: string; frames_tenths: number }
export interface PhotoRow { id: string; sample_id: string; s3_key: string; content_type: string; ext: string }
export interface LinkRow {
  id: string; order_id: string; token_hash: string; inspector_email: string;
  status: "issued" | "used" | "signed" | "expired"; issued_at: Date; expires_at: Date;
  used_at: Date | null; signed_at: Date | null;
}
export interface SettlementRow {
  order_id: string; status: "queued" | "settled"; payment_received_on: string;
  payable_cents: number; commission_bps: number; commission_cents: number;
  shares: { beekeeper_id: string; hives: number; gross_cents: number; payout_cents: number }[];
  kb_payment_external_key: string | null; lease_until: Date | null; lease_owner: string | null; settled_at: Date | null;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function audit(client: PoolClient | Pool, entity: string, entityId: string, action: string, actor: string): Promise<void> {
  await client.query("INSERT INTO audit_log (entity, entity_id, action, actor) VALUES ($1,$2,$3,$4)", [entity, entityId, action, actor]);
}

/** The single place block strength is computed, from stored samples only. */
export interface BlockStrength {
  sample_count: number;
  average_tenths: number | null;
  average_frames: number | null;
  tier: Tier | null;
  payable_cents: number;
}

export function blockStrength(deliveredHives: number, sampleTenths: readonly number[], rules: RuleSet): BlockStrength {
  const average = averageFramesTenths(sampleTenths);
  if (average === null) {
    return { sample_count: 0, average_tenths: null, average_frames: null, tier: null, payable_cents: 0 };
  }
  const tier = tierForAverage(average, rules);
  const price = tierPriceCents(tier, rules);
  return {
    sample_count: sampleTenths.length,
    average_tenths: average,
    average_frames: average / 10,
    tier,
    payable_cents: deliveredHives * price,
  };
}

export interface OrderContext {
  order: OrderRow;
  orchard: OrchardRow;
  grower: GrowerRow;
  ruleSet: RuleSet;
  blocks: (BlockRow & { hives_ordered: number })[];
  drops: DropRow[];
  samples: SampleRow[];
  link: LinkRow | null;
  settlement: SettlementRow | null;
  beekeepers: Map<string, { id: string; name: string }>;
  photos: Map<string, PhotoRow[]>;
}

export async function loadRuleSet(client: Pool, id: string): Promise<RuleSet | null> {
  const result = await one<RuleSet>(client, "SELECT * FROM rule_sets WHERE id = $1", [id]);
  return result;
}

export async function loadOrderContext(pool: Pool, orderId: string): Promise<OrderContext | null> {
  const order = await one<OrderRow>(pool, "SELECT * FROM orders WHERE id = $1", [orderId]);
  if (!order) return null;
  const orchard = await one<OrchardRow>(pool, "SELECT * FROM orchards WHERE id = $1", [order.orchard_id]);
  const grower = await one<GrowerRow>(pool, "SELECT * FROM growers WHERE id = $1", [order.grower_id]);
  const ruleSet = await loadRuleSet(pool, order.rule_set_id);
  if (!orchard || !grower || !ruleSet) return null;
  const blockRows = await rows<BlockRow>(pool, "SELECT b.* FROM blocks b JOIN order_blocks ob ON ob.block_id = b.id WHERE ob.order_id = $1 ORDER BY b.position", [orderId]);
  const hiveRows = await rows<{ block_id: string; hives: number }>(pool, "SELECT block_id, hives FROM order_blocks WHERE order_id = $1", [orderId]);
  const hivesByBlock = new Map(hiveRows.map((r) => [r.block_id, r.hives]));
  const blocks = blockRows.map((b) => ({ ...b, hives_ordered: hivesByBlock.get(b.id) ?? 0 }));
  const drops = await rows<DropRow>(pool, "SELECT * FROM drops WHERE order_id = $1 ORDER BY created_at, id", [orderId]);
  const samples = await rows<SampleRow>(pool, "SELECT * FROM samples WHERE order_id = $1 ORDER BY created_at, id", [orderId]);
  const beekeeperRows = await rows<{ id: string; name: string; business: string | null }>(
    pool,
    "SELECT DISTINCT u.id, u.name, u.business FROM users u JOIN drops d ON d.beekeeper_id = u.id WHERE d.order_id = $1",
    [orderId],
  );
  const beekeepers = new Map(beekeeperRows.map((b) => [b.id, { id: b.id, name: b.business ?? b.name }]));
  const photos = await listPhotosForSamples(pool, samples.map((s) => s.id));
  const link = await one<LinkRow>(pool, "SELECT * FROM inspection_links WHERE order_id = $1 AND status <> 'expired' ORDER BY issued_at DESC", [orderId]);
  const settlement = await one<SettlementRow>(pool, "SELECT * FROM settlements WHERE order_id = $1", [orderId]);
  return { order, orchard, grower, ruleSet, blocks, drops, samples, link, settlement, beekeepers, photos };
}

/** Per-block delivered hives for an order. */
export function deliveredHivesByBlock(context: OrderContext): Map<string, number> {
  const map = new Map(context.blocks.map((b) => [b.id, 0]));
  for (const drop of context.drops) {
    if (drop.block_id && drop.status !== "committed") {
      map.set(drop.block_id, (map.get(drop.block_id) ?? 0) + drop.hives);
    }
  }
  return map;
}

export function hivesOrdered(context: OrderContext): number {
  return context.blocks.reduce((sum, b) => sum + b.hives_ordered, 0);
}

export function hivesCommitted(context: OrderContext): number {
  return context.drops.reduce((sum, d) => sum + d.hives, 0);
}

export function hivesRemaining(context: OrderContext): number {
  return hivesOrdered(context) - hivesCommitted(context);
}

export function hivesDelivered(context: OrderContext): number {
  return context.drops.reduce((sum, d) => (d.status !== "committed" ? sum + d.hives : sum), 0);
}

export function sampleTenthsByBlock(context: OrderContext): Map<string, number[]> {
  const map = new Map(context.blocks.map((b) => [b.id, [] as number[]]));
  for (const sample of context.samples) {
    map.get(sample.block_id)?.push(sample.frames_tenths);
  }
  return map;
}

export function strengthByBlock(context: OrderContext): Map<string, BlockStrength> {
  const delivered = deliveredHivesByBlock(context);
  const tenths = sampleTenthsByBlock(context);
  return new Map(context.blocks.map((b) => [b.id, blockStrength(delivered.get(b.id) ?? 0, tenths.get(b.id) ?? [], context.ruleSet)]));
}

export function orchardPayableCents(context: OrderContext): number {
  let sum = 0;
  for (const strength of strengthByBlock(context).values()) sum += strength.payable_cents;
  return sum;
}

export function samplesRequired(deliveredHives: number): number {
  return Math.ceil(deliveredHives / 10);
}

/** Per-beekeeper grosses on current data, for payouts and settlement shares. */
export function grossesByBeekeeper(context: OrderContext): Map<string, { hives: number; grossCents: number }> {
  const strengths = strengthByBlock(context);
  const map = new Map<string, { hives: number; grossCents: number }>();
  for (const drop of context.drops) {
    if (!drop.block_id) continue;
    const strength = strengths.get(drop.block_id);
    if (!strength || strength.tier === null) continue;
    const price = tierPriceCents(strength.tier, context.ruleSet);
    const entry = map.get(drop.beekeeper_id) ?? { hives: 0, grossCents: 0 };
    entry.hives += drop.hives;
    entry.grossCents += drop.hives * price;
    map.set(drop.beekeeper_id, entry);
  }
  return map;
}

/** Payout in whole cents for each drop, from the largest-remainder allocation. */
export function payoutCentsByDrop(context: OrderContext): Map<string, number | null> {
  const result = new Map<string, number | null>();
  const strengths = strengthByBlock(context);
  for (const drop of context.drops) {
    result.set(drop.id, null);
  }
  const grosses = grossesByBeekeeper(context);
  if (grosses.size === 0) return result;
  const payable = orchardPayableCents(context);
  const allocation = allocateSettlement(
    payable,
    context.ruleSet.commission_bps,
    [...grosses.entries()].map(([beekeeperId, g]) => ({ beekeeperId, hives: g.hives, grossCents: g.grossCents })),
  );
  for (const share of allocation.shares) {
    const dropGrosses: { id: string; grossCents: number }[] = [];
    for (const drop of context.drops) {
      if (drop.beekeeper_id !== share.beekeeperId || !drop.block_id) continue;
      const strength = strengths.get(drop.block_id);
      if (!strength || strength.tier === null) continue;
      dropGrosses.push({ id: drop.id, grossCents: drop.hives * tierPriceCents(strength.tier, context.ruleSet) });
    }
    for (const [dropId, cents] of splitPayoutAcrossDrops(share.payoutCents, dropGrosses)) {
      result.set(dropId, cents);
    }
  }
  return result;
}

export interface SessionUser {
  id: string;
  role: Actor["role"];
  name: string;
  business: string | null;
}

export async function createSession(pool: Pool, userId: string): Promise<string> {
  const token = newToken();
  await pool.query("INSERT INTO sessions (token_hash, user_id) VALUES ($1,$2)", [sha256(token), userId]);
  return token;
}

export async function userForSession(pool: Pool, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const result = await one<SessionUser>(
    pool,
    `SELECT u.id, u.role, u.name, u.business FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [sha256(token)],
  );
  return result;
}

export async function deleteSession(pool: Pool, token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}

export async function findUserByEmail(pool: Pool, email: string): Promise<UserRow | null> {
  return one<UserRow>(pool, "SELECT * FROM users WHERE email = $1", [email]);
}

export interface Visibility {
  broker: boolean;
  isGrowerOf: (growerId: string) => boolean;
  beekeeperId: string | null;
}

/** Order visibility per role: drafts only to the broker; grower drafts hidden. */
export function orderVisibleTo(context: OrderContext, actor: SessionUser): boolean {
  if (actor.role === "broker") return true;
  if (context.order.status === "draft") return false;
  if (actor.role === "grower") return context.grower.id === actor.id;
  if (actor.role === "beekeeper") {
    if (context.order.status === "open") return true;
    return context.drops.some((d) => d.beekeeper_id === actor.id);
  }
  return false;
}

/**
 * The last-hive commit rule. Commits on one order are decided one at a time:
 * the order row is locked and hives_remaining is checked at this moment.
 */
export async function commitTruckload(
  pool: Pool,
  orderId: string,
  beekeeperId: string,
  yardName: string,
  hives: number,
): Promise<DropRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query<OrderRow>("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const order = orderResult.rows[0];
    if (!order) {
      await client.query("COMMIT");
      throw ApiError.notFound();
    }
    if (!orderTransitionAllowed("fill", order.status)) {
      await client.query("COMMIT");
      if (order.status === "filled" || order.status === "placed" || order.status === "inspected" || order.status === "settled") {
        throw new ApiError(409, "not_enough_open_hives", "No hives are open on this order.", { remaining: 0 });
      }
      throw new ApiError(409, "invalid_transition", `That can't be done while ${order.ref} is ${order.status}.`);
    }
    const orderedRows = await client.query<{ sum: string }>("SELECT COALESCE(sum(hives),0)::text AS sum FROM order_blocks WHERE order_id = $1", [orderId]);
    const committedRows = await client.query<{ sum: string }>("SELECT COALESCE(sum(hives),0)::text AS sum FROM drops WHERE order_id = $1", [orderId]);
    const ordered = Number(orderedRows.rows[0]?.sum ?? "0");
    const committed = Number(committedRows.rows[0]?.sum ?? "0");
    const remaining = ordered - committed;
    if (hives > remaining) {
      await client.query("COMMIT");
      throw new ApiError(409, "not_enough_open_hives", `Only ${remaining} hives are still open on ${order.ref}.`, { remaining });
    }
    const dropId = newId("drp");
    const inserted = await client.query<DropRow>(
      `INSERT INTO drops (id, order_id, beekeeper_id, yard_name, hives, status)
       VALUES ($1,$2,$3,$4,$5,'committed') RETURNING *`,
      [dropId, orderId, beekeeperId, yardName, hives],
    );
    if (committed + hives === ordered) {
      await client.query("UPDATE orders SET status = 'filled' WHERE id = $1", [orderId]);
    }
    await audit(client, "order", orderId, "truckload_committed", beekeeperId);
    await client.query("COMMIT");
    return inserted.rows[0]!;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // transaction already ended
    }
    throw error;
  } finally {
    client.release();
  }
}

export function assertOrderAction(context: OrderContext, action: OrderAction): void {
  if (!orderTransitionAllowed(action, context.order.status)) {
    throw ApiError.invalidTransition(context.order.ref, context.order.status);
  }
}

export function assertDropAction(ref: string, dropStatus: DropStatus, action: Parameters<typeof dropTransitionAllowed>[0]): void {
  if (!dropTransitionAllowed(action, dropStatus)) {
    throw ApiError.invalidTransition(ref, dropStatus);
  }
}

/** Pacific calendar date of a delivery instant. */
export function pacificDateOf(at: Date): string {
  return pacificDateParts(at);
}

export async function listPhotosForSamples(pool: Pool, sampleIds: readonly string[]): Promise<Map<string, PhotoRow[]>> {
  const map = new Map<string, PhotoRow[]>();
  if (sampleIds.length === 0) return map;
  const photoRows = await rows<PhotoRow>(pool, "SELECT id, sample_id, content_type, ext FROM photos WHERE sample_id = ANY($1) ORDER BY created_at, id", [sampleIds]);
  for (const photo of photoRows) {
    const list = map.get(photo.sample_id) ?? [];
    list.push(photo);
    map.set(photo.sample_id, list);
  }
  return map;
}

export async function loadDropContext(pool: Pool, dropId: string): Promise<{ drop: DropRow; context: OrderContext } | null> {
  const drop = await one<DropRow>(pool, "SELECT * FROM drops WHERE id = $1", [dropId]);
  if (!drop) return null;
  const context = await loadOrderContext(pool, drop.order_id);
  if (!context) return null;
  return { drop, context };
}
