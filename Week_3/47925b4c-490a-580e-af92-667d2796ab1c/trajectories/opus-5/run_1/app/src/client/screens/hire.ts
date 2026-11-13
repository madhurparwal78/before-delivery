import { ApiProblem, call, newKey } from '../api.js';
import { append, button, clear, combobox, el, field, showFieldError, spinbutton, textbox } from '../dom.js';
import { listen } from '../events.js';
import { clearBand, heading, navigation, showBand } from '../shell.js';
import { euros, remainingText } from '../format.js';
import { bodyCrop } from '../wall.js';

interface Quote {
  readonly dayRateCents: number;
  readonly days: number;
  readonly factorPermille: number;
  readonly netCents: number;
  readonly vatCents: number;
  readonly totalCents: number;
  readonly providerTotalCents: number;
  readonly matches: boolean;
}

interface Hold {
  readonly id: string;
  readonly status: string;
  readonly model: string;
  readonly from: string;
  readonly days: number;
  readonly holdRef: string | null;
  readonly serial: string | null;
  readonly expiresAt: string | null;
  readonly remainingSeconds: number;
  readonly serverNow: string;
  readonly quote: Quote | null;
}

export async function renderHire(screen: HTMLElement, chrome: HTMLElement): Promise<() => void> {
  clear(chrome);
  chrome.appendChild(navigation('/hire'));

  const hireStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Hire' });
  const stockStatus = el('p', { class: 'status' });
  const holdsBody = el('tbody');
  const sentenceHost = el('div');
  const model = combobox('Model', [
    { value: 'VK-20', label: 'VK-20' },
    { value: 'VK-12', label: 'VK-12' },
  ]);
  const firstDay = textbox('First day', '', { placeholder: 'YYYY-MM-DD' });
  const days = spinbutton('Days', 1, 1, { min: 1, max: 7 });
  const countdowns = new Map<string, { node: HTMLElement; remaining: number; read: number }>();

  const checkStock = async (): Promise<void> => {
    clearBand();
    showFieldError('hire/from', null);
    showFieldError('hire/days', null);
    try {
      const stock = await call<{ model: string; available: number; dayRateCents: number }>(
        `/api/hire/stock?model=${encodeURIComponent(model.value)}&from=${encodeURIComponent(firstDay.value)}&days=${days.value}`,
      );
      stockStatus.textContent = `${stock.available} free at ${euros(stock.dayRateCents)} a day.`;
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      const errors = error.body.errors ?? {};
      for (const [pointer, copy] of Object.entries(errors)) showFieldError(`hire${pointer}`, copy);
      if (error.body.errors === undefined) showBand(error.body.detail);
    }
  };

  const askHold = async (): Promise<void> => {
    clearBand();
    hireStatus.textContent = 'Asking the hire desk';
    try {
      await call('/api/holds', {
        method: 'POST',
        key: newKey(),
        body: { model: model.value, from: firstDay.value, days: Number(days.value) },
      });
      await draw();
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
      await draw();
    }
  };

  const quote = async (hold: Hold): Promise<void> => {
    clearBand();
    try {
      const answer = await call<Quote>(`/api/holds/${hold.id}/quote`, { method: 'POST', body: {} });
      await draw();
      hireStatus.textContent = `Quote ${euros(answer.totalCents)} including 21% VAT.`;
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
      await draw();
    }
  };

  const confirm = async (hold: Hold): Promise<void> => {
    clearBand();
    try {
      await call<Hold>(`/api/holds/${hold.id}/confirm`, { method: 'POST', key: newKey(), body: {} });
      await draw();
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
      await draw();
    }
  };

  const release = async (hold: Hold): Promise<void> => {
    clearBand();
    try {
      await call(`/api/holds/${hold.id}/release`, { method: 'POST', key: newKey(), body: {} });
      await draw();
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
      await draw();
    }
  };

  const draw = async (): Promise<void> => {
    const holds = (await call<{ items: Hold[] }>('/api/holds')).items;
    const held = holds.filter((hold) => hold.status === 'Held').length;
    clear(sentenceHost);
    sentenceHost.appendChild(
      heading({
        sentence: held === 1 ? '1 BODY ON HOLD' : `${held} BODIES ON HOLD`,
        slot: bodyCrop(),
      }),
    );
    countdowns.clear();
    clear(holdsBody);
    for (const hold of holds) {
      const countdown = el('span', { text: hold.status === 'Held' ? remainingText(hold.remainingSeconds) : '' });
      if (hold.status === 'Held') {
        countdowns.set(hold.id, { node: countdown, remaining: hold.remainingSeconds, read: Date.now() });
      }
      holdsBody.appendChild(
        el('tr', {}, [
          el('td', { text: hold.model }),
          el('td', { text: hold.serial ?? '' }),
          el('td', { text: hold.status }),
          el('td', {}, [hold.status === 'Held' ? countdown : el('span', { text: '' })]),
          el('td', { text: hold.quote === null ? '' : euros(hold.quote.totalCents) }),
          el('td', { class: 'row-actions' }, [
            button(`Quote ${hold.id}`, () => void quote(hold), { class: 'quiet' }),
            button(`Confirm ${hold.id}`, () => void confirm(hold)),
            button(`Release ${hold.id}`, () => void release(hold), { class: 'quiet' }),
          ]),
        ]),
      );
    }
    const latest = holds[0];
    if (latest !== undefined) hireStatus.textContent = statusCopy(latest);
  };

  /** The hire status always reads the hold's own state, never a guess. */
  const statusCopy = (hold: Hold): string => {
    switch (hold.status) {
      case 'Asked':
        return 'Asked; still checking with the hire desk';
      case 'Held':
        return `Held for ${remainingText(hold.remainingSeconds)}`;
      case 'Hired in':
        return `Hired in. ${hold.serial ?? ''} is on your shelf.`;
      case 'Lapsed':
        return 'This hold has lapsed. Bodies drawn on it need a body again.';
      default:
        return 'Released.';
    }
  };

  clear(screen);
  append(screen, [
    sentenceHost,
    el('div', { class: 'columns' }, [
      el('div', { class: 'lede' }, [
        el('form', { 'aria-label': 'Check stock', onsubmit: (event: Event) => event.preventDefault() }, [
          el('label', {}, ['Model', model]),
          field('First day', firstDay, 'hire/from'),
          field('Days', days, 'hire/days'),
          el('div', { class: 'row-actions' }, [
            button('Check stock', () => void checkStock()),
            button('Ask for a hold', () => void askHold()),
          ]),
        ]),
        stockStatus,
        hireStatus,
      ]),
      el('div', { class: 'evidence' }, [
        el('table', { 'aria-label': 'Holds' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Model' }),
              el('th', { scope: 'col', text: 'Serial' }),
              el('th', { scope: 'col', text: 'Status' }),
              el('th', { scope: 'col', text: 'Remaining' }),
              el('th', { scope: 'col', text: 'Total' }),
              el('th', { scope: 'col', text: 'Actions' }),
            ]),
          ]),
          holdsBody,
        ]),
      ]),
    ]),
  ]);

  await draw();

  const ticker = setInterval(() => {
    for (const entry of countdowns.values()) {
      const left = Math.max(0, entry.remaining - Math.floor((Date.now() - entry.read) / 1000));
      entry.node.textContent = remainingText(left);
    }
  }, 1000);
  const reread = setInterval(() => void draw(), 30_000);
  const stopListening = listen('/api/events', (event) => {
    if (event.type === 'hold.changed') {
      void draw();
    }
  });
  return () => {
    clearInterval(ticker);
    clearInterval(reread);
    stopListening();
  };
}
