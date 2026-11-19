import { getJson, requestJson } from '../shared/api.ts';
import { clear, el, preserveFocus } from '../shared/dom.ts';
import type { ProductionMonth } from './types.ts';

const TABLE_POLL_MS = 2_000;

export type MonthsView = {
  element: HTMLElement;
  activate: () => void;
  deactivate: () => void;
};

export function createMonthsView(setStatus: (text: string) => void): MonthsView {
  const table = el('table', { class: 'months-table', 'aria-label': 'Production months' });
  const save = el('button', { type: 'button', class: 'primary', text: 'Save months' });
  const notes = el('div', { class: 'month-notes' });
  const element = el('div', { class: 'single-pane' }, [table, save, notes]);

  const inputs = new Map<string, HTMLInputElement>();
  const touched = new Set<string>();
  let timer: number | null = null;

  const render = (months: readonly ProductionMonth[]): void => preserveFocus(() => {
    const existing = new Set(inputs.keys());
    clear(table);
    table.append(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Month' }),
          el('th', { scope: 'col', text: 'Capacity' }),
          el('th', { scope: 'col', text: 'Claimed' }),
        ]),
      ]),
    );
    const body = el('tbody');
    for (const month of months) {
      let input = inputs.get(month.month);
      if (input === undefined) {
        input = el('input', {
          type: 'number',
          min: 0,
          max: 12,
          step: 1,
          class: 'console-input capacity-input',
          'aria-label': `Capacity for ${month.label}`,
        });
        input.addEventListener('input', () => touched.add(month.month));
        inputs.set(month.month, input);
      }
      if (!touched.has(month.month)) input.value = String(month.capacity);
      existing.delete(month.month);
      body.append(
        el('tr', { 'data-month': month.month }, [
          el('th', { scope: 'row', class: 'mono', text: month.label }),
          el('td', {}, [input]),
          el('td', { class: 'mono claimed-cell', text: String(month.claimed) }),
        ]),
      );
    }
    table.append(body);
    for (const stale of existing) inputs.delete(stale);
  });

  const load = async (): Promise<void> => {
    const result = await getJson<{ months: ProductionMonth[] }>('/api/console/months');
    if (!result.ok) return;
    render(result.data.months);
  };

  save.addEventListener('click', () => {
    void (async () => {
      clear(notes);
      let failed = false;
      for (const [month, input] of inputs) {
        if (!touched.has(month)) continue;
        const result = await requestJson<unknown>('PUT', `/api/console/months/${month}`, {
          body: { capacity: Number(input.value) },
        });
        if (!result.ok) {
          failed = true;
          const message = result.errors.capacity ?? result.message;
          notes.append(el('p', { class: 'field-note', text: message }));
        }
      }
      touched.clear();
      await load();
      if (!failed) setStatus('Months saved.');
    })();
  });

  return {
    element,
    activate: () => {
      void load();
      timer ??= window.setInterval(() => void load(), TABLE_POLL_MS);
    },
    deactivate: () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    },
  };
}
