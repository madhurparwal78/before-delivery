import { WINDOW_STATUS_LABELS } from '../../domain/time.ts';
import { api, failureOf } from '../api.ts';
import { copy } from '../copy.ts';
import { formatMlNumber } from '../counters.ts';
import { clear, countTo, el, setText } from '../dom.ts';
import { dwellControl, type DwellControl } from '../dwell.ts';
import type { Screen } from '../screen.ts';
import type { CardRecord, WindowRecord } from '../types.ts';

/** The channel operator's field view: one gate card per open or waiting stroke. */

interface CardView {
  element: HTMLElement;
  orderNumber: string;
  dwell: DwellControl | null;
  update: (card: CardRecord, window: WindowRecord) => void;
  destroy: () => void;
}

type ApiCard = CardRecord & { grower_name: string };

export async function fieldScreen(): Promise<Screen> {
  const announcement = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Gate dwell status', 'aria-live': 'polite' },
  });
  const list = el('ul', {
    class: 'card-list',
    attrs: { role: 'list', 'aria-label': 'Gate cards' },
  });

  const element = el('main', {
    class: 'page',
    children: [
      el('h1', { text: 'Field view' }),
      announcement,
      list,
    ],
  });

  const views = new Map<string, CardView>();
  const waiting = new Set<string>();
  let first = true;

  const announce = (text: string): void => setText(announcement, text);

  const stroke = async (card: ApiCard): Promise<void> => {
    waiting.add(card.id);
    announce(copy.strokeSent);
    views.get(card.id)?.update({ ...card, state: 'waiting-for-store' }, windowsById.get(card.window_id) as WindowRecord);
    try {
      const reply = await api.post<{ card: CardRecord; window: WindowRecord }>(
        `/api/gate-cards/${encodeURIComponent(card.id)}/stroke`,
      );
      if (reply.window === undefined) {
        announce(copy.storeNotAnswering);
      } else {
        announce(copy.strokeStored(card.turnout, reply.window.channel_flow_ml_day));
      }
    } catch (cause) {
      const failure = failureOf(cause);
      if (failure?.code === 'not_holder') announce(copy.notHolder);
      else if (failure?.code === 'window_not_open') announce(copy.windowNotOpen);
      else if (failure?.code === 'card_not_open') announce(copy.cardNotOpen);
      else if (failure !== null) announce(failure.message ?? '');
    } finally {
      waiting.delete(card.id);
      await refresh();
    }
  };

  const windowsById = new Map<string, WindowRecord>();

  const makeView = (card: ApiCard): CardView => {
    const heading = el('h2', { class: 'card-turnout', text: card.turnout });
    const who = el('p', { class: 'card-who' });
    const statusValue = el('span', { class: 'card-window-status' });
    const statusGroup = el('div', {
      class: 'figure',
      attrs: { role: 'group', 'aria-label': `Window status ${card.turnout}` },
      children: [el('span', { class: 'figure-label', text: 'Window status' }), statusValue],
    });
    const kind = el('p', { class: 'card-kind' });
    const movement = el('p', { class: 'card-movement tabular' });
    const control = el('div', { class: 'card-control' });
    const flowValue = el('span', { class: 'tabular counter-value', text: '0.000' });
    const flowGroup = el('div', {
      class: 'figure counter',
      attrs: { role: 'group', 'aria-label': 'Channel flow' },
      children: [el('span', { class: 'figure-label', text: 'Channel flow (ML/day)' }), flowValue],
    });
    const deliveredValue = el('span', { class: 'tabular counter-value', text: '0.000' });
    const deliveredGroup = el('div', {
      class: 'figure counter',
      attrs: { role: 'group', 'aria-label': 'Delivered' },
      children: [el('span', { class: 'figure-label', text: 'Delivered (ML)' }), deliveredValue],
    });

    const article = el('article', {
      class: 'gate-card',
      attrs: { 'aria-label': `Gate card ${card.turnout}` },
      children: [heading, who, statusGroup, kind, movement, control, flowGroup, deliveredGroup],
    });
    const element = el('li', { children: [article] });

    let currentCard = card;
    const view: CardView = {
      element,
      orderNumber: card.order_number,
      dwell: null,
      update: () => undefined,
      destroy: () => view.dwell?.destroy(),
    };

    view.update = (next: CardRecord, window: WindowRecord): void => {
      const shown = next as ApiCard;
      currentCard = { ...shown, grower_name: shown.grower_name ?? currentCard.grower_name };
      setText(who, `${currentCard.grower_name}, ${window.channel_name}, ${window.label}`);
      setText(statusValue, WINDOW_STATUS_LABELS[next.window_status]);
      setText(kind, next.kind === 'start' ? 'Start' : 'Finish');
      setText(movement, `${next.from_ml_day} → ${next.to_ml_day} ML/day`);

      const state = waiting.has(next.id) ? 'waiting-for-store' : next.state;
      if (state === 'open') {
        if (view.dwell === null) {
          clear(control);
          view.dwell = dwellControl({
            turnoutCode: next.turnout,
            onCommit: () => void stroke(currentCard),
            onEarlyRelease: () => announce(copy.releasedEarly),
          });
          control.appendChild(view.dwell.element);
        }
      } else {
        if (view.dwell !== null) {
          view.dwell.destroy();
          view.dwell = null;
        }
        clear(control);
        if (state === 'waiting-for-store') {
          control.appendChild(el('p', { class: 'waiting', text: copy.waitingForTheStore }));
        } else if (next.stroke !== null) {
          control.appendChild(
            el('div', {
              class: 'stroke-record',
              attrs: { role: 'region', 'aria-label': `Stroke record ${next.turnout}` },
              children: [
                el('p', { text: `Stroke ${next.stroke.key}` }),
                el('p', { text: `Committed ${next.stroke.committed_at}` }),
                el('p', { text: `Operator ${next.stroke.operator_code}` }),
              ],
            }),
          );
        }
      }

      countTo(flowValue, Number(flowValue.textContent), Number(window.channel_flow_ml_day), formatMlNumber);
      countTo(deliveredValue, Number(deliveredValue.textContent), Number(window.delivered_ml), formatMlNumber);
    };

    return view;
  };

  const refresh = async (): Promise<void> => {
    const [cardReply, windowReply] = await Promise.all([
      api.get<{ cards: ApiCard[] }>('/api/gate-cards'),
      api.get<{ windows: WindowRecord[] }>('/api/windows'),
    ]);
    windowsById.clear();
    for (const window of windowReply.windows) windowsById.set(window.id, window);

    const seen = new Set<string>();
    for (const [index, card] of cardReply.cards.entries()) {
      seen.add(card.id);
      const window = windowsById.get(card.window_id) as WindowRecord;
      let view = views.get(card.id);
      if (view === undefined) {
        // A card that arrives for an order this operator already works is the
        // card their own stroke issued; only a card from another operator is a
        // handover.
        const handedOver = ![...views.values()].some((other) => other.orderNumber === card.order_number);
        view = makeView(card);
        views.set(card.id, view);
        // Only the new card is inserted, so a dwell in progress on another
        // card is never disturbed by a repaint.
        list.insertBefore(view.element, list.children[index] ?? null);
        if (!first && card.state === 'open' && handedOver) announce(copy.cardNowYours(card.turnout));
      }
      view.update(card, window);
    }

    for (const [id, view] of [...views]) {
      if (seen.has(id)) continue;
      const hadDwell = view.dwell !== null;
      view.destroy();
      view.element.remove();
      views.delete(id);
      if (!first && hadDwell) announce(copy.notHolder);
    }

    first = false;
  };

  await refresh();

  return {
    element,
    refresh,
    destroy: () => {
      for (const view of views.values()) view.destroy();
    },
  };
}
