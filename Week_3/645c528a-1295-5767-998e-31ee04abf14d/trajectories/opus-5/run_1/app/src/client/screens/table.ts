import { SHOP_ITEMS } from '../../shared/catalog.js';
import { FRIENDS_COPY, PLAY_COPY, REMATCH_UNFUNDED, num, rematchWaiting } from '../../shared/copy.js';
import { ballsLeft, requiresCalledPocket } from '../../shared/referee.js';
import type { ShotInput } from '../../shared/types.js';
import { ballsLeftText, groupLabel } from '../../shared/view.js';
import { api } from '../api.js';
import { openSignUpSheet } from '../auth-sheet.js';
import { el, labelledButton, openDialog } from '../dom.js';
import { LocalGame, type Difficulty } from '../local-game.js';
import { navigate, type Screen, type ScreenContext } from '../navigate.js';
import { TableView, type TableModel } from '../table-view.js';
import { markTutorialFinished, onServerEvent, refreshMe, state } from '../state.js';

const CLOTHS: Record<string, string> = {
  'cloth-hall-blue': '#13395c',
  'cloth-oxblood': '#5a1f24',
  'cloth-moss': '#2b4a32',
  'cloth-brass-felt': '#4a3a1c',
};

function clothColour(): string {
  const id = state.me?.equippedClothId ?? 'cloth-hall-blue';
  return CLOTHS[id] ?? CLOTHS['cloth-hall-blue'] ?? '#13395c';
}

function guidelineLength(): number {
  const cue = SHOP_ITEMS.find((item) => item.id === state.me?.equippedCueId);
  return 0.25 + (cue?.aim ?? 0) / 100;
}

interface TableBody {
  id: string;
  mode: 'eight-ball' | 'nine-ball' | 'no-guidelines';
  kind: 'stake' | 'private' | 'tournament';
  status: string;
  seats: { seat: 1 | 2; playerId: string | null; displayName: string; group: string | null; ballsLeft: number; connected: boolean }[];
  activeSeat: 1 | 2;
  ballInHand: boolean;
  behindHeadString: boolean;
  calledPocketRequired: boolean;
  shotClockSeconds: number | null;
  reconnectSeconds: number | null;
  droppedName: string | null;
  pot: number;
  entry: number;
  seatedHere: boolean;
  ruleBanner: string;
  balls: number[];
  ballPositions: { ball: number; across: number; along: number }[];
  announcements: string[];
  turn: string;
  groupLabels: Record<string, string>;
  shotReceipt: string;
  rematchWaitingFor: number[];
  result: {
    line: string;
    coinChange: string;
    xpGained: number;
    levelUps: number[];
    coins: number;
    xpGainedText: string;
    levelUpLines: string[];
  } | null;
}

export function onlineTableScreen(context: ScreenContext): Screen {
  const id = context.params.id ?? '';
  const host = el('div', { className: 'table-host' });
  let view: TableView | null = null;
  let body: TableBody | null = null;
  let rematchWaitingText: string | null = null;

  const handlers = {
    onShot: (shot: ShotInput) => void sendShot(shot),
    onPlace: (across: number, along: number) => void sendPlace(across, along),
    onRematch: () => void askRematch(),
    onCancelLine: (line: string) => {
      view?.addLocalLine(line);
      if (line === 'Call a pocket before you shoot.') view?.setBanner(line);
    },
    onBackToLobby: () => navigate('/home'),
  };

  async function load(): Promise<void> {
    const result = await api<TableBody>('GET', `/api/tables/${id}`);
    if (!result.ok) {
      host.replaceChildren(
        el('h1', {
          className: 'screen-heading',
          text: result.failure.status === 404 ? PLAY_COPY.unknownTable : result.failure.message || PLAY_COPY.notYours,
          attrs: { tabindex: '-1' },
        }),
      );
      return;
    }
    apply(result.data);
  }

  function apply(next: TableBody): void {
    body = next;
    if (!next.seatedHere) {
      view?.destroy();
      view = null;
      host.replaceChildren(el('h1', { className: 'screen-heading', text: PLAY_COPY.secondDevice, attrs: { tabindex: '-1' } }));
      return;
    }
    if (!view) {
      view = new TableView(handlers);
      host.replaceChildren(view.element);
    }
    view.setModel(toModel(next));
  }

  function toModel(table: TableBody): TableModel {
    const mySeat = table.seats.find((seat) => seat.playerId === state.me?.id)?.seat ?? null;
    const myTurn = mySeat !== null && table.activeSeat === mySeat && table.status === 'in_play' && table.seatedHere;
    const inviteUrl = sessionStorage.getItem(`hs:invite:${table.id}`);
    const rematchDisabled = table.kind === 'stake' && (state.me?.coins ?? 0) < table.entry ? REMATCH_UNFUNDED : null;
    return {
      seats: [
        {
          name: table.seats[0]?.displayName ?? '',
          groupLabel: table.groupLabels['1'] ?? 'Open',
          ballsLeftText: ballsLeftText(table.seats[0]?.ballsLeft ?? 0),
          connected: table.seats[0]?.connected ?? true,
        },
        {
          name: table.seats[1]?.displayName ?? '',
          groupLabel: table.groupLabels['2'] ?? 'Open',
          ballsLeftText: ballsLeftText(table.seats[1]?.ballsLeft ?? 0),
          connected: table.seats[1]?.connected ?? true,
        },
      ],
      potText: table.kind === 'tournament' ? 'Pot Tournament' : `Pot ${num(table.pot)}`,
      ruleBanner: table.ruleBanner,
      turn: table.turn,
      announcements: table.announcements,
      shotClockSeconds: table.shotClockSeconds,
      reconnectText:
        table.reconnectSeconds !== null && table.droppedName
          ? PLAY_COPY.dropped(table.droppedName, table.reconnectSeconds)
          : null,
      myTurn,
      ballInHand: table.ballInHand && table.activeSeat === mySeat,
      behindHeadString: table.behindHeadString,
      calledPocketRequired: table.calledPocketRequired && table.activeSeat === mySeat,
      positions: table.ballPositions,
      balls: table.balls,
      receipt: table.shotReceipt,
      tutorialStep: null,
      loupeEnabled: table.mode !== 'no-guidelines',
      myGroupLabel: mySeat ? table.groupLabels[String(mySeat)] ?? 'Open' : null,
      cloth: clothColour(),
      guidelineLength: guidelineLength(),
      result: table.result
        ? {
            line: table.result.line,
            coinChange: table.result.coinChange,
            xpGained: table.result.xpGainedText,
            levelUpLines: table.result.levelUpLines,
            rematchDisabledReason: rematchDisabled,
            showRematch: true,
            rematchWaiting: rematchWaitingText,
          }
        : null,
      invite:
        table.status === 'waiting' && inviteUrl
          ? { url: inviteUrl, waitingText: FRIENDS_COPY.hostWaiting }
          : null,
    };
  }

  async function sendShot(shot: ShotInput): Promise<void> {
    const result = await api<TableBody>('POST', `/api/tables/${id}/shots`, {
      aimDegrees: shot.aimDegrees,
      power: shot.power,
      sideSpin: shot.sideSpin,
      topSpin: shot.topSpin,
      calledPocket: shot.calledPocket,
    });
    if (result.ok) {
      apply(result.data);
      await refreshMe();
      return;
    }
    if (result.failure.error === 'shot_clock_expired') view?.addLocalLine(PLAY_COPY.lateShot);
    else if (result.failure.error === 'other_device') view?.addLocalLine(PLAY_COPY.secondDevice);
    else if (result.failure.message) view?.addLocalLine(result.failure.message);
  }

  async function sendPlace(across: number, along: number): Promise<void> {
    const result = await api<TableBody>('POST', `/api/tables/${id}/place`, { across, along });
    if (result.ok) apply(result.data);
    else if (result.failure.errors?.along) view?.addLocalLine(result.failure.errors.along);
  }

  async function askRematch(): Promise<void> {
    const result = await api<{ status?: string; tableUrl?: string }>('POST', `/api/tables/${id}/rematch`);
    if (!result.ok) {
      view?.addLocalLine(result.failure.message);
      return;
    }
    if (result.data.tableUrl) {
      navigate(result.data.tableUrl);
      return;
    }
    const other = body?.seats.find((seat) => seat.playerId !== state.me?.id);
    rematchWaitingText = rematchWaiting(other?.displayName ?? '');
    if (body) view?.setModel(toModel(body));
  }

  const unsubscribeTable = onServerEvent('table', (data) => {
    const table = data as TableBody | null;
    if (table && table.id === id) apply(table);
  });
  const unsubscribeQueue = onServerEvent('queue', (data) => {
    const payload = data as { status?: string; tableUrl?: string } | null;
    if (payload?.status === 'paired' && payload.tableUrl && payload.tableUrl !== `/table/${id}`) navigate(payload.tableUrl);
  });

  void load();

  return {
    element: host,
    topics: [`table:${id}`],
    destroy: () => {
      unsubscribeTable();
      unsubscribeQueue();
      view?.destroy();
    },
  };
}

export function tutorialScreen(): Screen {
  const host = el('div', { className: 'table-host' });
  let view: TableView | null = null;
  const game = new LocalGame({
    kind: 'tutorial',
    difficulty: 'Free table',
    playerName: state.me?.displayName ?? 'You',
    onChange: () => render(),
    onComplete: () => finish(),
  });

  const handlers = {
    onShot: (shot: ShotInput) => game.shoot(shot),
    onPlace: (across: number, along: number) => game.place(across, along),
    onRematch: () => undefined,
    onCancelLine: (line: string) => view?.addLocalLine(line),
    onBackToLobby: () => navigate('/home'),
  };

  function finish(): void {
    markTutorialFinished();
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openDialog({
      name: 'Save your progress',
      opener,
      build: (handle) => [
        el('h2', { text: 'Save your progress' }),
        labelledButton(
          'Create account',
          () => {
            handle.close();
            openSignUpSheet({ opener, onSuccess: () => navigate('/home') });
          },
          { className: 'button primary' },
        ),
        labelledButton(
          'Skip for now',
          () => {
            handle.close();
            navigate('/home');
          },
          { className: 'button' },
        ),
      ],
    });
  }

  function render(): void {
    if (!view) {
      view = new TableView(handlers);
      host.replaceChildren(view.element);
    }
    const positions = Object.entries(game.state.positions).map(([ball, point]) => ({
      ball: Number(ball),
      across: point.across,
      along: point.along,
    }));
    view.setModel({
      seats: [
        {
          name: state.me?.displayName ?? 'You',
          groupLabel: 'Solids',
          ballsLeftText: ballsLeftText(ballsLeft(game.state, 1)),
          connected: true,
        },
        { name: 'Tutorial', groupLabel: 'Open', ballsLeftText: ballsLeftText(0), connected: true },
      ],
      potText: 'Pot 0',
      ruleBanner: '',
      turn: 'Your turn',
      announcements: game.announcements,
      shotClockSeconds: null,
      reconnectText: null,
      myTurn: true,
      ballInHand: game.state.ballInHand,
      behindHeadString: game.state.behindHeadString,
      calledPocketRequired: false,
      positions,
      balls: game.state.balls,
      receipt: game.receipt,
      tutorialStep: game.step,
      loupeEnabled: true,
      myGroupLabel: 'Solids',
      cloth: clothColour(),
      guidelineLength: guidelineLength(),
      result: null,
      invite: null,
    });
  }

  render();

  return {
    element: host,
    destroy: () => view?.destroy(),
  };
}

const RACK_KEY = 'hs:rack';

export function practiceTableScreen(context: ScreenContext): Screen {
  const host = el('div', { className: 'table-host' });
  const difficulty = (context.url.searchParams.get('difficulty') ?? 'Rookie') as Difficulty;
  const resume = context.url.searchParams.get('resume') === '1';
  let view: TableView | null = null;

  const snapshot = resume ? readSnapshot() : null;
  const game = new LocalGame({
    kind: difficulty === 'Free table' ? 'free' : 'practice',
    difficulty,
    playerName: state.me?.displayName ?? 'You',
    onChange: () => {
      render();
      saveSnapshot();
    },
    ...(snapshot ? { snapshot } : {}),
  });

  function saveSnapshot(): void {
    try {
      localStorage.setItem(RACK_KEY, JSON.stringify(game.snapshot()));
    } catch {
      // storage is optional for practice
    }
  }

  const handlers = {
    onShot: (shot: ShotInput) => game.shoot(shot),
    onPlace: (across: number, along: number) => game.place(across, along),
    onRematch: () => undefined,
    onCancelLine: (line: string) => {
      view?.addLocalLine(line);
      if (line === 'Call a pocket before you shoot.') view?.setBanner(line);
    },
    onBackToLobby: () => navigate('/home'),
  };

  function render(): void {
    if (!view) {
      view = new TableView(handlers);
      host.replaceChildren(view.element);
    }
    const positions = Object.entries(game.state.positions).map(([ball, point]) => ({
      ball: Number(ball),
      across: point.across,
      along: point.along,
    }));
    const needsPocket = game.state.activeSeat === 1 && requiresCalledPocket(game.state, 1);
    view.setModel({
      seats: [
        {
          name: state.me?.displayName ?? 'You',
          groupLabel: groupLabel(game.state.groups[1]),
          ballsLeftText: ballsLeftText(ballsLeft(game.state, 1)),
          connected: true,
        },
        {
          name: game.difficulty,
          groupLabel: groupLabel(game.state.groups[2]),
          ballsLeftText: ballsLeftText(ballsLeft(game.state, 2)),
          connected: true,
        },
      ],
      potText: 'Pot 0',
      ruleBanner: game.banner,
      turn: game.turn,
      announcements: game.announcements,
      shotClockSeconds: null,
      reconnectText: null,
      myTurn: game.myTurn && !game.state.over,
      ballInHand: game.state.ballInHand && game.state.activeSeat === 1,
      behindHeadString: game.state.behindHeadString,
      calledPocketRequired: needsPocket,
      positions,
      balls: game.state.balls,
      receipt: game.receipt,
      tutorialStep: null,
      loupeEnabled: true,
      myGroupLabel: groupLabel(game.state.groups[1]),
      cloth: clothColour(),
      guidelineLength: guidelineLength(),
      result: null,
      invite: null,
    });
  }

  render();

  return {
    element: host,
    destroy: () => view?.destroy(),
  };
}

export function readSnapshot(): ReturnType<LocalGame['snapshot']> | null {
  try {
    const raw = localStorage.getItem(RACK_KEY);
    return raw ? (JSON.parse(raw) as ReturnType<LocalGame['snapshot']>) : null;
  } catch {
    return null;
  }
}

export function clearSnapshot(): void {
  try {
    localStorage.removeItem(RACK_KEY);
  } catch {
    // storage is optional for practice
  }
}
