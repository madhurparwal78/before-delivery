import { useCallback, useRef, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Snapshot } from '../shared/types';
import { compassOf, roomSize } from './components/geometry';
import './styles.css';

interface PreviewPayload {
  snapshot: Snapshot;
  token: string;
}

function readPayload(): PreviewPayload | null {
  const element = document.getElementById('snapshot-data');
  if (!element?.textContent) return null;
  return JSON.parse(element.textContent) as PreviewPayload;
}

function PreviewScene({ snapshot }: { snapshot: Snapshot }): ReactElement {
  const [view, setView] = useState<'plan' | 'wall'>(() =>
    new URLSearchParams(window.location.search).get('view') === 'wall' ? 'wall' : 'plan',
  );
  const [turn, setTurn] = useState(0);
  const drag = useRef<{ x: number; turn: number } | null>(null);
  const room = roomSize(snapshot.walls);
  const firstWork = snapshot.works[0];
  const facedWall =
    snapshot.walls.find((wall) => wall.name === firstWork?.wallName) ?? snapshot.walls[0];

  const choose = useCallback((next: 'plan' | 'wall') => {
    setView(next);
    setTurn(0);
    const url = new URL(window.location.href);
    if (next === 'wall') url.searchParams.set('view', 'wall');
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  }, []);

  const limit = view === 'wall' ? 30 : null;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    drag.current = { x: event.clientX, turn };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state) return;
    const next = state.turn + (event.clientX - state.x) * 0.3;
    setTurn(limit === null ? next : Math.min(limit, Math.max(-limit, next)));
  };
  const onPointerUp = (): void => {
    drag.current = null;
  };

  const thickness = 160;
  return (
    <section
      className="preview-scene"
      aria-label="Preview scene"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="view-group" role="group" aria-label="View">
        <button type="button" aria-pressed={view === 'plan'} onClick={() => choose('plan')}>
          Plan
        </button>
        <button type="button" aria-pressed={view === 'wall'} onClick={() => choose('wall')}>
          Wall
        </button>
      </div>
      <div
        className="preview-scene-stage"
        style={{ transform: `perspective(1400px) rotateY(${(-turn).toFixed(1)}deg)` }}
      >
        {view === 'plan' ? (
          <svg viewBox={`0 0 ${room.widthMm} ${room.depthMm}`} preserveAspectRatio="xMidYMid meet">
            {snapshot.walls.map((wall) => {
              const compass = compassOf(wall);
              const horizontal = compass === 'north' || compass === 'south';
              return (
                <rect
                  key={wall.id}
                  x={compass === 'east' ? room.widthMm - thickness : 0}
                  y={compass === 'south' ? room.depthMm - thickness : 0}
                  width={horizontal ? room.widthMm : thickness}
                  height={horizontal ? thickness : room.depthMm}
                  fill="#c4bcb0"
                />
              );
            })}
            {snapshot.works.map((work) => {
              const wall = snapshot.walls.find((item) => item.name === work.wallName);
              if (!wall) return null;
              const compass = compassOf(wall);
              const horizontal = compass === 'north' || compass === 'south';
              const centre = horizontal
                ? compass === 'north'
                  ? work.offsetMm
                  : room.widthMm - work.offsetMm
                : compass === 'east'
                  ? work.offsetMm
                  : room.depthMm - work.offsetMm;
              return (
                <rect
                  key={`${work.objectNumber}-plan`}
                  x={
                    horizontal
                      ? centre - work.widthMm / 2
                      : compass === 'east'
                        ? room.widthMm - thickness
                        : 0
                  }
                  y={
                    horizontal
                      ? compass === 'south'
                        ? room.depthMm - thickness
                        : 0
                      : centre - work.widthMm / 2
                  }
                  width={horizontal ? work.widthMm : thickness}
                  height={horizontal ? thickness : work.widthMm}
                  fill="#f5f1ea"
                  stroke="#1a1816"
                  strokeWidth={30}
                />
              );
            })}
          </svg>
        ) : facedWall ? (
          <svg
            viewBox={`0 0 ${facedWall.lengthMm} ${facedWall.heightMm}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <rect
              x={0}
              y={0}
              width={facedWall.lengthMm}
              height={facedWall.heightMm}
              fill="#c4bcb0"
            />
            <line
              x1={0}
              x2={facedWall.lengthMm}
              y1={facedWall.heightMm - 1450}
              y2={facedWall.heightMm - 1450}
              stroke="#c25b20"
              strokeWidth={14}
            />
            {snapshot.works
              .filter((work) => work.wallName === facedWall.name)
              .map((work) => (
                <rect
                  key={`${work.objectNumber}-wall`}
                  x={work.offsetMm - work.widthMm / 2}
                  y={facedWall.heightMm - (work.centreHeightMm + work.heightMm / 2)}
                  width={work.widthMm}
                  height={work.heightMm}
                  fill="#f5f1ea"
                  stroke="#1a1816"
                  strokeWidth={20}
                />
              ))}
          </svg>
        ) : null}
      </div>
    </section>
  );
}

const payload = readPayload();
const root = document.getElementById('preview-scene-root');
if (payload && root) {
  createRoot(root).render(<PreviewScene snapshot={payload.snapshot} />);
}
