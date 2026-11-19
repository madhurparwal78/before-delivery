import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutContent, SessionSnapshot } from '../../shared/protocol.js';
import { copy } from '../lib/copy.js';
import { writeView } from '../lib/viewState.js';
import { useStore } from '../store.js';
import { StageScene, type StageReport } from './scene.js';
import { blockTracks, contentBounds, pointOnBlock } from './track.js';

function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return Boolean(
      probe.getContext('webgl2') ??
        probe.getContext('webgl') ??
        probe.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}

const EMPTY_REPORT: StageReport = {
  animating: false,
  ribbonBlocks: [],
  previewBlocks: [],
  limitFlagBlock: null,
  blockPoints: {},
};

export function Stage({
  content,
  onSceneProgress,
}: {
  content: LayoutContent;
  onSceneProgress: (value: number) => void;
}): JSX.Element {
  const store = useStore();
  const { view, session, routePreview } = store;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<StageScene | null>(null);
  const [report, setReport] = useState<StageReport>(EMPTY_REPORT);
  const [paused, setPaused] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [has3d] = useState(() => webglAvailable());
  const reduced = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const pick = useCallback(
    (kind: 'train' | 'block' | 'piece' | 'end', id: string) => {
      if (kind === 'train') writeView({ train: id });
      if (kind === 'block') writeView({ block: id });
      if (kind === 'end') writeView({ end: id, piece: null });
      if (kind === 'piece') writeView({ piece: id, sheet: 'piece-inspector' });
    },
    [],
  );

  useEffect(() => {
    if (!has3d) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The scene is built once; content, session and camera are pushed in below.
    const scene = new StageScene(canvas, setReport, pick);
    scene.setReducedMotion(reduced);
    sceneRef.current = scene;

    const onResize = (): void => scene.resize();
    const onLost = (event: Event): void => {
      event.preventDefault();
      setPaused(true);
    };
    const onRestored = (): void => {
      setPaused(false);
      scene.setContent(content);
      scene.setSession(session);
    };
    window.addEventListener('resize', onResize);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [has3d, pick, reduced]);

  useEffect(() => {
    onSceneProgress(50);
    sceneRef.current?.setContent(content);
    const ready = window.setTimeout(() => onSceneProgress(100), 120);
    return () => window.clearTimeout(ready);
  }, [content, onSceneProgress]);

  useEffect(() => {
    sceneRef.current?.setSession(session);
  }, [session]);

  useEffect(() => {
    sceneRef.current?.setPreview(routePreview?.route_block_ids ?? []);
  }, [routePreview]);

  useEffect(() => {
    sceneRef.current?.setSelection({
      pieceId: view.piece,
      endId: view.end,
      trainId: view.train,
      blockId: view.block,
    });
  }, [view.piece, view.end, view.train, view.block]);

  useEffect(() => {
    sceneRef.current?.setCamera({ heading: view.heading, zoom, pan });
  }, [view.heading, zoom, pan]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = 0.6;
      if (event.key === 'ArrowLeft') setPan((current) => ({ ...current, x: current.x - step }));
      else if (event.key === 'ArrowRight') setPan((current) => ({ ...current, x: current.x + step }));
      else if (event.key === 'ArrowUp') setPan((current) => ({ ...current, y: current.y - step }));
      else if (event.key === 'ArrowDown') setPan((current) => ({ ...current, y: current.y + step }));
      else if (event.key === 'q' || event.key === 'Q') {
        writeView({ heading: (view.heading + 315) % 360 });
      } else if (event.key === 'e' || event.key === 'E') {
        writeView({ heading: (view.heading + 45) % 360 });
      } else if (event.key === '+' || event.key === '=') {
        setZoom((current) => Math.min(4, current * 1.2));
      } else if (event.key === '-' || event.key === '_') {
        setZoom((current) => Math.max(0.3, current / 1.2));
      } else {
        return;
      }
      event.preventDefault();
    },
    [view.heading],
  );

  const drag = useRef<{ x: number; y: number; button: number } | null>(null);
  const touches = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ distance: number; angle: number } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        pinch.current = {
          distance: Math.hypot(b.x - a.x, b.y - a.y),
          angle: Math.atan2(b.y - a.y, b.x - a.x),
        };
      }
      return;
    }
    drag.current = { x: event.clientX, y: event.clientY, button: event.button };
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch') {
        if (!touches.current.has(event.pointerId)) return;
        const previous = touches.current.get(event.pointerId);
        touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.current.size === 2 && pinch.current) {
          const [a, b] = [...touches.current.values()];
          const distance = Math.hypot(b.x - a.x, b.y - a.y);
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          const scale = distance / (pinch.current.distance || 1);
          setZoom((current) => Math.max(0.3, Math.min(4, current * scale)));
          const turn = ((angle - pinch.current.angle) * 180) / Math.PI;
          if (Math.abs(turn) > 6) {
            writeView({ heading: Math.round((view.heading + turn + 360) % 360) });
            pinch.current = { distance, angle };
          } else {
            pinch.current = { distance, angle: pinch.current.angle };
          }
          return;
        }
        if (touches.current.size === 1 && previous) {
          setPan((current) => ({
            x: current.x - (event.clientX - previous.x) * 0.02,
            y: current.y - (event.clientY - previous.y) * 0.02,
          }));
        }
        return;
      }
      const current = drag.current;
      if (!current) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      drag.current = { ...current, x: event.clientX, y: event.clientY };
      if (current.button === 2) {
        writeView({ heading: Math.round((view.heading - dx * 0.4 + 360) % 360) });
        return;
      }
      setPan((previous) => ({ x: previous.x - dx * 0.02, y: previous.y - dy * 0.02 }));
    },
    [view.heading],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    touches.current.delete(event.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    drag.current = null;
  }, []);

  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setZoom((current) => Math.max(0.3, Math.min(4, current * (event.deltaY > 0 ? 0.9 : 1.1))));
  }, []);

  useEffect(() => {
    const reset = (): void => {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    };
    window.addEventListener('gandyboard:reset-view', reset);
    return () => window.removeEventListener('gandyboard:reset-view', reset);
  }, []);

  const fallback = useMemo(
    () => (has3d ? null : <SchematicStage content={content} session={session} onPick={pick} />),
    [has3d, content, session, pick],
  );


  const fallbackPoints = useMemo(() => {
    if (has3d) return null;
    const tracks = blockTracks(content);
    const bounds = contentBounds(content);
    const points: Record<number, [number, number]> = {};
    for (const block of content.blocks) {
      const track = tracks.get(block.id);
      if (!track) continue;
      const middle = pointOnBlock(track, track.lengthMm / 2);
      points[block.number] = [
        Math.round(((middle.x - bounds.centreX) / bounds.spanX + 0.5) * 1000),
        Math.round(((middle.y - bounds.centreY) / bounds.spanY + 0.5) * 600),
      ];
    }
    return points;
  }, [has3d, content]);

  const mode = paused ? 'paused' : view.mode;

  return (
    <div
      role="application"
      aria-label="Club-hall layout stage"
      data-testid="stage"
      className="stage-host"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onContextMenu={(event) => event.preventDefault()}
      data-scene-revision={session?.revision ?? store.layout?.revision ?? 0}
      data-scene-tick={session?.tick ?? 0}
      data-scene-mode={mode}
      data-scene-heading={view.heading}
      data-scene-zoom={zoom}
      data-scene-pan={`${pan.x.toFixed(2)},${pan.y.toFixed(2)}`}
      data-scene-animating={report.animating ? 'true' : 'false'}
      data-ribbon-blocks={report.ribbonBlocks.join(',')}
      data-preview-blocks={
        routePreview
          ? routePreview.route_block_ids
              .map(
                (blockId) =>
                  content.blocks.find((block) => block.id === blockId)?.number ?? 0,
              )
              .filter((number) => number > 0)
              .join(',')
          : ''
      }
      data-limit-flag-block={report.limitFlagBlock ?? ''}
      data-block-points={JSON.stringify(fallbackPoints ?? report.blockPoints)}
    >
      {has3d ? <canvas ref={canvasRef} /> : fallback}
      {paused ? <div className="stage-paused">{copy.webglLost}</div> : null}
    </div>
  );
}

function SchematicStage({
  content,
  session,
  onPick,
}: {
  content: LayoutContent;
  session: SessionSnapshot | null;
  onPick: (kind: 'train' | 'block' | 'piece' | 'end', id: string) => void;
}): JSX.Element {
  const blocks = [...content.blocks].sort((a, b) => a.number - b.number);
  const states = new Map((session?.blocks ?? []).map((block) => [block.id, block]));
  const width = 1000;
  const rowHeight = 46;
  return (
    <svg
      className="schematic-stage"
      viewBox={`0 0 ${width} ${Math.max(600, blocks.length * rowHeight + 120)}`}
      role="group"
      aria-label="Track schematic"
    >
      <defs>
        <pattern id="chevrons" width="18" height="18" patternUnits="userSpaceOnUse">
          <rect width="18" height="18" fill="#38a9ef" />
          <path d="M0 0 9 9 0 18" fill="none" stroke="#1b3a94" strokeWidth="4" />
        </pattern>
        <pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#1b2240" />
          <path d="M0 12 12 0" stroke="#52597c" strokeWidth="4" />
        </pattern>
      </defs>
      <rect width={width} height="100%" fill="#eef2fb" />
      {blocks.map((block, index) => {
        const state = states.get(block.id)?.state ?? 'free';
        const fill =
          state === 'free'
            ? '#35a84a'
            : state === 'reserved'
              ? 'url(#chevrons)'
              : state === 'occupied'
                ? '#f5811f'
                : 'url(#hatch)';
        const y = 60 + index * rowHeight;
        return (
          <g
            key={block.id}
            tabIndex={0}
            role="button"
            aria-label={`Block ${block.number} ${block.name} ${state.replace('_', ' ')}`}
            onClick={() => onPick('block', block.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onPick('block', block.id);
            }}
          >
            <rect x="40" y={y} width={Math.max(120, block.length_mm / 6)} height="26" fill={fill} />
            <text x="48" y={y + 19} fontSize="15" fontWeight="700" fill="#ffffff">
              {block.number}
            </text>
            <text x="90" y={y + 19} fontSize="14" fill="#1b2240">
              {block.name} — {state.replace('_', ' ')}
            </text>
          </g>
        );
      })}
      {(session?.trains ?? []).map((train, index) => (
        <g
          key={train.id}
          tabIndex={0}
          role="button"
          aria-label={`Train ${train.number} in block ${
            states.get(train.head_block_id)?.number ?? 0
          }`}
          onClick={() => onPick('train', train.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onPick('train', train.id);
          }}
        >
          <rect x="700" y={60 + index * 34} width="120" height="26" rx="6" fill="#1b3a94" />
          <text x="712" y={79 + index * 34} fontSize="14" fill="#ffffff">
            Train {train.number}
          </text>
        </g>
      ))}
      {content.modules.flatMap((module) =>
        module.pieces.slice(0, 40).map((piece, index) => (
          <g
            key={piece.id}
            tabIndex={0}
            role="button"
            aria-label={`Piece ${piece.id}`}
            onClick={() => onPick('piece', piece.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onPick('piece', piece.id);
            }}
          >
            <circle cx={860 + (index % 6) * 20} cy={64 + Math.floor(index / 6) * 20} r="6" fill="#38a9ef" />
          </g>
        )),
      )}
    </svg>
  );
}
