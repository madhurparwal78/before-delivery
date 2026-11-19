import { request } from '../api';
import { COPY, money } from '../copy';
import { button, clear, el, labelled, row, table } from '../dom';
import { StatusRegion, showFieldError } from '../status';
import type { AppContext } from '../main';
import { addDays } from '../../shared/tz';
import type { RateJson, SiteJson } from '../../shared/types';

export function renderRates(container: HTMLElement, ctx: AppContext): void {
  const status = new StatusRegion('Rates status');
  const schedule = table('Rate schedule', ['Effective from', 'Hourly rate', 'Sales tax', 'State']);
  const siteSelect = el('select', { 'aria-label': 'Site', class: 'rail-control' });
  for (const site of ctx.sites) {
    siteSelect.append(el('option', { value: site.id, text: site.name }));
  }
  const effectiveFrom = el('input', { type: 'date' });
  const hourlyRate = el('input', { type: 'text', inputmode: 'decimal' });
  const taxRate = el('input', { type: 'text', inputmode: 'decimal' });
  const submit = button('Schedule rate', { class: 'primary', type: 'submit' });
  const form = el('form', { class: 'rate-form', novalidate: true }, [
    el('h2', { text: 'Schedule a rate' }),
    labelled('Effective from', effectiveFrom, 'rate-effective'),
    labelled('Hourly rate (USD)', hourlyRate, 'rate-hourly'),
    labelled('Sales tax (%)', taxRate, 'rate-tax'),
    submit,
  ]);

  container.append(
    el('div', { class: 'rail' }, [el('div', { class: 'rail-row' }, [siteSelect])]),
    el('section', { class: 'rates-body' }, [schedule.root, form]),
    status.element,
  );

  let generation = 0;
  let chosenSite: SiteJson = ctx.sites[0] as SiteJson;
  siteSelect.value = chosenSite.id;

  function resetEffectiveFrom(): void {
    effectiveFrom.value = addDays(chosenSite.local_date, 1);
  }

  function drawRates(rates: RateJson[]): void {
    clear(schedule.body);
    for (const rate of rates) {
      schedule.body.append(
        row([
          { label: 'Effective from', content: rate.effective_from },
          { label: 'Hourly rate', content: `$${money(rate.hourly_rate_cents)}` },
          { label: 'Sales tax', content: `${rate.tax_rate_percent}%` },
          {
            label: 'State',
            content:
              rate.state === 'current' ? 'Current' : rate.state === 'upcoming' ? 'Upcoming' : 'Past',
          },
        ]),
      );
    }
  }

  function load(): void {
    generation += 1;
    const current = generation;
    const siteId = chosenSite.id;
    clear(schedule.body);
    void request<{ rates: RateJson[] }>(`/api/sites/${siteId}/rates`).then((result) => {
      if (current !== generation || !result.ok) return;
      drawRates(result.data.rates);
    });
  }

  siteSelect.addEventListener('change', () => {
    const site = ctx.siteById(siteSelect.value);
    if (site === null) return;
    chosenSite = site;
    resetEffectiveFrom();
    load();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submit.getAttribute('aria-disabled') === 'true') return;
    const siteAtSend = chosenSite;
    const dollars = Number.parseFloat(hourlyRate.value);
    const cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : Number.NaN;
    submit.setAttribute('aria-disabled', 'true');
    status.write(COPY.saving);
    void request<{ rates: RateJson[] }>(`/api/sites/${siteAtSend.id}/rates`, {
      method: 'POST',
      body: {
        effective_from: effectiveFrom.value,
        hourly_rate_cents: Number.isFinite(cents) ? cents : null,
        tax_rate_percent: taxRate.value,
      },
    }).then((result) => {
      submit.setAttribute('aria-disabled', 'false');
      if (result.ok) {
        status.write(COPY.rateScheduled(effectiveFrom.value));
        if (chosenSite.id === siteAtSend.id) drawRates(result.data.rates);
        return;
      }
      const fields = result.error.fields ?? {};
      if (result.error.code === 'rate_exists') {
        showFieldError(effectiveFrom, COPY.rateExists(effectiveFrom.value));
        status.write(COPY.rateExists(effectiveFrom.value));
        return;
      }
      if (fields.effective_from !== undefined) {
        showFieldError(effectiveFrom, COPY.effectiveFromInvalid);
        status.write(COPY.effectiveFromInvalid);
      } else if (fields.hourly_rate_cents !== undefined) {
        showFieldError(hourlyRate, COPY.hourlyRateInvalid);
        status.write(COPY.hourlyRateInvalid);
      } else if (fields.tax_rate_percent !== undefined) {
        showFieldError(taxRate, COPY.taxRateInvalid);
        status.write(COPY.taxRateInvalid);
      } else if (result.status === 401) return;
      else status.write(result.status === 0 ? COPY.offline : COPY.internal);
    });
  });

  resetEffectiveFrom();
  load();
}
