import { copy } from '../../shared/copy';
import type { PlayerStat } from '../../shared/types';
import { api } from '../api';
import { el, prefersReducedMotion } from '../dom';
import { app } from '../state';
import { openDialog } from '../ui/overlay';
import type { Room } from './session';

export function openShareDialog(room: Room): void {
  const status = el('div', { role: 'status', 'aria-label': 'Share status', class: 'status' });
  const field = el('input', {
    type: 'text',
    class: 'field',
    'aria-label': 'Game link',
    readonly: true,
  }) as HTMLInputElement;

  const base =
    document.querySelector<HTMLMetaElement>('meta[name="overlap-public-url"]')?.content ||
    location.origin;
  const draw = (): void => {
    field.value = room.game.code === null ? '' : `${base}/g/${room.game.code}`;
  };
  draw();

  openDialog({ name: 'Share game', className: 'share-dialog' }, (dialog) => [
    el('div', { class: 'tile dialog-tile' }, [
      el('h2', { text: 'Share game' }),
      field,
      el('div', { class: 'dialog-actions' }, [
        el('button', {
          type: 'button',
          class: 'button',
          text: 'Copy link',
          onclick: () => {
            void navigator.clipboard?.writeText(field.value).catch(() => undefined);
            status.textContent = copy.linkCopied;
          },
        }),
        room.isHost
          ? el('button', {
              type: 'button',
              class: 'button',
              text: 'Turn off link',
              onclick: () => {
                void api.linkOff(room.game.id).then((game) => {
                  room.game = { ...room.game, ...game };
                  draw();
                  status.textContent = copy.linkTurnedOff;
                });
              },
            })
          : null,
        room.isHost
          ? el('button', {
              type: 'button',
              class: 'button',
              text: 'Replace link',
              onclick: () => {
                void api.linkReplace(room.game.id).then((game) => {
                  room.game = { ...room.game, ...game };
                  draw();
                  status.textContent = copy.linkReplaced;
                });
              },
            })
          : null,
        el('button', { type: 'button', class: 'button', text: 'Close', onclick: dialog.close }),
      ]),
      status,
    ]),
  ]);
}

export function openSettingsDialog(): void {
  const checkbox = (label: string, field: keyof typeof app.settings): HTMLElement => {
    const input = el('input', {
      type: 'checkbox',
      'aria-label': label,
      checked: app.settings[field],
    }) as HTMLInputElement;
    input.addEventListener('change', () => {
      app.settings = { ...app.settings, [field]: input.checked };
      void api.saveSettings(app.settings);
    });
    return el('label', { class: 'checkbox' }, [input, el('span', { text: label })]);
  };

  openDialog({ name: 'Solving settings', className: 'settings-dialog' }, (dialog) => [
    el('div', { class: 'tile dialog-tile' }, [
      el('h2', { text: 'Solving settings' }),
      checkbox('Skip filled squares', 'skip_filled'),
      checkbox('Jump to the next clue', 'jump_next_clue'),
      checkbox('Autocheck my letters', 'autocheck'),
      el('button', { type: 'button', class: 'button', text: 'Close', onclick: dialog.close }),
    ]),
  ]);
}

export function openSolvedDialog(room: Room, elapsedMs: number, revealed: number, stats: PlayerStat[]): void {
  const reduced = prefersReducedMotion();
  openDialog(
    {
      name: 'Puzzle solved',
      className: `solved-dialog${reduced ? '' : ' rises'}`,
      focusHeading: true,
      onClose: () => room.elements?.grid.focus(),
    },
    (dialog) => [
      el('div', { class: 'tile brass dialog-tile solved-tile' }, [
        el('h2', { text: copy.solvedHeading(elapsedMs) }),
        el('p', { text: copy.solvedLine(revealed) }),
        el(
          'div',
          { role: 'list', 'aria-label': 'Solve stats', class: 'stats-list' },
          stats.map((stat) =>
            el('div', {
              role: 'listitem',
              text: copy.solveStatsRow(stat.display_name, stat.letters, stat.revealed),
            }),
          ),
        ),
        el('button', { type: 'button', class: 'button', text: 'Close', onclick: dialog.close }),
      ]),
    ],
  );
}

export function openRaceOverDialog(room: Room): void {
  const scores = room.game.scores ?? { '1': 0, '2': 0 };
  const racers = room.game.players
    .filter((player) => player.team !== null)
    .sort((a, b) => b.score - a.score);
  openDialog(
    {
      name: 'Race over',
      className: 'solved-dialog',
      focusHeading: true,
      onClose: () => room.elements?.grid.focus(),
    },
    (dialog) => [
      el('div', { class: 'tile brass dialog-tile solved-tile' }, [
        el('h2', { text: copy.raceOverHeading(scores['1'], scores['2']) }),
        el(
          'div',
          { role: 'list', 'aria-label': 'Race scores', class: 'stats-list' },
          racers.map((player) =>
            el('div', {
              role: 'listitem',
              text: copy.raceScoreRow(
                player.display_name,
                player.team as 1 | 2,
                player.score,
              ),
            }),
          ),
        ),
        el('button', { type: 'button', class: 'button', text: 'Close', onclick: dialog.close }),
      ]),
    ],
  );
}

export function openClearPuzzleDialog(room: Room): void {
  openDialog(
    {
      name: 'Clear the puzzle?',
      className: 'confirm-dialog',
      onClose: () => room.elements?.grid.focus(),
    },
    (dialog) => [
      el('div', { class: 'tile dialog-tile' }, [
        el('h2', { text: copy.clearPuzzleQuestion }),
        el('div', { class: 'dialog-actions' }, [
          el('button', { type: 'button', class: 'button', text: 'Cancel', onclick: dialog.close }),
          el('button', {
            type: 'button',
            class: 'button',
            text: 'Clear puzzle',
            onclick: () => {
              room.send({ type: 'clear', scope: 'puzzle' });
              dialog.close();
            },
          }),
        ]),
      ]),
    ],
  );
}
