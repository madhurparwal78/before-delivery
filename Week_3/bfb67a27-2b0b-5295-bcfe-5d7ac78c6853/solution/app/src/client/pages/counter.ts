import { formatMoney } from '../../shared/money.js';
import { apiGet, apiSend, ApiFailure, newIdempotencyKey } from '../api.js';
import { COUNTER_STATUS, depositLabel } from '../copy.js';
import { openDialog } from '../dialog.js';
import { clear, currentLayout, el } from '../dom.js';
import { mountServiceNotice } from '../notice.js';
import { signOutButton } from './desk.js';
import {
  checkinPanel,
  checkoutPanel,
  PHOTO_LABELS,
  type PanelContext,
  type UnitDraft,
} from './counterPanels.js';
import type { Blocker, Booking, BookingUnit, KitDetailView } from '../../shared/types.js';

/** The counter list carries every booking that is still in play. */
const HIDDEN_STATES = new Set(['closed', 'expired', 'cancelled']);

export async function renderCounter(root: HTMLElement): Promise<void> {
  clear(root);
  try {
    await apiGet<{ role: string }>('/api/session');
  } catch {
    window.location.assign('/desk');
    return;
  }

  const page = el('div', { class: 'page page-counter' });
  root.append(page);
  mountServiceNotice(page);

  const status = el('div', {
    role: 'status',
    'aria-label': 'Counter status',
    class: 'counter-status',
  });
  const listPane = el('ul', { 'aria-label': 'Bookings', class: 'bookings-list' });
  const listHost = el('div', { class: 'bookings-pane' }, [
    el('h2', { class: 'region-heading' }, ['Bookings']),
    listPane,
  ]);
  const detailPane = el('section', { 'aria-label': 'Booking detail', class: 'booking-detail' });

  let bookings: Booking[] = [];
  let selectedRef: string | null = null;
  let drafts = new Map<string, UnitDraft>();
  let checkoutOpen = false;
  let checkinOpen = false;

  const narrow = (): boolean => currentLayout() !== 'desktop';
  const selected = (): Booking | null =>
    bookings.find((booking) => booking.ref === selectedRef) ?? null;

  const announce = (message: string): void => {
    status.textContent = message;
  };

  const reportFailure = (error: unknown, target?: HTMLElement): void => {
    if (!(error instanceof ApiFailure)) throw error;
    const message = error.controlMessage();
    if (target !== undefined) target.textContent = message;
    announce(message);
  };

  const loadBookings = async (): Promise<void> => {
    const all = await apiGet<{ bookings: Booking[] }>('/api/bookings');
    bookings = all.bookings.filter((booking) => !HIDDEN_STATES.has(booking.state));
  };

  const reload = async (): Promise<void> => {
    await loadBookings();
    renderPanes();
  };

  const renderList = (): void => {
    clear(listPane);
    for (const booking of bookings) {
      const entry = el('button', { type: 'button', class: 'booking-entry' }, [
        `${booking.ref} · ${booking.kit.name}`,
      ]);
      entry.addEventListener('click', () => {
        selectedRef = booking.ref;
        checkoutOpen = false;
        checkinOpen = false;
        drafts = new Map();
        renderPanes();
      });
      listPane.append(
        el(
          'li',
          { class: booking.ref === selectedRef ? 'booking-item selected' : 'booking-item' },
          [
            entry,
            el('p', { class: 'booking-meta' }, [
              `${booking.renter.name} · ${booking.pickupDate} to ${booking.returnDate} · ${booking.state}`,
            ]),
          ],
        ),
      );
    }
  };

  const photoLabelFor = (
    booking: Booking,
    serial: string,
    phase: 'checkout' | 'checkin',
  ): string => {
    const photos = booking.photos.filter(
      (photo) => photo.serial === serial && photo.phase === phase,
    );
    if (photos.some((photo) => photo.status === 'stored')) return PHOTO_LABELS.stored;
    const last = photos[photos.length - 1];
    return last === undefined ? '—' : PHOTO_LABELS[last.status];
  };

  const swapCell = (booking: Booking, unit: BookingUnit): HTMLElement[] => {
    if (booking.state !== 'quote' && booking.state !== 'confirmed') return [];
    const button = el('button', { type: 'button', class: 'button button-small' }, [
      `Swap ${unit.serial}`,
    ]);
    button.addEventListener('click', () => void openSwapDialog(booking, unit));
    return [button];
  };

  const serialTable = (booking: Booking): HTMLElement =>
    el('table', { class: 'unit-table serial-table' }, [
      el('caption', {}, ['Assigned units']),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col' }, ['Serial']),
          el('th', { scope: 'col' }, ['Class']),
          el('th', { scope: 'col' }, ['Location']),
          el('th', { scope: 'col' }, ['Checkout photo']),
          el('th', { scope: 'col' }, ['Check-in photo']),
          el('th', { scope: 'col' }, ['Swap']),
        ]),
      ]),
      el(
        'tbody',
        {},
        booking.units.map((unit) =>
          el('tr', {}, [
            el('td', { 'data-label': 'Serial' }, [unit.serial]),
            el('td', { 'data-label': 'Class' }, [unit.className]),
            el('td', { 'data-label': 'Location' }, [unit.location]),
            el('td', { 'data-label': 'Checkout photo', 'data-photo': `checkout:${unit.serial}` }, [
              photoLabelFor(booking, unit.serial, 'checkout'),
            ]),
            el('td', { 'data-label': 'Check-in photo', 'data-photo': `checkin:${unit.serial}` }, [
              photoLabelFor(booking, unit.serial, 'checkin'),
            ]),
            el('td', {}, swapCell(booking, unit)),
          ]),
        ),
      ),
    ]);

  const openSwapDialog = async (booking: Booking, unit: BookingUnit): Promise<void> => {
    const detail = await apiGet<KitDetailView>(
      `/api/kits/${booking.kit.id}?pickupDate=${booking.pickupDate}&returnDate=${booking.returnDate}`,
    );
    const candidates = detail.units.filter(
      (candidate) => candidate.classId === unit.classId && candidate.status === 'free',
    );
    openDialog('Swap unit', (close) => {
      const select = el(
        'select',
        { 'aria-label': 'Replacement serial', class: 'text-field' },
        candidates.map((candidate) =>
          el('option', { value: candidate.serial }, [candidate.serial]),
        ),
      );
      const error = el('p', { class: 'field-error' });
      const swap = el('button', { type: 'button', class: 'button button-primary' }, ['Swap']);
      swap.addEventListener('click', () => {
        void (async () => {
          try {
            await apiSend<Booking>('POST', `/api/bookings/${booking.ref}/swap`, {
              from: unit.serial,
              to: select.value,
            });
            const replacement = select.value;
            close();
            await reload();
            announce(COUNTER_STATUS.swapped(unit.serial, replacement));
          } catch (failure) {
            reportFailure(failure, error);
          }
        })();
      });
      return [
        el('h2', { class: 'dialog-heading' }, ['Swap unit']),
        el('label', { class: 'field' }, [
          el('span', { class: 'field-label' }, ['Replacement serial']),
          select,
        ]),
        error,
        el('div', { class: 'dialog-actions' }, [swap]),
      ];
    });
  };

  const blockerList = (label: string, blockers: Blocker[]): HTMLElement =>
    el(
      'ul',
      { 'aria-label': label, class: 'blocker-list' },
      blockers.map((blocker) => el('li', {}, [blocker.message])),
    );

  const panelContext = (booking: Booking): PanelContext => ({
    booking,
    detail: detailPane,
    drafts,
    announce,
    reportFailure,
    reload,
    finishCheckout: () => {
      checkoutOpen = false;
      drafts = new Map();
    },
  });

  const backButton = (ref: string): HTMLElement => {
    const back = el('button', { type: 'button', class: 'button' }, ['Back to bookings']);
    back.addEventListener('click', () => {
      selectedRef = null;
      renderPanes();
      for (const entry of listPane.querySelectorAll<HTMLButtonElement>('.booking-entry')) {
        if (entry.textContent?.startsWith(ref) === true) entry.focus();
      }
    });
    return back;
  };

  const prepButton = (booking: Booking): HTMLElement => {
    const prep = el('button', { type: 'button', class: 'button button-primary' }, ['Prep kit']);
    prep.addEventListener('click', () => {
      void (async () => {
        try {
          await apiSend<Booking>('POST', `/api/bookings/${booking.ref}/prep`, {});
          await reload();
          announce(COUNTER_STATUS.prepped(booking.ref));
        } catch (failure) {
          reportFailure(failure);
        }
      })();
    });
    return prep;
  };

  const closeButton = (booking: Booking): HTMLElement => {
    const close = el('button', { type: 'button', class: 'button button-primary' }, [
      'Close check-in',
    ]);
    close.disabled = !booking.close.allowed;
    close.addEventListener('click', () => {
      void (async () => {
        try {
          await apiSend<Booking>(
            'POST',
            `/api/bookings/${booking.ref}/close`,
            {},
            { 'Idempotency-Key': newIdempotencyKey() },
          );
          checkinOpen = false;
          selectedRef = null;
          await reload();
          announce(COUNTER_STATUS.checkinClosed(booking.ref));
        } catch (failure) {
          reportFailure(failure);
        }
      })();
    });
    return close;
  };

  const renderDetail = (): void => {
    clear(detailPane);
    const booking = selected();
    if (booking === null) {
      detailPane.append(el('p', {}, ['Choose a booking to see its detail.']));
      return;
    }
    if (narrow()) detailPane.append(backButton(booking.ref));
    detailPane.append(
      el('h2', { class: 'detail-heading', tabindex: '-1' }, [
        `${booking.ref} · ${booking.kit.name}`,
      ]),
      el('p', { class: 'detail-state' }, [`State: ${booking.state}`]),
      el('p', { class: `deposit-line${booking.paymentStatus === 'failed' ? ' is-failed' : ''}` }, [depositLabel(booking.paymentStatus)]),
      el('p', { class: 'rate-card-line' }, [`Rate card v${booking.rateCardVersion}`]),
      el('p', { class: 'detail-total' }, [
        `${formatMoney(booking.hirePriceCents)} hire · ${formatMoney(booking.depositCents)} deposit`,
      ]),
      serialTable(booking),
    );
    if (booking.state === 'confirmed') detailPane.append(prepButton(booking));

    detailPane.append(blockerList('Checkout blockers', booking.checkout.blockers));
    const startCheckout = el('button', { type: 'button', class: 'button button-primary' }, [
      'Start checkout',
    ]);
    startCheckout.disabled = !booking.checkout.allowed;
    startCheckout.addEventListener('click', () => {
      checkoutOpen = true;
      renderDetail();
    });
    detailPane.append(startCheckout);
    if (checkoutOpen && booking.state === 'prepped') {
      detailPane.append(checkoutPanel(panelContext(booking)));
    }

    if (booking.state === 'out') {
      const startCheckin = el('button', { type: 'button', class: 'button button-primary' }, [
        'Start check-in',
      ]);
      startCheckin.addEventListener('click', () => {
        checkinOpen = true;
        renderDetail();
      });
      detailPane.append(startCheckin);

    }

    if (checkinOpen && ['out', 'returned'].includes(booking.state)) {
      detailPane.append(checkinPanel(panelContext(booking)));
    }

    detailPane.append(blockerList('Close blockers', booking.close.blockers), closeButton(booking));
  };

  function renderPanes(): void {
    renderList();
    renderDetail();
    listHost.hidden = narrow() && selectedRef !== null;
    detailPane.hidden = narrow() && selectedRef === null;
  }

  page.append(
    el('header', { class: 'desk-header' }, [
      el('h1', { class: 'kit-name' }, ['Counter']),
      el('nav', { class: 'desk-links' }, [el('a', { href: '/desk/owner' }, ['Owner desk'])]),
      signOutButton(),
    ]),
    status,
    el('div', { class: 'counter-panes' }, [listHost, detailPane]),
  );

  await loadBookings();
  if (!narrow()) selectedRef = bookings[0]?.ref ?? null;
  renderPanes();
  window.addEventListener('resize', () => {
    renderPanes();
  });
}
