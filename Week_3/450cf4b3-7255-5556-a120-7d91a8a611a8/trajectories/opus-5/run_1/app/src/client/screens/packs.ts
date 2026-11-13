import { request, type ApiResult } from '../api';
import { confirmPasswordDialog } from '../dialogs';
import { el, focusElement, setText } from '../dom';
import { PACKS_MS, Refreshes } from '../refresh';
import { announce, heading, type Screen, type ScreenContext } from '../shell';
import {
  clearPurchaseAttempt,
  newIdempotencyKey,
  readPurchaseAttempt,
  writePurchaseAttempt,
} from '../state';
import * as copy from '../copy';
import { PACK_CATALOGUE } from '../../shared/copy';
import { formatDateLabel, formatDuration, formatMoney, isoDate, isoTime } from '../../shared/format';
import type { Pack, PackDetail } from '../../shared/types';

interface PackPanel {
  node: HTMLElement;
  title: HTMLElement;
  balanceBase: HTMLElement;
  hold: HTMLElement;
  status: HTMLElement;
  price: HTMLElement;
  receipt: HTMLElement;
  table: HTMLTableElement;
  body: HTMLTableSectionElement;
}

export async function mountPacks(ctx: ScreenContext): Promise<Screen> {
  const user = ctx.user;
  if (user === null) return { unmount: () => undefined };

  const level1 = heading('Hour packs');
  const region = el('div', { className: 'packs-region', attrs: { role: 'region', 'aria-label': 'Hour packs' } });
  const buyRow = el('div', { className: 'buy-row' });
  const outcome = el('p', { className: 'outcome-copy' });
  const retryTag = el('span', { className: 'retry-tag hidden', text: copy.buyPack.retryTag });
  const panels = el('div', { className: 'pack-panels' });

  const buttons = new Map<number, HTMLButtonElement>();
  for (const entry of PACK_CATALOGUE) {
    const button = el('button', {
      text: `Buy ${entry.hours}-hour pack`,
      className: 'button primary buy-button',
      attrs: { type: 'button' },
    });
    buttons.set(entry.hours, button);
    buyRow.append(button);
  }
  region.append(buyRow, outcome, retryTag);
  ctx.root.append(level1, region, panels);
  focusElement(level1);

  const refreshes = new Refreshes();
  const drawn = new Map<string, PackPanel>();
  let busy = false;

  const setButtonsDisabled = (openHours: number | null, allDisabled: boolean): void => {
    for (const [hours, button] of buttons) {
      const disabled = allDisabled || (openHours !== null && openHours !== hours);
      if (disabled) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    }
  };

  const panelFor = (pack: Pack, index: number): PackPanel => {
    let panel = drawn.get(pack.id);
    if (panel === undefined) {
      const node = el('section', { className: 'pack-panel' });
      const title = el('h2', {
        className: 'pack-heading',
        text: copy.packHeading(pack.hours, index + 1),
        attrs: { tabindex: '-1' },
      });
      const price = el('p', { className: 'pack-price' });
      const status = el('p', { className: 'pack-status' });
      const balance = el('p', { className: 'pack-balance' });
      const balanceBase = el('span');
      const hold = el('span', { className: 'held-mark' });
      balance.append(balanceBase, hold);
      const receipt = el('p', { className: 'pack-receipt' });
      const table = el('table', { className: 'data-table' });
      const head = el('thead');
      const headRow = el('tr');
      for (const column of ['When', 'Movement', 'Hours', 'Booking']) {
        headRow.append(el('th', { text: column, attrs: { scope: 'col' } }));
      }
      head.append(headRow);
      const body = el('tbody');
      table.append(head, body);
      node.append(title, price, status, balance, receipt, table);
      panels.append(node);
      panel = { node, title, balanceBase, hold, status, price, receipt, table, body };
      drawn.set(pack.id, panel);
    }
    return panel;
  };

  const drawLedger = (panel: PackPanel, detail: PackDetail): void => {
    const entries = detail.entries.filter((entry) => entry.side === 'pack');
    panel.body.textContent = '';
    for (const entry of entries) {
      const row = el('tr');
      row.append(el('td', { text: `${formatDateLabel(isoDate(entry.createdAt))} ${isoTime(entry.createdAt)}` }));
      row.append(el('td', { text: copy.ledgerLabel(entry.movement) }));
      row.append(el('td', { text: formatDuration(entry.minutes) }));
      row.append(el('td', { text: entry.bookingId ?? '' }));
      panel.body.append(row);
    }
  };

  const readPacks = async (): Promise<void> => {
    const result = await request<{ packs: Pack[] }>('GET', '/api/packs');
    if (result.kind !== 'ok') return;
    const seen = new Set<string>();
    for (const [index, pack] of result.body.packs.entries()) {
      const panel = panelFor(pack, index);
      seen.add(pack.id);
      setText(panel.title, copy.packHeading(pack.hours, index + 1));
      setText(panel.price, `$${formatMoney(pack.priceCents)}`);
      setText(panel.status, pack.status === 'refunded' ? 'Refunded' : 'Active');
      const parts = copy.balanceParts(pack.balanceMinutes, pack.purchasedMinutes, pack.heldMinutes);
      setText(panel.balanceBase, parts.base);
      setText(panel.hold, parts.hold);
      setText(panel.receipt, copy.packReceiptLine(pack.receiptEmail));
      panel.receipt.classList.toggle('queued-mark', pack.receiptEmail.status === 'queued');
      panel.table.setAttribute(
        'aria-label',
        copy.ledgerTableName(pack.hours, index + 1, pack.purchasedAt),
      );
      const detail = await request<PackDetail>('GET', `/api/packs/${pack.id}`);
      if (detail.kind === 'ok') drawLedger(panel, detail.body);
    }
    for (const [id, panel] of drawn) {
      if (!seen.has(id)) {
        panel.node.remove();
        drawn.delete(id);
      }
    }
  };

  const settleOutcome = (message: string, keepOpen: boolean, hours: number): void => {
    outcome.textContent = message;
    announce(message);
    if (keepOpen) {
      retryTag.classList.remove('hidden');
      setButtonsDisabled(hours, false);
    } else {
      retryTag.classList.add('hidden');
      clearPurchaseAttempt(user.id);
      setButtonsDisabled(null, false);
    }
  };

  const send = async (hours: number, key: string): Promise<ApiResult<Pack>> =>
    request<Pack>('POST', '/api/packs', { body: { hours }, idempotencyKey: key });

  const press = async (hours: number): Promise<void> => {
    if (busy) return;
    const open = readPurchaseAttempt(user.id);
    if (open !== null && open.hours !== hours) return;
    const key = open !== null && open.hours === hours ? open.key : newIdempotencyKey();
    writePurchaseAttempt(user.id, { key, hours });
    busy = true;
    setButtonsDisabled(hours, true);
    outcome.textContent = copy.buyPack.pending;
    retryTag.classList.add('hidden');

    let result = await send(hours, key);
    if (result.kind === 'error' && result.status === 403 && result.error === 'reauth_required') {
      const button = buttons.get(hours) ?? null;
      const outcomeOfDialog = await confirmPasswordDialog(button);
      if (outcomeOfDialog === 'closed') {
        busy = false;
        settleOutcome(copy.buyPack.dialogClosed(hours), false, hours);
        return;
      }
      outcome.textContent = copy.buyPack.pending;
      result = await send(hours, key);
    }
    busy = false;

    if (result.kind === 'stale') return;
    if (result.kind === 'ok') {
      settleOutcome(copy.buyPack.success(result.body.hours, user.email), false, hours);
      await readPacks();
      return;
    }
    if (result.kind === 'network') {
      settleOutcome(copy.buyPack.network, true, hours);
      return;
    }
    if (result.status === 503 && result.error === 'purchase_pending') {
      settleOutcome(copy.buyPack.pendingPayment, true, hours);
      return;
    }
    if (result.status === 409 && result.error === 'idempotency_in_progress') {
      settleOutcome(copy.buyPack.inProgress, true, hours);
      return;
    }
    if (result.status === 503 && result.error === 'billing_unavailable') {
      settleOutcome(copy.buyPack.billingDown, false, hours);
      return;
    }
    if (result.status === 401) {
      setButtonsDisabled(null, false);
      return;
    }
    settleOutcome(result.message === '' ? copy.generic : result.message, false, hours);
  };

  for (const [hours, button] of buttons) {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      void press(hours);
    });
  }

  const openAttempt = readPurchaseAttempt(user.id);
  if (openAttempt !== null) {
    const message = copy.buyResume(openAttempt.hours);
    outcome.textContent = message;
    retryTag.classList.remove('hidden');
    setButtonsDisabled(openAttempt.hours, false);
    announce(message);
  }

  await readPacks();
  refreshes.every(PACKS_MS, () => {
    void readPacks();
  });

  return {
    unmount: () => {
      refreshes.stop();
    },
  };
}
