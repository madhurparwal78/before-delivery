import type { CampaignStatus, PledgeState } from "../shared/api.js";
import { config, MAX_CAMPAIGN_SECONDS } from "./config.js";
import type { Db } from "./db.js";
import { fail, invalid } from "./http.js";
import { iso } from "./time.js";

// Every campaign status and pledge state change, and every refusal tied to state, is decided here
// (brief: Business rules › Campaign states, Pledge states, Server time decides).

const CAMPAIGN_MOVES: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["live"],
  live: ["funded", "unfunded", "cancelled"],
  funded: ["collecting"],
  collecting: ["settled"],
  settled: [],
  unfunded: [],
  cancelled: [],
};

const PLEDGE_MOVES: Record<PledgeState, PledgeState[]> = {
  authorising: ["authorised"],
  authorised: ["voided", "captured", "errored"],
  errored: ["captured", "dropped"],
  captured: [],
  voided: [],
  dropped: [],
};

/** States that hold the backer's one pledge, claim a limited copy and (bar authorising) count toward the total. */
export const ACTIVE_STATES: PledgeState[] = ["authorising", "authorised", "captured", "errored"];
export const COUNTED_STATES: PledgeState[] = ["authorised", "captured", "errored"];

interface CampaignState {
  id: string;
  status: CampaignStatus;
  deadline_utc: Date;
}

interface PledgeStateRow {
  id: string;
  state: PledgeState;
}

async function moveCampaign(db: Db, campaign: CampaignState, to: CampaignStatus): Promise<void> {
  if (!CAMPAIGN_MOVES[campaign.status].includes(to)) throw new Error(`campaign ${campaign.status} -> ${to} is not a transition`);
  await db.query("UPDATE campaigns SET status = $1 WHERE id = $2", [to, campaign.id]);
  campaign.status = to;
}

/** Applies a pledge transition, appending it to the history; `also` sets other columns in the same write. */
export async function movePledge(db: Db, pledge: PledgeStateRow, to: PledgeState, also: Record<string, unknown> = {}): Promise<void> {
  if (!PLEDGE_MOVES[pledge.state].includes(to)) throw new Error(`pledge ${pledge.state} -> ${to} is not a transition`);
  const columns = Object.keys(also);
  const sets = columns.map((column, n) => `${column} = $${n + 4}`);
  await db.query(
    `UPDATE pledges SET state = $1, history = history || jsonb_build_array(jsonb_build_object('state', $1::text, 'at', $2::text))${sets.length ? `, ${sets.join(", ")}` : ""} WHERE id = $3`,
    [to, iso(Date.now()), pledge.id, ...columns.map((column) => also[column])],
  );
  pledge.state = to;
}

/** The claim: a new pledge starts as authorising, holding its copy before any Kill Bill call. */
export async function claimPledge(db: Db, values: Record<string, unknown>): Promise<PledgeStateRow & { created_at: Date }> {
  const created = new Date();
  const columns = [...Object.keys(values), "state", "history", "created_at"];
  const params = [...Object.values(values), "authorising", JSON.stringify([{ state: "authorising", at: iso(created.getTime()) }]), created];
  await db.query(`INSERT INTO pledges (${columns.join(", ")}) VALUES (${columns.map((_, n) => `$${n + 1}`).join(", ")})`, params);
  return { id: String(values.id), state: "authorising", created_at: created };
}

export function pledgingOpen(campaign: CampaignState, now = Date.now()): boolean {
  return campaign.status === "live" && now < campaign.deadline_utc.getTime();
}

export function requireDraft(campaign: CampaignState): void {
  if (campaign.status !== "draft") fail(409, "campaign_not_draft");
}

export function requirePledgingOpen(campaign: CampaignState): void {
  if (!pledgingOpen(campaign)) fail(409, "campaign_closed");
}

/** Settlements exist only for funded runs. */
export function requireFunded(campaign: CampaignState): void {
  if (campaign.status !== "funded" && campaign.status !== "collecting" && campaign.status !== "settled") fail(409, "not_funded");
}

/** A fix is accepted only for an errored pledge before its fix window ends. */
export function requireFixable(pledge: PledgeStateRow & { fix_deadline_utc: Date | null }): void {
  if (pledge.state !== "errored" || (pledge.fix_deadline_utc as Date).getTime() <= Date.now()) fail(409, "fix_window_closed");
}

export function requireActive(pledge: PledgeStateRow): void {
  if (pledge.state !== "authorised") fail(409, "pledge_not_active");
}

/** In the final window a reduction may not take a funded campaign below its goal. */
export function requireStillFunded(campaign: CampaignState & { goal: number }, total: number, change: number): void {
  const inFinalWindow = campaign.deadline_utc.getTime() - Date.now() <= config.finalWindowSeconds * 1000;
  if (inFinalWindow && change < 0 && total >= campaign.goal && total + change < campaign.goal) fail(409, "would_unfund");
}

interface LaunchFacts {
  mediaStatuses: string[];
  storedCovers: number;
  tierCount: number;
}

/** draft -> live under the launch gate (brief: Launch gate). */
export async function launch(db: Db, campaign: CampaignState, facts: LaunchFacts): Promise<void> {
  requireDraft(campaign);
  if (facts.mediaStatuses.some((status) => status !== "stored")) fail(409, "media_not_stored");
  const errors: Record<string, string> = {};
  if (facts.storedCovers !== 1) errors.cover = "Add a cover image.";
  if (facts.tierCount < 1) errors.tiers = "Add at least one tier.";
  const lead = (campaign.deadline_utc.getTime() - Date.now()) / 1000;
  if (lead < config.minCampaignSeconds || lead > MAX_CAMPAIGN_SECONDS) {
    errors.deadline_local = "Pick a deadline at least a day and at most 60 days away.";
  }
  if (Object.keys(errors).length) invalid(errors);
  await moveCampaign(db, campaign, "live");
}

/** live -> cancelled by the creator, before the deadline only, and only while Kill Bill can release the holds. */
export async function cancelCampaign(db: Db, campaign: CampaignState, paymentsReachable: () => Promise<void>): Promise<void> {
  if (campaign.status !== "live") fail(409, "not_live");
  if (!pledgingOpen(campaign)) fail(409, "campaign_closed");
  await paymentsReachable();
  await moveCampaign(db, campaign, "cancelled");
}

/** live -> funded or unfunded at the deadline instant, by the total of confirmed holds; anything else is left alone. */
export async function closeCampaign(db: Db, campaign: CampaignState & { goal: number }, total: number): Promise<void> {
  if (campaign.status !== "live" || pledgingOpen(campaign)) return;
  await moveCampaign(db, campaign, total >= campaign.goal ? "funded" : "unfunded");
}

/** funded -> collecting once no pledge is still authorised; collecting -> settled once none is errored. */
export async function advanceCollection(db: Db, campaign: CampaignState, authorised: number, errored: number): Promise<boolean> {
  if (campaign.status === "funded" && authorised === 0) await moveCampaign(db, campaign, "collecting");
  if (campaign.status === "collecting" && errored === 0) {
    await moveCampaign(db, campaign, "settled");
    return true;
  }
  return false;
}
