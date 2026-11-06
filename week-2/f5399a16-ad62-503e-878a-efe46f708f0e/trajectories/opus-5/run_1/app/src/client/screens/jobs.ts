import { COPY, LABELS, say } from '../../domain/copy.js';
import {
  announce,
  api,
  closeSurface,
  focusBack,
  focusHeading,
  go,
  isRefusal,
  openSurface,
  queryOf,
  redraw,
  registerScreen,
  run,
  setQuery,
  refreshOnce,
  state,
} from '../app.js';
import type { Surface } from '../app.js';
import type { Child } from '../dom.js';
import { h } from '../dom.js';
import { setFilterBody } from '../filters.js';
import { registerSurface } from '../shell.js';
import {
  button,
  combobox,
  emptyState,
  field,
  link,
  loadingBars,
  openMenu,
  problemsRegion,
  surfaceView,
  tableFrame,
} from '../ui.js';

export type Job = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  adId: string;
  dueDate: string;
  targetSeconds: number;
  frameRate: string;
  aspect: string;
  state: string;
  createdAt: string;
};

export type Client = {
  id: string;
  name: string;
  place: string;
  state: string;
  closesAt: string | null;
  createdAt: string;
};

export type Producer = {
  id: string;
  clientId: string;
  name: string;
  email: string;
  town: string;
  language: string;
};

type SearchAnswer = {
  jobs: { id: string; title: string }[];
  clients: { id: string; name: string }[];
  producers: { id: string; name: string; clientId: string }[];
  total: number;
};

let searchText = '';
let searchAnswer: SearchAnswer | null = null;
let searchTimer: number | null = null;
let searchRun = 0;

/** Search waits a 300 ms pause, then shows the answer for the latest input. */
function typeSearch(value: string): void {
  searchText = value;
  if (searchTimer !== null) window.clearTimeout(searchTimer);
  if (value.trim() === '') {
    searchAnswer = null;
    redraw();
    return;
  }
  searchTimer = window.setTimeout(() => {
    const run = ++searchRun;
    void api<SearchAnswer>(`/api/search?q=${encodeURIComponent(value)}`).then(
      (answer) => {
        if (run !== searchRun) return;
        searchAnswer = answer;
        announce(say.searchResults(answer.total));
        redraw();
      },
      () => undefined,
    );
  }, 300);
}

const STATE_OPTIONS = [
  { value: '', label: 'All states' },
  ...Object.entries(LABELS.jobState).map(([value, label]) => ({ value, label })),
];

const RATE_OPTIONS = [
  { value: '', label: 'All frame rates' },
  ...Object.entries(LABELS.frameRate).map(([value, label]) => ({ value, label })),
];

const TARGET_OPTIONS = Object.entries(LABELS.targetSeconds).map(([value, label]) => ({
  value,
  label,
}));

const ASPECT_OPTIONS = Object.entries(LABELS.aspect).map(([value, label]) => ({
  value,
  label,
}));

function clientOptions(clients: Client[], withAll: boolean): { value: string; label: string }[] {
  const options = clients.map((client) => ({ value: client.id, label: client.name }));
  return withAll ? [{ value: '', label: 'All clients' }, ...options] : options;
}

function filterControls(clients: Client[], inSheet: boolean): Child {
  const query = queryOf();
  const suffix = inSheet ? '-sheet' : '';
  return h(
    'div',
    { key: `filters${suffix}`, class: `filters${inSheet ? '' : ' filters--inline'}` },
    combobox({
      id: `filter-client${suffix}`,
      label: 'Client',
      value: query.get('client') ?? '',
      options: clientOptions(clients, true),
      onChange: (value) => setQuery({ client: value === '' ? null : value, cursor: null }),
    }),
    combobox({
      id: `filter-state${suffix}`,
      label: 'State',
      value: query.get('state') ?? '',
      options: STATE_OPTIONS,
      onChange: (value) => setQuery({ state: value === '' ? null : value, cursor: null }),
    }),
    combobox({
      id: `filter-rate${suffix}`,
      label: 'Frame rate',
      value: query.get('frameRate') ?? '',
      options: RATE_OPTIONS,
      onChange: (value) => setQuery({ frameRate: value === '' ? null : value, cursor: null }),
    }),
    combobox({
      id: `filter-sort${suffix}`,
      label: 'Sort by',
      value: query.get('sort') ?? 'dueDate',
      options: Object.entries(LABELS.sort).map(([value, label]) => ({ value, label })),
      onChange: (value) => setQuery({ sort: value, cursor: null }),
    }),
  );
}

type JobsData = { jobs: Job[]; total: number; nextCursor: string | null; clients: Client[] };

registerScreen({
  name: 'jobs',
  frame: 'desk',
  refreshes: true,
  heading: () => 'Jobs',
  load: async () => {
    const query = new URLSearchParams();
    for (const name of ['state', 'frameRate', 'sort', 'cursor']) {
      const value = queryOf().get(name);
      if (value !== null) query.set(name, value);
    }
    const client = queryOf().get('client');
    if (client !== null) query.set('clientId', client);
    const [list, clients] = await Promise.all([
      api<{ jobs: Job[]; total: number; nextCursor: string | null }>(
        `/api/jobs?${query.toString()}`,
      ),
      api<{ clients: Client[] }>('/api/clients'),
    ]);
    return { ...list, clients: clients.clients } as unknown as Record<string, unknown>;
  },
  mainAction: (data) =>
    button({
      id: 'new-job',
      label: 'New job',
      kind: 'primary',
      onPress: () =>
        openSurface('New job', 'new-job', {
          values: {
            clientId: (data as unknown as JobsData).clients[0]?.id ?? '',
            targetSeconds: '30',
            frameRate: '25',
            aspect: '16:9',
          },
        }),
    }),
  view: (raw) => {
    const data = raw as unknown as JobsData;
    if (state.loading) return [loadingBars('Reading the jobs')];
    return [
      h(
        'div',
        { key: 'search', class: 'field' },
        h('label', { class: 'field__label', for: 'search-jobs' }, 'Search jobs and clients'),
        h('input', {
          id: 'search-jobs',
          type: 'search',
          role: 'searchbox',
          class: 'input',
          value: searchText,
          oninput: (event: Event) => typeSearch((event.target as HTMLInputElement).value),
        }),
        searchAnswer === null
          ? null
          : h(
              'ul',
              { class: 'list-plain', 'aria-label': 'Search results' },
              ...searchAnswer.jobs.map((job) =>
                h('li', { key: `job-${job.id}` }, link(`/desk/jobs/${job.id}`, job.title)),
              ),
              ...searchAnswer.clients.map((client) =>
                h(
                  'li',
                  { key: `client-${client.id}` },
                  link(`/desk/clients/${client.id}`, client.name),
                ),
              ),
              ...searchAnswer.producers.map((producer) =>
                h(
                  'li',
                  { key: `producer-${producer.id}` },
                  link(`/desk/clients/${producer.clientId}`, producer.name),
                ),
              ),
            ),
      ),
      h(
        'div',
        { key: 'filter-switch', class: 'pair' },
        button({
          id: 'filters',
          label: 'Filters',
          onPress: () =>
            openSurface('Filters', 'filters', { kind: 'sheet', sheet: 'filters' }),
          extra: { class: 'button button--plain filters-button' },
        }),
      ),
      filterControls(data.clients, false),
      data.jobs.length === 0
        ? emptyState('No job matches this desk and these filters yet.')
        : tableFrame(
            'Jobs table',
            h(
              'table',
              {},
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  h('th', { scope: 'col' }, 'Title'),
                  h('th', { scope: 'col' }, 'Client'),
                  h('th', { scope: 'col' }, 'State'),
                  h('th', { scope: 'col' }, 'Frame rate'),
                  h('th', { scope: 'col' }, 'Due date'),
                  h('th', { scope: 'col' }, 'Actions'),
                ),
              ),
              h(
                'tbody',
                {},
                ...data.jobs.map((job) =>
                  h(
                    'tr',
                    { key: job.id },
                    h(
                      'td',
                      {},
                      link(`/desk/jobs/${job.id}`, job.title, {
                        id: `job-link-${job.id}`,
                        onclick: () => {
                          sessionStorage.setItem('clapstick-left-job', job.id);
                        },
                      }),
                    ),
                    h('td', {}, job.clientName),
                    h('td', {}, LABELS.jobState[job.state as keyof typeof LABELS.jobState]),
                    h('td', { class: 'numeric' }, job.frameRate),
                    h('td', { class: 'numeric' }, job.dueDate),
                    h(
                      'td',
                      {},
                      button({
                        id: `actions-${job.id}`,
                        label: `Actions for ${job.title}`,
                        extra: { 'aria-haspopup': 'menu' },
                        onPress: () => openRowMenu(job),
                      }),
                    ),
                  ),
                ),
              ),
            ),
          ),
      h(
        'div',
        { key: 'paging', class: 'pair' },
        queryOf().get('cursor') === null
          ? null
          : h(
              'a',
              {
                href: pageAddress(previousCursor()),
                class: 'link',
                onclick: (event: globalThis.Event) => {
                  event.preventDefault();
                  seenCursors.pop();
                  setQuery({ cursor: previousCursor() });
                },
              },
              'Previous page',
            ),
        data.nextCursor === null
          ? null
          : h(
              'a',
              {
                href: pageAddress(data.nextCursor),
                class: 'link',
                onclick: (event: globalThis.Event) => {
                  event.preventDefault();
                  const here = queryOf().get('cursor');
                  if (here !== null && seenCursors[seenCursors.length - 1] !== here) {
                    seenCursors.push(here);
                  }
                  setQuery({ cursor: data.nextCursor });
                },
              },
              'Next page',
            ),
      ),
    ];
  },
});

/** The cursors walked so far, so Previous page is one history entry back. */
const seenCursors: string[] = [];

function previousCursor(): string | null {
  return seenCursors[seenCursors.length - 1] ?? null;
}

function pageAddress(cursor: string | null): string {
  const query = new URLSearchParams(queryOf());
  if (cursor === null) query.delete('cursor');
  else query.set('cursor', cursor);
  const search = query.toString();
  return `/desk/jobs${search === '' ? '' : `?${search}`}`;
}

function openRowMenu(job: Job): void {
  openMenu(`Actions for ${job.title}`, `actions-${job.id}`, [
    { label: 'Open', run: () => void go(`/desk/jobs/${job.id}`) },
    {
      label: 'Duplicate',
      run: () =>
        void run(`duplicate-${job.id}`, async () => {
          const made = await api<Job>(`/api/jobs/${job.id}/duplicate`, { method: 'POST' });
          announce(COPY.jobDuplicated);
          await refreshOnce();
          focusBack(`actions-${made.id}`);
        }),
    },
    {
      label: 'Archive',
      run: () =>
        void run(`archive-${job.id}`, async () => {
          await api(`/api/jobs/${job.id}/archive`, { method: 'POST' });
          announce(say.archived(job.title));
          await refreshOnce();
          focusHeading();
        }),
    },
  ]);
}

setFilterBody('jobs', () =>
  filterControls((state.data as unknown as JobsData).clients ?? [], true),
);

registerSurface('New job', (surface) => newJobDialog(surface));

function newJobDialog(surface: Surface): Child {
  const data = state.data as unknown as JobsData;
  const set = (name: string) => (value: string) => {
    surface.values[name] = value;
    redraw();
  };
  return surfaceView(surface, {
    title: 'New job',
    body: [
      problemsRegion(surface.problems, { withLinks: false, message: surface.message }),
      combobox({
        id: 'job-client',
        label: 'Client',
        value: surface.values['clientId'] ?? '',
        options: clientOptions(data.clients ?? [], false),
        onChange: set('clientId'),
        problem: surface.problems['clientId'],
      }),
      field({
        id: 'job-title',
        label: 'Title',
        value: surface.values['title'] ?? '',
        onInput: set('title'),
        problem: surface.problems['title'],
      }),
      field({
        id: 'job-adId',
        label: 'Ad-ID',
        value: surface.values['adId'] ?? '',
        onInput: set('adId'),
        problem: surface.problems['adId'],
      }),
      field({
        id: 'job-dueDate',
        label: 'Due date',
        value: surface.values['dueDate'] ?? '',
        onInput: set('dueDate'),
        problem: surface.problems['dueDate'],
      }),
      combobox({
        id: 'job-targetSeconds',
        label: 'Target length',
        value: surface.values['targetSeconds'] ?? '30',
        options: TARGET_OPTIONS,
        onChange: set('targetSeconds'),
      }),
      combobox({
        id: 'job-frameRate',
        label: 'Frame rate',
        value: surface.values['frameRate'] ?? '25',
        options: Object.entries(LABELS.frameRate).map(([value, label]) => ({ value, label })),
        onChange: set('frameRate'),
      }),
      combobox({
        id: 'job-aspect',
        label: 'Aspect',
        value: surface.values['aspect'] ?? '16:9',
        options: ASPECT_OPTIONS,
        onChange: set('aspect'),
      }),
    ],
    footer: [
      button({
        id: 'save-job',
        label: 'Save',
        kind: 'primary',
        pendingKey: 'new-job',
        onPress: () =>
          void run('new-job', async () => {
            surface.problems = {};
            surface.message = null;
            try {
              const made = await api<Job>('/api/jobs', {
                method: 'POST',
                body: {
                  clientId: surface.values['clientId'] ?? '',
                  title: surface.values['title'] ?? '',
                  adId: surface.values['adId'] ?? '',
                  dueDate: surface.values['dueDate'] ?? '',
                  targetSeconds: Number(surface.values['targetSeconds'] ?? '30'),
                  frameRate: surface.values['frameRate'] ?? '25',
                  aspect: surface.values['aspect'] ?? '16:9',
                },
              });
              closeSurface('New job');
              announce(COPY.jobAdded);
              await go(`/desk/jobs/${made.id}`);
            } catch (error) {
              if (isRefusal(error)) {
                surface.problems = error.failure.fields;
                surface.message = error.failure.message;
                announce(error.failure.message);
                redraw();
                requestAnimationFrame(() => {
                  document
                    .querySelector<HTMLElement>('[data-surface-name="New job"] .problems')
                    ?.focus();
                });
                return;
              }
              throw error;
            }
          }),
      }),
    ],
  });
}
