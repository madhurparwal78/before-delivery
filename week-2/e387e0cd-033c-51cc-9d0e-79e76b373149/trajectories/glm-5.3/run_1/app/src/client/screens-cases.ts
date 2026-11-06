// The Withdrawals screen and the Create case dialog.
import { h, inputText, selectEl } from './dom.js';
import { api } from './api.js';
import { navigate } from './router.js';
import { openDialog, type PanelHandle } from './panels.js';
import { problemsRegion, fieldErrorsClear, type Desk } from './feedback.js';
import { staffView, h1 } from './staff-frame.js';
import { startPolling, getSession, registerDialogOpener } from './state.js';
import { formatStamp, formatAmount, formatFiat } from './format.js';

interface CaseRow {
  id: string; reference: string; createdAt: string; asset: string; amount: string; fiatValueCents: number;
  currency: string; status: string; answerDueAt: string | null; counterparty: { name: string } | null;
  wallet: string;
}

export async function renderCases(root: HTMLElement, slug: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk, ws } = view;
  let show: 'open' | 'closed' | 'archived' = 'open';

  const status = h('span', { class: 'status-note' }, '');
  const tableWrap = h('div', { class: 'table-wrap' });
  const select = selectEl({ 'aria-label': 'Show', class: 'select', onchange: async (e: Event) => {
    show = (e.currentTarget as HTMLSelectElement).value as 'open' | 'closed' | 'archived';
    await load();
  } }, [
    h('option', { value: 'open' }, 'Open'),
    h('option', { value: 'closed' }, 'Closed'),
    h('option', { value: 'archived' }, 'Archived'),
  ]);
  select.value = 'open';

  async function load(): Promise<void> {
    const res = await api<{ cases: CaseRow[] }>('GET', `/api/w/${slug}/cases?show=${show}`);
    if (res.ok && res.body !== null) {
      tableWrap.replaceChildren(renderTable(res.body.cases));
      desk.repaint();
    } else if (res.status === 401) {
      handleAuth(res.error?.code ?? '', desk, 'none', {});
    }
  }

  function renderTable(cases: CaseRow[]): HTMLElement {
    const headers = ['Reference', 'Created', 'Amount', 'Fiat value', 'Counterparty', 'Status', 'Answer due', ''];
    const head = h('thead', {}, h('tr', {}, headers.map((label) => h('th', { scope: 'col' }, label))));
    if (cases.length === 0) {
      return h('table', { 'aria-label': 'Withdrawal cases', class: 'table' }, head,
        h('tbody', {}, h('tr', {}, h('td', { colspan: '8', class: 'empty' }, 'Nothing here yet.'))));
    }
    const rows = cases.map((c) => h('tr', {},
      h('td', {}, h('a', { href: `/w/${slug}/cases/${c.id}` }, c.reference)),
      h('td', { class: 'mono' }, formatStamp(c.createdAt, ws.timeZone, ws.city)),
      h('td', { class: 'mono' }, formatAmount(c.asset, c.amount)),
      h('td', { class: 'mono' }, formatFiat(c.currency, c.fiatValueCents)),
      h('td', {}, c.counterparty !== null ? c.counterparty.name : 'Self-hosted wallet'),
      h('td', {}, statusText(c.status)),
      h('td', { class: 'mono' }, c.answerDueAt !== null ? formatStamp(c.answerDueAt, ws.timeZone, ws.city) : '—'),
      h('td', { class: 'waiting-cell', 'aria-hidden': 'true' }, c.status === 'awaiting_answer' ? h('span', { class: 'waiting-marker' }, '●') : ''),
    ));
    return h('table', { 'aria-label': 'Withdrawal cases', class: 'table' }, head, h('tbody', {}, rows));
  }

  const createButton = h('button', {
    type: 'button',
    class: 'btn btn-primary',
    'aria-label': 'Create case',
    onclick: (e: Event) => {
      void openCreateCase(e.currentTarget as HTMLElement);
    },
  }, 'Create case');
  registerDialogOpener('create-case', (values) => {
    void openCreateCase(createButton, values);
  });

  view.work.append(
    h('div', { class: 'screen-head' }, h1('Withdrawals'),
      h('div', { class: 'head-actions' }, select, createButton)),
    status,
    tableWrap,
  );

  async function openCreateCase(opener: HTMLElement, initial: Record<string, string> = {}): Promise<void> {
    const customers = await api<{ customers: { id: string; name: string }[] }>('GET', `/api/w/${slug}/customers`);
    const customersList = customers.body?.customers ?? [];
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Create case',
      kind: 'sheet',
      opener,
      onClose: () => {},
      build: (dialog) => {
        const assetSelect = selectEl({ id: 'asset', 'aria-label': 'Asset', class: 'select' }, [
          h('option', { value: 'BTC' }, 'BTC'), h('option', { value: 'ETH' }, 'ETH'),
          h('option', { value: 'USDC' }, 'USDC'), h('option', { value: 'SOL' }, 'SOL'),
        ]);
        assetSelect.value = initial.asset ?? 'BTC';
        const customerSelect = selectEl({ id: 'customerId', 'aria-label': 'Customer', class: 'select' }, [
          h('option', { value: '' }, 'Choose a customer'),
          ...customersList.map((c) => h('option', { value: c.id }, c.name)),
        ]);
        customerSelect.value = initial.customerId ?? '';
        const amount = inputText({ id: 'amount', 'aria-label': 'Amount', class: 'input mono', autocomplete: 'off', value: initial.amount ?? '' });
        const destinationAddress = inputText({ id: 'destinationAddress', 'aria-label': 'Destination address', class: 'input mono', autocomplete: 'off', value: initial.destinationAddress ?? '' });
        const beneficiaryName = inputText({ id: 'beneficiaryName', 'aria-label': 'Beneficiary name', class: 'input', autocomplete: 'off', value: initial.beneficiaryName ?? '' });

        dialog.append(h('h2', {}, 'Create case'), problemsRegion(),
          fieldWrap(assetSelect, 'Asset'),
          fieldWrap(amount, 'Amount'),
          fieldWrap(destinationAddress, 'Destination address'),
          fieldWrap(customerSelect, 'Customer'),
          fieldWrap(beneficiaryName, 'Beneficiary name'),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Create case', onclick: async () => {
              desk.announce('Creating case…');
              fieldErrorsClear(dialog);
              const res = await api<{ case: { id: string; reference: string } }>('POST', `/api/w/${slug}/cases`, {
                asset: assetSelect.value,
                amount: amount.value,
                destinationAddress: destinationAddress.value,
                customerId: customerSelect.value,
                beneficiaryName: beneficiaryName.value,
              });
              if (res.ok && res.body !== null) {
                desk.announce(`Case ${res.body.case.reference} created.`);
                panel.close();
                navigate(`/w/${slug}/cases/${res.body.case.id}`);
              } else if (res.error !== null) {
                if (res.status === 401) {
                  handleAuth(res.error.code, desk, 'create-case', {
                    asset: assetSelect.value, amount: amount.value, destinationAddress: destinationAddress.value,
                    customerId: customerSelect.value, beneficiaryName: beneficiaryName.value,
                  });
                  return;
                }
                desk.announce(res.error.message, 'error');
                if (Object.keys(res.error.fields).length > 0) desk.inlineErrors(dialog, res.error.fields);
              }
            } }, 'Create case'),
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Cancel', onclick: () => panel.close() }, 'Cancel'),
          ),
        );
      },
    });
  }

  await load();
  startPolling(async () => {
    await load();
  });
}

export function fieldWrap(control: HTMLElement, label: string): HTMLElement {
  const id = control.getAttribute('id') ?? '';
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    control,
    h('div', { class: 'field-error', 'data-error-for': id }),
  );
}

export function statusText(status: string): string {
  const map: Record<string, string> = {
    awaiting_ownership: 'Ownership pending',
    in_review: 'In review',
    awaiting_answer: 'Waiting for answer',
    accepted: 'Accepted',
    rejected: 'Rejected',
    no_response: 'No response',
    cleared: 'Ready to release',
    released: 'Released',
    returned: 'Returned',
  };
  return map[status] ?? status;
}

export function handleAuth(code: string, desk: Desk, dialog: string, values: Record<string, string>): void {
  const reason = code === 'access_removed' ? 'access_removed' : 'session_ended';
  const route = location.pathname;
  import('./state.js').then(({ saveStash }) => {
    saveStash({ reason, route, dialog, values });
  });
  desk.announce(reason === 'access_removed' ? 'Your access to this workspace was removed.' : 'Your session ended. Sign in again to continue. What you typed is kept.', 'error');
  navigate('/sign-in', true);
  void getSession();
}
