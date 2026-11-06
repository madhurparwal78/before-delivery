import { isMonth, monthLabel } from '../../shared/calendar.js';
import { formatMoney } from '../../shared/format.js';
import { AbandonedError, ApiError, NetworkError, networkCopy, get } from '../api.js';
import { clear, el, fieldError, labelled, on, replace, setFieldError } from '../dom.js';
import type { Screen, ScreenContext } from '../screen.js';

type Utilisation = {
  month: string;
  stations: Array<{
    stationId: string;
    name: string;
    bookedHours: number;
    peakHours: number;
    shelfDays: number;
    revenueCents: number;
  }>;
  totals: {
    bookedHours: number;
    peakHours: number;
    shelfDays: number;
    revenueCents: number;
    adjustmentCents: number;
  };
};

export function reportsScreen(context: ScreenContext): Screen {
  const monthInput = el('input', { type: 'text', value: context.query.get('month') ?? '' });
  const monthError = fieldError();
  const region = el('div', { role: 'region', 'aria-label': 'Utilisation report' });
  const element = el('div', { class: 'reports-screen' }, [
    labelled('Month', monthInput, monthError),
    region,
  ]);

  let token = 0;
  let destroyed = false;

  function commitMonth(): void {
    const month = monthInput.value.trim();
    if (month.length === 0) return;
    context.navigate(`/reports?month=${encodeURIComponent(month)}`);
  }
  on(monthInput, 'change', commitMonth);
  on(monthInput, 'keydown', (event) => {
    if (event.key === 'Enter') commitMonth();
  });

  async function load(): Promise<void> {
    const month = context.query.get('month');
    if (month !== null && !isMonth(month)) {
      setFieldError(monthInput, monthError, 'Use a month in the form YYYY-MM.');
      clear(region);
      return;
    }
    setFieldError(monthInput, monthError, null);
    token += 1;
    const mine = token;
    region.setAttribute('aria-busy', 'true');
    clear(region);
    try {
      const query = month === null ? '' : `?month=${encodeURIComponent(month)}`;
      const result = await get<Utilisation>(`/api/reports/utilisation${query}`);
      if (destroyed || mine !== token) return;
      if (month === null) context.fillAddress(`/reports?month=${result.body.month}`);
      monthInput.value = result.body.month;
      draw(result.body);
    } catch (error) {
      if (error instanceof AbandonedError) return;
      if (destroyed || mine !== token) return;
      if (error instanceof ApiError && error.status === 422) {
        setFieldError(monthInput, monthError, error.firstFieldMessage() ?? error.copy);
      } else if (error instanceof NetworkError) {
        context.showAlert(networkCopy);
      }
    } finally {
      if (mine === token) region.removeAttribute('aria-busy');
    }
  }

  function draw(report: Utilisation): void {
    const table = el('table', { 'aria-label': 'Utilisation' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Station' }),
        el('th', { text: 'Booked hours' }),
        el('th', { text: 'Peak hours' }),
        el('th', { text: 'Shelf-days' }),
        el('th', { text: 'Revenue' }),
      ])),
      el(
        'tbody',
        {},
        report.stations.map((station) =>
          el('tr', {}, [
            el('td', { text: station.name }),
            el('td', { text: String(station.bookedHours) }),
            el('td', { text: String(station.peakHours) }),
            el('td', { text: String(station.shelfDays) }),
            el('td', { text: formatMoney(station.revenueCents) }),
          ]),
        ),
      ),
      el('tfoot', {}, el('tr', {}, [
        el('td', { text: 'Totals' }),
        el('td', { text: String(report.totals.bookedHours) }),
        el('td', { text: String(report.totals.peakHours) }),
        el('td', { text: String(report.totals.shelfDays) }),
        el('td', {
          text: `${formatMoney(report.totals.revenueCents)} \u00b7 Adjustments ${formatMoney(
            report.totals.adjustmentCents,
          )}`,
        }),
      ])),
    ]);
    replace(region, [
      el('h2', { text: `Utilisation for ${monthLabel(report.month)}` }),
      table,
      el('a', {
        href: `/api/exports/usage.csv?month=${report.month}`,
        text: 'Export usage CSV',
        download: '',
      }),
    ]);
  }

  void load();
  context.setHourBank(null);

  return {
    element,
    destroy: () => {
      destroyed = true;
    },
  };
}
