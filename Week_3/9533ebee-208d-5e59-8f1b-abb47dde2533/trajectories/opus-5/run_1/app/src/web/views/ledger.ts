/**
 * The Ledger view. Its asset, count and desk-time window filters live in the
 * URL, so Back, Forward and reload restore them, and an unknown value falls
 * back to its default with a history replace rather than a push.
 */

import { ASSET_CODES, isAsset, type Asset } from '../../domain/assets.ts';
import { formatAmount } from '../../domain/deskformat.ts';
import {
  formatWallDateTime,
  isCanonicalUtc,
  parseDeskWallTime,
} from '../../domain/desktime.ts';
import { request } from '../api.ts';
import { clear, el } from '../dom.ts';
import { Field } from '../parts/fields.ts';
import type { LiveRegions } from '../parts/live.ts';
import { store } from '../store.ts';
import type { LedgerTotalsDto, PostingsDto } from '../types.ts';
import type { View } from './view.ts';

const LIMITS = ['20', '50', '200'] as const;
const DEFAULT_LIMIT = '50';

export interface LedgerFilter {
  readonly asset: Asset | null;
  readonly limit: string;
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * Reads the filter out of a URL, falling back to defaults, and says whether
 * anything had to fall back.
 */
export function readFilter(search: URLSearchParams): {
  filter: LedgerFilter;
  corrected: boolean;
} {
  let corrected = false;
  const assetRaw = search.get('asset');
  let asset: Asset | null = null;
  if (assetRaw !== null) {
    if (isAsset(assetRaw)) asset = assetRaw;
    else corrected = true;
  }
  const limitRaw = search.get('limit');
  let limit: string = DEFAULT_LIMIT;
  if (limitRaw !== null) {
    if ((LIMITS as readonly string[]).includes(limitRaw)) limit = limitRaw;
    else corrected = true;
  }
  const readInstant = (name: string): string | null => {
    const raw = search.get(name);
    if (raw === null) return null;
    if (isCanonicalUtc(raw)) return raw;
    corrected = true;
    return null;
  };
  const from = readInstant('from');
  const to = readInstant('to');
  return { filter: { asset, limit, from, to }, corrected };
}

/** The URL a filter writes, with each parameter present only when it differs. */
export function filterToSearch(filter: LedgerFilter): string {
  const parts: string[] = [];
  if (filter.asset !== null) parts.push(`asset=${filter.asset}`);
  if (filter.limit !== DEFAULT_LIMIT) parts.push(`limit=${filter.limit}`);
  if (filter.from !== null) parts.push(`from=${filter.from}`);
  if (filter.to !== null) parts.push(`to=${filter.to}`);
  return parts.length === 0 ? '/ledger' : `/ledger?${parts.join('&')}`;
}

export function ledgerView(
  initial: LedgerFilter,
  live: LiveRegions,
  navigate: (path: string) => void,
  push: (path: string) => void,
  replace: (path: string) => void,
): View {
  let filter = initial;

  const assetChooser = el('select', {
    class: 'chooser',
    'aria-label': 'Ledger asset',
    id: 'ledger-asset',
  });
  assetChooser.append(el('option', { value: '', text: 'All assets' }));
  for (const asset of ASSET_CODES) {
    assetChooser.append(el('option', { value: asset, text: asset }));
  }
  const limitChooser = el('select', {
    class: 'chooser',
    'aria-label': 'Postings shown',
    id: 'ledger-limit',
  });
  for (const limit of LIMITS) {
    limitChooser.append(el('option', { value: limit, text: limit }));
  }

  const fromField = new Field(
    'Posted from',
    { kind: 'deskTime', zone: () => store.deskTimeZone },
    { placeholder: 'YYYY-MM-DD HH:MM' },
  );
  const toField = new Field(
    'Posted before',
    { kind: 'deskTime', zone: () => store.deskTimeZone },
    { placeholder: 'YYYY-MM-DD HH:MM' },
  );

  const totalsBody = el('tbody');
  const totalsTable = el('table', { class: 'ledger-table', 'aria-label': 'Ledger totals' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Asset' }),
        el('th', { text: 'Debits' }),
        el('th', { text: 'Credits' }),
        el('th', { text: 'Net' }),
      ]),
    ]),
    totalsBody,
  ]);

  const postingsBody = el('tbody');
  const postingsTable = el('table', { class: 'ledger-table', 'aria-label': 'Postings' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Posting' }),
        el('th', { text: 'Kind' }),
        el('th', { text: 'Time' }),
        el('th', { text: 'Account' }),
        el('th', { text: 'Asset' }),
        el('th', { text: 'Amount' }),
      ]),
    ]),
    postingsBody,
  ]);

  /** Writes the controls from the filter, without touching the URL. */
  function applyFilterToControls(): void {
    assetChooser.value = filter.asset ?? '';
    limitChooser.value = filter.limit;
    fromField.value = filter.from === null ? '' : deskStampOf(filter.from);
    toField.value = filter.to === null ? '' : deskStampOf(filter.to);
  }

  function deskStampOf(instant: string): string {
    return formatWallDateTime(Date.parse(instant), store.deskTimeZone).replace(
      /:\d{2} (NST|NDT|[A-Z]{2,5}|GMT[+-]\d+:\d+)$/,
      '',
    );
  }

  // Choosing an asset or a count pushes one history entry.
  assetChooser.addEventListener('change', () => {
    const value = assetChooser.value;
    filter = { ...filter, asset: value === '' ? null : (value as Asset) };
    push(filterToSearch(filter));
    void load();
  });
  limitChooser.addEventListener('change', () => {
    filter = { ...filter, limit: limitChooser.value };
    push(filterToSearch(filter));
    void load();
  });

  /** Committing a desk time with Enter or by leaving the field pushes one entry. */
  function commit(field: Field, name: 'from' | 'to'): void {
    if (field.value.trim() === '') {
      if (filter[name] === null) return;
      filter = { ...filter, [name]: null };
      push(filterToSearch(filter));
      void load();
      return;
    }
    // A desk-time field error leaves the URL untouched.
    if (!field.validate()) return;
    const parsed = parseDeskWallTime(field.value, store.deskTimeZone);
    if (!parsed.ok) return;
    const instant = new Date(parsed.instantMs).toISOString().slice(0, 19) + 'Z';
    if (filter[name] === instant) return;
    filter = { ...filter, [name]: instant };
    push(filterToSearch(filter));
    void load();
  }

  for (const [field, name] of [
    [fromField, 'from'],
    [toField, 'to'],
  ] as const) {
    field.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commit(field, name);
    });
    field.input.addEventListener('blur', () => commit(field, name));
  }

  async function load(): Promise<void> {
    try {
      const query: string[] = [`limit=${filter.limit}`];
      if (filter.asset !== null) query.push(`asset=${filter.asset}`);
      if (filter.from !== null) query.push(`from=${filter.from}`);
      if (filter.to !== null) query.push(`to=${filter.to}`);
      const [totals, postings] = await Promise.all([
        request<LedgerTotalsDto>('GET', '/api/ledger/totals', { token: store.token }),
        request<PostingsDto>('GET', `/api/ledger/postings?${query.join('&')}`, {
          token: store.token,
        }),
      ]);
      renderTotals(totals);
      renderPostings(postings);
    } catch (error) {
      live.report(error);
    }
  }

  function renderTotals(dto: LedgerTotalsDto): void {
    clear(totalsBody);
    // All three assets are always listed.
    for (const asset of ASSET_CODES) {
      const total = dto.assets.find((entry) => entry.asset === asset);
      const decimals = store.decimalsOf(asset);
      totalsBody.append(
        el('tr', {}, [
          el('td', { 'data-label': 'Asset', text: asset }),
          el('td', {
            'data-label': 'Debits',
            class: 'figure',
            text: formatAmount(BigInt(total?.debits ?? '0'), decimals),
          }),
          el('td', {
            'data-label': 'Credits',
            class: 'figure',
            text: formatAmount(BigInt(total?.credits ?? '0'), decimals),
          }),
          el('td', {
            'data-label': 'Net',
            class: 'figure',
            text: formatAmount(BigInt(total?.net ?? '0'), decimals),
          }),
        ]),
      );
    }
  }

  function renderPostings(dto: PostingsDto): void {
    clear(postingsBody);
    for (const posting of dto.postings) {
      const when = formatWallDateTime(Date.parse(posting.created_at), store.deskTimeZone);
      posting.legs.forEach((leg, index) => {
        const row = el('tr', { class: index === 0 ? 'posting-first' : 'posting-leg' }, [
          el('td', {
            'data-label': 'Posting',
            class: 'figure',
            text: index === 0 ? posting.posting_id : '',
          }),
          el('td', { 'data-label': 'Kind', text: index === 0 ? posting.kind : '' }),
          el('td', { 'data-label': 'Time', class: 'figure', text: index === 0 ? when : '' }),
          el('td', { 'data-label': 'Account', text: leg.account }),
          el('td', { 'data-label': 'Asset', text: leg.asset }),
          el('td', {
            'data-label': 'Amount',
            class: 'figure',
            text: formatAmount(BigInt(leg.amount), store.decimalsOf(leg.asset)),
          }),
        ]);
        postingsBody.append(row);
      });
    }
  }

  const element = el('section', { class: 'worksheet-body' }, [
    el('h1', { class: 'view-head', text: 'Ledger' }),
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Ledger asset', for: 'ledger-asset' }),
        assetChooser,
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Postings shown', for: 'ledger-limit' }),
        limitChooser,
      ]),
      fromField.row,
      toField.row,
    ]),
    el('h2', { class: 'zone-head', text: 'Trial balance' }),
    totalsTable,
    el('h2', { class: 'zone-head', text: 'Postings' }),
    postingsTable,
  ]);

  applyFilterToControls();
  void load();

  return {
    element,
    update: () => void load().catch(() => undefined),
    navigateAway: () => undefined,
    onPost: () => undefined,
    navigate,
    // Back and Forward restore the controls and the table without a reload.
    ...{
      applyUrl: (next: LedgerFilter, needsReplace: boolean): void => {
        filter = next;
        applyFilterToControls();
        if (needsReplace) replace(filterToSearch(filter));
        void load();
      },
    },
  } as View & { applyUrl: (next: LedgerFilter, needsReplace: boolean) => void };
}
