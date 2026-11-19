import { NO_FIGURE } from '../../shared/figures';
import { formatAmountField, parseAmountToCents } from '../../shared/money';
import { formatTaxPercent } from '../../shared/rates';
import { notices, pendingTexts } from '../../shared/notices';
import { call } from '../api';
import { loadRates, render, state } from '../app';
import { button, el, labelled, textbox } from '../dom';
import { regionNames, setMessage, statusRegion } from '../regions';
import { RatePlan, TaxRate } from '../types';
import { shell } from './shell';

function planForm(plan: RatePlan): HTMLElement {
  const weeknight = textbox(`${plan.name} weeknight price`, formatAmountField(plan.weeknightCents));
  const weekend = textbox(`${plan.name} weekend price`, formatAmountField(plan.weekendCents));
  const save = button(`Save ${plan.name}`, (event) => {
    const trigger = event.currentTarget as HTMLButtonElement;
    if (trigger.getAttribute('aria-busy') === 'true') return;
    trigger.setAttribute('aria-busy', 'true');
    setMessage(regionNames.ratesStatus, pendingTexts.saveRates);
    void call<RatePlan>(`/api/rate-plans/${plan.id}`, {
      method: 'PATCH',
      body: {
        weeknightCents: parseAmountToCents(weeknight.value) ?? 0,
        weekendCents: parseAmountToCents(weekend.value) ?? 0,
      },
    }).then(async (result) => {
      trigger.removeAttribute('aria-busy');
      setMessage(
        regionNames.ratesStatus,
        result.data
          ? notices.ratesSaved
          : result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? 'Not found.',
      );
      await loadRates();
      render();
    });
  });
  return el('div', { class: 'planform' }, [
    el('h3', { text: plan.name }),
    labelled(`${plan.name} weeknight price`, weeknight),
    labelled(`${plan.name} weekend price`, weekend),
    save,
  ]);
}

function taxForm(): HTMLElement {
  const percent = textbox('Tax rate percent');
  const startsOn = textbox('Starts on');
  const save = button('Save tax rate', (event) => {
    const trigger = event.currentTarget as HTMLButtonElement;
    if (trigger.getAttribute('aria-busy') === 'true') return;
    trigger.setAttribute('aria-busy', 'true');
    setMessage(regionNames.ratesStatus, pendingTexts.saveRates);
    void call<TaxRate>('/api/tax-rates', {
      method: 'POST',
      body: { percent: percent.value.trim(), startDate: startsOn.value.trim() },
    }).then(async (result) => {
      trigger.removeAttribute('aria-busy');
      setMessage(
        regionNames.ratesStatus,
        result.data
          ? notices.ratesSaved
          : result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? 'Not found.',
      );
      await loadRates();
      render();
    });
  });
  return el('div', { class: 'planform' }, [
    el('h3', { text: 'Tax rate' }),
    labelled('Tax rate percent', percent),
    labelled('Starts on', startsOn),
    save,
  ]);
}

export function ratesScreen(): HTMLElement {
  const table = el('table', { 'aria-label': 'Tax rates', class: 'grid-table' }, [
    el('thead', {}, [
      el('tr', {}, [el('th', { scope: 'col' }, ['Rate']), el('th', { scope: 'col' }, ['Starts on'])]),
    ]),
    el(
      'tbody',
      {},
      state.taxRates.map((rate) =>
        el('tr', {}, [
          el('td', { class: 'amount' }, [formatTaxPercent(rate.percent)]),
          el('td', {}, [rate.startDate ?? NO_FIGURE]),
        ]),
      ),
    ),
  ]);

  return shell([], [
    el('main', { class: 'twocolumn' }, [
      el('div', { class: 'leftcolumn' }, [
        el('h1', { text: 'Rates' }),
        ...state.ratePlans.map(planForm),
        taxForm(),
        statusRegion(regionNames.ratesStatus),
      ]),
      el('div', { class: 'rightcolumn' }, [table]),
    ]),
  ]);
}
