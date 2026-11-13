import { WINDOW_STATUS_LABELS } from '../../domain/time.ts';
import { api, failureOf, type Failure } from '../api.ts';
import { copy } from '../copy.ts';
import { allocationCounter } from '../counters.ts';
import { clear, el, setText, trapFocus } from '../dom.ts';
import { navigate } from '../navigation.ts';
import type { Screen } from '../screen.ts';
import { clearDraft, loadDraft, requireUser, saveDraft, takeDraftRestore } from '../session.ts';
import type { Allocation, OperatorRecord, OrderRecord, TurnoutRecord, WindowRecord } from '../types.ts';

/** The grower's order form. Every figure on it comes from the server's quote. */

const DASH = '—';

interface Catalogue {
  turnouts: TurnoutRecord[];
  windows: WindowRecord[];
  operators: OperatorRecord[];
  channelOrder: Map<string, number>;
}

export async function orderFormScreen(): Promise<Screen> {
  const user = requireUser();
  const counter = allocationCounter();

  const status = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Order status', 'aria-live': 'polite' },
  });
  const windowStatusRegion = el('p', {
    class: 'status window-status-region',
    attrs: { role: 'status', 'aria-label': 'Window status', 'aria-live': 'polite' },
  });

  const turnoutSelect = select('Turnout', 'order-turnout');
  const windowSelect = select('Delivery window', 'order-window');
  const operatorSelect = select('Gate worked by', 'order-operator');
  const standbySelect = select('Standby operator', 'order-standby');

  const volume = el('input', {
    class: 'input tabular',
    attrs: { type: 'text', id: 'order-volume', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Volume (ML)' },
  });
  const volumeError = el('p', { class: 'field-error' });
  const turnoutError = el('p', { class: 'field-error' });

  const flowRate = el('span', { class: 'tabular figure-value', text: DASH });
  const flowRateGroup = el('div', {
    class: 'figure',
    attrs: { role: 'group', 'aria-label': 'Flow rate' },
    children: [el('span', { class: 'figure-label', text: 'Flow rate' }), flowRate],
  });
  const windowRemaining = el('span', { class: 'tabular figure-value', text: DASH });
  const windowRemainingGroup = el('div', {
    class: 'figure',
    attrs: { role: 'group', 'aria-label': 'Window remaining' },
    children: [el('span', { class: 'figure-label', text: 'Window remaining' }), windowRemaining],
  });

  const placeOrder = el('button', {
    class: 'button button-primary',
    text: 'Place order',
    attrs: { type: 'button' },
  });

  const form = el('form', {
    class: 'card form',
    attrs: { 'aria-label': 'New order', novalidate: true },
    children: [
      el('label', { class: 'label', text: 'Turnout', attrs: { for: 'order-turnout' } }),
      turnoutSelect,
      turnoutError,
      el('label', { class: 'label', text: 'Delivery window', attrs: { for: 'order-window' } }),
      windowSelect,
      windowStatusRegion,
      el('label', { class: 'label', text: 'Volume (ML)', attrs: { for: 'order-volume' } }),
      volume,
      volumeError,
      flowRateGroup,
      windowRemainingGroup,
      el('label', { class: 'label', text: 'Gate worked by', attrs: { for: 'order-operator' } }),
      operatorSelect,
      el('label', { class: 'label', text: 'Standby operator', attrs: { for: 'order-standby' } }),
      standbySelect,
      placeOrder,
      status,
    ],
  });

  const dialogHost = el('div');
  const element = el('main', {
    class: 'page page-form',
    children: [counter.element, el('h1', { text: 'New order' }), form, dialogHost],
  });

  const catalogue: Catalogue = { turnouts: [], windows: [], operators: [], channelOrder: new Map() };
  // The chosen window is held here, not read back from the option list, so a
  // window that closes stays selected and stays listed.
  let chosenWindowId = '';
  let selectedWindow: WindowRecord | null = null;
  let remainingForWindow: { windowId: string; value: string } | null = null;
  let quoteSequence = 0;
  let quoteTimer = 0;
  let placing = false;

  const draft = (): void => {
    saveDraft(user.id, {
      turnout: turnoutSelect.value,
      windowId: chosenWindowId,
      volumeMl: volume.value,
      operatorCode: operatorSelect.value,
      standbyCode: standbySelect.value,
    });
  };

  const paintWindowStatus = (): void => {
    if (selectedWindow === null) {
      setText(windowStatusRegion, '');
      placeOrder.setAttribute('aria-disabled', placing ? 'true' : 'false');
      return;
    }
    const base = WINDOW_STATUS_LABELS[selectedWindow.status];
    const extra =
      selectedWindow.restriction_cap_ml_day === null
        ? ''
        : copy.restrictedStatusSuffix(selectedWindow.restriction_cap_ml_day, selectedWindow.remaining_ml);
    setText(windowStatusRegion, `${base}${extra}`);
    const orderable = selectedWindow.orderable;
    placeOrder.setAttribute('aria-disabled', orderable && !placing ? 'false' : 'true');
  };

  const paintRemaining = (): void => {
    if (selectedWindow === null) {
      setText(windowRemaining, DASH);
      return;
    }
    if (remainingForWindow !== null && remainingForWindow.windowId === selectedWindow.id) {
      setText(windowRemaining, `${remainingForWindow.value} ML`);
    }
  };

  const noteWindowFigures = (window: WindowRecord): void => {
    if (selectedWindow !== null && window.id === selectedWindow.id) {
      selectedWindow = window;
      remainingForWindow = { windowId: window.id, value: window.remaining_ml };
      paintWindowStatus();
      paintRemaining();
    }
    const index = catalogue.windows.findIndex((entry) => entry.id === window.id);
    if (index >= 0) catalogue.windows[index] = window;
  };

  const windowOptionsFor = (): WindowRecord[] => {
    const turnout = catalogue.turnouts.find((entry) => entry.code === turnoutSelect.value) ?? null;
    const own = new Set(catalogue.turnouts.map((entry) => entry.channel_id));
    const listed = catalogue.windows.filter((window) => {
      const inReach = turnout === null ? own.has(window.channel_id) : window.channel_id === turnout.channel_id;
      if (!inReach) return false;
      return window.status !== 'closed' || window.id === chosenWindowId;
    });
    if (selectedWindow !== null && !listed.some((window) => window.id === selectedWindow?.id)) {
      listed.push(selectedWindow);
    }
    return listed.sort((a, b) => {
      const left = catalogue.channelOrder.get(a.channel_id) ?? 0;
      const right = catalogue.channelOrder.get(b.channel_id) ?? 0;
      if (turnout === null && left !== right) return left - right;
      return a.opens_at < b.opens_at ? -1 : a.opens_at > b.opens_at ? 1 : 0;
    });
  };

  const paintOptions = (): void => {
    const chosenTurnout = turnoutSelect.value;
    fillOptions(
      turnoutSelect,
      catalogue.turnouts.map((turnout) => ({ value: turnout.code, label: turnout.code })),
      chosenTurnout,
      true,
    );
    fillOptions(
      windowSelect,
      windowOptionsFor().map((window) => ({
        value: window.id,
        label: `${window.channel_name}, ${window.label}`,
      })),
      chosenWindowId,
      true,
    );
    const operators = catalogue.operators.map((operator) => ({
      value: operator.code,
      label: `${operator.name as string} (${operator.code})`,
    }));
    fillOptions(operatorSelect, operators, operatorSelect.value, true);
    fillOptions(standbySelect, [{ value: '', label: 'No standby' }, ...operators], standbySelect.value, false);
  };

  const loadWindow = async (windowId: string): Promise<void> => {
    const reply = await api.get<{ window: WindowRecord }>(`/api/windows/${encodeURIComponent(windowId)}`);
    if (chosenWindowId !== windowId) return;
    selectedWindow = reply.window;
    noteWindowFigures(reply.window);
    paintOptions();
  };

  const askQuote = (): void => {
    window.clearTimeout(quoteTimer);
    if (chosenWindowId === '' || volume.value.trim() === '') {
      quoteSequence += 1;
      setText(flowRate, DASH);
      return;
    }
    setText(flowRate, DASH);
    quoteTimer = window.setTimeout(() => void runQuote(), 250);
  };

  const runQuote = async (): Promise<void> => {
    const mine = ++quoteSequence;
    const windowId = chosenWindowId;
    const turnout = turnoutSelect.value;
    const parameters = new URLSearchParams({ window: windowId, volume_ml: volume.value.trim() });
    if (turnout !== '') parameters.set('turnout', turnout);
    try {
      const reply = await api.get<{ rate_ml_day: string; window: WindowRecord }>(
        `/api/orders/quote?${parameters.toString()}`,
      );
      if (mine !== quoteSequence) return;
      setText(flowRate, `${reply.rate_ml_day} ML/day`);
      setText(volumeError, '');
      setText(turnoutError, '');
      noteWindowFigures(reply.window);
    } catch (cause) {
      const failure = failureOf(cause);
      if (mine !== quoteSequence || failure === null) return;
      setText(flowRate, DASH);
      showFieldErrors(failure);
    }
  };

  const showFieldErrors = (failure: Failure): void => {
    const errors = failure.errors ?? {};
    setText(volumeError, errors.volume_ml ?? '');
    setText(turnoutError, errors.turnout ?? '');
  };

  turnoutSelect.addEventListener('change', () => {
    const turnout = catalogue.turnouts.find((entry) => entry.code === turnoutSelect.value) ?? null;
    if (turnout !== null && selectedWindow !== null && selectedWindow.channel_id !== turnout.channel_id) {
      chosenWindowId = '';
      selectedWindow = null;
      remainingForWindow = null;
      setText(windowRemaining, DASH);
      paintWindowStatus();
    }
    paintOptions();
    draft();
    askQuote();
  });

  windowSelect.addEventListener('change', () => {
    const windowId = windowSelect.value;
    chosenWindowId = windowId;
    selectedWindow = catalogue.windows.find((entry) => entry.id === windowId) ?? null;
    remainingForWindow = null;
    paintWindowStatus();
    setText(windowRemaining, DASH);
    draft();
    if (windowId !== '') void loadWindow(windowId);
    askQuote();
  });

  volume.addEventListener('input', () => {
    draft();
    askQuote();
  });
  operatorSelect.addEventListener('change', draft);
  standbySelect.addEventListener('change', draft);

  const openCapacityTaken = (): void => {
    const back = el('button', { class: 'button', text: copy.backToTheOrder, attrs: { type: 'button' } });
    const dialog = el('div', {
      class: 'dialog',
      attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': copy.capacityTakenHeading },
      children: [
        el('h2', { text: copy.capacityTakenHeading }),
        el('p', { text: copy.capacityTakenBody }),
        back,
      ],
    });
    const overlay = el('div', { class: 'overlay', children: [dialog] });
    const release = trapFocus(dialog, () => close());
    const close = (): void => {
      release();
      overlay.remove();
      placeOrder.focus();
    };
    back.addEventListener('click', close);
    dialogHost.appendChild(overlay);
    back.focus();
  };

  placeOrder.addEventListener('click', () => {
    if (placing || placeOrder.getAttribute('aria-disabled') === 'true') return;
    placing = true;
    placeOrder.setAttribute('aria-disabled', 'true');
    setText(status, copy.placingOrder);
    void (async () => {
      try {
        const reply = await api.post<{ order: OrderRecord }>('/api/orders', {
          turnout: turnoutSelect.value,
          window_id: chosenWindowId,
          volume_ml: volume.value.trim(),
          operator_code: operatorSelect.value,
          standby_code: standbySelect.value === '' ? null : standbySelect.value,
        });
        clearDraft(user.id);
        navigate(`/orders/${reply.order.number}`);
      } catch (cause) {
        placing = false;
        paintWindowStatus();
        const failure = failureOf(cause);
        if (failure === null) return;
        if (failure.code === 'window_full') {
          const remaining = failure.body.remaining_ml;
          if (typeof remaining === 'string' && selectedWindow !== null) {
            remainingForWindow = { windowId: selectedWindow.id, value: remaining };
            paintRemaining();
          }
          setText(status, '');
          await counter.refresh();
          openCapacityTaken();
          return;
        }
        if (failure.status === 422) {
          showFieldErrors(failure);
          setText(status, '');
          if ((failure.errors ?? {}).volume_ml !== undefined) await counter.refresh();
          return;
        }
        setText(status, failure.message ?? '');
      }
    })();
  });

  const refresh = async (): Promise<void> => {
    const [allocation, turnouts, windows, operators, channels] = await Promise.all([
      api.get<Allocation>('/api/me/allocation'),
      api.get<{ turnouts: TurnoutRecord[] }>('/api/turnouts'),
      api.get<{ windows: WindowRecord[] }>('/api/windows'),
      api.get<{ operators: OperatorRecord[] }>('/api/operators'),
      api.get<{ channels: { id: string }[] }>('/api/channels'),
    ]);
    counter.apply(allocation);
    catalogue.turnouts = turnouts.turnouts;
    catalogue.windows = windows.windows;
    catalogue.operators = operators.operators;
    catalogue.channelOrder = new Map(channels.channels.map((channel, index) => [channel.id, index]));
    paintOptions();
    if (chosenWindowId !== '') await loadWindow(chosenWindowId);
  };

  await refresh();

  const preselect = new URLSearchParams(window.location.search).get('window');
  const restored = takeDraftRestore() ? loadDraft(user.id) : null;
  if (restored !== null) {
    turnoutSelect.value = restored.turnout;
    chosenWindowId = restored.windowId;
    volume.value = restored.volumeMl;
    operatorSelect.value = restored.operatorCode;
    standbySelect.value = restored.standbyCode;
    setText(status, copy.draftRestored);
  } else if (preselect !== null) {
    chosenWindowId = preselect;
  }

  if (chosenWindowId !== '') {
    selectedWindow = catalogue.windows.find((entry) => entry.id === chosenWindowId) ?? null;
    paintOptions();
    paintWindowStatus();
    await loadWindow(chosenWindowId);
    askQuote();
  }

  return { element, refresh };
}

function select(label: string, id: string): HTMLSelectElement {
  return el('select', { class: 'input', attrs: { id, 'aria-label': label } });
}

function fillOptions(
  node: HTMLSelectElement,
  options: readonly { value: string; label: string }[],
  selected: string,
  placeholder: boolean,
): void {
  const wanted = (placeholder ? [{ value: '', label: '' }] : []).concat(
    options.map((option) => ({ value: option.value, label: option.label })),
  );
  const current = [...node.options].map((option) => `${option.value}\u0000${option.textContent ?? ''}`).join('\u0001');
  const next = wanted.map((option) => `${option.value}\u0000${option.label}`).join('\u0001');
  if (current !== next) {
    clear(node);
    for (const option of wanted) {
      node.appendChild(el('option', { text: option.label, attrs: { value: option.value } }));
    }
  }
  node.value = wanted.some((option) => option.value === selected) ? selected : wanted[0]?.value ?? '';
}
