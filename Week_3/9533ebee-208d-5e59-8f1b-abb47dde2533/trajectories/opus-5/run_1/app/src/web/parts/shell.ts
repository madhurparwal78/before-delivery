/**
 * The three zones of the ledger sheet: the pool column, the worksheet and the
 * price rail, under a top bar holding the brand, the Acting as chooser and
 * the section navigation.
 */

import { ASSET_CODES, type Asset } from '../../domain/assets.ts';
import { ORACLE_STATUS_LINE, ROLE_LABEL, STALE_BANNER } from '../../domain/copy.ts';
import {
  formatAmount,
  formatDuration,
  formatPercent,
  formatPriceFromApi,
  formatSharePrice,
} from '../../domain/deskformat.ts';
import type { Role } from '../../domain/roles.ts';
import { clear, el, labelled, setText, type LabelledValue } from '../dom.ts';
import { store } from '../store.ts';

/** The sections each role uses, from the published table. */
const SECTIONS: ReadonlyArray<{ path: string; label: string; roles: readonly Role[] }> = [
  { path: '/steward', label: 'Steward', roles: ['risk_steward'] },
  { path: '/ledger', label: 'Ledger', roles: ['risk_steward'] },
  { path: '/liquidations', label: 'Liquidations', roles: ['liquidator', 'risk_steward'] },
  { path: '/supply', label: 'Supply', roles: ['liquidity_provider'] },
  { path: '/trade', label: 'Trade', roles: ['trader'] },
  { path: '/borrow', label: 'Borrow', roles: ['borrower'] },
];

/** Where each role lands when it is chosen. */
export const ROLE_HOME: Readonly<Record<Role, string>> = {
  risk_steward: '/steward',
  liquidity_provider: '/supply',
  trader: '/trade',
  borrower: '/borrow',
  liquidator: '/liquidations',
};

export class TopBar {
  readonly element: HTMLElement;
  readonly chooser: HTMLSelectElement;
  private readonly nav: HTMLElement;
  private readonly badge: HTMLElement;

  constructor(onChoose: (actorId: string) => void) {
    this.chooser = el('select', { class: 'chooser', 'aria-label': 'Acting as' });
    this.chooser.addEventListener('change', () => onChoose(this.chooser.value));
    this.badge = el('span', { class: 'badge figure', 'aria-hidden': 'true' });
    this.nav = el('nav', { 'aria-label': 'Sections', class: 'sections' });
    this.element = el('header', { class: 'topbar' }, [
      el('span', { class: 'brand', text: 'Quillmoor Reserve' }),
      el('div', { class: 'acting' }, [
        el('label', { class: 'label', text: 'Acting as', for: 'acting-as' }),
        this.chooser,
      ]),
      this.nav,
    ]);
    this.chooser.id = 'acting-as';
  }

  update(currentPath: string): void {
    const member = store.member;
    const options = store.actors.map((actor) =>
      el('option', {
        value: actor.actor_id,
        text: `${actor.name} (${ROLE_LABEL[actor.role]})`,
        selected: actor.actor_id === member?.actor_id,
      }),
    );
    if (this.chooser.options.length !== options.length) {
      clear(this.chooser);
      for (const option of options) this.chooser.append(option);
    }
    if (member !== null) this.chooser.value = member.actor_id;

    const allowed = SECTIONS.filter(
      (section) => member !== null && section.roles.includes(member.role),
    );
    clear(this.nav);
    for (const section of allowed) {
      const link = el('a', {
        href: section.path,
        'data-route': 'true',
        class: 'section-link',
        ...(section.path === currentPath ? { 'aria-current': 'page' } : {}),
      });
      // Counts and badges are never part of a control's accessible name.
      link.append(document.createTextNode(section.label));
      if (section.label === 'Liquidations') {
        setText(this.badge, String(store.queueSize));
        link.append(this.badge);
      }
      this.nav.append(link);
    }
  }
}

interface PoolCardValues {
  readonly available: LabelledValue;
  readonly borrowed: LabelledValue;
  readonly utilization: LabelledValue;
  readonly sharePrice: LabelledValue;
  readonly borrowRate: LabelledValue;
  readonly supplyRate: LabelledValue;
}

export class PoolColumn {
  readonly element: HTMLElement;
  private readonly cards = new Map<Asset, PoolCardValues>();

  constructor() {
    this.element = el('aside', { class: 'pool-column' });
    for (const asset of ASSET_CODES) {
      const values: PoolCardValues = {
        available: labelled('Available liquidity'),
        borrowed: labelled('Total borrowed'),
        utilization: labelled('Utilization'),
        sharePrice: labelled('Share price'),
        borrowRate: labelled('Borrow rate'),
        supplyRate: labelled('Supply rate'),
      };
      this.cards.set(asset, values);
      const card = el('article', { class: 'pool-card', 'aria-label': `${asset} pool` }, [
        el('h2', { class: 'pool-head' }, [
          el('span', { class: 'pool-code', text: asset }),
          el('span', { class: 'pool-name', 'data-name': asset }),
        ]),
        values.available.row,
        values.borrowed.row,
        values.utilization.row,
        values.sharePrice.row,
        values.borrowRate.row,
        values.supplyRate.row,
      ]);
      this.element.append(card);
    }
  }

  update(): void {
    for (const asset of ASSET_CODES) {
      const pool = store.poolFor(asset);
      const values = this.cards.get(asset);
      if (pool === undefined || pool === null || values === undefined) continue;
      const name = this.element.querySelector(`[data-name="${asset}"]`);
      if (name !== null) setText(name, pool.name);
      setText(
        values.available.value,
        formatAmount(BigInt(pool.available_liquidity), pool.decimals),
      );
      setText(values.borrowed.value, formatAmount(BigInt(pool.total_borrowed), pool.decimals));
      setText(values.utilization.value, formatPercent(BigInt(pool.utilization_bps)));
      setText(values.sharePrice.value, formatSharePrice(pool.share_price));
      setText(values.borrowRate.value, formatPercent(BigInt(pool.borrow_rate_bps)));
      setText(values.supplyRate.value, formatPercent(BigInt(pool.supply_rate_bps)));
    }
  }
}

export class PriceRail {
  readonly element: HTMLElement;
  private readonly groups = new Map<
    Asset,
    { price: HTMLElement; source: HTMLElement; age: HTMLElement; status: HTMLElement }
  >();
  private readonly durations: {
    readonly grace: LabelledValue;
    readonly quote: LabelledValue;
    readonly staleness: LabelledValue;
  };
  private readonly banner: HTMLElement;

  constructor() {
    this.element = el('aside', { class: 'price-rail', 'aria-label': 'Posted prices' });
    this.element.setAttribute('role', 'complementary');
    for (const asset of ASSET_CODES) {
      const price = el('span', { class: 'rail-price figure' });
      const source = el('span', { class: 'rail-source' });
      const age = el('span', { class: 'rail-age' });
      const status = el('span', { class: 'rail-status' });
      this.groups.set(asset, { price, source, age, status });
      const group = el(
        'div',
        { role: 'group', 'aria-label': `${asset} price`, class: 'rail-group' },
        [el('span', { class: 'rail-asset', text: asset }), price, source, age, status],
      );
      this.element.append(group);
    }
    this.durations = {
      grace: labelled('Grace period'),
      quote: labelled('Quote lifetime'),
      staleness: labelled('Staleness limit'),
    };
    this.element.append(
      el('div', { class: 'rail-durations' }, [
        this.durations.grace.row,
        this.durations.quote.row,
        this.durations.staleness.row,
      ]),
    );
    this.banner = el('div', {
      role: 'alert',
      'aria-label': 'Price feed',
      class: 'stale-banner',
    });
    this.element.append(this.banner);
  }

  update(): void {
    for (const asset of ASSET_CODES) {
      const pool = store.poolFor(asset);
      const group = this.groups.get(asset);
      if (pool === null || pool === undefined || group === undefined) continue;
      setText(group.price, formatPriceFromApi(pool.price));
      setText(
        group.source,
        pool.price_source === 'oracle' && pool.oracle_round !== null
          ? `Oracle round ${pool.oracle_round}`
          : 'Manual post',
      );
      setText(group.age, `Posted ${pool.price_age_seconds} seconds ago`);
      setText(group.status, ORACLE_STATUS_LINE[pool.oracle_status]);
    }
    const pools = store.pools;
    if (pools !== null) {
      setText(this.durations.grace.value, formatDuration(secondsOf(pools.grace_period)));
      setText(this.durations.quote.value, formatDuration(secondsOf(pools.quote_lifetime)));
      setText(this.durations.staleness.value, formatDuration(secondsOf(pools.staleness_limit)));
    }

    // The banner is present only while any market is stale.
    const stale = store.staleAssets;
    if (stale.length === 0) {
      if (this.banner.childNodes.length > 0) clear(this.banner);
      this.banner.classList.remove('shown');
      return;
    }
    this.banner.classList.add('shown');
    const wanted = [
      STALE_BANNER,
      ...stale.map((pool) => `${pool.asset} price is ${pool.price_age_seconds} seconds old.`),
    ];
    const current = Array.from(this.banner.children).map((child) => child.textContent ?? '');
    if (current.join('\u0000') === wanted.join('\u0000')) return;
    clear(this.banner);
    for (const line of wanted) {
      this.banner.append(el('p', { class: 'banner-line', text: line }));
    }
  }
}

/** The acting member's wallet, at the top of the worksheet. */
export class WalletRegion {
  readonly element: HTMLElement;
  private readonly values = new Map<Asset, LabelledValue>();

  constructor() {
    this.element = el('section', { class: 'wallet', 'aria-label': 'Wallet' });
    this.element.setAttribute('role', 'region');
    this.element.append(el('h2', { class: 'zone-head', text: 'Wallet' }));
    for (const asset of ASSET_CODES) {
      const value = labelled(asset);
      this.values.set(asset, value);
      this.element.append(value.row);
    }
  }

  update(): void {
    const wallet = store.wallet;
    for (const asset of ASSET_CODES) {
      const value = this.values.get(asset);
      if (value === undefined) continue;
      const balance = wallet?.balances.find((entry) => entry.asset === asset)?.amount ?? '0';
      setText(value.value, formatAmount(BigInt(balance), store.decimalsOf(asset)));
    }
  }
}

/** Reads an ISO 8601 duration of only H, M and S into seconds. */
export function secondsOf(duration: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration);
  if (match === null) return 0;
  const [, hours, minutes, seconds] = match;
  return Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
}
