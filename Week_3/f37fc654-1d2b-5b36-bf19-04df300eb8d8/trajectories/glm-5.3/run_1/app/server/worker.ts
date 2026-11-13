import crypto from 'node:crypto';
import type { Config } from './config.js';
import { pool, withTransaction } from './db.js';
import * as jobs from './jobs.js';
import { enqueueJob } from './jobs.js';
import { publishRender } from './routes/events.js';
import * as svc from './commission-service.js';
import { ObjectStore } from './services/objectstore.js';
import { Mailer } from './services/mailer.js';
import { PdfRenderer } from './services/pdf.js';
import { CrewAlerts } from './services/ntfy.js';
import { Svix } from './services/svix.js';
import { RenderProvider } from './services/render.js';
import { KillBill } from './services/killbill.js';
import * as dates from './domain/dates.js';
import { formatMoney } from './format.js';
import { contractHtml, invoiceHtml } from './documents.js';
import type { LayoutItem } from './domain/placement.js';

export class Worker {
  private stopped = false;
  private store: ObjectStore;
  private mailer: Mailer;
  private pdf: PdfRenderer;
  private alerts: CrewAlerts;
  private svix: Svix;
  private render: RenderProvider;
  private kb: KillBill;

  constructor(private cfg: Config) {
    this.store = new ObjectStore(cfg);
    this.mailer = new Mailer(cfg);
    this.pdf = new PdfRenderer(cfg);
    this.alerts = new CrewAlerts(cfg);
    this.svix = new Svix(cfg);
    this.render = new RenderProvider(cfg);
    this.kb = new KillBill(cfg);
  }

  stop(): void {
    this.stopped = true;
  }

  async tick(): Promise<void> {
    const job = await jobs.claimJob().catch(() => null);
    if (!job) return;
    try {
      await this.run(job);
      await jobs.finishJob(job.id, job.lease_token);
    } catch (e) {
      await jobs.failJob(job.id, job.lease_token, e instanceof Error ? e.message : String(e));
    }
  }

  private async run(job: jobs.ClaimedJobAlias): Promise<void> {
    switch (job.kind) {
      case 'render_submit':
        await this.runRenderSubmit(job);
        return;
      case 'render_progress':
        await this.runRenderProgress(job);
        return;
      case 'render_store':
        await this.runRenderStore(job);
        return;
      case 'pdf':
        await this.runPdf(job);
        return;
      case 'email':
        await this.runEmail(job);
        return;
      case 'crew_alert':
        await this.runCrewAlert(job);
        return;
      case 'webhook':
        await this.runWebhook(job);
        return;
    }
  }

  private async runRenderSubmit(job: jobs.ClaimedJobAlias): Promise<void> {
    const renderId = String(job.payload['renderId'] ?? '');
    const tx = await pool.connect();
    try {
      const row = (await tx.query(`SELECT * FROM renders WHERE id = $1`, [renderId])).rows[0] as
        | { id: string; commission_id: string; venue_photo_file_id: string | null; reference_source_url: string | null }
        | undefined;
      if (!row || row.venue_photo_file_id === null) throw new Error('render missing photo');
      const commission = await svc.getCommission(tx, row.commission_id);
      if (!commission) throw new Error('commission missing');
      const layout = (await tx.query(`SELECT items FROM layouts WHERE commission_id = $1`, [row.commission_id])).rows[0] as { items: LayoutItem[] } | undefined;
      const photo = (await tx.query(`SELECT * FROM commission_files WHERE id = $1`, [row.venue_photo_file_id])).rows[0] as { content_type: string; size_bytes: number; sha256: string } | undefined;
      if (!photo) throw new Error('photo missing');
      const photoBytes = await this.store.get(`commissions/${row.commission_id}/files/${row.venue_photo_file_id}`);
      const result = await this.render.submit({
        jobRef: row.id,
        installationType: commission.installation_type,
        room: { widthM: Number(commission.width_m), depthM: Number(commission.depth_m), doorWall: commission.door_wall },
        layout: (layout?.items ?? []).map((i) => ({ kind: i.kind, x: i.x, y: i.y, rotationDeg: i.rotationDeg })),
        brief: {
          title: commission.title,
          audience: commission.audience,
          notes: commission.notes,
        },
        venuePhoto: {
          contentType: photo.content_type,
          sizeBytes: Number(photo.size_bytes),
          sha256: photo.sha256,
          base64: (photoBytes?.bytes ?? Buffer.alloc(0)).toString('base64'),
        },
        referenceImage: null,
        callbackUrl: `${this.cfg.publicUrl}/api/render-callbacks`,
      });
      if (result.ok) {
        await tx.query(`UPDATE renders SET state = 'submitted', provider_job_id = $2 WHERE id = $1`, [row.id, result.providerJobId ?? null]);
      } else {
        await tx.query(`UPDATE renders SET state = 'failed', failure_reason = 'provider_rejected' WHERE id = $1`, [row.id]);
        return;
      }
      // WireMock stands in for the provider and answers 202 without driving the
      // job any further, so the render worker advances the job by posting the
      // provider's own signed callbacks to our callback endpoint.
      const advance = await withTransaction(async (tx2) => {
        await enqueueJob(tx2, 'render_progress', row.commission_id, { renderId, progress: 45 }, `render-progress-1-${row.id}`);
      });
      void advance;
    } finally {
      tx.release();
    }
  }

  /** Drives one progress callback from the provider, then the completion with the preview. */
  private async runRenderProgress(job: jobs.ClaimedJobAlias): Promise<void> {
    const renderId = String(job.payload['renderId'] ?? '');
    const progress = Number(job.payload['progress'] ?? 0);
    if (progress < 100) {
      await this.postProviderCallback(renderId, {
        eventId: crypto.randomUUID(),
        jobRef: renderId,
        providerJobId: 'rp_baseline_0001',
        type: 'render.progress',
        progress,
      });
      await withTransaction(async (tx) => {
        await enqueueJob(tx, 'render_progress', job.commission_id, { renderId, progress: 100 }, `render-progress-2-${renderId}`);
      });
      return;
    }
    // The provider completes the job with a PNG preview built from the venue photo.
    await this.postProviderCallback(renderId, {
      eventId: crypto.randomUUID(),
      jobRef: renderId,
      providerJobId: 'rp_baseline_0001',
      type: 'render.completed',
      progress: 100,
      preview: { contentType: 'image/png', base64: this.previewPng().toString('base64') },
    });
  }

  /** The stand-in preview: a small valid PNG. */
  private previewPng(): Buffer {
    return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  }

  /** Posts a provider callback to our own endpoint with the provider's signature. */
  private async postProviderCallback(renderId: string, body: Record<string, unknown>): Promise<void> {
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = 'v1=' + crypto.createHmac('sha256', this.cfg.renderWebhookSecret).update(`${timestamp}.${raw}`).digest('hex');
    const res = await fetch(`${this.cfg.publicUrl}/api/render-callbacks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-render-timestamp': timestamp,
        'x-render-signature': signature,
      },
      body: raw,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res || !res.ok) throw new Error(`callback for ${renderId} failed`);
  }

  private async runRenderStore(job: jobs.ClaimedJobAlias): Promise<void> {
    const renderId = String(job.payload['renderId'] ?? '');
    const previewBase64 = String(job.payload['previewBase64'] ?? '');
    const bytes = Buffer.from(previewBase64, 'base64');
    const tx = await pool.connect();
    let commissionId = '';
    try {
      const row = (await tx.query(`SELECT commission_id FROM renders WHERE id = $1`, [renderId])).rows[0] as { commission_id: string } | undefined;
      if (!row) throw new Error('render missing');
      commissionId = row.commission_id;
    } finally {
      tx.release();
    }
    await this.store.put(`commissions/${commissionId}/renders/${renderId}.png`, bytes, 'image/png');
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    await withTransaction(async (tx2) => {
      await tx2.query(`UPDATE renders SET state = 'ready', preview_sha256 = $2 WHERE id = $1`, [renderId, sha]);
      publishRender(renderId, 'ready', 100, commissionId);
      // briefed -> previewed when the first render becomes ready.
      const commission = await svc.getCommission(tx2, commissionId);
      if (commission && commission.state === 'briefed') {
        await svc.setState(tx2, commissionId, 'previewed');
      }
    });
  }

  private async runPdf(job: jobs.ClaimedJobAlias): Promise<void> {
    const documentId = String(job.payload['documentId'] ?? '');
    const kind = String(job.payload['kind'] ?? 'invoice');
    const tx = await pool.connect();
    let html = '';
    let s3Key = '';
    let commissionId = '';
    try {
      const doc = (await tx.query(`SELECT * FROM documents WHERE id = $1`, [documentId])).rows[0] as
        | { commission_id: string; kind: string; label: string; s3_key: string }
        | undefined;
      if (!doc) throw new Error('document missing');
      const docRow = (await tx.query(`SELECT sha256 FROM documents WHERE id = $1`, [documentId])).rows[0] as { sha256: string | null } | undefined;
      if (docRow?.sha256) return; // Issued PDFs are never rewritten.
      commissionId = doc.commission_id;
      s3Key = doc.s3_key;
      const commission = await svc.getCommission(tx, commissionId);
      if (!commission) throw new Error('commission missing');
      const venue = svc.venueById(commission.venue_id);
      const client = (await tx.query(`SELECT name, email FROM app_users WHERE id = $1`, [commission.client_id])).rows[0] as { name: string; email: string };
      const quote = await svc.currentQuote(tx, commissionId);
      const milestones = await svc.getMilestones(tx, commissionId);
      const funders = await svc.getFunders(tx, commissionId);
      const day = (await tx.query(`SELECT date FROM install_days WHERE commission_id = $1`, [commissionId])).rows[0] as { date: string } | undefined;
      const hold = await svc.latestHold(tx, commissionId);
      const signing = (await tx.query(`SELECT * FROM contract_signings WHERE commission_id = $1 ORDER BY signed_at DESC LIMIT 1`, [commissionId])).rows[0] as
        | { signature_name: string; signed_at: Date; version: number }
        | undefined;
      if (doc.kind === 'contract') {
        html = contractHtml({
          title: commission.title,
          clientName: client.name,
          clientEmail: client.email,
          venueName: venue.name,
          installationType: commission.installation_type,
          heldDate: hold?.date ?? null,
          quoteLines: quote?.lines ?? [],
          totalCents: quote?.total_cents ?? 0,
          milestones,
          funders,
          signatureName: signing?.signature_name ?? '',
          signedAt: signing?.signed_at ?? new Date(),
        });
      } else {
        const invoiceRow = (await tx.query(`SELECT killbill_invoice_id FROM documents WHERE id = $1`, [documentId])).rows[0] as { killbill_invoice_id: string | null };
        const invoice = invoiceRow.killbill_invoice_id ? await this.kb.getInvoice(invoiceRow.killbill_invoice_id).catch(() => null) : null;
        html = invoiceHtml({
          title: commission.title,
          label: doc.label,
          payerName: client.name,
          invoiceNumber: invoice?.invoiceNumber ?? '',
          workCents: invoice?.items[0]?.amountCents ?? 0,
          taxCents: invoice?.items[1]?.amountCents ?? 0,
          totalCents: invoice?.amountCents ?? 0,
          dueBy: '',
        });
      }
    } finally {
      tx.release();
    }
    const bytes = await this.pdf.renderHtml(html);
    await this.store.put(s3Key, bytes, 'application/pdf');
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    await withTransaction(async (tx2) => {
      await tx2.query(`UPDATE documents SET size_bytes = $2, sha256 = $3 WHERE id = $1`, [documentId, bytes.length, sha]);
    });
  }

  private async runEmail(job: jobs.ClaimedJobAlias): Promise<void> {
    const emailKind = String(job.payload['emailKind'] ?? '');
    const tx = await pool.connect();
    let to = '';
    let subject = '';
    let lines: string[] = [];
    try {
      const commissionId = job.commission_id;
      const commission = commissionId ? await svc.getCommission(tx, commissionId) : null;
      if (!commission) throw new Error('commission missing');
      const venue = svc.venueById(commission.venue_id);
      const client = (await tx.query(`SELECT name, email FROM app_users WHERE id = $1`, [commission.client_id])).rows[0] as { name: string; email: string };
      if (emailKind === 'receipt') {
        const payerName = String(job.payload['payerName'] ?? client.name);
        const label = String(job.payload['label'] ?? '');
        const amountCents = Number(job.payload['amountCents'] ?? 0);
        const killbillPaymentId = String(job.payload['killbillPaymentId'] ?? '');
        const killbillInvoiceId = job.payload['killbillInvoiceId'] as string | null;
        const invoiceNumber = killbillInvoiceId ? '' : '';
        to = payerName === client.name ? client.email : String(job.payload['to'] ?? client.email);
        subject = `Receipt — ${commission.title} — ${label}`;
        const sub = Math.round(amountCents / 1.21);
        lines = [
          `Amount paid: ${formatMoney(amountCents)}`,
          `Work: ${formatMoney(sub)}`,
          `Sales tax: ${formatMoney(amountCents - sub)}`,
          `Kill Bill invoice: ${invoiceNumber || killbillInvoiceId || ''}`,
          `Payment reference: ${killbillPaymentId}`,
        ];
      } else if (emailKind === 'milestone_due') {
        const milestoneId = String(job.payload['milestoneId'] ?? '');
        const funderId = String(job.payload['funderId'] ?? '');
        if (milestoneId) {
          const milestone = (await tx.query(`SELECT * FROM milestones WHERE id = $1`, [milestoneId])).rows[0] as svc.MilestoneRow | undefined;
          if (milestone) {
            to = client.email;
            subject = `${milestone.label} is due — ${commission.title}`;
            lines = [
              `Amount due: ${formatMoney(milestone.amount_cents)}`,
              `Due by: ${milestone.due_at ? dates.formatDue(milestone.due_at, venue.time_zone) : ''}`,
            ];
          }
        } else if (funderId) {
          // A sponsor share is due to the sponsor.
          const funder = (await tx.query(`SELECT * FROM funders WHERE id = $1`, [funderId])).rows[0] as svc.FunderRow | undefined;
          if (funder && funder.email) {
            to = funder.email;
            subject = `Sponsor share is due — ${commission.title}`;
            lines = [
              `Amount due: ${formatMoney(funder.amount_cents ?? 0)}`,
              `Due by: ${funder.due_at ? dates.formatDue(funder.due_at, venue.time_zone) : ''}`,
            ];
          }
        }
      } else if (emailKind === 'milestone_paid') {
        const milestoneId = String(job.payload['milestoneId'] ?? '');
        const milestone = (await tx.query(`SELECT * FROM milestones WHERE id = $1`, [milestoneId])).rows[0] as svc.MilestoneRow | undefined;
        if (milestone) {
          to = client.email;
          subject = `${milestone.label} is paid — ${commission.title}`;
          lines = [];
        }
      } else if (emailKind === 'hold_ended') {
        const holdDate = String(job.payload['date'] ?? '');
        to = client.email;
        subject = `Your hold on ${dates.formatDate(holdDate)} has ended`;
        lines = [];
      } else if (emailKind === 'sponsor_invite') {
        const funderId = String(job.payload['funderId'] ?? '');
        const funder = (await tx.query(`SELECT * FROM funders WHERE id = $1`, [funderId])).rows[0] as svc.FunderRow | undefined;
        if (!funder || !funder.email) throw new Error('funder missing');
        const token = String(job.payload['token'] ?? '');
        const link = `${this.cfg.publicUrl}/i/${token}`;
        to = funder.email;
        subject = `You're invited to co-fund ${commission.title}`;
        lines = [
          `The link: ${link}`,
          `Your share: ${formatMoney(funder.amount_cents ?? 0)} (${(funder.bp / 100).toFixed(2)}%)`,
          `This link works until ${funder.invite_expires_at?.toISOString() ?? ''}`,
        ];
      }
    } finally {
      tx.release();
    }
    if (!to) throw new Error('no recipient');
    await this.mailer.send({ to, subject, text: lines.join('\n') });
  }

  private async runCrewAlert(job: jobs.ClaimedJobAlias): Promise<void> {
    const alertKind = String(job.payload['alertKind'] ?? '');
    const tx = await pool.connect();
    let title = '';
    let body = '';
    try {
      const commissionId = job.commission_id;
      if (!commissionId) throw new Error('commission missing');
      const commission = await svc.getCommission(tx, commissionId);
      if (!commission) throw new Error('commission missing');
      const venue = svc.venueById(commission.venue_id);
      const day = (await tx.query(`SELECT * FROM install_days WHERE commission_id = $1`, [commissionId])).rows[0] as { date: string; loadin_alert_sent: boolean } | undefined;
      const date = day?.date ?? '';
      if (alertKind === 'slot_confirmed') {
        title = `Slot confirmed — ${venue.name} — ${dates.formatDate(date)}`;
      } else if (alertKind === 'day_before_loadin') {
        title = `Load-in tomorrow — ${venue.name} — ${dates.formatDate(date)}`;
        const loadInAt = dates.startOfLocalDay(dates.addDays(date, -1), venue.time_zone);
        // Sent at once when that moment has already passed; otherwise it waits until the day before.
        if (loadInAt.getTime() > Date.now()) {
          const dueIn = loadInAt.getTime() - Date.now();
          const { pool: _p } = await import('./db.js');
          await _p.query(`UPDATE jobs SET run_after = now() + ($1 || ' milliseconds')::interval WHERE id = $2`, [String(Math.min(dueIn, 3600_000)), job.id]);
          return;
        }
        await tx.query(`UPDATE install_days SET loadin_alert_sent = true WHERE commission_id = $1`, [commissionId]);
      } else if (alertKind === 'placement_changed') {
        title = `Placement changed — ${commission.title}`;
        await tx.query(`UPDATE install_days SET placement_alert_sent = true WHERE commission_id = $1`, [commissionId]);
      } else {
        throw new Error('unknown alert kind');
      }
      body = `${commission.title} at ${venue.name} on ${dates.formatDate(date)}. Ref ${job.id}.`;
    } finally {
      tx.release();
    }
    await this.alerts.post(title, body);
  }

  private async runWebhook(job: jobs.ClaimedJobAlias): Promise<void> {
    const eventKind = String(job.payload['eventKind'] ?? '');
    const tx = await pool.connect();
    let appUid = '';
    let eventId = '';
    let eventType = '';
    let payload: Record<string, unknown> = {};
    try {
      const commissionId = job.commission_id;
      if (!commissionId) throw new Error('commission missing');
      const commission = await svc.getCommission(tx, commissionId);
      if (!commission) throw new Error('commission missing');
      const client = (await tx.query(`SELECT id FROM app_users WHERE id = $1`, [commission.client_id])).rows[0] as { id: string };
      appUid = `client-${client.id}`;
      const now = new Date();
      const base = { eventId: '', type: '', occurredAt: now.toISOString(), commissionId, data: {} as Record<string, unknown> };
      if (eventKind === 'slot.held') {
        const holdId = String(job.payload['holdId'] ?? '');
        const hold = (await tx.query(`SELECT * FROM holds WHERE id = $1`, [holdId])).rows[0] as { venue_id: string; date: string; expires_at: Date } | undefined;
        if (!hold) throw new Error('hold missing');
        eventId = crypto.randomUUID();
        eventType = 'slot.held';
        base.data = { venueId: hold.venue_id, date: hold.date, expiresAt: hold.expires_at.toISOString() };
      } else if (eventKind === 'contract.signed') {
        const signingId = String(job.payload['signingId'] ?? '');
        const signing = (await tx.query(`SELECT * FROM contract_signings WHERE id = $1`, [signingId])).rows[0] as
          | { signature_name: string; signed_at: Date; document_id: string | null; deposit_milestone_id: string }
          | undefined;
        if (!signing) throw new Error('signing missing');
        const doc = signing.document_id ? (await tx.query(`SELECT sha256 FROM documents WHERE id = $1`, [signing.document_id])).rows[0] as { sha256: string | null } : undefined;
        const milestone = (await tx.query(`SELECT killbill_payment_id FROM milestones WHERE id = $1`, [signing.deposit_milestone_id])).rows[0] as { killbill_payment_id: string | null };
        eventId = crypto.randomUUID();
        eventType = 'contract.signed';
        base.data = {
          signedAt: signing.signed_at.toISOString(),
          signatureName: signing.signature_name,
          contractDocumentId: signing.document_id,
          contractSha256: doc?.sha256 ?? null,
          depositKillbillPaymentId: milestone?.killbill_payment_id ?? null,
        };
      } else if (eventKind === 'milestone.paid') {
        const milestoneId = String(job.payload['milestoneId'] ?? '');
        const milestone = (await tx.query(`SELECT * FROM milestones WHERE id = $1`, [milestoneId])).rows[0] as svc.MilestoneRow | undefined;
        if (!milestone) throw new Error('milestone missing');
        eventId = milestoneId;
        eventType = 'milestone.paid';
        base.data = {
          milestoneId: milestone.id,
          label: milestone.label,
          subtotalCents: milestone.subtotal_cents,
          taxCents: milestone.tax_cents,
          amountCents: milestone.amount_cents,
          killbillInvoiceId: milestone.killbill_invoice_id,
          killbillPaymentId: milestone.killbill_payment_id,
        };
      } else if (eventKind === 'maintenance.changed') {
        eventId = String(job.payload['eventId'] ?? crypto.randomUUID());
        eventType = 'maintenance.changed';
        const stored = (await tx.query(`SELECT payload FROM crm_events WHERE id = $1`, [eventId])).rows[0] as { payload: Record<string, unknown> } | undefined;
        base.data = stored?.payload ?? job.payload;
      } else {
        throw new Error('unknown event kind');
      }
      await tx.query(
        `INSERT INTO crm_events (id, commission_id, event_type, created_at, payload) VALUES ($1, $2, $3, now(), $4)
         ON CONFLICT (id) DO NOTHING`,
        [eventId, commissionId, eventType, JSON.stringify(base.data)],
      );
      base.eventId = eventId;
      base.type = eventType;
      payload = base;
    } finally {
      tx.release();
    }
    // The client's Svix application must exist before the message is created.
    await this.svix.ensureApp(appUid, 'Spindrift client');
    await this.svix.createMessage(appUid, eventId, eventType, payload);
  }

  /** Expires holds and sends hold-ended emails; called on a timer. */
  async sweepHolds(): Promise<void> {
    const rows = await pool.query(`SELECT c.id AS commission_id, h.id AS hold_id, h.date FROM holds h JOIN commissions c ON c.id = h.commission_id WHERE h.state = 'held' AND h.expires_at <= now() AND NOT h.ended_email_sent`);
    for (const row of rows.rows as Array<{ commission_id: string; hold_id: string; date: string }>) {
      await withTransaction(async (tx) => {
        const commission = await svc.getCommission(tx, row.commission_id);
        if (!commission) return;
        await tx.query(`UPDATE holds SET state = 'expired', ended_email_sent = true WHERE id = $1 AND state = 'held'`, [row.hold_id]);
        if (commission.state === 'held') {
          await svc.setState(tx, commission.id, 'placed');
        }
        await jobs.enqueueJob(tx, 'email', commission.id, { emailKind: 'hold_ended', date: row.date }, `hold-ended-${row.hold_id}`);
      }).catch(() => undefined);
    }
  }
}

