import { ApiFailure, FailureContext, Me, api, cachedIdentity, faultCopy, householdPath, lapsedCopy, newIdempotencyKey } from '../api';
import { Screen, onLiveEntry, say, setWaitingCount } from '../app';
import { openModal } from '../dialogs';
import { Keyed, el, emptyState, isPending, labelled, pendingButton, reconcile, textbox } from '../dom';
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

interface SwapJson {
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

function nightRangeText(nights: string): string {
  const [start, end] = nights.split('/') as [string, string];
  return `${formatDisplayDate(start)} until ${formatDisplayDate(lastNightOf(end))}`;
}

function makeupRangeText(nights: string): string {
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
        modal.showAlert(faultCopy(error));
        if (error instanceof ApiFailure && error.firstFieldError) reason.focus();
      })
      .finally(() => pendingButton(decline, false, ''));
  });
}

export function requestsScreen(): Screen {
  let stopLive: (() => void) | null = null;

  return {
    async mount(main: HTMLElement): Promise<void> {
      const me = cachedIdentity() as Me;
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

      /** When an action removes the focused button, focus lands on its list item, never the page body. */
      async function act(
        button: HTMLButtonElement,
        requestRow: HTMLElement,
        pendingText: string,
        run: () => Promise<void>,
        context: FailureContext,
      ): Promise<void> {
        if (isPending(button)) return;
        const requestKey = requestRow.dataset.key as string;
        const wasFocused = document.activeElement === button;
        pendingButton(button, true, pendingText);
        try {
          await run();
        } catch (error) {
          say(faultCopy(error, context));
        } finally {
          pendingButton(button, false, '');
          await paint();
          if (wasFocused && !button.isConnected) {
            const fresh = main.querySelector<HTMLElement>(`[data-key="${requestKey}"]`);
            (fresh ?? (requestRow.closest('ul') as HTMLElement | null) ?? waitingList).focus();
          }
        }
      }

      function actionButton(
        label: string,
        pendingText: string,
        requestRow: HTMLElement,
        context: FailureContext,
        run: () => Promise<void>,
      ): HTMLButtonElement {
        const button = el('button', { type: 'button', class: 'plain-button', text: label });
        button.addEventListener('click', () => {
          void act(button, requestRow, pendingText, run, context);
        });
        return button;
      }

      function answerByLines(state: string, answerBy: string | null, zone: string): HTMLElement[] {
        if (state === 'sent' && answerBy) {
          return [el('p', { class: 'answer-by', text: `Answer by ${formatInstantDisplay(answerBy, zone)}` })];
        }
        if (state === 'lapsed') return [el('p', { text: lapsedCopy(answerBy, zone) })];
        return [];
      }

      type Kind = 'swaps' | 'costs';

      interface RequestView {
        kind: Kind;
        id: string;
        state: string;
        answerBy: string | null;
        zone: string;
        /** The parent who created it: a swap's creator, a cost's payer. */
        creator: 'planning' | 'other';
        etag: string | null;
        title: string;
        lines: string[];
      }

      const acceptedCopy: Record<Kind, string> = {
        swaps: 'Swap accepted. The calendar now shows it.',
        costs: 'Reimbursement accepted.',
      };

      function buildRequestRow(view: RequestView): HTMLElement {
        const requestRow = el('li', { role: 'listitem', class: 'request-item', tabindex: '-1' });
        const path = (verb: string): string => householdPath(`/${view.kind}/${view.id}${verb}`);
        const context: FailureContext = { lapsed: { answerBy: view.answerBy, zone: view.zone } };
        const post = (verb: string, copy: string): (() => Promise<void>) => async () => {
          await api('POST', path(verb), { ifMatch: view.etag ?? undefined, idempotencyKey: newIdempotencyKey() });
          say(copy);
        };
        const actions = el('div', { class: 'row-actions' });
        const answerer = view.creator !== me.role;
        if (view.state === 'sent' && answerer) {
          actions.append(actionButton('Accept', 'Accepting...', requestRow, context, post('/accept', acceptedCopy[view.kind])));
          const decline = el('button', { type: 'button', class: 'plain-button', text: 'Decline' });
          decline.addEventListener('click', () => {
            openDeclineDialog({
              opener: decline,
              onDecline: async (reason) => {
                await api('POST', path('/decline'), {
                  json: { reason },
                  ifMatch: view.etag ?? undefined,
                  idempotencyKey: newIdempotencyKey(),
                });
                say('Request declined.');
                await paint();
              },
            });
          });
          actions.append(decline);
        }
        if (view.state === 'sent' && !answerer) {
          actions.append(actionButton('Withdraw', 'Withdrawing...', requestRow, context, post('/withdraw', 'Request withdrawn.')));
        }
        if (view.state === 'draft' && !answerer) {
          actions.append(
            actionButton('Send', 'Sending...', requestRow, context, post('/send', 'Request sent. An email notice is on its way.')),
            actionButton('Delete draft', 'Deleting...', requestRow, context, async () => {
              await api('DELETE', path(''), { ifMatch: view.etag ?? undefined });
              say('Draft deleted.');
            }),
          );
        }
        if (view.state === 'accepted' && view.kind === 'costs' && !answerer) {
          actions.append(actionButton('Settle', 'Settling...', requestRow, context, post('/settle', 'Marked as settled.')));
        }
        requestRow.append(
          el('p', { class: 'item-title', text: view.title }),
          ...view.lines.map((line) => el('p', { text: line })),
          el('p', { class: 'item-state', text: stateWords[view.state] ?? view.state }),
          ...answerByLines(view.state, view.answerBy, view.zone),
          actions,
        );
        return requestRow;
      }

      function swapView(swap: SwapJson, etag: string | null): RequestView {
        return {
          kind: 'swaps',
          id: swap.id,
          state: swap.state,
          answerBy: swap.answerBy,
          zone: swap.answerZone ?? me.household.zone,
          creator: swap.createdBy,
          etag,
          title: `Swap to ${nameOf(swap.toParent)}`,
          lines: swap.makeupNights ? [nightRangeText(swap.nights), makeupRangeText(swap.makeupNights)] : [nightRangeText(swap.nights)],
        };
      }

      function costView(cost: CostJson, etag: string | null): RequestView {
        const amount = formatMoney(cost.amountMinor, me.household.currency, me.household.currencyExponent);
        return {
          kind: 'costs',
          id: cost.id,
          state: cost.state,
          answerBy: cost.answerBy,
          zone: cost.answerZone ?? me.household.zone,
          creator: cost.paidBy,
          etag,
          title: `Reimbursement: ${cost.description}`,
          lines: [`${amount} paid by ${nameOf(cost.paidBy)}`],
        };
      }

      const emptyEntry: Keyed = {
        key: 'empty',
        signature: 'empty',
        build: () => el('li', { role: 'listitem', class: 'empty-item' }, [emptyState('Nothing to answer.')]),
      };

      let firstPaint = true;

      function entryOf(view: RequestView): Keyed {
        return {
          key: `${view.kind}-${view.id}`,
          signature: JSON.stringify(view),
          build: () => buildRequestRow(view),
        };
      }

      async function paint(): Promise<void> {
        const [swapList, costList] = await Promise.all([
          api<{ items: SwapJson[] }>('GET', householdPath('/swaps?limit=100')),
          api<{ items: CostJson[] }>('GET', householdPath('/costs?limit=100')),
        ]);
        const swaps = await Promise.all(swapList.data.items.map((swap) => api<SwapJson>('GET', householdPath(`/swaps/${swap.id}`))));
        const costs = await Promise.all(
          costList.data.items.filter((cost) => cost.state !== 'draft').map((cost) => api<CostJson>('GET', householdPath(`/costs/${cost.id}`))),
        );
        const views = [
          ...swaps.map((result) => swapView(result.data, result.etag)),
          ...costs.map((result) => costView(result.data, result.etag)),
        ].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
        const waiting = views.filter((view) => view.creator !== me.role);
        const mine = views.filter((view) => view.creator === me.role);
        const added = [
          ...reconcile(waitingList, waiting.length > 0 ? waiting.map(entryOf) : [emptyEntry]),
          ...reconcile(sentList, mine.length > 0 ? mine.map(entryOf) : [emptyEntry]),
        ];
        if (!firstPaint) {
          for (const key of added) main.querySelector(`[data-key="${key}"]`)?.classList.add('arrives');
        }
        firstPaint = false;
        setWaitingCount(waiting.filter((view) => view.state === 'sent').length);
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
