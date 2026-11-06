import { LABELS, say } from '../../domain/copy.js';
import {
  announce,
  api,
  closeSurface,
  focusBack,
  focusHeading,
  openSurface,
  redraw,
  refreshOnce,
  registerScreen,
  run,
  state,
} from '../app.js';
import type { Surface } from '../app.js';
import type { Child } from '../dom.js';
import { h } from '../dom.js';
import { registerSurface } from '../shell.js';
import { button, combobox, emptyState, field, loadingBars, problemsRegion, surfaceView } from '../ui.js';
import { guard } from './clients.js';
import { jobNav, loadJob } from './job.js';
import type { Job } from './jobs.js';

type Cue = {
  id: string;
  trackId: string;
  title: string;
  composer: string;
  seconds: number;
  market: string;
  from: string;
  until: string;
  fee: string;
  licenceId: string;
  licenceText: string;
};

type Track = { id: string; title: string; composer: string; seconds: number };

type CuesData = { job: Job; cues: Cue[] };

let tracks: Track[] = [];
let nextCursor: string | null = null;
let searchRun = 0;
let listOpen = false;
let activeTrack = 0;

registerScreen({
  name: 'cues',
  frame: 'desk',
  refreshes: true,
  heading: (raw) => `Cues for ${(raw as unknown as CuesData).job?.title ?? ''}`,
  load: async () => {
    const jobId = state.screen.jobId ?? '';
    const [job, cues] = await Promise.all([
      loadJob(jobId),
      api<{ cues: Cue[] }>(`/api/jobs/${jobId}/cues`),
    ]);
    return { job, cues: cues.cues } as unknown as Record<string, unknown>;
  },
  mainAction: () =>
    button({
      id: 'add-cue',
      label: 'Add cue',
      kind: 'primary',
      onPress: () => {
        tracks = [];
        nextCursor = null;
        listOpen = false;
        openSurface('Add cue', 'add-cue', {
          kind: 'sheet',
          values: { market: 'NL', from: '', until: '', search: '' },
        });
      },
    }),
  view: (raw) => {
    const data = raw as unknown as CuesData;
    if (state.loading || data.cues === undefined) return [loadingBars('Reading the cues')];
    return [
      jobNav(data.job.id, '/cues'),
      problemsRegion(state.problems),
      data.cues.length === 0
        ? emptyState('No cue licensed on this job yet.')
        : h(
            'ul',
            { key: 'cues', class: 'list-plain' },
            ...data.cues.map((cue) =>
              h(
                'li',
                { key: cue.id },
                h('h2', {}, `${cue.title} · ${cue.composer}`),
                h(
                  'p',
                  { class: 'numeric' },
                  `${cue.seconds} s · ${cue.market} · ${cue.from} to ${cue.until} · ${cue.fee}`,
                ),
                h('p', { 'data-part': 'licence' }, cue.licenceText),
                button({
                  id: `remove-cue-${cue.id}`,
                  label: `Remove cue ${cue.title}`,
                  pendingKey: `remove-${cue.id}`,
                  onPress: () =>
                    void run(`remove-${cue.id}`, async () => {
                      await api(`/api/jobs/${data.job.id}/cues/${cue.id}`, {
                        method: 'DELETE',
                      });
                      announce(say.cueRemoved(cue.title));
                      await refreshOnce();
                      focusHeading();
                    }),
                }),
              ),
            ),
          ),
    ];
  },
});

/** The combobox takes Up, Down and Enter, and `More results` loads the next page. */
function searchLibrary(text: string, cursor: string | null): void {
  const run = ++searchRun;
  if (text.trim() === '') {
    tracks = [];
    nextCursor = null;
    listOpen = false;
    redraw();
    return;
  }
  const query = new URLSearchParams({ q: text });
  if (cursor !== null) query.set('cursor', cursor);
  void api<{ tracks: Track[]; nextCursor: string | null }>(
    `/api/cues/search?${query.toString()}`,
  ).then(
    (answer) => {
      if (run !== searchRun) return;
      tracks = cursor === null ? answer.tracks : [...tracks, ...answer.tracks];
      nextCursor = answer.nextCursor;
      listOpen = true;
      redraw();
    },
    (error) => {
      if (run !== searchRun) return;
      const surface = state.surfaces.find((candidate) => candidate.name === 'Add cue');
      if (surface !== undefined) {
        surface.message =
          error instanceof Error && 'failure' in error
            ? (error as { failure: { message: string } }).failure.message
            : '';
        announce(surface.message);
      }
      redraw();
    },
  );
}

registerSurface('Add cue', (surface) => {
  const data = state.data as unknown as CuesData;
  const set = (name: string) => (value: string) => {
    surface.values[name] = value;
    redraw();
  };
  const options: Child[] = [
    ...tracks.map((track, index) =>
      h(
        'li',
        {
          key: track.id,
          id: `track-${track.id}`,
          role: 'option',
          class: 'menu__item',
          'aria-selected': index === activeTrack ? 'true' : 'false',
          onclick: () => pickTrack(surface, track),
        },
        `${track.title} · ${track.composer} · ${track.seconds} s`,
      ),
    ),
    nextCursor === null
      ? null
      : h(
          'li',
          {
            key: 'more',
            id: 'track-more',
            role: 'option',
            class: 'menu__item',
            'aria-selected': activeTrack === tracks.length ? 'true' : 'false',
            onclick: () => searchLibrary(surface.values['search'] ?? '', nextCursor),
          },
          'More results',
        ),
  ];
  return surfaceView(surface, {
    title: 'Add cue',
    body: [
      problemsRegion(surface.problems, { withLinks: false, message: surface.message }),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'field__label', for: 'cue-search' }, 'Search the library'),
        h('input', {
          id: 'cue-search',
          class: 'input',
          role: 'combobox',
          'aria-expanded': listOpen ? 'true' : 'false',
          'aria-controls': 'cue-list',
          'aria-autocomplete': 'list',
          'aria-activedescendant':
            listOpen && tracks.length > 0
              ? activeTrack === tracks.length
                ? 'track-more'
                : `track-${tracks[activeTrack]?.id ?? ''}`
              : undefined,
          value: surface.values['search'] ?? '',
          oninput: (event: Event) => {
            const value = (event.target as HTMLInputElement).value;
            surface.values['search'] = value;
            activeTrack = 0;
            searchLibrary(value, null);
          },
          onkeydown: (event: Event) => listKeys(event as KeyboardEvent, surface),
        }),
        h(
          'ul',
          {
            id: 'cue-list',
            role: 'listbox',
            'aria-label': 'Tracks',
            class: 'list-plain',
            hidden: !listOpen,
          },
          ...options,
        ),
      ),
      field({
        id: 'cue-title',
        label: 'Chosen track',
        value: surface.values['title'] ?? '',
        onInput: set('title'),
        problem: surface.problems['title'],
      }),
      combobox({
        id: 'cue-market',
        label: 'Market',
        value: surface.values['market'] ?? 'NL',
        options: Object.entries(LABELS.licenceMarket).map(([value, label]) => ({
          value,
          label,
        })),
        onChange: set('market'),
      }),
      field({
        id: 'cue-from',
        label: 'From',
        value: surface.values['from'] ?? '',
        onInput: set('from'),
        problem: surface.problems['from'],
      }),
      field({
        id: 'cue-until',
        label: 'Until',
        value: surface.values['until'] ?? '',
        onInput: set('until'),
        problem: surface.problems['until'],
      }),
    ],
    footer: [
      button({
        id: 'save-cue',
        label: 'Save',
        kind: 'primary',
        pendingKey: 'cue',
        onPress: () =>
          void run(
            'cue',
            guard(surface, async () => {
              const made = await api<Cue>(`/api/jobs/${data.job.id}/cues`, {
                method: 'POST',
                body: {
                  trackId: surface.values['trackId'] ?? '',
                  title: surface.values['title'] ?? '',
                  composer: surface.values['composer'] ?? '',
                  seconds: Number(surface.values['seconds'] ?? '0'),
                  market: surface.values['market'] ?? 'NL',
                  from: surface.values['from'] ?? '',
                  until: surface.values['until'] ?? '',
                },
              });
              closeSurface('Add cue');
              announce(say.cueAdded(made.title));
              await refreshOnce();
              focusBack('add-cue');
            }),
          ),
      }),
    ],
  });
});

function pickTrack(surface: Surface, track: Track): void {
  surface.values['trackId'] = track.id;
  surface.values['title'] = track.title;
  surface.values['composer'] = track.composer;
  surface.values['seconds'] = String(track.seconds);
  surface.values['search'] = track.title;
  listOpen = false;
  redraw();
  requestAnimationFrame(() => document.getElementById('cue-search')?.focus());
}

/** Escape closes the list first and then the dialog. */
function listKeys(event: KeyboardEvent, surface: Surface): void {
  const count = tracks.length + (nextCursor === null ? 0 : 1);
  if (event.key === 'Escape' && listOpen) {
    event.stopPropagation();
    listOpen = false;
    redraw();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (count === 0) return;
    listOpen = true;
    activeTrack =
      (activeTrack + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
    redraw();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    if (!listOpen) return;
    if (activeTrack === tracks.length) {
      searchLibrary(surface.values['search'] ?? '', nextCursor);
      return;
    }
    const track = tracks[activeTrack];
    if (track !== undefined) pickTrack(surface, track);
  }
}
