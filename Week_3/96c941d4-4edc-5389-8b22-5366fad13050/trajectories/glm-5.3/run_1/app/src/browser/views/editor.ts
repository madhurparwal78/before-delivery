// Editor view: level definitions, buildable cells, waves, revisions, proofs, publication.
import { state, announceStatus, handleApiError, disabledWhilePending, clearError } from '../app.js';
import { api } from '../api.js';
import type { LevelShape, Definition } from '../api.js';
import { CREATURES, DRAFT_DEFAULTS, LIMITS } from '../../shared/seed.js';
import { formatTicks, parseTicks } from '../../shared/numeric.js';

interface EditorDraft {
  id: string | null;
  revision: number;
  title: string;
  description: string;
  difficulty: string;
  seed: string;
  buildable: Set<string>;
  waves: Array<{ tickText: string; creature: string; count: string; intervalText: string; lane: string }>;
}

let draft: EditorDraft | null = null;

const allCells = (): string[] => {
  const cells: string[] = [];
  for (let lane = 1; lane <= LIMITS.lanes; lane++) {
    for (let cell = 1; cell <= LIMITS.cellsPerLane; cell++) cells.push(`${lane}:${cell}`);
  }
  return cells;
};

export function renderEditor(main: HTMLElement): void {
  main.innerHTML = `
    <h1>Editor</h1>
    <section aria-label="Private levels" id="private-levels" class="panel">
      <h2 class="section-heading">Your private levels</h2>
      <button id="new-level" class="primary">New level</button>
      <div id="level-list"></div>
    </section>
    <section aria-label="Level editor" id="level-editor" class="panel" hidden>
      <div class="editor-fields">
        <div class="field">
          <label for="level-title">Level title</label>
          <input id="level-title" type="text" maxlength="60">
        </div>
        <div class="field">
          <label for="level-description">Description</label>
          <textarea id="level-description" maxlength="500" rows="3"></textarea>
        </div>
        <div class="field">
          <label for="level-seed">Seed</label>
          <input id="level-seed" type="number" min="1" max="4294967295">
        </div>
        <div class="field">
          <label for="level-difficulty">Difficulty</label>
          <select id="level-difficulty" aria-label="Difficulty">
            <option value="calm">calm</option>
            <option value="rough">rough</option>
            <option value="severe">severe</option>
          </select>
        </div>
      </div>
      <section aria-label="Buildable cells" class="editor-cells">
        <h3 class="section-subheading">Buildable cells</h3>
        <p>Select a cell, then toggle buildability.</p>
        <div id="editor-cell-grid" class="editor-cell-grid"></div>
        <button id="toggle-buildable" class="secondary">Toggle buildable cell</button>
        <p id="editor-selected-cell">No cell selected.</p>
      </section>
      <section aria-label="Waves" class="editor-waves">
        <h3 class="section-subheading">Waves</h3>
        <table aria-label="Waves" class="waves-table" id="waves-table">
          <thead><tr><th>Time</th><th>Creature</th><th>Count</th><th>Interval</th><th>Lane</th><th>Actions</th></tr></thead>
          <tbody id="waves-body"></tbody>
        </table>
        <button id="add-wave" class="secondary">Add wave</button>
      </section>
      <div class="editor-actions">
        <button id="save-level" class="primary">Save private level</button>
        <button id="playtest" class="primary">Playtest</button>
        <button id="publish-challenge">Publish challenge</button>
        <button id="retry-publication">Retry publication</button>
        <button id="withdraw-level" class="secondary">Withdraw level</button>
      </div>
      <section aria-label="Saved revision" id="saved-revision" class="saved-revision">
        <p id="revision-state">No level loaded.</p>
      </section>
    </section>
  `;

  const editorSection = document.getElementById('level-editor') as HTMLElement;
  const listContainer = document.getElementById('level-list')!;

  function refreshLevels(): void {
    api<{ levels: LevelShape[] }>('GET', '/api/levels')
      .then(({ data }) => {
        listContainer.innerHTML = data.levels
          .map(
            (level) => `
            <article class="level-row" data-id="${level.id}">
              <h3>${escapeHtml(level.definition.title)}</h3>
              <p>Revision ${level.revision} — state ${level.state} — ${level.proofs.length} proof${level.proofs.length === 1 ? '' : 's'}</p>
              <button class="open-level" data-id="${level.id}">Open ${escapeHtml(level.definition.title)}</button>
            </article>`,
          )
          .join('');
        listContainer.querySelectorAll<HTMLButtonElement>('.open-level').forEach((button) => {
          button.addEventListener('click', () => {
            openLevel(button.dataset.id!);
          });
        });
      })
      .catch(handleApiError);
  }

  if (!state.account) {
    listContainer.innerHTML = '<p>Sign in to manage private levels.</p>';
  } else {
    refreshLevels();
  }

  document.getElementById('new-level')?.addEventListener('click', async () => {
    clearError();
    const button = document.getElementById('new-level') as HTMLButtonElement;
    const restore = disabledWhilePending(button);
    announceStatus('Loading harbour records…');
    try {
      const definition = draftDefinition(DRAFT_DEFAULTS.title, '', 'calm', DRAFT_DEFAULTS.seed, allCells(), [
        { tick: DRAFT_DEFAULTS.wave.tick, creature: DRAFT_DEFAULTS.wave.creature, count: DRAFT_DEFAULTS.wave.count, interval: DRAFT_DEFAULTS.wave.interval, lane: DRAFT_DEFAULTS.wave.lane },
      ]);
      const { data } = await api<LevelShape>('POST', '/api/levels', { definition });
      announceStatus('Harbour records loaded.');
      openDraftFromLevel(data);
    } catch (e) {
      handleApiError(e);
      restore();
    }
  });

  function draftDefinition(title: string, description: string, difficulty: string, seed: number, buildable: string[], waves: Array<{ tick: number; creature: string; count: number; interval: number; lane: number }>): Definition {
    return {
      title,
      description,
      difficulty: difficulty as Definition['difficulty'],
      seed,
      buildable: buildable.map((key) => {
        const [lane, cell] = key.split(':').map(Number);
        return { lane, cell };
      }),
      waves,
    };
  }

  function openLevel(levelId: string): void {
    api<LevelShape>('GET', `/api/levels/${levelId}`)
      .then(({ data }) => {
        openDraftFromLevel(data);
      })
      .catch(handleApiError);
  }

  function openDraftFromLevel(level: LevelShape): void {
    draft = {
      id: level.id,
      revision: level.revision,
      title: level.definition.title,
      description: level.definition.description,
      difficulty: level.definition.difficulty,
      seed: String(level.definition.seed),
      buildable: new Set(level.definition.buildable.map((b) => `${b.lane}:${b.cell}`)),
      waves: level.definition.waves.map((wave) => ({
        tickText: formatTicks(wave.tick),
        creature: wave.creature,
        count: String(wave.count),
        intervalText: formatTicks(wave.interval),
        lane: String(wave.lane),
      })),
    };
    state.selectedLevelId = level.id;
    editorSection.hidden = false;
    fillEditor(level);
  }

  let selectedEditorCell: string | null = null;

  function fillEditor(level: LevelShape): void {
    const title = document.getElementById('level-title') as HTMLInputElement;
    const description = document.getElementById('level-description') as HTMLTextAreaElement;
    const seed = document.getElementById('level-seed') as HTMLInputElement;
    const difficulty = document.getElementById('level-difficulty') as HTMLSelectElement;
    if (!draft) return;
    title.value = draft.title;
    description.value = draft.description;
    seed.value = draft.seed;
    difficulty.value = draft.difficulty;
    title.addEventListener('input', () => {
      if (draft) draft.title = title.value;
    });
    description.addEventListener('input', () => {
      if (draft) draft.description = description.value;
    });
    seed.addEventListener('input', () => {
      if (draft) draft.seed = seed.value;
    });
    difficulty.addEventListener('change', () => {
      if (draft) draft.difficulty = difficulty.value;
    });
    renderCellGrid();
    renderWaves();
    renderRevision(level);
  }

  function renderCellGrid(): void {
    if (!draft) return;
    const grid = document.getElementById('editor-cell-grid')!;
    grid.innerHTML = allCells()
      .map((key) => {
        const [lane, cell] = key.split(':');
        const buildable = draft!.buildable.has(key);
        return `<div class="editor-cell${buildable ? ' buildable' : ' unbuildable'}${selectedEditorCell === key ? ' selected' : ''}" data-key="${key}" role="button" tabindex="0" aria-label="Lane ${lane}, cell ${cell}${buildable ? ', buildable' : ', unbuildable'}"></div>`;
      })
      .join('');
    grid.querySelectorAll<HTMLElement>('.editor-cell').forEach((element) => {
      element.addEventListener('click', () => {
        selectedEditorCell = element.dataset.key ?? null;
        const [lane, cell] = (selectedEditorCell ?? '').split(':');
        const label = document.getElementById('editor-selected-cell')!;
        label.textContent = `Selected lane ${lane}, cell ${cell}.`;
        renderCellGrid();
      });
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          element.click();
        }
      });
    });
  }

  function renderWaves(): void {
    if (!draft) return;
    const body = document.getElementById('waves-body')!;
    body.innerHTML = draft.waves
      .map(
        (wave, index) => `
        <tr data-wave="${index}">
          <td><input type="text" class="wave-time" value="${escapeAttr(wave.tickText)}" aria-label="Wave ${index + 1} time"></td>
          <td><select class="wave-creature" aria-label="Wave ${index + 1} creature">${CREATURES.map((creature) => `<option value="${creature.id}" ${creature.id === wave.creature ? 'selected' : ''}>${creature.name}</option>`).join('')}</select></td>
          <td><input type="number" class="wave-count" min="1" value="${escapeAttr(wave.count)}" aria-label="Wave ${index + 1} count"></td>
          <td><input type="text" class="wave-interval" value="${escapeAttr(wave.intervalText)}" aria-label="Wave ${index + 1} interval"></td>
          <td><input type="number" class="wave-lane" min="0" max="5" value="${escapeAttr(wave.lane)}" aria-label="Wave ${index + 1} lane"></td>
          <td><button class="remove-wave" data-index="${index}" aria-label="Remove wave ${index + 1}">Remove</button></td>
        </tr>`,
      )
      .join('');
    body.querySelectorAll<HTMLInputElement>('.wave-time').forEach((input) => {
      input.addEventListener('input', () => {
        if (!draft) return;
        const index = Number(input.closest('tr')!.dataset.wave);
        draft.waves[index].tickText = input.value;
      });
    });
    body.querySelectorAll<HTMLSelectElement>('.wave-creature').forEach((select) => {
      select.addEventListener('change', () => {
        if (!draft) return;
        const index = Number(select.closest('tr')!.dataset.wave);
        draft.waves[index].creature = select.value;
      });
    });
    body.querySelectorAll<HTMLInputElement>('.wave-count').forEach((input) => {
      input.addEventListener('input', () => {
        if (!draft) return;
        const index = Number(input.closest('tr')!.dataset.wave);
        draft.waves[index].count = input.value;
      });
    });
    body.querySelectorAll<HTMLInputElement>('.wave-interval').forEach((input) => {
      input.addEventListener('input', () => {
        if (!draft) return;
        const index = Number(input.closest('tr')!.dataset.wave);
        draft.waves[index].intervalText = input.value;
      });
    });
    body.querySelectorAll<HTMLInputElement>('.wave-lane').forEach((input) => {
      input.addEventListener('input', () => {
        if (!draft) return;
        const index = Number(input.closest('tr')!.dataset.wave);
        draft.waves[index].lane = input.value;
      });
    });
    body.querySelectorAll<HTMLButtonElement>('.remove-wave').forEach((button) => {
      button.addEventListener('click', () => {
        if (!draft) return;
        const index = Number(button.dataset.index);
        draft.waves.splice(index, 1);
        renderWaves();
      });
    });
  }

  document.getElementById('toggle-buildable')?.addEventListener('click', () => {
    if (!draft || !selectedEditorCell) return;
    if (draft.buildable.has(selectedEditorCell)) {
      draft.buildable.delete(selectedEditorCell);
    } else {
      draft.buildable.add(selectedEditorCell);
    }
    renderCellGrid();
  });

  document.getElementById('add-wave')?.addEventListener('click', () => {
    if (!draft) return;
    draft.waves.push({ tickText: formatTicks(DRAFT_DEFAULTS.wave.tick), creature: DRAFT_DEFAULTS.wave.creature, count: String(DRAFT_DEFAULTS.wave.count), intervalText: formatTicks(DRAFT_DEFAULTS.wave.interval), lane: String(DRAFT_DEFAULTS.wave.lane) });
    renderWaves();
  });

  function draftToDefinition(): Definition | null {
    if (!draft) return null;
    const waves: Array<{ tick: number; creature: string; count: number; interval: number; lane: number }> = [];
    for (const wave of draft.waves) {
      const tick = parseTicks(wave.tickText);
      const interval = parseTicks(wave.intervalText);
      const count = Number(wave.count);
      const lane = Number(wave.lane);
      if (tick === null || interval === null || !Number.isInteger(count) || count < 1 || !Number.isInteger(lane)) {
        return null;
      }
      waves.push({ tick, creature: wave.creature, count, interval, lane });
    }
    return {
      title: draft.title,
      description: draft.description,
      difficulty: draft.difficulty as Definition['difficulty'],
      seed: Number(draft.seed),
      buildable: [...draft.buildable].map((key) => {
        const [lane, cell] = key.split(':').map(Number);
        return { lane, cell };
      }),
      waves,
    };
  }

  document.getElementById('save-level')?.addEventListener('click', async () => {
    if (!draft || !draft.id) return;
    clearError();
    const button = document.getElementById('save-level') as HTMLButtonElement;
    const restore = disabledWhilePending(button);
    announceStatus('Saving private level…');
    const definition = draftToDefinition();
    if (!definition) {
      announceStatus('Check the wave fields: times must match mm:ss.ttt on tick boundaries.');
      restore();
      return;
    }
    try {
      const { data } = await api<LevelShape>('PUT', `/api/levels/${draft.id}`, {
        expectedRevision: draft.revision,
        definition,
      });
      announceStatus('Private level saved.');
      openDraftFromLevel(data);
      refreshLevels();
    } catch (e) {
      handleApiError(e);
      restore();
    }
  });

  document.getElementById('playtest')?.addEventListener('click', async () => {
    if (!draft || !draft.id) return;
    clearError();
    const button = document.getElementById('playtest') as HTMLButtonElement;
    const restore = disabledWhilePending(button);
    announceStatus('Preparing the encounter…');
    try {
      const { data } = await api<{ ticket: import('../api.js').Ticket }>('POST', '/api/runs', {
        mode: 'playtest',
        sourceId: draft.id,
        revision: draft.revision,
        loadout: ['wick', 'chime', 'siphon', 'wall'],
      });
      state.ticket = data.ticket;
      await api('POST', `/api/runs/${data.ticket.id}/start`, {});
      announceStatus('Encounter ready.');
      import('../app.js').then((m) => m.navigate('defence'));
    } catch (e) {
      handleApiError(e);
      restore();
    }
  });

  document.getElementById('publish-challenge')?.addEventListener('click', async () => {
    await performPublish(false);
  });
  document.getElementById('retry-publication')?.addEventListener('click', async () => {
    await performPublish(true);
  });

  async function performPublish(retry: boolean): Promise<void> {
    if (!draft || !draft.id) return;
    clearError();
    const button = (retry ? document.getElementById('retry-publication') : document.getElementById('publish-challenge')) as HTMLButtonElement;
    const restore = disabledWhilePending(button);
    announceStatus('Preparing publication…');
    // Publication requires a qualified proof; ask for the newest qualified proof.
    try {
      const { data } = await api<LevelShape>('GET', `/api/levels/${draft.id}`);
      const qualified = data.proofs.find((p) => p.state === 'qualified');
      if (!qualified) {
        announceStatus('Verify a winning playtest for this saved revision first.');
        restore();
        return;
      }
      const { status } = await api('POST', `/api/levels/${draft.id}/publish`, {
        expectedRevision: draft.revision,
        proofRunId: qualified.runId,
      });
      if (status === 202) {
        announceStatus('Publication pending. Your challenge is still private; retry publication.');
      } else {
        announceStatus('Challenge published.');
        renderRevision(data);
        refreshLevels();
      }
    } catch (e) {
      handleApiError(e);
      restore();
    }
  }

  document.getElementById('withdraw-level')?.addEventListener('click', async () => {
    if (!draft || !draft.id) return;
    clearError();
    const button = document.getElementById('withdraw-level') as HTMLButtonElement;
    const restore = disabledWhilePending(button);
    announceStatus('Withdrawing challenge…');
    try {
      await api('POST', `/api/levels/${draft.id}/withdraw`, { expectedRevision: draft.revision });
      announceStatus('Challenge withdrawn.');
      editorSection.hidden = true;
      draft = null;
      refreshLevels();
    } catch (e) {
      handleApiError(e);
      restore();
    }
  });

  function renderRevision(level: LevelShape): void {
    const region = document.getElementById('saved-revision')!;
    const proofs = level.proofs
      .map((proof) => `Run ${proof.runId.slice(0, 8)}… — revision ${proof.revision} — ${proof.state}`)
      .join('<br>');
    region.innerHTML = `
      <p>Saved revision ${level.revision} — digest ${level.digest.slice(0, 12)}… — state ${level.state}.</p>
      <p>Proof history:<br>${proofs || 'No proofs yet.'}</p>
      <p>Proof run: ${level.proofRunId ?? 'none'}. Indexing: ${level.indexing}.</p>
    `;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
