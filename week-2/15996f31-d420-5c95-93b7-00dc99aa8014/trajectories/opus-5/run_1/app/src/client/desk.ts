import type {
  BeekeeperOrder,
  BeekeeperOrderListItem,
  BrokerOrder,
  DropView,
  GrowerOrder,
  OrchardListItem,
  SessionUser,
} from '../shared/api-types';
import { formatMoney } from '../shared/format';
import { formatCalendarDate } from '../shared/pacific';
import {
  dropStatusLabel,
  inspectionLinkStatusLabel,
  orderStatusLabel,
  type Tier,
} from '../shared/labels';
import { announceUpdate, clear, el, request } from './core';
import { Drawer } from './dialog';
import { icon } from './icons';
import { mountBeekeeperActions, mountBrokerActions } from './desk-actions';
import { Odometer } from './odometer';
import { PlatMap, averageText, type PlatBlockInput } from './platmap';
import { tierLegend } from './patterns';
import { StrengthPresenter } from './strength';
import { ariaTable, ledgerTable } from './table';

const REFRESH_MS = 3_000;

export type AnyOrder = BrokerOrder | GrowerOrder | BeekeeperOrder;

export interface DeskView {
  readonly user: SessionUser;
  order(): AnyOrder | null;
  orchards(): readonly OrchardListItem[];
  selectedOrchard(): OrchardListItem | null;
  openOrders(): readonly BeekeeperOrderListItem[];
  myDrops(): readonly DropView[];
  actionsHost: HTMLElement;
  extrasHost: HTMLElement;
  refresh(): Promise<void>;
}

interface BlockSnapshot {
  averageFrames: number | null;
  tier: Tier | null;
}

function isBrokerOrder(order: AnyOrder): order is BrokerOrder {
  return 'commission_cents' in order;
}

function isBeekeeperOrder(order: AnyOrder): order is BeekeeperOrder {
  return 'my_drops' in order;
}

/** Acres come from the order for the broker and grower, from the orchard otherwise. */
function platBlocks(order: AnyOrder, orchard: OrchardListItem | null): PlatBlockInput[] {
  const acresByBlock = new Map(
    (orchard?.blocks ?? []).map((block) => [block.id, block.acres] as const),
  );
  return order.blocks.map((block) => ({
    id: block.id,
    name: block.name,
    acres: 'acres' in block ? block.acres : (acresByBlock.get(block.id) ?? 1),
    averageFrames: block.average_frames,
    tier: block.tier,
  }));
}

export async function renderDesk(root: HTMLElement, user: SessionUser): Promise<void> {
  let orchards: OrchardListItem[] = [];
  let selectedOrchardId: string | null = null;
  let selectedOrderId: string | null = null;
  let order: AnyOrder | null = null;
  let openOrders: BeekeeperOrderListItem[] = [];
  let myDrops: DropView[] = [];
  let selectedBlockId: string | null = null;

  const skip = el('a', { href: '#plat-map', class: 'skip', text: 'Skip to plat map' });
  const signOut = el('button', { type: 'button', class: 'button button--quiet' }, [
    icon('log-out'),
    'Sign out',
  ]);
  signOut.addEventListener('click', () => {
    void request('DELETE', '/api/session').then(() => window.location.assign('/'));
  });

  const header = el('header', { class: 'topbar' }, [
    el('p', { class: 'wordmark wordmark--small', text: 'Swarmline Bloom Desk' }),
    el('p', { class: 'topbar__who' }, [
      el('span', { class: 'topbar__name', text: user.name }),
      el('span', { class: 'topbar__role', text: user.role }),
    ]),
    signOut,
  ]);

  const railNav = el('nav', { class: 'rail__nav', 'aria-label': 'Orchards' });
  const rail = el('div', { class: 'rail' }, [
    el('h2', { class: 'rail__title', text: 'Orchards' }),
    railNav,
  ]);
  const orchardsToggle = el(
    'button',
    { type: 'button', class: 'button button--quiet rail__toggle', 'aria-expanded': 'false' },
    [icon('panel-left'), 'Orchards'],
  );
  let drawer: Drawer;
  orchardsToggle.addEventListener('click', () => {
    if (drawer.isOpen) drawer.hide();
    else drawer.show();
  });

  const orderPicker = el('select', {
    class: 'picker__control',
    id: 'order-picker',
  });
  const pickerBlock = el('div', { class: 'picker' }, [
    el('label', { for: 'order-picker', class: 'picker__label', text: 'Order' }),
    orderPicker,
  ]);

  const platmap = new PlatMap('', (blockId) => {
    selectedBlockId = blockId;
    platmap.select(blockId);
    paintPlacements();
  });
  const legend = tierLegend();
  const canvas = el('div', { class: 'canvas' }, [pickerBlock, platmap.element, legend]);

  const payableOdometer = new Odometer('ledger__figure', formatMoney(0));
  const presenter = new StrengthPresenter(payableOdometer);
  const ledgerRows = el('div', { class: 'ledger__rows' });
  const statusLine = el('p', { class: 'ledger__status' });
  const linkLine = el('p', { class: 'ledger__link' });
  const actionsHost = el('div', { class: 'ledger__actions' });
  const ledger = el('div', { class: 'ledger' }, [
    el('h2', { class: 'ledger__title', text: 'Order ledger' }),
    ledgerRows,
    statusLine,
    linkLine,
    actionsHost,
  ]);
  const extrasHost = el('div', { class: 'extras' });

  const deskGrid = el('div', { class: 'desk' }, [
    orchardsToggle,
    rail,
    canvas,
    ledger,
    extrasHost,
  ]);
  drawer = new Drawer(orchardsToggle, rail, () => deskGrid.insertBefore(rail, canvas));
  root.append(skip, header, deskGrid);
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    platmap.element.focus();
  });

  const view: DeskView = {
    user,
    order: () => order,
    orchards: () => orchards,
    selectedOrchard: () =>
      orchards.find((orchard) => orchard.id === selectedOrchardId) ?? null,
    openOrders: () => openOrders,
    myDrops: () => myDrops,
    actionsHost,
    extrasHost,
    refresh: () => load(),
  };

  function paintRail(): void {
    clear(railNav);
    if (orchards.length === 0) {
      railNav.append(el('p', { class: 'empty', text: 'No orchards yet.' }));
      return;
    }
    for (const orchard of orchards) {
      const latest = [...orchard.orders].sort((left, right) =>
        left.bloom_start < right.bloom_start ? 1 : -1,
      )[0];
      const link = el('a', {
        href: `#orchard-${orchard.id}`,
        class: 'rail__item',
        'aria-current': orchard.id === selectedOrchardId ? 'true' : null,
      });
      link.append(
        el('span', { class: 'rail__name', text: orchard.name }),
        el('span', { class: 'rail__county', text: `${orchard.county} County` }),
        el('span', {
          class: 'rail__status',
          text: latest === undefined ? 'No orders yet' : orderStatusLabel(latest.status, 'none'),
        }),
      );
      link.addEventListener('click', (event) => {
        event.preventDefault();
        selectedOrchardId = orchard.id;
        selectedOrderId = null;
        selectedBlockId = null;
        if (drawer.isOpen) drawer.hide();
        void load();
      });
      railNav.append(link);
    }
  }

  function paintPicker(): void {
    const orchard = view.selectedOrchard();
    clear(orderPicker);
    const list = [...(orchard?.orders ?? [])].sort((left, right) =>
      left.bloom_start < right.bloom_start ? 1 : -1,
    );
    for (const entry of list) {
      orderPicker.append(
        el('option', {
          value: entry.id,
          text: `${entry.ref} · ${formatCalendarDate(entry.bloom_start)}`,
        }),
      );
    }
    if (selectedOrderId !== null) orderPicker.value = selectedOrderId;
    orderPicker.disabled = list.length === 0;
  }

  orderPicker.addEventListener('change', () => {
    selectedOrderId = orderPicker.value;
    selectedBlockId = null;
    void load();
  });

  function paintLedger(): void {
    const current = order;
    clear(ledgerRows);
    if (current === null) {
      statusLine.textContent = '';
      linkLine.textContent = '';
      return;
    }
    const figure = (text: string): HTMLElement => el('span', { class: 'ledger__figure', text });
    if (isBeekeeperOrder(current)) {
      const mine = current.my_drops;
      const committed = mine.reduce((total, drop) => total + drop.hives, 0);
      const delivered = mine
        .filter((drop) => drop.status !== 'committed')
        .reduce((total, drop) => total + drop.hives, 0);
      const expected = mine.reduce((total, drop) => total + (drop.payout_cents ?? 0), 0);
      ledgerRows.append(
        ledgerTable([
          { label: 'Ordered', value: figure(String(current.hives_ordered)) },
          { label: 'Still open', value: figure(String(current.hives_remaining)) },
          { label: 'My committed', value: figure(String(committed)) },
          { label: 'My delivered', value: figure(String(delivered)) },
          { label: 'My expected pay', value: figure(formatMoney(expected)) },
        ]),
      );
    } else if (isBrokerOrder(current)) {
      payableOdometer.set(formatMoney(current.payable_cents));
      ledgerRows.append(
        ledgerTable([
          { label: 'Ordered', value: figure(String(current.hives_ordered)) },
          { label: 'Committed', value: figure(String(current.hives_committed)) },
          { label: 'Delivered', value: figure(String(current.hives_delivered)) },
          { label: 'Deposit', value: figure(formatMoney(current.deposit_cents)) },
          { label: 'Payable', value: payableOdometer.element },
          { label: 'Commission', value: figure(formatMoney(current.commission_cents)) },
          {
            label: 'Beekeeper payouts',
            value: figure(formatMoney(current.payable_cents - current.commission_cents)),
          },
        ]),
      );
    } else {
      payableOdometer.set(formatMoney(current.payable_cents));
      ledgerRows.append(
        ledgerTable([
          { label: 'Ordered', value: figure(String(current.hives_ordered)) },
          { label: 'Delivered', value: figure(String(current.hives_delivered)) },
          { label: 'Deposit', value: figure(formatMoney(current.deposit_cents)) },
          { label: 'Payable', value: payableOdometer.element },
        ]),
      );
    }
    ledgerRows.append(
      el('p', { class: 'ledger__bloom' }, [
        el('span', { class: 'ledger__bloom-label', text: 'Bloom window' }),
        el('span', {
          class: 'ledger__bloom-dates',
          text: `${formatCalendarDate(current.bloom_start)} – ${formatCalendarDate(current.bloom_end)}`,
        }),
      ]),
    );
    const settlementStatus = 'settlement_status' in current ? current.settlement_status : 'none';
    statusLine.textContent = `Order status: ${orderStatusLabel(current.status, settlementStatus)}`;
    if (isBrokerOrder(current)) {
      linkLine.textContent =
        current.inspection_link === null
          ? 'Inspection link: none sent'
          : `Inspection link: ${inspectionLinkStatusLabel(current.inspection_link.status)}`;
    } else if (current.status === 'inspected' || current.status === 'settled') {
      clear(linkLine);
      if ('report_available' in current && current.report_available) {
        linkLine.append(
          el(
            'a',
            {
              class: 'ledger__report',
              href: `/api/orders/${current.id}/report`,
              target: '_blank',
              rel: 'noopener',
            },
            [icon('file-text'), 'Inspection report (PDF)'],
          ),
        );
      }
    } else {
      linkLine.textContent = '';
    }
  }

  function placementsFor(current: AnyOrder, blockId: string): HTMLElement {
    const block = current.blocks.find((entry) => entry.id === blockId);
    if (block === undefined) return el('div');
    const name = `Placements, ${block.name}`;
    if (isBeekeeperOrder(current)) {
      const mine = current.my_drops.filter((drop) => drop.block?.id === blockId);
      return ariaTable(
        name,
        [
          { label: 'Yard', cell: (drop: DropView) => drop.yard_name },
          { label: 'Hives', cell: (drop) => String(drop.hives), numeric: true },
          {
            label: 'Delivered',
            cell: (drop) =>
              drop.delivered_on === null ? '—' : formatCalendarDate(drop.delivered_on),
            numeric: true,
          },
          {
            label: 'Strength',
            cell: (drop) =>
              drop.average_frames === null ? '—' : `${drop.average_frames.toFixed(1)} frames`,
            numeric: true,
          },
        ],
        mine,
        'No drops in this block yet.',
      );
    }
    if (isBrokerOrder(current)) {
      const brokerBlock = current.blocks.find((entry) => entry.id === blockId);
      return ariaTable(
        name,
        [
          { label: 'Yard', cell: (row: BrokerOrder['blocks'][0]['placements'][0]) => row.yard_name },
          { label: 'Beekeeper', cell: (row) => row.beekeeper.name },
          { label: 'Hives', cell: (row) => String(row.hives), numeric: true },
          {
            label: 'Delivered',
            cell: (row) => formatCalendarDate(row.delivered_on),
            numeric: true,
          },
          {
            label: 'Strength',
            cell: (row) =>
              row.average_frames === null ? '—' : `${row.average_frames.toFixed(1)} frames`,
            numeric: true,
          },
          { label: 'Status', cell: (row) => dropStatusLabel(row.status) },
          {
            label: 'Pay per hive',
            cell: (row) =>
              row.pay_per_hive_cents === null ? '—' : formatMoney(row.pay_per_hive_cents),
            numeric: true,
          },
          {
            label: 'Payout',
            cell: (row) => (row.payout_cents === null ? '—' : formatMoney(row.payout_cents)),
            numeric: true,
          },
        ],
        brokerBlock?.placements ?? [],
        'No drops in this block yet.',
      );
    }
    const growerBlock = (current as GrowerOrder).blocks.find((entry) => entry.id === blockId);
    return ariaTable(
      name,
      [
        { label: 'Yard', cell: (row: GrowerOrder['blocks'][0]['placements'][0]) => row.yard_name },
        { label: 'Hives', cell: (row) => String(row.hives), numeric: true },
        { label: 'Delivered', cell: (row) => formatCalendarDate(row.delivered_on), numeric: true },
        {
          label: 'Strength',
          cell: (row) =>
            row.average_frames === null ? '—' : `${row.average_frames.toFixed(1)} frames`,
          numeric: true,
        },
      ],
      growerBlock?.placements ?? [],
      'No drops in this block yet.',
    );
  }

  const placementsHost = el('div', { class: 'placements' });

  function paintPlacements(): void {
    clear(placementsHost);
    if (order === null || selectedBlockId === null) return;
    placementsHost.append(placementsFor(order, selectedBlockId));
  }

  function snapshot(): Map<string, BlockSnapshot> {
    const map = new Map<string, BlockSnapshot>();
    for (const block of order?.blocks ?? []) {
      map.set(block.id, { averageFrames: block.average_frames, tier: block.tier });
    }
    return map;
  }

  function paintMap(previous: Map<string, BlockSnapshot>): void {
    const current = order;
    if (current === null) return;
    platmap.setOrchardName(current.orchard.name);
    platmap.setBlocks(platBlocks(current, view.selectedOrchard()));
    platmap.select(selectedBlockId);
    for (const block of current.blocks) {
      const cell = platmap.cell(block.id);
      if (cell === undefined) continue;
      const before = previous.get(block.id);
      const changed =
        before === undefined ||
        averageText(before.averageFrames) !== averageText(block.average_frames) ||
        before.tier !== block.tier;
      if (changed && before !== undefined) {
        presenter.apply(
          cell,
          { averageFrames: before.averageFrames, tier: before.tier },
          { averageFrames: block.average_frames, tier: block.tier },
          payable(),
        );
      }
    }
  }

  function payable(): number {
    return order === null || isBeekeeperOrder(order) ? 0 : order.payable_cents;
  }

  function paintExtras(): void {
    clear(extrasHost);
    extrasHost.append(placementsHost);
    paintPlacements();
  }

  async function load(): Promise<void> {
    orchards = await request<OrchardListItem[]>('GET', '/api/orchards');
    if (selectedOrchardId === null || !orchards.some((o) => o.id === selectedOrchardId)) {
      selectedOrchardId = orchards[0]?.id ?? null;
      selectedOrderId = null;
    }
    const orchard = view.selectedOrchard();
    const sorted = [...(orchard?.orders ?? [])].sort((left, right) =>
      left.bloom_start < right.bloom_start ? 1 : -1,
    );
    if (selectedOrderId === null || !sorted.some((entry) => entry.id === selectedOrderId)) {
      selectedOrderId = sorted[0]?.id ?? null;
    }
    const previous = snapshot();
    order =
      selectedOrderId === null
        ? null
        : await request<AnyOrder>('GET', `/api/orders/${selectedOrderId}`);
    if (user.role === 'beekeeper') {
      const all = await request<BeekeeperOrderListItem[]>('GET', '/api/orders');
      openOrders = all.filter((entry) => entry.status === 'open');
      myDrops = await request<DropView[]>('GET', '/api/drops');
    }
    paintRail();
    paintPicker();
    paintMap(previous);
    paintLedger();
    paintExtras();
    paintActions();
  }

  function paintActions(): void {
    clear(actionsHost);
    if (user.role === 'broker') mountBrokerActions(view);
    if (user.role === 'beekeeper') mountBeekeeperActions(view);
  }

  await load();

  if (user.role !== 'beekeeper') {
    window.setInterval(() => {
      void (async (): Promise<void> => {
        if (selectedOrderId === null) return;
        const previous = snapshot();
        const previousStatus =
          order === null
            ? ''
            : orderStatusLabel(
                order.status,
                'settlement_status' in order ? order.settlement_status : 'none',
              );
        const fresh = await request<AnyOrder>('GET', `/api/orders/${selectedOrderId}`).catch(
          () => null,
        );
        if (fresh === null) return;
        order = fresh;
        paintMap(previous);
        paintLedger();
        paintPlacements();
        const nextStatus = orderStatusLabel(
          fresh.status,
          'settlement_status' in fresh ? fresh.settlement_status : 'none',
        );
        if (previousStatus !== nextStatus && nextStatus === 'Settled') {
          announceUpdate(`${fresh.orchard.name} settled.`);
        }
      })();
    }, REFRESH_MS);
  }
}
