import type { SeasonResponse } from '../../shared/api';
import { api } from '../api';
import { copy } from '../copy';
import { el, replace } from '../dom';
import type { ScreenContext, ScreenHandle } from '../main';
import { button, liveRegion } from '../ui';

export function renderSeason(ctx: ScreenContext): ScreenHandle {
  const updates = liveRegion('Season updates');
  const heading = el('h1', { class: 'page-heading', text: 'Season standings' });
  const host = el('div', { class: 'season' });
  const exportButton = button('Export standings CSV', {
    variant: 'primary',
    onClick: () => void exportCsv(),
  });
  const container = el(
    'div',
    { class: 'screen' },
    heading,
    el('div', { class: 'panel__actions' }, exportButton),
    updates,
    host,
  );

  let year = new Date().getUTCFullYear();

  function paint(season: SeasonResponse): void {
    year = season.year;
    heading.textContent = `Season standings ${season.year}`;
    replace(
      host,
      el(
        'table',
        { class: 'data-table', attrs: { 'aria-label': 'Season standings' } },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { class: 'num', text: 'Position' }),
            el('th', { text: 'Driver' }),
            el('th', { text: 'Car' }),
            el('th', { text: 'Class' }),
            el('th', { class: 'num', text: 'Events' }),
            el('th', { class: 'num', text: 'Points' }),
          ),
        ),
        el(
          'tbody',
          {},
          season.rows.map((row) =>
            el(
              'tr',
              {},
              el('td', { class: 'num mono', text: String(row.position) }),
              el('td', { text: row.driverName }),
              el('td', { text: row.carDescription }),
              el('td', { text: row.classCode }),
              el('td', { class: 'num mono', text: String(row.events) }),
              el('td', { class: 'num mono', text: row.points }),
            ),
          ),
        ),
      ),
      el(
        'p',
        { class: 'meta' },
        season.events.length === 0
          ? 'No published events counted yet.'
          : `Counted events: ${season.events.map((event) => event.name).join(', ')}`,
      ),
    );
  }

  async function reload(): Promise<void> {
    const season = await api.season.standings();
    paint(season);
  }

  async function exportCsv(): Promise<void> {
    exportButton.disabled = true;
    exportButton.classList.add('is-pending');
    updates.textContent = copy.season.pending;
    try {
      const response = await fetch(`/api/season.csv?year=${year}`, { credentials: 'same-origin' });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = el('a', {
        attrs: { href: url, download: `season-standings-${year}.csv` },
      });
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      updates.textContent = copy.season.downloaded;
    } finally {
      exportButton.disabled = false;
      exportButton.classList.remove('is-pending');
    }
  }

  void reload();
  void ctx;
  return { element: container };
}
