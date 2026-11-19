import { formatPence, feesForAmount, zoneName } from "../shared/money.js";
import type { Zone } from "../shared/domain.js";
import type { AppContext } from "./context.js";
import type { NoticeService } from "./notices.js";
import { newFixCode } from "./ids.js";

// Close-out, the fix window, and the pending renders all run on short loops.
// Close-out runs within 5 seconds of the deadline; retries run every 10
// seconds while a dependency is down.

interface PledgeWorkerRow {
  id: string;
  campaign_id: string;
  person_id: string;
  tier_id: string;
  amount: number;
  state: string;
  card_behaviour: string;
  card_fixed: boolean;
  kb_payment_id: string;
  kb_fix_payment_id: string | null;
  errored_at: Date | null;
  fix_deadline: Date | null;
}

export class CampaignWorkers {
  private readonly ctx: AppContext;
  private readonly notices: NoticeService;
  private running = false;

  constructor(ctx: AppContext, notices: NoticeService) {
    this.ctx = ctx;
    this.notices = notices;
  }

  start(): void {
    const tick = async (): Promise<void> => {
      if (this.running) return;
      this.running = true;
      try {
        await this.closeDueCampaigns();
        await this.processFundedCaptures();
        await this.processFixWindows();
        await this.renderPendingStatements();
        await this.renderPendingSettlements();
        await this.notices.dispatchDue();
      } catch {
        // The next tick retries; nothing is lost.
      } finally {
        this.running = false;
      }
    };
    const loop = (): void => {
      tick()
        .catch(() => undefined)
        .finally(() => {
          setTimeout(loop, 5000).unref?.();
        });
    };
    loop();
  }

  /** Campaigns whose deadline has passed and close-out has not yet run. */
  private async closeDueCampaigns(): Promise<void> {
    const due = await this.ctx.pool.query<{
      id: string;
      status: string;
      goal: number;
      title: string;
    }>(
      `SELECT id, status, goal, title FROM campaigns
       WHERE status = 'live' AND deadline_utc <= now()`,
    );
    for (const campaign of due.rows) {
      await this.closeCampaign(campaign.id);
    }
  }

  private async closeCampaign(campaignId: string): Promise<void> {
    const client = await this.ctx.pool.connect();
    let total = 0;
    let goal = 0;
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ id: string; status: string; goal: number }>(
        `SELECT id, status, goal FROM campaigns WHERE id = $1 FOR UPDATE`,
        [campaignId],
      );
      const campaign = locked.rows[0];
      if (campaign === undefined || campaign.status !== "live") {
        await client.query("ROLLBACK");
        return;
      }
      const totals = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount) FILTER (WHERE state IN ('authorised','captured','errored')), 0) AS total
         FROM pledges WHERE campaign_id = $1`,
        [campaignId],
      );
      total = Number(totals.rows[0]?.total ?? 0);
      goal = campaign.goal;
      const funded = total >= goal;
      await client.query(
        `UPDATE campaigns SET status = $2, closed_at = now() WHERE id = $1`,
        [campaignId, funded ? "funded" : "unfunded"],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    if (total < goal) {
      await this.voidPledges(campaignId);
    }
  }

  /** Unfunded close-out: every authorised pledge is voided and emailed. */
  private async voidPledges(campaignId: string): Promise<void> {
    if (!this.ctx.health.isUp("payments")) return;
    const pledges = await this.ctx.pool.query<PledgeWorkerRow>(
      `SELECT id, campaign_id, person_id, tier_id, amount, state, card_behaviour,
              card_fixed, kb_payment_id, errored_at, fix_deadline
         FROM pledges WHERE campaign_id = $1 AND state = 'authorised'`,
      [campaignId],
    );
    const campaign = await this.ctx.pool.query<{ title: string }>(
      `SELECT title FROM campaigns WHERE id = $1`,
      [campaignId],
    );
    for (const pledge of pledges.rows) {
      const voided = await this.ctx.killbill.void(pledge.kb_payment_id, `${pledge.id}-void`);
      if (!voided.ok || voided.value !== true) {
        if (!voided.ok) this.ctx.health.markDown("payments");
        return;
      }
      await this.ctx.pool.query(`UPDATE pledges SET state = 'voided' WHERE id = $1`, [pledge.id]);
      await this.ctx.pool.query(
        `INSERT INTO pledge_history (pledge_id, state, at) VALUES ($1, 'voided', now())`,
        [pledge.id],
      );
    }
    for (const pledge of pledges.rows) {
      const email = await this.personEmail(pledge.person_id);
      await this.notices.record(
        {
          campaignId,
          pledgeId: pledge.id,
          kind: "not_funded",
          to: email,
          campaignTitle: campaign.rows[0]?.title ?? "",
          amountPence: pledge.amount,
        },
        `not_funded:${campaignId}:${pledge.id}`,
      );
    }
  }

  /** Funded close-out: capture every authorised pledge. */
  private async processFundedCaptures(): Promise<void> {
    if (!this.ctx.health.isUp("payments")) return;
    const campaigns = await this.ctx.pool.query<{ id: string }>(
      `SELECT id FROM campaigns WHERE status IN ('funded','collecting')`,
    );
    for (const campaign of campaigns.rows) {
      const pledges = await this.ctx.pool.query<PledgeWorkerRow>(
        `SELECT id, campaign_id, person_id, tier_id, amount, state, card_behaviour,
                card_fixed, kb_payment_id, kb_fix_payment_id, errored_at, fix_deadline
         FROM pledges WHERE campaign_id = $1 AND state = 'authorised'`,
        [campaign.id],
      );
      for (const pledge of pledges.rows) {
        const captured = await this.ctx.killbill.capture(
          pledge.kb_payment_id,
          `${pledge.id}-capture`,
          pledge.amount,
          pledge.card_behaviour === "fail_capture",
        );
        if (!captured.ok) {
          this.ctx.health.markDown("payments");
          return;
        }
        if (captured.value) {
          await this.markPledgeCaptured(pledge);
        } else {
          await this.markPledgeErrored(pledge);
        }
      }
      // funded -> collecting once every authorised pledge has a capture result.
      await this.promoteFundedCampaign(campaign.id);
    }
  }

  private async markPledgeCaptured(pledge: PledgeWorkerRow): Promise<void> {
    const client = await this.ctx.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<{ captured_at: Date }>(
        `UPDATE pledges SET state = 'captured', captured_at = now()
         WHERE id = $1 AND state IN ('authorised','errored') RETURNING captured_at`,
        [pledge.id],
      );
      if (updated.rows.length === 0) {
        // Another tick already captured this pledge.
        await client.query("ROLLBACK");
        return;
      }
      await client.query(
        `INSERT INTO pledge_history (pledge_id, state, at) VALUES ($1, 'captured', now())`,
        [pledge.id],
      );
      await client.query(
        `INSERT INTO statements (pledge_id, status) VALUES ($1, 'pending')
         ON CONFLICT (pledge_id) DO UPDATE SET status = 'pending', updated_at = now()`,
        [pledge.id],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const email = await this.personEmail(pledge.person_id);
    const campaign = await this.campaignTitle(pledge.campaign_id);
    await this.notices.record(
      {
        campaignId: pledge.campaign_id,
        pledgeId: pledge.id,
        kind: "funded_charged",
        to: email,
        campaignTitle: campaign,
        amountPence: pledge.amount,
      },
      `funded_charged:${pledge.campaign_id}:${pledge.id}`,
    );
  }

  private async markPledgeErrored(pledge: PledgeWorkerRow): Promise<void> {
    const fixDeadline = new Date(Date.now() + this.ctx.config.fixWindowSeconds * 1000);
    const client = await this.ctx.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<{ errored_at: Date }>(
        `UPDATE pledges SET state = 'errored', errored_at = now(), fix_deadline = $2
         WHERE id = $1 AND state = 'authorised' RETURNING errored_at`,
        [pledge.id, fixDeadline],
      );
      if (updated.rows.length === 0) {
        // Another tick already recorded the error.
        await client.query("ROLLBACK");
        return;
      }
      await client.query(
        `INSERT INTO pledge_history (pledge_id, state, at) VALUES ($1, 'errored', now())`,
        [pledge.id],
      );
      const existing = await client.query<{ code: string }>(
        `SELECT code FROM fix_codes WHERE pledge_id = $1 LIMIT 1`,
        [pledge.id],
      );
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO fix_codes (code, pledge_id) VALUES ($1, $2)`,
          [newFixCode(), pledge.id],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await this.sendFixNotices(pledge.id);
  }

  /**
   * Records the fix-payment notices: one when the pledge errors and one at
   * every notice interval, as long as the send time is strictly before the
   * window's end. With the defaults that makes four notices.
   */
  private async sendFixNotices(pledgeId: string): Promise<void> {
    const loaded = await this.ctx.pool.query<{
      campaign_id: string;
      campaign_title: string;
      amount: number;
      person_id: string;
      errored_at: Date;
      fix_deadline: Date;
    }>(
      `SELECT pl.campaign_id, c.title AS campaign_title, pl.amount, pl.person_id,
              pl.errored_at, pl.fix_deadline
       FROM pledges pl JOIN campaigns c ON c.id = pl.campaign_id
       WHERE pl.id = $1`,
      [pledgeId],
    );
    const row = loaded.rows[0];
    if (row === null || row.errored_at === null || row.fix_deadline === null) return;
    const code = await this.ctx.pool.query<{ code: string }>(
      `SELECT code FROM fix_codes WHERE pledge_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [pledgeId],
    );
    const email = await this.personEmail(row.person_id);
    const intervalMs = this.ctx.config.fixNoticeSeconds * 1000;
    const noticesDue = Math.floor(
      (this.ctx.config.fixWindowSeconds - 1) / this.ctx.config.fixNoticeSeconds,
    );
    for (let n = 0; n < noticesDue; n += 1) {
      const dueAt = new Date(row.errored_at.getTime() + n * intervalMs);
      if (dueAt.getTime() >= row.fix_deadline.getTime()) break;
      await this.notices.record(
        {
          campaignId: row.campaign_id,
          pledgeId,
          kind: "fix_payment",
          to: email,
          campaignTitle: row.campaign_title,
          amountPence: row.amount,
          fixCode: code.rows[0]?.code,
        },
        `fix_payment:${row.campaign_id}:${pledgeId}:${email}:${n}`,
      );
    }
  }

  private async promoteFundedCampaign(campaignId: string): Promise<void> {
    const remaining = await this.ctx.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pledges WHERE campaign_id = $1 AND state = 'authorised'`,
      [campaignId],
    );
    if (Number(remaining.rows[0]?.count ?? 0) === 0) {
      await this.ctx.pool.query(
        `UPDATE campaigns SET status = 'collecting' WHERE id = $1 AND status = 'funded'`,
        [campaignId],
      );
      await this.promoteSettledCampaign(campaignId);
    }
  }

  private async promoteSettledCampaign(campaignId: string): Promise<void> {
    const errored = await this.ctx.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pledges WHERE campaign_id = $1 AND state = 'errored'`,
      [campaignId],
    );
    if (Number(errored.rows[0]?.count ?? 0) === 0) {
      const client = await this.ctx.pool.connect();
      try {
        await client.query("BEGIN");
        const settled = await client.query<{ status: string }>(
          `UPDATE campaigns SET status = 'settled' WHERE id = $1 AND status = 'collecting'
           RETURNING status`,
          [campaignId],
        );
        if (settled.rows.length > 0) {
          await client.query(
            `INSERT INTO settlements (campaign_id, status) VALUES ($1, 'pending')
             ON CONFLICT (campaign_id) DO UPDATE SET status = 'pending', updated_at = now()`,
            [campaignId],
          );
        }
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    }
  }

  /** The fix window: notices, the final attempt and the drop. */
  private async processFixWindows(): Promise<void> {
    if (!this.ctx.health.isUp("payments")) return;
    const closed = await this.ctx.pool.query<PledgeWorkerRow>(
      `SELECT id, campaign_id, person_id, tier_id, amount, state, card_behaviour,
              card_fixed, kb_payment_id, kb_fix_payment_id, errored_at, fix_deadline
       FROM pledges
       WHERE state = 'errored' AND fix_deadline IS NOT NULL AND fix_deadline <= now()`,
    );
    for (const pledge of closed.rows) {
      // One final attempt: capture the latest fix hold, else the original.
      const claimed = await this.ctx.pool.query(
        `UPDATE pledges SET state = 'dropped', last_capture_attempt = now()
         WHERE id = $1 AND state = 'errored' AND last_capture_attempt IS NULL
         RETURNING id`,
        [pledge.id],
      );
      if (claimed.rows.length === 0) {
        // Another tick already made the final attempt.
        continue;
      }
      // Restore the errored state while the attempt runs.
      await this.ctx.pool.query(
        `UPDATE pledges SET state = 'errored' WHERE id = $1`,
        [pledge.id],
      );
      const paymentId = pledge.kb_fix_payment_id ?? pledge.kb_payment_id;
      const captureKey = `${pledge.id}-final-capture`;
      const captured = await this.ctx.killbill.capture(
        paymentId,
        captureKey,
        pledge.amount,
        pledge.card_behaviour === "fail_capture",
      );
      if (!captured.ok) {
        this.ctx.health.markDown("payments");
        return;
      }
      if (captured.value) {
        await this.markPledgeCaptured(pledge);
        await this.cancelFixNotices(pledge.id);
        continue;
      }
      // Dropped: void the remaining holds and email the backer.
      if (pledge.kb_fix_payment_id !== null) {
        const voided = await this.ctx.killbill.void(
          pledge.kb_fix_payment_id,
          `${pledge.id}-fix-void`,
        );
        if (!voided.ok) {
          this.ctx.health.markDown("payments");
          return;
        }
      }
      const originalVoid = await this.ctx.killbill.void(
        pledge.kb_payment_id,
        `${pledge.id}-void`,
      );
      if (!originalVoid.ok) {
        this.ctx.health.markDown("payments");
        return;
      }
      await this.ctx.pool.query(
        `UPDATE pledges SET state = 'dropped' WHERE id = $1`,
        [pledge.id],
      );
      await this.ctx.pool.query(
        `INSERT INTO pledge_history (pledge_id, state, at) VALUES ($1, 'dropped', now())`,
        [pledge.id],
      );
      await this.cancelFixNotices(pledge.id);
      const email = await this.personEmail(pledge.person_id);
      const title = await this.campaignTitle(pledge.campaign_id);
      await this.notices.record(
        {
          campaignId: pledge.campaign_id,
          pledgeId: pledge.id,
          kind: "dropped",
          to: email,
          campaignTitle: title,
          amountPence: pledge.amount,
        },
        `dropped:${pledge.campaign_id}:${pledge.id}`,
      );
      const campaign = await this.ctx.pool.query<{ id: string }>(
        `SELECT id FROM campaigns WHERE id = $1`,
        [pledge.campaign_id],
      );
      if (campaign.rows.length > 0) {
        await this.promoteSettledCampaign(pledge.campaign_id);
      }
    }
  }

  private async renderPendingStatements(): Promise<void> {
    const pending = await this.ctx.pool.query<{
      pledge_id: string;
      campaign_id: string;
      amount: number;
      reward: number;
      shipping: number;
      add_on: number;
      zone: string;
      tier_title: string;
      campaign_title: string;
      backer_name: string;
      cover_key: string | null;
    }>(
      `SELECT s.pledge_id, pl.campaign_id, pl.amount, pl.reward, pl.shipping, pl.add_on, pl.zone,
              t.title AS tier_title, c.title AS campaign_title, pe.name AS backer_name,
              (SELECT m.object_key FROM media m
                WHERE m.campaign_id = pl.campaign_id AND m.kind = 'cover'
                ORDER BY m.created_at DESC LIMIT 1) AS cover_key
       FROM statements s
       JOIN pledges pl ON pl.id = s.pledge_id
       JOIN campaigns c ON c.id = pl.campaign_id
       JOIN tiers t ON t.id = pl.tier_id
       JOIN people pe ON pe.id = pl.person_id
       WHERE s.status = 'pending'`,
    );
    for (const row of pending.rows) {
      const html = statementHtml(row);
      const pdf = await this.ctx.documents.renderPdf(html);
      if (pdf === null) {
        this.ctx.health.markDown("documents");
        continue;
      }
      const key = `statements/${row.pledge_id}.pdf`;
      const stored = await this.ctx.storage.putAndConfirm(key, pdf, "application/pdf");
      if (!stored.stored) {
        this.ctx.health.markDown("storage");
        continue;
      }
      await this.ctx.pool.query(
        `UPDATE statements SET status = 'ready', object_key = $2, updated_at = now()
         WHERE pledge_id = $1`,
        [row.pledge_id, key],
      );
    }
  }

  private async renderPendingSettlements(): Promise<void> {
    const pending = await this.ctx.pool.query<{ campaign_id: string; title: string }>(
      `SELECT s.campaign_id, c.title FROM settlements s
       JOIN campaigns c ON c.id = s.campaign_id
       WHERE s.status = 'pending'`,
    );
    for (const row of pending.rows) {
      const lines = await this.ctx.pool.query<{
        id: string;
        amount: number;
      }>(
        `SELECT id, amount FROM pledges WHERE campaign_id = $1 AND state = 'captured'
         ORDER BY created_at ASC`,
        [row.campaign_id],
      );
      const dropped = await this.ctx.pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM pledges WHERE campaign_id = $1 AND state = 'dropped'`,
        [row.campaign_id],
      );
      let gross = 0;
      let platformFee = 0;
      let processingFee = 0;
      const lineViews = lines.rows.map((line) => {
        const fees = feesForAmount(line.amount);
        gross += line.amount;
        platformFee += fees.platform_fee;
        processingFee += fees.processing_fee;
        return {
          pledge_id: line.id,
          amount: line.amount,
          platform_fee: fees.platform_fee,
          processing_fee: fees.processing_fee,
          to_creator: fees.to_creator,
        };
      });
      const html = settlementHtml(row.title, lineViews, {
        gross,
        platform_fee: platformFee,
        processing_fee: processingFee,
        net: gross - platformFee - processingFee,
        captured_count: lines.rows.length,
        dropped_count: Number(dropped.rows[0]?.count ?? 0),
      });
      const pdf = await this.ctx.documents.renderPdf(html);
      if (pdf === null) {
        this.ctx.health.markDown("documents");
        continue;
      }
      const key = `settlements/${row.campaign_id}.pdf`;
      const stored = await this.ctx.storage.putAndConfirm(key, pdf, "application/pdf");
      if (!stored.stored) {
        this.ctx.health.markDown("storage");
        continue;
      }
      await this.ctx.pool.query(
        `UPDATE settlements SET status = 'ready', object_key = $2, updated_at = now()
         WHERE campaign_id = $1`,
        [row.campaign_id, key],
      );
      const creator = await this.ctx.pool.query<{ creator_id: string }>(
        `SELECT creator_id FROM campaigns WHERE id = $1`,
        [row.campaign_id],
      );
      const email = await this.personEmail(creator.rows[0]?.creator_id ?? "");
      if (email !== "") {
        await this.notices.record(
          {
            campaignId: row.campaign_id,
            pledgeId: null,
            kind: "settlement_ready",
            to: email,
            campaignTitle: row.title,
          },
          `settlement_ready:${row.campaign_id}`,
        );
      }
    }
  }

  /**
   * Cancels any queued fix-payment notices for a pledge whose fix window no
   * longer matters: the pledge was captured or dropped.
   */
  private async cancelFixNotices(pledgeId: string): Promise<void> {
    await this.ctx.pool.query(
      `DELETE FROM notices WHERE pledge_id = $1 AND kind = 'fix_payment' AND status = 'queued'`,
      [pledgeId],
    );
  }

  private async personEmail(personId: string): Promise<string> {
    if (personId === "") return "";
    const result = await this.ctx.pool.query<{ email: string }>(
      `SELECT email FROM people WHERE id = $1`,
      [personId],
    );
    return result.rows[0]?.email ?? "";
  }

  private async campaignTitle(campaignId: string): Promise<string> {
    const result = await this.ctx.pool.query<{ title: string }>(
      `SELECT title FROM campaigns WHERE id = $1`,
      [campaignId],
    );
    return result.rows[0]?.title ?? "";
  }
}

interface StatementRow {
  pledge_id: string;
  campaign_title: string;
  backer_name: string;
  tier_title: string;
  reward: number;
  shipping: number;
  add_on: number;
  amount: number;
  zone: string;
  cover_key: string | null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statementHtml(row: StatementRow): string {
  const fees = feesForAmount(row.amount);
  const cover =
    row.cover_key !== null
      ? `<p style="margin:0 0 16px"><img src="${escapeHtml(coverUrl(row.cover_key))}" alt="Cover" style="max-width:360px;width:100%"></p>`
      : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Dotgain backer statement</title></head>
<body style="font-family:Helvetica,Arial,sans-serif;color:#0d5c60;margin:40px">
<h1>Dotgain backer statement</h1>
<p><strong>${escapeHtml(row.campaign_title)}</strong></p>
${cover}
<p>${escapeHtml(row.backer_name)}</p>
<p>Pledge ${escapeHtml(row.pledge_id)}</p>
<p>Tier: ${escapeHtml(row.tier_title)}</p>
<table style="border-collapse:collapse;margin-top:16px">
<tr><td>Reward</td><td style="padding-left:24px">${formatPence(row.reward)}</td></tr>
<tr><td>Shipping (${escapeHtml(zoneName(row.zone as Zone))})</td><td style="padding-left:24px">${formatPence(row.shipping)}</td></tr>
<tr><td>Add-on</td><td style="padding-left:24px">${formatPence(row.add_on)}</td></tr>
<tr><td>Total charged</td><td style="padding-left:24px">${formatPence(row.amount)}</td></tr>
<tr><td>Platform fee (5%)</td><td style="padding-left:24px">${formatPence(fees.platform_fee)}</td></tr>
<tr><td>Processing (3% + 20p)</td><td style="padding-left:24px">${formatPence(fees.processing_fee)}</td></tr>
<tr><td>To the creator</td><td style="padding-left:24px">${formatPence(fees.to_creator)}</td></tr>
</table>
</body></html>`;
}

function coverUrl(objectKey: string): string {
  // The cover is fetched through the app's own media route so the browser and
  // the renderer never see the bucket.
  const mediaId = objectKey.split("/").pop()?.replace(/\.(png|jpg|webp)$/, "") ?? "";
  return `/api/media/${mediaId}`;
}

interface SettlementLine {
  pledge_id: string;
  amount: number;
  platform_fee: number;
  processing_fee: number;
  to_creator: number;
}

function settlementHtml(
  title: string,
  lines: SettlementLine[],
  totals: {
    gross: number;
    platform_fee: number;
    processing_fee: number;
    net: number;
    captured_count: number;
    dropped_count: number;
  },
): string {
  const rows = lines
    .map(
      (line) => `<tr>
<td>${escapeHtml(line.pledge_id)}</td>
<td>${formatPence(line.amount)}</td>
<td>${formatPence(line.platform_fee)}</td>
<td>${formatPence(line.processing_fee)}</td>
<td>${formatPence(line.to_creator)}</td>
</tr>`,
    )
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Dotgain settlement sheet</title></head>
<body style="font-family:Helvetica,Arial,sans-serif;color:#0d5c60;margin:40px">
<h1>Dotgain settlement sheet</h1>
<p><strong>${escapeHtml(title)}</strong></p>
<table style="border-collapse:collapse">
<tr><th>Pledge</th><th>Amount</th><th>Platform fee</th><th>Processing</th><th>To creator</th></tr>
${rows}
</table>
<table style="border-collapse:collapse;margin-top:16px">
<tr><td>Gross</td><td style="padding-left:24px">${formatPence(totals.gross)}</td></tr>
<tr><td>Platform fees</td><td style="padding-left:24px">${formatPence(totals.platform_fee)}</td></tr>
<tr><td>Processing fees</td><td style="padding-left:24px">${formatPence(totals.processing_fee)}</td></tr>
<tr><td>Net to creator</td><td style="padding-left:24px">${formatPence(totals.net)}</td></tr>
<tr><td>Captured pledges</td><td style="padding-left:24px">${totals.captured_count}</td></tr>
<tr><td>Dropped pledges</td><td style="padding-left:24px">${totals.dropped_count}</td></tr>
</table>
</body></html>`;
}
