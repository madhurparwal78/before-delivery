import { COPY, say } from '../../domain/copy.js';
import {
  announce,
  api,
  closeSurface,
  focusBack,
  focusHeading,
  go,
  openSurface,
  queryOf,
  redraw,
  refreshOnce,
  registerScreen,
  run,
  setQuery,
  state,
} from '../app.js';
import type { Surface } from '../app.js';
import type { Child } from '../dom.js';
import { h } from '../dom.js';
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
} from '../ui.js';
import { guard } from './clients.js';
import { jobNav, loadJob } from './job.js';
import type { Board } from './job.js';
import type { Job, Producer } from './jobs.js';

export type Cut = {
  id: string;
  number: number;
  name: string;
  frameRate: string;
  createdAt: string;
  signedOffAt: string | null;
  signedOffBy: string | null;
};

type Render = {
  id: string;
  cut: number;
  width: number;
  burnTimecode: boolean;
  state: string;
  progress: number;
  message: string | null;
  size: number | null;
  sha256: string | null;
  filmUrl: string | null;
  createdAt: string;
};

type Page = { id: string; producerId: string; cut: number; url: string; state: string; endsAt: string };

type HistoryEvent = { at: string; actor: string; action: string; text: string };

type CutsData = {
  job: Job;
  board: Board;
  cuts: Cut[];
  renders: Render[];
  busy: { until: string; message: string } | null;
  reviews: Page[];
  signOffs: Page[];
  events: HistoryEvent[];
  producers: Producer[];
};

const RENDER_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Queued',
  failed: 'Failed',
  ready: 'Ready',
  outdated: 'Outdated',
};

registerScreen({
  name: 'cuts',
  frame: 'desk',
  refreshes: true,
  heading: (raw) => `Cuts for ${(raw as unknown as CutsData).job?.title ?? ''}`,
  load: async () => {
    const jobId = state.screen.jobId ?? '';
    const job = await loadJob(jobId);
    const [board, cuts, renders, reviews, signOffs, history, producers] = await Promise.all([
      api<Board>(`/api/jobs/${jobId}/board`),
      api<{ cuts: Cut[] }>(`/api/jobs/${jobId}/cuts`),
      api<{ renders: Render[]; busy: { until: string; message: string } | null }>(
        `/api/jobs/${jobId}/renders`,
      ),
      api<{ reviews: Page[] }>(`/api/jobs/${jobId}/reviews`),
      api<{ signOffs: Page[] }>(`/api/jobs/${jobId}/sign-offs`),
      api<{ events: Event[] }>(`/api/jobs/${jobId}/history`),
      api<{ producers: Producer[] }>(`/api/clients/${job.clientId}/producers`),
    ]);
    return {
      job,
      board,
      cuts: cuts.cuts,
      renders: renders.renders,
      busy: renders.busy,
      reviews: reviews.reviews,
      signOffs: signOffs.signOffs,
      events: history.events,
      producers: producers.producers,
    } as unknown as Record<string, unknown>;
  },
  mainAction: () =>
    button({
      id: 'make-cut',
      label: 'Make cut',
      kind: 'primary',
      onPress: () => openSurface('Make cut', 'make-cut', { values: { name: '' } }),
    }),
  view: (raw) => {
    const data = raw as unknown as CutsData;
    if (state.loading || data.cuts === undefined) return [loadingBars('Reading the cuts')];
    return [
      jobNav(data.job.id, '/cuts'),
      problemsRegion(state.problems),
      data.cuts.length === 0
        ? emptyState('No cut made on this job yet.')
        : h(
            'ul',
            { key: 'cuts', class: 'list-plain' },
            ...data.cuts.map((cut) =>
              h(
                'li',
                { key: cut.id },
                h('h2', {}, `Cut ${cut.number} · ${cut.name}`),
                h('p', { class: 'numeric' }, `${cut.frameRate} fps`),
                cut.signedOffAt === null
                  ? null
                  : h('p', { 'data-part': 'signed-off' }, `Signed off by ${cut.signedOffBy}`),
                button({
                  id: `cut-actions-${cut.number}`,
                  label: `Actions for Cut ${cut.number}`,
                  extra: { 'aria-haspopup': 'menu' },
                  onPress: () => openCutMenu(data, cut),
                }),
              ),
            ),
          ),
      h(
        'section',
        {
          key: 'films',
          class: 'section',
          role: 'region',
          'aria-label': 'Preview films',
        },
        h('h2', {}, 'Preview films'),
        data.busy === null ? null : h('p', {}, data.busy.message),
        data.renders.length === 0
          ? h('p', {}, 'No film asked for yet.')
          : h(
              'ul',
              { class: 'list-plain' },
              ...data.renders.map((render) =>
                h(
                  'li',
                  { key: render.id },
                  h(
                    'p',
                    { 'data-part': 'film-state' },
                    `Cut ${render.cut} · ${render.width} · ${
                      render.state === 'running'
                        ? `Running ${render.progress}%`
                        : (RENDER_LABELS[render.state] ?? render.state)
                    }`,
                  ),
                  render.message === null ? null : h('p', {}, render.message),
                  render.filmUrl === null
                    ? null
                    : h(
                        'a',
                        { href: render.filmUrl, class: 'link', download: '' },
                        'Download film',
                      ),
                ),
              ),
            ),
      ),
      h(
        'section',
        {
          key: 'pages',
          class: 'section',
          role: 'region',
          'aria-label': 'Private pages',
        },
        h('h2', {}, 'Private pages'),
        [...data.reviews, ...data.signOffs].filter((page) => page.state === 'open').length === 0
          ? h('p', {}, 'No open page.')
          : h(
              'ul',
              { class: 'list-plain' },
              ...[...data.reviews, ...data.signOffs]
                .filter((page) => page.state === 'open')
                .map((page) =>
                  h(
                    'li',
                    { key: page.id },
                    h('p', {}, `Cut ${page.cut} · ${page.url}`),
                    button({
                      id: `end-page-${page.id}`,
                      label: 'End page',
                      pendingKey: `end-${page.id}`,
                      onPress: () =>
                        void run(`end-${page.id}`, async () => {
                          const kind = page.url.startsWith('/r/') ? 'reviews' : 'sign-offs';
                          await api(`/api/${kind}/${page.id}/end`, { method: 'POST' });
                          announce(COPY.pageEnded);
                          await refreshOnce();
                          focusHeading();
                        }),
                    }),
                  ),
                ),
            ),
      ),
      h(
        'section',
        { key: 'history', class: 'section', role: 'region', 'aria-label': 'Job history' },
        h('h2', {}, 'Job history'),
        data.events.length === 0
          ? h('p', {}, 'Nothing has happened on this job yet.')
          : h(
              'ol',
              { class: 'list-plain' },
              ...data.events.map((event, index) =>
                h(
                  'li',
                  { key: `${event.at}-${index}` },
                  h('p', { class: 'numeric' }, event.at),
                  h('p', {}, `${event.actor} · ${event.text}`),
                ),
              ),
            ),
      ),
    ];
  },
});

function openCutMenu(data: CutsData, cut: Cut): void {
  openMenu(`Actions for Cut ${cut.number}`, `cut-actions-${cut.number}`, [
    {
      label: 'Preview film',
      run: () =>
        openSurface('Preview film', `cut-actions-${cut.number}`, {
          values: { cut: String(cut.number), width: '1280', burn: 'true' },
        }),
    },
    {
      label: 'Send review page',
      run: () =>
        openSurface('Send review page', `cut-actions-${cut.number}`, {
          values: {
            cut: String(cut.number),
            producerId: data.producers[0]?.id ?? '',
          },
        }),
    },
    {
      label: 'Ask for sign-off',
      run: () =>
        openSurface('Ask for sign-off', `cut-actions-${cut.number}`, {
          values: {
            cut: String(cut.number),
            producerId: data.producers[0]?.id ?? '',
          },
        }),
    },
    {
      label: 'Compare',
      run: () =>
        void go(
          `/desk/jobs/${data.job.id}/compare?a=${Math.max(1, cut.number - 1)}&b=${
            cut.number
          }&wipe=50`,
        ),
    },
    {
      label: 'Bring back',
      run: () =>
        void run(`bring-back-${cut.number}`, async () => {
          await api(`/api/jobs/${data.job.id}/cuts/${cut.number}/bring-back`, {
            method: 'POST',
            body: { stamp: data.board.stamp },
          });
          announce(say.cutBroughtBack(cut.number));
          await refreshOnce();
          focusBack(`cut-actions-${cut.number}`);
        }),
    },
    {
      label: 'Rename',
      run: () =>
        openSurface(`Rename Cut ${cut.number}`, `cut-actions-${cut.number}`, {
          values: { cut: String(cut.number), name: cut.name },
        }),
    },
    {
      label: 'Delete',
      run: () =>
        void run(`delete-cut-${cut.number}`, async () => {
          try {
            await api(`/api/jobs/${data.job.id}/cuts/${cut.number}`, { method: 'DELETE' });
            announce(say.cutDeleted(cut.number));
            await refreshOnce();
            focusHeading();
          } catch (error) {
            const failure = error as { failure?: { message: string } };
            if (failure.failure !== undefined) {
              state.problems = { cut: failure.failure.message };
              announce(failure.failure.message);
              redraw();
              return;
            }
            throw error;
          }
        }),
    },
  ]);
}

registerSurface('Make cut', (surface) => {
  const data = state.data as unknown as CutsData;
  return surfaceView(surface, {
    title: 'Make cut',
    body: [
      problemsRegion(surface.problems, { withLinks: false, message: surface.message }),
      field({
        id: 'cut-name',
        label: 'Name',
        value: surface.values['name'] ?? '',
        onInput: (value) => {
          surface.values['name'] = value;
          redraw();
        },
        problem: surface.problems['name'],
      }),
    ],
    footer: [
      button({
        id: 'save-cut',
        label: 'Save',
        kind: 'primary',
        pendingKey: 'make-cut',
        onPress: () =>
          void run(
            'make-cut',
            guard(surface, async () => {
              const made = await api<Cut>(`/api/jobs/${data.job.id}/cuts`, {
                method: 'POST',
                body: { name: surface.values['name'] ?? '' },
              });
              closeSurface('Make cut');
              announce(say.cutMade(made.number));
              await refreshOnce();
              focusBack('make-cut');
            }),
          ),
      }),
    ],
  });
});

registerSurface('Rename Cut', (surface) => {
  const data = state.data as unknown as CutsData;
  const number = Number(surface.values['cut'] ?? '0');
  return surfaceView(surface, {
    title: `Rename Cut ${number}`,
    body: [
      problemsRegion(surface.problems, { withLinks: false, message: surface.message }),
      field({
        id: 'rename-cut-name',
        label: 'Name',
        value: surface.values['name'] ?? '',
        onInput: (value) => {
          surface.values['name'] = value;
          redraw();
        },
        problem: surface.problems['name'],
      }),
    ],
    footer: [
      button({
        id: 'save-rename-cut',
        label: 'Save',
        kind: 'primary',
        pendingKey: `rename-${number}`,
        onPress: () =>
          void run(
            `rename-${number}`,
            guard(surface, async () => {
              await api(`/api/jobs/${data.job.id}/cuts/${number}`, {
                method: 'PATCH',
                body: { name: surface.values['name'] ?? '' },
              });
              closeSurface(`Rename Cut ${number}`);
              announce(say.cutSaved(number));
              await refreshOnce();
            }),
          ),
      }),
    ],
  });
});

registerSurface('Preview film', (surface) => {
  const data = state.data as unknown as CutsData;
  const number = Number(surface.values['cut'] ?? '0');
  return surfaceView(surface, {
    title: 'Preview film',
    body: [
      problemsRegion(surface.problems, { withLinks: false, message: surface.message }),
      h(
        'div',
        { class: 'radio-row', role: 'radiogroup', 'aria-label': 'Width' },
        ...['640', '1280'].map((width) =>
          h(
            'label',
            { key: width, class: 'radio' },
            h('input', {
              type: 'radio',
              name: 'film-width',
              checked: (surface.values['width'] ?? '1280') === width,
              onchange: () => {
                surface.values['width'] = width;
                redraw();
              },
            }),
            h('span', {}, width),
          ),
        ),
      ),
      h(
        'label',
        { class: 'checkbox' },
        h('input', {
          type: 'checkbox',
          checked: (surface.values['burn'] ?? 'true') === 'true',
          onchange: (event: globalThis.Event) => {
            surface.values['burn'] = (event.target as HTMLInputElement).checked
              ? 'true'
              : 'false';
            redraw();
          },
        }),
        h('span', {}, 'Burn in timecode'),
      ),
    ],
    footer: [
      button({
        id: 'ask-for-film',
        label: 'Ask for film',
        kind: 'primary',
        pendingKey: 'film',
        onPress: () =>
          void run(
            'film',
            guard(surface, async () => {
              const asked = await api<Render>(`/api/jobs/${data.job.id}/renders`, {
                method: 'POST',
                body: {
                  cut: number,
                  width: Number(surface.values['width'] ?? '1280'),
                  burnTimecode: (surface.values['burn'] ?? 'true') === 'true',
                },
              });
              closeSurface('Preview film');
              announce(asked.state === 'queued' ? COPY.filmAsked : COPY.filmStored);
              await refreshOnce();
            }),
          ),
      }),
    ],
  });
});

for (const [name, path, copy] of [
  ['Send review page', 'reviews', 'review'],
  ['Ask for sign-off', 'sign-offs', 'sign-off'],
] as const) {
  registerSurface(name, (surface) => pageDialog(surface, name, path, copy));
}

function pageDialog(
  surface: Surface,
  title: string,
  path: 'reviews' | 'sign-offs',
  kind: 'review' | 'sign-off',
): Child {
  const data = state.data as unknown as CutsData;
  return surfaceView(surface, {
    title,
    body: [
      problemsRegion(surface.problems, { withLinks: false, message: surface.message }),
      combobox({
        id: 'page-producer',
        label: 'Producer',
        value: surface.values['producerId'] ?? '',
        options: (data.producers ?? []).map((producer) => ({
          value: producer.id,
          label: producer.name,
        })),
        onChange: (value) => {
          surface.values['producerId'] = value;
          redraw();
        },
        problem: surface.problems['producerId'],
      }),
    ],
    footer: [
      button({
        id: 'send-page',
        label: 'Send',
        kind: 'primary',
        pendingKey: `page-${path}`,
        onPress: () =>
          void run(
            `page-${path}`,
            guard(surface, async () => {
              const producerId = surface.values['producerId'] ?? '';
              await api(`/api/jobs/${data.job.id}/${path}`, {
                method: 'POST',
                body: { producerId, cut: Number(surface.values['cut'] ?? '0') },
              });
              const producer = data.producers.find(
                (candidate) => candidate.id === producerId,
              );
              closeSurface(title);
              announce(
                kind === 'review'
                  ? say.reviewReady(producer?.name ?? '')
                  : say.signOffReady(producer?.name ?? ''),
              );
              await refreshOnce();
            }),
          ),
      }),
    ],
  });
}

/** Compare reveals one cut's frame over the other's by clip. */
type CompareData = {
  job: Job;
  cuts: Cut[];
  differences: string[];
  a: Cut & { frames: { number: number; drawingUrl: string | null }[] };
  b: Cut & { frames: { number: number; drawingUrl: string | null }[] };
};

let compareFrame = 0;

registerScreen({
  name: 'compare',
  frame: 'desk',
  refreshes: true,
  heading: (raw) => `Compare cuts for ${(raw as unknown as CompareData).job?.title ?? ''}`,
  load: async () => {
    const jobId = state.screen.jobId ?? '';
    const job = await loadJob(jobId);
    const cuts = await api<{ cuts: Cut[] }>(`/api/jobs/${jobId}/cuts`);
    const first = queryOf().get('a') ?? String(cuts.cuts[0]?.number ?? 1);
    const second = queryOf().get('b') ?? String(cuts.cuts[cuts.cuts.length - 1]?.number ?? 1);
    const answer = await api<Omit<CompareData, 'job' | 'cuts'>>(
      `/api/jobs/${jobId}/compare?a=${first}&b=${second}`,
    );
    return { job, cuts: cuts.cuts, ...answer } as unknown as Record<string, unknown>;
  },
  mainAction: (raw) => {
    const data = raw as unknown as CompareData;
    if (data.b === undefined) return null;
    return h(
      'div',
      { class: 'pair' },
      button({
        id: 'earlier-frame',
        label: 'Earlier frame',
        onPress: () => {
          compareFrame = Math.max(0, compareFrame - 1);
          redraw();
        },
      }),
      button({
        id: 'later-frame',
        label: 'Later frame',
        onPress: () => {
          compareFrame = Math.min(data.b.frames.length - 1, compareFrame + 1);
          redraw();
        },
      }),
      wipeSlider(),
    );
  },
  view: (raw) => {
    const data = raw as unknown as CompareData;
    if (state.loading || data.b === undefined) return [loadingBars('Comparing the cuts')];
    const wipe = Number(queryOf().get('wipe') ?? '50');
    const cutOptions = data.cuts.map((cut) => ({
      value: String(cut.number),
      label: `Cut ${cut.number}`,
    }));
    return [
      jobNav(data.job.id, '/cuts'),
      h(
        'div',
        { key: 'pickers', class: 'filters filters--inline' },
        combobox({
          id: 'first-cut',
          label: 'First cut',
          value: String(data.a.number),
          options: cutOptions,
          onChange: (value) => setQuery({ a: value }),
        }),
        combobox({
          id: 'second-cut',
          label: 'Second cut',
          value: String(data.b.number),
          options: cutOptions,
          onChange: (value) => setQuery({ b: value }),
        }),
      ),
      h(
        'div',
        { key: 'pair', class: 'compare__pair' },
        ...data.b.frames.map((frame, index) => {
          const older = data.a.frames.find((candidate) => candidate.number === frame.number);
          return h(
            'div',
            {
              key: `compare-${frame.number}`,
              class: 'compare__clip',
              'data-part': 'compare-clip',
              'data-frame': String(frame.number),
              hidden: window.innerWidth < 768 && index !== compareFrame,
            },
            older?.drawingUrl === null || older === undefined
              ? null
              : h('img', { src: older.drawingUrl, alt: '' }),
            frame.drawingUrl === null
              ? null
              : h(
                  'span',
                  {
                    class: 'compare__reveal',
                    style: `clip-path:inset(0 ${100 - wipe}% 0 0)`,
                  },
                  h('img', { src: frame.drawingUrl, alt: '' }),
                ),
          );
        }),
      ),
      h('div', { key: 'wipe-inline', class: 'panel' }, wipeSlider()),
      h(
        'section',
        { key: 'differences', class: 'section' },
        h('h2', {}, 'Differences'),
        data.differences.length === 0
          ? h('p', {}, COPY.cutsSame)
          : h(
              'ul',
              { class: 'list-plain', 'aria-label': 'Differences' },
              ...data.differences.map((line, index) =>
                h('li', { key: `difference-${index}` }, line),
              ),
            ),
      ),
    ];
  },
});

function wipeSlider(): Child {
  const wipe = Number(queryOf().get('wipe') ?? '50');
  return h(
    'div',
    { key: 'wipe', class: 'field' },
    h('label', { class: 'field__label', for: 'wipe' }, 'Wipe'),
    h('input', {
      id: 'wipe',
      type: 'range',
      class: 'slider',
      min: '0',
      max: '100',
      step: '1',
      value: String(wipe),
      'aria-valuetext': `${wipe}%`,
      oninput: (event: globalThis.Event) => {
        setQuery({ wipe: (event.target as HTMLInputElement).value });
      },
    }),
  );
}
