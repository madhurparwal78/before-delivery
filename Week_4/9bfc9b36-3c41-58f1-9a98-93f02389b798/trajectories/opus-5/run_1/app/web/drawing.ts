import { ApiError, call } from './api';
import {
  announce, areaPair, chip, clear, el, lengthPair, money, poster, refuse, showDialog, table,
  type Column,
} from './ui';
import {
  OUTAGE_COPY, PENDING_COPY, SAIL_ACCOUNT_CHIPS, SAIL_ACCOUNT_LINES, STATUS_CHIP_LABELS, SUCCESS,
  supersededBannerCopy,
} from '../src/shared/copy';
import { go } from './navigate';
import { stepRail, statusChip, loftHandOptions, ownerOptions } from './loft';
import type { Claim, Drawing, Stock } from './nesting';

/** The drawing overview, its sail account, its sight grants and the Confirm step. */

interface SailAccount {
  readonly status: 'deposit_due' | 'balance_due' | 'settled';
  readonly charge_pence: number;
  readonly tax_pence: number;
  readonly total_pence: number;
  readonly deposit_pence: number;
  readonly paid_pence: number;
  readonly credited_pence: number;
  readonly balance_pence: number;
}

interface Grant {
  readonly id: string;
  readonly owner: { email: string; display_name: string };
  readonly status: 'granted' | 'withdrawn';
}

let pendingPoll: number | null = null;

export function stopDrawingPoll(): void {
  if (pendingPoll !== null) window.clearInterval(pendingPoll);
  pendingPoll = null;
}

export async function renderOverview(root: HTMLElement, code: string): Promise<void> {
  const drawing = await call<Drawing & { assigned_to: { display_name: string } | null; cut_sheet: { sha256: string; superseded_by: string | null } | null }>(
    `/api/drawings/${code}`,
  );
  clear(root);
  root.append(stepRail(drawing, null));
  const sheet = el('div', { class: 'sheet' });
  sheet.append(el('h1', { text: drawing.code, tabindex: '-1' }));

  if (drawing.status === 'pending_store') {
    sheet.append(el('p', { class: 'outage', role: 'region', 'aria-label': 'Store outage', text: OUTAGE_COPY.issuing }));
  }

  sheet.append(
    el('p', {}, [
      chip((STATUS_CHIP_LABELS as Record<string, string>)[drawing.status] ?? drawing.status, drawing.status === 'pending_store'),
      document.createTextNode(` ${drawing.boat_name} · ${drawing.sail === 'mainsail' ? 'Mainsail' : 'Headsail'} · ${drawing.cloth_code}`),
    ]),
  );
  if (drawing.area !== null) {
    sheet.append(el('div', { class: 'poster-field' }, [poster(areaPair(drawing.area.area_mm2), drawing.area.basis)]));
  }

  const hands = await loftHandOptions();
  const handSelect = el('select', { 'aria-label': 'Loft hand' });
  for (const option of hands) handSelect.append(el('option', { value: option.value, text: option.label }));
  const assign = el('button', { type: 'button', text: 'Assign' });
  assign.addEventListener('click', () => {
    void (async () => {
      try {
        await call(`/api/drawings/${code}/assign`, { method: 'POST', body: { loft_hand_email: handSelect.value } });
        announce(SUCCESS.saved);
        await renderOverview(root, code);
      } catch (cause) {
        if (cause instanceof ApiError) refuse(cause.message);
      }
    })();
  });
  sheet.append(el('div', { class: 'row' }, [handSelect, assign]));

  const controls: HTMLElement[] = [];
  const issue = el('button', { class: 'action', type: 'button', text: 'Issue cut sheet' });
  issue.addEventListener('click', () => {
    void (async () => {
      announce(PENDING_COPY.issue);
      try {
        await call(`/api/drawings/${code}/issue`, { method: 'POST' });
        await renderOverview(root, code);
      } catch (cause) {
        if (cause instanceof ApiError) refuse(cause.message);
      }
    })();
  });
  controls.push(issue);

  const revise = el('button', { type: 'button', text: 'Revise drawing' });
  revise.addEventListener('click', () => {
    void (async () => {
      try {
        const successor = await call<Drawing>(`/api/drawings/${code}/revise`, { method: 'POST' });
        announce(SUCCESS.saved);
        go(`/drawings/${successor.code}`);
      } catch (cause) {
        if (cause instanceof ApiError) refuse(cause.message);
      }
    })();
  });
  controls.push(revise);

  if (drawing.status === 'issued') {
    const grant = el('button', { type: 'button', text: 'Grant sight' });
    grant.addEventListener('click', () => void openGrant(root, code, grant));
    controls.push(grant);
    if (drawing.cut_sheet !== null) {
      controls.push(
        el('a', { href: `/api/cut-sheets/${drawing.cut_sheet.sha256}`, text: 'Open cut sheet' }),
      );
    }
  }
  sheet.append(el('div', { class: 'controls' }, controls));

  if (drawing.cut_sheet?.superseded_by) {
    sheet.append(el('p', { text: supersededBannerCopy(drawing.cut_sheet.superseded_by) }));
  }

  if (['cut', 'pending_store', 'issued'].includes(drawing.status)) {
    sheet.append(await sailAccountRegion(root, code));
  }

  if (drawing.status === 'issued') {
    const grants = await call<{ items: readonly Grant[] }>(`/api/drawings/${code}/grants?limit=50`);
    const wrap = el('div', { class: 'panelcard' });
    wrap.append(el('h2', { text: 'Sight grants' }));
    for (const item of grants.items) {
      if (item.status !== 'granted') continue;
      const withdraw = el('button', { type: 'button', text: `Withdraw sight from ${item.owner.display_name}` });
      withdraw.addEventListener('click', () => {
        void (async () => {
          await call(`/api/grants/${item.id}/withdraw`, { method: 'POST' });
          announce(SUCCESS.withdraw(item.owner.display_name));
          await renderOverview(root, code);
        })();
      });
      wrap.append(el('p', {}, [withdraw]));
    }
    sheet.append(wrap);
  }

  root.append(sheet);

  // While the overview shows Pending store it fetches the drawing at least every
  // 5 seconds and turns Issued in place, announcing once and keeping focus.
  stopDrawingPoll();
  if (drawing.status === 'pending_store') {
    pendingPoll = window.setInterval(() => {
      void (async () => {
        const fresh = await call<Drawing>(`/api/drawings/${code}`);
        if (fresh.status !== 'issued') return;
        stopDrawingPoll();
        const active = document.activeElement as HTMLElement | null;
        await renderOverview(root, code);
        announce(SUCCESS.issued);
        active?.focus();
      })();
    }, 5000);
  }
}

async function sailAccountRegion(root: HTMLElement, code: string): Promise<HTMLElement> {
  const account = await call<SailAccount>(`/api/drawings/${code}/account`);
  const region = el('div', { class: 'panelcard', role: 'region', 'aria-label': 'Sail account' });
  region.append(el('p', {}, [chip(SAIL_ACCOUNT_CHIPS[account.status])]));
  const lines = el('ul', { class: 'accountlines' });
  const figures: [string, number][] = [
    [SAIL_ACCOUNT_LINES[0], account.charge_pence],
    [SAIL_ACCOUNT_LINES[1], account.tax_pence],
    [SAIL_ACCOUNT_LINES[2], account.total_pence],
    [SAIL_ACCOUNT_LINES[3], account.deposit_pence],
    [SAIL_ACCOUNT_LINES[4], account.paid_pence],
    [SAIL_ACCOUNT_LINES[5], account.credited_pence],
    [SAIL_ACCOUNT_LINES[6], account.balance_pence],
  ];
  for (const [label, pence] of figures) {
    lines.append(el('li', {}, [el('span', { text: label }), el('span', { text: money(pence) })]));
  }
  region.append(lines);

  const payment = el('button', { type: 'button', text: 'Record payment' });
  payment.addEventListener('click', () =>
    showDialog(
      {
        title: 'Record payment',
        submit: 'Save payment',
        fields: [
          { name: 'amount', label: 'Amount (£)' },
          { name: 'note', label: 'Note' },
        ],
        onSubmit: async (values) => {
          const pence = poundsToPence(values['amount'] ?? '');
          const answer = await call<SailAccount>(`/api/drawings/${code}/payments`, {
            method: 'POST',
            idempotencyKey: `pay-${code}-${pence}-${Date.now()}`,
            body: { amount_pence: pence, note: values['note'] },
          });
          announce(SUCCESS.payment(penceText(pence), penceText(answer.balance_pence)));
          await renderOverview(root, code);
        },
      },
      payment,
    ),
  );
  const credit = el('button', { type: 'button', text: 'Issue credit note' });
  credit.addEventListener('click', () =>
    showDialog(
      {
        title: 'Credit note',
        submit: 'Save credit note',
        fields: [
          { name: 'amount', label: 'Amount (£)' },
          { name: 'reason', label: 'Reason' },
        ],
        onSubmit: async (values) => {
          const pence = poundsToPence(values['amount'] ?? '');
          const answer = await call<SailAccount>(`/api/drawings/${code}/credit-notes`, {
            method: 'POST',
            body: { amount_pence: pence, reason: values['reason'] },
          });
          announce(SUCCESS.creditNote(penceText(pence), penceText(answer.balance_pence)));
          await renderOverview(root, code);
        },
      },
      credit,
    ),
  );
  region.append(el('div', { class: 'controls' }, [payment, credit]));
  return region;
}

function poundsToPence(text: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (match === null) return 0;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

function penceText(pence: number): string {
  return money(pence).slice(1);
}

async function openGrant(root: HTMLElement, code: string, opener: HTMLElement): Promise<void> {
  const owners = await ownerOptions();
  showDialog(
    {
      title: 'Grant sight',
      submit: 'Grant',
      fields: [
        { name: 'owner_email', label: 'Owner', options: owners },
        { name: 'ends_at', label: 'Sight ends' },
      ],
      onSubmit: async (values) => {
        const body: Record<string, unknown> = { owner_email: values['owner_email'] };
        if ((values['ends_at'] ?? '') !== '') body['ends_at'] = values['ends_at'];
        const grant = await call<Grant>(`/api/drawings/${code}/grants`, { method: 'POST', body });
        announce(SUCCESS.grant(grant.owner.display_name));
        await renderOverview(root, code);
      },
    },
    opener,
  );
}

/* ------------------------------------------------------------------ confirm */

interface HoldRow {
  readonly claim: Claim;
  readonly stock: Stock;
}

export async function renderConfirmStep(root: HTMLElement, code: string): Promise<void> {
  const drawing = await call<Drawing>(`/api/drawings/${code}`);
  const rows: HoldRow[] = [];
  for (const id of drawing.claim_ids) {
    const claim = await call<Claim>(`/api/claims/${id}`);
    if (claim.status !== 'held' || claim.lays.length === 0) continue;
    const stock = await call<Stock>(`/api/stock/${claim.stock_code}`);
    rows.push({ claim, stock });
  }
  clear(root);
  root.append(stepRail(drawing, 'confirm'));
  const sheet = el('div', { class: 'sheet step' });
  sheet.append(el('h1', { text: `Confirm ${drawing.code}`, tabindex: '-1' }));

  const columns: Column<HoldRow>[] = [
    { header: 'Stock', cell: (row) => row.claim.stock_code },
    { header: 'Lot', cell: (row) => row.stock.lot },
    { header: 'Used length', cell: (row) => lengthPair(row.claim.used_mm) },
    { header: 'Panels', cell: (row) => row.claim.lays.map((lay) => lay.panel_number).join(', ') },
    {
      header: 'Cut',
      cell: (row) => {
        const button = el('button', { class: 'action', type: 'button', text: `Confirm cut on ${row.claim.stock_code}` });
        button.addEventListener('click', () => {
          void (async () => {
            announce(PENDING_COPY.cut);
            try {
              const answer = await call<{ stock: Stock; offcut: Stock | null; drawing_status: string }>(
                `/api/claims/${row.claim.id}/cut`,
                { method: 'POST', idempotencyKey: `cut-${row.claim.id}`, body: {} },
              );
              let copy = SUCCESS.cut(
                answer.stock.kind,
                answer.stock.code,
                String(answer.stock.remaining_mm),
                '',
              );
              if (answer.offcut !== null) copy += SUCCESS.cutOffcut(answer.offcut.code);
              announce(copy);
              go(`/drawings/${code}`);
            } catch (cause) {
              if (cause instanceof ApiError) refuse(cause.message);
            }
          })();
        });
        return button;
      },
    },
  ];
  sheet.append(el('div', { class: 'panelcard' }, [table('Holds to cut', columns, rows)]));

  const first = rows[0];
  const region = el('div', { class: 'poster-field', role: 'region', 'aria-label': 'Roll remaining' });
  if (first !== undefined) {
    region.append(poster(lengthPair(first.stock.after_laid_mm)));
    region.append(el('p', { text: areaPair(first.stock.on_hand_mm2) }));
  }
  sheet.append(region);
  root.append(sheet);
  void statusChip;
}
