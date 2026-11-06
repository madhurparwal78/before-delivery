import { say } from '../../domain/copy.js';
import {
  announce,
  api,
  isRefusal,
  redraw,
  registerScreen,
  run,
  state,
} from '../app.js';
import { h } from '../dom.js';
import { button, loadingBars, problemsRegion, tableFrame } from '../ui.js';
import { jobNav, loadJob } from './job.js';
import type { Job } from './jobs.js';

type Row = { row: number; shot: string; result: string; reason: string | null };

let picked: File | null = null;
let rows: Row[] = [];

registerScreen({
  name: 'script',
  frame: 'desk',
  refreshes: true,
  heading: (raw) => `Script for ${(raw as unknown as { job: Job }).job?.title ?? ''}`,
  load: async () => ({ job: await loadJob(state.screen.jobId ?? '') }) as unknown as Record<
    string,
    unknown
  >,
  mainAction: () =>
    button({
      id: 'save-script',
      label: 'Save',
      kind: 'primary',
      pendingKey: 'script',
      disabledLook: picked === null,
      onPress: () => void saveScript(),
    }),
  view: (raw) => {
    const job = (raw as unknown as { job: Job }).job;
    if (state.loading || job === undefined) return [loadingBars('Reading the job')];
    return [
      jobNav(job.id, '/script'),
      h(
        'div',
        { key: 'file', class: 'file-field' },
        h('label', { class: 'field__label', for: 'script-file' }, 'Script file'),
        h('input', {
          id: 'script-file',
          name: 'Script file',
          type: 'file',
          accept: '.csv,text/csv',
          class: 'input',
          onchange: (event: Event) => {
            const files = (event.target as HTMLInputElement).files;
            picked = files === null ? null : (files[0] ?? null);
            void preview();
          },
        }),
      ),
      problemsRegion(state.problems),
      rows.length === 0
        ? h('p', { key: 'none' }, 'Choose a script file to read its preview.')
        : tableFrame(
            'Script preview',
            h(
              'table',
              {},
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  h('th', { scope: 'col' }, 'Row'),
                  h('th', { scope: 'col' }, 'Shot'),
                  h('th', { scope: 'col' }, 'Result'),
                  h('th', { scope: 'col' }, 'Reason'),
                ),
              ),
              h(
                'tbody',
                {},
                ...rows.map((row) =>
                  h(
                    'tr',
                    { key: `row-${row.row}` },
                    h('td', { class: 'numeric' }, String(row.row)),
                    h('td', {}, row.shot),
                    h('td', {}, row.result),
                    h('td', {}, row.reason ?? ''),
                  ),
                ),
              ),
            ),
          ),
    ];
  },
});

/** Choosing a file shows its preview, and nothing is saved until Save. */
async function preview(): Promise<void> {
  const file = picked;
  if (file === null) {
    rows = [];
    redraw();
    return;
  }
  await run('script-preview', async () => {
    state.problems = {};
    const form = new FormData();
    form.append('file', file, file.name);
    try {
      const answer = await api<{ rows: Row[] }>(
        `/api/jobs/${state.screen.jobId ?? ''}/script/preview`,
        { form },
      );
      rows = answer.rows;
      const counts = { new: 0, matched: 0, refused: 0 };
      for (const row of rows) {
        if (row.result === 'new') counts.new += 1;
        else if (row.result === 'matched') counts.matched += 1;
        else counts.refused += 1;
      }
      announce(say.previewReady(counts.new, counts.matched, counts.refused));
      redraw();
    } catch (error) {
      if (isRefusal(error)) {
        rows = [];
        state.problems = { 'script-file': error.failure.message };
        announce(error.failure.message);
        redraw();
        return;
      }
      throw error;
    }
  });
}

async function saveScript(): Promise<void> {
  const file = picked;
  if (file === null) return;
  await run('script', async () => {
    state.problems = {};
    const form = new FormData();
    form.append('file', file, file.name);
    try {
      const answer = await api<{
        created: number;
        updated: number;
        rows: Row[];
      }>(`/api/jobs/${state.screen.jobId ?? ''}/script`, { form });
      rows = answer.rows;
      announce(say.scriptSaved(answer.created, answer.updated));
      redraw();
    } catch (error) {
      if (isRefusal(error)) {
        state.problems = { 'script-file': error.failure.message };
        announce(error.failure.message);
        redraw();
        return;
      }
      throw error;
    }
  });
}
