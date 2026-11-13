/**
 * The Liquidate position dialog. It follows the WAI-ARIA modal dialog
 * pattern: focus is trapped and returned, and Escape closes one layer at a
 * time, the menu before the dialog.
 */

import { formatAmount } from '../../domain/deskformat.ts';
import { ApiProblem, request } from '../api.ts';
import { el } from '../dom.ts';
import { applyFieldErrors, button, Field, whilePending } from './fields.ts';
import type { LiveRegions } from './live.ts';
import { store } from '../store.ts';
import type { PositionDto, SettlementDto } from '../types.ts';
import { amountUnits } from '../views/supply.ts';
import { freshKey } from '../views/view.ts';

interface DialogHandlers {
  readonly onFilled: (settlement: SettlementDto) => void;
  readonly onConflict: () => void;
}

export class LiquidateDialog {
  readonly element: HTMLElement;
  private readonly repayAmount: Field;
  private readonly optionsButton: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private position: PositionDto | null = null;
  private opener: HTMLElement | null = null;
  private menuOpen = false;
  private fillKey = freshKey();
  private fillSignature = '';

  constructor(
    private readonly live: LiveRegions,
    private readonly handlers: DialogHandlers,
  ) {
    this.repayAmount = new Field('Repay amount', {
      kind: 'amount',
      decimals: () => (this.position === null ? 0 : store.decimalsOf(this.position.debt_asset)),
    });
    this.optionsButton = button('Repay options');
    this.optionsButton.setAttribute('aria-haspopup', 'menu');
    this.optionsButton.setAttribute('aria-expanded', 'false');
    this.menu = el('div', { role: 'menu', 'aria-label': 'Repay options', class: 'menu' });
    this.confirmButton = button('Confirm liquidation');
    this.confirmButton.classList.add('danger');
    this.cancelButton = button('Cancel');

    for (const [label, pick] of [
      ['Use max repay', (max: bigint): bigint => max],
      ['Use half of max repay', (max: bigint): bigint => max / 2n],
    ] as const) {
      const item = el('button', {
        type: 'button',
        role: 'menuitem',
        class: 'menu-item',
        text: label,
      });
      item.addEventListener('click', () => {
        const maxRepay = BigInt(this.position?.max_repay ?? '0');
        const decimals =
          this.position === null ? 0 : store.decimalsOf(this.position.debt_asset);
        this.repayAmount.value = formatAmount(pick(maxRepay), decimals);
        this.repayAmount.validate();
        this.closeMenu();
        this.optionsButton.focus();
      });
      this.menu.append(item);
    }

    this.element = el(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Liquidate position',
        class: 'dialog',
      },
      [
        el('h2', { class: 'zone-head', text: 'Liquidate position' }),
        this.repayAmount.row,
        el('div', { class: 'menu-wrap' }, [this.optionsButton, this.menu]),
        el('div', { class: 'dialog-actions' }, [this.confirmButton, this.cancelButton]),
      ],
    );
    this.element.hidden = true;
    this.menu.hidden = true;

    this.optionsButton.addEventListener('click', () => this.toggleMenu());
    this.optionsButton.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.openMenu();
      }
    });
    this.cancelButton.addEventListener('click', () => this.close());
    this.confirmButton.addEventListener('click', () => void this.confirm());
    this.repayAmount.submitsWith(this.confirmButton);

    this.element.addEventListener('keydown', (event) => this.onKeydown(event));
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Escape closes one layer at a time.
      if (this.menuOpen) {
        this.closeMenu();
        this.optionsButton.focus();
        return;
      }
      this.close();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = this.focusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      // Tab and Shift+Tab cycle within the dialog.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  private focusable(): HTMLElement[] {
    const inMenu = this.menuOpen
      ? Array.from(this.menu.querySelectorAll<HTMLElement>('button'))
      : [];
    return [
      this.repayAmount.input,
      this.optionsButton,
      ...inMenu,
      this.confirmButton,
      this.cancelButton,
    ].filter((node) => !node.hidden);
  }

  private toggleMenu(): void {
    if (this.menuOpen) this.closeMenu();
    else this.openMenu();
  }

  private openMenu(): void {
    this.menuOpen = true;
    this.menu.hidden = false;
    this.optionsButton.setAttribute('aria-expanded', 'true');
    this.menu.querySelector<HTMLElement>('button')?.focus();
  }

  private closeMenu(): void {
    this.menuOpen = false;
    this.menu.hidden = true;
    this.optionsButton.setAttribute('aria-expanded', 'false');
  }

  /** Opens with focus in Repay amount, prefilled with the row's max repay. */
  open(position: PositionDto, opener: HTMLElement): void {
    this.position = position;
    this.opener = opener;
    this.element.hidden = false;
    this.closeMenu();
    this.repayAmount.value = formatAmount(
      BigInt(position.max_repay),
      store.decimalsOf(position.debt_asset),
    );
    this.repayAmount.show(null);
    this.repayAmount.focus();
  }

  close(): void {
    if (this.element.hidden) return;
    this.closeMenu();
    this.element.hidden = true;
    // Focus returns to the Liquidate button that opened it.
    this.opener?.focus();
  }

  private async confirm(): Promise<void> {
    const position = this.position;
    if (position === null) return;
    if (!this.repayAmount.validate() || !this.repayAmount.ready) {
      this.repayAmount.focus();
      return;
    }
    const body = {
      repay_amount: amountUnits(this.repayAmount.value, store.decimalsOf(position.debt_asset)),
      // The submission carries the round shown in that row.
      round: position.round,
    };
    const signature = `${position.position_id}|${body.repay_amount}|${body.round}`;
    if (signature !== this.fillSignature) {
      this.fillSignature = signature;
      this.fillKey = freshKey();
    }

    this.live.clearProblems();
    this.live.announce('Submitting liquidation');
    try {
      await whilePending(this.confirmButton, async () => {
        const reply = await request<SettlementDto>(
          'POST',
          `/api/positions/${position.position_id}/liquidations`,
          { token: store.token, body, idempotencyKey: this.fillKey },
        );
        const debtDecimals = store.decimalsOf(position.debt_asset);
        const collateralDecimals = store.decimalsOf(position.collateral_asset);
        this.live.announce(
          `Liquidation filled. Repaid ${formatAmount(BigInt(reply.repaid ?? '0'), debtDecimals)} ${position.debt_asset}, received ${formatAmount(BigInt(reply.seized ?? '0'), collateralDecimals)} ${position.collateral_asset}.`,
        );
        this.element.hidden = true;
        this.fillSignature = '';
        await store.refresh();
        this.handlers.onFilled(reply);
      });
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 422) {
        this.live.validation(
          applyFieldErrors([{ name: 'repay_amount', field: this.repayAmount }], error.errors),
        );
        return;
      }
      // On a conflict the dialog closes, the copy appears in Problems, focus
      // returns to the row's Liquidate button and the queue refreshes.
      this.live.report(error);
      const opener = this.opener;
      this.closeMenu();
      this.element.hidden = true;
      opener?.focus();
      this.handlers.onConflict();
    }
  }
}
