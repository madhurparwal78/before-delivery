import {
  CELLS_PER_LANE,
  CREATURES,
  DEFAULT_WAVE,
  DEVICES,
  DIFFICULTIES,
  DRAFT_DEFINITION,
  LANES,
} from '../../shared/constants.js';
import { formatTick, parseTick } from '../../shared/format.js';
import type { Definition, Ticket, Wave } from '../../shared/types.js';
import { api } from '../api.js';
import { HarbourChart } from '../board.js';
import { setBusy, button, field, h, region, select, table } from '../dom.js';
import { PENDING_COPY, SUCCESS_COPY, feedback } from '../feedback.js';
import type { ChallengeView, LevelView, Shell } from '../shell.js';
import { startDefenceSession } from './defence.js';

let chart: HarbourChart | null = null;
let chartDraft: Definition | null = null;
const invalidTimes = new Map<string, string>();
let selectedCell = { lane: 1, cell: 1 };

function cloneDefinition(definition: Definition): Definition {
  return {
    title: definition.title,
    description: definition.description,
    difficulty: definition.difficulty,
    seed: definition.seed,
    buildable: definition.buildable.map((cell) => ({ ...cell })),
    waves: definition.waves.map((wave) => ({ ...wave })),
  };
}

function sortedBuildable(cells: { lane: number; cell: number }[]): { lane: number; cell: number }[] {
  return [...cells].sort((a, b) => a.lane - b.lane || a.cell - b.cell);
}

export async function loadLevels(shell: Shell, announce: boolean): Promise<void> {
  if (announce) feedback.pending(PENDING_COPY.inspection);
  const response = await api.get<{ levels: LevelView[] }>('/api/levels');
  shell.state.levels = response.levels;
  if (shell.state.editorLevelId !== null) {
    const refreshed = response.levels.find((level) => level.id === shell.state.editorLevelId);
    if (refreshed === undefined) {
      shell.state.editorLevelId = null;
      shell.state.editorSaved = null;
      shell.state.editorDraft = null;
    } else {
      shell.state.editorSaved = refreshed;
    }
  }
  if (announce) feedback.succeed(SUCCESS_COPY.inspection);
}

async function openLevel(shell: Shell, id: string): Promise<void> {
  feedback.pending(PENDING_COPY.inspection);
  try {
    const level = await api.get<LevelView>(`/api/levels/${id}`);
    shell.state.editorLevelId = level.id;
    shell.state.editorSaved = level;
    shell.state.editorDraft = cloneDefinition(level.definition);
    invalidTimes.clear();
    feedback.succeed(SUCCESS_COPY.inspection);
    shell.render();
  } catch (error) {
    feedback.fail(error);
  }
}

function newDraft(shell: Shell): void {
  invalidTimes.clear();
  shell.state.editorLevelId = null;
  shell.state.editorSaved = null;
  shell.state.editorDraft = cloneDefinition(DRAFT_DEFINITION);
  shell.render();
}

function editorChart(draft: Definition): HarbourChart {
  chartDraft = draft;
  if (chart === null) {
    chart = new HarbourChart({
      onSelect: (lane, cell) => {
        selectedCell = { lane, cell };
      },
      onActivate: (lane, cell) => toggleCell(chartDraft as Definition, lane, cell),
    });
  }
  chart.setBuildable(draft.buildable);
  chart.render(null);
  return chart;
}

function toggleCell(draft: Definition, lane: number, cell: number): void {
  const exists = draft.buildable.some((entry) => entry.lane === lane && entry.cell === cell);
  draft.buildable = sortedBuildable(
    exists
      ? draft.buildable.filter((entry) => !(entry.lane === lane && entry.cell === cell))
      : [...draft.buildable, { lane, cell }],
  );
  chart?.setBuildable(draft.buildable);
}

function waveRows(shell: Shell, draft: Definition): (Node | string)[][] {
  return draft.waves.map((wave, index) => {
    const number = index + 1;
    const timeField = field(`Wave ${number} time`, 'text', formatTick(wave.tick), (value) => {
      const parsed = parseTick(value);
      if (parsed !== null) { wave.tick = parsed; invalidTimes.delete(`definition.waves[${index}].tick`); }
      else invalidTimes.set(`definition.waves[${index}].tick`, value);
      timeField.error.hidden = parsed !== null;
      timeField.error.textContent = parsed === null ? `definition.waves[${index}].tick: Use a permitted value.` : '';
    });
    const intervalField = field(
      `Wave ${number} interval`,
      'text',
      formatTick(wave.interval),
      (value) => {
        const parsed = parseTick(value);
        if (parsed !== null) { wave.interval = parsed; invalidTimes.delete(`definition.waves[${index}].interval`); }
        else invalidTimes.set(`definition.waves[${index}].interval`, value);
        intervalField.error.hidden = parsed !== null;
        intervalField.error.textContent = parsed === null ? `definition.waves[${index}].interval: Use a permitted value.` : '';
      },
    );
    const countField = numberField(`Wave ${number} count`, wave.count, (value) => {
      wave.count = value;
    });
    const laneField = numberField(`Wave ${number} lane`, wave.lane, (value) => {
      wave.lane = value;
    });
    const creatureSelect = select(
      `Wave ${number} creature`,
      wave.creature,
      CREATURES.map((creature) => ({ value: creature.id, label: creature.name })),
      (value) => {
        wave.creature = value;
      },
    );
    return [
      timeField.wrapper,
      creatureSelect.wrapper,
      countField,
      intervalField.wrapper,
      laneField,
      button(`Remove wave ${number}`, () => {
        draft.waves.splice(index, 1);
        shell.render();
      }),
    ];
  });
}

function numberField(name: string, value: number, onChange: (value: number) => void): HTMLElement {
  const id = `spin-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  const input = h('input', {
    id,
    type: 'number',
    step: '1',
    value: String(value),
    class: 'text-input',
    oninput: (event: Event) => {
      const parsed = Number((event.target as HTMLInputElement).value);
      if (Number.isSafeInteger(parsed)) onChange(parsed);
    },
  });
  return h('div', { class: 'field' }, [h('label', { for: id }, [name]), input]);
}

function savedRevisionPanel(shell: Shell): HTMLElement {
  const saved = shell.state.editorSaved;
  if (saved === null) {
    return region('Saved revision', 'panel paper', [
      h('h2', {}, ['Saved revision']),
      h('p', {}, ['This draft has not been saved yet. Save to create revision one.']),
    ]);
  }
  return region('Saved revision', 'panel paper', [
    h('h2', {}, ['Saved revision']),
    h('dl', { class: 'manifest-list' }, [
      h('dt', {}, ['Revision']),
      h('dd', { class: 'numeric' }, [String(saved.revision)]),
      h('dt', {}, ['Digest']),
      h('dd', { class: 'digest' }, [saved.digest]),
      h('dt', {}, ['Publication state']),
      h('dd', {}, [saved.state]),
      h('dt', {}, ['Qualified proof']),
      h('dd', {}, [saved.proofRunId ?? 'none']),
      h('dt', {}, ['Challenge digest']),
      h('dd', { class: 'digest' }, [saved.challengeDigest ?? 'none']),
      h('dt', {}, ['Discovery indexing']),
      h('dd', {}, [saved.indexing]),
    ]),
    h('h3', {}, ['Proof history']),
    saved.proofs.length === 0
      ? h('p', {}, ['No playtest proofs yet.'])
      : table(
          'Proof history',
          ['Run', 'Revision', 'State'],
          saved.proofs.map((proof) => [proof.runId, String(proof.revision), proof.state]),
        ),
  ]);
}

export function renderEditor(shell: Shell): void {
  const draft = shell.state.editorDraft;

  const levelsRegion = region('Private levels', 'panel paper', [
    h('h2', {}, ['Private levels']),
    button('New level', () => newDraft(shell)),
    shell.state.levels.length === 0
      ? h('p', {}, ['No private levels yet.'])
      : h(
          'ul',
          { class: 'level-list' },
          shell.state.levels.map((level) =>
            h('li', {}, [
              h('span', {}, [`${level.definition.title} — revision ${level.revision} (${level.state})`]),
              button(`Open ${level.definition.title}`, () => void openLevel(shell, level.id), {
                label: level.definition.title,
              }),
            ]),
          ),
        ),
    button('Refresh private levels', () => {
      void loadLevels(shell, true).then(() => shell.render());
    }),
  ]);

  if (draft === null) {
    shell.surface.set([{ name: 'board', node: levelsRegion }]);
    shell.main.append(shell.surface.element);
    return;
  }

  const titleField = field('Level title', 'text', draft.title, (value) => {
    draft.title = value;
  });
  const descriptionField = field('Description', 'text', draft.description, (value) => {
    draft.description = value;
  });
  const seedField = numberField('Seed', draft.seed, (value) => {
    draft.seed = value;
  });
  const difficultySelect = select(
    'Difficulty',
    draft.difficulty,
    DIFFICULTIES.map((difficulty) => ({ value: difficulty, label: difficulty })),
    (value) => {
      draft.difficulty = value as Definition['difficulty'];
    },
  );

  const board = editorChart(draft);
  const definitionPanel = h('div', { class: 'panel paper' }, [
    h('h2', {}, ['Definition']),
    titleField.wrapper,
    descriptionField.wrapper,
    seedField,
    difficultySelect.wrapper,
    h('h3', {}, ['Buildable cells']),
    board.element,
    board.navigation,
    button('Toggle buildable cell', () => toggleCell(draft, selectedCell.lane, selectedCell.cell)),
    h('p', {}, [`${draft.buildable.length} of ${LANES * CELLS_PER_LANE} cells buildable.`]),
  ]);

  const wavesPanel = h('div', { class: 'panel paper' }, [
    h('h2', {}, ['Waves']),
    table('Waves', ['Time', 'Creature', 'Count', 'Interval', 'Lane', 'Actions'], waveRows(shell, draft)),
    button('Add wave', () => {
      draft.waves.push({ ...DEFAULT_WAVE } as Wave);
      shell.render();
    }),
  ]);

  const saveButton = button('Save private level', async () => {
    if (invalidTimes.size > 0) {
      feedback.localFailure([...invalidTimes.keys()].map((path) => `${path}: Use a permitted value.`).join(' '));
      return;
    }
    setBusy(saveButton, true);
    feedback.pending(PENDING_COPY.saveLevel);
    try {
      const payload = { definition: draft };
      const level =
        shell.state.editorLevelId === null
          ? await api.post<LevelView>('/api/levels', payload)
          : await api.put<LevelView>(`/api/levels/${shell.state.editorLevelId}`, {
              expectedRevision: (shell.state.editorSaved as LevelView).revision,
              definition: draft,
            });
      shell.state.editorLevelId = level.id;
      shell.state.editorSaved = level;
      shell.state.editorDraft = cloneDefinition(level.definition);
    invalidTimes.clear();
      feedback.succeed(SUCCESS_COPY.saveLevel);
      await loadLevels(shell, false);
      shell.render();
    } catch (error) {
      feedback.fail(error);
      setBusy(saveButton, false);
    }
  });

  const playtestButton = button('Playtest', async () => {
    const saved = shell.state.editorSaved;
    if (saved === null) return;
    setBusy(playtestButton, true);
    feedback.pending(PENDING_COPY.startDefence);
    try {
      const response = await api.post<{ ticket: Ticket }>('/api/runs', {
        mode: 'playtest',
        sourceId: saved.id,
        revision: saved.revision,
        loadout: DEVICES.slice(0, 4).map((device) => device.id),
      });
      await api.post(`/api/runs/${response.ticket.id}/start`, {});
      feedback.succeed(SUCCESS_COPY.startDefence);
      startDefenceSession(shell, response.ticket, saved.definition, 'playtest');
    } catch (error) {
      feedback.fail(error);
      setBusy(playtestButton, false);
    }
  });
  playtestButton.disabled = shell.state.editorSaved === null;

  const publishButton = button('Publish challenge', () => void publish(shell, publishButton));
  const retryPublishButton = button('Retry publication', () => void publish(shell, retryPublishButton));
  const withdrawButton = button('Withdraw level', async () => {
    const saved = shell.state.editorSaved;
    if (saved === null) return;
    setBusy(withdrawButton, true);
    feedback.pending(PENDING_COPY.withdraw);
    try {
      await api.post(`/api/levels/${saved.id}/withdraw`, { expectedRevision: saved.revision });
      feedback.succeed(SUCCESS_COPY.withdraw);
      shell.state.editorLevelId = null;
      shell.state.editorSaved = null;
      shell.state.editorDraft = null;
      await loadLevels(shell, false);
      shell.render();
    } catch (error) {
      feedback.fail(error);
      setBusy(withdrawButton, false);
    }
  });
  withdrawButton.disabled = shell.state.editorSaved === null;

  const actions = h('div', { class: 'panel paper' }, [
    h('div', { class: 'actions-row' }, [
      saveButton,
      playtestButton,
      publishButton,
      retryPublishButton,
      withdrawButton,
    ]),
  ]);

  shell.surface.set([
    { name: 'board', node: definitionPanel },
    { name: 'manifest', node: savedRevisionPanel(shell) },
    { name: 'crew', node: wavesPanel },
    { name: 'actions', node: actions },
    { name: 'summary', node: levelsRegion },
  ]);
  shell.main.append(shell.surface.element);
}

async function publish(shell: Shell, trigger: HTMLButtonElement): Promise<void> {
  const saved = shell.state.editorSaved;
  if (saved === null) return;
  const proof = saved.proofs.find(
    (entry) => entry.state === 'qualified' && entry.revision === saved.revision,
  );
  if (proof === undefined) {
    feedback.localFailure('Verify a victory for this saved revision first.');
    return;
  }
  setBusy(trigger, true);
  feedback.pending(PENDING_COPY.publish);
  try {
    const response = await api.postEnvelope<ChallengeView | LevelView>(
      `/api/levels/${saved.id}/publish`,
      { expectedRevision: saved.revision, proofRunId: proof.runId },
    );
    if (response.status === 202) {
      shell.state.editorSaved = response.body as LevelView;
      feedback.succeed(SUCCESS_COPY.pendingPublication);
    } else {
      feedback.succeed(SUCCESS_COPY.committedPublication);
      const level = await api.get<LevelView>(`/api/levels/${saved.id}`);
      shell.state.editorSaved = level;
    }
    await loadLevels(shell, false);
    shell.render();
  } catch (error) {
    feedback.fail(error);
    setBusy(trigger, false);
  }
}
