import { COPY, LABELS, say } from '../../domain/copy.js';
import {
  announce,
  api,
  isRefusal,
  redraw,
  refreshOnce,
  registerScreen,
  run,
  state,
} from '../app.js';
import { h } from '../dom.js';
import { button, combobox, emptyState, field, loadingBars, problemsRegion } from '../ui.js';
import { jobNav, loadJob } from './job.js';
import type { Cut } from './cuts.js';
import type { Job, Producer } from './jobs.js';

type PackageFile = { kind: string; fileName: string; size: number; sha256: string; url: string };

type Package = {
  id: string;
  cut: number;
  state: string;
  files: PackageFile[];
  createdAt: string;
};

type DeliveryData = { job: Job; cuts: Cut[]; packages: Package[] };

const FILE_LABELS: Record<string, string> = {
  boards: 'Download boards PDF',
  editDecisionList: 'Download edit decision list',
  shotList: 'Download shot list',
};

let chosenCut = '';

registerScreen({
  name: 'delivery',
  frame: 'desk',
  refreshes: true,
  heading: (raw) => `Delivery for ${(raw as unknown as DeliveryData).job?.title ?? ''}`,
  load: async () => {
    const jobId = state.screen.jobId ?? '';
    const [job, cuts, packages] = await Promise.all([
      loadJob(jobId),
      api<{ cuts: Cut[] }>(`/api/jobs/${jobId}/cuts`),
      api<{ packages: Package[] }>(`/api/jobs/${jobId}/packages`),
    ]);
    if (chosenCut === '') chosenCut = String(cuts.cuts[cuts.cuts.length - 1]?.number ?? 1);
    return { job, cuts: cuts.cuts, packages: packages.packages } as unknown as Record<
      string,
      unknown
    >;
  },
  mainAction: () =>
    button({
      id: 'make-package',
      label: 'Make package',
      kind: 'primary',
      pendingKey: 'package',
      onPress: () => void makePackage(),
    }),
  view: (raw) => {
    const data = raw as unknown as DeliveryData;
    if (state.loading || data.cuts === undefined) return [loadingBars('Reading the delivery')];
    return [
      jobNav(data.job.id, '/delivery'),
      problemsRegion(state.problems),
      combobox({
        id: 'delivery-cut',
        label: 'Cut',
        value: chosenCut,
        options: data.cuts.map((cut) => ({
          value: String(cut.number),
          label: `Cut ${cut.number}`,
        })),
        onChange: (value) => {
          chosenCut = value;
          redraw();
        },
      }),
      data.packages.length === 0
        ? emptyState('No package made on this job yet.')
        : h(
            'ul',
            { key: 'packages', class: 'list-plain' },
            ...data.packages.map((held) =>
              h(
                'li',
                { key: held.id },
                h('h2', {}, `Cut ${held.cut}`),
                h(
                  'p',
                  { 'data-part': 'package-state' },
                  held.state === 'ready' ? 'Ready' : 'Making',
                ),
                h(
                  'div',
                  { class: 'row-actions' },
                  ...held.files.map((file) =>
                    h(
                      'a',
                      { key: file.kind, href: file.url, class: 'link', download: '' },
                      FILE_LABELS[file.kind] ?? file.kind,
                    ),
                  ),
                ),
              ),
            ),
          ),
    ];
  },
});

async function makePackage(): Promise<void> {
  await run('package', async () => {
    state.problems = {};
    try {
      await api(`/api/jobs/${state.screen.jobId ?? ''}/packages`, {
        method: 'POST',
        body: { cut: Number(chosenCut) },
      });
      announce(COPY.packageReady);
      await refreshOnce();
    } catch (error) {
      if (isRefusal(error)) {
        state.problems = { cut: error.failure.message };
        announce(error.failure.message);
        redraw();
        return;
      }
      throw error;
    }
  });
}

type Milestone = {
  number: number;
  amountMinor: number;
  taxMinor: number;
  amountText: string;
  taxText: string;
};

type Letter = {
  id: string;
  jobId: string;
  currency: string;
  scope: string;
  feeMinor: number;
  taxMinor: number;
  totalMinor: number;
  feeText: string;
  taxText: string;
  totalText: string;
  milestones: Milestone[];
  state: string;
  stamp: string;
  producerId: string | null;
  pageUrl: string | null;
  endsAt: string | null;
  pdfUrl: string;
};

type LetterData = { job: Job; letter: Letter | null; producers: Producer[] };

const draft = { currency: 'EUR', fee: '', scope: '', stamp: '' };
let draftReady = false;

registerScreen({
  name: 'letter',
  frame: 'desk',
  refreshes: true,
  heading: (raw) => `Fee letter for ${(raw as unknown as LetterData).job?.title ?? ''}`,
  load: async () => {
    const jobId = state.screen.jobId ?? '';
    const job = await loadJob(jobId);
    const producers = await api<{ producers: Producer[] }>(
      `/api/clients/${job.clientId}/producers`,
    );
    let letter: Letter | null = null;
    try {
      letter = await api<Letter>(`/api/jobs/${jobId}/letter`);
    } catch (error) {
      if (!isRefusal(error) || error.failure.status !== 404) throw error;
    }
    if (letter !== null && !draftReady) {
      draft.currency = letter.currency;
      draft.fee = (letter.feeMinor / 100).toFixed(2);
      draft.scope = letter.scope;
      draftReady = true;
    }
    if (letter !== null) draft.stamp = letter.stamp;
    return { job, letter, producers: producers.producers } as unknown as Record<string, unknown>;
  },
  mainAction: () =>
    button({
      id: 'save-letter',
      label: 'Save letter',
      kind: 'primary',
      pendingKey: 'letter',
      onPress: () => void saveLetter(),
    }),
  view: (raw) => {
    const data = raw as unknown as LetterData;
    if (state.loading || data.job === undefined) return [loadingBars('Reading the letter')];
    const letter = data.letter;
    return [
      jobNav(data.job.id, '/letter'),
      problemsRegion(state.problems),
      combobox({
        id: 'letter-currency',
        label: 'Currency',
        value: draft.currency,
        options: Object.entries(LABELS.currency).map(([value, label]) => ({ value, label })),
        onChange: (value) => {
          draft.currency = value;
          redraw();
        },
      }),
      field({
        id: 'letter-fee',
        label: 'Fee',
        value: draft.fee,
        onInput: (value) => {
          draft.fee = value;
        },
        problem: state.problems['fee'],
      }),
      field({
        id: 'letter-scope',
        label: 'Scope',
        value: draft.scope,
        onInput: (value) => {
          draft.scope = value;
        },
        problem: state.problems['scope'],
      }),
      letter === null
        ? emptyState('No fee letter written on this job yet.')
        : h(
            'div',
            { key: 'amounts', class: 'panel' },
            h(
              'ul',
              { class: 'list-plain' },
              ...letter.milestones.map((milestone) =>
                h(
                  'li',
                  { key: `milestone-${milestone.number}`, class: 'numeric' },
                  `Milestone ${milestone.number}: ${milestone.amountText} + ${milestone.taxText}`,
                ),
              ),
            ),
            h('p', { class: 'numeric' }, `Fee ${letter.feeText}`),
            h('p', { class: 'numeric' }, `Tax ${letter.taxText}`),
            h('p', { class: 'numeric' }, `Total ${letter.totalText}`),
            h('p', { 'data-part': 'letter-state' }, letter.state),
            h('a', { href: letter.pdfUrl, class: 'link', download: '' }, 'Download the letter'),
          ),
      letter === null
        ? null
        : h(
            'div',
            { key: 'sending', class: 'row-actions' },
            combobox({
              id: 'letter-producer',
              label: 'Producer',
              value: letter.producerId ?? (data.producers[0]?.id ?? ''),
              options: data.producers.map((producer) => ({
                value: producer.id,
                label: producer.name,
              })),
              onChange: (value) => {
                draft.stamp = letter.stamp;
                (state.data as unknown as LetterData).letter = {
                  ...letter,
                  producerId: value,
                };
                redraw();
              },
            }),
            button({
              id: 'send-letter',
              label: 'Send letter',
              pendingKey: 'send-letter',
              onPress: () => void sendLetter(letter),
            }),
            letter.pageUrl === null
              ? null
              : button({
                  id: 'end-letter-page',
                  label: 'End page',
                  pendingKey: 'end-letter-page',
                  onPress: () =>
                    void run('end-letter-page', async () => {
                      await api(`/api/letters/${letter.id}/end-page`, { method: 'POST' });
                      announce(COPY.pageEnded);
                      await refreshOnce();
                    }),
                }),
          ),
    ];
  },
});

async function saveLetter(): Promise<void> {
  const data = state.data as unknown as LetterData;
  await run('letter', async () => {
    state.problems = {};
    try {
      if (data.letter === null) {
        await api(`/api/jobs/${data.job.id}/letter`, {
          method: 'POST',
          body: { currency: draft.currency, fee: draft.fee, scope: draft.scope },
        });
      } else {
        await api(`/api/letters/${data.letter.id}`, {
          method: 'PATCH',
          body: {
            currency: draft.currency,
            fee: draft.fee,
            scope: draft.scope,
            stamp: draft.stamp,
          },
        });
      }
      announce(COPY.letterSaved);
      await refreshOnce();
    } catch (error) {
      if (isRefusal(error)) {
        state.problems =
          Object.keys(error.failure.fields).length > 0
            ? error.failure.fields
            : { fee: error.failure.message };
        announce(error.failure.message);
        redraw();
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.problems')?.focus());
        return;
      }
      throw error;
    }
  });
}

async function sendLetter(letter: Letter): Promise<void> {
  const data = state.data as unknown as LetterData;
  await run('send-letter', async () => {
    state.problems = {};
    try {
      const producerId = letter.producerId ?? (data.producers[0]?.id ?? '');
      await api(`/api/letters/${letter.id}/send`, { method: 'POST', body: { producerId } });
      const producer = data.producers.find((candidate) => candidate.id === producerId);
      announce(say.feePageReady(producer?.name ?? ''));
      await refreshOnce();
    } catch (error) {
      if (isRefusal(error)) {
        state.problems = { fee: error.failure.message };
        announce(error.failure.message);
        redraw();
        return;
      }
      throw error;
    }
  });
}
