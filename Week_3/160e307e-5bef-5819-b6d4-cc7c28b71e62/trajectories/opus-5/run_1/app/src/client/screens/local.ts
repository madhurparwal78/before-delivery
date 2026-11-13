import { api, ApiFailure } from '../api.js';
import { clear, el } from '../dom.js';
import { LocalGame } from '../localgame.js';
import { MatchPlay } from '../matchplay.js';
import { onLeave } from '../router.js';
import { refreshMe, state } from '../store.js';
import { radioGroup, switchControl } from '../ui.js';
import type { Format } from '../../shared/types.js';

const PENDING_KEY = 'dc_pending_local';

interface PendingSave {
  format: Format;
  players: { name: string }[];
  shots: { seat: 0 | 1; x: number; dx: number; dy: number; p: number }[];
  resignedSeat: 0 | 1 | null;
  claimed: { winnerSeat: 0 | 1; scores: [number, number] };
  modelVersion: string;
  idempotencyKey: string;
}

function pending(): PendingSave[] {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    return raw === null ? [] : (JSON.parse(raw) as PendingSave[]);
  } catch {
    return [];
  }
}

function writePending(list: PendingSave[]): void {
  window.localStorage.setItem(PENDING_KEY, JSON.stringify(list));
}

/** A finished pass-and-play match is kept on the device until the server records it. */
export async function flushPendingLocalMatches(): Promise<void> {
  const list = pending();
  if (list.length === 0) return;
  const left: PendingSave[] = [];
  for (const entry of list) {
    try {
      await api.post('/api/local-matches', entry);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 503) left.push(entry);
    }
  }
  writePending(left);
}

export function startPendingLoop(): void {
  void flushPendingLocalMatches();
  window.setInterval(() => void flushPendingLocalMatches(), 30000);
}

export async function renderLocal(_params: Record<string, string>, view: HTMLElement): Promise<void> {
  await refreshMe();
  let format: Format = 'quick';
  let turnBoard = true;

  const player1 = el('input', { type: 'text', 'aria-label': 'Player 1 name', value: 'Player 1', maxlength: '16' });
  const player2 = el('input', { type: 'text', 'aria-label': 'Player 2 name', value: 'Player 2', maxlength: '16' });
  const start = el('button', { type: 'submit', text: 'Start' });

  const form = el('form', { class: 'stack' }, [
    el('h1', { class: 'display', text: 'Pass and play', style: 'font-size: var(--step-4)' }),
    radioGroup(
      'Format',
      [
        { value: 'quick', label: 'Quick' },
        { value: 'classic', label: 'Classic' },
      ],
      'quick',
      (next) => {
        format = next as Format;
      },
    ),
    el('div', {}, [el('label', { text: 'Player 1 name' }), player1]),
    el('div', {}, [el('label', { text: 'Player 2 name' }), player2]),
    switchControl('Turn the board each turn', true, (next) => {
      turnBoard = next;
    }),
    el('div', { class: 'row' }, [start]),
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const names: [string, string] = [player1.value || 'Player 1', player2.value || 'Player 2'];
    playLocal(view, format, names, turnBoard);
  });

  clear(view);
  view.append(el('section', { class: 'field field--ground' }, [el('div', { class: 'sheet' }, [form])]));
}

function playLocal(view: HTMLElement, format: Format, names: [string, string], turnBoard: boolean): void {
  const game = new LocalGame(format, names);
  const key = `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const play: MatchPlay = new MatchPlay(
    game.json(),
    {
      local: true,
      mySeat: null,
      turnBoard,
      privateRoom: false,
      shoot: (intent) => {
        const result = game.play(intent);
        play.applyShotResult(result);
        if (game.status !== 'active') void save();
      },
      preview: () => undefined,
      resign: () => {
        game.resign();
        play.openMatchOver(game.json(), null);
        void save();
      },
    },
    state.me?.equipped ?? { striker: 'striker-ply', board: 'board-ply', coins: 'coins-ivory' },
  );

  async function save(): Promise<void> {
    const body: PendingSave = {
      format,
      players: [{ name: names[0] }, { name: names[1] }],
      shots: game.shots,
      resignedSeat: game.resignedSeat,
      claimed: {
        winnerSeat: game.winnerSeat ?? 0,
        scores: [game.state.scores[0], game.state.scores[1]],
      },
      modelVersion: state.config.modelVersion,
      idempotencyKey: key,
    };
    play.setSaveStatus('Saving...');
    try {
      const saved = await api.post<{ chalkEarned: number }>('/api/local-matches', body);
      play.setChalkEarned(saved.chalkEarned);
      play.setSaveStatus('Saved to your history.');
    } catch {
      writePending([...pending(), body]);
      play.setSaveStatus('Saved on this device. It will be added to your history when online.');
    }
  }

  onLeave(() => play.destroy());
  clear(view);
  view.append(play.dom.root);
  play.focusBoard();
}
