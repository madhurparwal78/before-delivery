/**
 * The fitter's desk: the ride day, the payments-waiting list, and one order's
 * payments, refunds, transitions and inspection.
 *
 * Polling keeps typed entries, the chosen refund line, focus and the last
 * message, so a repaint never undoes what the fitter is in the middle of.
 */

import { ApiCallError, NetworkError, api } from '../api.js';
import { el, setMoneyDisabled, setTextIfChanged } from '../dom.js';
import { store } from '../state.js';
import { figure, stageStatusWord } from '../ui/money.js';
import { NOT_FOUND_HEADING } from './notFound.js';
import type { DeskPayment, DeskRide, Order } from '../../shared/types.js';
import type { Page, PageContext, PageFactory } from '../main.js';

const POLL_MS = 3_000;

export const EMPTY_RIDE_DAY = 'No test rides on this day.';
export const EMPTY_PAYMENTS_WAITING = 'No payments waiting on the provider.';
export const BAD_AMOUNT = 'Enter an amount like 12.50.';
export const INSPECTION_RECORDED = 'Inspection recorded. Fit the new plate before riding.';
export const INSPECTION_REGISTRY_DOWN = 'Plate registry unreachable. Inspection not recorded.';

const REFUND_REFUSALS: Record<string, string> = {
  payment_in_flight: 'A payment is still pending. Try again once it settles.',
  fee_already_spent: 'The inspection fee has been passed on and cannot be refunded.',
  payments_paused: 'Payments are paused. Nothing has been charged.',
};

export const deskPage: PageFactory = (context: PageContext): Page => {
  let timer: number | null = null;

  return {
    async mount(container) {
      if (store.user && store.user.role !== 'fitter') {
        container.append(
          el('section', { class: 'sheet' }, [el('h1', { class: 'heading-1' }, [NOT_FOUND_HEADING])]),
        );
        return;
      }

      const catalogue = await store.loadCatalogue();
      const today = store.status.serverNow.slice(0, 10);

      const deskStatus = el('p', {
        class: 'status',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': 'Desk status',
        tabindex: -1,
      });

      const rideDate = el('input', { type: 'text', id: 'ride-date', 'aria-label': 'Ride date', value: today });
      const bikeSelect = el('select', { id: 'desk-bike', 'aria-label': 'Bike' });
      for (const bike of catalogue.bikes) {
        bikeSelect.append(el('option', { value: bike.id }, [bike.name]));
      }
      const slotTimes = el('input', { type: 'text', id: 'slot-times', 'aria-label': 'Slot times', value: '' });
      const openSlots = el('button', { type: 'button', class: 'primary' }, ['Open slots']);

      const rideBody = el('tbody');
      const rideTable = el('table', { class: 'ride-day-table' }, [
        el('caption', {}, ['Ride day']),
        el('thead', {}, [
          el('tr', {}, [
            el('th', {}, ['Time']),
            el('th', {}, ['Rider']),
            el('th', {}, ['Bike']),
            el('th', {}, ['State']),
            el('th', {}, ['Outcome']),
          ]),
        ]),
        rideBody,
      ]);
      const rideEmpty = el('p', { class: 'empty', hidden: true }, [EMPTY_RIDE_DAY]);

      const waitingBody = el('tbody');
      const waitingTable = el('table', { class: 'waiting-table' }, [
        el('caption', {}, ['Payments waiting']),
        el('thead', {}, [el('tr', {}, [el('th', {}, ['Order']), el('th', {}, ['State'])])]),
        waitingBody,
      ]);
      const waitingEmpty = el('p', { class: 'empty', hidden: true }, [EMPTY_PAYMENTS_WAITING]);

      container.append(
        el('section', { class: 'sheet' }, [
          el('h1', { class: 'heading-1' }, ['Desk']),
          el('div', { class: 'grid-fields' }, [
            el('label', { for: 'ride-date' }, ['Ride date']),
            rideDate,
            el('label', { for: 'desk-bike' }, ['Bike']),
            bikeSelect,
            el('label', { for: 'slot-times' }, ['Slot times']),
            slotTimes,
            openSlots,
          ]),
          deskStatus,
          rideTable,
          rideEmpty,
          waitingTable,
          waitingEmpty,
        ]),
      );

      let lastActionMessage: string | null = null;

      openSlots.addEventListener('click', () => {
        const times = slotTimes.value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
        void api
          .openRideDay(bikeSelect.value, rideDate.value, times)
          .then((result) => {
            lastActionMessage = `Opened ${result.slots.length} slots.`;
            setTextIfChanged(deskStatus, lastActionMessage);
          })
          .catch((error: unknown) => {
            if (!(error instanceof ApiCallError)) throw error;
            if (error.code === 'slot_exists') {
              lastActionMessage = 'Those slots already exist.';
              setTextIfChanged(deskStatus, lastActionMessage);
              return;
            }
            const message = error.errors ? Object.values(error.errors)[0] : null;
            if (message) {
              lastActionMessage = message;
              setTextIfChanged(deskStatus, message);
            }
          });
      });

      rideDate.addEventListener('change', () => void refresh());

      function renderRides(rides: DeskRide[]): void {
        rideEmpty.hidden = rides.length > 0;
        while (rideBody.firstChild) rideBody.firstChild.remove();
        for (const ride of rides) {
          const outcome = el('div', { class: 'row-actions' });
          if (ride.state === 'confirmed') {
            for (const choice of ['ridden', 'no-show'] as const) {
              const label = choice === 'ridden' ? 'Mark ridden' : 'Mark no-show';
              const button = el('button', { type: 'button' }, [label]);
              button.addEventListener('click', () => {
                void api
                  .rideOutcome(ride.id, choice)
                  .then(() => {
                    lastActionMessage = choice === 'ridden' ? 'Marked ridden.' : 'Marked no-show.';
                    setTextIfChanged(deskStatus, lastActionMessage);
                    deskStatus.focus();
                    void refresh();
                  })
                  .catch(() => undefined);
              });
              outcome.append(button);
            }
          }
          rideBody.append(
            el('tr', {}, [
              el('td', { class: 'mono' }, [ride.localTime]),
              el('td', {}, [ride.riderName]),
              el('td', {}, [ride.bikeName]),
              el('td', {}, [ride.state]),
              el('td', {}, [outcome]),
            ]),
          );
        }
      }

      function renderWaiting(orders: Order[]): void {
        const waiting = orders.filter(
          (order) =>
            order.schedule.some((stage) => stage.status === 'pending') ||
            order.refunds.some((refund) => refund.status === 'pending'),
        );
        waitingEmpty.hidden = waiting.length > 0;
        while (waitingBody.firstChild) waitingBody.firstChild.remove();
        for (const order of waiting) {
          const link = el('a', { href: `/desk/orders/${order.id}`, 'aria-label': `Open order ${order.number}` }, [
            `Open order ${order.number}`,
          ]);
          link.addEventListener('click', (event) => {
            event.preventDefault();
            context.navigate(`/desk/orders/${order.id}`);
          });
          waitingBody.append(el('tr', {}, [el('th', { scope: 'row' }, [link]), el('td', {}, [order.state])]));
        }
      }

      const refresh = async (): Promise<void> => {
        try {
          const [rides, orders] = await Promise.all([
            api.deskRides(rideDate.value),
            api.deskOrders(),
          ]);
          renderRides(rides.rides);
          renderWaiting(orders.orders);
          // A repaint never overwrites the last action's message.
          if (lastActionMessage !== null) setTextIfChanged(deskStatus, lastActionMessage);
        } catch (error) {
          if (error instanceof ApiCallError && error.status === 401) return;
          if (error instanceof ApiCallError && error.status === 403) {
            context.navigate('/');
            return;
          }
          if (error instanceof NetworkError) return;
          throw error;
        }
      };

      await refresh();
      timer = window.setInterval(() => void refresh(), POLL_MS);
    },

    unmount() {
      if (timer !== null) window.clearInterval(timer);
    },
  };
};

export const deskOrderPage: PageFactory = (context: PageContext): Page => {
  let timer: number | null = null;

  return {
    async mount(container) {
      const orderId = context.params.id ?? '';
      let order: Order & { payments: DeskPayment[] };
      try {
        order = await api.deskOrder(orderId);
      } catch {
        container.append(
          el('section', { class: 'sheet' }, [el('h1', { class: 'heading-1' }, [NOT_FOUND_HEADING])]),
        );
        return;
      }

      const orderState = el('p', {
        class: 'status',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': 'Order state',
        tabindex: -1,
      });
      const refundStatus = el('p', {
        class: 'status',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': 'Refund status',
      });
      const inspectionStatus = el('p', {
        class: 'status',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': 'Inspection status',
        tabindex: -1,
      });

      const paymentsBody = el('tbody');
      const paymentsTable = el('table', { class: 'payments-table' }, [
        el('caption', {}, ['Payments']),
        el('thead', {}, [
          el('tr', {}, [
            el('th', {}, ['Stage']),
            el('th', {}, ['Kind']),
            el('th', {}, ['Amount']),
            el('th', {}, ['Status']),
          ]),
        ]),
        paymentsBody,
      ]);

      const refundLine = el('select', { id: 'refund-line', 'aria-label': 'Refund line' });
      const refundAmount = el('input', {
        type: 'text',
        id: 'refund-amount',
        'aria-label': 'Refund amount in euros',
      });
      const amountError = el('p', { class: 'field-error', hidden: true });
      const refundButton = el('button', { type: 'button', class: 'primary' }, ['Refund line']);

      const transitions = el('div', { class: 'order-actions' });
      const deliveredOn = el('input', {
        type: 'text',
        id: 'delivered-on',
        'aria-label': 'Delivered on',
        value: store.status.serverNow.slice(0, 10),
      });

      container.append(
        el('div', { class: 'order-layout' }, [
          el('section', { class: 'sheet' }, [
            el('h1', { class: 'heading-1' }, [`Order ${order.number}`]),
            paymentsTable,
          ]),
          el('aside', { class: 'side-column sheet' }, [
            orderState,
            transitions,
            el('h2', { class: 'heading-3' }, ['Refund a line']),
            el('div', { class: 'grid-fields' }, [
              el('label', { for: 'refund-line' }, ['Refund line']),
              refundLine,
              el('label', { for: 'refund-amount' }, ['Refund amount in euros']),
              refundAmount,
            ]),
            amountError,
            refundButton,
            refundStatus,
            el('h2', { class: 'heading-3' }, ['Delivery and inspection']),
            el('div', { class: 'grid-fields' }, [
              el('label', { for: 'delivered-on' }, ['Delivered on']),
              deliveredOn,
            ]),
            inspectionStatus,
          ]),
        ]),
      );

      let lastRefundMessage: string | null = null;
      let lastInspectionMessage: string | null = null;

      function render(next: Order & { payments: DeskPayment[] }): void {
        order = next;
        setTextIfChanged(
          orderState,
          next.partlyRefunded ? `${next.state}, partly refunded` : next.state,
        );

        while (paymentsBody.firstChild) paymentsBody.firstChild.remove();
        for (const payment of next.payments) {
          const stage = next.schedule.find((row) => row.stage === payment.stage);
          paymentsBody.append(
            el('tr', {}, [
              el('td', {}, [stage?.label ?? payment.stage]),
              el('td', {}, ['Payment']),
              el('td', {}, [figure(payment.amountCents, stageStatusWord(payment.status)).element]),
              el('td', {}, [payment.status]),
            ]),
          );
        }
        // A row for each refund draw, with its provider-confirmed status.
        for (const refund of next.refunds) {
          for (const draw of refund.draws) {
            const stage = next.schedule.find((row) => row.stage === draw.stage);
            paymentsBody.append(
              el('tr', {}, [
                el('td', {}, [stage?.label ?? draw.stage]),
                el('td', {}, ['Refund draw']),
                el('td', {}, [
                  figure(draw.amountCents, draw.status === 'returned' ? 'returned' : draw.status === 'failed' ? 'failed' : 'pending').element,
                ]),
                el('td', {}, [draw.status]),
              ]),
            );
          }
        }

        // Polling keeps the chosen refund line.
        const chosen = refundLine.value;
        while (refundLine.firstChild) refundLine.firstChild.remove();
        for (const line of next.lines) {
          refundLine.append(el('option', { value: line.id, selected: line.id === chosen }, [line.name]));
        }

        while (transitions.firstChild) transitions.firstChild.remove();
        if (next.state === 'paid in full') {
          const posted = next.kind === 'kit' && next.config?.fulfilment === 'posted';
          const label = posted ? 'Mark dispatched' : 'Mark fitted';
          const to = posted ? 'kit dispatched' : 'fitted';
          const button = el('button', { type: 'button' }, [label]);
          button.addEventListener('click', () => {
            void api
              .deskTransition(next.id, to)
              .then((updated) => {
                render({ ...updated, payments: next.payments });
                orderState.focus();
              })
              .catch(() => undefined);
          });
          transitions.append(button);
        }
        if (next.state === 'kit dispatched' && next.deliveredOn === null) {
          const button = el('button', { type: 'button' }, ['Mark delivered']);
          button.addEventListener('click', () => {
            void api
              .deskDelivered(next.id, deliveredOn.value)
              .then((updated) => {
                render({ ...updated, payments: next.payments });
                orderState.focus();
              })
              .catch(() => undefined);
          });
          transitions.append(button);
        }
        // Record inspection shows on class-move orders in these two states.
        const classMove = next.lines.some((line) => line.code.startsWith('INSPECT-'));
        if (classMove && (next.state === 'kit dispatched' || next.state === 'fitted')) {
          const button = el('button', { type: 'button' }, ['Record inspection']);
          button.addEventListener('click', () => {
            void api
              .deskInspection(next.id)
              .then((updated) => {
                lastInspectionMessage = INSPECTION_RECORDED;
                setTextIfChanged(inspectionStatus, INSPECTION_RECORDED);
                render({ ...updated, payments: next.payments });
                inspectionStatus.focus();
              })
              .catch((error: unknown) => {
                if (!(error instanceof ApiCallError)) return;
                if (error.code === 'registry_unreachable') {
                  lastInspectionMessage = INSPECTION_REGISTRY_DOWN;
                } else if (error.code === 'registry_not_updated') {
                  const className = next.donor?.country === 'NL' ? 'snorfiets' : 'class A';
                  lastInspectionMessage = `The registry still shows ${className}. Inspection not recorded.`;
                }
                if (lastInspectionMessage) setTextIfChanged(inspectionStatus, lastInspectionMessage);
              });
          });
          transitions.append(button);
        }

        setMoneyDisabled(refundButton, store.status.killbill === 'down');
      }

      refundButton.addEventListener('click', () => {
        if (refundButton.getAttribute('aria-disabled') === 'true') return;
        amountError.hidden = true;

        const raw = refundAmount.value.trim();
        if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
          amountError.hidden = false;
          amountError.textContent = BAD_AMOUNT;
          return;
        }
        const amountCents = Math.round(Number(raw) * 100);
        const key = crypto.randomUUID();

        lastRefundMessage = `Refund of €${raw} sent. Pending until the provider confirms.`;
        setTextIfChanged(refundStatus, lastRefundMessage);

        void api
          .refundLine(orderId, refundLine.value, amountCents, key)
          .then(() => {
            context.navigate(`/desk/orders/${orderId}`);
            void poll();
          })
          .catch((error: unknown) => {
            if (!(error instanceof ApiCallError)) throw error;
            if (error.errors?.amountCents) {
              amountError.hidden = false;
              amountError.textContent = error.errors.amountCents;
              lastRefundMessage = error.errors.amountCents;
              setTextIfChanged(refundStatus, lastRefundMessage);
              return;
            }
            const message = error.code ? REFUND_REFUSALS[error.code] : null;
            if (message) {
              lastRefundMessage = message;
              setTextIfChanged(refundStatus, message);
            }
          });
      });

      const poll = async (): Promise<void> => {
        try {
          const next = await api.deskOrder(orderId);
          render(next);
          // Polling keeps the last message, typed entries and selection.
          if (lastRefundMessage !== null) setTextIfChanged(refundStatus, lastRefundMessage);
          if (lastInspectionMessage !== null) setTextIfChanged(inspectionStatus, lastInspectionMessage);
        } catch (error) {
          if (error instanceof ApiCallError || error instanceof NetworkError) return;
          throw error;
        }
      };

      render(order);
      timer = window.setInterval(() => void poll(), POLL_MS);
    },

    unmount() {
      if (timer !== null) window.clearInterval(timer);
    },
  };
};
