import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '../lib/motion.js';
import type { FestivalDay, Named, Session } from '../lib/types.js';
import { DISCIPLINE_COLOURS, LIME, LatticeScene, PAPER, VERMILION } from './scene.js';
import type { JSX } from 'react';

export interface LatticeSelection {
  day: string | null;
  venue: string | null;
  discipline: string | null;
}

interface LatticeProps {
  days: FestivalDay[];
  venues: Named[];
  disciplines: Named[];
  sessions: Session[];
  selection: LatticeSelection;
  agenda: string[];
  clashes: Array<[string, string]>;
  onPick: (kind: 'day' | 'venue' | 'discipline', id: string) => void;
}

const STATIC_ATTRIBUTES = ['data-raised', 'data-lit', 'data-seams'] as const;

export function Lattice(props: LatticeProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [webglReady, setWebglReady] = useState<boolean>(() => LatticeScene.supported());
  const figureRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<LatticeScene | null>(null);
  const pickRef = useRef(props.onPick);
  pickRef.current = props.onPick;

  const moving = !reducedMotion && webglReady;

  const attributes = useMemo(() => {
    const raised: string[] = [];
    if (props.selection.day !== null) raised.push(`day:${props.selection.day}`);
    if (props.selection.venue !== null) raised.push(`venue:${props.selection.venue}`);
    if (props.selection.discipline !== null) raised.push(`discipline:${props.selection.discipline}`);
    return {
      'data-raised': raised.join(','),
      'data-lit': props.agenda.join(','),
      'data-seams': props.clashes.map(([a, b]) => `${a}+${b}`).join(','),
    };
  }, [props.selection, props.agenda, props.clashes]);

  useEffect(() => {
    if (!moving || canvasRef.current === null || sceneRef.current !== null) return;
    const figure = figureRef.current;
    let scene: LatticeScene;
    try {
      scene = new LatticeScene(
        canvasRef.current,
        {
          days: props.days,
          venues: props.venues,
          disciplines: props.disciplines,
          sessions: props.sessions,
        },
        {
          onPick: (kind, id) => pickRef.current(kind, id),
          onReport: (report) => {
            if (figure === null) return;
            for (const [key, value] of Object.entries(report)) figure.setAttribute(key, value);
          },
        },
      );
    } catch {
      // the renderer could not start, so the static drawing takes over
      setWebglReady(false);
      return;
    }
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // the scene is created once and then fed through its setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving]);

  useEffect(() => {
    sceneRef.current?.setData({
      days: props.days,
      venues: props.venues,
      disciplines: props.disciplines,
      sessions: props.sessions,
    });
  }, [props.days, props.venues, props.disciplines, props.sessions]);

  useEffect(() => {
    sceneRef.current?.setSelection(props.selection);
  }, [props.selection]);

  useEffect(() => {
    sceneRef.current?.setAgenda(props.agenda, props.clashes);
  }, [props.agenda, props.clashes]);

  useEffect(() => {
    if (!moving) return;
    const onScroll = (): void => sceneRef.current?.setScroll(window.scrollY);
    const onResize = (): void => sceneRef.current?.resize();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    onScroll();
    onResize();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [moving]);

  useEffect(() => {
    if (moving || figureRef.current === null) return;
    for (const key of STATIC_ATTRIBUTES) {
      figureRef.current.setAttribute(key, attributes[key]);
    }
  }, [moving, attributes]);

  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    sceneRef.current?.setPointer(
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
    );
  };

  const onClick = (event: React.MouseEvent<HTMLElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    sceneRef.current?.pick(
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
    );
  };

  return (
    <figure
      className="lattice"
      aria-label="Programme lattice"
      ref={figureRef}
      data-intro={moving ? 'running' : 'done'}
      data-camera-progress="0.00"
      data-camera-day="1"
      data-yaw="0.0"
      data-pitch="0.0"
      data-raised={attributes['data-raised']}
      data-lit={attributes['data-lit']}
      data-seams={attributes['data-seams']}
      onPointerMove={moving ? onPointerMove : undefined}
      onPointerLeave={moving ? () => sceneRef.current?.setPointer(null, null) : undefined}
      onClick={moving ? onClick : undefined}
    >
      {moving ? (
        <canvas className="lattice-canvas" ref={canvasRef} tabIndex={-1} aria-hidden="true" />
      ) : (
        <StaticLattice {...props} attributes={attributes} />
      )}
    </figure>
  );
}

interface StaticProps extends LatticeProps {
  attributes: Record<string, string>;
}

const ISO_X = Math.cos(Math.PI / 6);
const ISO_Y = Math.sin(Math.PI / 6);

/** The same lattice drawn from the same data, with no camera moves. */
function StaticLattice(props: StaticProps): JSX.Element {
  const width = 1200;
  const height = 675;
  const unit = 54;
  const originX = width * 0.42;
  const originY = height * 0.3;

  const project = (x: number, y: number, z: number): [number, number] => [
    originX + (x - z) * ISO_X * unit,
    originY + (x + z) * ISO_Y * unit - y * unit,
  ];

  const dayIndex = (date: string): number =>
    Math.max(0, props.days.findIndex((day) => day.date === date));
  const venueIndex = (id: string): number =>
    Math.max(0, props.venues.findIndex((venue) => venue.id === id));

  const venueX = (id: string): number => venueIndex(id) - (props.venues.length - 1) / 2;
  const dayZ = (date: string): number => dayIndex(date) * 1.5;

  const slabHeight = 3.2;
  const timeSpan = (session: Session): [number, number] => {
    const day = props.days.find((candidate) => candidate.date === session.festival_day);
    const start = new Date(day?.starts_at ?? session.starts_at).getTime();
    const end = new Date(day?.ends_at ?? session.ends_at).getTime();
    const length = Math.max(1, end - start);
    const from = (new Date(session.starts_at).getTime() - start) / length;
    const to = (new Date(session.ends_at).getTime() - start) / length;
    return [Math.max(0, from) * slabHeight, Math.max(0, to) * slabHeight];
  };

  const anySelection =
    props.selection.day !== null ||
    props.selection.venue !== null ||
    props.selection.discipline !== null;

  const barCentre = (session: Session): [number, number] => {
    const [from, to] = timeSpan(session);
    return project(venueX(session.venue_id), (from + to) / 2, dayZ(session.festival_day));
  };

  const halfWidth = (props.venues.length + 0.6) / 2;

  return (
    <svg
      className="lattice-static"
      role="img"
      aria-label="Programme lattice (static)"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      data-raised={props.attributes['data-raised']}
      data-lit={props.attributes['data-lit']}
      data-seams={props.attributes['data-seams']}
    >
      <rect x="0" y="0" width={width} height={height} fill="#0e0e10" />
      {props.days.map((day) => {
        const z = dayZ(day.date);
        const corners = [
          project(-halfWidth, 0, z - 0.25),
          project(halfWidth, 0, z - 0.25),
          project(halfWidth, 0, z + 0.25),
          project(-halfWidth, 0, z + 0.25),
        ];
        const selected = props.selection.day === day.date;
        return (
          <polygon
            key={day.date}
            data-day={day.date}
            points={corners.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
            fill={selected ? '#3a3a48' : '#24242c'}
            stroke={PAPER}
            strokeOpacity={anySelection && !selected ? 0.25 : 0.55}
            fillOpacity={anySelection && !selected ? 0.25 : 1}
          />
        );
      })}
      {props.venues.map((venue) => {
        const x = venueX(venue.id);
        const from = project(x, 0, -0.4);
        const to = project(x, 0, (props.days.length - 1) * 1.5 + 0.4);
        const selected = props.selection.venue === venue.id;
        return (
          <line
            key={venue.id}
            data-venue={venue.id}
            x1={from[0]}
            y1={from[1]}
            x2={to[0]}
            y2={to[1]}
            stroke={selected ? PAPER : '#55556a'}
            strokeWidth={selected ? 4 : 2}
            opacity={anySelection && !selected ? 0.25 : 1}
          />
        );
      })}
      {props.sessions.map((session) => {
        const [from, to] = timeSpan(session);
        const z = dayZ(session.festival_day);
        const x = venueX(session.venue_id);
        const bottom = project(x, from, z);
        const top = project(x, Math.max(to, from + 0.18), z);
        const lit = props.agenda.includes(session.id);
        const kept =
          (props.selection.day === null || session.festival_day === props.selection.day) &&
          (props.selection.venue === null || session.venue_id === props.selection.venue) &&
          (props.selection.discipline === null || session.discipline === props.selection.discipline);
        const colour = lit ? LIME : (DISCIPLINE_COLOURS[session.discipline] ?? PAPER);
        const barWidth = session.admission === 'seat' ? 16 : 11;
        return (
          <rect
            key={session.id}
            data-session={session.id}
            data-lit={lit ? 'true' : 'false'}
            x={bottom[0] - barWidth / 2}
            y={top[1]}
            width={barWidth}
            height={Math.max(6, bottom[1] - top[1])}
            fill={session.status === 'cancelled' ? 'none' : colour}
            stroke={colour}
            strokeWidth={session.status === 'cancelled' ? 2 : 0}
            strokeDasharray={session.status === 'cancelled' ? '4 3' : undefined}
            opacity={anySelection && !kept ? 0.25 : 1}
          />
        );
      })}
      {props.clashes.map(([a, b]) => {
        const first = props.sessions.find((session) => session.id === a);
        const second = props.sessions.find((session) => session.id === b);
        if (first === undefined || second === undefined) return null;
        const from = barCentre(first);
        const to = barCentre(second);
        return (
          <line
            key={`${a}+${b}`}
            data-seam={`${a}+${b}`}
            x1={from[0]}
            y1={from[1]}
            x2={to[0]}
            y2={to[1]}
            stroke={VERMILION}
            strokeWidth={4}
          />
        );
      })}
      {props.disciplines.map((discipline, index) => {
        const selected = props.selection.discipline === discipline.id;
        const size = 26;
        const left = 40 + index * (size + 14);
        return (
          <rect
            key={discipline.id}
            data-discipline={discipline.id}
            x={left}
            y={height - 56 - (selected ? 10 : 0)}
            width={size}
            height={size}
            fill={DISCIPLINE_COLOURS[discipline.id] ?? PAPER}
            opacity={anySelection && !selected ? 0.25 : 1}
          />
        );
      })}
    </svg>
  );
}

interface ControlsProps {
  days: FestivalDay[];
  venues: Named[];
  disciplines: Named[];
  selection: LatticeSelection;
  onPick: (kind: 'day' | 'venue' | 'discipline', id: string) => void;
}

/** The keyboard and screen-reader path into the lattice, always present below the canvas. */
export function LatticeControls(props: ControlsProps): JSX.Element {
  return (
    <div className="lattice-controls" role="group" aria-label="Lattice controls">
      <div className="lattice-controls-row">
        {props.days.map((day) => (
          <button
            key={day.date}
            type="button"
            className="toggle"
            aria-pressed={props.selection.day === day.date}
            onClick={() => props.onPick('day', day.date)}
          >
            {`Day: ${day.label}`}
          </button>
        ))}
      </div>
      <div className="lattice-controls-row">
        {props.venues.map((venue) => (
          <button
            key={venue.id}
            type="button"
            className="toggle"
            aria-pressed={props.selection.venue === venue.id}
            onClick={() => props.onPick('venue', venue.id)}
          >
            {`Venue: ${venue.name}`}
          </button>
        ))}
      </div>
      <div className="lattice-controls-row">
        {props.disciplines.map((discipline) => (
          <button
            key={discipline.id}
            type="button"
            className="toggle swatch-toggle"
            aria-pressed={props.selection.discipline === discipline.id}
            onClick={() => props.onPick('discipline', discipline.id)}
          >
            <span
              className="swatch"
              style={{ background: DISCIPLINE_COLOURS[discipline.id] ?? PAPER }}
              aria-hidden="true"
            />
            {`Discipline: ${discipline.name}`}
          </button>
        ))}
      </div>
    </div>
  );
}
