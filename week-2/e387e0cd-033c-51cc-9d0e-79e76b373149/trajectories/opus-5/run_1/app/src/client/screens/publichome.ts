import { directoryStatusCopy } from '../../shared/copy';
import { get } from '../api';
import { button, element, heading } from '../dom';
import { showDate, showMoney } from '../format';
import { Cleanup, pushQuery, replaceQuery, RouteContext } from '../router';
import { Dialog } from '../ui/dialog';
import { Choice, radioGroup } from '../ui/fields';
import { publicFrame } from '../ui/publicframe';

interface JurisdictionBody {
  code: string;
  name: string;
  region: string;
  currency: string;
  status: string;
  thresholdCents: number | null;
  inForceSince: string | null;
  announcedChange: { thresholdCents: number; takesEffectOn: string } | null;
}

interface ExchangeBody {
  slug: string;
  name: string;
  jurisdictionCode: string;
  region: string;
  status: string;
  onNetwork: boolean;
}

const REGIONS: readonly Choice[] = [
  { value: '', label: 'All regions' },
  { value: 'europe', label: 'Europe' },
  { value: 'asia_pacific', label: 'Asia Pacific' },
  { value: 'middle_east', label: 'Middle East' },
  { value: 'americas', label: 'Americas' },
  { value: 'africa', label: 'Africa' },
];

const STATUSES: readonly Choice[] = [
  { value: '', label: 'Any status' },
  { value: 'in_force', label: 'In force' },
  { value: 'announced', label: 'Announced' },
  { value: 'no_rule', label: 'No rule' },
];

export const STATUS_TEXT: Readonly<Record<string, string>> = {
  in_force: 'In force',
  announced: 'Announced',
  no_rule: 'No rule',
};

export function jurisdictionCard(body: JurisdictionBody): HTMLElement {
  const threshold =
    body.thresholdCents === null
      ? 'No threshold in force'
      : showMoney(body.currency, body.thresholdCents);
  const date = body.inForceSince === null ? 'Not in force' : `Since ${showDate(body.inForceSince)}`;
  const children: Array<Node> = [
    element('a', {
      text: body.name,
      className: 'card-title control link',
      attributes: { href: `/jurisdictions/${body.code}` },
    }),
    element('p', { text: STATUS_TEXT[body.status] ?? body.status, className: 'card-status' }),
    element('p', { text: threshold, className: 'card-value mono' }),
    element('p', { text: date, className: 'card-date mono' }),
  ];
  if (body.announcedChange !== null) {
    children.push(
      element('p', {
        text: `Announced: ${showMoney(body.currency, body.announcedChange.thresholdCents)} from ${showDate(body.announcedChange.takesEffectOn)}`,
        className: 'card-change mono',
      }),
    );
  }
  return element('li', { className: 'card rise', children });
}

export function exchangeCard(body: ExchangeBody): HTMLElement {
  return element('li', {
    className: 'card rise',
    children: [
      element('a', {
        text: body.name,
        className: 'card-title control link',
        attributes: { href: `/exchanges/${body.slug}` },
      }),
      element('p', { text: body.jurisdictionCode, className: 'card-status mono' }),
      element('p', {
        text: body.onNetwork ? 'On the message network' : 'Off the message network',
        className: 'card-network',
      }),
    ],
  });
}

function searchParams(region: string, status: string, query: string): string {
  const parts = new URLSearchParams();
  if (region !== '') parts.set('region', region);
  if (status !== '') parts.set('status', status);
  if (query !== '') parts.set('q', query);
  const text = parts.toString();
  return text === '' ? '' : `?${text}`;
}

export async function publicHome(host: HTMLElement, context: RouteContext): Promise<Cleanup> {
  const frame = await publicFrame(host);
  let region = context.url.searchParams.get('region') ?? '';
  let status = context.url.searchParams.get('status') ?? '';
  let search = context.url.searchParams.get('q') ?? '';
  let committed = search;

  const jurisdictionList = element('ul', {
    className: 'card-list',
    attributes: { role: 'list', 'aria-label': 'Jurisdictions' },
  });
  const exchangeList = element('ul', {
    className: 'card-list',
    attributes: { role: 'list', 'aria-label': 'Listed exchanges' },
  });

  let latest = 0;
  const load = async (announce: boolean): Promise<void> => {
    latest += 1;
    const mine = latest;
    const query = searchParams(region, status, search);
    const [jurisdictions, exchanges] = await Promise.all([
      get<{ jurisdictions: JurisdictionBody[] }>(`/api/public/jurisdictions${query}`),
      get<{ exchanges: ExchangeBody[] }>(`/api/public/exchanges${query}`),
    ]);
    if (mine !== latest) return;
    jurisdictionList.replaceChildren(...jurisdictions.jurisdictions.map(jurisdictionCard));
    exchangeList.replaceChildren(...exchanges.exchanges.map(exchangeCard));
    if (announce) frame.status.say(directoryStatusCopy(exchanges.exchanges.length));
  };

  const buildFilters = (inSheet: boolean): {
    node: HTMLElement;
    focusFirst: () => void;
  } => {
    const regionGroup = radioGroup('Region', 'region', REGIONS, region);
    const statusGroup = radioGroup('Status', 'status', STATUSES, status);
    const searchBox = element('input', {
      className: 'control text-input',
      attributes: { type: 'search', role: 'searchbox', 'aria-label': 'Search exchanges' },
    });
    searchBox.value = search;
    regionGroup.node.addEventListener('change', () => {
      region = regionGroup.value();
      committed = search;
      pushQuery(searchParams(region, status, search));
      void load(true);
    });
    statusGroup.node.addEventListener('change', () => {
      status = statusGroup.value();
      committed = search;
      pushQuery(searchParams(region, status, search));
      void load(true);
    });
    searchBox.addEventListener('input', () => {
      search = searchBox.value;
      replaceQuery(searchParams(region, status, search));
      void load(true);
    });
    const commit = (): void => {
      if (search === committed) return;
      // The entry the visitor was on keeps the text it was committed with, so
      // Back lands on the previous committed choice.
      replaceQuery(searchParams(region, status, committed));
      committed = search;
      pushQuery(searchParams(region, status, search));
    };
    searchBox.addEventListener('change', commit);
    searchBox.addEventListener('blur', commit);
    searchBox.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
    });
    const children: Array<Node> = [
      element('h2', { text: 'Filters', className: inSheet ? 'dialog-title' : 'panel-title' }),
      regionGroup.node,
      statusGroup.node,
      element('div', {
        className: 'field',
        children: [element('span', { text: 'Search exchanges', className: 'field-label' }), searchBox],
      }),
    ];
    return {
      node: element('div', { className: 'filter-panel', children }),
      focusFirst: () => regionGroup.focusFirst(),
    };
  };

  const rail = buildFilters(false);
  let sheet: Dialog | null = null;
  const filtersButton = button('Filters', () => {
    if (sheet === null) {
      sheet = new Dialog(frame.layer, {
        name: 'Filters',
        style: 'bottom-sheet',
        build: (controller) => {
          const built = buildFilters(true);
          const done = button('Show results', () => controller.close());
          built.node.append(done);
          return { body: [built.node], first: () => null };
        },
      });
    }
    sheet.open(filtersButton);
    window.setTimeout(() => {
      const first = frame.layer.querySelector<HTMLElement>('.filter-panel input');
      first?.focus();
    }, 0);
  }, { className: 'control filters-button' });

  frame.main.append(
    heading(1, 'Every withdrawal, answered before it leaves', 'public-title'),
    element('div', {
      className: 'directory',
      children: [
        element('div', { className: 'filter-rail', children: [filtersButton, rail.node] }),
        element('div', {
          className: 'directory-lists',
          children: [
            element('section', {
              className: 'directory-column',
              children: [element('h2', { text: 'Jurisdictions' }), jurisdictionList],
            }),
            element('section', {
              className: 'directory-column',
              children: [element('h2', { text: 'Listed exchanges' }), exchangeList],
            }),
          ],
        }),
      ],
    }),
  );

  await load(false);
  return () => {
    sheet?.destroy();
    frame.destroy();
  };
}
