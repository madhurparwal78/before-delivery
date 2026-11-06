import { moneyText } from '../../../shared/bilingual.js';
import { scentName } from '../../../shared/catalog.js';
import { COLUMNS, STUDIO, UI } from '../../../shared/copy.js';
import { parseDollarAmount, taxCodeLabel } from '../../../shared/money.js';
import type { Credit, Order, Refund, Subscription } from '../../../shared/types.js';
import { api, ApiFailure, newIdempotencyKey } from '../../api.js';
import { cash, locale } from '../../i18n.js';
import { announce } from '../../live.js';
import { bind, bindText, el, labelled, refresh, say } from '../../ui.js';
import { reportStudioFailure, studioRegion } from './shell.js';
import { studioTable } from './table.js';

type OpenOrder = Order & { refunds: Refund[]; credits: Credit[] };
type OpenSubscription = Subscription & { email: string; credits: Credit[] };

export async function renderFinance(body: HTMLElement): Promise<void> {
  const heading = el('h1', { class: 'page-heading' });
  bindText(heading, () => say(UI.navFinance));
  const region = studioRegion();
  const search = el('input', { type: 'search', class: 'input' });
  const searchButton = el('button', { type: 'submit', class: 'button secondary' });
  const searchError = el('p', { class: 'field-error', hidden: true });
  const form = el('form', { class: 'finance-search' }, [
    labelled(UI.findRecord, search),
    searchButton,
    searchError,
  ]);
  const detail = el('div', { class: 'finance-detail' });
  let order: OpenOrder | null = null;
  let subscription: OpenSubscription | null = null;

  bind(() => {
    searchButton.textContent = say(UI.findRecord);
    search.setAttribute('aria-label', say(UI.findRecord));
  });

  const lookup = async (): Promise<void> => {
    const term = search.value.trim();
    searchError.hidden = true;
    if (term === '') return;
    try {
      const result = await api.get<{
        orders: { number: string }[];
        subscriptions: { number: string }[];
      }>(`/api/staff/search?q=${encodeURIComponent(term)}`);
      const matches = [...result.orders.map((row) => row.number), ...result.subscriptions.map((row) => row.number)];
      if (matches.length === 1) {
        await open(matches[0] as string);
        return;
      }
      order = null;
      subscription = null;
      paint();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        searchError.hidden = false;
        searchError.textContent = error.fields['q'] ?? error.detail;
        refresh();
        return;
      }
      reportStudioFailure(error, STUDIO.forbidden);
    }
  };

  const open = async (number: string): Promise<void> => {
    try {
      if (number.startsWith('SUB-')) {
        subscription = await api.get<OpenSubscription>(`/api/staff/subscriptions/${number}`);
        order = null;
      } else {
        order = await api.get<OpenOrder>(`/api/staff/orders/${number}`);
        subscription = null;
      }
      paint();
    } catch (error) {
      reportStudioFailure(error, STUDIO.forbidden);
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void lookup();
  });

  function refundForm(open: OpenOrder): HTMLElement {
    const checkboxes = open.lines
      .filter((line) => !line.refunded)
      .map((line) => {
        const input = el('input', { type: 'checkbox', class: 'checkbox' });
        input.dataset['batch'] = line.batch;
        input.dataset['bar'] = String(line.bar);
        const label =
          locale() === 'fr-CA' ? `Rembourser le pain ${line.bar}` : `Refund bar ${line.bar}`;
        input.setAttribute('aria-label', label);
        return el('label', { class: 'checkbox-row' }, [input, ` ${label}`]);
      });
    const restock = el('input', { type: 'checkbox', class: 'checkbox' });
    restock.setAttribute('aria-label', say(UI.returnBarsToStock));
    const reason = el('input', { type: 'text', class: 'input' });
    const submit = el('button', { type: 'button', class: 'button primary' });
    const error = el('p', { class: 'field-error', hidden: true });
    bind(() => {
      submit.textContent = say(UI.issueRefund);
      reason.setAttribute('aria-label', say(UI.refundReason));
    });
    submit.addEventListener('click', () => {
      const bars = checkboxes
        .map((row) => row.querySelector<HTMLInputElement>('input'))
        .filter((input): input is HTMLInputElement => input !== null && input.checked)
        .map((input) => ({ batch: input.dataset['batch'] ?? '', bar: Number(input.dataset['bar']) }));
      submit.textContent = say(UI.refundingPending);
      submit.disabled = true;
      void (async () => {
        try {
          const result = await api.post<{ refund: Refund }>(
            `/api/staff/orders/${open.number}/refunds`,
            { bars, restock: restock.checked, reason: reason.value },
            { idempotencyKey: newIdempotencyKey(), ifMatch: String(open.version) },
          );
          announce('studio', STUDIO.refundIssued(result.refund.number, moneyText(result.refund.amount)));
          await openOrderAgain(open.number);
        } catch (failure) {
          if (failure instanceof ApiFailure && failure.status === 422) {
            error.hidden = false;
            error.textContent = Object.values(failure.fields)[0] ?? failure.detail;
          } else if (failure instanceof ApiFailure && failure.status === 503) {
            announce('studio', { 'en-CA': failure.detail, 'fr-CA': failure.detail });
            await openOrderAgain(open.number);
          } else if (failure instanceof ApiFailure && failure.code === 'already_refunded') {
            announce('studio', { 'en-CA': failure.detail, 'fr-CA': failure.detail });
          } else {
            reportStudioFailure(failure, STUDIO.forbidden);
          }
        } finally {
          submit.disabled = false;
          refresh();
        }
      })();
    });
    return el('div', { class: 'refund-form' }, [
      ...checkboxes,
      el('label', { class: 'checkbox-row' }, [restock, ` ${say(UI.returnBarsToStock)}`]),
      labelled(UI.refundReason, reason),
      submit,
      error,
    ]);
  }

  async function openOrderAgain(number: string): Promise<void> {
    order = await api.get<OpenOrder>(`/api/staff/orders/${number}`);
    paint();
  }

  function creditForm(target: string, version: number, reload: () => Promise<void>): HTMLElement {
    const amount = el('input', { type: 'text', class: 'input tabular', value: '5.00' });
    const reason = el('input', { type: 'text', class: 'input' });
    const submit = el('button', { type: 'button', class: 'button primary' });
    const error = el('p', { class: 'field-error', hidden: true });
    bind(() => {
      submit.textContent = say(UI.addCredit);
      amount.setAttribute('aria-label', say(UI.creditAmount));
      reason.setAttribute('aria-label', say(UI.creditReason));
    });
    submit.addEventListener('click', () => {
      error.hidden = true;
      submit.textContent = say(UI.savingPending);
      submit.disabled = true;
      void (async () => {
        try {
          const cents = parseDollarAmount(amount.value) ?? 0;
          const result = await api.post<{ credit: Credit }>(
            '/api/staff/credits',
            { target, amount_cents: cents, reason: reason.value },
            { idempotencyKey: newIdempotencyKey(), ifMatch: String(version) },
          );
          announce('studio', STUDIO.creditAdded(result.credit.number, moneyText(result.credit.amount)));
          await reload();
        } catch (failure) {
          if (failure instanceof ApiFailure && failure.status === 422) {
            error.hidden = false;
            error.textContent = Object.values(failure.fields)[0] ?? failure.detail;
          } else if (failure instanceof ApiFailure && failure.status === 503) {
            announce('studio', { 'en-CA': failure.detail, 'fr-CA': failure.detail });
            await reload();
          } else {
            reportStudioFailure(failure, STUDIO.forbidden);
          }
        } finally {
          submit.disabled = false;
          refresh();
        }
      })();
    });
    return el('div', { class: 'credit-form' }, [
      labelled(UI.creditAmount, amount),
      labelled(UI.creditReason, reason),
      submit,
      error,
    ]);
  }

  function paint(): void {
    while (detail.firstChild) detail.firstChild.remove();
    if (order) {
      const open = order;
      const title = el('h2', {
        class: 'detail-heading',
        text: locale() === 'fr-CA' ? `Commande ${open.number}` : `Order ${open.number}`,
      });
      const lines = el('dl', { class: 'money-rows tabular' });
      for (const line of open.lines) {
        lines.append(
          el('dt', {
            text: `${locale() === 'fr-CA' ? 'Pain' : 'Bar'} ${line.bar} \u00B7 ${line.batch} \u00B7 ${scentName(line.scent, locale())}`,
          }),
          el('dd', { text: cash(line.unit_price) }),
        );
      }
      lines.append(el('dt', { text: say(UI.lineTotal) }), el('dd', { text: cash(open.total) }));
      const refundTable = studioTable(
        () =>
          locale() === 'fr-CA' ? `Remboursements de ${open.number}` : `Refunds of ${open.number}`,
        [
          { label: COLUMNS.number },
          { label: COLUMNS.status },
          { label: COLUMNS.bars },
          { label: COLUMNS.shipping },
          ...open.taxes.map((tax) => ({
            label: { 'en-CA': tax.code, 'fr-CA': taxCodeLabel(tax.code, 'fr-CA') },
          })),
          { label: COLUMNS.amount },
        ],
      );
      refundTable.setRows(
        open.refunds.map((refund) => [
          refund.number,
          refund.status,
          cash(refund.allocation.bars),
          cash(refund.allocation.shipping),
          ...refund.allocation.taxes.map((tax) => cash(tax.amount)),
          cash(refund.amount),
        ]),
      );
      const creditTable = studioTable(() => say(UI.credits), [
        { label: COLUMNS.number },
        { label: COLUMNS.status },
        { label: COLUMNS.amount },
      ]);
      creditTable.setRows(
        open.credits.map((credit) => [credit.number, credit.status, cash(credit.amount)]),
      );
      detail.append(
        title,
        lines,
        refundTable.element,
        creditTable.element,
        refundForm(open),
        creditForm(open.number, open.version, () => openOrderAgain(open.number)),
      );
    } else if (subscription) {
      const open = subscription;
      detail.append(
        el('h2', {
          class: 'detail-heading',
          text: locale() === 'fr-CA' ? `Abonnement ${open.number}` : `Subscription ${open.number}`,
        }),
        el('p', { class: 'detail-line', text: open.email }),
        creditForm(open.number, open.version, async () => {
          subscription = await api.get<OpenSubscription>(`/api/staff/subscriptions/${open.number}`);
          paint();
        }),
      );
    }
    refresh();
  }

  body.append(heading, form, detail, region);
}
