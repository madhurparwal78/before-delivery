import { useRef, useState, type ReactNode } from 'react';
import { FOOT_SPOT, HEAD_SPOT, type BallSpots } from '../../shared/physics';
import { groupOf } from '../../shared/rules';
import { openSheet } from '../auth-sheet';
import { navigate } from '../router';
import { TUTORIAL_KEY, type Store } from '../store';
import { Modal } from '../ui';
import type { Replay, StrikeRequest, TableModel } from './model';
import { FRAME_MS, receiptText, runLocalShot } from './solo';
import { TableView } from './TableView';

const STEP_BALLS = [1, 9, 1];
const LAST_STEP = 2;

function stepSpots(step: number): BallSpots {
  return { 0: HEAD_SPOT, [STEP_BALLS[step]]: FOOT_SPOT };
}

export function TutorialTable({ store }: { store: Store }): ReactNode {
  const [step, setStep] = useState(0);
  const [spots, setSpots] = useState(() => stepSpots(0));
  const [replay, setReplay] = useState<Replay | null>(null);
  const [receipt, setReceipt] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [shots, setShots] = useState(0);
  const pending = useRef<{ receipt: string; rest: BallSpots } | null>(null);

  const leave = (): void => {
    localStorage.setItem(TUTORIAL_KEY, '1');
    navigate('/home');
  };

  const model: TableModel = {
    seats: [{ name: 'You', group: 'Solids', left: 1, active: true }],
    potText: null,
    turn: 'Your turn',
    banner: '',
    log,
    clock: null,
    reconnect: null,
    receipt,
    spots,
    replay,
    myShot: !finished,
    turnKey: `step-${shots}`,
    aimResetKey: `step-${shots}`,
    ballInHand: false,
    behindHeadString: false,
    calledPocketRequired: false,
    guidelines: true,
    aimBonus: 0,
    cloth: 'cloth-hall-blue',
    tutorialStep: `Step ${step + 1} of 3`,
    result: null,
    children: null,
    legalFirst: (ball) => groupOf(ball) === 'solids',
    shoot: async (strike: StrikeRequest) => {
      const shot = runLocalShot(spots, strike, false);
      pending.current = { receipt: receiptText(shot.outcome.firstContact, shot.firstCut), rest: shot.rest };
      setReplay({ id: Date.now() + shots, frames: shot.frames, frameMs: FRAME_MS });
    },
    place: async () => null,
    announce: (line) => setLog((lines) => [...lines, line]),
    replayFinished: () => {
      const done = pending.current;
      if (done === null) return;
      pending.current = null;
      setReplay(null);
      setReceipt(done.receipt);
      setShots((count) => count + 1);
      if (step === LAST_STEP) {
        setSpots(done.rest);
        setFinished(true);
        return;
      }
      setStep(step + 1);
      setSpots(stepSpots(step + 1));
    },
  };

  return (
    <>
      <TableView store={store} model={model} />
      {finished && (
        <Modal label="Save your progress">
          <h2>Save your progress</h2>
          <button type="button" className="primary" onClick={(event) => {
            localStorage.setItem(TUTORIAL_KEY, '1');
            openSheet({ opener: event.currentTarget, then: () => navigate('/home') });
          }}>Create account</button>
          <button type="button" onClick={leave}>Skip for now</button>
        </Modal>
      )}
    </>
  );
}
