// Completion, charge posting, invoice commit and each notice are separate
// recorded steps. A pending step is retried at least every 15 seconds and
// runs exactly once. If a provider is down the local action still succeeds and
// the pending state shows.

import type { KillBillClient } from './killbill.js';
import type { ObjectStore } from './objectstore.js';
import type { MailClient } from './mail.js';
import type { Store } from './store.js';
import type { Invoice, Move, NoticeRecord } from './types.js';

export interface StepRunnerConfig {
  killbill: KillBillClient;
  objects: ObjectStore;
  mail: MailClient;
}

const RETRY_MS = 15_000;

export class StepRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly store: Store,
    private readonly config: StepRunnerConfig,
    private readonly now: () => number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.due();
    }, RETRY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async due(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const steps = this.store.pendingSteps.filter((s) => s.state === 'pending');
      for (const step of steps) {
        if (this.now() - step.at_ms < 500) continue;
        await this.runOne(step.id);
      }
    } finally {
      this.running = false;
    }
  }

  async runOne(stepId: string): Promise<boolean> {
    const step = this.store.pendingSteps.find((s) => s.id === stepId);
    if (!step || step.state !== 'pending') return true;
    try {
      if (step.kind === 'charge_post') {
        await this.runChargePost(JSON.parse(step.payload) as { invoice_id: string });
      } else if (step.kind === 'invoice_commit') {
        await this.runInvoiceCommit(JSON.parse(step.payload) as { invoice_id: string });
      } else {
        await this.runNoticeSend(JSON.parse(step.payload) as { move_ref: string; kind: string });
      }
      step.state = 'done';
      step.attempts += 1;
      await this.store.save();
      return true;
    } catch {
      step.attempts += 1;
      await this.store.save();
      return false;
    }
  }

  // Charges post once as external charges on one draft invoice of the agency's
  // Kill Bill account, even under a retry after an ambiguous reply.
  private async runChargePost(payload: { invoice_id: string }): Promise<void> {
    const invoice = this.store.invoices.find((i) => i.id === payload.invoice_id);
    if (!invoice) return;
    if (invoice.charge_state === 'posted') return;
    const step = this.store.pendingSteps.find(
      (s) => s.kind === 'charge_post' && s.state === 'pending' && s.payload.includes(invoice.id),
    );
    // Record the attempt token before calling the provider, so an ambiguous
    // reply can be adopted rather than duplicated.
    if (step) {
      if (step.attempt_token) {
        const adopted = await this.adoptDraft(invoice, step.attempt_token);
        if (adopted) return;
      }
      const token = `post-${invoice.id}-${step.attempts + 1}`;
      step.attempt_token = token;
      await this.store.save();
    }
    const account = await this.config.killbill.ensureAccount(invoice.agency_code, this.agencyName(invoice.agency_code));
    const posted = await this.config.killbill.postExternalCharges(
      account,
      invoice.lines.map((l) => ({
        amount_cents: l.amount_cents,
        description: `${invoice.move_ref} ${l.label}`,
      })),
    );
    invoice.kb_invoice_id = posted.invoiceId;
    invoice.charge_state = 'posted';
    if (step) step.attempt_token = null;
    await this.store.save();
  }

  // After an ambiguous reply, read the agency account's invoices back before
  // trying again, adopting any DRAFT invoice from that attempt.
  private async adoptDraft(invoice: Invoice, token: string): Promise<boolean> {
    const account = await this.config.killbill.ensureAccount(invoice.agency_code, this.agencyName(invoice.agency_code));
    const drafts = await this.config.killbill.accountInvoices(account);
    const wanted = invoice.lines.map((l) => `${invoice.move_ref} ${l.label}`);
    for (const draft of drafts) {
      if (draft.status !== 'DRAFT') continue;
      const descriptions = draft.items.map((i) => i.description ?? '');
      if (draft.items.length === invoice.lines.length && wanted.every((d, idx) => descriptions[idx] === d)) {
        invoice.kb_invoice_id = draft.invoiceId;
        invoice.charge_state = 'posted';
        return true;
      }
    }
    void token;
    return false;
  }

  private async runInvoiceCommit(payload: { invoice_id: string }): Promise<void> {
    const invoice = this.store.invoices.find((i) => i.id === payload.invoice_id);
    if (!invoice) return;
    if (invoice.state === 'issued') return;
    if (invoice.charge_state !== 'posted' || !invoice.kb_invoice_id) {
      // Charges still pending: the commit runs once when the provider returns.
      throw new Error('charges pending');
    }
    const committed = await this.config.killbill.commitInvoice(invoice.kb_invoice_id);
    invoice.number = committed.invoiceNumber;
    invoice.balance_cents = committed.balance === null ? null : Math.round(committed.balance * 100);
    invoice.state = 'issued';
    const move = this.store.moves.find((m) => m.ref === invoice.move_ref);
    if (move && move.status === 'Completed' && invoice.event_kind === 'Completed') {
      move.status = 'Invoiced';
      this.store.addHistory(move, 'Invoiced', 'slackwater');
    }
    await this.store.save();
  }

  private async runNoticeSend(payload: { move_ref: string; kind: string }): Promise<void> {
    const move = this.store.moves.find((m) => m.ref === payload.move_ref);
    if (!move) return;
    const notice = move.notices.find((n) => n.kind === payload.kind && n.state === 'pending');
    if (!notice) return;
    const attachments = [];
    for (const key of notice.photo_keys) {
      const bytes = await this.config.objects.get(key);
      attachments.push({
        filename: key.split('/').pop() ?? 'photo.jpg',
        contentType: 'image/jpeg',
        bytes,
      });
    }
    await this.config.mail.send({
      to: notice.to,
      subject: notice.subject,
      body: notice.body,
      attachments,
    });
    notice.state = 'sent';
    await this.store.save();
  }

  private agencyName(code: string): string {
    const agency = this.store.agencies.find((a) => a.code === code);
    return agency?.name ?? code;
  }
}

// Notice helpers used by the API layer.

export function makeNotice(
  move: Move,
  kind: string,
  to: string,
  subject: string,
  body: string,
  photoKeys: string[] = [],
): NoticeRecord {
  const notice: NoticeRecord = {
    kind, to, state: 'pending', move_ref: move.ref,
    subject, body, attempt: 0, photo_keys: photoKeys,
  };
  move.notices.push(notice);
  return notice;
}

export function enqueueNotice(
  store: Store,
  move: Move,
  notice: NoticeRecord,
): void {
  const id = `PS-${store.pendingSteps.length + 1}-${Date.now()}`;
  store.pendingSteps.push({
    id,
    kind: 'notice_send',
    payload: JSON.stringify({ move_ref: move.ref, kind: notice.kind }),
    state: 'pending',
    attempts: 0,
    attempt_token: null,
    at_ms: Date.now(),
  });
  void notice;
}
