import { drawBoard } from './board.js';
import type { BoardHandles, BoardSkins } from './board.js';
import { el } from './dom.js';

export interface MatchDom {
  root: HTMLElement;
  board: HTMLElement;
  rotator: HTMLElement;
  handles: BoardHandles;
  crop: HTMLElement;
  rail: HTMLElement;
  controls: HTMLElement;
  names: [HTMLElement, HTMLElement];
  scores: [HTMLElement, HTMLElement];
  coins: [HTMLElement, HTMLElement];
  dues: [HTMLElement, HTMLElement];
  railSeats: [HTMLElement, HTMLElement];
  queenStatus: HTMLElement;
  shotTimer: HTMLElement;
  strikerReadout: HTMLElement;
  aimReadout: HTMLElement;
  powerReadout: HTMLElement;
  strikerSlider: HTMLInputElement;
  aimSlider: HTMLInputElement;
  powerSlider: HTMLInputElement;
  shoot: HTMLButtonElement;
  skipShot: HTMLButtonElement;
  menu: HTMLButtonElement;
  emotes: HTMLButtonElement;
  placementMessage: HTMLElement;
  shotError: HTMLElement;
  turnText: HTMLElement;
  boardLabel: HTMLElement;
  breakLabel: HTMLElement;
  verdict: HTMLElement;
  verdictWord: HTMLElement;
  verdictLine: HTMLElement;
  announcer: HTMLElement;
  emoteBubble: HTMLElement;
  reconnectOverlay: HTMLElement;
}

function railSeat(
  seat: 0 | 1,
): {
  node: HTMLElement;
  name: HTMLElement;
  score: HTMLElement;
  coins: HTMLElement;
  dues: HTMLElement;
} {
  const name = el('span', { id: `name-${seat}` });
  const score = el('span', { id: `score-${seat}`, class: 'rail-seat__score num' });
  const coins = el('span', { id: `coins-left-${seat}`, class: 'num' });
  const dues = el('span', { id: `dues-${seat}`, class: 'num' });
  const node = el('div', { class: 'rail-seat', 'data-seat': String(seat) }, [name, score, coins, dues]);
  return { node, name, score, coins, dues };
}

export function buildMatchDom(skins: BoardSkins, online: boolean): MatchDom {
  const handles = drawBoard(skins);
  const board = el('div', {
    id: 'board',
    role: 'group',
    'aria-label': 'Carrom board',
    tabindex: '0',
    'data-theme': skins.board,
  });
  board.append(handles.root);
  const rotator = el('div', { id: 'board-rotator', 'data-rotation': '0' }, [board]);

  const seat0 = railSeat(0);
  const seat1 = railSeat(1);
  const queenStatus = el('div', { id: 'queen-status' });
  const shotTimer = el('div', { id: 'shot-timer', role: 'timer', 'aria-label': 'Shot clock', class: 'num' });
  const rail = el('div', { id: 'score-rail', role: 'region', 'aria-label': 'Score rail' }, [
    seat0.node,
    seat1.node,
    queenStatus,
    ...(online ? [shotTimer] : []),
  ]);

  const strikerReadout = el('span', { id: 'striker-readout' });
  const aimReadout = el('span', { id: 'aim-readout' });
  const powerReadout = el('span', { id: 'power-readout' });

  const strikerSlider = el('input', {
    type: 'range',
    id: 'striker-slider',
    'aria-label': 'Striker position',
    min: '-200',
    max: '200',
    step: '0.5',
    value: '0',
  });
  const aimSlider = el('input', {
    type: 'range',
    id: 'aim-slider',
    'aria-label': 'Aim angle',
    min: '-180',
    max: '180',
    step: '0.1',
    value: '0',
  });
  const powerSlider = el('input', {
    type: 'range',
    id: 'power-slider',
    'aria-label': 'Power',
    min: '0',
    max: '100',
    step: '1',
    value: '0',
  });

  const shoot = el('button', { type: 'button', id: 'shoot', text: 'Shoot', disabled: true });
  const skipShot = el('button', { type: 'button', id: 'skip-shot', text: 'Skip shot', hidden: true });
  const menu = el('button', { type: 'button', id: 'menu', text: 'Menu' });
  const emotes = el('button', { type: 'button', id: 'emotes', text: 'Emotes' });

  const placementMessage = el('div', { id: 'placement-message' });
  const shotError = el('div', { id: 'shot-error' });
  const turnText = el('div', { id: 'turn-text', style: 'font-weight:900' });
  const boardLabel = el('div', { id: 'board-label' });
  const breakLabel = el('div', { id: 'break-label' });

  const verdictWord = el('span', { id: 'verdict-word' });
  const verdictLine = el('span', { id: 'verdict-line' });
  const verdict = el('div', { id: 'verdict', role: 'status' }, [verdictWord, verdictLine]);
  const announcer = el('div', { id: 'announcer', role: 'log', 'aria-live': 'polite', 'aria-label': 'Match announcements' });
  const emoteBubble = el('div', { id: 'emote-bubble' });
  const reconnectOverlay = el('div', { id: 'reconnect-overlay', hidden: true });
  const crop = el('div', { class: 'match-crop', 'aria-hidden': 'true' });

  const controls = el('div', { class: 'controls' }, [
    el('div', { class: 'readouts' }, [strikerReadout, aimReadout, powerReadout, boardLabel, breakLabel]),
    el('div', { class: 'sliders' }, [strikerSlider, aimSlider, powerSlider]),
    el('div', { class: 'actions' }, online ? [shoot, skipShot, menu, emotes] : [shoot, skipShot, menu]),
    el('div', { class: 'status-row' }, [turnText, placementMessage, shotError]),
  ]);

  const root = el('div', {
    id: 'match-root',
    'data-turn': '0',
    'data-field': 'tomato',
    'data-phase': 'aim',
    'data-board': '1',
    'data-shot-seq': '0',
  }, [
    el('h1', { class: 'visually-hidden', text: 'Carrom match' }),
    crop,
    el('div', { class: 'match-layout' }, [rail, el('div', { class: 'board-area' }, [rotator])]),
    controls,
    verdict,
    emoteBubble,
    announcer,
    reconnectOverlay,
  ]);

  return {
    root,
    board,
    rotator,
    handles,
    crop,
    rail,
    controls,
    names: [seat0.name, seat1.name],
    scores: [seat0.score, seat1.score],
    coins: [seat0.coins, seat1.coins],
    dues: [seat0.dues, seat1.dues],
    railSeats: [seat0.node, seat1.node],
    queenStatus,
    shotTimer,
    strikerReadout,
    aimReadout,
    powerReadout,
    strikerSlider,
    aimSlider,
    powerSlider,
    shoot,
    skipShot,
    menu,
    emotes,
    placementMessage,
    shotError,
    turnText,
    boardLabel,
    breakLabel,
    verdict,
    verdictWord,
    verdictLine,
    announcer,
    emoteBubble,
    reconnectOverlay,
  };
}
