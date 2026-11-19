import { newIdempotencyKey, request } from '../api';
import { COPY, MOVEMENT_LABELS, hours, money } from '../copy';
import { Dialog } from '../dialog';
import { button, clear, el, row, table } from '../dom';
import { icon } from '../icons';
import { StatusRegion } from '../status';
import { every } from '../timers';
import { setBlockingDialog } from '../auth';
import type { AppContext } from '../main';
import { localDateOf, localTimeOf } from '../../shared/tz';
import type { BalancesJson, BookingJson, MovementJson } from '../../shared/types';

interface LedgerResponse {
  balances: BalancesJson;
  movements: MovementJson[];
}

interface PurchaseResponse {
  purchase: {
    id: string;
    pack_name: string;
    hours: number;
    valid_through: string;
  };
  balances: BalancesJson;
}

export function renderPacks(container: HTMLElement, ctx: AppContext): void {
  const member = ctx.me.member;
  if (member === null) return;
  const status = new StatusRegion('Pack status');
  const availableNumeral = el('p', { class: 'numeral-line' });
  const committedNumeral = el('p', { class: 'numeral-line' });
  const lotList = el('ul', { role: 'list', 'aria-label': 'Pack hours by expiry', class: 'lot-list' });
  const packCards = el('div', { class: 'pack-cards' });
  const ledger = table('Hour ledger', ['When', 'Movement', 'Booking', 'By', 'Available', 'Committed']);
  let lastBalanceAt = 0;
  let bookingReferences = new Map<string, string>();
  const homeZone = ctx.siteById(member.home_site_id)?.time_zone ?? 'UTC';

  const stamp = (instant: string): string => {
    const at = Date.parse(instant);
    return `${localDateOf(homeZone, at)} ${localTimeOf(homeZone, at)}`;
  };

  container.append(
    el('section', { class: 'packs-top' }, [
      el('div', { class: 'numerals' }, [availableNumeral, committedNumeral, lotList]),
      packCards,
    ]),
    ledger.root,
    status.element,
  );

  function drawBalances(balances: BalancesJson): void {
    availableNumeral.textContent = `Available pack hours ${hours(balances.available_hours)}`;
    committedNumeral.textContent = `Committed pack hours ${hours(balances.committed_hours)}`;
    clear(lotList);
    for (const lot of balances.lots) {
      const item = el('li', { role: 'listitem', class: 'lot-line' });
      if (lot.expiring_soon) {
        const marker = el('span', { class: 'flame-marker' });
        marker.append(icon('flame', 'Expiring soon'));
        item.append(marker);
      }
      const text =
        lot.valid_through === null
          ? `Opening balance: ${hours(lot.hours)} h, no expiry`
          : `${lot.pack_name}: ${hours(lot.hours)} h, valid through ${lot.valid_through}`;
      item.append(el('span', { text }));
      lotList.append(item);
    }
  }

  function drawMovements(movements: MovementJson[]): void {
    clear(ledger.body);
    let available = 0;
    let committed = 0;
    const running: { available: number; committed: number }[] = [];
    for (const movement of [...movements].reverse()) {
      for (const entry of movement.entries) {
        if (entry.account === 'available') available += entry.hours;
        if (entry.account === 'committed') committed += entry.hours;
      }
      running.unshift({ available, committed });
    }
    movements.forEach((movement, index) => {
      const totals = running[index] ?? { available: 0, committed: 0 };
      ledger.body.append(
        row([
          { label: 'When', content: stamp(movement.created_at) },
          { label: 'Movement', content: MOVEMENT_LABELS[movement.kind] ?? movement.kind },
          {
            label: 'Booking',
            content:
              movement.booking_id === null
                ? '—'
                : bookingReferences.get(movement.booking_id) ?? '—',
          },
          { label: 'By', content: movement.actor === null ? 'Pilotlight' : movement.actor.name },
          { label: 'Available', content: hours(totals.available) },
          { label: 'Committed', content: hours(totals.committed) },
        ]),
      );
    });
  }

  function loadLedger(): void {
    const startedAt = Date.now();
    void request<LedgerResponse>('/api/me/ledger').then((result) => {
      if (!result.ok) return;
      if (startedAt < lastBalanceAt) return;
      drawBalances(result.data.balances);
      drawMovements(result.data.movements);
    });
  }

  function loadPacks(): void {
    void request<{ packs: { id: string; name: string; hours: number; price_cents: number }[] }>(
      '/api/packs',
    ).then((result) => {
      if (!result.ok) return;
      clear(packCards);
      for (const pack of result.data.packs) {
        const buy = button(`Buy ${pack.name}`, { class: 'primary' });
        buy.addEventListener('click', () => openBuyDialog(pack, buy));
        packCards.append(
          el('article', { class: 'pack-card' }, [
            el('h3', { text: pack.name }),
            el('p', { class: 'pack-hours', text: `${hours(pack.hours)} h` }),
            el('p', { class: 'pack-price', text: `$${money(pack.price_cents)}` }),
            buy,
          ]),
        );
      }
    });
  }

  function loadReferences(): void {
    void request<{ bookings: BookingJson[] }>('/api/bookings').then((result) => {
      if (!result.ok) return;
      bookingReferences = new Map(
        result.data.bookings.map((booking) => [booking.id, booking.reference]),
      );
      loadLedger();
    });
  }

  function openBuyDialog(
    pack: { id: string; name: string; hours: number; price_cents: number },
    opener: HTMLElement,
  ): void {
    const pay = button('Pay and add hours', { class: 'primary' });
    const close = button('Close');
    const dialog = new Dialog({ title: `Buy ${pack.name}`, opener });
    dialog.body.append(
      el('p', { text: `${hours(pack.hours)} pack hours for $${money(pack.price_cents)}` }),
      pay,
      close,
    );
    const key = newIdempotencyKey();
    const info = { dialog, pendingResend: null as (() => void) | null };
    setBlockingDialog(info);
    const closeDialog = (): void => {
      setBlockingDialog(null);
      dialog.close();
    };
    close.addEventListener('click', closeDialog);
    const send = (): void => {
      pay.setAttribute('aria-disabled', 'true');
      status.write(COPY.charging(pack.price_cents));
      info.pendingResend = send;
      void request<PurchaseResponse>('/api/pack-purchases', {
        method: 'POST',
        idempotencyKey: key,
        body: { pack_id: pack.id },
      }).then((result) => {
        if (result.status !== 401) info.pendingResend = null;
        if (result.ok) {
          lastBalanceAt = Date.now();
          closeDialog();
          drawBalances(result.data.balances);
          status.write(
            COPY.packAdded(
              result.data.purchase.hours,
              result.data.purchase.valid_through,
              ctx.me.user.email,
            ),
          );
          loadReferences();
          return;
        }
        pay.setAttribute('aria-disabled', 'false');
        if (result.status === 401) return;
        if (result.error.code === 'billing_unavailable') status.write(COPY.billingUnavailablePack);
        else if (result.error.code === 'idempotency_in_progress') status.write(COPY.packInProgress);
        else if (result.error.code === 'idempotency_conflict') status.write(COPY.packKeyConflict);
        else if (result.error.code === 'csrf_failed') status.write(COPY.csrf);
        else if (result.status === 0) status.write(COPY.offline);
        else status.write(COPY.internal);
      });
    };
    pay.addEventListener('click', () => {
      if (pay.getAttribute('aria-disabled') === 'true') return;
      send();
    });
    dialog.open(pay);
  }

  drawBalances({
    available_hours: member.available_hours,
    committed_hours: member.committed_hours,
    lots: [],
  });
  loadPacks();
  loadReferences();
  every(60000, loadLedger);
}
