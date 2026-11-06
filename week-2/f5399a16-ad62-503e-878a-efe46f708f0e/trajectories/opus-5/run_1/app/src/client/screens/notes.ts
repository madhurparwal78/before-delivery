import { COPY, LABELS, say } from '../../domain/copy.js';
import {
  announce,
  api,
  focusHeading,
  openSurface,
  queryOf,
  redraw,
  refreshOnce,
  registerScreen,
  run,
  setQuery,
  state,
} from '../app.js';
import type { Child } from '../dom.js';
import { h } from '../dom.js';
import { setFilterBody } from '../filters.js';
import {
  button,
  combobox,
  emptyState,
  loadingBars,
  problemsRegion,
  tableFrame,
} from '../ui.js';
import { jobNav, loadJob } from './job.js';
import type { Job, Producer } from './jobs.js';

type Note = {
  id: string;
  frame: number;
  position: number | null;
  goneText: string | null;
  timecode: string | null;
  x: number;
  y: number;
  producerId: string;
  producerName: string;
  typedName: string;
  state: string;
  text: string;
  suggestedSeconds: string | null;
  suggestedFrames: number | null;
  attachmentUrl: string | null;
  createdAt: string;
};

type NotesData = { job: Job; notes: Note[]; total: number; producers: Producer[] };

const chosen = new Set<string>();
const expanded = new Set<string>();
let lastTouched: string | null = null;

const STATE_OPTIONS = [
  { value: '', label: 'All states' },
  ...Object.entries(LABELS.noteState).map(([value, label]) => ({ value, label })),
];

function filters(data: NotesData, inSheet: boolean): Child {
  const suffix = inSheet ? '-sheet' : '';
  return h(
    'div',
    { key: `note-filters${suffix}`, class: `filters${inSheet ? '' : ' filters--inline'}` },
    combobox({
      id: `note-state${suffix}`,
      label: 'Note state',
      value: queryOf().get('state') ?? '',
      options: STATE_OPTIONS,
      onChange: (value) => setQuery({ state: value === '' ? null : value }),
    }),
    combobox({
      id: `note-producer${suffix}`,
      label: 'Producer',
      value: queryOf().get('producer') ?? '',
      options: [
        { value: '', label: 'All producers' },
        ...(data.producers ?? []).map((producer) => ({
          value: producer.id,
          label: producer.name,
        })),
      ],
      onChange: (value) => setQuery({ producer: value === '' ? null : value }),
    }),
  );
}

registerScreen({
  name: 'notes',
  frame: 'desk',
  refreshes: true,
  heading: (raw) => `Notes for ${(raw as unknown as NotesData).job?.title ?? ''}`,
  load: async () => {
    const jobId = state.screen.jobId ?? '';
    const job = await loadJob(jobId);
    const query = new URLSearchParams();
    for (const name of ['state', 'producer']) {
      const value = queryOf().get(name);
      if (value !== null) query.set(name, value);
    }
    const [notes, producers] = await Promise.all([
      api<{ notes: Note[]; total: number }>(`/api/jobs/${jobId}/notes?${query.toString()}`),
      api<{ producers: Producer[] }>(`/api/clients/${job.clientId}/producers`),
    ]);
    return {
      job,
      notes: notes.notes,
      total: notes.total,
      producers: producers.producers,
    } as unknown as Record<string, unknown>;
  },
  mainAction: (raw) => {
    const data = raw as unknown as NotesData;
    if (chosen.size === 0) return null;
    return button({
      id: 'mark-notes-done',
      label: say.markNotesDone(chosen.size),
      kind: 'primary',
      pendingKey: 'mark-notes',
      onPress: () =>
        void run('mark-notes', async () => {
          const ids = [...chosen];
          await api(`/api/jobs/${data.job.id}/notes/mark`, {
            method: 'POST',
            body: { noteIds: ids, state: 'done' },
          });
          chosen.clear();
          announce(say.notesMarkedDone(ids.length));
          await refreshOnce();
          focusHeading();
        }),
    });
  },
  view: (raw) => {
    const data = raw as unknown as NotesData;
    if (state.loading || data.notes === undefined) return [loadingBars('Reading the notes')];
    const shown = data.notes;
    const allChosen = shown.length > 0 && shown.every((note) => chosen.has(note.id));
    const someChosen = shown.some((note) => chosen.has(note.id));
    return [
      jobNav(data.job.id, '/notes'),
      h(
        'div',
        { key: 'filter-switch', class: 'pair' },
        button({
          id: 'note-filters-button',
          label: 'Filters',
          extra: { class: 'button button--plain filters-button' },
          onPress: () =>
            openSurface('Filters', 'note-filters-button', {
              kind: 'sheet',
              sheet: 'filters',
            }),
        }),
      ),
      filters(data, false),
      problemsRegion(state.problems),
      shown.length === 0
        ? emptyState('No note matches these filters yet.')
        : tableFrame(
            'Notes table',
            h(
              'table',
              {},
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  h(
                    'th',
                    { scope: 'col' },
                    h(
                      'label',
                      { class: 'checkbox' },
                      h('input', {
                        type: 'checkbox',
                        checked: allChosen,
                        indeterminate: someChosen && !allChosen,
                        onchange: () => {
                          if (allChosen) chosen.clear();
                          else for (const note of shown) chosen.add(note.id);
                          redraw();
                        },
                      }),
                      h('span', { class: 'visually-hidden' }, 'Select all notes'),
                    ),
                  ),
                  h('th', { scope: 'col' }, 'Frame'),
                  h('th', { scope: 'col' }, 'Timecode'),
                  h('th', { scope: 'col' }, 'Pin'),
                  h('th', { scope: 'col' }, 'Producer'),
                  h('th', { scope: 'col' }, 'State'),
                  h('th', { scope: 'col' }, 'Note'),
                ),
              ),
              h(
                'tbody',
                {},
                ...shown.map((note) =>
                  h(
                    'tr',
                    { key: note.id },
                    h(
                      'td',
                      {},
                      h(
                        'label',
                        { class: 'checkbox' },
                        h('input', {
                          type: 'checkbox',
                          checked: chosen.has(note.id),
                          onclick: (event: globalThis.Event) =>
                            pickRange(event as MouseEvent, shown, note.id),
                          onchange: () => {
                            if (chosen.has(note.id)) chosen.delete(note.id);
                            else chosen.add(note.id);
                            lastTouched = note.id;
                            redraw();
                          },
                        }),
                        h(
                          'span',
                          { class: 'visually-hidden' },
                          `Select note on frame ${note.frame}`,
                        ),
                      ),
                    ),
                    h('td', { class: 'numeric' }, String(note.frame)),
                    h('td', { class: 'numeric' }, note.timecode ?? ''),
                    h('td', { class: 'numeric' }, `${note.x}% ${note.y}%`),
                    h('td', {}, note.producerName),
                    h(
                      'td',
                      {},
                      combobox({
                        id: `note-state-${note.id}`,
                        label: `State of note on frame ${note.frame}`,
                        hideLabel: true,
                        value: note.state,
                        options: Object.entries(LABELS.noteState).map(([value, label]) => ({
                          value,
                          label,
                        })),
                        onChange: (value) => void setNoteState(note, value),
                      }),
                    ),
                    h(
                      'td',
                      {},
                      h(
                        'p',
                        {},
                        note.position === null
                          ? (note.goneText ?? '')
                          : say.notePosition(note.position),
                      ),
                      button({
                        id: `expand-${note.id}`,
                        label: `Expand note on frame ${note.frame}`,
                        extra: { 'aria-expanded': expanded.has(note.id) ? 'true' : 'false' },
                        onPress: () => {
                          if (expanded.has(note.id)) expanded.delete(note.id);
                          else expanded.add(note.id);
                          redraw();
                        },
                      }),
                      expanded.has(note.id)
                        ? h(
                            'div',
                            { class: 'panel' },
                            h('p', {}, note.text),
                            note.suggestedFrames === null
                              ? null
                              : h(
                                  'p',
                                  { class: 'numeric' },
                                  `${note.suggestedSeconds ?? ''} s · ${
                                    note.suggestedFrames
                                  } frames`,
                                ),
                            note.attachmentUrl === null
                              ? null
                              : h('img', {
                                  src: note.attachmentUrl,
                                  alt: 'Drawing sent with the note',
                                  style: 'max-width:100%;height:auto',
                                }),
                          )
                        : null,
                    ),
                  ),
                ),
              ),
            ),
          ),
    ];
  },
});

/** Shift+click selects a range. */
function pickRange(event: MouseEvent, shown: Note[], id: string): void {
  if (!event.shiftKey || lastTouched === null) return;
  const from = shown.findIndex((note) => note.id === lastTouched);
  const to = shown.findIndex((note) => note.id === id);
  if (from === -1 || to === -1) return;
  event.preventDefault();
  for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) {
    const note = shown[index];
    if (note !== undefined) chosen.add(note.id);
  }
  redraw();
}

async function setNoteState(note: Note, value: string): Promise<void> {
  await run(`note-${note.id}`, async () => {
    await api(`/api/notes/${note.id}`, { method: 'PATCH', body: { state: value } });
    announce(
      value === 'done' ? COPY.noteDone : value === 'wontDo' ? COPY.noteWontDo : COPY.noteReopened,
    );
    const hidden = queryOf().get('state') !== null && queryOf().get('state') !== value;
    await refreshOnce();
    if (hidden) focusHeading();
  });
}

setFilterBody('notes', () => filters(state.data as unknown as NotesData, true));
