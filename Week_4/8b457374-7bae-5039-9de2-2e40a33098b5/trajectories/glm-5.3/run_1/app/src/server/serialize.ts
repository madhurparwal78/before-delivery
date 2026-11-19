import type { Pool } from "pg";
import type { CampaignStatus, CardBehaviour, MediaKind, MediaStatus, PledgeState, Zone } from "../shared/domain.js";
import { campaignClosedForPledging } from "./states.js";
import { feesForAmount } from "../shared/money.js";

export interface SerializeContext {
  pool: Pool;
  now: () => Date;
}

export interface PersonView {
  id: string;
  name: string;
  email: string;
}

export interface TierView {
  id: string;
  title: string;
  description: string;
  price: number;
  quantity: number | null;
  claimed: number | null;
  remaining: number | null;
  shipping: { domestic: number; europe: number; rest_of_world: number };
}

export interface MediaView {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  content_type: string;
  bytes: number;
}

export interface StretchView {
  copies: number;
  amount: number;
  reached: boolean;
}

export interface CampaignView {
  id: string;
  title: string;
  story: string;
  status: string;
  pledging_open: boolean;
  creator: PersonView;
  goal: number;
  min_run_copies: number;
  stretch: StretchView[];
  ships_from: string;
  time_zone: string;
  deadline_local: string;
  deadline_utc: string;
  seconds_left: number | null;
  total: number;
  captured_total: number;
  backer_count: number;
  percent: number;
  media: MediaView[];
  tiers: TierView[];
}

export interface CampaignRowFull {
  id: string;
  creator_id: string;
  creator_name: string;
  creator_email: string;
  title: string;
  story: string;
  status: string;
  goal: number;
  min_run_copies: number;
  ships_from: string;
  time_zone: string;
  deadline_local: string;
  deadline_utc: Date;
  launched_at: Date | null;
}

export async function loadCampaign(
  pool: Pool,
  id: string,
): Promise<CampaignRowFull | null> {
  const result = await pool.query<CampaignRowFull>(
    `SELECT c.id, c.creator_id, p.name AS creator_name, p.email AS creator_email,
            c.title, c.story, c.status, c.goal, c.min_run_copies, c.ships_from,
            c.time_zone, c.deadline_local, c.deadline_utc, c.launched_at
     FROM campaigns c JOIN people p ON p.id = c.creator_id
     WHERE c.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function campaignView(
  ctx: SerializeContext,
  row: CampaignRowFull,
): Promise<CampaignView> {
  const { pool } = ctx;
  const now = ctx.now();

  const totals = await pool.query<{ total: string; captured_total: string; backer_count: string }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE state IN ('authorised','captured','errored')), 0) AS total,
       COALESCE(SUM(amount) FILTER (WHERE state = 'captured'), 0) AS captured_total,
       COUNT(*) FILTER (WHERE state IN ('authorised','captured','errored')) AS backer_count
     FROM pledges WHERE campaign_id = $1`,
    [row.id],
  );
  const total = Number(totals.rows[0]?.total ?? 0);
  const capturedTotal = Number(totals.rows[0]?.captured_total ?? 0);
  const backerCount = Number(totals.rows[0]?.backer_count ?? 0);

  const stretch = await pool.query<{ copies: number; amount: number }>(
    `SELECT copies, amount FROM stretch_breaks WHERE campaign_id = $1 ORDER BY position`,
    [row.id],
  );

  const media = await pool.query<{
    id: string;
    kind: MediaKind;
    status: MediaStatus;
    content_type: string;
    bytes: number;
  }>(
    `SELECT id, kind, status, content_type, bytes FROM media
     WHERE campaign_id = $1 ORDER BY created_at ASC`,
    [row.id],
  );

  const tiers = await pool.query<{
    id: string;
    title: string;
    description: string;
    price: number;
    quantity: number | null;
    shipping_domestic: number;
    shipping_europe: number;
    shipping_rest_of_world: number;
    claimed: string;
  }>(
    `SELECT t.id, t.title, t.description, t.price, t.quantity,
            t.shipping_domestic, t.shipping_europe, t.shipping_rest_of_world,
            COUNT(p.id) FILTER (WHERE p.state IN ('authorising','authorised','captured','errored')) AS claimed
     FROM tiers t LEFT JOIN pledges p ON p.tier_id = t.id
     WHERE t.campaign_id = $1
     GROUP BY t.id ORDER BY t.position ASC`,
    [row.id],
  );

  const status = row.status as CampaignStatus;
  const draft = status === "draft";
  const closed = campaignClosedForPledging(status);
  const pledgingOpen = !draft && !closed && row.deadline_utc.getTime() > now.getTime();

  return {
    id: row.id,
    title: row.title,
    story: row.story,
    status,
    pledging_open: pledgingOpen,
    creator: {
      id: row.creator_id,
      name: row.creator_name,
      email: row.creator_email,
    },
    goal: row.goal,
    min_run_copies: row.min_run_copies,
    stretch: stretch.rows.map((s) => ({
      copies: s.copies,
      amount: s.amount,
      reached: total >= s.amount,
    })),
    ships_from: row.ships_from,
    time_zone: row.time_zone,
    deadline_local: row.deadline_local,
    deadline_utc: row.deadline_utc.toISOString().replace(/\.\d{3}Z$/, "Z"),
    seconds_left: draft
      ? null
      : Math.max(0, Math.floor((row.deadline_utc.getTime() - now.getTime()) / 1000)),
    total,
    captured_total: capturedTotal,
    backer_count: backerCount,
    percent: Math.floor((100 * total) / row.goal),
    media: media.rows.map((m) => ({
      id: m.id,
      kind: m.kind,
      status: m.status,
      content_type: m.content_type,
      bytes: m.bytes,
    })),
    tiers: tiers.rows.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      price: t.price,
      quantity: t.quantity,
      claimed: t.quantity === null ? Number(t.claimed) : Math.min(Number(t.claimed), t.quantity),
      remaining: t.quantity === null ? null : t.quantity - Math.min(Number(t.claimed), t.quantity),
      shipping: {
        domestic: t.shipping_domestic,
        europe: t.shipping_europe,
        rest_of_world: t.shipping_rest_of_world,
      },
    })),
  };
}

export interface PledgeRowFull {
  id: string;
  campaign_id: string;
  tier_id: string;
  person_id: string;
  country: string;
  zone: Zone;
  reward: number;
  shipping: number;
  add_on: number;
  amount: number;
  state: PledgeState;
  card_last4: string;
  card_behaviour: CardBehaviour;
  replaces: string | null;
  created_at: Date;
  captured_at: Date | null;
  errored_at: Date | null;
  fix_deadline: Date | null;
  fix_count: number;
  card_fixed: boolean;
  kb_payment_id: string;
  kb_payment_method_id: string;
}

export interface PledgeView {
  id: string;
  campaign_id: string;
  tier_id: string;
  country: string;
  zone: Zone;
  reward: number;
  shipping: number;
  add_on: number;
  amount: number;
  state: PledgeState;
  card_last4: string;
  replaces: string | null;
  created_at: string;
  history: { state: PledgeState; at: string }[];
  statement: "none" | "pending" | "ready";
  fees: { platform_fee: number; processing_fee: number; to_creator: number } | null;
  fix_deadline_utc: string | null;
  fix_seconds_left: number | null;
  card_fixed: boolean | null;
  fix_code: string | null;
}

export async function pledgeView(
  ctx: SerializeContext,
  pledge: PledgeRowFull,
): Promise<PledgeView> {
  const { pool, now } = ctx;
  const history = await pool.query<{ state: PledgeState; at: Date }>(
    `SELECT state, at FROM pledge_history WHERE pledge_id = $1 ORDER BY at ASC`,
    [pledge.id],
  );
  const statement = await pool.query<{ status: string }>(
    `SELECT status FROM statements WHERE pledge_id = $1`,
    [pledge.id],
  );
  const fixCode = await pool.query<{ code: string }>(
    `SELECT code FROM fix_codes WHERE pledge_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [pledge.id],
  );
  const showFixFields = pledge.state === "errored" || pledge.fix_deadline !== null;
  return {
    id: pledge.id,
    campaign_id: pledge.campaign_id,
    tier_id: pledge.tier_id,
    country: pledge.country,
    zone: pledge.zone,
    reward: pledge.reward,
    shipping: pledge.shipping,
    add_on: pledge.add_on,
    amount: pledge.amount,
    state: pledge.state,
    card_last4: pledge.card_last4,
    replaces: pledge.replaces,
    created_at: pledge.created_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
    history: history.rows.map((h) => ({
      state: h.state,
      at: h.at.toISOString().replace(/\.\d{3}Z$/, "Z"),
    })),
    statement: (statement.rows[0]?.status as PledgeView["statement"]) ?? "none",
    fees: pledge.state === "captured" ? feesForAmount(pledge.amount) : null,
    fix_deadline_utc: showFixFields
      ? (pledge.fix_deadline?.toISOString().replace(/\.\d{3}Z$/, "Z") ?? null)
      : null,
    fix_seconds_left: showFixFields
      ? pledge.fix_deadline === null
        ? null
        : Math.max(0, Math.floor((pledge.fix_deadline.getTime() - now().getTime()) / 1000))
      : null,
    card_fixed: showFixFields ? pledge.card_fixed : null,
    fix_code: fixCode.rows[0]?.code ?? null,
  };
}
