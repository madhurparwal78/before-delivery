import type { Settlement } from "../shared/api.js";
import { countryOf } from "../shared/countries.js";
import { one, pool, rows, tx, type Db } from "./db.js";
import { fail, invalid, notFound, route } from "./http.js";
import { releaseHolds } from "./closeout.js";
import { bearer, newId, requirePerson, type PersonRow } from "./people.js";
import { probe as probePayments } from "./killbill.js";
import { fees } from "./rules.js";
import { unreachable } from "./status.js";
import { deleteObject, getObject, putConfirmed } from "./storage.js";
import { isTimeZone, iso, localText, parseLocal, zonedInstant } from "./time.js";
import { cancelCampaign, launch, requireDraft, requireFunded } from "./transitions.js";
import {
  campaignMedia, campaignRows, campaignTiers, campaignView, ownCampaign, PLEDGE_SELECT, pledgeView, tierView, visibleCampaign,
  type CampaignRecord, type MediaRecord, type PledgeRecord, type TierRecord,
} from "./views.js";

// Campaigns, tiers and media (brief: API › Campaigns; DP-02 to DP-10, DP-35, DP-45, DP-46).

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const length = (v: string) => [...v].length;

interface CampaignFields {
  title: string;
  story: string;
  goal: number;
  min_run_copies: number;
  stretch: { copies: number; amount: number }[];
  ships_from: string;
  time_zone: string;
  deadline_local: string;
  deadline_utc: Date;
}

/** Validates a full set of draft fields (a PATCH merges its subset over the saved draft first). */
function campaignFields(input: Record<string, unknown>): CampaignFields {
  const errors: Record<string, string> = {};
  const { title, story, goal, min_run_copies: minRun, stretch, ships_from: shipsFrom, time_zone: zone, deadline_local: local } = input;
  if (typeof title !== "string" || length(title.trim()) < 1 || length(title) > 120) errors.title = "Enter a title of up to 120 characters.";
  if (typeof story !== "string" || length(story) > 20_000) errors.story = "Keep the story under 20,000 characters.";
  if (!isInt(goal) || goal < 10_000 || goal > 10_000_000) errors.goal = "Enter a goal from £100.00 to £100,000.00.";
  if (!isInt(minRun) || minRun < 10 || minRun > 100_000) errors.min_run_copies = "Enter a minimum run from 10 to 100,000 copies.";
  if (!Array.isArray(stretch) || stretch.length > 3) {
    errors.stretch = "Add at most three break points.";
  } else {
    let copies = isInt(minRun) ? minRun : 0;
    let amount = isInt(goal) ? goal : 0;
    for (const point of stretch as unknown[]) {
      const p = (typeof point === "object" && point !== null ? point : {}) as Record<string, unknown>;
      if (!isInt(p.copies) || !isInt(p.amount) || p.copies <= copies || p.amount <= amount) {
        errors.stretch = "Each break point needs more copies and a larger amount than the one before it.";
        break;
      }
      copies = p.copies;
      amount = p.amount;
    }
  }
  if (!countryOf(shipsFrom)) errors.ships_from = "Choose a country from the list.";
  if (!isTimeZone(zone)) errors.time_zone = "Choose a time zone from the list.";
  const parsed = parseLocal(local);
  const instant = parsed && isTimeZone(zone) ? zonedInstant(parsed, zone) : null;
  if (!parsed) errors.deadline_local = "Enter the deadline as YYYY-MM-DD HH:MM.";
  else if (isTimeZone(zone) && instant === null) errors.deadline_local = "That local time does not exist in this time zone.";
  if (Object.keys(errors).length || !parsed || instant === null) invalid(errors);
  return {
    title: title as string,
    story: story as string,
    goal: goal as number,
    min_run_copies: minRun as number,
    stretch: (stretch as { copies: number; amount: number }[]).map((s) => ({ copies: s.copies, amount: s.amount })),
    ships_from: shipsFrom as string,
    time_zone: zone as string,
    deadline_local: localText(parsed),
    deadline_utc: new Date(instant),
  };
}

const EDITABLE = ["title", "story", "goal", "min_run_copies", "stretch", "ships_from", "time_zone", "deadline_local"] as const;

function picked(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(EDITABLE.filter((k) => k in body).map((k) => [k, body[k]]));
}

route("GET", "/api/campaigns", async () => ({ status: 200, json: await campaignRows(pool, "c.status <> 'draft'", []) }));

route("GET", "/api/me/campaigns", async (req) => {
  const me = await requirePerson(req);
  return { status: 200, json: await campaignRows(pool, "c.creator_id = $1", [me.id], "ORDER BY c.created_at DESC, c.id") };
});

route("POST", "/api/campaigns", async (req) => {
  const me = await requirePerson(req);
  const f = campaignFields({ story: "", stretch: [], ...picked(req.json) });
  const id = newId();
  await pool.query(
    `INSERT INTO campaigns (id, creator_id, title, story, status, goal, min_run_copies, stretch, ships_from, time_zone, deadline_local, deadline_utc, created_at)
     VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, me.id, f.title, f.story, f.goal, f.min_run_copies, JSON.stringify(f.stretch), f.ships_from, f.time_zone, f.deadline_local, f.deadline_utc, new Date()],
  );
  return { status: 201, json: await campaignView(pool, await visibleCampaign(pool, id, me)) };
});

route("GET", "/api/campaigns/:id", async (req) => {
  const found = await visibleCampaign(pool, req.params[0], await bearer(req));
  return { status: 200, json: await campaignView(pool, found) };
});

route("PATCH", "/api/campaigns/:id", async (req) => {
  const me = await requirePerson(req);
  return tx(async (db) => {
    const c = await ownCampaign(db, req.params[0], me, true);
    requireDraft(c);
    const f = campaignFields({ ...c, deadline_local: c.deadline_local, ...picked(req.json) });
    await db.query(
      `UPDATE campaigns SET title = $2, story = $3, goal = $4, min_run_copies = $5, stretch = $6, ships_from = $7, time_zone = $8,
       deadline_local = $9, deadline_utc = $10 WHERE id = $1`,
      [c.id, f.title, f.story, f.goal, f.min_run_copies, JSON.stringify(f.stretch), f.ships_from, f.time_zone, f.deadline_local, f.deadline_utc],
    );
    return { status: 200, json: await campaignView(db, await visibleCampaign(db, c.id, me)) };
  });
});

// Tiers

interface TierFields {
  title: string;
  description: string;
  price: number;
  quantity: number | null;
  ship_domestic: number;
  ship_europe: number;
  ship_rest_of_world: number;
}

function tierFields(input: Record<string, unknown>): TierFields {
  const errors: Record<string, string> = {};
  const { title, description, price, quantity } = input;
  if (typeof title !== "string" || length(title.trim()) < 1 || length(title) > 80) errors.title = "Enter a tier title of up to 80 characters.";
  if (typeof description !== "string" || length(description) > 1000) errors.description = "Keep the description under 1,000 characters.";
  if (!isInt(price) || price < 100 || price > 1_000_000) errors.price = "Enter a price from £1.00 to £10,000.00.";
  if (quantity !== null && (!isInt(quantity) || quantity < 1 || quantity > 100_000)) errors.quantity = "Enter from 1 to 100,000 copies, or leave it blank.";
  const shipping = (typeof input.shipping === "object" && input.shipping !== null ? input.shipping : {}) as Record<string, unknown>;
  for (const zone of ["domestic", "europe", "rest_of_world"]) {
    const value = shipping[zone];
    if (!isInt(value) || value < 0 || value > 10_000) errors[`shipping.${zone}`] = "Enter shipping from £0.00 to £100.00.";
  }
  if (Object.keys(errors).length) invalid(errors);
  return {
    title: title as string,
    description: description as string,
    price: price as number,
    quantity: quantity as number | null,
    ship_domestic: shipping.domestic as number,
    ship_europe: shipping.europe as number,
    ship_rest_of_world: shipping.rest_of_world as number,
  };
}

async function ownTier(db: Db, tierId: string, me: PersonRow): Promise<{ tier: TierRecord; campaign: CampaignRecord }> {
  const tier = await one<TierRecord>(db, "SELECT *, 0 AS claimed FROM tiers WHERE id = $1", [tierId]);
  if (!tier) notFound();
  return { tier, campaign: await ownCampaign(db, tier.campaign_id, me, true) };
}

async function tierReply(db: Db, campaignId: string, tierId: string, status: number) {
  const tier = (await campaignTiers(db, campaignId)).find((t) => t.id === tierId);
  return { status, json: tier ? tierView(tier) : undefined };
}

route("POST", "/api/campaigns/:id/tiers", async (req) => {
  const me = await requirePerson(req);
  return tx(async (db) => {
    const c = await ownCampaign(db, req.params[0], me, true);
    requireDraft(c);
    const count = (await campaignTiers(db, c.id)).length;
    const f = tierFields({ description: "", quantity: null, ...req.json });
    if (count >= 8) invalid({ tiers: "A campaign holds at most eight tiers." });
    const id = newId();
    await db.query(
      `INSERT INTO tiers (id, campaign_id, title, description, price, quantity, ship_domestic, ship_europe, ship_rest_of_world, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, c.id, f.title, f.description, f.price, f.quantity, f.ship_domestic, f.ship_europe, f.ship_rest_of_world, new Date()],
    );
    return tierReply(db, c.id, id, 201);
  });
});

route("PATCH", "/api/tiers/:id", async (req) => {
  const me = await requirePerson(req);
  return tx(async (db) => {
    const { tier, campaign } = await ownTier(db, req.params[0], me);
    requireDraft(campaign);
    const current = tierView({ ...tier, claimed: 0 });
    const f = tierFields({ ...current, ...req.json, shipping: { ...current.shipping, ...(req.json.shipping as object | undefined) } });
    await db.query(
      `UPDATE tiers SET title = $2, description = $3, price = $4, quantity = $5, ship_domestic = $6, ship_europe = $7, ship_rest_of_world = $8 WHERE id = $1`,
      [tier.id, f.title, f.description, f.price, f.quantity, f.ship_domestic, f.ship_europe, f.ship_rest_of_world],
    );
    return tierReply(db, campaign.id, tier.id, 200);
  });
});

route("DELETE", "/api/tiers/:id", async (req) => {
  const me = await requirePerson(req);
  return tx(async (db) => {
    const { tier, campaign } = await ownTier(db, req.params[0], me);
    requireDraft(campaign);
    await db.query("DELETE FROM tiers WHERE id = $1", [tier.id]);
    return { status: 204 };
  });
});

// Media

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Uploads one image row's bytes; the row becomes stored only once the bucket confirms the object. */
export async function storeMedia(media: MediaRecord, data: Buffer): Promise<boolean> {
  try {
    await putConfirmed(media.object_key, data, media.content_type);
  } catch {
    unreachable("storage");
    await pool.query("UPDATE media SET status = 'failed' WHERE id = $1", [media.id]);
    return false;
  }
  await pool.query("UPDATE media SET status = 'stored' WHERE id = $1", [media.id]);
  return true;
}

export async function insertMedia(db: Db, campaignId: string, kind: string, type: string, bytes: number, id = newId()): Promise<MediaRecord> {
  const media: MediaRecord = {
    id, campaign_id: campaignId, kind: kind as MediaRecord["kind"], status: "uploading", content_type: type, bytes,
    object_key: `campaigns/${campaignId}/media/${id}.${EXTENSIONS[type]}`,
  };
  await db.query(
    "INSERT INTO media (id, campaign_id, kind, status, content_type, bytes, object_key, created_at) VALUES ($1, $2, $3, 'uploading', $4, $5, $6, $7)",
    [media.id, campaignId, media.kind, type, bytes, media.object_key, new Date()],
  );
  return media;
}

route("POST", "/api/campaigns/:id/media", async (req) => {
  const me = await requirePerson(req);
  const type = String(req.headers["content-type"]).split(";")[0].trim().toLowerCase();
  const kind = req.query.get("kind");
  const media = await tx(async (db) => {
    const c = await ownCampaign(db, req.params[0], me, true);
    requireDraft(c);
    if (kind !== "cover" && kind !== "spread") invalid({ kind: "Choose cover or spread." });
    if (!req.bytes.length) invalid({ media: "The image is empty." });
    const spreads = (await campaignMedia(db, c.id)).filter((m) => m.kind === "spread").length;
    if (kind === "spread" && spreads >= 6) invalid({ media: "A campaign holds at most six spreads." });
    return insertMedia(db, c.id, kind, type, req.bytes.length);
  });
  if (!(await storeMedia(media, req.bytes))) fail(503, "storage_unavailable");
  if (media.kind === "cover") {
    const replaced = await rows<MediaRecord>(pool, "DELETE FROM media WHERE campaign_id = $1 AND kind = 'cover' AND id <> $2 RETURNING *", [media.campaign_id, media.id]);
    await Promise.all(replaced.filter((m) => m.status === "stored").map((m) => deleteObject(m.object_key).catch(() => undefined)));
  }
  return { status: 201, json: { id: media.id, kind: media.kind, status: "stored", content_type: media.content_type, bytes: media.bytes } };
}, "image");

async function mediaRecord(id: string): Promise<MediaRecord> {
  return (await one<MediaRecord>(pool, "SELECT * FROM media WHERE id = $1", [id])) ?? notFound();
}

route("DELETE", "/api/media/:id", async (req) => {
  const me = await requirePerson(req);
  const media = await mediaRecord(req.params[0]);
  const c = await ownCampaign(pool, media.campaign_id, me);
  requireDraft(c);
  await pool.query("DELETE FROM media WHERE id = $1", [media.id]);
  if (media.status === "stored") await deleteObject(media.object_key).catch(() => undefined);
  return { status: 204 };
});

route("GET", "/api/media/:id", async (req) => {
  const media = await mediaRecord(req.params[0]);
  await visibleCampaign(pool, media.campaign_id, await bearer(req));
  if (media.status !== "stored") notFound();
  return { status: 200, data: await getObject(media.object_key).catch(() => fail(503, "storage_unavailable")), type: media.content_type };
});

// Lifecycle

route("POST", "/api/campaigns/:id/launch", async (req) => {
  const me = await requirePerson(req);
  return tx(async (db) => {
    const c = await ownCampaign(db, req.params[0], me, true);
    const media = await campaignMedia(db, c.id);
    await launch(db, c, {
      mediaStatuses: media.map((m) => m.status),
      storedCovers: media.filter((m) => m.kind === "cover" && m.status === "stored").length,
      tierCount: (await campaignTiers(db, c.id)).length,
    });
    return { status: 200, json: await campaignView(db, c) };
  });
});

route("POST", "/api/campaigns/:id/cancel", async (req) => {
  const me = await requirePerson(req);
  const cancelled = await tx(async (db) => {
    const c = await ownCampaign(db, req.params[0], me, true);
    await cancelCampaign(db, c, probePayments);
    return c;
  });
  await releaseHolds(cancelled.id).catch(() => undefined);
  return { status: 200, json: await campaignView(pool, cancelled) };
});

route("GET", "/api/campaigns/:id/pledges", async (req) => {
  const me = await requirePerson(req);
  const c = await ownCampaign(pool, req.params[0], me);
  const found = await rows<PledgeRecord & { backer_name: string; backer_email: string }>(pool,
    `${PLEDGE_SELECT.replace("FROM pledges p", ", b.name AS backer_name, b.email AS backer_email FROM pledges p JOIN people b ON b.id = p.backer_id")}
     WHERE p.campaign_id = $1 ORDER BY p.created_at DESC, p.id`, [c.id]);
  return { status: 200, json: found.map((p) => ({ ...pledgeView(p), backer: { id: p.backer_id, name: p.backer_name, email: p.backer_email } })) };
});

interface NoticeLedgerRow {
  kind: string;
  to_email: string;
  subject: string;
  status: "queued" | "sent";
  created_at: Date;
  sent_at: Date | null;
}

route("GET", "/api/campaigns/:id/notices", async (req) => {
  const me = await requirePerson(req);
  const c = await ownCampaign(pool, req.params[0], me);
  const found = await rows<NoticeLedgerRow>(pool,
    "SELECT kind, to_email, subject, status, created_at, sent_at FROM notices WHERE campaign_id = $1 ORDER BY created_at, id", [c.id]);
  return {
    status: 200,
    json: found.map((n) => ({
      kind: n.kind, to: n.to_email, subject: n.subject, status: n.status,
      created_at: iso(n.created_at.getTime()), sent_at: n.sent_at ? iso(n.sent_at.getTime()) : null,
    })),
  };
});

// Settlement (DP-45, DP-46)

route("GET", "/api/campaigns/:id/settlement", async (req) => {
  const me = await requirePerson(req);
  const c = await ownCampaign(pool, req.params[0], me);
  requireFunded(c);
  const pledges = await rows<{ id: string; amount: number; state: string }>(pool,
    "SELECT id, amount, state FROM pledges WHERE campaign_id = $1 ORDER BY created_at, id", [c.id]);
  const lines = pledges.filter((p) => p.state === "captured").map((p) => ({ pledge_id: p.id, amount: p.amount, ...fees(p.amount) }));
  const sum = (pick: (l: (typeof lines)[number]) => number) => lines.reduce((total, l) => total + pick(l), 0);
  const pdf = await one<{ status: "pending" | "ready" }>(pool, "SELECT status FROM documents WHERE id = $1", [`settlement:${c.id}`]);
  const sheet: Settlement = {
    campaign_id: c.id,
    status: c.status,
    captured_count: lines.length,
    dropped_count: pledges.filter((p) => p.state === "dropped").length,
    errored_count: pledges.filter((p) => p.state === "errored").length,
    gross: sum((l) => l.amount),
    platform_fee: sum((l) => l.platform_fee),
    processing_fee: sum((l) => l.processing_fee),
    net: sum((l) => l.to_creator),
    lines,
    pdf: pdf?.status ?? "none",
  };
  return { status: 200, json: sheet };
});

route("GET", "/api/campaigns/:id/settlement.pdf", async (req) => {
  const me = await requirePerson(req);
  const c = await ownCampaign(pool, req.params[0], me);
  return documentReply(`settlement:${c.id}`, `settlement-${c.id}.pdf`);
});

export async function documentReply(documentId: string, filename: string) {
  const doc = await one<{ status: string; object_key: string }>(pool, "SELECT status, object_key FROM documents WHERE id = $1", [documentId]);
  if (doc?.status !== "ready") fail(409, "not_ready");
  return { status: 200, data: await getObject(doc.object_key).catch(() => fail(503, "storage_unavailable")), type: "application/pdf", filename };
}
