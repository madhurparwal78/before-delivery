import { randomBytes } from "node:crypto";
import type { PledgeState } from "../shared/api.js";
import { capturesOn } from "./cards.js";
import { config } from "./config.js";
import { pool, rows, tx, type Db } from "./db.js";
import { queueSettlement, queueStatement } from "./documents.js";
import { ApiError, describe } from "./http.js";
import { capture, release } from "./killbill.js";
import { recordNotice, type NoticeKind } from "./notices.js";
import { advanceCollection, closeCampaign, movePledge } from "./transitions.js";
import { campaignTotals, loadCampaign, PLEDGE_SELECT, type CampaignRecord, type PledgeRecord } from "./views.js";

// The server's own clock closes campaigns (brief: Close-out, Fix window). A 1 s tick closes due campaigns
// within 5 s of their deadline; each step locks the campaign row before its pledge (the order requests use); Kill Bill work that finds the service unreachable waits 10 s and retries.

const RETRY_MS = 10_000;
let paymentsRetryAt = 0;

/** Runs one Kill Bill step in a transaction; an unreachable Kill Bill postpones every payment step for 10 s. */
async function paymentStep(work: (db: Db) => Promise<void>): Promise<boolean> {
  if (Date.now() < paymentsRetryAt) return false;
  try {
    await tx(work);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) {
      paymentsRetryAt = Date.now() + RETRY_MS;
      return false;
    }
    throw error;
  }
}

/** The pledge, locked, if it is still in `state` (a request may have moved it since it was listed). */
async function lockedPledge(db: Db, id: string, state: PledgeState): Promise<(PledgeRecord & { email: string }) | undefined> {
  const found = await rows<PledgeRecord & { email: string }>(db,
    `${PLEDGE_SELECT.replace("FROM pledges p", ", b.email FROM pledges p JOIN people b ON b.id = p.backer_id")} WHERE p.id = $1 FOR UPDATE OF p`, [id]);
  return found[0]?.state === state ? found[0] : undefined;
}

async function pledgeIds(campaignId: string, state: PledgeState): Promise<string[]> {
  return (await rows<{ id: string }>(pool, "SELECT id FROM pledges WHERE campaign_id = $1 AND state = $2 ORDER BY created_at", [campaignId, state])).map((r) => r.id);
}

/** Captured, with its funded-and-charged notice and pending statement recorded in the same step. */
async function recordCapture(db: Db, campaign: CampaignRecord, pledge: PledgeRecord & { email: string }): Promise<void> {
  await movePledge(db, pledge, "captured");
  await recordNotice(db, campaign.id, "funded_charged", pledge.email, { title: campaign.title, amount: pledge.amount });
  await queueStatement(db, pledge.id, campaign.id);
}

/** Voids every authorised pledge of an unfunded or cancelled campaign, emailing each backer. */
export async function releaseHolds(campaignId: string): Promise<void> {
  for (const id of await pledgeIds(campaignId, "authorised")) {
    const done = await paymentStep(async (db) => {
      const campaign = (await loadCampaign(db, campaignId, true)) as CampaignRecord;
      const pledge = await lockedPledge(db, id, "authorised");
      if (!pledge) return;
      await release(pledge.kb_payment_id as string, pledge.id);
      await movePledge(db, pledge, "voided");
      const kind: NoticeKind = campaign.status === "cancelled" ? "campaign_cancelled" : "not_funded";
      await recordNotice(db, campaign.id, kind, pledge.email, { title: campaign.title, amount: pledge.amount });
    });
    if (!done) return;
  }
}

/** Moves a funded or collecting campaign on once its pledges allow, queueing the settlement sheet. */
async function advance(campaignId: string): Promise<void> {
  await tx(async (db) => {
    const campaign = (await loadCampaign(db, campaignId, true)) as CampaignRecord;
    const counts = (await rows<{ authorised: number; errored: number }>(db, `SELECT
        count(*) FILTER (WHERE state = 'authorised')::bigint AS authorised, count(*) FILTER (WHERE state = 'errored')::bigint AS errored
      FROM pledges WHERE campaign_id = $1`, [campaignId]))[0];
    if (await advanceCollection(db, campaign, counts.authorised, counts.errored)) await queueSettlement(db, campaign.id);
  });
}

/** Funded close-out: each held pledge is captured whole, or errored with its fix window opened. */
async function collect(campaignId: string): Promise<void> {
  for (const id of await pledgeIds(campaignId, "authorised")) {
    const done = await paymentStep(async (db) => {
      const campaign = (await loadCampaign(db, campaignId, true)) as CampaignRecord;
      const pledge = await lockedPledge(db, id, "authorised");
      if (!pledge) return;
      if (capturesOn(pledge.card_last4)) {
        await capture(pledge.kb_payment_id as string, pledge.id, pledge.amount);
        await recordCapture(db, campaign, pledge);
        return;
      }
      const fixCode = randomBytes(32).toString("base64url");
      const fixDeadline = new Date(campaign.deadline_utc.getTime() + config.fixWindowSeconds * 1000);
      await movePledge(db, pledge, "errored", {
        fix_code: fixCode, fix_deadline_utc: fixDeadline, card_fixed: false,
        next_fix_notice_at: new Date(Date.now() + config.fixNoticeSeconds * 1000),
      });
      await recordNotice(db, campaign.id, "fix_payment", pledge.email, { title: campaign.title, amount: pledge.amount, fixCode, fixDeadline });
    });
    if (!done) return;
  }
  await advance(campaignId);
}

/** A fix-payment notice at every notice interval strictly before the window ends. */
async function sendFixNotices(): Promise<void> {
  const due = await rows<{ id: string; campaign_id: string }>(pool,
    "SELECT id, campaign_id FROM pledges WHERE state = 'errored' AND next_fix_notice_at <= $1 ORDER BY next_fix_notice_at", [new Date()]);
  for (const { id, campaign_id: campaignId } of due) {
    await tx(async (db) => {
      const campaign = (await loadCampaign(db, campaignId, true)) as CampaignRecord;
      const pledge = await lockedPledge(db, id, "errored");
      if (!pledge?.next_fix_notice_at) return;
      const sendAt = pledge.next_fix_notice_at.getTime();
      const windowEnd = (pledge.fix_deadline_utc as Date).getTime();
      const next = sendAt + config.fixNoticeSeconds * 1000;
      await db.query("UPDATE pledges SET next_fix_notice_at = $2 WHERE id = $1", [id, next < windowEnd ? new Date(next) : null]);
      if (sendAt >= windowEnd) return;
      await recordNotice(db, campaign.id, "fix_payment", pledge.email, {
        title: campaign.title, amount: pledge.amount, fixCode: pledge.fix_code as string, fixDeadline: pledge.fix_deadline_utc as Date,
      });
    });
  }
}

/** When the fix window ends: one final collection on the latest hold, then captured or dropped. */
async function finalAttempts(): Promise<void> {
  const due = await rows<{ id: string; campaign_id: string }>(pool,
    "SELECT id, campaign_id FROM pledges WHERE state = 'errored' AND fix_deadline_utc <= $1 ORDER BY fix_deadline_utc", [new Date()]);
  for (const { id, campaign_id: campaignId } of due) {
    const done = await paymentStep(async (db) => {
      const campaign = (await loadCampaign(db, campaignId, true)) as CampaignRecord;
      const pledge = await lockedPledge(db, id, "errored");
      if (!pledge) return;
      if (capturesOn(pledge.fix_card_last4 ?? pledge.card_last4)) {
        if (pledge.fix_payment_id) {
          await capture(pledge.fix_payment_id, `${pledge.id}-fix-${pledge.fix_count}`, pledge.amount);
          await release(pledge.kb_payment_id as string, pledge.id);
        } else {
          await capture(pledge.kb_payment_id as string, pledge.id, pledge.amount);
        }
        await recordCapture(db, campaign, pledge);
        return;
      }
      await release(pledge.kb_payment_id as string, pledge.id);
      if (pledge.fix_payment_id) await release(pledge.fix_payment_id, `${pledge.id}-fix-${pledge.fix_count}`);
      await movePledge(db, pledge, "dropped");
      await recordNotice(db, campaign.id, "dropped", pledge.email, { title: campaign.title, amount: pledge.amount });
    });
    if (done) await advance(campaignId);
  }
}

/** live -> funded or unfunded for every campaign whose deadline instant has passed. */
async function closeDue(): Promise<void> {
  const due = await rows<{ id: string }>(pool, "SELECT id FROM campaigns WHERE status = 'live' AND deadline_utc <= $1", [new Date()]);
  for (const { id } of due) {
    await tx(async (db) => {
      const campaign = await loadCampaign(db, id, true);
      await closeCampaign(db, campaign as CampaignRecord, (await campaignTotals(db, id)).total);
    });
  }
}

async function tick(): Promise<void> {
  await closeDue();
  const open = await rows<{ id: string; status: string }>(pool, `SELECT DISTINCT c.id, c.status FROM campaigns c
    WHERE c.status = 'funded' OR (c.status IN ('unfunded', 'cancelled') AND EXISTS (SELECT 1 FROM pledges p WHERE p.campaign_id = c.id AND p.state = 'authorised'))`);
  for (const c of open) await (c.status === "funded" ? collect(c.id) : releaseHolds(c.id));
  await sendFixNotices();
  await finalAttempts();
}

let running = false;

export function startCloseout(): void {
  setInterval(() => {
    if (running) return;
    running = true;
    tick()
      .catch((error: unknown) => console.error(`close-out: ${describe(error)}`))
      .finally(() => {
        running = false;
      });
  }, 1000);
}
