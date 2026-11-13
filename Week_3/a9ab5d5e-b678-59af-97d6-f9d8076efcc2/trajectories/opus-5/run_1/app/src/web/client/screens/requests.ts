import { ApiFailure, Me, api, cachedIdentity, householdPath, loadIdentity, newIdempotencyKey } from '../api';
import { Screen, onLiveEntry, say, setWaitingCount } from '../app';
import { openModal } from '../dialogs';
import { el, isPending, labelled, pendingButton, textbox } from '../dom';
import { formatDisplayDate, formatInstantDisplay, formatMoney, lastNightOf } from '../../../lib/format';

export const stateWords: Record<string, string> = {
  draft: 'Draft',
  sent: 'Waiting for an answer',
  accepted: 'Accepted',
  declined: 'Declined',
  lapsed: 'Lapsed',
  withdrawn: 'Withdrawn',
  settled: 'Settled',
};

export interface SwapJson {
  id: string;
  nights: string;
  makeupNights: string | null;
  toParent: 'planning' | 'other';
  createdBy: 'planning' | 'other';
  note: string | null;
  state: string;
  answerBy: string | null;
  answerZone: string | null;
  declineReason: string | null;
}

export interface CostJson {
  id: string;
  description: string;
  category: string;
  note: string | null;
  amountMinor: number;
  incurredAt: string;
  custodyDay: string;
  paidBy: 'planning' | 'other';
  agreedSplitBp: { planning: number; other: number } | null;
  splitBp: { planning: number; other: number };
  shares: { planning: number; other: number };
  owedMinor: number;
  state: string;
  answerBy: string | null;
  answerZone: string | null;
  receipts: { id: string; contentType: string; bytes: number; sha256: string; filename: string }[];
}

export function nightRangeText(nights: string): string {
  const [start, end] = nights.split('/') as [string, string];
  return `${formatDisplayDate(start)} until ${formatDisplayDate(lastNightOf(end))}`;
}

export function makeupRangeText(nights: string): string {
  const [start, end] = nights.split('/') as [string, string];
  return `Make-up ${formatDisplayDate(start)} until ${formatDisplayDate(lastNightOf(end))}`;
}

export function openDeclineDialog(options: {
  opener: HTMLElement;
  onDecline: (reason: string) => Promise<void>;
}): void {
  const reason = textbox('Reason');
  const decline = el('button', { type: 'button', class: 'pill', text: 'Decline' });
  const cancel = el('button', { type: 'button', class: 'plain-button', text: 'Cancel' });
  const modal = openModal({
    title: 'Decline request',
    content: [labelled('Reason', reason)],
    actions: [decline, cancel],
    opener: options.opener,
  });
  cancel.addEventListener('click', () => modal.close());
  decline.addEventListener('click', () => {
    if (isPending(decline)) return;
    pendingButton(decline, true, 'Declining...');
    void options
      .onDecline(reason.value)
      .then(() => modal.close())
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) {
          const field = error.firstFieldError;
          modal.alert(field ? field.message : error.problem.title);
          if (field) reason.focus();
        }
      })
      .finally(() => pendingButton(decline, false, ''));
  });
}

export function lapsedCopy(answerBy: string | null, zone: string): string {
  return answerBy ? `This request lapsed at ${formatInstantDisplay(answerBy, zone)}.` : 'This request lapsed.';
}

export function requestsScreen(): Screen {
  let stopLive: (() => void) | null = null;

  return {
    async mount(main: HTMLElement): Promise<void> {
      const me = (cachedIdentity() ?? (await loadIdentity())) as Me;
      const waitingList = el('ul', { role: 'list', 'aria-label': 'Waiting for you', class: 'request-list', tabindex: '-1' });
      const sentList = el('ul', { role: 'list', 'aria-label': 'Sent by you', class: 'request-list', tabindex: '-1' });
      main.append(
        el('div', { class: 'requests-body' }, [
          el('section', { class: 'card' }, [el('h2', { class: 'card-title', text: 'Waiting for you' }), waitingList]),
          el('section', { class: 'card' }, [el('h2', { class: 'card-title', text: 'Sent by you' }), sentList]),
        ]),
      );

      function nameOf(role: 'planning' | 'other'): string {
        return role === 'planning' ? me.household.planningName : me.household.otherName;
      }

      function reportFailure(error: ApiFailure): void {
        if (error.code === 'request_lapsed') {
          say(lapsedCopy(null, me.household.zone));
          return;
        }
        if (error.code === 'swap_nights_changed') {
          say("Those nights changed when the plan was amended. This request can't be accepted.");
          return;
        }
        if (error.code === 'swap_run_too_long') {
          say(error.field('nights') ?? error.problem.title);
          return;
        }
        if (error.code === 'precondition_failed') {
          say('This changed while you were looking. It now shows the latest version.');
          return;
        }
        const field = error.firstFieldError;
        say(field ? field.message : error.problem.title);
      }

      /** When an action removes the focused button, focus lands on its list item, never the page body. */
      async function act(
        button: HTMLButtonElement,
        item: HTMLElement,
        pendingText: string,
        run: () => Promise<void>,
      ): Promise<void> {
        if (isPending(button)) return;
        const requestKey = item.dataset.requestKey as string;
        const wasFocused = document.activeElement === button;
        pendingButton(button, true, pendingText);
        try {
          await run();
        } catch (error) {
          if (error instanceof ApiFailure) reportFailure(error);
        } finally {
          pendingButton(button, false, '');
          await paint();
          if (wasFocused && !button.isConnected) {
            const fresh = main.querySelector<HTMLElement>(`[data-request-key="${requestKey}"]`);
            (fresh ?? (item.closest('ul') as HTMLElement | null) ?? waitingList).focus();
          }
        }
      }

      function actionButton(
        label: string,
        pendingText: string,
        item: HTMLElement,
        run: () => Promise<void>,
      ): HTMLButtonElement {
        const button = el('button', { type: 'button', class: label === 'Accept' || label === 'Send' || label === 'Settle' ? 'pill' : 'plain-button', text: label });
        button.addEventListener('click', () => {
          void act(button, item, pendingText, run);
        });
        return button;
      }

      function answerByLines(state: string, answerBy: string | null, zone: string): HTMLElement[] {
        const lines: HTMLElement[] = [];
        if (state === 'sent' && answerBy) {
          lines.push(el('p', { class: 'answer-by', text: `Answer by ${formatInstantDisplay(answerBy, zone)}` }));
        }
        if (state === 'lapsed' && answerBy) lines.push(el('p', { text: lapsedCopy(answerBy, zone) }));
        return lines;
      }

      function swapItem(swap: SwapJson, etag: string | null): HTMLElement {
        const item = el('li', {
          role: 'listitem',
          class: 'request-item arrives',
          tabindex: '-1',
          'data-request-key': `swap-${swap.id}`,
        });
        const zone = swap.answerZone ?? me.household.zone;
        const lines: HTMLElement[] = [
          el('p', { class: 'item-title', text: `Swap to ${nameOf(swap.toParent)}` }),
          el('p', { text: nightRangeText(swap.nights) }),
        ];
        if (swap.makeupNights) lines.push(el('p', { text: makeupRangeText(swap.makeupNights) }));
        lines.push(el('p', { class: 'item-state', text: stateWords[swap.state] ?? swap.state }));
        lines.push(...answerByLines(swap.state, swap.answerBy, zone));
        const actions = el('div', { class: 'row-actions' });
        const answerer = swap.createdBy !== me.role;
        if (swap.state === 'sent' && answerer) {
          actions.append(
            actionButton('Accept', 'Accepting...', item, async () => {
              await api('POST', householdPath(`/swaps/${swap.id}/accept`), {
                ifMatch: etag ?? undefined,
                idempotencyKey: newIdempotencyKey(),
              });
              say('Swap accepted. The calendar now shows it.');
            }),
          );
          const decline = el('button', { type: 'button', class: 'plain-button', text: 'Decline' });
          decline.addEventListener('click', () => {
            openDeclineDialog({
              opener: decline,
              onDecline: async (reason) => {
                await api('POST', householdPath(`/swaps/${swap.id}/decline`), {
                  json: { reason },
                  ifMatch: etag ?? undefined,
                  idempotencyKey: newIdempotencyKey(),
                });
                say('Request declined.');
                await paint();
              },
            });
          });
          actions.append(decline);
        }
        if (swap.state === 'sent' && !answerer) {
          actions.append(
            actionButton('Withdraw', 'Withdrawing...', item, async () => {
              await api('POST', householdPath(`/swaps/${swap.id}/withdraw`), {
                ifMatch: etag ?? undefined,
                idempotencyKey: newIdempotencyKey(),
              });
              say('Request withdrawn.');
            }),
          );
        }
        if (swap.state === 'draft' && !answerer) {
          actions.append(
            actionButton('Send', 'Sending...', item, async () => {
              await api('POST', householdPath(`/swaps/${swap.id}/send`), {
                ifMatch: etag ?? undefined,
                idempotencyKey: newIdempotencyKey(),
              });
              say('Request sent. An email notice is on its way.');
            }),
            actionButton('Delete draft', 'Deleting...', item, async () => {
              await api('DELETE', householdPath(`/swaps/${swap.id}`), { ifMatch: etag ?? undefined });
              say('Draft deleted.');
            }),
          );
        }
        item.append(...lines, actions);
        return item;
      }

      function costItem(cost: CostJson, etag: string | null): HTMLElement {
        const item = el('li', {
          role: 'listitem',
          class: 'request-item arrives',
          tabindex: '-1',
          'data-request-key': `cost-${cost.id}`,
        });
        const zone = cost.answerZone ?? me.household.zone;
        const money = formatMoney(cost.amountMinor, me.household.currency, me.household.currencyExponent);
        const lines: HTMLElement[] = [
          el('p', { class: 'item-title', text: `Reimbursement: ${cost.description}` }),
          el('p', { text: `${money} paid by ${nameOf(cost.paidBy)}` }),
          el('p', { class: 'item-state', text: stateWords[cost.state] ?? cost.state }),
          ...answerByLines(cost.state, cost.answerBy, zone),
        ];
        const actions = el('div', { class: 'row-actions' });
        const answerer = cost.paidBy !== me.role;
        if (cost.state === 'sent' && answerer) {
          actions.append(
            actionButton('Accept', 'Accepting...', item, async () => {
              await api('POST', householdPath(`/costs/${cost.id}/accept`), {
                ifMatch: etag ?? undefined,
                idempotencyKey: newIdempotencyKey(),
              });
              say('Reimbursement accepted.');
            }),
          );
          const decline = el('button', { type: 'button', class: 'plain-button', text: 'Decline' });
          decline.addEventListener('click', () => {
            openDeclineDialog({
              opener: decline,
              onDecline: async (reason) => {
                await api('POST', householdPath(`/costs/${cost.id}/decline`), {
                  json: { reason },
                  ifMatch: etag ?? undefined,
                  idempotencyKey: newIdempotencyKey(),
                });
                say('Request declined.');
                await paint();
              },
            });
          });
          actions.append(decline);
        }
        if (cost.state === 'sent' && !answerer) {
          actions.append(
            actionButton('Withdraw', 'Withdrawing...', item, async () => {
              await api('POST', householdPath(`/costs/${cost.id}/withdraw`), {
                ifMatch: etag ?? undefined,
                idempotencyKey: newIdempotencyKey(),
              });
              say('Request withdrawn.');
            }),
          );
        }
        if (cost.state === 'accepted' && !answerer) {
          actions.append(
            actionButton('Settle', 'Settling...', item, async () => {
              await api('POST', householdPath(`/costs/${cost.id}/settle`), {
                ifMatch: etag ?? undefined,
                idempotencyKey: newIdempotencyKey(),
              });
              say('Marked as settled.');
            }),
          );
        }
        item.append(...lines, actions);
        return item;
      }

      async function paint(): Promise<void> {
        const swapList = await api<{ items: SwapJson[] }>('GET', householdPath('/swaps?limit=100'));
        const costList = await api<{ items: CostJson[] }>('GET', householdPath('/costs?limit=100'));
        const swaps = await Promise.all(
          swapList.data.items.map((swap) => api<SwapJson>('GET', householdPath(`/swaps/${swap.id}`))),
        );
        const costs = await Promise.all(
          costList.data.items.map((cost) => api<CostJson>('GET', householdPath(`/costs/${cost.id}`))),
        );
        const waiting: HTMLElement[] = [];
        const mine: HTMLElement[] = [];
        for (const result of swaps) {
          const swap = result.data;
          const node = swapItem(swap, result.etag);
          if (swap.state === 'sent' && swap.createdBy !== me.role) waiting.push(node);
          else if (swap.createdBy === me.role) mine.push(node);
        }
        for (const result of costs) {
          const cost = result.data;
          const node = costItem(cost, result.etag);
          if (cost.state === 'sent' && cost.paidBy !== me.role) waiting.push(node);
          else if (cost.paidBy === me.role) mine.push(node);
        }
        waitingList.replaceChildren(
          ...(waiting.length > 0 ? waiting : [el('li', { role: 'listitem', text: 'Nothing to answer.' })]),
        );
        sentList.replaceChildren(
          ...(mine.length > 0 ? mine : [el('li', { role: 'listitem', text: 'Nothing to answer.' })]),
        );
        setWaitingCount(waiting.length);
      }

      await paint();
      stopLive = onLiveEntry(() => {
        void paint();
      });

      this.dispose = (): void => {
        stopLive?.();
      };
    },
  };
}
