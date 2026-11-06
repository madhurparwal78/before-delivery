import { api, failure } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { handleAccessFailure, staffPage } from '../lib/chrome.js';
import { createMessageBox, FieldSet, withPending } from '../lib/forms.js';
import type { RouteContext } from '../lib/router.js';
import { button, columns, combobox, dataTable, quietButton, textbox } from '../lib/views.js';
import { MESSAGES } from '../../shared/copy.js';
import { formatDate, formatMoney } from '../../shared/format.js';
import { can } from '../../shared/roles.js';
import type { ExchangeTable, Marina } from '../lib/types.js';

export async function tariffsScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const page = await staffPage(host, workspaceSlug, 'Tariffs and exchange tables');
  if (page === null) return;
  const messages = createMessageBox();
  const tariffTable = dataTable(
    'Marina tariffs',
    ['Marina', 'From', 'Rate per metre per night'],
    'No tariffs yet.',
  );
  const exchangeTable = dataTable(
    'Exchange tables',
    ['From', 'EUR to GBP', 'EUR to USD'],
    'No exchange tables yet.',
  );
  const addTariff = button('Add tariff');
  const addExchange = button('Add exchange table');
  const mayWrite = can(page.member.role, 'tariffs_write');
  page.main.append(
    messages.node,
    columns(
      [tariffTable.section, mayWrite ? addTariff : null],
      [exchangeTable.section, mayWrite ? addExchange : null],
    ),
  );

  let marinas: readonly Marina[] = [];
  const load = async (): Promise<void> => {
    const [marinasResult, exchangeResult] = await Promise.all([
      api.get<{ marinas: readonly Marina[] }>(`/api/w/${workspaceSlug}/marinas`),
      api.get<{ exchangeTables: readonly ExchangeTable[] }>(
        `/api/w/${workspaceSlug}/exchange-tables`,
      ),
    ]);
    if (marinasResult.ok) {
      marinas = marinasResult.data.marinas;
      tariffTable.setRows(
        marinas.flatMap((marina) =>
          marina.tariffs.map((tariff) => [
            marina.name,
            formatDate(tariff.effectiveDate),
            formatMoney(tariff.ratePerMetreMinor, tariff.currency),
          ]),
        ),
      );
    }
    if (exchangeResult.ok) {
      exchangeTable.setRows(
        exchangeResult.data.exchangeTables.map((table) => [
          formatDate(table.effectiveDate),
          table.rates.GBP,
          table.rates.USD,
        ]),
      );
    }
  };

  addTariff.addEventListener('click', () => {
    openDialog({
      name: 'Add tariff',
      opener: addTariff,
      build: (handle) => {
        const fields = new FieldSet(true);
        const marina = combobox(
          'Marina',
          marinas.map((entry) => ({ value: entry.id, label: entry.name })),
          'split-marina',
        );
        const effectiveDate = textbox('Effective date');
        const rate = textbox('Rate per metre per night (EUR)');
        const dialogMessage = createMessageBox();
        const confirm = button('Add tariff');
        const cancel = quietButton('Cancel');
        cancel.addEventListener('click', () => handle.close());
        confirm.addEventListener('click', () => {
          void withPending(confirm, 'Adding tariff', async () => {
            const result = await api.post(
              `/api/w/${workspaceSlug}/marinas/${marina.value}/tariffs`,
              {
                effectiveDate: effectiveDate.value,
                ratePerMetreMinor: Math.round(Number(rate.value) * 100),
              },
            );
            if (result.ok) {
              handle.close();
              messages.show(MESSAGES.tariffAdded(formatDate(effectiveDate.value)));
              await load();
              return;
            }
            const body = failure(result);
            if (body.error === 'date_exists') {
              dialogMessage.show(MESSAGES.dateExists, 'problem');
            } else if (body.errors !== undefined) {
              fields.showErrors(body.errors)?.focus();
              return;
            } else if (!handleAccessFailure(result, dialogMessage)) {
              dialogMessage.show(MESSAGES.unexpected, 'problem');
            }
            confirm.focus();
          });
        });
        return {
          body: [
            fields.field('marinaId', 'Marina', marina),
            fields.field('effectiveDate', 'Effective date', effectiveDate),
            fields.field('ratePerMetreMinor', 'Rate per metre per night (EUR)', rate),
            dialogMessage.node,
            el('div', { class: 'dialog-actions' }, confirm, cancel),
          ],
          first: () => marina,
        };
      },
    });
  });

  addExchange.addEventListener('click', () => {
    openDialog({
      name: 'Add exchange table',
      opener: addExchange,
      build: (handle) => {
        const fields = new FieldSet(true);
        const effectiveDate = textbox('Effective date');
        const gbp = textbox('EUR to GBP');
        const usd = textbox('EUR to USD');
        const dialogMessage = createMessageBox();
        const confirm = button('Add exchange table');
        const cancel = quietButton('Cancel');
        cancel.addEventListener('click', () => handle.close());
        confirm.addEventListener('click', () => {
          void withPending(confirm, 'Adding exchange table', async () => {
            const result = await api.post(`/api/w/${workspaceSlug}/exchange-tables`, {
              effectiveDate: effectiveDate.value,
              rates: { GBP: gbp.value, USD: usd.value },
            });
            if (result.ok) {
              handle.close();
              messages.show(MESSAGES.exchangeTableAdded(formatDate(effectiveDate.value)));
              await load();
              return;
            }
            const body = failure(result);
            if (body.error === 'date_exists') {
              dialogMessage.show(MESSAGES.dateExists, 'problem');
            } else if (body.errors !== undefined) {
              fields.showErrors(body.errors)?.focus();
              return;
            } else if (!handleAccessFailure(result, dialogMessage)) {
              dialogMessage.show(MESSAGES.unexpected, 'problem');
            }
            confirm.focus();
          });
        });
        return {
          body: [
            fields.field('effectiveDate', 'Effective date', effectiveDate),
            fields.field('rates.GBP', 'EUR to GBP', gbp),
            fields.field('rates.USD', 'EUR to USD', usd),
            dialogMessage.node,
            el('div', { class: 'dialog-actions' }, confirm, cancel),
          ],
          first: () => effectiveDate,
        };
      },
    });
  });

  await load();
}
