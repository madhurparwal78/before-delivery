import { formatInstantSeconds } from '../domain/porttime.ts';
import { AmbiguousBillingReply, type BillingProvider } from './providers/billing.ts';
import type { MailAttachment, MailProvider } from './providers/mail.ts';
import type { ObjectStore } from './providers/objectstore.ts';
import type { Store } from './store/store.ts';
import type { StepRecord } from './store/types.ts';

const RETRY_MS = 15_000;

/** Completion, charge posting, invoice commit and each notice are separate recorded steps. */
export class StepRunner {
  private readonly store: Store;
  private readonly billing: BillingProvider;
  private readonly objectStore: ObjectStore;
  private readonly mail: MailProvider;
  private readonly inFlight = new Map<string, Promise<void>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    store: Store,
    billing: BillingProvider,
    objectStore: ObjectStore,
    mail: MailProvider,
  ) {
    this.store = store;
    this.billing = billing;
    this.objectStore = objectStore;
    this.mail = mail;
  }

  start(): void {
    this.timer = setInterval(() => void this.runPending(), RETRY_MS);
    this.timer.unref();
    void this.runPending();
  }

  /** Runs every pending step once, so an outage leaves the state pending until it clears. */
  async runPending(): Promise<void> {
    const pending = this.store
      .read()
      .steps.filter((step) => step.state === 'pending')
      .map((step) => step.id);
    await Promise.all(pending.map((id) => this.run(id)));
  }

  async runForTarget(kind: StepRecord['kind'], targetId: string): Promise<void> {
    const step = this.store
      .read()
      .steps.find((entry) => entry.kind === kind && entry.target_id === targetId);
    if (step === undefined) return;
    await this.run(step.id);
  }

  private run(stepId: string): Promise<void> {
    const existing = this.inFlight.get(stepId);
    if (existing !== undefined) return existing;
    const promise = this.execute(stepId).finally(() => this.inFlight.delete(stepId));
    this.inFlight.set(stepId, promise);
    return promise;
  }

  private async execute(stepId: string): Promise<void> {
    const step = this.store.read().steps.find((entry) => entry.id === stepId);
    if (step === undefined || step.state === 'done') return;
    this.store.mutate(() => {
      step.attempts += 1;
      step.last_attempt_at = formatInstantSeconds(Date.now());
      step.last_error = null;
    });
    try {
      switch (step.kind) {
        case 'charge_post':
          await this.postCharges(step.target_id);
          break;
        case 'invoice_commit':
          await this.commitInvoice(step.target_id);
          break;
        case 'notice_send':
          await this.sendNotice(step.target_id);
          break;
      }
    } catch (cause) {
      this.store.mutate(() => {
        step.last_error = cause instanceof Error ? cause.message : 'step failed';
      });
    }
  }

  private markDone(kind: StepRecord['kind'], targetId: string): void {
    for (const step of this.store.read().steps) {
      if (step.kind === kind && step.target_id === targetId) step.state = 'done';
    }
  }

  private async accountIdFor(agencyCode: string): Promise<string> {
    const state = this.store.read();
    const agency = state.agencies.find((entry) => entry.code === agencyCode);
    if (agency === undefined) throw new Error(`unknown agency ${agencyCode}`);
    if (agency.killbill_account_id !== null) return agency.killbill_account_id;
    const accountId = await this.billing.accountIdFor(agency.code, agency.name);
    this.store.mutate(() => {
      agency.killbill_account_id = accountId;
    });
    return accountId;
  }

  private async postCharges(invoiceId: string): Promise<void> {
    const state = this.store.read();
    const invoice = state.invoices.find((entry) => entry.id === invoiceId);
    if (invoice === undefined || invoice.charge_state === 'posted') {
      this.store.mutate(() => this.markDone('charge_post', invoiceId));
      return;
    }
    const accountId = await this.accountIdFor(invoice.agency_code);
    const descriptions = invoice.lines.map((line) => `${invoice.move_ref} ${line.label}`);
    const items = invoice.lines.map((line, index) => ({
      amount: (line.amount_cents / 100).toFixed(2),
      description: descriptions[index] as string,
    }));
    let killbillInvoiceId: string;
    try {
      killbillInvoiceId = await this.billing.postExternalCharges(accountId, items);
    } catch (cause) {
      if (!(cause instanceof AmbiguousBillingReply)) throw cause;
      const adopted = await this.billing.draftInvoiceHolding(accountId, descriptions);
      if (adopted === null) throw cause;
      killbillInvoiceId = adopted;
    }
    this.store.mutate(() => {
      invoice.killbill_invoice_id = killbillInvoiceId;
      invoice.charge_state = 'posted';
      this.markDone('charge_post', invoiceId);
    });
  }

  /** Only a provider-confirmed commit makes an invoice issued. */
  private async commitInvoice(invoiceId: string): Promise<void> {
    const state = this.store.read();
    const invoice = state.invoices.find((entry) => entry.id === invoiceId);
    if (invoice === undefined) return;
    if (invoice.state === 'issued') {
      this.store.mutate(() => this.markDone('invoice_commit', invoiceId));
      return;
    }
    if (invoice.charge_state === 'pending') {
      await this.postCharges(invoiceId);
      if (invoice.charge_state === 'pending') return;
    }
    const killbillInvoiceId = invoice.killbill_invoice_id;
    if (killbillInvoiceId === null) return;
    await this.billing.commitInvoice(killbillInvoiceId);
    const confirmed = await this.billing.readInvoice(killbillInvoiceId);
    if (confirmed.status !== 'COMMITTED') {
      throw new Error(`billing provider has not committed invoice ${invoiceId}`);
    }
    this.store.mutate(() => {
      invoice.state = 'issued';
      invoice.number = confirmed.invoiceNumber;
      invoice.balance_cents = confirmed.balanceCents;
      invoice.balance_confirmed_at = formatInstantSeconds(Date.now());
      const move = state.moves.find((entry) => entry.ref === invoice.move_ref);
      if (move !== undefined && invoice.event_kind === 'Completed' && move.status === 'Completed') {
        move.status = 'Invoiced';
        move.version += 1;
        move.history.push({
          at: formatInstantSeconds(Date.now()),
          status: 'Invoiced',
          by: 'Kill Bill',
        });
      }
      this.markDone('invoice_commit', invoiceId);
    });
  }

  private async sendNotice(noticeId: string): Promise<void> {
    const state = this.store.read();
    const notice = state.notices.find((entry) => entry.id === noticeId);
    if (notice === undefined || notice.state === 'sent') {
      this.store.mutate(() => this.markDone('notice_send', noticeId));
      return;
    }
    const attachments: MailAttachment[] = [];
    for (const photoId of notice.photo_ids) {
      const photo = state.photos.find((entry) => entry.id === photoId);
      if (photo === undefined) continue;
      const stored = await this.objectStore.get(photo.key);
      attachments.push({
        filename: `${photo.id}.${photo.content_type.split('/')[1] ?? 'bin'}`,
        content: stored.body,
        contentType: photo.content_type,
      });
    }
    await this.mail.send({
      to: notice.to,
      subject: notice.subject,
      text: notice.body,
      attachments,
    });
    this.store.mutate(() => {
      notice.state = 'sent';
      notice.sent_at = formatInstantSeconds(Date.now());
      this.markDone('notice_send', noticeId);
    });
  }
}
