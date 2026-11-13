import { copy } from '../../shared/copy';
import type { Direction } from '../../shared/grid';
import { el } from '../dom';
import { api, ApiFailure } from '../api';
import type { LayoutMode } from '../state';
import { openMenu, dialogsOpen } from '../ui/overlay';
import {
  openClearPuzzleDialog,
  openSettingsDialog,
  openShareDialog,
} from './dialogs';
import { handleGridKey, handleRoomShortcut, type RoomUi } from './keys';
import { key, Room, type RoomElements } from './session';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** An inline line-drawn arrow, hidden from the accessible name. */
function arrowIcon(direction: 'left' | 'right'): HTMLElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '20');
  icon.setAttribute('height', '20');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', direction === 'left' ? 'M15 4 L7 12 L15 20' : 'M9 4 L17 12 L9 20');
  icon.append(path);
  return icon as unknown as HTMLElement;
}

function buildGrid(room: Room): { grid: HTMLElement; cells: Map<string, HTMLElement> } {
  const cells = new Map<string, HTMLElement>();
  const rows: HTMLElement[] = [];
  for (let r = 0; r < room.puzzle.rows; r += 1) {
    const row = el('div', { role: 'row', class: 'grid-row' });
    for (let c = 0; c < room.puzzle.cols; c += 1) {
      if (room.puzzle.blocks[r][c] === '#') {
        row.append(el('div', { role: 'gridcell', 'aria-label': 'Black square', class: 'cell black' }));
        continue;
      }
      const number = room.puzzle.numbers.find((n) => n.row === r && n.col === c);
      const cell = el(
        'div',
        {
          role: 'gridcell',
          id: `sq-${r}-${c}`,
          class: 'cell',
          'data-row': r,
          'data-col': c,
          'data-number': number ? number.number : null,
          'aria-selected': 'false',
        },
        [
          number ? el('span', { class: 'cell-number', text: String(number.number) }) : null,
          el('span', { class: 'letter' }),
          el('span', { class: 'cursors' }),
        ],
      );
      cell.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (room.selection.row === r && room.selection.col === c) room.switchDirection();
        else room.setSelection({ row: r, col: c, direction: room.selection.direction });
        room.elements?.grid.focus();
      });
      cells.set(key(r, c), cell);
      row.append(cell);
    }
    rows.push(row);
  }
  const grid = el(
    'div',
    {
      role: 'grid',
      'aria-label': 'Puzzle grid',
      class: 'grid',
      tabindex: '0',
      'data-direction': room.selection.direction,
      'data-pivot': 'idle',
      style: `--cols:${room.puzzle.cols};--rows:${room.puzzle.rows}`,
    },
    rows,
  );
  return { grid, cells };
}

function buildClueList(
  room: Room,
  direction: Direction,
): { list: HTMLElement; items: Map<string, HTMLElement> } {
  const items = new Map<string, HTMLElement>();
  const clues = direction === 'across' ? room.puzzle.clues.across : room.puzzle.clues.down;
  const list = el('div', {
    role: 'list',
    'aria-label': direction === 'across' ? 'Across clues' : 'Down clues',
    class: 'tile clue-tile',
  });
  for (const clue of clues) {
    const item = el(
      'div',
      {
        role: 'listitem',
        class: 'clue-item',
        'aria-label': `${clue.number} ${clue.text}`,
        onclick: () => {
          const word = room.layout.words.find(
            (candidate) => candidate.number === clue.number && candidate.direction === direction,
          );
          if (word) room.goToWord(word);
          room.elements?.grid.focus();
        },
      },
      [
        el('span', { class: 'clue-number', text: String(clue.number) }),
        el('span', { class: 'clue-body', text: clue.text }),
      ],
    );
    items.set(`${direction}:${clue.number}`, item);
    list.append(item);
  }
  return { list, items };
}

function openRebus(room: Room): void {
  if (room.rebusOpen || room.readOnly || room.watching) return;
  const cell = room.elements?.cells.get(key(room.selection.row, room.selection.col));
  if (!cell) return;
  room.rebusOpen = true;
  const input = el('input', {
    type: 'text',
    class: 'rebus-input',
    'aria-label': 'Rebus entry',
    value: room.square(room.selection.row, room.selection.col).value,
  }) as HTMLInputElement;
  const finish = (): void => {
    room.rebusOpen = false;
    input.remove();
    room.elements?.grid.focus();
  };
  input.addEventListener('input', () => {
    input.value = input.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);
  });
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      const value = input.value;
      finish();
      room.writeLetter(value, room.pencil);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish();
    }
  });
  cell.append(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function scopeWrite(room: Room, type: 'check' | 'reveal' | 'clear', scope: string): void {
  const message: Record<string, unknown> = { type, scope };
  if (scope !== 'puzzle') {
    message.row = room.selection.row;
    message.col = room.selection.col;
  }
  if (scope === 'word') message.direction = room.selection.direction;
  room.send(message);
}

export interface RoomView {
  ui: RoomUi;
  patchRace: () => void;
}

export function buildRoom(room: Room, container: HTMLElement, layout: LayoutMode): RoomView {
  const race = room.game.mode === 'race';
  const racing = room.game.race_state === 'racing';
  const { grid, cells } = buildGrid(room);
  const across = buildClueList(room, 'across');
  const down = buildClueList(room, 'down');
  const clueItems = new Map([...across.items, ...down.items]);

  const band = el('div', { class: 'band ink', role: 'alert', hidden: true });
  const timer = el('div', {
    role: 'timer',
    'aria-label': 'Solve time',
    class: 'timer',
    'data-timer-state': room.game.timer_state,
    text: '0:00',
  });
  const roomBar = el('div', { class: 'tile room-bar' }, [
    el('h1', { class: 'room-title', text: room.game.puzzle_title }),
    timer,
  ]);

  const clueBar = el('div', { role: 'region', 'aria-label': 'Current clue', class: 'tile clue-bar' }, [
    layout === 'phone'
      ? el(
          'button',
          {
            type: 'button',
            class: 'button icon',
            'aria-label': 'Previous clue',
            onclick: () => {
              room.stepClue(-1);
              grid.focus();
            },
          },
          [arrowIcon('left')],
        )
      : null,
    el('p', { class: 'clue-text' }),
    layout === 'phone'
      ? el(
          'button',
          {
            type: 'button',
            class: 'button icon',
            'aria-label': 'Next clue',
            onclick: () => {
              room.stepClue(1);
              grid.focus();
            },
          },
          [arrowIcon('right')],
        )
      : null,
  ]);

  const gridTile = el('div', { class: 'tile ink grid-tile' }, [grid]);
  const players = el('div', { role: 'list', 'aria-label': 'Players', class: 'players' });
  const notices = el('div', { role: 'status', 'aria-label': 'Game notices', class: 'status notices' });
  const announcements = el('div', {
    role: 'status',
    'aria-label': 'Grid announcements',
    class: 'sr-only',
    'aria-live': 'polite',
  });

  const pauseButton = el('button', {
    type: 'button',
    class: 'button',
    text: 'Pause my timer',
    'aria-pressed': 'false',
  }) as HTMLButtonElement;
  pauseButton.addEventListener('click', () => {
    pauseButton.setAttribute('aria-pressed', room.togglePersonalPause() ? 'true' : 'false');
  });

  const pencilButton = el('button', {
    type: 'button',
    class: 'button',
    text: 'Pencil',
    'aria-pressed': 'false',
  }) as HTMLButtonElement;
  pencilButton.addEventListener('click', () => {
    room.setPencil(!room.pencil);
    grid.focus();
  });
  room.onPencilChanged = () => {
    for (const button of document.querySelectorAll('[data-pencil-toggle]')) {
      button.setAttribute('aria-pressed', room.pencil ? 'true' : 'false');
    }
  };
  pencilButton.dataset.pencilToggle = 'true';

  const rebusButton = el('button', {
    type: 'button',
    class: 'button',
    text: 'Rebus',
    onclick: () => openRebus(room),
  }) as HTMLButtonElement;

  const checkButton = el('button', {
    type: 'button',
    class: 'button',
    text: 'Check',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
  }) as HTMLButtonElement;
  const revealButton = el('button', {
    type: 'button',
    class: 'button',
    text: 'Reveal',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-disabled': race ? 'true' : null,
  }) as HTMLButtonElement;
  const clearButton = el('button', {
    type: 'button',
    class: 'button',
    text: 'Clear',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
  }) as HTMLButtonElement;

  const openCheckMenu = (): void => {
    openMenu(
      checkButton,
      'Check',
      [
        { label: 'Square', run: () => scopeWrite(room, 'check', 'square') },
        { label: 'Word', disabled: race, run: () => scopeWrite(room, 'check', 'word') },
        { label: 'Puzzle', disabled: race, run: () => scopeWrite(room, 'check', 'puzzle') },
      ],
      () => grid.focus(),
    );
  };
  const openRevealMenu = (): void => {
    if (race) return;
    openMenu(
      revealButton,
      'Reveal',
      [
        { label: 'Square', run: () => scopeWrite(room, 'reveal', 'square') },
        { label: 'Word', run: () => scopeWrite(room, 'reveal', 'word') },
        { label: 'Puzzle', run: () => scopeWrite(room, 'reveal', 'puzzle') },
      ],
      () => grid.focus(),
    );
  };
  const openClearMenu = (): void => {
    openMenu(
      clearButton,
      'Clear',
      [
        { label: 'Word', run: () => scopeWrite(room, 'clear', 'word') },
        {
          label: 'Puzzle',
          disabled: race,
          run: () => openClearPuzzleDialog(room),
        },
      ],
      () => {
        if (!dialogsOpen()) grid.focus();
      },
    );
  };
  checkButton.addEventListener('click', openCheckMenu);
  revealButton.addEventListener('click', openRevealMenu);
  clearButton.addEventListener('click', openClearMenu);

  const downloadOriginal = el('button', {
    type: 'button',
    class: 'button',
    text: 'Download original',
    onclick: () => {
      void (async () => {
        try {
          const response = await fetch(`/api/puzzles/${room.game.puzzle_id}/original`);
          if (response.status === 503) {
            room.showBand(copy.storageOutage);
            return;
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `${room.game.puzzle_id}.overlap.txt`;
          anchor.click();
          URL.revokeObjectURL(url);
          room.showBand(room.deadLink);
        } catch {
          room.showBand(copy.storageOutage);
        }
      })();
    },
  });

  const toolsTile = el('div', { class: 'tile tools' }, [
    pauseButton,
    layout === 'phone' ? null : pencilButton,
    layout === 'phone' ? null : rebusButton,
    checkButton,
    revealButton,
    clearButton,
    el('button', {
      type: 'button',
      class: 'button',
      text: 'Share',
      onclick: () => openShareDialog(room),
    }),
    el('button', {
      type: 'button',
      class: 'button',
      text: 'Settings',
      onclick: openSettingsDialog,
    }),
    room.puzzleIsUpload ? downloadOriginal : null,
  ]);
  const tools = el('div', { class: 'tools-area' }, [notices, toolsTile]);

  const keyboard =
    layout === 'phone'
      ? el('div', { role: 'group', 'aria-label': 'Letter keyboard', class: 'tile keyboard' }, [
          ...ALPHABET.map((letter) =>
            el('button', {
              type: 'button',
              class: 'key',
              text: letter,
              onclick: () => {
                const editor = document.querySelector<HTMLInputElement>('.rebus-input');
                if (editor) {
                  editor.value = (editor.value + letter).slice(0, 8);
                  return;
                }
                room.writeLetter(letter, room.pencil);
              },
            }),
          ),
          el('button', {
            type: 'button',
            class: 'key wide',
            text: 'Backspace',
            onclick: () => {
              const editor = document.querySelector<HTMLInputElement>('.rebus-input');
              if (editor) {
                editor.value = editor.value.slice(0, -1);
                return;
              }
              grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
            },
          }),
          el('button', {
            type: 'button',
            class: 'key wide',
            text: 'Rebus',
            onclick: () => {
              const editor = document.querySelector<HTMLInputElement>('.rebus-input');
              if (editor) {
                editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
                return;
              }
              openRebus(room);
            },
          }),
          (() => {
            const phonePencil = el('button', {
              type: 'button',
              class: 'key wide',
              text: 'Pencil',
              'aria-pressed': room.pencil ? 'true' : 'false',
              onclick: () => room.setPencil(!room.pencil),
            }) as HTMLButtonElement;
            phonePencil.dataset.pencilToggle = 'true';
            return phonePencil;
          })(),
          el('button', {
            type: 'button',
            class: 'key wide',
            text: 'Switch direction',
            onclick: () => room.switchDirection(),
          }),
        ])
      : null;

  const raceTile = race ? buildRaceTile(room, racing) : null;

  const order =
    layout === 'phone'
      ? [roomBar, clueBar, gridTile, keyboard, tools, raceTile, players, across.list, down.list]
      : [roomBar, clueBar, gridTile, across.list, down.list, raceTile, players, tools];
  const board = el(
    'div',
    { class: `board room room-${layout}`, 'data-me': room.seat?.colour ?? 'Teal' },
    order,
  );
  if (layout === 'phone') {
    across.list.hidden = true;
    down.list.hidden = true;
    across.list.setAttribute('inert', '');
    down.list.setAttribute('inert', '');
  }
  container.replaceChildren(band, board, announcements);

  const elements: RoomElements = {
    grid,
    cells,
    clueBar,
    clueItems,
    clueLists: { across: across.list, down: down.list },
    players,
    timer,
    announcements,
    notices,
    band,
    teamScores: raceTile ? raceTile.querySelector('.team-scores') : null,
    raceRadios: raceTile ? raceTile.querySelector('.team-radios') : null,
    startRace: raceTile ? raceTile.querySelector('.start-race') : null,
  };
  room.elements = elements;

  const ui: RoomUi = {
    openRebus: () => openRebus(room),
    openCheckMenu,
    openRevealMenu,
    openClearMenu,
    focusPauseButton: () => pauseButton.focus(),
  };

  grid.addEventListener('keydown', (event) => {
    if (room.rebusOpen || dialogsOpen()) return;
    if (event.altKey) return;
    handleGridKey(room, ui, event);
  });
  board.addEventListener('keydown', (event) => {
    if (dialogsOpen() || room.rebusOpen) return;
    handleRoomShortcut(room, ui, event);
  });

  const patchRace = (): void => {
    if (!raceTile) return;
    const started = room.game.race_state !== 'lobby';
    const seatNow = room.seat;
    const radios = raceTile.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    const values: (1 | 2 | null)[] = [1, 2, null];
    radios.forEach((input, index) => {
      input.checked = (seatNow?.team ?? null) === values[index];
      input.disabled = started;
      if (started) input.setAttribute('aria-disabled', 'true');
      else input.removeAttribute('aria-disabled');
    });
    const start = raceTile.querySelector<HTMLButtonElement>('.start-race');
    if (start) {
      const teams = new Set(room.game.players.map((player) => player.team));
      start.disabled = started || !teams.has(1) || !teams.has(2);
    }
    const scoresNode = raceTile.querySelector('.team-scores');
    const scores = room.game.scores ?? { '1': 0, '2': 0 };
    if (scoresNode) scoresNode.textContent = copy.teamScores(scores['1'], scores['2']);
  };

  return { ui, patchRace };
}

function buildRaceTile(room: Room, racing: boolean): HTMLElement {
  const seat = room.seat;
  const radio = (label: string, value: 1 | 2 | null): HTMLElement => {
    const input = el('input', {
      type: 'radio',
      name: 'team',
      'aria-label': label,
      checked: (seat?.team ?? null) === value,
      disabled: racing,
      'aria-disabled': racing ? 'true' : null,
      onchange: () => {
        void api.team(room.game.id, value).then((game) => {
          room.game = { ...room.game, ...game };
          if (room.onGameChanged) room.onGameChanged();
        });
      },
    });
    return el('label', { class: 'radio' }, [input, el('span', { text: label })]);
  };

  const startRace = el('button', {
    type: 'button',
    class: 'button start-race',
    text: 'Start race',
    onclick: () => {
      void api
        .raceStart(room.game.id)
        .then((game) => {
          room.game = { ...room.game, ...game };
          if (room.onGameChanged) room.onGameChanged();
        })
        .catch((failure: unknown) => {
          if (failure instanceof ApiFailure) room.notice(failure.body.message);
        });
    },
  }) as HTMLButtonElement;
  const teams = new Set(room.game.players.map((player) => player.team));
  startRace.disabled = racing || !teams.has(1) || !teams.has(2);

  const scores = room.game.scores ?? { '1': 0, '2': 0 };
  return el('div', { class: 'tile race-tile' }, [
    el('div', { role: 'radiogroup', 'aria-label': 'Team', class: 'team-radios' }, [
      radio('Team 1', 1),
      radio('Team 2', 2),
      radio('Watch', null),
    ]),
    room.isHost ? startRace : null,
    el('div', {
      role: 'status',
      'aria-label': 'Team scores',
      class: 'status team-scores',
      text: copy.teamScores(scores['1'], scores['2']),
    }),
  ]);
}
