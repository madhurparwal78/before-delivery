/** The home detail dialog, its hold confirmation flow and the yellow confirmation. */

import { post } from '../api';
import { announce, closeLayer, el, icon, openLayer, prefersReducedMotion } from '../dom';
import { money, salesTime, unitFacts } from '../display';
import { currentAccount, openSignInDialog } from '../session';
import { STATUS_LABELS, type DisplayStatus } from '../../shared/labels';
import type { Hold, PublicUnit } from '../../shared/types';

const GROW_MS = 350;

export interface DetailOptions {
  unit: PublicUnit;
  heldByYou: boolean;
  lensImageSrc: string | null;
  lensRect: { x: number; y: number; size: number };
  returnFocus: HTMLElement | null;
  onClose: () => void;
  onHoldPlaced: (hold: Hold) => void;
  onHoldLost: (code: string) => void;
  /** Re-reads the unit so a changed price can be shown in place. */
  readUnit: (code: string) => Promise<PublicUnit | 'withdrawn' | null>;
}

export class DetailDialog {
  readonly node: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly viewPanel: HTMLElement;
  private readonly body: HTMLElement;
  private unit: PublicUnit;
  private heldByYou: boolean;
  private withdrawn = false;
  private holdButton: HTMLButtonElement | null = null;
  private confirmed: Hold | null = null;

  constructor(private readonly options: DetailOptions) {
    this.unit = options.unit;
    this.heldByYou = options.heldByYou;
    this.viewPanel = el('div', { class: 'view-panel' });
    this.body = el('div', { class: 'detail-body' });
    this.panel = el('div', {
      class: 'dialog detail-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': `Home ${this.unit.code}`,
    }, [
      el('p', { class: 'giant-crop detail-numeral', 'aria-hidden': 'true', text: String(this.unit.floor) }),
      el('button', { type: 'button', class: 'close', 'aria-label': 'Close', onclick: () => this.close() }, [icon('x')]),
      this.viewPanel,
      this.body,
    ]);
    this.node = el('div', { class: 'dialog-layer detail-layer' }, [this.panel]);
    document.getElementById('app')?.append(this.node);
    this.paintView();
    this.paintBody();
    this.grow();
    openLayer({
      node: this.node,
      returnFocus: options.returnFocus,
      onEscape: () => this.close(),
      initialFocus: () => this.panel.querySelector<HTMLElement>('.close'),
    });
  }

  /** The lens circle grows to the width of the view panel, then the content appears. */
  private grow(): void {
    if (prefersReducedMotion()) return;
    this.panel.classList.add('detail-growing');
    const rect = this.options.lensRect;
    this.viewPanel.style.setProperty('--lens-size', `${rect.size}px`);
    window.setTimeout(() => {
      this.panel.classList.remove('detail-growing');
    }, GROW_MS);
  }

  private paintView(): void {
    this.viewPanel.replaceChildren();
    if (this.withdrawn) {
      this.viewPanel.append(el('p', { class: 'view-note', text: 'This home has been withdrawn.' }));
      return;
    }
    if (this.unit.viewPhotographed && this.unit.viewUrl) {
      const image = el('img', {
        class: 'view-image',
        src: this.options.lensImageSrc ?? this.unit.viewUrl,
        alt: `View from ${this.unit.code}`,
      }) as HTMLImageElement;
      image.addEventListener('error', () => {
        image.replaceWith(el('p', { class: 'view-note', text: 'View photograph unavailable right now.' }));
      });
      this.viewPanel.append(image);
      return;
    }
    this.viewPanel.append(el('p', { class: 'view-note', text: 'No view photograph yet.' }));
  }

  private status(): DisplayStatus {
    if (this.withdrawn) return 'withdrawn';
    return this.heldByYou && this.unit.status === 'held' ? 'held-by-you' : this.unit.status;
  }

  private paintBody(): void {
    const unit = this.unit;
    const status = this.status();
    this.body.replaceChildren();
    if (this.confirmed) {
      this.body.append(
        el('h2', { class: 'confirm-heading', text: 'This home is held for you.' }),
        el('p', { class: 'confirm-line', text: `Held until ${salesTime(this.confirmed.endsAt)}.` }),
        el('a', { class: 'action action-link', href: `/holds/${this.confirmed.id}`, text: 'Open your hold' }),
      );
      this.panel.classList.add('detail-confirmed');
      return;
    }
    this.body.append(
      el('h2', { class: 'detail-code', text: `Home ${unit.code}` }),
      el('p', { class: 'detail-price', text: `$${money(unit.price)}` }),
      el('p', { class: 'detail-rates', text: `$${money(unit.pricePerM2)} per m² · $${money(unit.pricePerSqft)} per sq ft` }),
      el('ul', { class: 'detail-facts', role: 'list' }, [
        ...unitFacts(unit).map((fact) => el('li', { text: fact })),
        el('li', { class: 'detail-status' }, [
          el('span', { text: STATUS_LABELS[status] }),
          ...(unit.syncing ? [el('span', { class: 'tag-syncing', text: 'Syncing' })] : []),
        ]),
        el('li', { text: unit.viewPhotographed ? 'View photographed' : 'No view photograph yet' }),
      ]),
    );
    if (!this.heldByYou) {
      const disabled = this.withdrawn || unit.status === 'held' || unit.status === 'reserved';
      this.holdButton = el('button', {
        type: 'button',
        class: 'action action-accent',
        text: 'Hold this home',
        onclick: () => this.startHold(),
      }) as HTMLButtonElement;
      this.holdButton.disabled = disabled;
      this.body.append(this.holdButton);
    } else {
      this.holdButton = null;
    }
  }

  setUnit(unit: PublicUnit, heldByYou: boolean): void {
    if (this.confirmed) return;
    const priceChanged = unit.price !== this.unit.price || unit.priceVersion !== this.unit.priceVersion;
    if (unit.priceVersion < this.unit.priceVersion) return;
    this.unit = unit;
    this.heldByYou = heldByYou;
    this.withdrawn = false;
    this.paintBody();
    if (!this.unit.viewPhotographed) this.paintView();
    if (priceChanged) announce(`Price for ${unit.code} is now $${money(unit.price)}.`);
  }

  setHeldByYou(heldByYou: boolean): void {
    if (this.confirmed || this.heldByYou === heldByYou) return;
    this.heldByYou = heldByYou;
    this.paintBody();
  }

  setStatus(status: 'available' | 'held' | 'reserved'): void {
    if (this.confirmed || this.unit.status === status) return;
    this.unit = { ...this.unit, status };
    this.paintBody();
  }

  markWithdrawn(): void {
    if (this.withdrawn) return;
    this.confirmed = null;
    this.withdrawn = true;
    this.paintView();
    this.paintBody();
    announce(`${this.unit.code} has been withdrawn.`);
  }

  code(): string {
    return this.unit.code;
  }

  close(): void {
    closeLayer(this.node);
    this.options.onClose();
  }

  private startHold(): void {
    const account = currentAccount();
    if (!account) {
      openSignInDialog({
        forHold: true,
        returnFocus: this.holdButton,
        onSignedIn: () => this.openConfirm(),
      });
      return;
    }
    this.openConfirm();
  }

  /** Opens the confirm dialog with a fresh key and the price the buyer can see. */
  openConfirm(focusConfirm = false): void {
    let price = this.unit.price;
    let priceVersion = this.unit.priceVersion;
    let idempotencyKey = crypto.randomUUID();
    let countdown = 0;

    const question = el('p', { class: 'confirm-question', text: `Hold ${this.unit.code} at $${money(price)}?` });
    const note = el('p', {
      class: 'confirm-note',
      text: 'No payment is taken. You can release the hold at any time.',
    });
    const message = el('p', { class: 'confirm-message' });
    const confirm = el('button', { type: 'button', class: 'action action-dark', text: 'Confirm hold' }) as HTMLButtonElement;
    const cancel = el('button', {
      type: 'button',
      class: 'action action-quiet',
      text: 'Cancel',
      onclick: () => closeLayer(layerNode),
    });
    const panel = el('div', {
      class: 'dialog confirm-dialog',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-label': 'Confirm hold',
    }, [question, note, message, el('div', { class: 'dialog-actions' }, [confirm, cancel])]);
    const layerNode = el('div', { class: 'dialog-layer' }, [panel]);
    document.getElementById('app')?.append(layerNode);

    const countDown = (seconds: number): void => {
      countdown = seconds;
      confirm.disabled = true;
      const tick = (): void => {
        countdown -= 1;
        if (countdown <= 0) {
          confirm.disabled = false;
          message.textContent = '';
          return;
        }
        message.textContent = `Too many hold attempts. Try again in ${countdown} seconds.`;
        window.setTimeout(tick, 1000);
      };
      window.setTimeout(tick, 1000);
    };

    const send = async (): Promise<void> => {
      confirm.disabled = true;
      const label = confirm.textContent;
      confirm.textContent = 'Holding...';
      const result = await post<{ hold: Hold }>('/api/holds', {
        body: { unitCode: this.unit.code, priceVersion },
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      confirm.textContent = label ?? 'Confirm hold';
      if (result.ok && result.data) {
        closeLayer(layerNode, false);
        this.confirmed = result.data.hold;
        this.heldByYou = true;
        this.paintBody();
        this.options.onHoldPlaced(result.data.hold);
        const heading = this.body.querySelector<HTMLElement>('.confirm-heading');
        heading?.setAttribute('tabindex', '-1');
        heading?.focus();
        return;
      }
      if (result.unreachable) {
        message.textContent = "We couldn't reach Highwater. Your hold was not placed yet. Try again.";
        confirm.disabled = false;
        return;
      }
      idempotencyKey = crypto.randomUUID();
      const error = result.error;
      if (!error) {
        confirm.disabled = false;
        return;
      }
      message.textContent = error.message;
      if (result.status === 401) {
        closeLayer(layerNode, false);
        openSignInDialog({
          forHold: true,
          email: currentAccount()?.email,
          focusPassword: true,
          returnFocus: this.holdButton,
          onSignedIn: () => this.openConfirm(true),
        });
        return;
      }
      if (error.code === 'unit_unavailable' || error.code === 'unit_reserved') {
        this.options.onHoldLost(this.unit.code);
        this.unit = { ...this.unit, status: error.code === 'unit_reserved' ? 'reserved' : 'held' };
        this.paintBody();
        confirm.disabled = true;
        return;
      }
      if (error.code === 'price_changed') {
        const fresh = await this.options.readUnit(this.unit.code);
        if (fresh && fresh !== 'withdrawn') {
          this.unit = fresh;
          price = fresh.price;
          priceVersion = fresh.priceVersion;
          this.paintBody();
          question.textContent = `Hold ${this.unit.code} at $${money(price)}?`;
        }
        confirm.disabled = false;
        confirm.focus();
        return;
      }
      if (result.status === 429) {
        countDown(result.retryAfterSeconds ?? 1);
        return;
      }
      confirm.disabled = false;
    };

    confirm.addEventListener('click', () => void send());
    openLayer({
      node: layerNode,
      returnFocus: this.holdButton,
      initialFocus: () => (focusConfirm ? confirm : confirm),
    });
  }
}
