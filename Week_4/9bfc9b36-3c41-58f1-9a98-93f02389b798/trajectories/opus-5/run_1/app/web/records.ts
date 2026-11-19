import { ApiError, call } from './api';
import {
  announce, areaPair, chip, clear, el, groupedMm, instantText, lengthPair, money, poster, refuse,
  showDialog, staggerRows, table, type Column,
} from './ui';
import {
  EMPTY_COPY, FIELD_COPY, PENDING_COPY, SAIL_ACCOUNT_CHIPS, SAIL_ACCOUNT_LINES, STANDING_CHIPS,
  STATUS_CHIP_LABELS, SUCCESS, BULK_REFUSAL_COPY, OWNER_VIEWER_REFUSAL, supersededBannerCopy,
} from '../src/shared/copy';
import { go, replace } from './navigate';
import type { Drawing } from './nesting';
import type { Boat } from './loft';

/** The stock shelf, the cloth ledger, the console, the accounts and the owner screens. */

interface Page<T> {
  readonly items: readonly T[];
  readonly next_cursor: string | null;
  readonly total: number;
}

interface StockItem {
  readonly code: string;
  readonly kind: 'roll' | 'offcut';
  readonly cloth_code: string;
  readonly lot: string;
  readonly remaining_mm: number;
  readonly on_hand_mm2: number;
  readonly shelf_location: string;
  readonly note: string;
  readonly revision: number;
}

interface LedgerLine {
  readonly line_id: number;
  readonly pair_id: string;
  readonly posted_at: string;
  readonly account: string;
  readonly amount_mm2: number;
  readonly stock_code: string;
  readonly drawing_code: string;
  readonly actor_email: string;
  readonly reason: string;
}

interface LedgerFooter {
  readonly stock_code: string | null;
  readonly remaining_mm: number | null;
  readonly offcut_count: number;
  readonly on_hand_mm2: number;
  readonly lines: number;
}

interface Submission {
  readonly id: string;
  readonly boat_code: string;
  readonly dimension: string;
  readonly value_mm: number;
  readonly value_in: string;
  readonly as_submitted: string;
  readonly measured_on: string;
  readonly note: string;
  readonly status: string;
  readonly submitted_by: { email: string; display_name: string };
  readonly submitted_at: string;
  readonly decided_at: string | null;
  readonly reason: string | null;
}

/** The figure cell shows the submission exactly as stored, then its conversion. */
function figureCell(row: Submission): string {
  return `${row.as_submitted} · ${groupedMm(row.value_mm)} mm (${row.value_in} in)`;
}

/* ------------------------------------------------------------------ stock */

export async function renderStock(root: HTMLElement): Promise<void> {
  const [page, summary] = await Promise.all([
    call<Page<StockItem>>('/api/stock?limit=50'),
    call<{ rolls: number; offcuts: number; on_hand_mm2: number }>('/api/stock/summary'),
  ]);
  clear(root);
  root.append(el('h1', { text: 'Stock shelf', tabindex: '-1' }));
  const receive = el('button', { class: 'action', type: 'button', text: 'Receive roll' });
  receive.addEventListener('click', () => void openReceive(root, receive));
  root.append(el('div', { class: 'row' }, [receive]));

  root.append(
    el('div', { class: 'poster-field', role: 'region', 'aria-label': 'Stock on hand' }, [
      poster(areaPair(summary.on_hand_mm2)),
      el('p', { text: `${summary.rolls} rolls · ${summary.offcuts} offcuts` }),
    ]),
  );

  // Cards are ordered by on-hand area, smallest first, then by code.
  const items = page.items.slice().sort((a, b) =>
    a.on_hand_mm2 === b.on_hand_mm2 ? a.code.localeCompare(b.code) : a.on_hand_mm2 - b.on_hand_mm2,
  );
  const list = el('ul', { class: 'cardgrid shelf', role: 'list', 'aria-label': 'Rolls and offcuts' });
  for (const item of items) {
    const card = el('li');
    card.append(el('p', { class: 'governing', text: lengthPair(item.remaining_mm) }));
    card.append(el('p', { text: `lot ${item.lot} · ${item.cloth_code} · ${item.shelf_location}` }));
    card.append(el('p', { text: areaPair(item.on_hand_mm2) }));
    card.append(el('a', { href: `/ledger?stock=${item.code}`, text: item.code }));
    const count = el('button', { type: 'button', text: `Count ${item.code}` });
    count.addEventListener('click', () => void openCount(root, item, count));
    const edit = el('button', { type: 'button', text: `Edit ${item.code}` });
    edit.addEventListener('click', () => void openEditStock(root, item, edit));
    card.append(el('div', { class: 'controls' }, [count, edit]));
    list.append(card);
  }
  root.append(list);
}

async function openReceive(root: HTMLElement, opener: HTMLElement): Promise<void> {
  const cloths = await call<Page<{ code: string; name: string }>>('/api/cloths?limit=50');
  showDialog(
    {
      title: 'Receive roll',
      submit: 'Receive',
      fields: [
        { name: 'cloth_code', label: 'Cloth', options: cloths.items.map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` })) },
        { name: 'lot', label: 'Lot' },
        { name: 'length_mm', label: 'Length (mm)' },
        { name: 'shelf_location', label: 'Shelf location' },
      ],
      onSubmit: async (values) => {
        announce(PENDING_COPY.save);
        const stock = await call<StockItem>('/api/rolls', {
          method: 'POST',
          body: {
            cloth_code: values['cloth_code'],
            lot: values['lot'],
            length_mm: Number(values['length_mm']),
            shelf_location: values['shelf_location'],
          },
        });
        announce(SUCCESS.received(stock.code));
        await renderStock(root);
        root.querySelector<HTMLElement>(`button[data-count="${stock.code}"]`)?.focus();
        const buttons = [...root.querySelectorAll<HTMLElement>('button')];
        buttons.find((button) => button.textContent === `Count ${stock.code}`)?.focus();
      },
    },
    opener,
  );
}

async function openCount(root: HTMLElement, item: StockItem, opener: HTMLElement): Promise<void> {
  showDialog(
    {
      title: 'Shelf count',
      submit: 'Record count',
      fields: [
        { name: 'counted_length_mm', label: 'Counted length (mm)', value: String(item.remaining_mm) },
        { name: 'reason', label: 'Reason' },
      ],
      onSubmit: async (values) => {
        announce(PENDING_COPY.save);
        const counted = Number(values['counted_length_mm']);
        const before = item.remaining_mm;
        await call<StockItem>(`/api/stock/${item.code}/counts`, {
          method: 'POST',
          body: { counted_length_mm: counted, reason: values['reason'] },
        });
        const adjustment = (counted - before) * (item.on_hand_mm2 / Math.max(1, before));
        announce(
          counted === before
            ? SUCCESS.countMatched
            : SUCCESS.countAdjusted(signedArea(Math.round(adjustment))),
        );
        await renderStock(root);
      },
    },
    opener,
  );
}

function signedArea(value: number): string {
  const sign = value > 0 ? '+' : '-';
  const digits = String(Math.abs(value));
  return `${sign}${groupedMm(Number(digits))}`;
}

async function openEditStock(root: HTMLElement, item: StockItem, opener: HTMLElement): Promise<void> {
  showDialog(
    {
      title: `Edit ${item.code}`,
      submit: 'Save stock',
      fields: [
        { name: 'shelf_location', label: 'Shelf location', value: item.shelf_location },
        { name: 'note', label: 'Note', value: item.note },
      ],
      onSubmit: async (values) => {
        announce(PENDING_COPY.save);
        await call<StockItem>(`/api/stock/${item.code}`, {
          method: 'PATCH',
          ifMatch: item.revision,
          body: { shelf_location: values['shelf_location'], note: values['note'] },
        });
        announce(SUCCESS.saved);
        await renderStock(root);
      },
    },
    opener,
  );
}

/* ------------------------------------------------------------------ ledger */

let ledgerRequest = 0;

export async function renderLedger(root: HTMLElement, query: URLSearchParams): Promise<void> {
  const mine = ++ledgerRequest;
  const stock = query.get('stock');
  const cursor = query.get('cursor');
  const path = `/api/ledger?limit=20${stock === null ? '' : `&stock=${encodeURIComponent(stock)}`}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;

  let answer: Page<LedgerLine> & { footer: LedgerFooter };
  try {
    answer = await call<Page<LedgerLine> & { footer: LedgerFooter }>(path);
  } catch (cause) {
    if (cause instanceof ApiError && cause.fields['cursor'] !== undefined) {
      refuse(cause.fields['cursor']);
      const next = new URLSearchParams(location.search);
      next.delete('cursor');
      replace(`/ledger${next.toString() === '' ? '' : `?${next.toString()}`}`);
      return;
    }
    throw cause;
  }
  // Only the newest request paints.
  if (mine !== ledgerRequest) return;

  clear(root);
  root.append(el('h1', { text: 'Cloth ledger', tabindex: '-1' }));

  const stockList = await call<Page<StockItem>>('/api/stock?limit=50');
  const filter = el('select', { 'aria-label': 'Stock' });
  filter.append(el('option', { value: '', text: 'All stock', selected: stock === null }));
  for (const item of stockList.items) {
    filter.append(el('option', { value: item.code, text: item.code, selected: item.code === stock }));
  }
  filter.addEventListener('change', () => {
    const next = new URLSearchParams();
    if (filter.value !== '') next.set('stock', filter.value);
    go(`/ledger${next.toString() === '' ? '' : `?${next.toString()}`}`);
  });
  root.append(el('div', { class: 'row' }, [filter]));

  if (answer.items.length === 0) {
    root.append(el('p', { class: 'empty', text: EMPTY_COPY.ledger }));
  } else {
    const columns: Column<LedgerLine>[] = [
      { header: 'Line', cell: (row) => String(row.line_id) },
      { header: 'Posted', cell: (row) => instantText(row.posted_at) },
      { header: 'Account', cell: (row) => row.account },
      { header: 'Stock', cell: (row) => row.stock_code },
      { header: 'Drawing', cell: (row) => row.drawing_code },
      { header: 'Amount', cell: (row) => signedAreaPair(row.amount_mm2) },
      { header: 'Actor', cell: (row) => row.actor_email },
      { header: 'Reason', cell: (row) => row.reason },
    ];
    const node = table('Ledger lines', columns, answer.items);
    // The two lines of a pair are grouped by spacing alone.
    const rows = [...node.querySelectorAll('tbody tr')];
    answer.items.forEach((line, index) => {
      const next = answer.items[index + 1];
      if (next !== undefined && next.pair_id !== line.pair_id) rows[index]?.classList.add('pair-gap');
    });
    staggerRows(rows as HTMLElement[]);
    root.append(el('div', { class: 'panelcard' }, [node]));
  }

  const older = el('button', { type: 'button', text: 'Older lines' });
  older.addEventListener('click', () => {
    if (answer.next_cursor === null) return;
    const next = new URLSearchParams();
    if (stock !== null) next.set('stock', stock);
    next.set('cursor', answer.next_cursor);
    go(`/ledger?${next.toString()}`);
  });
  const newest = el('button', { type: 'button', text: 'Newest lines' });
  newest.addEventListener('click', () => {
    const next = new URLSearchParams();
    if (stock !== null) next.set('stock', stock);
    go(`/ledger${next.toString() === '' ? '' : `?${next.toString()}`}`);
  });
  root.append(el('div', { class: 'row' }, [older, newest]));

  const footer = el('div', { class: 'panelcard', role: 'region', 'aria-label': 'Ledger footer' });
  if (answer.footer.remaining_mm !== null) {
    footer.append(el('p', { text: lengthPair(answer.footer.remaining_mm) }));
  }
  footer.append(el('p', { text: areaPair(answer.footer.on_hand_mm2) }));
  footer.append(el('p', { text: `${answer.footer.offcut_count} offcuts · ${answer.footer.lines} lines` }));
  root.append(footer);
}

function signedAreaPair(mm2: number): string {
  return mm2 < 0 ? `-${areaPair(-mm2)}` : areaPair(mm2);
}

/* ------------------------------------------------------------------ console */

const TABS = ['submissions', 'audit', 'standing', 'roles', 'export'] as const;
const TAB_LABELS: Record<string, string> = {
  submissions: 'Submissions',
  audit: 'Audit',
  standing: 'Standing',
  roles: 'Roles',
  export: 'Export',
};

export async function renderConsole(root: HTMLElement, query: URLSearchParams): Promise<void> {
  const tab = (query.get('tab') ?? 'submissions') as (typeof TABS)[number];
  const season = query.get('season') ?? String(new Date().getUTCFullYear());
  clear(root);
  root.append(el('h1', { text: 'Console', tabindex: '-1' }));

  const list = el('div', { class: 'tablist', role: 'tablist' });
  for (const name of TABS) {
    const button = el('button', {
      type: 'button',
      role: 'tab',
      text: TAB_LABELS[name] as string,
      'aria-selected': name === tab ? 'true' : 'false',
    });
    button.addEventListener('click', () => {
      const next = new URLSearchParams();
      next.set('tab', name);
      if (name === 'standing') next.set('season', season);
      go(`/console?${next.toString()}`);
    });
    list.append(button);
  }
  root.append(list);

  const panel = el('div');
  root.append(panel);
  if (tab === 'submissions') await renderSubmissionsTab(root, panel);
  else if (tab === 'audit') await renderAuditTab(panel);
  else if (tab === 'standing') await renderStandingTab(panel, Number(season));
  else if (tab === 'roles') await renderRolesTab(panel);
  else renderExportTab(panel);
}

async function renderSubmissionsTab(root: HTMLElement, panel: HTMLElement): Promise<void> {
  const pending = await call<Page<Submission>>('/api/submissions?status=pending&limit=50');
  const decided = await call<Page<Submission>>('/api/submissions?status=accepted&limit=50');
  clear(panel);
  panel.append(el('p', { text: `${pending.total} pending` }));

  if (pending.items.length === 0) {
    panel.append(el('p', { class: 'empty', text: EMPTY_COPY.pendingSubmissions }));
  } else {
    const chosen = new Set<string>();
    const columns: Column<Submission>[] = [
      {
        header: 'Select',
        cell: (row) => {
          const box = el('input', { type: 'checkbox', 'aria-label': `Select ${row.id}` });
          box.addEventListener('change', () => {
            if (box.checked) chosen.add(row.id);
            else chosen.delete(row.id);
          });
          return box;
        },
      },
      { header: 'Submission', cell: (row) => row.id },
      { header: 'Owner', cell: (row) => row.submitted_by.display_name },
      { header: 'Boat', cell: (row) => row.boat_code },
      { header: 'Dimension', cell: (row) => row.dimension },
      { header: 'Figure', cell: (row) => figureCell(row) },
      { header: 'Measured on', cell: (row) => row.measured_on },
      { header: 'Submitted', cell: (row) => instantText(row.submitted_at) },
      { header: 'Note', cell: (row) => row.note },
      { header: 'Result', cell: (row) => el('span', { 'data-result': row.id }) },
    ];
    panel.append(el('div', { class: 'panelcard' }, [table('Pending submissions', columns, pending.items)]));

    const decide = async (decision: 'accept' | 'reject', reason: string | null): Promise<void> => {
      const answer = await call<{ results: { id: string; outcome: string; reason: string | null }[] }>(
        '/api/admin/submissions/decisions',
        {
          method: 'POST',
          body: { decisions: [...chosen].map((id) => ({ id, decision, reason })) },
        },
      );
      const applied = answer.results.filter((item) => item.outcome === 'applied').length;
      announce(SUCCESS.bulk(applied, answer.results.length - applied));
      await renderSubmissionsTab(root, panel);
      for (const item of answer.results) {
        if (item.outcome !== 'refused' || item.reason === null) continue;
        const cell = panel.querySelector(`[data-result="${item.id}"]`);
        if (cell) cell.textContent = (BULK_REFUSAL_COPY as Record<string, string>)[item.reason] ?? '';
      }
    };

    const accept = el('button', { class: 'action', type: 'button', text: 'Accept selected' });
    accept.addEventListener('click', () => void decide('accept', null));
    const reject = el('button', { type: 'button', text: 'Reject selected' });
    reject.addEventListener('click', () =>
      showDialog(
        {
          title: 'Reject submissions',
          submit: 'Reject',
          fields: [{ name: 'reason', label: 'Reason' }],
          onSubmit: async (values) => {
            await decide('reject', values['reason'] ?? null);
          },
        },
        reject,
      ),
    );
    panel.append(el('div', { class: 'row' }, [accept, reject]));
  }

  const decidedColumns: Column<Submission>[] = [
    { header: 'Submission', cell: (row) => row.id },
    { header: 'Owner', cell: (row) => row.submitted_by.display_name },
    { header: 'Boat', cell: (row) => row.boat_code },
    { header: 'Dimension', cell: (row) => row.dimension },
    { header: 'Figure', cell: (row) => figureCell(row) },
    { header: 'Status', cell: (row) => chip(row.status === 'accepted' ? 'Accepted' : row.status === 'rejected' ? 'Rejected' : 'Reversed') },
    { header: 'Decided', cell: (row) => instantText(row.decided_at) },
    { header: 'Reason', cell: (row) => row.reason ?? '' },
    {
      header: 'Action',
      cell: (row) => {
        if (row.status !== 'accepted') return '';
        const button = el('button', { type: 'button', text: `Reverse ${row.id}` });
        button.addEventListener('click', () =>
          showDialog(
            {
              title: 'Reverse submission',
              submit: 'Reverse',
              fields: [{ name: 'reason', label: 'Reason' }],
              onSubmit: async (values) => {
                await call(`/api/submissions/${row.id}/reverse`, {
                  method: 'POST',
                  body: { reason: values['reason'] },
                });
                announce(SUCCESS.reversed(row.id));
                await renderSubmissionsTab(root, panel);
              },
            },
            button,
          ),
        );
        return button;
      },
    },
  ];
  panel.append(el('div', { class: 'panelcard' }, [table('Decided submissions', decidedColumns, decided.items)]));
}

async function renderAuditTab(panel: HTMLElement): Promise<void> {
  const page = await call<Page<{
    id: string; at: string; actor_email: string; action: string; target: string;
    before: string | null; after: string | null; reason: string | null;
  }>>('/api/admin/audit?limit=20');
  clear(panel);
  const columns: Column<(typeof page.items)[number]>[] = [
    { header: 'When', cell: (row) => instantText(row.at) },
    { header: 'Actor', cell: (row) => row.actor_email },
    { header: 'Action', cell: (row) => row.action },
    { header: 'Target', cell: (row) => row.target },
    { header: 'Before', cell: (row) => row.before ?? '' },
    { header: 'After', cell: (row) => row.after ?? '' },
    { header: 'Reason', cell: (row) => row.reason ?? '' },
  ];
  panel.append(el('div', { class: 'panelcard' }, [table('Audit trail', columns, page.items)]));
  panel.append(el('button', { type: 'button', text: 'Older entries' }));
}

async function renderStandingTab(panel: HTMLElement, season: number): Promise<void> {
  const answer = await call<{
    season: number;
    items: readonly {
      rank: number; owner_email: string; owner_name: string; counted: number; accepted: number;
      rejected: number; reversed: number; streak: number; standing: string;
    }[];
  }>(`/api/admin/standing?season=${season}`);
  clear(panel);
  // Each standing load announces the published owner count.
  announce(SUCCESS.standingLoad(answer.items.length, answer.season));

  const seasons = el('select', { 'aria-label': 'Season' });
  const thisYear = new Date().getUTCFullYear();
  for (let year = thisYear; year >= thisYear - 3; year -= 1) {
    seasons.append(el('option', { value: String(year), text: String(year), selected: year === season }));
  }
  seasons.addEventListener('change', () => go(`/console?tab=standing&season=${seasons.value}`));
  panel.append(el('div', { class: 'row' }, [seasons]));

  const columns: Column<(typeof answer.items)[number]>[] = [
    { header: 'Rank', cell: (row) => String(row.rank) },
    { header: 'Owner', cell: (row) => row.owner_name },
    { header: 'Counted', cell: (row) => String(row.counted) },
    { header: 'Accepted', cell: (row) => String(row.accepted) },
    { header: 'Rejected', cell: (row) => String(row.rejected) },
    { header: 'Reversed', cell: (row) => String(row.reversed) },
    { header: 'Streak', cell: (row) => String(row.streak) },
    { header: 'Standing', cell: (row) => chip(row.standing, row.standing === STANDING_CHIPS.true_tape) },
  ];
  panel.append(el('div', { class: 'panelcard' }, [table('Tape standing', columns, answer.items)]));
}

async function renderRolesTab(panel: HTMLElement): Promise<void> {
  const answer = await call<{
    items: readonly { ability: string; sailmaker: string; 'loft-hand': string; 'yacht-owner': string }[];
  }>('/api/admin/roles');
  clear(panel);
  const columns: Column<(typeof answer.items)[number]>[] = [
    { header: 'Ability', cell: (row) => row.ability },
    { header: 'sailmaker', cell: (row) => row.sailmaker },
    { header: 'loft-hand', cell: (row) => row['loft-hand'] },
    { header: 'yacht-owner', cell: (row) => row['yacht-owner'] },
  ];
  panel.append(el('div', { class: 'panelcard' }, [table('Role abilities', columns, answer.items)]));
}

function renderExportTab(panel: HTMLElement): void {
  clear(panel);
  panel.append(
    el('p', {}, [el('a', { class: 'action', href: '/api/exports/ledger.csv', download: '', text: 'Download ledger CSV' })]),
  );
}

/* ------------------------------------------------------------------ accounts */

export async function renderAccounts(root: HTMLElement): Promise<void> {
  const page = await call<Page<{ id: string; email: string; display_name: string; role: string }>>(
    '/api/accounts?limit=50',
  );
  clear(root);
  root.append(el('h1', { text: 'Accounts', tabindex: '-1' }));
  const create = el('button', { class: 'action', type: 'button', text: 'New account' });
  create.addEventListener('click', () =>
    showDialog(
      {
        title: 'New account',
        submit: 'Create account',
        fields: [
          { name: 'display_name', label: 'Display name' },
          { name: 'email', label: 'Email' },
          { name: 'password', label: 'Password', type: 'password' },
          { name: 'role', label: 'Role', options: [
            { value: 'yacht-owner', label: 'Yacht owner' },
            { value: 'loft-hand', label: 'Loft hand' },
          ] },
        ],
        onSubmit: async (values) => {
          announce(PENDING_COPY.save);
          const made = await call<{ email: string }>('/api/accounts', {
            method: 'POST',
            body: {
              display_name: values['display_name'],
              email: values['email'],
              password: values['password'],
              role: values['role'],
            },
          });
          announce(SUCCESS.accountCreated(made.email));
          await renderAccounts(root);
          const buttons = [...root.querySelectorAll<HTMLElement>('button')];
          buttons.find((button) => button.textContent === `Edit ${made.email}`)?.focus();
        },
      },
      create,
    ),
  );
  root.append(el('div', { class: 'row' }, [create]));

  const columns: Column<(typeof page.items)[number]>[] = [
    { header: 'Account', cell: (row) => row.id },
    { header: 'Name', cell: (row) => row.display_name },
    { header: 'Email', cell: (row) => row.email },
    { header: 'Role', cell: (row) => row.role },
    {
      header: 'Action',
      cell: (row) => {
        const edit = el('button', { type: 'button', text: `Edit ${row.email}` });
        edit.addEventListener('click', () =>
          showDialog(
            {
              title: 'Edit account',
              submit: 'Save account',
              fields: [{ name: 'display_name', label: 'Display name', value: row.display_name }],
              onSubmit: async (values) => {
                await call(`/api/accounts/${row.id}`, {
                  method: 'PATCH',
                  body: { display_name: values['display_name'] },
                });
                announce(SUCCESS.saved);
                await renderAccounts(root);
              },
            },
            edit,
          ),
        );
        const remove = el('button', { type: 'button', text: `Delete ${row.email}` });
        remove.addEventListener('click', () => {
          void (async () => {
            try {
              await call(`/api/accounts/${row.id}`, { method: 'DELETE', expect: 'none' });
              announce(SUCCESS.saved);
              await renderAccounts(root);
            } catch (cause) {
              if (cause instanceof ApiError) refuse(cause.message);
            }
          })();
        });
        return el('span', { class: 'controls' }, [edit, remove]);
      },
    },
  ];
  root.append(el('div', { class: 'panelcard' }, [table('Accounts', columns, page.items)]));
}

/* ------------------------------------------------------------------ rule sets */

interface RuleSet {
  readonly version: number;
  readonly effective_at: string;
  readonly current: boolean;
  readonly seam_overlap_mm: number;
  readonly roach_permille: number;
  readonly tolerance_mm: number;
  readonly min_offcut_width_mm: number;
  readonly min_offcut_length_mm: number;
  readonly revision: number;
}

const RULE_FIELDS = [
  { name: 'seam_overlap_mm', label: 'Seam overlap (mm)' },
  { name: 'roach_permille', label: 'Roach (permille)' },
  { name: 'tolerance_mm', label: 'Tolerance (mm)' },
  { name: 'min_offcut_width_mm', label: 'Minimum offcut width (mm)' },
  { name: 'min_offcut_length_mm', label: 'Minimum offcut length (mm)' },
] as const;

export async function renderRuleSets(root: HTMLElement): Promise<void> {
  const page = await call<Page<RuleSet>>('/api/rulesets?limit=50');
  clear(root);
  root.append(el('h1', { text: 'Rule sets', tabindex: '-1' }));
  const create = el('button', { class: 'action', type: 'button', text: 'New rule set' });
  create.addEventListener('click', () =>
    showDialog(
      {
        title: 'New rule set',
        submit: 'Save rule set',
        fields: [...RULE_FIELDS.map((field) => ({ name: field.name, label: field.label })), { name: 'effective_at', label: 'Effective at' }],
        onSubmit: async (values) => {
          const made = await call<RuleSet>('/api/rulesets', {
            method: 'POST',
            body: {
              seam_overlap_mm: Number(values['seam_overlap_mm']),
              roach_permille: Number(values['roach_permille']),
              tolerance_mm: Number(values['tolerance_mm']),
              min_offcut_width_mm: Number(values['min_offcut_width_mm']),
              min_offcut_length_mm: Number(values['min_offcut_length_mm']),
              effective_at: values['effective_at'],
            },
          });
          announce(SUCCESS.rulesetSaved(made.version));
          await renderRuleSets(root);
        },
      },
      create,
    ),
  );
  root.append(el('div', { class: 'row' }, [create]));

  const columns: Column<RuleSet>[] = [
    { header: 'Version', cell: (row) => `v${row.version}` },
    { header: 'Effective at', cell: (row) => instantText(row.effective_at) },
    { header: 'Current', cell: (row) => (row.current ? 'yes' : '') },
    { header: 'Seam overlap', cell: (row) => `${row.seam_overlap_mm} mm` },
    { header: 'Roach', cell: (row) => String(row.roach_permille) },
    { header: 'Tolerance', cell: (row) => `±${row.tolerance_mm} mm` },
    {
      header: 'Action',
      cell: (row) => {
        if (Date.parse(row.effective_at) <= Date.now()) return '';
        const edit = el('button', { type: 'button', text: `Edit v${row.version}` });
        edit.addEventListener('click', () =>
          showDialog(
            {
              title: 'Edit rule set',
              submit: 'Save rule set',
              fields: [
                ...RULE_FIELDS.map((field) => ({
                  name: field.name,
                  label: field.label,
                  value: String(row[field.name]),
                })),
                { name: 'effective_at', label: 'Effective at', value: row.effective_at },
              ],
              onSubmit: async (values) => {
                await call(`/api/rulesets/${row.version}`, {
                  method: 'PATCH',
                  ifMatch: row.revision,
                  body: {
                    seam_overlap_mm: Number(values['seam_overlap_mm']),
                    roach_permille: Number(values['roach_permille']),
                    tolerance_mm: Number(values['tolerance_mm']),
                    min_offcut_width_mm: Number(values['min_offcut_width_mm']),
                    min_offcut_length_mm: Number(values['min_offcut_length_mm']),
                    effective_at: values['effective_at'],
                  },
                });
                announce(SUCCESS.rulesetSaved(row.version));
                await renderRuleSets(root);
              },
            },
            edit,
          ),
        );
        return edit;
      },
    },
  ];
  root.append(el('div', { class: 'panelcard' }, [table('Rule sets', columns, page.items)]));
}

/* ------------------------------------------------------------------ floor */

export async function renderFloor(root: HTMLElement): Promise<void> {
  const page = await call<Page<Drawing>>('/api/drawings?limit=50');
  clear(root);
  root.append(el('h1', { text: 'Cutting floor', tabindex: '-1' }));
  if (page.items.length === 0) {
    root.append(el('p', { class: 'empty', text: EMPTY_COPY.floor }));
    return;
  }
  const list = el('ul', { class: 'cardgrid queue', role: 'list', 'aria-label': 'Cutting queue' });
  for (const drawing of page.items) {
    const card = el('li');
    card.append(
      el('a', {
        href: `/floor/${drawing.code}`,
        text: `${drawing.code} · ${drawing.boat_name} ${drawing.sail === 'mainsail' ? 'Mainsail' : 'Headsail'}`,
      }),
    );
    card.append(el('p', { class: 'governing', text: drawing.cloth_code }));
    card.append(el('p', {}, [chip((STATUS_CHIP_LABELS as Record<string, string>)[drawing.status] ?? drawing.status)]));
    list.append(card);
  }
  root.append(list);
}

/* ------------------------------------------------------------------ owner */

export async function renderOwner(root: HTMLElement): Promise<void> {
  const [boats, submissions, sheets] = await Promise.all([
    call<Page<Boat>>('/api/boats?limit=50'),
    call<Page<Submission>>('/api/submissions?limit=50'),
    call<Page<{ id: string; drawing_code: string }>>('/api/my/cut-sheets?limit=50'),
  ]);
  clear(root);
  root.append(el('h1', { text: 'My boats', tabindex: '-1' }));
  if (boats.items.length === 0) {
    root.append(el('p', { class: 'empty', text: EMPTY_COPY.ownerBoats }));
  }
  for (const boat of boats.items) {
    const card = el('div', { class: 'panelcard' });
    card.append(el('h2', { text: `${boat.code} · ${boat.name}` }));
    for (const dimension of boat.dimensions) {
      card.append(
        el('p', {
          text: `${dimension.key} ${dimension.value_mm === null ? '' : lengthPair(dimension.value_mm)}`,
        }),
      );
    }
    const submit = el('button', { class: 'action', type: 'button', text: 'Submit measurement' });
    submit.addEventListener('click', () => openSubmit(root, boat, submit));
    card.append(submit);
    root.append(card);
  }

  const columns: Column<Submission>[] = [
    { header: 'Submission', cell: (row) => row.id },
    { header: 'Boat', cell: (row) => row.boat_code },
    { header: 'Dimension', cell: (row) => row.dimension },
    { header: 'Figure', cell: (row) => figureCell(row) },
    { header: 'Status', cell: (row) => chip(row.status) },
    { header: 'Reason', cell: (row) => row.reason ?? '' },
  ];
  root.append(el('div', { class: 'panelcard' }, [table('My submissions', columns, submissions.items)]));

  root.append(el('h2', { text: 'Cut sheets' }));
  if (sheets.items.length === 0) {
    root.append(el('p', { class: 'empty', text: EMPTY_COPY.ownerSheets }));
  } else {
    const wrap = el('div', { class: 'panelcard' });
    for (const grant of sheets.items) {
      wrap.append(
        el('p', {}, [
          el('a', { href: `/sheets/${grant.id}`, text: `Open cut sheet ${grant.drawing_code}` }),
        ]),
      );
    }
    root.append(wrap);
  }
}

function openSubmit(root: HTMLElement, boat: Boat, opener: HTMLElement): void {
  showDialog(
    {
      title: 'Submit measurement',
      submit: 'Send to the loft',
      fields: [
        { name: 'dimension', label: 'Dimension', options: ['I', 'J', 'P', 'E', 'LL', 'LP'].map((key) => ({ value: key, label: key })) },
        { name: 'value', label: 'Measured length' },
        { name: 'unit', label: 'Unit', options: [
          { value: 'mm', label: 'mm' },
          { value: 'in', label: 'in' },
        ] },
        { name: 'measured_on', label: 'Measured on', type: 'date' },
        { name: 'note', label: 'Note' },
      ],
      onSubmit: async (values) => {
        announce(PENDING_COPY.submission);
        const body: Record<string, unknown> = {
          dimension: values['dimension'],
          measured_on: values['measured_on'],
          note: values['note'],
        };
        if (values['unit'] === 'in') body['value_in'] = values['value'];
        else body['value_mm'] = Number(values['value']);
        await call(`/api/boats/${boat.code}/submissions`, { method: 'POST', body });
        announce(SUCCESS.submissionSent);
        await renderOwner(root);
      },
    },
    opener,
  );
}

/* ------------------------------------------------------------------ viewer */

export async function renderSheetViewer(root: HTMLElement, grantId: string): Promise<() => void> {
  const paint = async (): Promise<boolean> => {
    try {
      const grant = await call<{ id: string; drawing_code: string; status: string }>(`/api/grants/${grantId}`);
      const drawing = await call<Drawing & { cut_sheet: { superseded_by: string | null } | null }>(
        `/api/drawings/${grant.drawing_code}`,
      );
      const account = await call<Record<string, number | string>>(`/api/drawings/${grant.drawing_code}/account`);
      clear(root);
      const view = el('div', { class: 'sheetview' });
      view.append(el('h1', { text: `Cut sheet ${grant.drawing_code}`, tabindex: '-1' }));
      if (drawing.cut_sheet?.superseded_by) {
        view.append(el('p', { text: supersededBannerCopy(drawing.cut_sheet.superseded_by) }));
      }
      view.append(
        el('img', { src: `/api/grants/${grantId}/cut-sheet`, alt: `Cut sheet ${grant.drawing_code}` }),
      );
      const lines = el('ul', { class: 'accountlines' });
      const figures: [string, number][] = [
        [SAIL_ACCOUNT_LINES[0], account['charge_pence'] as number],
        [SAIL_ACCOUNT_LINES[1], account['tax_pence'] as number],
        [SAIL_ACCOUNT_LINES[2], account['total_pence'] as number],
        [SAIL_ACCOUNT_LINES[3], account['deposit_pence'] as number],
        [SAIL_ACCOUNT_LINES[4], account['paid_pence'] as number],
        [SAIL_ACCOUNT_LINES[5], account['credited_pence'] as number],
        [SAIL_ACCOUNT_LINES[6], account['balance_pence'] as number],
      ];
      for (const [label, pence] of figures) {
        lines.append(el('li', {}, [el('span', { text: label }), el('span', { text: money(pence) })]));
      }
      const region = el('div', { role: 'region', 'aria-label': 'Sail account' }, [
        chip((SAIL_ACCOUNT_CHIPS as Record<string, string>)[String(account['status'])] ?? ''),
        lines,
      ]);
      view.append(region);
      root.append(view);
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        clear(root);
        root.append(el('div', { class: 'sheetview' }, [el('p', { class: 'errorfield', text: OWNER_VIEWER_REFUSAL })]));
        return false;
      }
      throw cause;
    }
  };

  await paint();
  // The viewer checks its grant at least every 5 seconds.
  const handle = window.setInterval(() => {
    void paint().then((live) => {
      if (!live) window.clearInterval(handle);
    });
  }, 5000);
  return () => window.clearInterval(handle);
}

export { FIELD_COPY };
