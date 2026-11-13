import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { POCKETS, pocketName, type Pocket } from '../../shared/domain';
import { CUE_BALL, TABLE_LENGTH, TABLE_WIDTH, aimTowards, predictContact, type BallSpots, type Point } from '../../shared/physics';
import { CALL_POCKET } from '../../shared/rules';
import { reducedMotion, type Store } from '../store';
import { Figures, Link, TopBar } from '../ui';
import { playStrike, syncRoomTone } from './audio';
import { LoupeView } from './Loupe';
import type { TableModel } from './model';
import { drawScene, toTable } from './render';
import { ResultDialog } from './ResultDialog';

const POWER_REST = 50;
const POWER_FLAT_MS = 200;
const POWER_PER_MS = 0.05;
const TANGENT_MS = 330;
const SPIN_CYCLE = [
  { name: 'none', side: 0, top: 0 },
  { name: 'top', side: 0, top: 50 },
  { name: 'back', side: 0, top: -50 },
  { name: 'left', side: -50, top: 0 },
  { name: 'right', side: 50, top: 0 },
];
const HEAD_STRING_ALONG = 25;

function wrapAim(value: number): number {
  return Math.round(((value + 360) % 360) * 10) / 10 % 360;
}

function spinName(side: number, top: number): string {
  if (side === 0 && top === 0) return 'none';
  if (Math.abs(top) >= Math.abs(side)) return top > 0 ? 'top' : 'back';
  return side > 0 ? 'right' : 'left';
}

function interpolate(from: BallSpots, to: BallSpots, share: number): BallSpots {
  const spots: BallSpots = {};
  for (const [key, [x, y]] of Object.entries(from)) {
    const target = to[Number(key)];
    spots[Number(key)] = target === undefined ? [x, y] : [x + (target[0] - x) * share, y + (target[1] - y) * share];
  }
  return spots;
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  text?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, text, disabled = false, onChange }: SliderProps): ReactNode {
  return (
    <div className="slider-row">
      <span className="label" aria-hidden="true"><span>{label}</span><span>{text ?? value}</span></span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

export function TableView({ store, model }: { store: Store; model: TableModel }): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [aim, setAim] = useState(0);
  const [fine, setFine] = useState(0);
  const [power, setPower] = useState(POWER_REST);
  const [side, setSide] = useState(0);
  const [top, setTop] = useState(0);
  const [spinIndex, setSpinIndex] = useState(0);
  const [locked, setLocked] = useState(false);
  const [loupeOpen, setLoupeOpen] = useState(false);
  const [tangent, setTangent] = useState(0);
  const [called, setCalled] = useState<Pocket | null>(null);
  const [across, setAcross] = useState(50);
  const [along, setAlong] = useState(HEAD_STRING_ALONG);
  const [placed, setPlaced] = useState(false);
  const [placeError, setPlaceError] = useState('');
  const [pending, setPending] = useState(false);
  const [drawnSpots, setDrawnSpots] = useState<BallSpots | null>(null);
  const hold = useRef<{ started: number; frame: number; value: number } | null>(null);
  const tangentFrame = useRef(0);
  const tangentValue = useRef(0);
  const draggingCue = useRef(false);
  const moving = drawnSpots !== null;

  const baseSpots = model.spots;
  const cueSpot: Point | undefined = baseSpots[CUE_BALL];
  const previewCue: Point | undefined = model.ballInHand && model.myShot ? [across, along * 2] : cueSpot;
  const spots = drawnSpots ?? (previewCue === undefined ? baseSpots : { ...baseSpots, [CUE_BALL]: previewCue });
  const aimTotal = wrapAim(aim + fine);
  const canAim = model.myShot && !moving;
  const contact = canAim && spots[CUE_BALL] !== undefined ? predictContact(spots, aimTotal) : null;
  const loupeShown = loupeOpen && canAim && model.guidelines && contact !== null;
  const strikeBlocked = model.calledPocketRequired && called === null;
  const leftHanded = store.settings.leftHanded;

  const animateTangent = (target: number): void => {
    cancelAnimationFrame(tangentFrame.current);
    if (reducedMotion()) {
      tangentValue.current = target;
      setTangent(target);
      return;
    }
    const from = tangentValue.current;
    const duration = (TANGENT_MS * Math.abs(target - from)) / 100;
    const started = performance.now();
    const step = (): void => {
      const share = duration === 0 ? 1 : Math.min(1, (performance.now() - started) / duration);
      const value = Math.round(from + (target - from) * share);
      tangentValue.current = value;
      flushSync(() => setTangent(value));
      if (share < 1) tangentFrame.current = requestAnimationFrame(step);
    };
    tangentFrame.current = requestAnimationFrame(step);
  };

  const setLock = (next: boolean): void => {
    setLocked(next);
    if (loupeOpen || next) animateTangent(next ? 100 : 0);
  };

  useLayoutEffect(() => {
    setPower(POWER_REST);
    setLocked(false);
    setLoupeOpen(false);
    tangentValue.current = 0;
    setTangent(0);
    setCalled(null);
    setSide(0);
    setTop(0);
    setSpinIndex(0);
    setFine(0);
    setPlaced(false);
    setPlaceError('');
  }, [model.turnKey]);

  useLayoutEffect(() => {
    setAim(0);
  }, [model.aimResetKey]);

  useLayoutEffect(() => {
    if (cueSpot !== undefined && model.ballInHand) {
      setAcross(Math.round(cueSpot[0]));
      setAlong(Math.round(cueSpot[1] / 2));
    }
  }, [model.ballInHand, model.turnKey]);

  useEffect(() => syncRoomTone(), [store.settings.music]);

  const scene = { spots, cloth: model.cloth, aimDegrees: canAim ? aimTotal : null, contact, guideline: model.guidelines, guidelineBonus: model.aimBonus };
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  useLayoutEffect(() => {
    if (canvas.current !== null) drawScene(canvas.current, sceneRef.current);
  });
  useEffect(() => {
    const element = canvas.current as HTMLCanvasElement;
    const observer = new ResizeObserver(() => drawScene(element, sceneRef.current));
    observer.observe(element);
    void document.fonts.ready.then(() => drawScene(element, sceneRef.current));
    return () => observer.disconnect();
  }, []);

  const { replay, replayFinished } = model;
  useLayoutEffect(() => {
    if (replay === null) return undefined;
    const { frames, frameMs, id } = replay;
    if (reducedMotion() || frames.length < 2) {
      setDrawnSpots(null);
      replayFinished(id);
      return undefined;
    }
    setDrawnSpots(frames[0]);
    const started = performance.now();
    let frame = requestAnimationFrame(function step(): void {
      const position = (performance.now() - started) / frameMs;
      const index = Math.floor(position);
      if (index >= frames.length - 1) {
        setDrawnSpots(null);
        replayFinished(id);
        return;
      }
      setDrawnSpots(interpolate(frames[index], frames[index + 1], position - index));
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [replay?.id]);

  const placeIfMoved = async (): Promise<boolean> => {
    if (!model.ballInHand || placed) return true;
    const failure = await model.place(across, along);
    setPlaceError(failure ?? '');
    return failure === null;
  };

  const take = async (shotPower: number): Promise<void> => {
    setPower(POWER_REST);
    if (shotPower <= 0) {
      model.announce('No power. Shot cancelled.', false);
      return;
    }
    if (pending || moving) return;
    setPending(true);
    try {
      if (await placeIfMoved()) {
        playStrike(shotPower);
        await model.shoot({ aimDegrees: aimTotal, power: Math.round(shotPower), sideSpin: side, topSpin: top, calledPocket: called });
      }
    } finally {
      setPending(false);
    }
  };

  const confirmPlacement = async (): Promise<void> => {
    const failure = await model.place(across, along);
    setPlaceError(failure ?? '');
    if (failure === null) setPlaced(true);
  };

  const showLoupe = (): void => {
    if (model.myShot) setLoupeOpen(true);
  };

  const nudgeAim = (delta: number): void => {
    showLoupe();
    if (!locked) setAim((current) => wrapAim(current + delta));
  };

  const cycleSpin = (): void => {
    const next = (spinIndex + 1) % SPIN_CYCLE.length;
    setSpinIndex(next);
    setSide(SPIN_CYCLE[next].side);
    setTop(SPIN_CYCLE[next].top);
  };

  const startHold = (): void => {
    const state = { started: performance.now(), frame: 0, value: 0 };
    hold.current = state;
    flushSync(() => setPower(0));
    const step = (): void => {
      const held = performance.now() - state.started;
      state.value = held <= POWER_FLAT_MS ? 0 : Math.min(100, (held - POWER_FLAT_MS) * POWER_PER_MS);
      flushSync(() => setPower(Math.round(state.value)));
      state.frame = requestAnimationFrame(step);
    };
    state.frame = requestAnimationFrame(step);
  };

  const endHold = (): number | null => {
    const state = hold.current;
    if (state === null) return null;
    cancelAnimationFrame(state.frame);
    hold.current = null;
    return Math.round(state.value);
  };

  const keys = useRef({ take, nudgeAim, cycleSpin, setLock, locked, model, strikeBlocked, canAim, startHold, endHold });
  keys.current = { take, nudgeAim, cycleSpin, setLock, locked, model, strikeBlocked, canAim, startHold, endHold };

  useEffect(() => {
    const inTextField = (target: EventTarget | null): boolean =>
      target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'radio';
    const onKeyDown = (event: KeyboardEvent): void => {
      const now = keys.current;
      if (inTextField(event.target) || document.querySelector('[aria-modal="true"]:not(.sheet:not(.open))') !== null) return;
      if (event.key === 'Escape') {
        if (endHold() !== null) {
          setPower(POWER_REST);
          now.model.announce('Shot cancelled.', false);
        }
        return;
      }
      const inPocket = (event.target as HTMLElement).closest?.('[aria-label="Called pocket"]') != null;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (inPocket) return;
        event.preventDefault();
        if (!now.model.myShot) return;
        const step = event.shiftKey ? 0.1 : 1;
        now.nudgeAim(event.key === 'ArrowRight' ? step : -step);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const focused = event.target as HTMLElement;
        if (inPocket) return;
        if (!(focused instanceof HTMLInputElement && focused.type === 'range') || focused.getAttribute('aria-label') === 'Aim angle') event.preventDefault();
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        if (event.repeat || !now.canAim) return;
        if (now.strikeBlocked) {
          now.model.announce(CALL_POCKET, true);
          return;
        }
        now.startHold();
        return;
      }
      if (!now.model.myShot || event.ctrlKey || event.metaKey || event.altKey) return;
      const letter = event.key.toLowerCase();
      if (letter === 's') now.cycleSpin();
      if (letter === 'l') now.setLock(!now.locked);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== ' ' || inTextField(event.target)) return;
      event.preventDefault();
      const released = keys.current.endHold();
      if (released !== null) void keys.current.take(released);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const pointerPoint = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return toTable(box.width, box.height, event.clientX - box.left, event.clientY - box.top);
  };
  const aimAtPointer = (point: Point): void => {
    showLoupe();
    if (locked || !canAim || spots[CUE_BALL] === undefined) return;
    const target = aimTowards(spots[CUE_BALL], point);
    const delta = ((target - aim + 540) % 360) - 180;
    setAim(wrapAim(aim + delta * Math.min(1, store.settings.aimSensitivity / 5)));
  };
  const moveCue = (point: Point): void => {
    const limit = model.behindHeadString ? HEAD_STRING_ALONG : 100;
    setAcross(Math.round(Math.min(100, Math.max(0, point[0] * (100 / TABLE_WIDTH)))));
    setAlong(Math.round(Math.min(limit, Math.max(0, (point[1] / TABLE_LENGTH) * 100))));
    setPlaced(false);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const point = pointerPoint(event);
    const cue = spots[CUE_BALL];
    if (model.ballInHand && model.myShot && cue !== undefined && Math.hypot(point[0] - cue[0], point[1] - cue[1]) < 7) {
      draggingCue.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    aimAtPointer(point);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const point = pointerPoint(event);
    if (draggingCue.current) moveCue(point);
    else if (event.pointerType === 'mouse' || event.buttons > 0) aimAtPointer(point);
  };
  const onPointerLeave = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.pointerType === 'mouse' && !locked) setLoupeOpen(false);
  };

  const loupeLabel = contact === null ? '' : contact.ball === null ? 'Blocked' : model.legalFirst(contact.ball) ? 'Legal' : 'Wrong group';
  const banner = model.banner;

  return (
    <>
      <TopBar store={store} brandLink={false} />
      <main className={`table-shell${leftHanded ? ' left-handed' : ''}`}>
        <h1 className="visually-hidden" tabIndex={-1}>Table</h1>
        <section className="scoreboard" role="region" aria-label="Scoreboard">
          <div className="score-seats">
            {model.seats.map((seat, index) => (
              <div className={`score-seat${seat.active ? ' active' : ''}`} key={index}>
                <span className="score-name">{seat.name}</span>
                <span className="caption">{seat.group}</span>
                <span><span className="score-count"><Figures text={String(seat.left)} /></span> {seat.left === 1 ? 'ball left' : 'balls left'}</span>
              </div>
            ))}
          </div>
          {model.potText !== null && <p className="score-pot"><Figures text={model.potText} /></p>}
          <div className="score-meta">
            <p role="status" aria-label="Turn" className="turn-text">{model.turn}</p>
            {model.clock !== null && <p role="timer" aria-label="Shot clock" className="score-clock"><Figures text={`${model.clock}s`} /></p>}
          </div>
          {model.reconnect !== null && <p role="timer" aria-label="Reconnect" className="rule-banner">{model.reconnect}</p>}
          <p role="status" aria-label="Rule banner" className={`rule-banner${/^(Foul|Illegal)/.test(banner) ? ' is-foul' : ''}`}>{banner}</p>
        </section>
        <div className="table-stage">
          <div className="felt-wrap">
            <canvas
              ref={canvas}
              className="felt"
              role="img"
              aria-label="Table"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => {
                draggingCue.current = false;
              }}
              onPointerLeave={onPointerLeave}
            />
            {loupeShown && <LoupeView contact={contact} aimDegrees={aimTotal} tangent={tangent} locked={locked} label={contact.ball === null ? loupeLabel : `${loupeLabel} ${contact.cut.toFixed(1)}°`} />}
          </div>
          <div className="below-table">
            {model.tutorialStep !== null && <p role="status" aria-label="Tutorial step" className="turn-text">{model.tutorialStep}</p>}
            <section role="region" aria-label="Shot receipt">{model.receipt}</section>
            {loupeShown && (
              <>
                <p role="status" aria-label="Contact loupe">
                  {loupeLabel} · {contact.ball === null ? 'Cut --' : `Cut ${contact.cut.toFixed(1)}°`}{contact.ball !== null && ` · First ball ${contact.ball}`}
                </p>
                <div role="progressbar" aria-label="Tangent draw" aria-valuemin={0} aria-valuemax={100} aria-valuenow={tangent} className="tangent-track">
                  <span style={{ width: `${tangent}%` }} />
                </div>
              </>
            )}
          </div>
        </div>
        <div className="side-panel">
          {model.myShot && model.calledPocketRequired && (
            <div className="pocket-choice radio-row" role="radiogroup" aria-label="Called pocket">
              {POCKETS.map((pocket) => (
                <label className="radio" key={pocket}>
                  <input type="radio" name="called-pocket" checked={called === pocket} onChange={() => setCalled(pocket)} />
                  {pocketName(pocket)}
                </label>
              ))}
            </div>
          )}
          {model.myShot && model.ballInHand && (
            <div className="placement" role="group" aria-label="Ball placement">
              <Slider label="Cue ball across" value={across} min={0} max={100} step={1} onChange={(value) => {
                setAcross(value);
                setPlaced(false);
              }} />
              <Slider label="Cue ball along" value={along} min={0} max={model.behindHeadString ? HEAD_STRING_ALONG : 100} step={1} onChange={(value) => {
                setAlong(value);
                setPlaced(false);
              }} />
              {placeError !== '' && <p className="field-error">{placeError}</p>}
              <button type="button" onClick={() => void confirmPlacement()}>Place ball</button>
            </div>
          )}
          {model.myShot && (
            <section className="shot-controls" role="region" aria-label="Shot controls">
              <div className="shot-sliders">
                <Slider label="Aim angle" value={aim} min={0} max={359.9} step={0.1} text={aim.toFixed(1)} disabled={locked} onChange={(value) => {
                  showLoupe();
                  setAim(value);
                }} />
                <Slider label="Fine aim" value={fine} min={-1} max={1} step={0.1} text={fine.toFixed(1)} disabled={locked} onChange={setFine} />
                <Slider label="Shot power" value={power} min={0} max={100} step={1} text={`${power}%`} onChange={setPower} />
                <Slider label="Side spin" value={side} min={-100} max={100} step={1} onChange={setSide} />
                <Slider label="Top spin" value={top} min={-100} max={100} step={1} onChange={setTop} />
              </div>
              <p role="status" aria-label="Spin" className="note">Spin: {spinName(side, top)}</p>
              <div className="shot-actions">
                <button type="button" aria-pressed={locked} onClick={() => setLock(!locked)}>Lock aim</button>
                <button type="button" className="primary" disabled={strikeBlocked || moving || pending} onClick={() => void take(power)}>Strike</button>
              </div>
            </section>
          )}
          <Link href="/home" className="back-link">Back to lobby</Link>
          {model.children}
          <div role="log" aria-label="Table announcements" aria-live="polite" className="table-log">
            {model.log.slice(-40).map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}
          </div>
        </div>
      </main>
      {model.result !== null && <ResultDialog result={model.result} />}
    </>
  );
}
