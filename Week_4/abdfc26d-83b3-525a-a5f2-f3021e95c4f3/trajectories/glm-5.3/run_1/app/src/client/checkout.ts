import { api, freshIdempotencyKey, mmss, money, vatOf, VAT_TABLE, type OrderJson, type PieceJson } from './api.js';
import { announce, focusTrap } from './motion.js';
import type { EditionLens } from './lens.js';

export interface CheckoutConfig {
  dialog: HTMLDialogElement;
  lens: EditionLens;
  piece: PieceJson;
  statusRegion: HTMLElement | null;
  afterPaid(order: OrderJson): void;
}

/**
 * Checkout sheet: server-timed countdown, VAT recomputation from the rate
 * table, single-submission Pay with the browser idempotency-key rule, and
 * focus kept inside the dialog.
 */
export class CheckoutSheet {
  private countdown = 0;
  private countdownTimer = 0;
  private payKey = '';
  private lastPayFailed5xx = false;
  private order: OrderJson | null = null;
  private elements!: {
    form: HTMLFormElement; name: HTMLInputElement; email: HTMLInputElement; country: HTMLSelectElement;
    pay: HTMLButtonElement; release: HTMLButtonElement; close: HTMLButtonElement;
    summary: HTMLElement; countdownLine: HTMLElement; net: HTMLElement; vat: HTMLElement; gross: HTMLElement;
    openLibrary: HTMLAnchorElement;
  };

  constructor(private config: CheckoutConfig) {
    const dialog = config.dialog;
    const q = <T extends HTMLElement>(sel: string): T => dialog.querySelector<T>(sel)!;
    this.elements = {
      form: q('form'),
      name: q('[name="billing_name"]'),
      email: q('[name="email"]'),
      country: q('[name="billing_country"]'),
      pay: q('[data-pay]'),
      release: q('[data-release]'),
      close: q('[data-close]'),
      summary: q('[data-error-summary]'),
      countdownLine: q('[data-countdown]'),
      net: q('[data-net]'),
      vat: q('[data-vat]'),
      gross: q('[data-gross]'),
      openLibrary: q('[data-open-library]')
    };
    this.bind();
    this.recompute();
  }

  private bind(): void {
    this.elements.country.addEventListener('change', () => this.recompute());
    this.elements.close.addEventListener('click', () => this.close());
    this.elements.release.addEventListener('click', () => void this.releaseHold());
    this.elements.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.pay();
    });
  }

  private recompute(): void {
    const net = this.config.piece.price_cents ?? 0;
    const rate = VAT_TABLE[this.elements.country.value]?.rate ?? 0;
    const vat = vatOf(net, rate);
    this.elements.net.textContent = `${money(net)} net`;
    this.elements.vat.textContent = `VAT ${rate}% — ${money(vat)}`;
    this.elements.gross.textContent = money(net + vat);
    this.elements.pay.textContent = `Pay ${money(net + vat)}`;
  }

  open(order: OrderJson): void {
    this.order = order;
    this.payKey = freshIdempotencyKey();
    this.lastPayFailed5xx = false;
    this.elements.summary.hidden = true;
    this.elements.openLibrary.hidden = true;
    this.recompute();
    this.dialogOpen();
    this.startCountdown(order.seconds_left ?? 0);
    focusTrap(this.config.dialog, () => this.close(), this.elements.name);
  }

  private dialogOpen(): void {
    const dialog = this.config.dialog;
    if (!dialog.open) dialog.showModal();
    if (window.innerWidth >= 768) dialog.classList.add('right');
    else dialog.classList.remove('right');
  }

  private startCountdown(seconds: number): void {
    if (this.countdownTimer) window.clearInterval(this.countdownTimer);
    this.countdown = seconds;
    this.paintCountdown();
    this.countdownTimer = window.setInterval(() => {
      this.countdown -= 1;
      this.paintCountdown();
      if (this.countdown <= 0) {
        window.clearInterval(this.countdownTimer);
        this.countdownTimer = 0;
        this.config.lens.unlock();
        this.close();
        announce(this.config.statusRegion, `Your hold on edition ${this.order?.edition} expired.`);
      }
    }, 1000);
  }

  private paintCountdown(): void {
    this.elements.countdownLine.textContent = `Held for ${mmss(Math.max(0, this.countdown))}`;
    const remaining = Math.max(0, this.countdown);
    if (remaining === 30) {
      announce(this.config.statusRegion, `30 seconds left on edition ${this.order?.edition}.`);
    } else if (remaining > 0 && remaining % 60 === 0) {
      const minutes = remaining / 60;
      announce(this.config.statusRegion, `${minutes === 1 ? '1 minute' : `${minutes} minutes`} left on edition ${this.order?.edition}.`);
    }
  }

  refreshOrder(order: OrderJson): void {
    this.order = order;
    if (order.seconds_left !== null) {
      this.countdown = order.seconds_left;
      this.paintCountdown();
    }
  }

  close(): void {
    if (this.countdownTimer) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = 0;
    }
    this.config.dialog.close();
    this.config.lens.focusSlider();
  }

  async releaseHold(): Promise<void> {
    if (!this.order) return;
    await api('DELETE', `/api/orders/${this.order.id}/hold`);
    this.config.lens.unlock();
    this.close();
  }

  reopenIfHeld(order: OrderJson): void {
    this.open(order);
  }

  getPayKey(): string {
    return this.payKey;
  }

  async pay(): Promise<void> {
    if (!this.order) return;
    const name = (this.elements.name as HTMLInputElement).value.trim();
    const email = (this.elements.email as HTMLInputElement).value.trim();
    const country = (this.elements.country as HTMLSelectElement).value;
    const fields: Record<string, string> = {};
    if (country === 'OTHER') fields.billing_country = `We can't invoice that country yet.`;
    if (name.length < 1) fields.billing_name = `Enter the name for the invoice.`;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = `Enter an email address.`;
    if (Object.keys(fields).length > 0) {
      this.showErrors(fields);
      return;
    }
    this.elements.pay.setAttribute('disabled', 'true');
    announce(this.config.statusRegion, `Payment sent. Waiting for Kill Bill to confirm.`);
    const key = this.lastPayFailed5xx ? this.payKey : freshIdempotencyKey();
    const result = await api<OrderJson>('POST', `/api/orders/${this.order.id}/buy`, { billing_name: name, email, billing_country: country }, { idempotencyKey: key });
    this.elements.pay.removeAttribute('disabled');
    if (result.status >= 500 || result.status === 0) {
      this.lastPayFailed5xx = true;
      announce(this.config.statusRegion, `Payments are offline right now. Your hold is kept until its timer runs out.`);
      return;
    }
    if (result.status >= 400) {
      const body = result.body as { error: { code: string; fields?: Record<string, string> } };
      if (body.error?.fields) {
        this.showErrors(body.error.fields);
        return;
      }
      if (body.error?.code === 'hold_expired') {
        announce(this.config.statusRegion, `Your hold on edition ${this.order.edition} expired.`);
        this.close();
        return;
      }
      announce(this.config.statusRegion, `Payment failed. Edition ${this.order.edition} is released.`);
      this.close();
      return;
    }
    this.lastPayFailed5xx = false;
    void this.waitAndFinish(result.body as OrderJson);
  }

  private async waitAndFinish(order: OrderJson): Promise<void> {
    for (let i = 0; i < 90; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const check = await api<OrderJson>('GET', `/api/orders/${order.id}`);
      const current = check.body as OrderJson;
      if (current.state === 'paid' || current.state === 'invoiced' || current.state === 'receipted') {
        if (current.invoice_status === 'ready') {
          announce(this.config.statusRegion, `Payment confirmed. Edition ${current.edition} of ${current.edition_count} is yours.`);
        } else {
          announce(this.config.statusRegion, `Paid, invoice pending. Invoice ${current.invoice_number} will be ready shortly.`);
        }
        this.config.afterPaid(current);
        this.elements.openLibrary.hidden = false;
        return;
      }
      if (current.state === 'failed') {
        announce(this.config.statusRegion, `Payment failed. Edition ${current.edition} is released.`);
        this.close();
        return;
      }
    }
  }

  private showErrors(fields: Record<string, string>): void {
    const entries = Object.entries(fields);
    const links = entries.map(([field]) => {
      const target = this.config.dialog.querySelector<HTMLElement>(`[name="${field}"]`);
      return `<a href="#${target?.id ?? ''}">${field}</a>`;
    }).join(', ');
    this.elements.summary.innerHTML = `<p>Check ${entries.length} field${entries.length === 1 ? '' : 's'}.</p><p>${links}</p>`;
    this.elements.summary.hidden = false;
    announce(this.config.statusRegion, `Check ${entries.length} fields.`);
  }
}
