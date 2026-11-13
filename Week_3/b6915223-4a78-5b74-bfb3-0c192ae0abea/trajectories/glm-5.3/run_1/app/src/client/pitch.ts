import { api, ApiError, type SquadPlayer, type SquadView, type PlayerRow } from './api';
import { formatMillions } from '../shared/format';
import { POSITION_LABELS } from '../shared/domain';
import type { Screen } from './screens';
import { announceOnce, pendingButton, reducedMotion } from './dialog';

export interface PitchHandlers {
  onSwap: (outId: string, inId: string) => Promise<SquadView | ApiError>;
  onCaptain: (playerId: string) => Promise<SquadView | ApiError>;
  onVice: (playerId: string) => Promise<SquadView | ApiError>;
  onUpdate: () => void;
  isEditable: () => boolean;
  onBenchSwap: (a: string, b: string) => Promise<SquadView | ApiError>;
  mode: 'team' | 'transfers';
  builderSlots?: Map<string, number>;
  onToggleOut?: (playerId: string) => void;
  onFillSlot?: (playerId: string, position: string) => void;
  outsMarked?: Set<string>;
  playersList?: PlayerRow[];
  builderMode: boolean;
  liveRelay?: (playerId: string, delta: number, tagged: boolean) => void;
}

const POSITION_ORDER = ['GK', 'DEF', 'MID', 'FWD'] as const;

export interface PitchModel {
  rows: { position: string; players: SquadPlayer[] }[];
  bench: SquadPlayer[];
}

export function buildPitchModel(players: SquadPlayer[], view: 'pitch' | 'list'): PitchModel {
  const starters = players
    .filter((player) => player.slot === 'starting')
    .sort((a, b) => {
      const order = POSITION_ORDER.indexOf(a.position as (typeof POSITION_ORDER)[number]) - POSITION_ORDER.indexOf(b.position as (typeof POSITION_ORDER)[number]);
      if (order !== 0) return order;
      return a.id < b.id ? -1 : 1;
    });
  const bench = players
    .filter((player) => player.slot === 'bench')
    .sort((a, b) => (a.bench_order ?? 0) - (b.bench_order ?? 0));
  if (view === 'list') {
    return { rows: [{ position: 'Starters', players: starters }], bench };
  }
  const rows = POSITION_ORDER.map((position) => ({
    position,
    players: starters.filter((player) => player.position === position),
  }));
  return { rows, bench };
}

export function playerPositions(players: SquadPlayer[]): Map<string, string> {
  return new Map(players.map((player) => [player.id, player.position]));
}

export interface PitchFocusState {
  lastShirtId: string | null;
}

export function createShirtGrid(
  container: HTMLElement,
  model: PitchModel,
  handlers: PitchHandlers,
  updates: HTMLElement,
  squad: SquadView | null,
  focusState: PitchFocusState,
  live: boolean,
): void {
  container.innerHTML = '';
  const editable = handlers.isEditable();
  const selected: { id: string | null } = { id: null };

  const grid = document.createElement('div');
  grid.className = 'pitch-rows';

  const shirtIds: string[] = [];
  const rowArrays: string[][] = [];

  model.rows.forEach((row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'pitch-row';
    rowEl.dataset.position = row.position;
    const rowIds: string[] = [];
    row.players.forEach((player) => {
      rowIds.push(player.id);
      shirtIds.push(player.id);
    });
    rowArrays.push(rowIds);
    row.players.forEach((player) => {
      rowEl.appendChild(shirtFor(player, editable, handlers, updates, squad, selected, live, focusState, handlers.outsMarked));
    });
    grid.appendChild(rowEl);
  });

  const benchGroup = document.createElement('div');
  benchGroup.setAttribute('role', 'group');
  benchGroup.setAttribute('aria-label', 'Bench');
  benchGroup.className = 'bench-tray';
  const benchIds: string[] = [];
  model.bench.forEach((player) => {
    benchIds.push(player.id);
    shirtIds.push(player.id);
  });
  rowArrays.push(benchIds);
  model.bench.forEach((player) => {
    benchGroup.appendChild(shirtFor(player, editable, handlers, updates, squad, selected, live, focusState, handlers.outsMarked));
  });

  container.appendChild(grid);
  container.appendChild(benchGroup);

  const allButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-player-id]'));
  const indexById = new Map(allButtons.map((button, index) => [button.dataset.playerId ?? '', index]));

  const rowIndexOf = (id: string): number => rowArrays.findIndex((row) => row.includes(id));

  container.setAttribute('tabindex', '0');
  container.dataset.keyboard = 'grid';

  container.addEventListener('keydown', (event) => {
    const active = document.activeElement as HTMLElement | null;
    if (active === null) return;
    const playerId = active.dataset.playerId;
    if (playerId === undefined && active !== container) return;
    if (event.key === 'Tab' && !event.shiftKey) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' ', 'Escape', 'c', 'C', 'v', 'V'].includes(event.key)) {
      if (active === container) {
        const firstId = focusState.lastShirtId ?? shirtIds[0];
        const first = container.querySelector<HTMLButtonElement>(`[data-player-id="${firstId}"]`);
        if (first !== null) {
          event.preventDefault();
          first.focus();
          return;
        }
      }
    }
    if (playerId === undefined) return;
    const row = rowArrays[rowIndexOf(playerId)] ?? [];
    const positionInRow = row.indexOf(playerId);
    const handle = (nextId: string | undefined): void => {
      if (nextId === undefined) return;
      const next = container.querySelector<HTMLButtonElement>(`[data-player-id="${nextId}"]`);
      if (next !== null) {
        event.preventDefault();
        next.focus();
        focusState.lastShirtId = nextId;
      }
    };
    switch (event.key) {
      case 'ArrowLeft':
        handle(row[Math.max(0, positionInRow - 1)]);
        break;
      case 'ArrowRight':
        handle(row[Math.min(row.length - 1, positionInRow + 1)]);
        break;
      case 'ArrowUp': {
        const rowIndex = rowIndexOf(playerId);
        const above = rowArrays[rowIndex - 1] ?? [];
        handle(above[Math.min(positionInRow, above.length - 1)] ?? above[0]);
        break;
      }
      case 'ArrowDown': {
        const rowIndex = rowIndexOf(playerId);
        const below = rowArrays[rowIndex + 1] ?? [];
        handle(below[Math.min(positionInRow, below.length - 1)] ?? below[0]);
        break;
      }
      case 'Home':
        handle(row[0]);
        break;
      case 'End':
        handle(row[row.length - 1]);
        break;
      case 'Enter':
      case ' ':
        if (editable) {
          event.preventDefault();
          actOn(playerId);
        }
        break;
      case 'Escape':
        event.preventDefault();
        if (handlers.mode === 'transfers' && handlers.onToggleOut !== undefined) {
          const outs = Array.from(handlers.outsMarked ?? new Set<string>());
          const unmatched = outs.filter((id) => !(handlers.builderMode ? false : false));
          const last = outs.filter((id) => !isReplaced(id)).pop();
          if (last !== undefined && !isReplaced(last)) {
            handlers.onToggleOut(last);
            return;
          }
          return;
        }
        if (selected.id !== null) {
          selected.id = null;
          renderSelection();
          const active2 = document.activeElement as HTMLElement | null;
          if (active2 !== null) active2.focus();
        }
        break;
      case 'c':
      case 'C':
        if (editable && handlers.mode === 'team') {
          const target = selected.id ?? playerId;
          event.preventDefault();
          void applyCaptain(target);
        }
        break;
      case 'v':
      case 'V':
        if (editable && handlers.mode === 'team') {
          const target = selected.id ?? playerId;
          event.preventDefault();
          void applyVice(target);
        }
        break;
      default:
        break;
    }
  });

  const replacedBy = new Map<string, string>();
  const isReplaced = (id: string): boolean => replacedBy.has(id);

  function renderSelection(): void {
    allButtons.forEach((button) => {
      const id = button.dataset.playerId ?? '';
      button.setAttribute('aria-pressed', selected.id === id ? 'true' : 'false');
      button.classList.toggle('is-selected', selected.id === id);
      const marked = handlers.outsMarked?.has(id) ?? false;
      button.classList.toggle('is-out', marked);
      const tag = button.querySelector('.shirt-tag');
      if (tag !== null) tag.textContent = marked ? 'Out' : '';
    });
    const toolbar = document.querySelector<HTMLDivElement>('[data-player-actions]');
    if (toolbar !== null) {
      toolbar.parentElement?.removeChild(toolbar);
    }
    if (selected.id !== null && handlers.mode === 'team') {
      mountToolbar();
    }
  }

  function actOn(playerId: string): void {
    if (handlers.mode === 'transfers') {
      if (handlers.builderMode) {
        handlers.onFillSlot?.(playerId, positionOfPlayer(playerId));
        return;
      }
      handlers.onToggleOut?.(playerId);
      return;
    }
    if (selected.id === null) {
      selected.id = playerId;
      renderSelection();
      const button = container.querySelector<HTMLButtonElement>(`[data-player-id="${playerId}"]`);
      button?.focus();
      return;
    }
    if (selected.id === playerId) {
      selected.id = null;
      renderSelection();
      return;
    }
    const first = playersById().get(selected.id);
    const second = playersById().get(playerId);
    if (first === undefined || second === undefined) {
      selected.id = playerId;
      renderSelection();
      return;
    }
    if (first.slot === 'starting' && second.slot === 'bench') {
      void applySwap(selected.id, playerId);
    } else if (first.slot === 'bench' && second.slot === 'starting') {
      void applySwap(playerId, selected.id);
    } else if (first.slot === 'bench' && second.slot === 'bench') {
      void applyBenchSwap(selected.id, playerId);
    } else {
      selected.id = playerId;
      renderSelection();
    }
  }

  function positionOfPlayer(id: string): string {
    return playersById().get(id)?.position ?? 'GK';
  }

  function playersById(): Map<string, SquadPlayer> {
    return new Map((squad?.players ?? []).map((player) => [player.id, player]));
  }

  async function applySwap(outId: string, inId: string): Promise<void> {
    if (squad === null) return;
    const starting = squad.players.filter((p) => p.slot === 'starting').map((p) => p.id);
    const bench = squad.players.filter((p) => p.slot === 'bench').sort((a, b) => (a.bench_order ?? 0) - (b.bench_order ?? 0)).map((p) => p.id);
    const startIndex = starting.indexOf(outId);
    const benchIndex = bench.indexOf(inId);
    const nextStarting = [...starting];
    const nextBench = [...bench];
    if (startIndex >= 0 && benchIndex >= 0) {
      nextStarting[startIndex] = inId;
      nextBench[benchIndex] = outId;
      selected.id = null;
      renderSelection();
      const result = await handlers.onSwap(outId, inId);
      if (result instanceof ApiError) return;
      const inName = result.players.find((p) => p.id === inId)?.name ?? '';
      const outName = result.players.find((p) => p.id === outId)?.name ?? '';
      announceOnce(updates, `${inName} moves into the eleven for ${outName}.`);
    }
  }

  async function applyBenchSwap(a: string, b: string): Promise<void> {
    selected.id = null;
    renderSelection();
    const result = await handlers.onBenchSwap(a, b);
    if (result instanceof ApiError) return;
    announceOnce(updates, 'Bench order saved.');
  }

  async function applyCaptain(playerId: string): Promise<void> {
    selected.id = null;
    renderSelection();
    const result = await handlers.onCaptain(playerId);
    if (result instanceof ApiError) return;
    const name = result.players.find((p) => p.id === playerId)?.name ?? '';
    announceOnce(updates, `${name} is now captain.`);
  }

  async function applyVice(playerId: string): Promise<void> {
    selected.id = null;
    renderSelection();
    const result = await handlers.onVice(playerId);
    if (result instanceof ApiError) return;
    const name = result.players.find((p) => p.id === playerId)?.name ?? '';
    announceOnce(updates, `${name} is now vice-captain.`);
  }

  function mountToolbar(): void {
    if (selected.id === null) return;
    const toolbar = document.createElement('div');
    toolbar.className = 'player-actions';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Player actions');
    toolbar.dataset.playerActions = '';
    const captainButton = document.createElement('button');
    captainButton.type = 'button';
    captainButton.textContent = 'Make captain';
    captainButton.disabled = !handlers.isEditable();
    captainButton.addEventListener('click', () => void applyCaptain(selected.id ?? ''));
    const viceButton = document.createElement('button');
    viceButton.type = 'button';
    viceButton.textContent = 'Make vice-captain';
    viceButton.disabled = !handlers.isEditable();
    viceButton.addEventListener('click', () => void applyVice(selected.id ?? ''));
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel selection';
    cancelButton.addEventListener('click', () => {
      selected.id = null;
      renderSelection();
    });
    toolbar.append(captainButton, viceButton, cancelButton);
    const rail = document.querySelector('[data-rail]');
    (rail ?? container).appendChild(toolbar);
  }

  renderSelection();
  void indexById;
}

function shirtFor(
  player: SquadPlayer,
  editable: boolean,
  handlers: PitchHandlers,
  updates: HTMLElement,
  squad: SquadView | null,
  selected: { id: string | null },
  live: boolean,
  focusState: PitchFocusState,
  outsMarked: Set<string> | undefined,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.playerId = player.id;
  button.dataset.points = String(player.team_points);
  button.setAttribute('aria-pressed', 'false');
  const figure = live ? `${player.team_points}` : formatMillions(player.price_tenths);
  const suffix = player.captain ? ', captain' : player.vice_captain ? ', vice-captain' : '';
  button.setAttribute('aria-label', `${player.name}, ${POSITION_LABELS[player.position]}, ${player.team_points} points${suffix}`);
  button.className = 'shirt';
  const badge = document.createElement('span');
  badge.className = 'shirt-badge';
  badge.textContent = player.club;
  const nameEl = document.createElement('span');
  nameEl.className = 'shirt-name';
  nameEl.textContent = shortNameOf(player.name);
  const figureEl = document.createElement('span');
  figureEl.className = 'shirt-figure';
  figureEl.textContent = figure;
  const arm = document.createElement('span');
  arm.className = 'shirt-arm';
  arm.textContent = player.captain ? 'C' : player.vice_captain ? 'V' : '';
  arm.setAttribute('aria-hidden', 'true');
  const tag = document.createElement('span');
  tag.className = 'shirt-tag';
  tag.textContent = outsMarked?.has(player.id) ? 'Out' : '';
  button.append(badge, nameEl, figureEl, arm, tag);
  button.addEventListener('click', () => {
    focusState.lastShirtId = player.id;
    if (editable) actOnShirt();
    else renderShirtStates();
    function actOnShirt(): void {
      if (handlers.mode === 'transfers') {
        if (handlers.builderMode) {
          handlers.onFillSlot?.(player.id, player.position);
          return;
        }
        handlers.onToggleOut?.(player.id);
        renderShirtStates();
        return;
      }
      if (selected.id === null) {
        selected.id = player.id;
        renderShirtStates();
        return;
      }
      if (selected.id === player.id) {
        selected.id = null;
        renderShirtStates();
        return;
      }
      const first = squad?.players.find((p) => p.id === selected.id);
      if (first === undefined) {
        selected.id = player.id;
        renderShirtStates();
        return;
      }
      if (first.slot === 'starting' && player.slot === 'bench') {
        void swapOut(first.id, player.id);
      } else if (first.slot === 'bench' && player.slot === 'starting') {
        void swapOut(player.id, first.id);
      } else if (first.slot === 'bench' && player.slot === 'bench') {
        void benchSwap(first.id, player.id);
      } else {
        selected.id = player.id;
        renderShirtStates();
      }
    }

    async function swapOut(outId: string, inId: string): Promise<void> {
      if (squad === null) return;
      selected.id = null;
      renderShirtStates();
      const result = await handlers.onSwap(outId, inId);
      if (result instanceof ApiError) return;
      const inName = result.players.find((p) => p.id === inId)?.name ?? '';
      const outName = result.players.find((p) => p.id === outId)?.name ?? '';
      announceOnce(updates, `${inName} moves into the eleven for ${outName}.`);
    }

    async function benchSwap(a: string, b: string): Promise<void> {
      selected.id = null;
      renderShirtStates();
      const result = await handlers.onBenchSwap(a, b);
      if (result instanceof ApiError) return;
      announceOnce(updates, 'Bench order saved.');
    }

    function renderShirtStates(): void {
      const allButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-player-id]'));
      allButtons.forEach((b) => {
        const id = b.dataset.playerId ?? '';
        b.setAttribute('aria-pressed', selected.id === id ? 'true' : 'false');
        b.classList.toggle('is-selected', selected.id === id);
        const marked = outsMarked?.has(id) ?? false;
        b.classList.toggle('is-out', marked);
        const t = b.querySelector('.shirt-tag');
        if (t !== null) t.textContent = marked ? 'Out' : '';
      });
    }
  });
  if (outsMarked?.has(player.id) === true) button.classList.add('is-out');
  return button;
}

function shortNameOf(name: string): string {
  return name.split(' ').slice(1).join(' ') || name;
}

export { reducedMotion };
