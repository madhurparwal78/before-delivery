/**
 * Shared background work on every instance (Services): queued invites, recap
 * attempts, the billing refresh, trash purge and queued image deletions, each
 * claimed under a Postgres lease.
 */
import type { Config } from './config.js';
import { Db } from './db.js';
import { KillBillClient } from './killbill.js';
import { S3Client, recapPdfKey, recapCsvKey, recapFrameKey, imageKey } from './s3.js';
import { sendMail } from './mail.js';
import { loadBoard, dotTotals, clusterNoteIds } from './board.js';
import { buildCsv, framePng } from './recapfiles.js';
import { buildPdf } from './pdf.js';
import { refreshMirror } from './billing.js';
import { centsToAmount } from './money.js';
import { hhmm, longDate } from './time.js';

const LEASE_SECONDS = 30;

export class Worker {
  private db: Db;
  private cfg: Config;
  private kb: KillBillClient;
  private s3: S3Client;
  private streamHub: { pushBoardEvent(workshopId: string, version: number): void } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(db: Db, cfg: Config, kb: KillBillClient, s3: S3Client) {
    this.db = db; this.cfg = cfg; this.kb = kb; this.s3 = s3;
  }

  attachHub(hub: { pushBoardEvent(workshopId: string, version: number): void }): void {
    this.streamHub = hub;
  }

  start(): void {
    const tick = async (): Promise<void> => {
      if (this.running) return;
      this.running = true;
      try {
        await this.tickOnce();
      } catch (e) {
        console.error('[worker] tick failed', e);
      } finally {
        this.running = false;
      }
    };
    tick();
    this.timer = setInterval(tick, this.cfg.deliveryRetrySeconds * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tickOnce(): Promise<void> {
    await this.tryCatalog();
    await this.step('invites', () => this.processInvites());
    await this.step('recaps', () => this.processRecaps());
    await this.step('billing', () => this.processBilling());
    await this.step('purge', () => this.processPurge());
    await this.step('imageDeletes', () => this.processImageDeletes());
  }

  private async step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      console.error(`[worker] step ${name} failed`, e);
    }
  }

  private catalogDone = false;
  private async tryCatalog(): Promise<void> {
    if (this.catalogDone) return;
    try {
      await this.kb.ensureTenantAndCatalog();
      this.catalogDone = true;
    } catch { /* retry next tick */ }
  }

  // ---- queued invites (DP-10)

  private async processInvites(): Promise<void> {
    const items = await this.db.rows<{ id: string; workshop_id: string; email: string }>(
      `select id, workshop_id, email from invite_queue
       where lease_until is null or lease_until < now()
       order by created_at limit 25`);
    for (const item of items) {
      const claimed = await this.db.row<{ id: string }>(
        `update invite_queue set lease_until = now() + interval '${LEASE_SECONDS} seconds',
         attempts = attempts + 1 where id = $1 and (lease_until is null or lease_until < now()) returning id`,
        [item.id]);
      if (!claimed) continue;
      try {
        const sent = await this.sendInvite(item.workshop_id, item.email);
        await this.db.tx(async (c) => {
          if (sent) {
            await c.query(`update invites set status = 'sent', sent_at = now() where workshop_id = $1 and email = $2`, [item.workshop_id, item.email]);
            await c.query(`delete from invite_queue where id = $1`, [item.id]);
            await c.query(`update workshops set version = version where id = $1`, [item.workshop_id]);
          } else {
            await c.query(`update invite_queue set lease_until = null where id = $1`, [item.id]);
          }
        });
      } catch {
        await this.db.exec(`update invite_queue set lease_until = null where id = $1`, [item.id]);
      }
    }
  }

  /** One invite message; returns false when mail or the link is unavailable. */
  private async sendInvite(workshopId: string, email: string): Promise<boolean> {
    const info = await this.db.row<{ title: string; token: string | null; status: string; time_zone: string; scheduled_start: string; scheduled_end: string }>(
      `select w.title, w.time_zone, w.scheduled_start, w.scheduled_end,
              (select l.token from join_links l where l.workshop_id = w.id and l.revoked = false and l.expires_at > now() order by l.created_at desc limit 1) as token
       from workshops w where w.id = $1`, [workshopId]);
    if (!info || !info.token) return false;
    const joinUrl = `${this.cfg.publicBaseUrl}/join/${info.token}`;
    const zoneName = info.time_zone;
    const when = `${info.scheduled_start} to ${info.scheduled_end} (${zoneName})`;
    const text = [
      `You're invited to "${info.title}".`,
      '',
      `Join here: ${joinUrl}`,
      '',
      `When: ${when}`,
      '',
      'Lanternfold Rooms',
    ].join('\n');
    const html = `<html><body style="font-family:sans-serif"><p>You're invited to <strong>${escapeHtml(info.title)}</strong>.</p>
      <p><a href="${joinUrl}">Join the workshop</a></p>
      <p>When: ${escapeHtml(when)}</p>
      <p>Lanternfold Rooms</p></body></html>`;
    try {
      await sendMail(this.cfg, { to: email, subject: `You're invited: ${info.title}`, text, html });
      return true;
    } catch {
      return false;
    }
  }

  // ---- the recap pipeline (DP-36, DP-52)

  private async processRecaps(): Promise<void> {
    const items = await this.db.rows<{ workshop_id: string }>(
      `select r.workshop_id, r.lease_until from recaps r
       where r.status = 'queued' and (r.lease_until is null or r.lease_until < now())
       order by r.created_at limit 5`);
    for (const item of items) {
      const claimed = await this.db.row<{ id: string }>(
        `update recaps set lease_until = now() + interval '${LEASE_SECONDS} seconds', attempts = attempts + 1
         where workshop_id = $1 and (lease_until is null or lease_until < now()) returning workshop_id as id`,
        [item.workshop_id]);
      if (!claimed) continue;
      let outcome: { ok: boolean; reason: string | null } = { ok: false, reason: 'storage_unavailable' };
      try {
        outcome = await this.recapAttempt(item.workshop_id);
      } catch {
        outcome = { ok: false, reason: 'storage_unavailable' };
      }
      await this.db.tx(async (c) => {
        if (outcome.ok) {
          await c.query(`update recaps set status='complete', reason=null, lease_until=null where workshop_id=$1`, [item.workshop_id]);
          await c.query(`insert into activity (id, facilitator_id, actor, action, workshop_id)
            select $1, w.facilitator_id, 'system', 'recap.completed', w.id from workshops w where w.id = $2
            on conflict do nothing`,
            [`act_recap_${item.workshop_id}`, item.workshop_id]).catch(() => undefined);
        } else {
          await c.query(`update recaps set reason=$2, lease_until=null where workshop_id=$1`, [item.workshop_id, outcome.reason]);
        }
        await c.query('select 1'); // keep the transaction meaningful
      });
      this.streamHub?.pushBoardEvent(item.workshop_id, await this.bumpVersion(item.workshop_id, 1));
    }
  }

  /** One recap attempt, continuing from the first unfinished step. */
  private async recapAttempt(workshopId: string): Promise<{ ok: boolean; reason: string | null }> {
    const state = await this.db.tx(async (c) => loadBoard(c, workshopId));
    if (!state) return { ok: false, reason: null };
    const { workshop, frames, clusters, notes, dots } = state;
    const recap = await this.db.row<{ files_stored_at: Date | null; sponsor_invoice_id: string | null; email_sent_at: Date | null; recap_token: string; scale: number }>(
      'select * from recaps where workshop_id = $1', [workshopId]);
    if (!recap) return { ok: false, reason: null };
    const visibleFrames = frames.filter((f) => f.trashed_at === null);
    const totals = dotTotals(dots);
    const included = notes.filter((n) => n.revealed && !n.facilitator_only && visibleFrames.some((f) => f.id === n.frame_id));

    // 1. files
    if (!recap.files_stored_at) {
      try {
        const ranked = clusters.filter((c) => visibleFrames.some((f) => f.id === c.frame_id));
        ranked.sort((a, b) => {
          const ta = totals.get(a.id)?.total ?? 0;
          const tb = totals.get(b.id)?.total ?? 0;
          if (ta !== tb) return tb - ta;
          const fa = frames.find((f) => f.id === a.frame_id)?.position ?? 0;
          const fb = frames.find((f) => f.id === b.frame_id)?.position ?? 0;
          if (fa !== fb) return fa - fb;
          return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1;
        });
        const pdf = buildPdf({
          title: `Recap: ${workshop.title}`,
          pages: [
            { heading: workshop.title, text: ['Cluster ranking', ...ranked.map((cl) => `${cl.title} — ${totals.get(cl.id)?.total ?? 0} dots`)] },
            ...visibleFrames.map((f) => ({
              heading: f.title,
              text: included.filter((n) => n.frame_id === f.id)
                .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
                .map((n) => n.text ?? '[image]'),
            })),
          ],
        });
        await this.s3.putObject(recapPdfKey(workshopId), pdf, 'application/pdf');
        const csvRows: Array<{ frame: string; cluster: string; note: string; clusterDots: number }> = [];
        for (const f of visibleFrames) {
          for (const cl of ranked.filter((x) => x.frame_id === f.id)) {
            for (const n of included.filter((x) => x.cluster_id === cl.id).sort((a, b) => a.placement_index - b.placement_index)) {
              csvRows.push({ frame: f.title, cluster: cl.title, note: n.text ?? '[image]', clusterDots: totals.get(cl.id)?.total ?? 0 });
            }
          }
          for (const n of included.filter((x) => x.frame_id === f.id && x.cluster_id === null).sort((a, b) => a.created_at.getTime() - b.created_at.getTime())) {
            csvRows.push({ frame: f.title, cluster: '', note: n.text ?? '[image]', clusterDots: 0 });
          }
        }
        await this.s3.putObject(recapCsvKey(workshopId), buildCsv(csvRows), 'text/csv; charset=utf-8');
        const fileList: Array<{ name: string; label: string; contentType: string }> = [
          { name: 'board.pdf', label: 'Board PDF', contentType: 'application/pdf' },
          { name: 'notes.csv', label: 'Notes and votes CSV', contentType: 'text/csv; charset=utf-8' },
        ];
        for (const f of visibleFrames) {
          const png = framePng(f.title, f.width, f.height, recap.scale,
            included.filter((n) => n.frame_id === f.id).map((n) => ({ text: n.text, x: n.x, y: n.y, cluster: clusters.find((c) => c.id === n.cluster_id)?.title ?? null })),
            new Map(ranked.map((c) => [c.title, totals.get(c.id)?.total ?? 0])));
          await this.s3.putObject(recapFrameKey(workshopId, f.id), png, 'image/png');
          fileList.push({ name: `frame-${f.id}.png`, label: `Frame image: ${f.title}`, contentType: 'image/png' });
        }
        await this.db.tx(async (c) => {
          await c.query(`update recaps set files_stored_at = now(), file_list = $2 where workshop_id = $1`, [workshopId, JSON.stringify(fileList)]);
        });
      } catch {
        return { ok: false, reason: 'storage_unavailable' };
      }
    }

    // 2. sponsor invoice
    const needInvoice = workshop.fee_cents > 0;
    if (needInvoice) {
      const existing = await this.db.row<{ id: string; number: string; cents: number }>('select * from kb_invoices where workshop_id = $1', [workshopId]);
      if (!existing) {
        try {
          const key = `sponsor:${workshop.sponsor_email.toLowerCase()}`;
          let account = await this.kb.getAccountByKey(key);
          if (!account) {
            account = await this.kb.createAccount({
              externalKey: key, name: workshop.sponsor_email, email: workshop.sponsor_email,
              currency: 'EUR', timeZone: 'UTC',
            });
          }
          const description = `Workshop ${workshop.id} — ${workshop.title}`;
          // never charge twice for the same description
          let invoiceId: string | null = null;
          let number = '';
          let cents = workshop.fee_cents;
          for (const inv of await this.kb.getInvoicesWithItems(account.accountId)) {
            if (inv.items.some((it) => it.description === description)) {
              invoiceId = inv.invoiceId;
              number = String(inv.invoiceNumber);
              cents = kbCents(inv.amount);
              break;
            }
          }
          if (!invoiceId) {
            const item = await this.kb.createExternalCharge(account.accountId, workshop.fee_cents, description);
            invoiceId = item.invoiceId;
            const full = await this.kbInvoice(invoiceId);
            number = String(full.invoiceNumber);
            cents = kbCents(full.amount);
          }
          await this.db.tx(async (c) => {
            await c.query(
              `insert into kb_invoices (id, sponsor_email, workshop_id, number, date, cents, balance_cents, currency, status)
               values ($1,$2,$3,$4,$5,$6,$6,'EUR','unpaid') on conflict (id) do nothing`,
              [invoiceId, workshop.sponsor_email.toLowerCase(), workshopId, number, new Date().toISOString().slice(0, 10), cents]);
            await c.query(`update recaps set sponsor_invoice_id = $2 where workshop_id = $1`, [workshopId, invoiceId]);
            await c.query(`insert into activity (id, facilitator_id, actor, action, workshop_id)
              select $1, w.facilitator_id, 'system', 'sponsor.invoiced', w.id from workshops w where w.id = $2`,
              [`act_inv_${workshopId}`, workshopId]).catch(() => undefined);
          });
        } catch {
          return { ok: false, reason: 'billing_unavailable' };
        }
      }
    }

    // 3. email
    if (!recap.email_sent_at) {
      try {
        const recipients = await this.recipients(workshopId, workshop.sponsor_email);
        const recapUrl = `${this.cfg.publicBaseUrl}/recap/${recap.recap_token}`;
        const invoiceRow = await this.db.row<{ number: string; cents: number }>('select number, cents from kb_invoices where workshop_id = $1', [workshopId]);
        const ranked = clusters.filter((c) => visibleFrames.some((f) => f.id === c.frame_id))
          .sort((a, b) => (totals.get(b.id)?.total ?? 0) - (totals.get(a.id)?.total ?? 0));
        const rankingLines = ranked.map((cl) => `${cl.title} — ${totals.get(cl.id)?.total ?? 0} dots — ${clusterNoteIds(included, cl).map((id) => included.find((n) => n.id === id)?.text).filter((t): t is string => t !== null).join('; ')}`);
        const invoiceLine = invoiceRow ? `Invoice ${invoiceRow.number} — €${centsToAmount(invoiceRow.cents)}` : '';
        const text = [
          `Recap: ${workshop.title}`,
          '',
          `Open the recap: ${recapUrl}`,
          '',
          'Cluster ranking:',
          ...rankingLines.map((l) => `- ${l}`),
          ...(invoiceLine ? ['', invoiceLine] : []),
          '',
          'Lanternfold Rooms',
        ].join('\n');
        const html = `<html><body><h1>Recap: ${escapeHtml(workshop.title)}</h1>
          <p><a href="${recapUrl}">Open the recap page</a></p>
          <h2>Cluster ranking</h2><ul>${rankingLines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
          ${invoiceLine ? `<p>${escapeHtml(invoiceLine)}</p>` : ''}
          <p>Lanternfold Rooms</p></body></html>`;
        for (const to of recipients) {
          await sendMail(this.cfg, { to, subject: `Recap: ${workshop.title}`, text, html });
        }
        await this.db.exec(`update recaps set email_sent_at = now(), recipients = $2 where workshop_id = $1`, [workshopId, recipients.length]);
      } catch {
        return { ok: false, reason: 'mail_unavailable' };
      }
    }
    return { ok: true, reason: null };
  }

  private async kbInvoice(invoiceId: string): Promise<{ invoiceNumber: number | string; amount: number }> {
    const body = await this.kb.getInvoice(invoiceId);
    return { invoiceNumber: body.invoiceNumber, amount: body.amount };
  }

  private async recipients(workshopId: string, sponsorEmail: string): Promise<string[]> {
    const rows = await this.db.rows<{ email: string }>('select distinct email from invites where workshop_id = $1', [workshopId]);
    const out = new Set<string>([sponsorEmail]);
    for (const r of rows) out.add(r.email);
    return [...out].map((e) => e.toLowerCase());
  }

  private async bumpVersion(workshopId: string, by: number): Promise<number> {
    const row = await this.db.row<{ version: string }>('update workshops set version = version + $2 where id = $1 returning version::text', [workshopId, by]);
    return Number(row?.version ?? 0);
  }

  // ---- billing refresh

  private async processBilling(): Promise<void> {
    const facs = await this.db.rows<{ id: string; email: string; name: string; time_zone: string }>('select * from facilitators');
    for (const fac of facs) {
      await this.db.tx(async (c) => refreshMirror(this.kb, this.cfg, c, fac));
    }
  }

  // ---- trash purge (DP-70's physical delete)

  private async processPurge(): Promise<void> {
    const items = await this.db.rows<{ id: string; workshop_id: string; facilitator_id: string }>(
      `select f.id, f.workshop_id, w.facilitator_id from frames f join workshops w on w.id = f.workshop_id
       where f.trashed_at is not null and f.purged = false and f.purge_at <= now() limit 10`);
    for (const item of items) {
      const claimed = await this.db.row<{ id: string }>(
        `update frames set purged = true where id = $1 and purged = false returning id`, [item.id]);
      if (!claimed) continue;
      await this.db.tx(async (c) => {
        // remove this frame from every stored version
        const versions = (await c.query('select id, snapshot from versions where workshop_id = $1', [item.workshop_id])).rows as Array<{ id: string; snapshot: unknown }>;
        for (const v of versions) {
          const snap = v.snapshot as { frames?: Array<{ id: string }> };
          if (snap.frames?.some((f) => f.id === item.id)) {
            snap.frames = snap.frames.filter((f) => f.id !== item.id);
            await c.query('update versions set snapshot = $2 where id = $1', [v.id, JSON.stringify(snap)]);
          }
        }
        await c.query(`insert into activity (id, facilitator_id, actor, action, workshop_id) values ($1,$2,'system','frame.purged',$3)`,
          [`act_purge_${item.id}`, item.facilitator_id, item.workshop_id]).catch(() => undefined);
      });
    }
  }

  // ---- queued image deletions (DP-68)

  private async processImageDeletes(): Promise<void> {
    const items = await this.db.rows<{ id: string; image_id: string }>(
      `select id, image_id from image_deletes
       where lease_until is null or lease_until < now() order by created_at limit 25`);
    for (const item of items) {
      const claimed = await this.db.row<{ id: string }>(
        `update image_deletes set lease_until = now() + interval '${LEASE_SECONDS} seconds' where id = $1
         and (lease_until is null or lease_until < now()) returning id`, [item.id]);
      if (!claimed) continue;
      try {
        const img = await this.db.row<{ workshop_id: string }>('select workshop_id from images where id = $1', [item.image_id]);
        if (img) {
          await this.s3.deleteObject(imageKey(img.workshop_id, item.image_id));
        }
        await this.db.exec('delete from image_deletes where id = $1', [item.id]);
      } catch {
        await this.db.exec('update image_deletes set lease_until = null where id = $1', [item.id]);
      }
    }
  }
}

function kbCents(n: number): number {
  return Math.round(n * 100);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
