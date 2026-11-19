import { NO_FIGURE } from '../../shared/figures';
import { formatMoney } from '../../shared/money';
import { loadReport, render, state } from '../app';
import { button, el, labelled, textbox } from '../dom';
import { valueRegion } from '../regions';
import { shell } from './shell';

export function reportsScreen(): HTMLElement {
  const from = textbox('From', state.reportFrom ?? '');
  const to = textbox('To', state.reportTo ?? '');
  const show = button('Show figures', () => {
    state.reportFrom = from.value.trim();
    state.reportTo = to.value.trim();
    void loadReport().then(render);
  });

  const report = state.report;
  const figures: Node[] = [
    valueRegion('Rooms available', report ? String(report.roomsAvailable) : NO_FIGURE),
    valueRegion('Rooms sold', report ? String(report.roomsSold) : NO_FIGURE),
    valueRegion('Room revenue', report ? formatMoney(report.roomRevenueCents) : NO_FIGURE),
    valueRegion('Occupancy', report ? report.occupancy : NO_FIGURE),
    valueRegion('Average daily rate', report ? report.averageDailyRate : NO_FIGURE),
    valueRegion(
      'Revenue per available room',
      report ? report.revenuePerAvailableRoom : NO_FIGURE,
    ),
  ];

  const table = el('table', { 'aria-label': 'Nightly figures', class: 'grid-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Date']),
        el('th', { scope: 'col' }, ['Rooms available']),
        el('th', { scope: 'col' }, ['Rooms sold']),
        el('th', { scope: 'col' }, ['Room revenue']),
        el('th', { scope: 'col' }, ['Occupancy']),
        el('th', { scope: 'col' }, ['Average daily rate']),
        el('th', { scope: 'col' }, ['Revenue per available room']),
      ]),
    ]),
    el(
      'tbody',
      {},
      (report ? report.nights : []).map((night) =>
        el('tr', { 'data-night': night.date }, [
          el('td', {}, [night.date]),
          el('td', { class: 'amount' }, [String(night.roomsAvailable)]),
          el('td', { class: 'amount' }, [String(night.roomsSold)]),
          el('td', { class: 'amount' }, [formatMoney(night.roomRevenueCents)]),
          el('td', { class: 'amount' }, [night.occupancy]),
          el('td', { class: 'amount' }, [night.averageDailyRate]),
          el('td', { class: 'amount' }, [night.revenuePerAvailableRoom]),
        ]),
      ),
    ),
  ]);

  return shell([], [
    el('main', { class: 'twocolumn' }, [
      el('div', { class: 'leftcolumn' }, [
        el('h1', { text: 'Reports' }),
        labelled('From', from),
        labelled('To', to),
        show,
        el('div', { class: 'figurelist' }, figures),
      ]),
      el('div', { class: 'rightcolumn' }, [table]),
    ]),
  ]);
}
