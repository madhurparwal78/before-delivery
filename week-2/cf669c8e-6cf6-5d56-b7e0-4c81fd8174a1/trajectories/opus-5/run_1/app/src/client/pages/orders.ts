/**
 * The rider's orders and one order.
 *
 * Status polling updates only its own regions: it never closes the plan panel,
 * moves focus, or clears a typed value, and it never overwrites a message the
 * last action showed until that same action's next status arrives.
 */

import { ApiCallError, NetworkError, api } from '../api.js';
import { formatAmount } from '../../shared/format.js';
import { el, setMoneyDisabled, setTextIfChanged } from '../dom.js';
import { store } from '../state.js';
import { figure, stageStatusWord } from '../ui/money.js';
import { NOT_FOUND_HEADING } from './notFound.js';
import type { Order, Stage } from '../../shared/types.js';
import type { Page, PageContext, PageFactory } from '../main.js';

const POLL_MS = 3_000;

export const EMPTY_ORDERS = 'No orders yet. Prove a fit first.';
export const PLAN_SAVED = 'Plan saved.';
export const PLAN_STALE = 'This plan changed elsewhere. Your entries are kept; reload to see the latest.';
export const ARREARS_NOTICE = 'Order in arrears. The kit will not be dispatched until this clears.';
export const WITHDRAWN_NOTICE = 'Order withdrawn.';
export const WITHDRAWAL_CLOSED = 'The withdrawal period has ended.';

const PAY_REFUSALS: Record<string, string> = {
  fit_not_passed: 'Fit not proven. No deposit can be taken.',
  donor_unconfirmed: 'Donor unconfirmed. No deposit can be taken.',
  donor_changed: "This scooter's registration changed. Prove the fit again.",
  quote_changed: 'The inspection fee changed. Check the new total before paying.',
  refund_in_flight: 'A refund is still pending. Try again once it settles.',
  withdrawal_closed: WITHDRAWAL_CLOSED,
  payments_paused: 'Payments are paused. Nothing has been charged.',
};

export const ordersPage: PageFactory = (context: PageContext): Page => ({
  async mount(container) {
    const section = el('section', { class: 'sheet' }, [el('h1', { class: 'heading-1' }, ['My orders'])]);
    container.append(section);

    if (store.resumeConfiguration) {
      const resume = el('a', { href: store.resumeConfiguration }, ['Resume your configuration']);
      resume.addEventListener('click', (event) => {
        event.preventDefault();
        context.navigate(store.resumeConfiguration as string);
      });
      section.append(resume);
    }

    try {
      const { orders } = await api.orders();
      if (orders.length === 0) {
        section.append(el('p', { class: 'empty' }, [EMPTY_ORDERS]));
        return;
      }
      const list = el('ul', { class: 'order-list', role: 'list' });
      for (const order of orders) {
        const link = el('a', { href: `/orders/${order.id}`, 'aria-label': `Open order ${order.number}` }, [
          `Open order ${order.number}`,
        ]);
        link.addEventListener('click', (event) => {
          event.preventDefault();
          context.navigate(`/orders/${order.id}`);
        });
        list.append(
          el('li', { class: 'ruled-row' }, [
            link,
            el('span', { class: 'state' }, [order.state]),
            figure(order.totalCents, 'quoted').element,
          ]),
        );
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

export const orderPage: PageFactory = (context: PageContext): Page => {
  let timer: number | null = null;

  return {
    async mount(container) {
      const orderId = context.params.id ?? '';
      let order: Order;
      try {
        order = await api.order(orderId);
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

      // ---- live regions --------------------------------------------------
      const orderState = el('p', {
        class: 'status',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': 'Order state',
        tabindex: -1,
      });
      const paymentStatus = el('p', {
        class: 'status',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': 'Payment status',
        tabindex: -1,
      });
      const planStatus = el('p', { class: 'status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Plan status' });

      // ---- tables ---------------------------------------------------------
      const linesBody = el('tbody');
      const scheduleBody = el('tbody');
      const allocationBody = el('tbody');
      const noticesList = el('ul', { class: 'notices' });
      const refundsList = el('ul', { class: 'refund-list' });
      const actions = el('div', { class: 'order-actions' });

      // ---- plan panel ------------------------------------------------------
      const planButton = el('button', { type: 'button', 'aria-expanded': 'false' }, ['Payment plan']);
      const planName = el('input', { type: 'text', id: 'plan-name', 'aria-label': 'Name' });
      const planStreet = el('input', { type: 'text', id: 'plan-street', 'aria-label': 'Street' });
      const planPostcode = el('input', { type: 'text', id: 'plan-postcode', 'aria-label': 'Postcode' });
      const planCity = el('input', { type: 'text', id: 'plan-city', 'aria-label': 'City' });
      const planNote = el('textarea', { id: 'plan-note', 'aria-label': 'Note to workshop' });
      const savePlan = el('button', { type: 'button', class: 'primary' }, ['Save plan']);
      const planRegion = el(
        'section',
        { class: 'plan-panel', role: 'region', 'aria-label': 'Payment plan', hidden: true },
        [
          el('div', { class: 'grid-fields' }, [
            el('label', { for: 'plan-name' }, ['Name']),
            planName,
            el('label', { for: 'plan-street' }, ['Street']),
            planStreet,
            el('label', { for: 'plan-postcode' }, ['Postcode']),
            planPostcode,
            el('label', { for: 'plan-city' }, ['City']),
            planCity,
            el('label', { for: 'plan-note' }, ['Note to workshop']),
            planNote,
          ]),
          savePlan,
          planStatus,
        ],
      );

      // The open panel keeps its open state, focus and typed entries.
      planButton.addEventListener('click', () => {
        const open = planRegion.hidden;
        planRegion.hidden = !open;
        planButton.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) planName.focus();
      });

      let planVersion = order.planVersion;
      let planTouched = false;
      for (const input of [planName, planStreet, planPostcode, planCity, planNote]) {
        input.addEventListener('input', () => {
          planTouched = true;
        });
      }

      const doSave = (automatic: boolean): void => {
        void api
          .patchOrder(orderId, {
            planVersion,
            plan: {
              name: planName.value,
              street: planStreet.value,
              postcode: planPostcode.value,
              city: planCity.value,
              note: planNote.value,
            },
          })
          .then((next) => {
            planVersion = next.planVersion;
            planTouched = false;
            setTextIfChanged(planStatus, PLAN_SAVED);
          })
          .catch((error: unknown) => {
            if (error instanceof ApiCallError && error.status === 412) {
              // A stale save is refused and the entries are kept.
              setTextIfChanged(planStatus, PLAN_STALE);
              return;
            }
            if (error instanceof ApiCallError && error.status === 401) {
              store.sessionEnded({
                opener: savePlan,
                // A plan save is retried once automatically.
                retry: automatic ? null : () => doSave(true),
                retryAutomatically: !automatic,
              });
              return;
            }
            if (error instanceof ApiCallError && error.errors?.note) {
              setTextIfChanged(planStatus, error.errors.note);
            }
          });
      };
      savePlan.addEventListener('click', () => doSave(false));

      container.append(
        el('div', { class: 'order-layout' }, [
          el('section', { class: 'sheet' }, [
            el('h1', { class: 'heading-1', 'data-order-number': '' }, [`Order ${order.number}`]),
            el('table', { class: 'lines-table' }, [
              el('caption', {}, ['Kit lines']),
              el('thead', {}, [
                el('tr', {}, [
                  el('th', {}, ['Line']),
                  el('th', {}, ['Gross']),
                  el('th', {}, ['VAT']),
                  el('th', {}, ['Collected']),
                  el('th', {}, ['Refunded']),
                ]),
              ]),
              linesBody,
            ]),
            el('table', { class: 'schedule-table' }, [
              el('caption', {}, ['Payment schedule']),
              el('thead', {}, [
                el('tr', {}, [
                  el('th', {}, ['Stage']),
                  el('th', {}, ['Due']),
                  el('th', {}, ['Amount']),
                  el('th', {}, ['VAT']),
                ]),
              ]),
              scheduleBody,
            ]),
            el('table', { class: 'allocation-table' }, [
              el('caption', {}, ['Allocation']),
              el('thead', {}, [
                el('tr', {}, [el('th', {}, ['Stage']), el('th', {}, ['Line']), el('th', {}, ['Gross']), el('th', {}, ['VAT'])]),
              ]),
              allocationBody,
            ]),
            noticesList,
          ]),
          el('aside', { class: 'side-column sheet' }, [
            orderState,
            paymentStatus,
            actions,
            planButton,
            planRegion,
            el('h2', { class: 'heading-3' }, ['Refunds']),
            refundsList,
          ]),
        ]),
      );

      // ---- render ----------------------------------------------------------
      let lastActionMessage: string | null = null;

      function render(next: Order, options: { fromPoll: boolean }): void {
        order = next;

        setTextIfChanged(
          orderState,
          next.partlyRefunded ? `${next.state}, partly refunded` : next.state,
        );

        while (linesBody.firstChild) linesBody.firstChild.remove();
        for (const line of next.lines) {
          linesBody.append(
            el('tr', {}, [
              el('th', { scope: 'row' }, [line.name]),
              el('td', {}, [figure(line.grossCents, 'quoted').element]),
              el('td', {}, [figure(line.vatCents, 'quoted').element]),
              el('td', {}, [figure(line.collectedCents, 'paid').element]),
              el('td', {}, [figure(line.refundedCents, 'returned').element]),
            ]),
          );
        }

        while (scheduleBody.firstChild) scheduleBody.firstChild.remove();
        while (allocationBody.firstChild) allocationBody.firstChild.remove();
        const byLine = new Map(next.lines.map((line) => [line.id, line.name]));
        for (const stage of next.schedule) {
          scheduleBody.append(
            el('tr', {}, [
              el('th', { scope: 'row' }, [stage.label]),
              el('td', { class: 'mono' }, [stage.dueDate ?? '—']),
              el('td', {}, [figure(stage.amountCents, stageStatusWord(stage.status)).element]),
              el('td', {}, [
                figure(stage.vatCents, stageStatusWord(stage.status)).element,
                stage.vatCorrectedCents !== 0
                  ? el('span', { class: 'correction' }, [
                      ` ${formatAmount(stage.vatCorrectedCents)} corrected`,
                    ])
                  : null,
              ]),
            ]),
          );
          for (const allocation of stage.allocations) {
            allocationBody.append(
              el('tr', {}, [
                el('td', {}, [stage.label]),
                el('td', {}, [byLine.get(allocation.lineId) ?? 'Line']),
                el('td', {}, [figure(allocation.grossCents, stageStatusWord(stage.status)).element]),
                el('td', {}, [figure(allocation.vatCents, stageStatusWord(stage.status)).element]),
              ]),
            );
          }
        }

        while (noticesList.firstChild) noticesList.firstChild.remove();
        for (const notice of next.notices) noticesList.append(el('li', {}, [notice]));

        while (refundsList.firstChild) refundsList.firstChild.remove();
        for (const refund of next.refunds) {
          refundsList.append(
            el('li', { class: 'ruled-row' }, [
              figure(refund.amountCents, refund.status === 'pending' ? 'pending' : 'returned').element,
              el('span', { class: 'state' }, [refund.status]),
            ]),
          );
        }

        // Only this page's own action messages survive a repaint.
        if (!options.fromPoll || lastActionMessage === null) {
          if (next.state === 'in arrears') setTextIfChanged(paymentStatus, ARREARS_NOTICE);
          else if (next.state === 'withdrawn') setTextIfChanged(paymentStatus, WITHDRAWN_NOTICE);
        }

        renderActions(next);
        if (!planTouched) fillPlan(next);
        planVersion = next.planVersion;
      }

      function fillPlan(next: Order): void {
        planName.value = next.plan.name;
        planStreet.value = next.plan.street;
        planPostcode.value = next.plan.postcode;
        planCity.value = next.plan.city;
        planNote.value = next.plan.note ?? '';
      }

      /** Pay exists only for the next payable stage. */
      function nextPayable(next: Order): Stage | null {
        for (const stage of next.schedule) {
          if (stage.status === 'paid') continue;
          return stage;
        }
        return null;
      }

      function renderActions(next: Order): void {
        while (actions.firstChild) actions.firstChild.remove();

        const payable = nextPayable(next);
        const closed = ['withdrawn', 'paid in full', 'kit dispatched', 'fitted', 'inspection passed'];
        if (payable && !closed.includes(next.state)) {
          const pay = el('button', { type: 'button', class: 'primary' }, [`Pay ${payable.label}`]);
          let key = crypto.randomUUID();
          const paused = store.status.killbill === 'down';
          setMoneyDisabled(pay, paused || payable.status === 'pending');
          pay.addEventListener('click', () => {
            if (pay.getAttribute('aria-disabled') === 'true') return;
            lastActionMessage = 'Payment sent. Waiting for confirmation.';
            setTextIfChanged(paymentStatus, lastActionMessage);
            void api
              .pay(next.id, payable.stage, key)
              .then((updated) => render(updated, { fromPoll: false }))
              .catch((error: unknown) => {
                if (error instanceof ApiCallError && error.status === 401) {
                  store.sessionEnded({ opener: pay, retry: null, retryAutomatically: false });
                  return;
                }
                if (error instanceof ApiCallError && error.code === 'payment_refused') {
                  key = crypto.randomUUID();
                  lastActionMessage = `${payable.label} failed. Nothing was taken.`;
                  setTextIfChanged(paymentStatus, lastActionMessage);
                  return;
                }
                if (error instanceof ApiCallError && error.code) {
                  const message = PAY_REFUSALS[error.code];
                  if (message) {
                    lastActionMessage = message;
                    setTextIfChanged(paymentStatus, message);
                  }
                }
              });
          });
          actions.append(pay);
        }

        // Withdraw exists only while `withdrawalOpen` is true.
        if (next.withdrawalOpen) {
          const withdraw = el('button', { type: 'button' }, ['Withdraw']);
          const key = crypto.randomUUID();
          setMoneyDisabled(withdraw, store.status.killbill === 'down' && hasCollected(next));
          withdraw.addEventListener('click', () => {
            if (withdraw.getAttribute('aria-disabled') === 'true') return;
            void api
              .withdraw(next.id, key)
              .then((updated) => {
                lastActionMessage = WITHDRAWN_NOTICE;
                setTextIfChanged(paymentStatus, WITHDRAWN_NOTICE);
                render(updated, { fromPoll: false });
                paymentStatus.focus();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiCallError && error.code) {
                  const message = PAY_REFUSALS[error.code];
                  if (message) {
                    lastActionMessage = message;
                    setTextIfChanged(paymentStatus, message);
                  }
                }
              });
          });
          actions.append(withdraw);
        }

        // Switch exists only for a posted kit in these two states.
        const switchable =
          next.kind === 'kit' &&
          next.config?.fulfilment === 'posted' &&
          (next.state === 'deposit confirmed' || next.state === 'instalments running');
        if (switchable) {
          const button = el('button', { type: 'button' }, ['Switch to workshop fitting']);
          const key = crypto.randomUUID();
          button.addEventListener('click', () => {
            if (button.getAttribute('aria-disabled') === 'true') return;
            void api
              .switchToWorkshop(next.id, key)
              .then((updated) => {
                const correction = updated.schedule.reduce(
                  (sum, stage) => sum + stage.vatCorrectedCents,
                  0,
                );
                lastActionMessage = `Fulfilment changed to workshop fitting. VAT on paid stages corrected by ${formatAmount(correction)}.`;
                setTextIfChanged(paymentStatus, lastActionMessage);
                render(updated, { fromPoll: false });
                paymentStatus.focus();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiCallError && error.code === 'payment_in_flight') {
                  lastActionMessage = PAY_REFUSALS.refund_in_flight as string;
                  setTextIfChanged(paymentStatus, lastActionMessage);
                }
              });
          });
          actions.append(button);
        }
      }

      render(order, { fromPoll: false });

      // Order pages refresh their payment statuses at least every 3 seconds.
      const poll = async (): Promise<void> => {
        try {
          const next = await api.order(orderId);
          render(next, { fromPoll: true });
        } catch (error) {
          // A poll answering 401 never navigates or clears input.
          if (error instanceof ApiCallError || error instanceof NetworkError) return;
          throw error;
        }
      };
      timer = window.setInterval(() => void poll(), POLL_MS);
    },

    unmount() {
      if (timer !== null) window.clearInterval(timer);
    },
  };
};

function hasCollected(order: Order): boolean {
  return order.lines.some((line) => line.collectedCents > 0);
}
