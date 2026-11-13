import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CUE_BALL, overlapsBall, rackSpots, type BallSpots } from '../../shared/physics';
import {
  adjudicate, ballsLeft, bannerSentence, calledPocketRequired, groupWord, legalFirstBall, placementAllowed, resultLine, shotLines, turnText, BEHIND_HEAD_STRING,
  type Rack, type Ruling, type SeatNames,
} from '../../shared/rules';
import { navigate } from '../router';
import type { Store } from '../store';
import type { Replay, ResultView, StrikeRequest, TableModel } from './model';
import { AI_SEAT, PLAYER_SEAT, chooseAiShot, clearRack, freshPracticeRack, practiceKind, saveRack, savedRack, type Difficulty, type PracticeKind } from './practice';
import { FRAME_MS, receiptText, runLocalShot, settleSpots } from './solo';
import { TableView } from './TableView';

const THINK_MIN_MS = 1000;
const THINK_SPREAD_MS = 900;
const AI_REPLAY_MAX_MS = 4000;
const AI_MAX_SHOTS = 3;
interface PendingShot {
  rest: BallSpots;
  shooter: 'ai' | 'player';
  ruling: Ruling;
  receipt: string;
}

function AiRack({ store, difficulty }: { store: Store; difficulty: Difficulty }): ReactNode {
  const [opening] = useState(() => {
    const saved = savedRack();
    return saved !== null && saved.difficulty === difficulty ? saved : freshPracticeRack();
  });
  const [rack, setRack] = useState<Rack>(opening.rack);
  const [spots, setSpots] = useState<BallSpots>(opening.spots);
  const [log, setLog] = useState<string[]>([]);
  const [banner, setBanner] = useState('');
  const [receipt, setReceipt] = useState('');
  const [replay, setReplay] = useState<Replay | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);
  const [turnNumber, setTurnNumber] = useState(0);
  const pending = useRef<PendingShot | null>(null);
  const aiShots = useRef(0);
  const replayId = useRef(0);
  const names: SeatNames = { [AI_SEAT]: difficulty, [PLAYER_SEAT]: 'You' } as SeatNames;
  const over = result !== null;
  const aiTurn = rack.activeSeat === AI_SEAT && !over;

  const restart = (): void => {
    clearRack();
    const fresh = freshPracticeRack();
    setRack(fresh.rack);
    setSpots(fresh.spots);
    setLog([]);
    setBanner('');
    setReceipt('');
    setResult(null);
    aiShots.current = 0;
    setTurnNumber((turn) => turn + 1);
  };

  const finishShot = (shot: PendingShot): void => {
    const { ruling, rest } = shot;
    const nextSpots = settleSpots(rest, ruling.next.balls, ruling.next.ballInHand);
    setSpots(nextSpots);
    setReceipt(shot.receipt);
    setBanner(bannerSentence(ruling));
    const lines = shotLines(ruling, names);
    if (ruling.win !== null) {
      const line = resultLine(ruling.win, PLAYER_SEAT, names);
      setRack(ruling.next);
      setBanner(line);
      setLog((current) => [...current, ...lines, 'Game over', line]);
      clearRack();
      setResult({
        line,
        coinChange: 'No Coins at stake',
        xpGained: 0,
        levelUps: [],
        rematch: { label: null, disabled: false, onPress: restart },
      });
      return;
    }
    let next = ruling.next;
    if (shot.shooter === 'ai' && next.activeSeat === AI_SEAT) {
      aiShots.current += 1;
      if (aiShots.current >= AI_MAX_SHOTS) next = { ...next, activeSeat: PLAYER_SEAT };
    }
    if (next.ballInHand && next.activeSeat === AI_SEAT) next = { ...next, ballInHand: false, behindHeadString: false };
    const handedOver = next.activeSeat === PLAYER_SEAT;
    setRack(next);
    setLog((current) => [
      ...current,
      ...lines,
      ...(shot.shooter === 'ai' && handedOver ? [`${difficulty} finished its turn`] : []),
      ...(next.activeSeat !== rack.activeSeat ? [turnText(next, PLAYER_SEAT, names, false)] : []),
    ]);
    if (handedOver) {
      aiShots.current = 0;
      saveRack({ difficulty, rack: next, spots: nextSpots });
    }
    setTurnNumber((turn) => turn + 1);
  };

  const play = (request: StrikeRequest, shooter: 'ai' | 'player', frameMs: (count: number) => number): void => {
    const shot = runLocalShot(spots, request, rack.phase === 'break');
    pending.current = {
      rest: shot.rest,
      shooter,
      ruling: adjudicate(rack, shot.outcome, request.calledPocket, names),
      receipt: receiptText(shot.outcome.firstContact, shot.firstCut),
    };
    replayId.current += 1;
    setReplay({ id: replayId.current, frames: shot.frames, frameMs: frameMs(shot.frames.length) });
  };

  useEffect(() => {
    if (!aiTurn || replay !== null) return undefined;
    setLog((current) => [...current, `${difficulty} is thinking`]);
    const timer = setTimeout(() => {
      const shot = chooseAiShot(rack, spots, difficulty);
      play({ ...shot, sideSpin: 0, topSpin: 0 }, 'ai', (count) => Math.min(FRAME_MS, AI_REPLAY_MAX_MS / count));
    }, THINK_MIN_MS + Math.random() * THINK_SPREAD_MS);
    return () => clearTimeout(timer);
  }, [aiTurn, turnNumber]);

  const seat = (number: 1 | 2): TableModel['seats'][number] => ({
    name: names[number],
    group: groupWord(rack.groups[number]),
    left: ballsLeft(rack, number),
    active: rack.activeSeat === number && !over,
  });

  const model: TableModel = {
    seats: [seat(PLAYER_SEAT), seat(AI_SEAT)],
    potText: null,
    turn: turnText(rack, PLAYER_SEAT, names, over),
    banner,
    log,
    clock: null,
    reconnect: null,
    receipt,
    spots,
    replay,
    myShot: rack.activeSeat === PLAYER_SEAT && !over,
    turnKey: `turn-${turnNumber}`,
    aimResetKey: 'practice',
    ballInHand: rack.ballInHand,
    behindHeadString: rack.behindHeadString,
    calledPocketRequired: calledPocketRequired(rack),
    guidelines: true,
    aimBonus: 0,
    cloth: store.me?.equippedClothId ?? 'cloth-hall-blue',
    tutorialStep: null,
    result,
    children: null,
    legalFirst: (ball) => legalFirstBall(rack, PLAYER_SEAT, ball),
    shoot: async (request) => play(request, 'player', () => FRAME_MS),
    place: async (across, along) => {
      const point: [number, number] = [across, along * 2];
      if (overlapsBall(spots, point)) return 'That spot is taken by another ball.';
      if (!placementAllowed(rack, along)) return BEHIND_HEAD_STRING;
      setSpots({ ...spots, [CUE_BALL]: point });
      setRack({ ...rack, ballInHand: false, behindHeadString: false });
      return null;
    },
    announce: (line, inBanner) => {
      if (inBanner) setBanner(line);
      setLog((current) => [...current, line]);
    },
    replayFinished: () => {
      const shot = pending.current;
      setReplay(null);
      if (shot === null) return;
      pending.current = null;
      finishShot(shot);
    },
  };
  return <TableView store={store} model={model} />;
}

function FreeTable({ store }: { store: Store }): ReactNode {
  const balls = Array.from({ length: 15 }, (_, index) => index + 1);
  const [spots, setSpots] = useState<BallSpots>(() => rackSpots(balls));
  const [left, setLeft] = useState(balls);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [receipt, setReceipt] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [turn, setTurn] = useState(0);
  const pending = useRef<{ rest: BallSpots; balls: number[]; receipt: string } | null>(null);

  const model: TableModel = {
    seats: [{ name: 'You', group: 'Open', left: left.length, active: true }],
    potText: null,
    turn: 'Your turn',
    banner: '',
    log,
    clock: null,
    reconnect: null,
    receipt,
    spots,
    replay,
    myShot: true,
    turnKey: `free-${turn}`,
    aimResetKey: 'free',
    ballInHand: false,
    behindHeadString: false,
    calledPocketRequired: false,
    guidelines: true,
    aimBonus: 0,
    cloth: store.me?.equippedClothId ?? 'cloth-hall-blue',
    tutorialStep: null,
    result: null,
    children: null,
    legalFirst: () => true,
    shoot: async (request) => {
      const shot = runLocalShot(spots, request, false);
      const potted = shot.outcome.pocketed.map(({ ball }) => ball);
      const remaining = left.filter((ball) => !potted.includes(ball));
      pending.current = {
        rest: shot.rest,
        balls: remaining.length === 0 ? balls : remaining,
        receipt: receiptText(shot.outcome.firstContact, shot.firstCut),
      };
      setReplay({ id: turn + 1, frames: shot.frames, frameMs: FRAME_MS });
    },
    place: async () => null,
    announce: (line) => setLog((current) => [...current, line]),
    replayFinished: () => {
      const shot = pending.current;
      setReplay(null);
      if (shot === null) return;
      pending.current = null;
      setSpots(shot.balls.length === balls.length && left.length !== balls.length ? rackSpots(balls) : settleSpots(shot.rest, shot.balls, false));
      setLeft(shot.balls);
      setReceipt(shot.receipt);
      setTurn((count) => count + 1);
    },
  };
  return <TableView store={store} model={model} />;
}

export function PracticeTable({ store }: { store: Store }): ReactNode {
  const [kind] = useState<PracticeKind | null>(practiceKind);
  useEffect(() => {
    if (kind === null) navigate('/practice', true);
  }, [kind]);
  if (kind === null) return null;
  return kind === 'Free table' ? <FreeTable store={store} /> : <AiRack store={store} difficulty={kind} />;
}
