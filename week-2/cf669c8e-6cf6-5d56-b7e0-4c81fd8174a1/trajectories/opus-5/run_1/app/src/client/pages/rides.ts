/**
 * The rider's test rides and one ride.
 *
 * Confirming a live hold lands on the ride's own page. The countdown and every
 * cutoff come from the server, so a wrong device clock changes nothing.
 */

import { ApiCallError, NetworkError, api } from '../api.js';
import { el, setTextIfChanged } from '../dom.js';
import { store } from '../state.js';
import { NOT_FOUND_HEADING } from './notFound.js';
import type { Ride } from '../../shared/types.js';
import type { Page, PageContext, PageFactory } from '../main.js';

const POLL_MS = 3_000;

export const EMPTY_RIDES = 'No test rides booked.';
export const RIDE_CANCELLED = 'Test ride cancelled.';
export const CANCELLATION_CLOSED = 'Free cancellation has closed for this ride.';
export const HOLD_RAN_OUT = 'Your hold ran out. The slot is free again.';
export const CONFIRMED_HEADING = 'Test ride confirmed';

export const ridesPage: PageFactory = (context: PageContext): Page => ({
  async mount(container) {
    const section = el('section', { class: 'sheet' }, [el('h1', { class: 'heading-1' }, ['My rides'])]);
    container.append(section);

    try {
      const { rides } = await api.rides();
      if (rides.length === 0) {
        section.append(el('p', { class: 'empty' }, [EMPTY_RIDES]));
        return;
      }
      const list = el('ul', { class: 'ride-list', role: 'list' });
      for (const ride of rides) {
        const link = el('a', { href: `/rides/${ride.id}` }, [`${ride.localDate} ${ride.localTime}`]);
        link.addEventListener('click', (event) => {
          event.preventDefault();
          context.navigate(`/rides/${ride.id}`);
        });
        list.append(el('li', { class: 'ruled-row' }, [link, el('span', { class: 'state' }, [ride.state])]));
      }
      section.append(list);
    } catch (error) {
      if (error instanceof ApiCallError && error.status === 401) {
        context.navigate('/sign-in');
        return;
      }
      throw error;
    }
  },
});

export const ridePage: PageFactory = (context: PageContext): Page => {
  let timer: number | null = null;

  return {
    async mount(container) {
      const rideId = context.params.id ?? '';
      let ride: Ride;
      try {
        ride = await api.ride(rideId);
      } catch (error) {
        if (error instanceof ApiCallError && error.status === 401) {
          context.navigate('/sign-in');
          return;
        }
        container.append(
          el('section', { class: 'sheet' }, [el('h1', { class: 'heading-1' }, [NOT_FOUND_HEADING])]),
        );
        return;
      }

      const heading = el('h1', { class: 'heading-1', tabindex: -1 }, ['Your test ride']);
      const rideStatus = el('p', {
        class: 'status',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': 'Ride status',
        tabindex: -1,
      });
      const details = el('dl', { class: 'ride-details' });
      const actions = el('div', { class: 'order-actions' });

      container.append(
        el('section', { class: 'sheet' }, [heading, details, actions, rideStatus]),
      );

      let lastActionMessage: string | null = null;

      function render(next: Ride, options: { fromPoll: boolean }): void {
        ride = next;
        setTextIfChanged(heading, next.state === 'confirmed' ? CONFIRMED_HEADING : 'Your test ride');

        while (details.firstChild) details.firstChild.remove();
        details.append(
          el('dt', {}, ['Date']),
          el('dd', { class: 'mono' }, [next.localDate]),
          el('dt', {}, ['Time']),
          el('dd', { class: 'mono' }, [next.localTime]),
          el('dt', {}, ['State']),
          el('dd', {}, [next.state]),
        );

        if (next.state === 'expired' && (!options.fromPoll || lastActionMessage === null)) {
          setTextIfChanged(rideStatus, HOLD_RAN_OUT);
        }

        while (actions.firstChild) actions.firstChild.remove();

        if (next.state === 'held') {
          const confirm = el('button', { type: 'button', class: 'primary' }, ['Confirm ride']);
          confirm.addEventListener('click', () => {
            void api
              .confirmRide(next.id)
              .then((updated) => {
                store.hold = null;
                context.header.update();
                render(updated, { fromPoll: false });
                // Focus moves to the page's top heading.
                heading.focus();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiCallError && error.code === 'hold_expired') {
                  lastActionMessage = HOLD_RAN_OUT;
                  setTextIfChanged(rideStatus, HOLD_RAN_OUT);
                  void poll();
                }
              });
          });
          actions.append(confirm);
        }

        if (next.state === 'confirmed') {
          const cancel = el('button', { type: 'button' }, ['Cancel ride']);
          cancel.addEventListener('click', () => {
            void api
              .cancelRide(next.id)
              .then((updated) => {
                lastActionMessage = RIDE_CANCELLED;
                setTextIfChanged(rideStatus, RIDE_CANCELLED);
                render(updated, { fromPoll: false });
                rideStatus.focus();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiCallError && error.code === 'cancellation_closed') {
                  lastActionMessage = CANCELLATION_CLOSED;
                  setTextIfChanged(rideStatus, CANCELLATION_CLOSED);
                }
              });
          });
          actions.append(cancel);
        }
      }

      const poll = async (): Promise<void> => {
        try {
          render(await api.ride(rideId), { fromPoll: true });
        } catch (error) {
          if (error instanceof ApiCallError || error instanceof NetworkError) return;
          throw error;
        }
      };

      render(ride, { fromPoll: false });
      timer = window.setInterval(() => void poll(), POLL_MS);
    },

    unmount() {
      if (timer !== null) window.clearInterval(timer);
    },
  };
};
