/**
 * Bike comparison and one bike's page.
 *
 * The road-class filter is held in the address, and the table compares bikes by
 * range in place, longest first.
 */

import { ApiCallError, api } from '../api.js';
import { el, setTextIfChanged } from '../dom.js';
import { figure } from '../ui/money.js';
import { store } from '../state.js';
import { openCheckout } from './checkout.js';
import type { BikeView, Ride, Slot } from '../../shared/types.js';
import type { Page, PageContext, PageFactory } from '../main.js';

const HOLD_MESSAGES: Record<string, string> = {
  slot_gone: 'That slot has just gone. Pick another.',
  hold_exists: 'You already hold a slot. Confirm it or let it run out.',
  same_day_closed: 'Same-day booking closed at 12:00.',
};

export const bikesPage: PageFactory = (context: PageContext): Page => ({
  async mount(container) {
    const query = new URLSearchParams(window.location.search);
    const filter = query.get('class') === '25' ? '25' : query.get('class') === '45' ? '45' : null;

    const body = el('tbody');
    const table = el('table', { class: 'bike-table' }, [
      el('caption', {}, ['Bike comparison']),
      el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['Bike']),
          el('th', {}, ['Road class']),
          el('th', {}, ['Range']),
          el('th', {}, ['Price']),
        ]),
      ]),
      body,
    ]);

    const group = el('fieldset', { class: 'radio-group', role: 'radiogroup', 'aria-label': 'Road class filter' }, [
      el('legend', {}, ['Road class filter']),
    ]);
    for (const option of [
      { value: '', label: 'All' },
      { value: '25', label: '25 km/h' },
      { value: '45', label: '45 km/h' },
    ]) {
      const input = el('input', {
        type: 'radio',
        name: 'class-filter',
        id: `filter-${option.value || 'all'}`,
        checked: (filter ?? '') === option.value,
      });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        // The filter is held in the address and the table changes in place.
        context.navigate(option.value ? `/bikes?class=${option.value}` : '/bikes', { silent: true });
        void api
          .bikes(option.value === '25' ? '25' : option.value === '45' ? '45' : null)
          .then((result) => renderRows(body, result.bikes, context));
      });
      group.append(
        el('span', { class: `radio ${option.value === '25' ? 'class-25' : option.value === '45' ? 'class-45' : ''}`.trim() }, [
          input,
          el('label', { for: `filter-${option.value || 'all'}` }, [option.label]),
        ]),
      );
    }

    container.append(
      el('section', { class: 'sheet' }, [el('h1', { class: 'heading-1' }, ['Built e-mopeds']), group, table]),
    );

    const { bikes } = await api.bikes(filter);
    renderRows(body, bikes, context);
  },
});

function renderRows(body: HTMLElement, bikes: BikeView[], context: PageContext): void {
  while (body.firstChild) body.firstChild.remove();
  for (const bike of bikes) {
    const link = el('a', { href: `/bikes/${bike.id}` }, [bike.name]);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      context.navigate(`/bikes/${bike.id}`);
    });
    body.append(
      el('tr', {}, [
        el('th', { scope: 'row' }, [link]),
        el('td', { class: `class-mark class-${bike.roadClass}` }, [`${bike.roadClass} km/h`]),
        el('td', { class: 'mono' }, [`${bike.rangeKm} km`]),
        el('td', {}, [figure(bike.grossCents, 'quoted').element]),
      ]),
    );
  }
}

export const bikePage: PageFactory = (context: PageContext): Page => {
  let timer: number | null = null;

  return {
    async mount(container) {
      const bikeId = context.params.id ?? '';
      const catalogue = await store.loadCatalogue();
      const bike = catalogue.bikes.find((row) => row.id === bikeId);
      if (!bike) {
        container.append(
          el('section', { class: 'sheet' }, [
            el('h1', { class: 'heading-1' }, ["We couldn't find that page."]),
          ]),
        );
        return;
      }

      const slotList = el('ul', { class: 'slot-list', role: 'list', 'aria-label': 'Slots' });
      const rideStatus = el('p', { class: 'status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Ride status', tabindex: -1 });
      const paymentStatus = el('p', { class: 'status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Payment status', tabindex: -1 });
      const startCheckout = el('button', { type: 'button', class: 'primary' }, ['Start checkout']);

      startCheckout.addEventListener('click', () => {
        if (!store.user) {
          context.navigate('/sign-in');
          return;
        }
        // A bike is two lines: the bike and its handover, both catalogue data.
        const handover = catalogue.fixedLines.HANDOVER;
        openCheckout({
          opener: startCheckout,
          navigate: context.navigate,
          paymentStatus,
          summary: {
            totalCents: bike.grossCents + handover.grossCents,
            lines: [
              { name: bike.name, grossCents: bike.grossCents },
              { name: handover.name, grossCents: handover.grossCents },
            ],
            // The server sets the stages when the order is made.
            schedule: null,
          },
          fit: null,
          body: { kind: 'bike', bikeId: bike.id },
        });
      });

      container.append(
        el('section', { class: 'sheet' }, [
          el('h1', { class: 'heading-1' }, [bike.name]),
          el('p', { class: `class-mark class-${bike.roadClass}` }, [`${bike.roadClass} km/h`]),
          el('p', { class: 'mono' }, [`Range ${bike.rangeKm} km`]),
          el('p', {}, ['Price ', figure(bike.grossCents, 'quoted').element]),
          el('h2', { class: 'heading-3' }, ['Test-ride slots']),
          slotList,
          rideStatus,
          startCheckout,
          paymentStatus,
        ]),
      );

      const refresh = async (): Promise<void> => {
        try {
          const { slots } = await api.slots(bike.id);
          renderSlots(slots);
        } catch {
          // A failed poll leaves the page as it is.
        }
      };

      function renderSlots(slots: Slot[]): void {
        while (slotList.firstChild) slotList.firstChild.remove();
        for (const slot of slots) {
          const label = `Hold ${slot.localDate} ${slot.localTime}`;
          const button = el(
            'button',
            { type: 'button', class: 'slot', 'aria-label': label, disabled: slot.status !== 'free' },
            [`${slot.localDate} ${slot.localTime}`, el('span', { class: 'slot-state' }, [slot.status])],
          );
          button.addEventListener('click', () => void hold(slot.id));
          slotList.append(el('li', {}, [button]));
        }
      }

      async function hold(slotId: string): Promise<void> {
        try {
          const ride: Ride = await api.hold(slotId);
          store.hold = ride;
          context.header.update();
          context.header.announceHold(
            `Hold ends in ${Math.ceil((ride.remainingSeconds ?? 0) / 60)} min.`,
          );
          context.navigate(`/rides/${ride.id}`);
        } catch (error) {
          if (!(error instanceof ApiCallError)) throw error;
          if (error.status === 401) {
            context.navigate('/sign-in');
            return;
          }
          const message = error.code ? HOLD_MESSAGES[error.code] : null;
          if (message) setTextIfChanged(rideStatus, message);
          await refresh();
        }
      }

      await refresh();
      timer = window.setInterval(() => void refresh(), 3000);
    },

    unmount() {
      if (timer !== null) window.clearInterval(timer);
    },
  };
};

