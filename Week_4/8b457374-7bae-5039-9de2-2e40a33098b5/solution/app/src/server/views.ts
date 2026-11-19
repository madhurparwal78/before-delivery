import type {
  Campaign, CampaignRow, CampaignStatus, DocumentStatus, Media, MediaKind, MediaStatus, OwnPledge, Pledge, PledgeState, Tier, Zone,
} from "../shared/api.js";
import { one, rows, type Db } from "./db.js";
import { notFound } from "./http.js";
import type { PersonRow } from "./people.js";
import { fees, percentOf } from "./rules.js";
import { iso } from "./time.js";
import { ACTIVE_STATES, COUNTED_STATES, pledgingOpen } from "./transitions.js";

// Database records and the API objects built from them. Derived values (totals, claims, percent,
// seconds left, fees) are computed at read time, never stored.

export interface CampaignRecord {
  id: string;
  creator_id: string;
  creator_name: string;
  creator_email: string;
  title: string;
  story: string;
  status: CampaignStatus;
  goal: number;
  min_run_copies: number;
  stretch: { copies: number; amount: number }[];
  ships_from: string;
  time_zone: string;
  deadline_local: string;
  deadline_utc: Date;
}

export interface TierRecord {
  id: string;
  campaign_id: string;
  title: string;
  description: string;
  price: number;
  quantity: number | null;
  ship_domestic: number;
  ship_europe: number;
  ship_rest_of_world: number;
  claimed: number;
}

export interface MediaRecord {
  id: string;
  campaign_id: string;
  kind: MediaKind;
  status: MediaStatus;
  content_type: string;
  bytes: number;
  object_key: string;
}

export interface PledgeRecord {
  id: string;
  campaign_id: string;
  backer_id: string;
  tier_id: string;
  country: string;
  zone: Zone;
  reward: number;
  shipping: number;
  add_on: number;
  amount: number;
  state: PledgeState;
  card_last4: string;
  kb_payment_method_id: string | null;
  kb_payment_id: string | null;
  replaces: string | null;
  history: { state: PledgeState; at: string }[];
  fix_code: string | null;
  fix_deadline_utc: Date | null;
  next_fix_notice_at: Date | null;
  fix_count: number;
  fix_payment_id: string | null;
  fix_card_last4: string | null;
  card_fixed: boolean | null;
  created_at: Date;
  statement: DocumentStatus;
}

const CAMPAIGN_SELECT = `SELECT c.id, c.creator_id, p.name AS creator_name, p.email AS creator_email, c.title, c.story, c.status,
  c.goal, c.min_run_copies, c.stretch, c.ships_from, c.time_zone, c.deadline_local, c.deadline_utc
  FROM campaigns c JOIN people p ON p.id = c.creator_id`;

export async function loadCampaign(db: Db, id: string, lock = false): Promise<CampaignRecord | undefined> {
  return one<CampaignRecord>(db, `${CAMPAIGN_SELECT} WHERE c.id = $1${lock ? " FOR UPDATE OF c" : ""}`, [id]);
}

/** A campaign the caller may see: a draft only for its creator, everything else for anyone. */
export async function visibleCampaign(db: Db, id: string, viewer: PersonRow | null, lock = false): Promise<CampaignRecord> {
  const found = await loadCampaign(db, id, lock);
  if (!found || (found.status === "draft" && found.creator_id !== viewer?.id)) notFound();
  return found;
}

/** A campaign the caller created; anyone else gets the not-found answer. */
export async function ownCampaign(db: Db, id: string, person: PersonRow, lock = false): Promise<CampaignRecord> {
  const found = await loadCampaign(db, id, lock);
  if (!found || found.creator_id !== person.id) notFound();
  return found;
}

interface Totals {
  total: number;
  captured_total: number;
  backer_count: number;
}

export async function campaignTotals(db: Db, campaignId: string): Promise<Totals> {
  const found = await one<Totals>(db, `SELECT
      coalesce(sum(amount) FILTER (WHERE state = ANY($2)), 0)::bigint AS total,
      coalesce(sum(amount) FILTER (WHERE state = 'captured'), 0)::bigint AS captured_total,
      count(*) FILTER (WHERE state = ANY($2))::bigint AS backer_count
    FROM pledges WHERE campaign_id = $1`, [campaignId, COUNTED_STATES]);
  return found ?? { total: 0, captured_total: 0, backer_count: 0 };
}

export async function campaignTiers(db: Db, campaignId: string): Promise<TierRecord[]> {
  return rows<TierRecord>(db, `SELECT t.*, (SELECT count(*) FROM pledges p WHERE p.tier_id = t.id AND p.state = ANY($2))::bigint AS claimed
    FROM tiers t WHERE t.campaign_id = $1 ORDER BY t.created_at, t.id`, [campaignId, ACTIVE_STATES]);
}

export async function campaignMedia(db: Db, campaignId: string): Promise<MediaRecord[]> {
  return rows<MediaRecord>(db, "SELECT * FROM media WHERE campaign_id = $1 ORDER BY (kind = 'cover') DESC, created_at, id", [campaignId]);
}

export function tierView(t: TierRecord): Tier {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    price: t.price,
    quantity: t.quantity,
    claimed: t.claimed,
    remaining: t.quantity === null ? null : t.quantity - t.claimed,
    shipping: { domestic: t.ship_domestic, europe: t.ship_europe, rest_of_world: t.ship_rest_of_world },
  };
}

function mediaView(m: MediaRecord): Media {
  return { id: m.id, kind: m.kind, status: m.status, content_type: m.content_type, bytes: m.bytes };
}

function secondsLeft(c: CampaignRecord): number | null {
  if (c.status === "draft") return null;
  return pledgingOpen(c) ? Math.ceil((c.deadline_utc.getTime() - Date.now()) / 1000) : 0;
}

export async function campaignView(db: Db, c: CampaignRecord): Promise<Campaign> {
  // One client runs one query at a time, so these stay sequential inside a transaction.
  const totals = await campaignTotals(db, c.id);
  const tiers = await campaignTiers(db, c.id);
  const media = await campaignMedia(db, c.id);
  return {
    id: c.id,
    title: c.title,
    story: c.story,
    status: c.status,
    pledging_open: pledgingOpen(c),
    creator: { id: c.creator_id, name: c.creator_name },
    goal: c.goal,
    min_run_copies: c.min_run_copies,
    stretch: c.stretch.map((s) => ({ copies: s.copies, amount: s.amount, reached: totals.total >= s.amount })),
    ships_from: c.ships_from,
    time_zone: c.time_zone,
    deadline_local: c.deadline_local,
    deadline_utc: iso(c.deadline_utc.getTime()),
    seconds_left: secondsLeft(c),
    total: totals.total,
    captured_total: totals.captured_total,
    backer_count: totals.backer_count,
    percent: percentOf(totals.total, c.goal),
    media: media.map(mediaView),
    tiers: tiers.map(tierView),
  };
}

const CLOSED_ORDER = `ORDER BY (c.status = 'live') DESC,
  CASE WHEN c.status = 'live' THEN c.deadline_utc END ASC, CASE WHEN c.status <> 'live' THEN c.deadline_utc END DESC`;

export async function campaignRows(db: Db, where: string, params: unknown[], order = CLOSED_ORDER): Promise<CampaignRow[]> {
  const found = await rows<CampaignRecord & { total: number; cover_media_id: string | null }>(db, `${CAMPAIGN_SELECT.replace(
    "FROM campaigns c",
    `, (SELECT coalesce(sum(x.amount), 0) FROM pledges x WHERE x.campaign_id = c.id AND x.state = ANY('{${COUNTED_STATES.join(",")}}'))::bigint AS total,
       (SELECT m.id FROM media m WHERE m.campaign_id = c.id AND m.kind = 'cover' AND m.status = 'stored' ORDER BY m.created_at DESC LIMIT 1) AS cover_media_id
     FROM campaigns c`,
  )} WHERE ${where} ${order}`, params);
  return found.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    total: c.total,
    goal: c.goal,
    percent: percentOf(c.total, c.goal),
    pledging_open: pledgingOpen(c),
    cover_media_id: c.cover_media_id,
  }));
}

export const PLEDGE_SELECT = `SELECT p.*, coalesce(d.status, 'none') AS statement
  FROM pledges p LEFT JOIN documents d ON d.id = 'statement:' || p.id`;

export function pledgeView(p: PledgeRecord): Pledge {
  const fixDeadline = p.fix_deadline_utc?.getTime() ?? null;
  return {
    id: p.id,
    campaign_id: p.campaign_id,
    tier_id: p.tier_id,
    country: p.country,
    zone: p.zone,
    reward: p.reward,
    shipping: p.shipping,
    add_on: p.add_on,
    amount: p.amount,
    state: p.state,
    card_last4: p.card_last4,
    replaces: p.replaces,
    created_at: iso(p.created_at.getTime()),
    history: p.history,
    statement: p.state === "captured" ? p.statement : "none",
    fees: p.state === "captured" ? fees(p.amount) : null,
    fix_deadline_utc: fixDeadline === null ? null : iso(fixDeadline),
    fix_seconds_left: fixDeadline === null ? null : Math.max(0, Math.ceil((fixDeadline - Date.now()) / 1000)),
    card_fixed: fixDeadline === null ? null : Boolean(p.card_fixed),
  };
}

export function ownPledgeView(p: PledgeRecord): OwnPledge {
  return { ...pledgeView(p), fix_code: p.fix_code };
}
