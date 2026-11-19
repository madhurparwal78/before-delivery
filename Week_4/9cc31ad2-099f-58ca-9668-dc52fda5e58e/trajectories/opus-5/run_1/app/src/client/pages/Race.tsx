import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LAYOUTS,
  type Lane,
  findEvent,
  isEligible,
  statsWithStages,
  stepLimitFor,
} from '../../shared/catalogue.js';
import {
  formatDelta,
  formatRaceTime,
  formatSpeed,
  formatThousands,
  type Units,
} from '../../shared/format.js';
import {
  AiCar,
  CarSim,
  type Contender,
  type InputEvent,
  type InputState,
  LANES,
  rankContenders,
  stepsToMs,
} from '../../shared/race-model.js';
import { serialiseReplayFile } from '../../shared/replay-file.js';
import { apiGet, apiPost } from '../api.js';
import { Dialog } from '../components/Dialog.js';
import { Page } from '../components/Page.js';
import { RaceView, type RaceCar, type RaceSceneRef } from '../components/RaceView.js';
import { copy, lapAnnouncement } from '../copy.js';
import { requestGarageLinkFocus } from '../focus-intent.js';
import { sendFinish } from '../finish.js';
import { useWideEnoughToRace } from '../hooks.js';
import { parseRaceAddress } from '../race-address.js';
import { Link, navigate, useLocation } from '../router.js';
import { refreshGarage, useGarage, useMe } from '../store.js';
import type { CreatedRun, ReplayFile, RunBody } from '../types.js';

interface Hud {
  started: boolean;
  lap: number;
  laps: number;
  position: number;
  cars: number;
  speedMps: number;
  coins: number;
  drift: number;
  stageSeconds: number;
  deltaMs: number | null;
}

interface Ghost {
  name: string;
  distances: number[];
  lanes: Lane[];
}

type GhostState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'ready'; name: string }
  | { kind: 'unavailable' };

const START_HUD: Hud = {
  started: false,
  lap: 1,
  laps: 1,
  position: 1,
  cars: 1,
  speedMps: 0,
  coins: 0,
  drift: 0,
  stageSeconds: 90,
  deltaMs: null,
};

function ghostMsAtDistance(ghost: Ghost, distance: number): number {
  const distances = ghost.distances;
  let low = 0;
  let high = distances.length - 1;
  if (distances[high]! < distance) return stepsToMs(high);
  while (low < high) {
    const middle = (low + high) >> 1;
    if (distances[middle]! < distance) low = middle + 1;
    else high = middle;
  }
  return stepsToMs(low);
}

export function Race() {
  const location = useLocation();
  const address = parseRaceAddress(location.search);
  const wideEnough = useWideEnoughToRace();
  const garage = useGarage();
  const { me } = useMe();
  const units: Units = me?.units ?? 'kmh';

  const [run, setRun] = useState<CreatedRun | null>(null);
  const [hud, setHud] = useState<Hud>(START_HUD);
  const [paused, setPaused] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [ghostState, setGhostState] = useState<GhostState>({ kind: 'none' });
  const [epoch, setEpoch] = useState(0);

  const sim = useRef<CarSim | null>(null);
  const inputs = useRef<InputEvent[]>([]);
  const keys = useRef<InputState>({ throttle: 0, brake: 0, drift: 0, lane: 'middle' });
  const ai = useRef<AiCar[]>([]);
  const ghost = useRef<Ghost | null>(null);
  const started = useRef(false);
  const pausedRef = useRef(false);
  const finished = useRef(false);
  const clockBase = useRef(0);
  const stepsAtBase = useRef(0);
  const epochRef = useRef(0);
  const startRequested = useRef(false);
  const hudRegion = useRef<HTMLDivElement>(null);
  const resumeButton = useRef<HTMLButtonElement>(null);
  const scene = useRef<RaceSceneRef>({ cars: [] });

  epochRef.current = epoch;

  useEffect(() => {
    if (garage === null) void refreshGarage();
  }, [garage]);

  const beginRace = useCallback(() => {
    if (started.current) return;
    if (sim.current === null) {
      startRequested.current = true;
      return;
    }
    startRequested.current = false;
    started.current = true;
    clockBase.current = performance.now();
    stepsAtBase.current = 0;
    inputs.current = [{ step: 0, ...keys.current }];
    setHud((current) => ({ ...current, started: true }));
  }, []);

  // Creates the run this address names, in the garage's car or the event's loaner.
  useEffect(() => {
    if (!wideEnough || address === null || garage === null) return;
    const mine = epoch;
    const event = address.eventId === null ? null : findEvent(address.eventId);
    const body: Record<string, unknown> = {
      layoutId: address.layoutId,
      mode: address.mode,
    };
    if (address.eventId !== null) body.eventId = address.eventId;
    if (address.laps !== null) body.laps = address.laps;
    if (event && event.class !== null) {
      const eligible =
        garage.cars.find(
          (car) => car.carId === garage.selectedCarId && isEligible(car.carId, car.stages, event.class!),
        ) ?? garage.cars.find((car) => isEligible(car.carId, car.stages, event.class!));
      if (eligible) body.carId = eligible.carId;
      else body.loaner = true;
    } else {
      body.carId = garage.selectedCarId;
    }
    void apiPost<CreatedRun>('/v1/runs', body).then((result) => {
      if (result.kind !== 'ok' || epochRef.current !== mine) return;
      const layout = LAYOUTS[result.data.layoutId];
      sim.current = new CarSim({
        layout,
        stats: result.data.car.stats,
        mode: result.data.mode,
        laps: result.data.laps,
        stepLimit: result.data.stepLimit,
      });
      ai.current = result.data.ai.map(
        (entry) =>
          new AiCar(entry.name, entry.carId, entry.paceFactor, {
            layout,
            stats: statsWithStages(entry.carId, {
              engine: 0,
              tires: 0,
              brakes: 0,
              suspension: 0,
            }),
            mode: result.data.mode,
            laps: result.data.laps,
            stepLimit: result.data.stepLimit,
          }),
      );
      inputs.current = [];
      keys.current = { throttle: 0, brake: 0, drift: 0, lane: 'middle' };
      started.current = false;
      finished.current = false;
      setRun(result.data);
      setHud({
        ...START_HUD,
        laps: result.data.laps,
        cars: 1 + result.data.ai.length,
      });
      if (startRequested.current) beginRace();
    });
  }, [
    wideEnough,
    address?.layoutId,
    address?.mode,
    address?.eventId,
    address?.laps,
    garage,
    epoch,
    beginRace,
  ]);

  // Loads the ghost's replay and drives it through the same race model.
  useEffect(() => {
    if (address?.ghostRunId === undefined || address?.ghostRunId === null) {
      setGhostState({ kind: 'none' });
      ghost.current = null;
      return;
    }
    const mine = epoch;
    const ghostRunId = address.ghostRunId;
    setGhostState({ kind: 'loading' });
    void (async () => {
      const summary = await apiGet<RunBody>(`/v1/runs/${ghostRunId}`);
      const replay = await apiGet<ReplayFile>(`/v1/runs/${ghostRunId}/replay`);
      if (epochRef.current !== mine) return;
      if (summary.kind !== 'ok' || replay.kind !== 'ok') {
        ghost.current = null;
        setGhostState({ kind: 'unavailable' });
        return;
      }
      const body = summary.data;
      const layout = LAYOUTS[body.layoutId];
      const laps = body.lapResults?.length ?? 1;
      const config = {
        layout,
        stats: body.car.stats,
        mode: body.mode,
        laps,
        stepLimit: stepLimitFor(body.mode, laps),
      };
      const lanes: Lane[] = [];
      const ghostSim = new CarSim(config);
      const list = replay.data.inputs;
      let cursor = 0;
      while (!ghostSim.ended) {
        while (cursor + 1 < list.length && list[cursor + 1]!.step <= ghostSim.stepsCompleted) {
          cursor += 1;
        }
        const event = list[cursor]!;
        ghostSim.step({
          throttle: event.throttle,
          brake: event.brake,
          drift: event.drift,
          lane: event.lane,
        });
        lanes.push(ghostSim.lane);
      }
      ghost.current = { name: body.name, distances: ghostSim.distanceByStep, lanes };
      setGhostState({ kind: 'ready', name: body.name });
    })();
  }, [address?.ghostRunId, epoch]);

  const finishRun = useCallback((created: CreatedRun) => {
    finished.current = true;
    const bytes = serialiseReplayFile(created.seed, inputs.current);
    sendFinish(created.runId, bytes);
    navigate(`/runs/${created.runId}`, { replace: true });
  }, []);

  const recordInput = useCallback((next: InputState) => {
    const current = sim.current;
    if (current === null || !started.current || finished.current) return;
    const step = current.stepsCompleted;
    const list = inputs.current;
    const last = list[list.length - 1];
    const event: InputEvent = { step, ...next };
    if (last && last.step === step) list[list.length - 1] = event;
    else list.push(event);
  }, []);

  // The race model advances 60 steps per second of page time.
  useEffect(() => {
    if (run === null) return;
    const mine = epoch;
    const timer = window.setInterval(() => {
      if (epochRef.current !== mine) return;
      const current = sim.current;
      const created = run;
      if (current === null || !started.current || pausedRef.current || finished.current) return;
      const target =
        stepsAtBase.current +
        Math.floor(((performance.now() - clockBase.current) * 60) / 1000);
      let lapMessage: string | null = null;
      while (current.stepsCompleted < target && !current.ended) {
        const outcome = current.step(keys.current);
        if (outcome.lap !== null) {
          lapMessage = lapAnnouncement(
            current.lapsCompleted,
            formatRaceTime(outcome.lap.lapMs),
            outcome.lap.valid,
          );
        }
      }
      if (lapMessage !== null) setAnnouncement(lapMessage);

      const contenders: Contender[] = [
        {
          name: 'player',
          isPlayer: true,
          lapsCompleted: current.lapsCompleted,
          lapPos: current.lapPos,
          finishStep: current.reachedEnd ? current.stepsCompleted : null,
        },
        ...ai.current.map((car) => {
          const layoutLength = LAYOUTS[created.layoutId].lengthM;
          const distance = car.distanceAtStep(current.stepsCompleted);
          return {
            name: car.name,
            isPlayer: false,
            lapsCompleted: Math.floor(distance / layoutLength),
            lapPos: distance % layoutLength,
            finishStep: current.stepsCompleted >= car.finishStep ? car.finishStep : null,
          };
        }),
      ];
      const position = rankContenders(contenders).findIndex((entry) => entry.isPlayer) + 1;
      const currentGhost = ghost.current;
      const deltaMs =
        currentGhost === null
          ? null
          : stepsToMs(current.stepsCompleted) -
            ghostMsAtDistance(currentGhost, current.totalDistance);

      scene.current.cars = [
        { kind: 'player', distance: current.lapPos, lane: current.lane },
        ...ai.current.map((car): RaceCar => ({
          kind: 'ai',
          distance: car.distanceAtStep(current.stepsCompleted) % LAYOUTS[created.layoutId].lengthM,
          lane: 'middle',
        })),
        ...(currentGhost === null
          ? []
          : [
              {
                kind: 'ghost' as const,
                distance:
                  (currentGhost.distances[
                    Math.min(current.stepsCompleted, currentGhost.distances.length - 1)
                  ] ?? 0) % LAYOUTS[created.layoutId].lengthM,
                lane:
                  currentGhost.lanes[
                    Math.min(current.stepsCompleted, currentGhost.lanes.length - 1)
                  ] ?? 'middle',
              },
            ]),
      ];

      setHud({
        started: true,
        lap: Math.min(current.lapsCompleted + 1, created.laps),
        laps: created.laps,
        position,
        cars: 1 + ai.current.length,
        speedMps: current.speed,
        coins: current.coinsCollected,
        drift: current.driftScore,
        stageSeconds: current.driftSecondsLeft,
        deltaMs,
      });

      if (current.ended && !finished.current) finishRun(created);
    }, 1000 / 60);
    return () => window.clearInterval(timer);
  }, [run, epoch, finishRun]);

  const openPause = useCallback(() => {
    if (!started.current || finished.current) return;
    pausedRef.current = true;
    stepsAtBase.current = sim.current?.stepsCompleted ?? 0;
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    clockBase.current = performance.now();
    stepsAtBase.current = sim.current?.stepsCompleted ?? 0;
    setPaused(false);
    hudRegion.current?.focus();
  }, []);

  useEffect(() => {
    if (paused) resumeButton.current?.focus();
  }, [paused]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') openPause();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [openPause]);

  useEffect(() => {
    if (!wideEnough) return;
    const change = (next: Partial<InputState>) => {
      keys.current = { ...keys.current, ...next };
      recordInput(keys.current);
    };
    const laneStep = (direction: -1 | 1) => {
      const index = LANES.indexOf(keys.current.lane);
      const next = LANES[index + direction];
      if (next) change({ lane: next });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'escape') {
        if (pausedRef.current) resume();
        else openPause();
        event.preventDefault();
        return;
      }
      if (key === 'enter' && !started.current) {
        event.preventDefault();
        beginRace();
        return;
      }
      if (pausedRef.current) return;
      if (key === 'arrowup' || key === 'w') {
        event.preventDefault();
        change({ throttle: 1 });
      } else if (key === 'arrowdown' || key === 's') {
        event.preventDefault();
        change({ brake: 1 });
      } else if (key === ' ' || key === 'spacebar') {
        event.preventDefault();
        change({ drift: 1 });
      } else if (key === 'arrowleft' || key === 'a') {
        event.preventDefault();
        laneStep(-1);
      } else if (key === 'arrowright' || key === 'd') {
        event.preventDefault();
        laneStep(1);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'arrowup' || key === 'w') change({ throttle: 0 });
      else if (key === 'arrowdown' || key === 's') change({ brake: 0 });
      else if (key === ' ' || key === 'spacebar') change({ drift: 0 });
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [wideEnough, openPause, resume, recordInput, beginRace]);

  useEffect(() => {
    if (wideEnough) hudRegion.current?.focus();
  }, [wideEnough, run]);

  if (address === null) return null;

  if (!wideEnough) {
    return (
      <Page gutter={['Race']}>
        <h1>Race</h1>
        <p className="cell">{copy.desktopNotice}</p>
        <Link to="/garage" className="secondary">
          Back to garage
        </Link>
      </Page>
    );
  }

  const showPosition = address.mode === 'circuit';
  const showCoins = address.mode === 'practice' || address.mode === 'circuit';
  const showDrift = address.mode === 'drift';

  return (
    <Page gutter={['Track', 'HUD']}>
      <h1>Race</h1>
      <div className="race-screen">
        <RaceView layoutId={address.layoutId} scene={scene} cars={scene.current.cars} />
        <div
          className="hud"
          role="region"
          aria-label="Race HUD"
          tabIndex={0}
          ref={hudRegion}
        >
          <span className="hud-line">
            Lap {hud.lap}/{hud.laps}
          </span>
          {showPosition && (
            <span className="hud-line">
              Position {hud.position}/{hud.cars}
            </span>
          )}
          <span className="hud-line">{formatSpeed(hud.speedMps, units)}</span>
          {showCoins && <span className="hud-line">Coins {formatThousands(hud.coins)}</span>}
          {showDrift && (
            <>
              <span className="hud-line">Drift {formatThousands(hud.drift)}</span>
              <span className="hud-line">Stage time {hud.stageSeconds}</span>
            </>
          )}
          {ghostState.kind === 'loading' && (
            <span className="hud-line">{copy.ghostLoading}</span>
          )}
          {ghostState.kind === 'ready' && (
            <span className="hud-line">Ghost: {ghostState.name}</span>
          )}
          {ghostState.kind === 'unavailable' && (
            <span className="hud-line">{copy.ghostUnavailable}</span>
          )}
          {ghostState.kind !== 'none' && (
            <span className="hud-line">Delta {formatDelta(hud.deltaMs ?? 0)}</span>
          )}
          {!hud.started && <span className="hud-line">{copy.startPrompt}</span>}
        </div>
      </div>
      <div className="row">
        <button type="button" className="secondary" onClick={openPause}>
          Pause
        </button>
      </div>
      <div className="cell" role="status" aria-label="Race updates">
        {announcement}
      </div>
      {paused && (
        <Dialog label="Paused" onEscape={resume}>
          <h2>Paused</h2>
          <div className="dialog-actions">
            <button type="button" className="primary" ref={resumeButton} onClick={resume}>
              Resume
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                pausedRef.current = false;
                setPaused(false);
                finished.current = true;
                started.current = false;
                startRequested.current = false;
                sim.current = null;
                setRun(null);
                setHud(START_HUD);
                setAnnouncement('');
                setEpoch((value) => value + 1);
              }}
            >
              Restart
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                finished.current = true;
                requestGarageLinkFocus();
                navigate('/garage');
              }}
            >
              Quit to garage
            </button>
          </div>
        </Dialog>
      )}
    </Page>
  );
}
