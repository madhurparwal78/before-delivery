import type { FixView, MyPledge, PledgeResult, Quote } from "../shared/api.js";
import { countryOf } from "../shared/countries.js";
import { CARD_FIELD_ERROR, testCard, type Card } from "./cards.js";
import { documentReply } from "./campaigns.js";
import { one, pool, rows, tx, type Db } from "./db.js";
import { fail, invalid, notFound, route } from "./http.js";
import { idempotencyKey, once } from "./idempotency.js";
import { cardMethod, authorize, ensureAccount, release } from "./killbill.js";
import { recordNotice } from "./notices.js";
import { bearer, insertPerson, newId, personFields, requirePerson, type PersonRow } from "./people.js";
import { percentOf, pledgeAmount } from "./rules.js";
import {
  ACTIVE_STATES, claimPledge, movePledge, requireActive, requireFixable, requirePledgingOpen, requireStillFunded,
} from "./transitions.js";
import {
  campaignTiers, campaignTotals, ownPledgeView, PLEDGE_SELECT, tierView, visibleCampaign,
  type CampaignRecord, type PledgeRecord, type TierRecord,
} from "./views.js";

// Quotes, pledges, changes, cancellations and fixes (DP-14 to DP-24, DP-30, DP-31, DP-40). Every change to
// one campaign's pledges runs under that campaign's row lock, so claims, the one-pledge rule and the
// final-window guard are serialised.

const ADD_ON_ERROR = "Enter an add-on from 0.00 to 500.00.";

function addOnOf(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 50_000 ? value : null;
}

function tierOf(tiers: TierRecord[], id: unknown): TierRecord | undefined {
  if (id === undefined || id === null) return undefined;
  return tiers.find((t) => t.id === id) ?? notFound();
}

function soldOut(tier: TierRecord): boolean {
  return tier.quantity !== null && tier.claimed >= tier.quantity;
}

async function loadPledge(db: Db, where: string, value: string, lock = false): Promise<PledgeRecord | undefined> {
  return one<PledgeRecord>(db, `${PLEDGE_SELECT} WHERE ${where} = $1${lock ? " FOR UPDATE OF p" : ""}`, [value]);
}

async function ownPledge(db: Db, id: string, me: PersonRow, lock = false): Promise<PledgeRecord> {
  const found = await loadPledge(db, "p.id", id, lock);
  if (!found || found.backer_id !== me.id) notFound();
  return found;
}

async function accountOf(db: Db, person: PersonRow, fresh = false): Promise<string> {
  if (person.kb_account_id) return person.kb_account_id;
  const accountId = await ensureAccount(person, fresh);
  await db.query("UPDATE people SET kb_account_id = $2 WHERE id = $1", [person.id, accountId]);
  person.kb_account_id = accountId;
  return accountId;
}

async function result(db: Db, pledgeId: string, campaign: CampaignRecord, status: number, key?: string) {
  const pledge = await loadPledge(db, "p.id", pledgeId);
  const totals = await campaignTotals(db, campaign.id);
  const body: PledgeResult = {
    ...ownPledgeView(pledge as PledgeRecord),
    campaign_total: totals.total,
    campaign_percent: percentOf(totals.total, campaign.goal),
  };
  if (key) body.key = key;
  return { status, json: body as unknown as Record<string, unknown> };
}

// Quotes

route("POST", "/api/campaigns/:id/quote", async (req) => {
  const viewer = await bearer(req);
  const campaign = await visibleCampaign(pool, req.params[0], viewer);
  const tier = tierOf(await campaignTiers(pool, campaign.id), req.json.tier_id);
  requirePledgingOpen(campaign);
  const errors: Record<string, string> = {};
  const addOn = addOnOf(req.json.add_on);
  if (!tier) errors.tier_id = "Choose a reward tier.";
  if (!countryOf(req.json.country)) errors.country = "Choose a shipping country.";
  if (addOn === null) errors.add_on = ADD_ON_ERROR;
  if (!tier || addOn === null || Object.keys(errors).length) invalid(errors);
  const quoted = pledgeAmount(tierView(tier), String(req.json.country), campaign.ships_from, addOn);
  const { total } = await campaignTotals(pool, campaign.id);
  const own = viewer
    ? await one<{ amount: number }>(pool, "SELECT amount FROM pledges WHERE campaign_id = $1 AND backer_id = $2 AND state = 'authorised'", [campaign.id, viewer.id])
    : undefined;
  const projected = total - (own?.amount ?? 0) + quoted.amount;
  const quote: Quote = { tier_id: tier.id, ...quoted, projected_total: projected, projected_percent: percentOf(projected, campaign.goal) };
  return { status: 200, json: quote };
});

// Pledging

interface PledgeInput {
  tier: TierRecord;
  country: string;
  addOn: number;
  card: Card;
}

function pledgeInput(body: Record<string, unknown>, tier: TierRecord | undefined, creating: boolean): PledgeInput {
  const errors: Record<string, string> = creating ? personFields(body) : {};
  const addOn = addOnOf(body.add_on);
  const card = testCard(body.card_number);
  if (!tier) errors.tier_id = "Choose a reward tier.";
  if (!countryOf(body.country)) errors.country = "Choose a shipping country.";
  if (addOn === null) errors.add_on = ADD_ON_ERROR;
  if (!card) errors.card_number = CARD_FIELD_ERROR;
  if (!tier || addOn === null || !card || Object.keys(errors).length) invalid(errors);
  return { tier, country: String(body.country), addOn, card };
}

async function createPledge(campaignId: string, viewer: PersonRow | null, body: Record<string, unknown>) {
  return tx(async (db) => {
    const campaign = await visibleCampaign(db, campaignId, viewer, true);
    const tier = tierOf(await campaignTiers(db, campaign.id), body.tier_id);
    if (viewer?.id === campaign.creator_id) fail(403, "own_campaign");
    requirePledgingOpen(campaign);
    if (viewer && (await one(db, "SELECT 1 FROM pledges WHERE campaign_id = $1 AND backer_id = $2 AND state = ANY($3)", [campaign.id, viewer.id, ACTIVE_STATES]))) {
      fail(409, "already_pledged");
    }
    if (tier && soldOut(tier)) fail(409, "tier_sold_out");
    const input = pledgeInput(body, tier, !viewer);
    if (!input.card.authorises) fail(402, "card_declined");
    const made = viewer ? null : await insertPerson(db, String(body.name), String(body.email));
    const backer: PersonRow = viewer ?? { id: made!.id, name: made!.name, email: made!.email, kb_account_id: null };
    const amounts = pledgeAmount(tierView(input.tier), input.country, campaign.ships_from, input.addOn);
    const pledge = await claimPledge(db, {
      id: newId(), campaign_id: campaign.id, backer_id: backer.id, tier_id: input.tier.id, country: input.country,
      ...amounts, card_last4: input.card.last4,
    });
    // A backer created in this request has no Kill Bill account or method yet: two lookups fewer on the hold.
    const accountId = await accountOf(db, backer, made !== null);
    const paymentMethodId = await cardMethod(accountId, made !== null);
    const paymentId = await authorize(accountId, paymentMethodId, pledge.id, amounts.amount);
    await movePledge(db, pledge, "authorised", { kb_payment_method_id: paymentMethodId, kb_payment_id: paymentId });
    await recordNotice(db, campaign.id, "pledge_receipt", backer.email, { title: campaign.title, amount: amounts.amount });
    return result(db, pledge.id, campaign, 201, made?.key);
  });
}

route("POST", "/api/campaigns/:id/pledges", async (req) => {
  const viewer = await bearer(req);
  const creating = !viewer && ("name" in req.json || "email" in req.json);
  if (!viewer && !creating) fail(401, "unauthenticated");
  const key = idempotencyKey(req);
  const scope = viewer ? `person:${viewer.id}` : `email:${String(req.json.email).toLowerCase()}`;
  return once(scope, `pledge:${req.params[0]}`, key, req.json, () => createPledge(req.params[0], viewer, req.json));
});

route("GET", "/api/me/pledges", async (req) => {
  const me = await requirePerson(req);
  const found = await rows<PledgeRecord & { c_title: string; c_status: MyPledge["campaign"]["status"]; c_cover: string | null }>(pool,
    `${PLEDGE_SELECT.replace("FROM pledges p", `, c.title AS c_title, c.status AS c_status,
       (SELECT m.id FROM media m WHERE m.campaign_id = c.id AND m.kind = 'cover' AND m.status = 'stored' ORDER BY m.created_at DESC LIMIT 1) AS c_cover
       FROM pledges p JOIN campaigns c ON c.id = p.campaign_id`)}
     WHERE p.backer_id = $1 ORDER BY p.created_at DESC, p.id`, [me.id]);
  const mine: MyPledge[] = found.map((p) => ({
    ...ownPledgeView(p),
    campaign: { id: p.campaign_id, title: p.c_title, status: p.c_status, cover_media_id: p.c_cover },
  }));
  return { status: 200, json: mine };
});

route("GET", "/api/pledges/:id", async (req) => {
  const me = await requirePerson(req);
  return { status: 200, json: ownPledgeView(await ownPledge(pool, req.params[0], me)) };
});

async function changePledge(pledgeId: string, me: PersonRow, body: Record<string, unknown>) {
  return tx(async (db) => {
    const located = await ownPledge(db, pledgeId, me);
    const campaign = await visibleCampaign(db, located.campaign_id, me, true);
    const old = await ownPledge(db, pledgeId, me, true);
    const tiers = await campaignTiers(db, campaign.id);
    const nextTier = tierOf(tiers, body.tier_id ?? old.tier_id) as TierRecord;
    requirePledgingOpen(campaign);
    requireActive(old);
    if (nextTier.id !== old.tier_id && soldOut(nextTier)) fail(409, "tier_sold_out");
    const country = body.country ?? old.country;
    const addOn = "add_on" in body ? addOnOf(body.add_on) : old.add_on;
    const errors: Record<string, string> = {};
    if (!countryOf(country)) errors.country = "Choose a shipping country.";
    if (addOn === null) errors.add_on = ADD_ON_ERROR;
    if (addOn === null || Object.keys(errors).length) invalid(errors);
    const amounts = pledgeAmount(tierView(nextTier), String(country), campaign.ships_from, addOn);
    requireStillFunded(campaign, (await campaignTotals(db, campaign.id)).total, amounts.amount - old.amount);
    if (nextTier.id === old.tier_id && country === old.country && addOn === old.add_on) invalid({ pledge: "Change the tier, country or add-on first." });
    const pledge = await claimPledge(db, {
      id: newId(), campaign_id: campaign.id, backer_id: me.id, tier_id: nextTier.id, country, ...amounts,
      card_last4: old.card_last4, kb_payment_method_id: old.kb_payment_method_id, replaces: old.id,
    });
    const paymentId = await authorize(await accountOf(db, me), old.kb_payment_method_id as string, pledge.id, amounts.amount);
    await release(old.kb_payment_id as string, old.id);
    await movePledge(db, old, "voided");
    await movePledge(db, pledge, "authorised", { kb_payment_id: paymentId });
    await recordNotice(db, campaign.id, "pledge_receipt", me.email, { title: campaign.title, amount: amounts.amount });
    return result(db, pledge.id, campaign, 201);
  });
}

route("PATCH", "/api/pledges/:id", async (req) => {
  const me = await requirePerson(req);
  const key = idempotencyKey(req);
  return once(`person:${me.id}`, `change:${req.params[0]}`, key, req.json, () => changePledge(req.params[0], me, req.json));
});

route("POST", "/api/pledges/:id/cancel", async (req) => {
  const me = await requirePerson(req);
  return tx(async (db) => {
    const located = await ownPledge(db, req.params[0], me);
    const campaign = await visibleCampaign(db, located.campaign_id, me, true);
    const pledge = await ownPledge(db, req.params[0], me, true);
    requirePledgingOpen(campaign);
    requireActive(pledge);
    requireStillFunded(campaign, (await campaignTotals(db, campaign.id)).total, -pledge.amount);
    await release(pledge.kb_payment_id as string, pledge.id);
    await movePledge(db, pledge, "voided");
    await recordNotice(db, campaign.id, "pledge_cancelled", me.email, { title: campaign.title, amount: pledge.amount });
    return { status: 200, json: ownPledgeView((await loadPledge(db, "p.id", pledge.id)) as PledgeRecord) };
  });
});

route("GET", "/api/pledges/:id/statement.pdf", async (req) => {
  const me = await requirePerson(req);
  const pledge = await ownPledge(pool, req.params[0], me);
  return documentReply(`statement:${pledge.id}`, `statement-${pledge.id}.pdf`);
});

// Fixing a card (DP-40)

function fixView(p: PledgeRecord & { title: string }): FixView {
  const own = ownPledgeView(p);
  return {
    pledge_id: p.id, campaign_title: p.title, amount: p.amount, state: p.state,
    fix_deadline_utc: own.fix_deadline_utc, fix_seconds_left: own.fix_seconds_left, card_fixed: own.card_fixed,
  };
}

async function fixPledge(db: Db, code: string, lock = false): Promise<PledgeRecord & { title: string }> {
  const found = await one<PledgeRecord & { title: string }>(db,
    `${PLEDGE_SELECT.replace("FROM pledges p", ", c.title FROM pledges p JOIN campaigns c ON c.id = p.campaign_id")} WHERE p.fix_code = $1${lock ? " FOR UPDATE OF p" : ""}`, [code]);
  return found ?? notFound();
}

route("GET", "/api/fix/:code", async (req) => ({ status: 200, json: fixView(await fixPledge(pool, req.params[0])) }));

route("POST", "/api/fix/:code", async (req) => {
  return tx(async (db) => {
    const pledge = await fixPledge(db, req.params[0], true);
    requireFixable(pledge);
    const card = testCard(req.json.card_number);
    if (!card) invalid({ card_number: CARD_FIELD_ERROR });
    if (!card.authorises) fail(402, "card_declined");
    const backer = (await one<PersonRow>(db, "SELECT id, name, email, kb_account_id FROM people WHERE id = $1", [pledge.backer_id])) as PersonRow;
    const accountId = await accountOf(db, backer);
    const attempt = pledge.fix_count + 1;
    const paymentId = await authorize(accountId, await cardMethod(accountId), `${pledge.id}-fix-${attempt}`, pledge.amount);
    if (pledge.fix_payment_id) await release(pledge.fix_payment_id, `${pledge.id}-fix-${pledge.fix_count}`);
    await db.query("UPDATE pledges SET fix_count = $2, fix_payment_id = $3, fix_card_last4 = $4, card_fixed = true WHERE id = $1",
      [pledge.id, attempt, paymentId, card.last4]);
    return { status: 200, json: fixView(await fixPledge(db, req.params[0])) };
  });
});
