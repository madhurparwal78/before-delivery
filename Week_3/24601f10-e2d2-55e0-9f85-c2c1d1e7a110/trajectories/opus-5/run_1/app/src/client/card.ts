import { cardName, scoreText, slotEntrantId, slotName } from '../shared/cards';
import { COPY, YOUR_ACTION, autoConfirmsIn } from '../shared/copy';
import { STATUS_WORDS, type ApiMatch } from '../shared/types';
import { api, ApiError } from './api';
import { navigate, serverNow, state } from './app';
import { type DialogHandle, dialogError, openDialog } from './dialog';
import { h } from './dom';
import { openEditDialog } from './trace';

export interface Viewer {
  isOrganizer: boolean;
  entrantId: string | null;
}

export const viewerOf = (): Viewer => {
  const role = state.tournament?.my_role ?? 'viewer';
  return {
    isOrganizer: role === 'organizer' || role === 'co_organizer',
    entrantId: state.myEntrantId,
  };
};

const playable = (match: ApiMatch): boolean =>
  match.upper !== null &&
  match.lower !== null &&
  'entrant_id' in match.upper &&
  'entrant_id' in match.lower &&
  ['pending', 'called', 'reported', 'disputed'].includes(match.state);

const mySide = (match: ApiMatch, viewer: Viewer): 'upper' | 'lower' | null => {
  if (viewer.entrantId === null) return null;
  if (slotEntrantId(match.upper) === viewer.entrantId) return 'upper';
  if (slotEntrantId(match.lower) === viewer.entrantId) return 'lower';
  return null;
};

export type DialogKind = 'report' | 'confirm' | 'resolve' | 'details';

export const dialogFor = (match: ApiMatch, viewer: Viewer): DialogKind => {
  const side = mySide(match, viewer);
  if (!playable(match)) return 'details';
  if (viewer.isOrganizer && ['pending', 'called', 'reported'].includes(match.state)) return 'report';
  if (side !== null && ['pending', 'called'].includes(match.state)) return 'report';
  if (side !== null && match.state === 'reported' && match.report !== null) {
    const myName = slotName(side === 'upper' ? match.upper : match.lower);
    if (match.report.by !== myName) return 'confirm';
  }
  if (viewer.isOrganizer && match.state === 'disputed') return 'resolve';
  return 'details';
};

const countdownText = (match: ApiMatch): string => {
  if (match.state !== 'reported' || match.report === null) return '';
  const remaining = Date.parse(match.report.auto_confirm_at) - serverNow();
  if (remaining <= 0) return COPY.confirmingDots;
  const seconds = Math.floor(remaining / 1000);
  return autoConfirmsIn(Math.floor(seconds / 60), seconds % 60);
};

/** The last match object painted onto each card, so a live change can be compared with it. */
export const seenMatches = new Map<string, ApiMatch>();

export const cardElement = (match: ApiMatch, viewer: Viewer): HTMLButtonElement => {
  const button = h('button', { type: 'button', class: 'card' }) as HTMLButtonElement;
  button.addEventListener('click', () => {
    openCardDialog(match.id, button);
  });
  updateCard(button, match, viewer);
  return button;
};

export const updateCard = (button: HTMLButtonElement, match: ApiMatch, viewer: Viewer): void => {
  const showOverdue = viewer.isOrganizer;
  button.setAttribute('aria-label', cardName(match, showOverdue));
  button.dataset.matchId = match.id;
  button.dataset.round = String(match.round);
  button.dataset.match = String(match.number);
  button.dataset.bracket = match.bracket;
  button.dataset.state = match.state;
  button.className = `card card-${match.state}`;

  const realFirst = match.state === 'bye' && match.upper !== null && 'bye' in match.upper;
  const upper = slotName(realFirst ? match.lower : match.upper);
  const lower = slotName(realFirst ? match.upper : match.lower);
  const score =
    match.state === 'reported' && match.report !== null
      ? `${match.report.upper_games}-${match.report.lower_games}`
      : scoreText(match.upper_games, match.lower_games);

  const children: (Node | null)[] = [
    h('span', { class: 'card-label' }, match.label),
    h(
      'span',
      { class: 'card-sides' },
      h('span', { class: 'card-name' }, match.state === 'not_needed' || match.state === 'waiting' ? '' : upper),
      h('span', { class: 'card-name' }, match.state === 'not_needed' || match.state === 'waiting' ? '' : lower),
    ),
    h('span', { class: 'card-score' }, score === 'not played' ? '' : score),
    h(
      'span',
      { class: 'card-foot' },
      h('span', { class: 'card-status' }, STATUS_WORDS[match.state]),
      showOverdue && match.overdue === true ? h('span', { class: 'card-overdue' }, 'Overdue') : null,
    ),
    match.state === 'reported'
      ? h('span', { class: 'card-countdown', 'data-countdown': match.id }, countdownText(match))
      : null,
    h('span', { class: 'slats', 'aria-hidden': 'true' }),
  ];
  button.replaceChildren(...children.filter((node): node is Node => node !== null));
  seenMatches.set(match.id, match);
};

export const tickCountdowns = (): void => {
  for (const node of document.querySelectorAll<HTMLElement>('[data-countdown]')) {
    const match = state.matches.find((row) => row.id === node.dataset.countdown);
    if (match === undefined) continue;
    node.textContent = countdownText(match);
  }
};

export const findMatch = (matchId: string): ApiMatch | undefined =>
  state.matches.find((row) => row.id === matchId);

const yourAction = (text: string): void => {
  const region = document.querySelector<HTMLElement>('[data-your-action]');
  if (region !== null) region.textContent = text;
};

const spinbuttons = (
  match: ApiMatch,
  upperValue: number | '',
  lowerValue: number | '',
): { row: HTMLElement; upper: HTMLInputElement; lower: HTMLInputElement } => {
  const upper = h('input', {
    type: 'number',
    min: '0',
    max: '99',
    step: '1',
    'aria-label': `${slotName(match.upper)} games`,
    value: upperValue === '' ? '' : String(upperValue),
  }) as HTMLInputElement;
  const lower = h('input', {
    type: 'number',
    min: '0',
    max: '99',
    step: '1',
    'aria-label': `${slotName(match.lower)} games`,
    value: lowerValue === '' ? '' : String(lowerValue),
  }) as HTMLInputElement;
  const row = h(
    'div',
    { class: 'score-fields' },
    h('label', { class: 'field' }, h('span', {}, `${slotName(match.upper)} games`), upper),
    h('label', { class: 'field' }, h('span', {}, `${slotName(match.lower)} games`), lower),
  );
  return { row, upper, lower };
};

const readGames = (input: HTMLInputElement): number => {
  const value = Number(input.value);
  return Number.isFinite(value) ? Math.trunc(value) : Number.NaN;
};

const runWrite = async (
  dialog: DialogHandle,
  buttons: HTMLButtonElement[],
  write: () => Promise<void>,
): Promise<void> => {
  dialog.setPending(true, buttons);
  try {
    await write();
    dialog.setPending(false, buttons);
    dialog.close();
  } catch (error) {
    dialog.setPending(false, buttons);
    if (error instanceof ApiError) {
      dialogError(dialog, error.message);
      return;
    }
    throw error;
  }
};

export const openCardDialog = (matchId: string, opener: HTMLElement): void => {
  const match = findMatch(matchId);
  if (match === undefined) return;
  const viewer = viewerOf();
  const kind = dialogFor(match, viewer);
  if (kind === 'report') openReportDialog(match, viewer, opener);
  else if (kind === 'confirm') openConfirmDialog(match, viewer, opener);
  else if (kind === 'resolve') openResolveDialog(match, opener);
  else openDetailsDialog(match, viewer, opener);
};

const openReportDialog = (match: ApiMatch, viewer: Viewer, opener: HTMLElement): void => {
  openDialog({
    title: 'Report score',
    opener,
    build: (dialog) => {
      const fields = spinbuttons(match, '', '');
      const submitLabel = viewer.isOrganizer ? 'Save result' : 'Submit score';
      const submit = h('button', { type: 'button', class: 'primary' }, submitLabel) as HTMLButtonElement;
      const cancel = h('button', { type: 'button' }, 'Cancel') as HTMLButtonElement;
      const call =
        viewer.isOrganizer && match.state === 'pending'
          ? (h('button', { type: 'button' }, 'Call match') as HTMLButtonElement)
          : null;
      const buttons = [submit, cancel, ...(call === null ? [] : [call])];

      submit.addEventListener('click', () => {
        void runWrite(dialog, buttons, async () => {
          const upper = readGames(fields.upper);
          const lower = readGames(fields.lower);
          if (viewer.isOrganizer && mySide(match, viewer) === null) {
            await api.result(match.id, upper, lower, match.version);
            yourAction(YOUR_ACTION.resultSaved);
            return;
          }
          const response = await api.report(match.id, upper, lower, match.version);
          const side = mySide(match, viewer);
          const opponent = slotName(side === 'upper' ? match.lower : match.upper);
          yourAction(
            response.outcome === 'reported'
              ? YOUR_ACTION.reported(opponent)
              : response.outcome === 'confirmed'
                ? YOUR_ACTION.confirmed
                : YOUR_ACTION.disputed,
          );
        });
      });
      call?.addEventListener('click', () => {
        void runWrite(dialog, buttons, async () => {
          await api.call(match.id, match.version);
          yourAction(YOUR_ACTION.called);
        });
      });
      cancel.addEventListener('click', () => dialog.close());
      return [fields.row, h('div', { class: 'dialog-buttons' }, submit, call, cancel)];
    },
  });
};

const openConfirmDialog = (match: ApiMatch, viewer: Viewer, opener: HTMLElement): void => {
  const report = match.report;
  if (report === null) return;
  openDialog({
    title: 'Confirm score',
    opener,
    build: (dialog) => {
      const fields = spinbuttons(match, report.upper_games, report.lower_games);
      const confirm = h('button', { type: 'button', class: 'primary' }, 'Confirm score') as HTMLButtonElement;
      const dispute = h('button', { type: 'button' }, 'Dispute score') as HTMLButtonElement;
      const cancel = h('button', { type: 'button' }, 'Cancel') as HTMLButtonElement;
      const buttons = [confirm, dispute, cancel];
      confirm.addEventListener('click', () => {
        void runWrite(dialog, buttons, async () => {
          await api.confirm(match.id, match.version);
          yourAction(YOUR_ACTION.confirmed);
        });
      });
      dispute.addEventListener('click', () => {
        void runWrite(dialog, buttons, async () => {
          await api.dispute(match.id, readGames(fields.upper), readGames(fields.lower), match.version);
          yourAction(YOUR_ACTION.disputed);
        });
      });
      cancel.addEventListener('click', () => dialog.close());
      void viewer;
      return [
        h('p', {}, `${report.by} reported ${report.upper_games}-${report.lower_games}`),
        h('p', { class: 'card-countdown', 'data-countdown': match.id }, countdownText(match)),
        fields.row,
        h('div', { class: 'dialog-buttons' }, confirm, dispute, cancel),
      ];
    },
  });
};

const openResolveDialog = (match: ApiMatch, opener: HTMLElement): void => {
  openDialog({
    title: 'Resolve dispute',
    opener,
    build: (dialog) => {
      const claims: HTMLElement[] = [];
      if (match.report !== null) {
        claims.push(
          h('p', {}, `${match.report.by} says ${match.report.upper_games}-${match.report.lower_games}`),
        );
      }
      if (match.dispute !== null) {
        claims.push(
          h('p', {}, `${match.dispute.by} says ${match.dispute.upper_games}-${match.dispute.lower_games}`),
        );
      }
      const fields = spinbuttons(
        match,
        match.report?.upper_games ?? '',
        match.report?.lower_games ?? '',
      );
      const resolve = h('button', { type: 'button', class: 'primary' }, 'Resolve') as HTMLButtonElement;
      const cancel = h('button', { type: 'button' }, 'Cancel') as HTMLButtonElement;
      resolve.addEventListener('click', () => {
        void runWrite(dialog, [resolve, cancel], async () => {
          await api.resolve(match.id, readGames(fields.upper), readGames(fields.lower), match.version);
          yourAction(YOUR_ACTION.resolved);
          if (state.tournament !== null) navigate(`/t/${state.tournament.id}/bracket?match=${match.id}`);
        });
      });
      cancel.addEventListener('click', () => dialog.close());
      return [...claims, fields.row, h('div', { class: 'dialog-buttons' }, resolve, cancel)];
    },
  });
};

export const openDetailsDialog = (match: ApiMatch, viewer: Viewer, opener: HTMLElement): void => {
  openDialog({
    title: 'Match details',
    opener,
    build: (dialog) => {
      const close = h('button', { type: 'button' }, 'Close') as HTMLButtonElement;
      close.addEventListener('click', () => dialog.close());
      const edit =
        viewer.isOrganizer && (match.state === 'confirmed' || match.state === 'resolved')
          ? (h('button', { type: 'button', class: 'primary' }, 'Edit result') as HTMLButtonElement)
          : null;
      edit?.addEventListener('click', () => {
        openEditDialog(findMatch(match.id) ?? match, edit, dialog);
      });
      return [
        h('p', {}, match.label),
        h('p', {}, `${slotName(match.upper)} vs ${slotName(match.lower)}`),
        h('p', {}, STATUS_WORDS[match.state]),
        h('p', {}, scoreText(match.upper_games, match.lower_games)),
        h('div', { class: 'dialog-buttons' }, edit, close),
      ];
    },
  });
};
