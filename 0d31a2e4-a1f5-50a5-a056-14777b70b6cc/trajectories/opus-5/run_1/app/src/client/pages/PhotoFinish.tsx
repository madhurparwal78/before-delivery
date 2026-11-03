import { useCallback, useEffect, useRef, useState } from 'react';
import { roundKindLabel, roundName, slotsLabel } from '../../shared/rounds.js';
import type { FramePayload, Match } from '../../shared/types.js';
import { api } from '../lib/api.js';
import { Link, replaceQuery, useLocation } from '../lib/router.js';
import { Bean, formatPosition, useReducedMotion } from '../lib/ui.js';
import { ReplayCanvas } from '../three/ReplayCanvas.js';

interface Props {
  matchId: number;
  roundNumber: number;
}

const PAGE_STEP = 20;

export function PhotoFinishPage({ matchId, roundNumber }: Props) {
  const { search } = useLocation();
  const requestedTick = Number(search.get('tick') ?? '');
  const reducedMotion = useReducedMotion();
  const [frame, setFrame] = useState<FramePayload | null>(null);
  const [tick, setTick] = useState(Number.isInteger(requestedTick) ? requestedTick : 0);
  const [lastTick, setLastTick] = useState<number | null>(null);
  const [seed, setSeed] = useState<number | null>(null);
  const [jumped, setJumped] = useState(false);
  const [flightKey, setFlightKey] = useState(0);
  const [problem, setProblem] = useState('');
  const cache = useRef(new Map<number, FramePayload>());
  const wanted = useRef(tick);
  const dragging = useRef(false);
  const regionRef = useRef<HTMLElement | null>(null);

  const base = `/api/matches/${matchId}/rounds/${roundNumber}/frames`;

  const fetchFrame = useCallback(
    async (target: number): Promise<FramePayload | null> => {
      const hit = cache.current.get(target);
      if (hit !== undefined) return hit;
      try {
        const payload = await api.get<FramePayload>(`${base}?tick=${target}`);
        cache.current.set(target, payload);
        return payload;
      } catch {
        return null;
      }
    },
    [base],
  );

  useEffect(() => {
    cache.current.clear();
    const run = async (): Promise<void> => {
      let payload: { match: Match };
      try {
        payload = await api.get<{ match: Match }>(`/api/matches/${matchId}`);
      } catch {
        setProblem('That match is not here.');
        return;
      }
      const round = payload.match.rounds.find((candidate) => candidate.n === roundNumber);
      if (round === undefined || round.lastTick === null) {
        setProblem('That round has no photo-finish yet.');
        return;
      }
      setSeed(round.seed);
      setLastTick(round.lastTick);
      const start = Math.max(0, Math.min(round.lastTick, wanted.current));
      wanted.current = start;
      setTick(start);
      const first = await fetchFrame(start);
      if (first === null) setProblem('That round has no photo-finish yet.');
      else setFrame(first);
    };
    void run();
  }, [fetchFrame, matchId, roundNumber]);

  useEffect(() => {
    if (lastTick === null) return;
    wanted.current = tick;
    replaceQuery(`/matches/${matchId}/rounds/${roundNumber}?tick=${tick}`);
    const run = async (): Promise<void> => {
      const payload = await fetchFrame(tick);
      if (payload !== null && wanted.current === tick) setFrame(payload);
      void fetchFrame(Math.min(lastTick, tick + 1));
      void fetchFrame(Math.max(0, tick - 1));
    };
    void run();
  }, [tick, lastTick, fetchFrame, matchId, roundNumber]);

  const move = (target: number, jump: boolean): void => {
    if (lastTick === null) return;
    const clamped = Math.max(0, Math.min(lastTick, target));
    setJumped(jump && clamped !== tick);
    setTick(clamped);
  };

  const onBeansMoving = useCallback((moving: boolean) => {
    regionRef.current?.setAttribute('data-beans', moving ? 'moving' : 'still');
  }, []);

  const onCameraMoving = useCallback((moving: boolean) => {
    regionRef.current?.setAttribute('data-camera', moving ? 'moving' : 'still');
  }, []);

  if (problem !== '') {
    return (
      <section className="card">
        <h1>Photo-finish</h1>
        <p>{problem}</p>
      </section>
    );
  }
  if (frame === null || lastTick === null || seed === null) {
    return <section className="card">Loading photo-finish…</section>;
  }

  const label = slotsLabel(frame.kind);
  const name = roundName(frame.kind);

  return (
    <div className="photo-finish-page">
      <section
        className="card replay-card"
        aria-label="Photo-finish"
        data-camera="still"
        data-beans="still"
        ref={regionRef}
      >
        <header className="replay-head">
          <h1 className="display">{`${name} · ${roundKindLabel(frame.kind)}`}</h1>
          <Link to={`/matches/${matchId}`}>{`Cup #${matchId}`}</Link>
          <span className="replay-slots" data-slots-left={frame.slotsLeft}>
            <span className="hud-slots-label">{label}</span>{' '}
            <span className="hud-slots-value">{frame.slotsLeft}</span>
          </span>
        </header>
        <div className="replay-holder">
          <ReplayCanvas
            kind={frame.kind}
            seed={seed}
            beans={frame.beans}
            tick={frame.tick}
            jumped={jumped}
            flightKey={flightKey}
            reducedMotion={reducedMotion}
            onBeansMoving={onBeansMoving}
            onCameraMoving={onCameraMoving}
          />
        </div>
        <div className="playhead-row">
          <input
            className="playhead"
            type="range"
            min={0}
            max={lastTick}
            step={1}
            value={tick}
            aria-label="Playhead"
            aria-valuetext={`Tick ${tick} of ${lastTick}`}
            onPointerDown={() => {
              dragging.current = true;
            }}
            onPointerUp={() => {
              if (!dragging.current) return;
              dragging.current = false;
              setJumped(true);
              setFlightKey((value) => value + 1);
            }}
            onChange={(event) => {
              const next = Number(event.target.value);
              move(next, !dragging.current && Math.abs(next - tick) > 1);
            }}
            onKeyDown={(event) => {
              const keys: Record<string, [number, boolean]> = {
                ArrowRight: [tick + 1, false],
                ArrowLeft: [tick - 1, false],
                PageUp: [tick + PAGE_STEP, true],
                PageDown: [tick - PAGE_STEP, true],
                Home: [0, true],
                End: [lastTick, true],
              };
              const action = keys[event.key];
              if (action === undefined) return;
              event.preventDefault();
              move(action[0], action[1]);
            }}
          />
          <div role="status" aria-label="Frame" className="frame-status">
            {`Tick ${frame.tick} of ${lastTick}, ${frame.slotsLeft} ${label.toLowerCase()}`}
          </div>
        </div>
      </section>
      <section className="card lanes-card">
        <h2>Lanes</h2>
        <ol className="lanes" aria-label="Lanes">
          {frame.beans.map((bean) => (
            <li
              key={bean.userId}
              className={`lane state-${bean.state}`}
              data-user-id={bean.userId}
              data-tick={frame.tick}
              data-x={formatPosition(bean.x)}
              data-y={formatPosition(bean.y)}
              data-z={formatPosition(bean.z)}
              data-rank={bean.rank}
              data-state={bean.state}
              data-hue={bean.hue}
              data-marker={bean.marker ?? undefined}
            >
              <span className="rank-number">{bean.rank}</span>
              <Bean hue={bean.hue} size={26} />
              <span className="handle">{bean.handle ?? `#${bean.userId}`}</span>
              <span className="lane-z">{formatPosition(bean.z)}</span>
              {bean.marker === 'last_slot' ? <span className="tag-qualified">Last slot</span> : null}
              {bean.marker === 'first_out' ? <span className="tag-eliminated">First out</span> : null}
            </li>
          ))}
        </ol>
        {reducedMotion ? (
          <div aria-live="polite">
            <table className="frame-table" aria-label="Photo-finish frame">
              <caption>Photo-finish frame</caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Player</th>
                  <th scope="col">X</th>
                  <th scope="col">Y</th>
                  <th scope="col">Z</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {frame.beans.map((bean) => (
                  <tr key={bean.userId}>
                    <td>{bean.rank}</td>
                    <td>{bean.handle ?? `#${bean.userId}`}</td>
                    <td>{formatPosition(bean.x)}</td>
                    <td>{formatPosition(bean.y)}</td>
                    <td>{formatPosition(bean.z)}</td>
                    <td>{bean.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
