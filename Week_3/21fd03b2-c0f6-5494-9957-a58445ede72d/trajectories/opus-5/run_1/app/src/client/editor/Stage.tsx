import { useEffect, useRef, useState } from 'react';
import { pageCopy } from '../../shared/copy.js';
import type { SceneDocument } from '../../shared/scene.js';
import type { Body } from '../../shared/sim.js';
import { boxHit, groundHit, projectPoint, screenRay, type Vec3 } from '../gl/math.js';
import { buildScene } from '../gl/scene.js';
import { FIELD_OF_VIEW, Stage as GlStage, type Camera } from '../gl/renderer.js';

export type CameraView = 'Top' | 'Bottom' | 'Front' | 'Back' | 'Right' | 'Left' | 'Iso';

const VIEWS: Record<CameraView, { yaw: number; pitch: number }> = {
  Top: { yaw: 0, pitch: 1.5 },
  Bottom: { yaw: 0, pitch: -1.5 },
  Front: { yaw: 0, pitch: 0.05 },
  Back: { yaw: Math.PI, pitch: 0.05 },
  Right: { yaw: Math.PI / 2, pitch: 0.05 },
  Left: { yaw: -Math.PI / 2, pitch: 0.05 },
  Iso: { yaw: 0.9, pitch: 0.55 },
};

export interface CursorMark {
  key: string;
  label: string;
  point: Vec3;
}

export interface StageProps {
  document: SceneDocument | null;
  bodies: ReadonlyMap<string, Body>;
  selectedId: string | null;
  hiddenIds: ReadonlySet<string>;
  grid: boolean;
  colliders: boolean;
  extents: ReadonlyMap<string, number>;
  cursors: readonly CursorMark[];
  view: CameraView | null;
  onPick?: (objectId: string | null) => void;
  onHover?: (point: Vec3 | null) => void;
  onDropAt?: (point: Vec3, payload: string) => void;
  focusable?: boolean;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

/** The one full-bleed stage, used by the editor, the lab and read-only scenes. */
export function Stage(props: StageProps): JSX.Element {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const stage = useRef<GlStage | null>(null);
  const camera = useRef<Camera>({ target: [0.5, 1.1, 0], distance: 12, yaw: 0.85, pitch: 0.34 });
  const [webgl, setWebgl] = useState(true);
  const [marks, setMarks] = useState<{ key: string; label: string; x: number; y: number }[]>([]);
  const drag = useRef<{ x: number; y: number; button: number } | null>(null);
  const pinch = useRef<number | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    if (!canvas.current) return;
    const created = GlStage.create(canvas.current);
    if (!created) {
      setWebgl(false);
      return;
    }
    stage.current = created;
    let handle = 0;
    const draw = (): void => {
      const current = latest.current;
      if (current.document) {
        const visual = buildScene(current.document, {
          selectedId: current.selectedId,
          hiddenIds: current.hiddenIds,
          colliders: current.colliders,
          extents: current.extents,
          bodies: current.bodies,
        });
        created.render(visual.items, camera.current, current.grid);
        const element = created.element;
        const width = element.clientWidth;
        const height = element.clientHeight;
        setMarks(
          current.cursors
            .map((cursor) => {
              const point = projectPoint(
                cursor.point,
                created.viewProjectionMatrix,
                width,
                height,
              );
              if (!point || point.x < 0 || point.y < 0 || point.x > width || point.y > height)
                return null;
              return { key: cursor.key, label: cursor.label, x: point.x, y: point.y };
            })
            .filter((mark): mark is { key: string; label: string; x: number; y: number } => mark !== null),
        );
      }
      handle = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(handle);
  }, []);

  useEffect(() => {
    if (!props.view) return;
    const target = VIEWS[props.view];
    camera.current = { ...camera.current, yaw: target.yaw, pitch: target.pitch };
  }, [props.view]);

  const pointInScene = (event: { clientX: number; clientY: number }): Vec3 | null => {
    const element = canvas.current;
    const current = stage.current;
    if (!element || !current) return null;
    const rect = element.getBoundingClientRect();
    const ray = screenRay(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      current.eyeOf(camera.current),
      camera.current.target,
      FIELD_OF_VIEW,
    );
    return groundHit(ray);
  };

  const pick = (event: { clientX: number; clientY: number }): string | null => {
    const element = canvas.current;
    const current = stage.current;
    const document = latest.current.document;
    if (!element || !current || !document) return null;
    const rect = element.getBoundingClientRect();
    const ray = screenRay(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      current.eyeOf(camera.current),
      camera.current.target,
      FIELD_OF_VIEW,
    );
    const visual = buildScene(document, {
      selectedId: null,
      hiddenIds: latest.current.hiddenIds,
      colliders: false,
      extents: latest.current.extents,
      bodies: latest.current.bodies,
    });
    let best: { objectId: string; distance: number } | null = null;
    for (const entry of visual.boxes) {
      if (latest.current.hiddenIds.has(entry.objectId)) continue;
      const distance = boxHit(ray, entry.box);
      if (distance === null) continue;
      if (!best || distance < best.distance) best = { objectId: entry.objectId, distance };
    }
    return best ? best.objectId : null;
  };

  return (
    <>
      {webgl ? (
        <canvas
          ref={canvas}
          className="stage"
          role="application"
          aria-label="Stage"
          tabIndex={props.focusable === false ? -1 : 0}
          onKeyDown={props.onKeyDown as unknown as React.KeyboardEventHandler<HTMLCanvasElement>}
          onPointerDown={(event) => {
            (event.target as HTMLElement).focus();
            drag.current = { x: event.clientX, y: event.clientY, button: event.button };
          }}
          onPointerMove={(event) => {
            const point = pointInScene(event);
            props.onHover?.(point);
            const active = drag.current;
            if (!active) return;
            const dx = event.clientX - active.x;
            const dy = event.clientY - active.y;
            drag.current = { ...active, x: event.clientX, y: event.clientY };
            if (active.button === 2) {
              const scale = camera.current.distance * 0.002;
              camera.current = {
                ...camera.current,
                target: [
                  camera.current.target[0] - dx * scale,
                  camera.current.target[1] + dy * scale,
                  camera.current.target[2],
                ],
              };
              return;
            }
            camera.current = {
              ...camera.current,
              yaw: camera.current.yaw - dx * 0.006,
              pitch: Math.max(-1.45, Math.min(1.45, camera.current.pitch + dy * 0.006)),
            };
          }}
          onPointerUp={(event) => {
            const active = drag.current;
            drag.current = null;
            if (!active) return;
            const moved = Math.hypot(event.clientX - active.x, event.clientY - active.y);
            if (moved < 4 && active.button === 0 && props.onPick) props.onPick(pick(event));
          }}
          onPointerLeave={() => {
            drag.current = null;
            props.onHover?.(null);
          }}
          onWheel={(event) => {
            event.preventDefault();
            const distance = camera.current.distance * (event.deltaY > 0 ? 1.08 : 0.93);
            camera.current = {
              ...camera.current,
              distance: Math.max(1.5, Math.min(80, distance)),
            };
          }}
          onContextMenu={(event) => event.preventDefault()}
          onTouchMove={(event) => {
            if (event.touches.length !== 2) {
              pinch.current = null;
              return;
            }
            const spread = Math.hypot(
              event.touches[0].clientX - event.touches[1].clientX,
              event.touches[0].clientY - event.touches[1].clientY,
            );
            if (pinch.current !== null) {
              const ratio = pinch.current / spread;
              camera.current = {
                ...camera.current,
                distance: Math.max(1.5, Math.min(80, camera.current.distance * ratio)),
              };
            }
            pinch.current = spread;
          }}
          onTouchEnd={() => {
            pinch.current = null;
          }}
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const payload = event.dataTransfer.getData('text/plain');
            const point = pointInScene(event);
            if (payload && point && props.onDropAt) props.onDropAt(point, payload);
          }}
        />
      ) : (
        <div className="no-webgl">
          <p>{pageCopy.noWebgl}</p>
        </div>
      )}
      {marks.map((mark) => (
        <span
          key={mark.key}
          className="cursor-tag"
          role="img"
          aria-label={`Cursor: ${mark.label}`}
          style={{ left: mark.x, top: mark.y }}
        >
          {mark.label}
        </span>
      ))}
    </>
  );
}

export const CAMERA_VIEWS: readonly CameraView[] = [
  'Top',
  'Bottom',
  'Front',
  'Back',
  'Right',
  'Left',
  'Iso',
];
