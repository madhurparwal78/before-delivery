import { el } from '../../shared/dom.js';
import { PaperDialog } from './shell.js';

export interface SatchelOffer {
  satchel_id: string;
  name: string;
  price: number;
  colour: string;
  owned: boolean;
  worn: boolean;
}

export class OutfitterDialog {
  readonly dialog = new PaperDialog({ label: 'Outfitter', className: 'outfitter' });

  constructor(
    private readonly onBuy: (satchel: SatchelOffer) => void,
    private readonly onWear: (satchel: SatchelOffer) => void,
  ) {}

  render(offers: SatchelOffer[]): void {
    this.dialog.replace([
      el(
        'div',
        { class: 'outfitter-rows' },
        offers.map((offer) => {
          const row = el('div', { class: 'outfitter-row' }, [
            el('span', { class: 'satchel-name' }, [offer.name]),
            el('span', { class: 'satchel-price' }, [`${offer.price} stamps`]),
          ]);
          if (offer.worn) {
            row.append(el('span', { class: 'satchel-state' }, ['Wearing']));
          } else if (offer.owned) {
            const wear = el('button', { type: 'button' }, [`Wear ${offer.name}`]);
            wear.addEventListener('click', () => this.onWear(offer));
            row.append(wear);
          } else {
            const buy = el('button', { type: 'button', class: 'primary' }, [`Buy ${offer.name}`]);
            buy.addEventListener('click', () => this.onBuy(offer));
            row.append(buy);
          }
          return row;
        }),
      ),
    ]);
  }
}

export interface Movement {
  movement_id: string;
  kind: 'delivery' | 'purchase';
  created_at: string;
  entries: Array<{ account: string; amount: number; ref: string }>;
}

export class StampHistoryDialog {
  readonly dialog = new PaperDialog({ label: 'Stamp history', className: 'stamp-history' });
  readonly showOlder = el('button', { type: 'button' }, ['Show older']);
  private readonly balanceLine = el('p', { class: 'history-balance' });
  private readonly list = el('ul', { role: 'list', 'aria-label': 'Movements', class: 'movements' });

  constructor(onShowOlder: () => void) {
    this.showOlder.addEventListener('click', onShowOlder);
    this.dialog.replace([this.balanceLine, this.list, this.showOlder]);
  }

  reset(): void {
    this.list.replaceChildren();
  }

  render(balance: number, movements: Movement[], append: boolean, hasOlder: boolean): void {
    this.balanceLine.textContent = `${balance} stamps`;
    const rows = movements.map((movement) => {
      const courier = movement.entries.find((entry) => entry.account === 'courier');
      const size = Math.abs(courier?.amount ?? 0);
      const label =
        movement.kind === 'delivery'
          ? `+${size} stamps · Delivery`
          : `\u2212${size} stamps · Outfitter`;
      return el('li', {}, [label]);
    });
    if (append) this.list.append(...rows);
    else this.list.replaceChildren(...rows);
    this.showOlder.hidden = !hasOlder;
  }
}

export class EmailDialog {
  readonly dialog: PaperDialog;
  readonly field: HTMLInputElement;
  readonly send: HTMLButtonElement;
  private readonly error = el('p', { class: 'field-error' });

  constructor(options: {
    label: string;
    fieldLabel: string;
    sendLabel: string;
    onSend: (value: string) => void;
    onFieldChange?: () => void;
  }) {
    this.field = el('input', { type: 'email' });
    this.field.setAttribute('aria-label', options.fieldLabel);
    this.send = el('button', { type: 'button', class: 'primary' }, [options.sendLabel]);
    this.send.addEventListener('click', () => options.onSend(this.field.value));
    this.field.addEventListener('input', () => options.onFieldChange?.());
    this.dialog = new PaperDialog({ label: options.label, className: 'email-dialog' });
    this.dialog.replace([this.field, this.send, this.error]);
  }

  showError(message: string | null): void {
    this.error.textContent = message ?? '';
  }
}

export class ConfirmDialog {
  readonly dialog: PaperDialog;
  readonly confirm: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
  private readonly text = el('p', { class: 'confirm-text' });

  constructor(options: {
    label: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
  }) {
    this.confirm = el('button', { type: 'button', class: 'primary' }, [options.confirmLabel]);
    this.cancel = el('button', { type: 'button' }, [options.cancelLabel]);
    this.confirm.addEventListener('click', () => options.onConfirm());
    this.dialog = new PaperDialog({
      label: options.label,
      role: 'alertdialog',
      className: 'confirm',
    });
    this.cancel.addEventListener('click', () => this.dialog.close());
    this.dialog.replace([this.text, el('div', { class: 'confirm-actions' }, [this.confirm, this.cancel])]);
  }

  ask(copy: string, opener: HTMLElement, startOn: HTMLElement = this.confirm): void {
    this.text.textContent = copy;
    this.dialog.show(opener, startOn);
  }
}
