import { api } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { link, pushPath, replacePath, type RouteContext } from '../lib/router.js';
import { publicPage } from '../lib/chrome.js';
import { createStrip, isWide } from '../lib/strip.js';
import { button, combobox, hullDrawing, listItem, quietButton, stripList } from '../lib/views.js';
import {
  centimetresFromMetres,
  formatDate,
  formatMeasurement,
  formatMoney,
} from '../../shared/format.js';
import { notFoundScreen } from './feedbackPages.js';

export interface PublicYacht {
  readonly slug: string;
  readonly name: string;
  readonly base: 'split' | 'lavrio';
  readonly cabins: number;
  readonly lengthM: number;
  readonly beamM: number;
  readonly draftM: number;
  readonly rates: {
    readonly lowMinor: number;
    readonly shoulderMinor: number;
    readonly highMinor: number;
  };
  readonly currency: string;
}

interface FleetBody {
  readonly workspace: { readonly slug: string; readonly name: string };
  readonly yachts: readonly PublicYacht[];
}

const BASE_OPTIONS = [
  { value: '', label: 'Any base' },
  { value: 'split', label: 'Split' },
  { value: 'lavrio', label: 'Lavrio' },
];

const CABIN_OPTIONS = [
  { value: '', label: 'Any cabins' },
  { value: '3', label: '3 or more' },
  { value: '4', label: '4 or more' },
  { value: '5', label: '5 or more' },
  { value: '6', label: '6' },
];

const SEASON_OPTIONS = [
  { value: '', label: 'Any season' },
  { value: 'low', label: 'Low season' },
  { value: 'shoulder', label: 'Shoulder season' },
  { value: 'high', label: 'High season' },
];

const FILTER_KEYS = ['base', 'cabins', 'season', 'week'] as const;

export function sunBadge(): HTMLElement {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315]
    .map((angle) => {
      const radians = (angle * Math.PI) / 180;
      const inner = 14;
      const outer = 20;
      return `<line x1="${(24 + Math.cos(radians) * inner).toFixed(1)}" y1="${(24 + Math.sin(radians) * inner).toFixed(1)}" x2="${(24 + Math.cos(radians) * outer).toFixed(1)}" y2="${(24 + Math.sin(radians) * outer).toFixed(1)}" />`;
    })
    .join('');
  const host = el('div', { class: 'sun-badge', role: 'img', 'aria-label': 'Solar-electric fleet' });
  host.innerHTML = `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="9" /><g class="sun-rays">${rays}</g></svg>`;
  return host;
}

export function lengthFigure(lengthM: number): string {
  return formatMeasurement(centimetresFromMetres(lengthM.toFixed(2)));
}

function rateText(yacht: PublicYacht, season: string): string {
  const { rates, currency } = yacht;
  if (season === 'high') return `${formatMoney(rates.highMinor, currency)} a week`;
  if (season === 'shoulder') return `${formatMoney(rates.shoulderMinor, currency)} a week`;
  if (season === 'low') return `${formatMoney(rates.lowMinor, currency)} a week`;
  return `From ${formatMoney(rates.lowMinor, currency)} a week`;
}

export async function publicFleetScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<(() => void) | void> {
  const workspaceSlug = context.params.ws;
  const filters = new URLSearchParams();
  for (const key of [...FILTER_KEYS, 'q']) {
    const value = context.query.get(key);
    if (value !== null && value !== '') filters.set(key, value);
  }
  const initial = await api.get<FleetBody>(`/api/public/fleets/${workspaceSlug}`);
  if (!initial.ok) {
    await notFoundScreen(host);
    return;
  }
  const page = publicPage(host, `${initial.data.workspace.name} fleet`);

  let weekOptions = [{ value: '', label: 'Any week' }];
  if (initial.data.yachts.length > 0) {
    const sample = await api.get<{ weeks: readonly { weekStart: string }[] }>(
      `/api/public/fleets/${workspaceSlug}/yachts/${initial.data.yachts[0].slug}`,
    );
    if (sample.ok) {
      weekOptions = [
        { value: '', label: 'Any week' },
        ...sample.data.weeks.map((week) => ({
          value: week.weekStart,
          label: `Week of ${formatDate(week.weekStart)}`,
        })),
      ];
    }
  }

  const search = el('input', {
    class: 'textbox searchbox',
    type: 'search',
    id: 'search-yachts',
    value: filters.get('q') ?? '',
  }) as HTMLInputElement;
  const searchField = el(
    'div',
    { class: 'search-field' },
    el('label', { class: 'field-label', for: 'search-yachts' }, 'Search yachts'),
    search,
  );
  const filtersButton = button('Filters');
  const yachts = stripList('Yachts', 'No yachts match.', 'Fleet position');
  const strip = createStrip({
    viewport: yachts.viewport,
    track: yachts.list,
    progress: yachts.progress,
  });

  const paint = (list: readonly PublicYacht[]): void => {
    const season = filters.get('season') ?? '';
    yachts.setItems(
      list.map((yacht) =>
        listItem(
          el(
            'article',
            { class: 'yacht-card' },
            hullDrawing(yacht.name, yacht.lengthM, yacht.beamM),
            el(
              'h3',
              { class: 'card-heading' },
              link(yacht.name, `/fleet/${workspaceSlug}/${yacht.slug}`),
            ),
            el('p', { class: 'card-line' }, yacht.base === 'split' ? 'Split' : 'Lavrio'),
            el('p', { class: 'card-line' }, `${yacht.cabins} cabins`),
            el('p', { class: 'card-figure' }, lengthFigure(yacht.lengthM)),
            el('p', { class: 'card-figure' }, rateText(yacht, season)),
          ),
        ),
      ),
    );
    yachts.progress.hidden = !isWide();
    strip.moveTo(0);
    strip.refresh();
  };

  const addressOf = (): string => {
    const query = new URLSearchParams();
    for (const key of [...FILTER_KEYS, 'q']) {
      const value = filters.get(key);
      if (value !== null && value !== '') query.set(key, value);
    }
    const text = query.toString();
    return `/fleet/${workspaceSlug}${text === '' ? '' : `?${text}`}`;
  };

  let loadToken = 0;
  const load = async (): Promise<void> => {
    const token = (loadToken += 1);
    const query = new URLSearchParams();
    for (const key of [...FILTER_KEYS, 'q']) {
      const value = filters.get(key);
      if (value !== null && value !== '') query.set(key, value);
    }
    const result = await api.get<FleetBody>(`/api/public/fleets/${workspaceSlug}?${query.toString()}`);
    if (token !== loadToken) return;
    paint(result.ok ? result.data.yachts : []);
  };

  search.addEventListener('input', () => {
    if (search.value === '') filters.delete('q');
    else filters.set('q', search.value);
    replacePath(addressOf());
    void load();
  });

  filtersButton.addEventListener('click', () => {
    openDialog({
      name: 'Filters',
      kind: 'sheet',
      opener: filtersButton,
      build: (handle) => {
        const controls: Record<string, HTMLSelectElement> = {
          base: combobox('Base', BASE_OPTIONS, filters.get('base') ?? ''),
          cabins: combobox('Cabins', CABIN_OPTIONS, filters.get('cabins') ?? ''),
          season: combobox('Season', SEASON_OPTIONS, filters.get('season') ?? ''),
          week: combobox('Week', weekOptions, filters.get('week') ?? ''),
        };
        for (const key of FILTER_KEYS) {
          controls[key].addEventListener('change', () => {
            if (controls[key].value === '') filters.delete(key);
            else filters.set(key, controls[key].value);
            pushPath(addressOf());
            void load();
          });
        }
        const show = button('Show yachts');
        show.addEventListener('click', () => handle.close());
        const reset = quietButton('Clear filters');
        reset.addEventListener('click', () => {
          for (const key of FILTER_KEYS) {
            filters.delete(key);
            controls[key].value = '';
          }
          pushPath(addressOf());
          void load();
        });
        return {
          body: [
            el(
              'div',
              { class: 'filter-fields' },
              el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Base'), controls.base),
              el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Cabins'), controls.cabins),
              el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Season'), controls.season),
              el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Week'), controls.week),
            ),
            el('div', { class: 'dialog-actions' }, show, reset),
          ],
          first: () => controls.base,
        };
      },
    });
  });

  page.main.append(
    el('div', { class: 'fleet-header' }, sunBadge(), el('div', { class: 'fleet-controls' }, searchField, filtersButton)),
    yachts.section,
  );
  paint(initial.data.yachts);
  if (filters.toString() !== '') void load();

  const onResize = (): void => {
    yachts.progress.hidden = !isWide();
    strip.refresh();
  };
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
  };
}
