import { api } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { publicPage } from '../lib/chrome.js';
import { createStrip, isWide } from '../lib/strip.js';
import { definitionList, hullDrawing, listItem, stripList } from '../lib/views.js';
import { formatDate, formatMoney } from '../../shared/format.js';
import type { RouteContext } from '../lib/router.js';
import { goneScreen, notFoundScreen } from './feedbackPages.js';
import { lengthFigure, type PublicYacht } from './publicFleet.js';
import { centimetresFromMetres, formatMeasurement } from '../../shared/format.js';

export interface WeekSummary {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly status: 'free' | 'held' | 'booked';
  readonly season: 'low' | 'shoulder' | 'high';
  readonly weeklyRateMinor: number;
  readonly currency: string;
}

export const WEEK_STATUS_LABELS: Record<WeekSummary['status'], string> = {
  free: 'Free',
  held: 'Held',
  booked: 'Booked',
};


export async function publicYachtScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<(() => void) | void> {
  const workspaceSlug = context.params.ws;
  const result = await api.get<PublicYacht & { weeks: readonly WeekSummary[] }>(
    `/api/public/fleets/${workspaceSlug}/yachts/${context.params.yachtSlug}`,
  );
  if (result.status === 410) {
    await goneScreen(host, workspaceSlug);
    return;
  }
  if (!result.ok) {
    await notFoundScreen(host);
    return;
  }
  const yacht = result.data;
  const page = publicPage(host, yacht.name);
  const weeks = stripList('Weeks', 'No weeks yet.', 'Weeks position');
  weeks.setItems(
    yacht.weeks.map((week) =>
      listItem(
        el(
          'div',
          { class: 'week-card' },
          el('p', { class: 'week-date' }, `Week of ${formatDate(week.weekStart)}`),
          el('p', { class: 'week-status' }, WEEK_STATUS_LABELS[week.status]),
          el('p', { class: 'card-figure' }, formatMoney(week.weeklyRateMinor, week.currency)),
        ),
      ),
    ),
  );
  const strip = createStrip({
    viewport: weeks.viewport,
    track: weeks.list,
    progress: weeks.progress,
  });
  weeks.progress.hidden = !isWide();

  page.main.append(
    el(
      'div',
      { class: 'yacht-profile-view' },
      hullDrawing(yacht.name, yacht.lengthM, yacht.beamM),
      definitionList([
        ['Base', yacht.base === 'split' ? 'Split' : 'Lavrio'],
        ['Cabins', String(yacht.cabins)],
        ['Length', lengthFigure(yacht.lengthM)],
        ['Beam', formatMeasurement(centimetresFromMetres(yacht.beamM.toFixed(2)))],
        ['Draft', formatMeasurement(centimetresFromMetres(yacht.draftM.toFixed(2)))],
        ['Low season weekly rate', formatMoney(yacht.rates.lowMinor, yacht.currency)],
        ['Shoulder season weekly rate', formatMoney(yacht.rates.shoulderMinor, yacht.currency)],
        ['High season weekly rate', formatMoney(yacht.rates.highMinor, yacht.currency)],
      ]),
    ),
    weeks.section,
  );

  const onResize = (): void => {
    weeks.progress.hidden = !isWide();
    strip.refresh();
  };
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
  };
}
