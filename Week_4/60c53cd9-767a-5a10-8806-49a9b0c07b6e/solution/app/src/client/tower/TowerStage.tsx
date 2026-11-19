/** The finder's tower stage: the WebGL turntable (or the floor grid) with the accessible grid of unit cells laid over it. */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { TowerAssets } from "../../shared/api-types.js";
import { BOTTOM_FLOOR, STACK_LETTERS, TOP_FLOOR, parseUnitCode, unitCode, type StackLetter } from "../../shared/domain.js";
import { DURATIONS, prefersReducedMotion, tween } from "../motion.js";
import { FinderScene, loadModels } from "./scene.js";
import { cellShape, faceSpans, frameFor, nearestStack, rotationFor, rowSpans, shortestTurn, type CellShape, type FaceSpan, type ViewFrame } from "./projection.js";

type CellTone = "lit" | "dim" | "hatched" | "muted";

export interface CellView {
  readonly name: string;
  readonly tone: CellTone;
  readonly pinnable: boolean;
}

export type StageMode = "webgl" | "grid";
export type StageFailure = "model" | "context";

interface Props {
  readonly mode: StageMode;
  readonly assets: TowerAssets | null;
  readonly view: (code: string) => CellView;
  readonly rovingCode: string;
  readonly selectedCode: string | null;
  readonly hoverCode: string | null;
  readonly reservedRight: number;
  readonly onFail: (reason: StageFailure) => void;
  readonly onRove: (code: string) => void;
  readonly onHover: (code: string | null, x: number, y: number) => void;
  readonly onFocusCell: (code: string, element: HTMLElement) => void;
  readonly onBlurGrid: () => void;
  readonly onActivate: (code: string, element: HTMLElement) => void;
  readonly children?: ReactNode;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

const DRAG_THRESHOLD = 5;
const RADIANS_PER_PIXEL = 0.012;
const HATCH_PITCH = 6;

interface CellProps {
  readonly code: string;
  readonly left: number;
  readonly width: number;
  readonly top: number;
  readonly height: number;
  readonly slope: number;
  readonly view: CellView;
  readonly roving: boolean;
  readonly selected: boolean;
  readonly hovered: boolean;
  readonly shown: boolean;
}

/** Skews a cell onto its face, and keeps the hatching at a true 45 degrees and 6 pixels on screen under that skew. */
const shapeStyle = (shape: CellShape): CSSProperties => {
  const rise = 1 - shape.slope;
  const lineAngle = Math.atan(rise);
  const style: CSSProperties & Record<`--${string}`, string> = {
    top: shape.top,
    height: shape.height,
    transform: `skewY(${Math.atan(shape.slope)}rad)`,
    "--hatch-angle": `${lineAngle}rad`,
    "--hatch-pitch": `${HATCH_PITCH * Math.SQRT2 * Math.sin(lineAngle)}px`,
  };
  return style;
};

const Cell = memo(({ code, left, width, top, height, slope, view, roving, selected, hovered, shown }: CellProps): ReactNode => (
  <div
    role="gridcell"
    data-code={code}
    aria-label={view.name}
    aria-disabled={view.pinnable ? "false" : "true"}
    aria-selected={selected ? "true" : "false"}
    tabIndex={roving ? 0 : -1}
    className={`cell cell-${view.tone}${selected ? " cell-selected" : ""}${hovered ? " cell-hovered" : ""}${shown ? "" : " cell-away"}`}
    style={{ left, width: Math.max(2, width), ...shapeStyle({ top, height, slope }) }}
  />
));
Cell.displayName = "Cell";

export const TowerStage = ({
  mode,
  assets,
  view,
  rovingCode,
  selectedCode,
  hoverCode,
  reservedRight,
  onFail,
  onRove,
  onHover,
  onFocusCell,
  onBlurGrid,
  onActivate,
  children,
}: Props): ReactNode => {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<FinderScene | null>(null);
  const [size, setSize] = useState<Size>({ width: 640, height: 640 });
  const [theta, setTheta] = useState(0);
  const thetaRef = useRef(0);
  const cancelTurn = useRef<(() => void) | null>(null);
  const dragRef = useRef<{ startX: number; startTheta: number; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);
  const focusAfterRender = useRef<string | null>(null);
  const [loading, setLoading] = useState(mode === "webgl");
  const failRef = useRef(onFail);
  failRef.current = onFail;

  const frame: ViewFrame = useMemo(() => frameFor(size.width, size.height, reservedRight), [size, reservedRight]);

  useLayoutEffect(() => {
    const element = stageRef.current as HTMLDivElement;
    const measure = (): void => {
      const box = element.getBoundingClientRect();
      setSize((previous) => (previous.width === box.width && previous.height === box.height ? previous : { width: box.width, height: box.height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const applyTheta = useCallback((next: number) => {
    thetaRef.current = next;
    setTheta(next);
    sceneRef.current?.setRotation(next);
  }, []);

  // The scene is created once, when the first tower read has signed links; later reads only refresh statuses.
  const sceneStarted = useRef(false);
  useEffect(() => {
    if (mode !== "webgl" || assets === null || sceneStarted.current) return;
    sceneStarted.current = true;
    let alive = true;
    void loadModels(assets)
      .then((models) => {
        if (!alive) return;
        const scene = new FinderScene(canvasRef.current as HTMLCanvasElement, models, () => failRef.current("context"));
        sceneRef.current = scene;
        scene.resize(size.width, size.height, frame);
        scene.setRotation(thetaRef.current);
        setLoading(false);
      })
      .catch(() => {
        if (alive) failRef.current("model");
      });
    return () => {
      alive = false;
    };
    // Size and frame are applied by the effect below once the scene exists.
  }, [mode, assets]);

  useEffect(() => {
    sceneRef.current?.resize(size.width, size.height, frame);
  }, [size, frame]);

  useEffect(
    () => () => {
      cancelTurn.current?.();
      sceneRef.current?.dispose();
      sceneRef.current = null;
    },
    [],
  );

  const turnTo = useCallback(
    (stack: StackLetter) => {
      cancelTurn.current?.();
      const from = thetaRef.current;
      const delta = shortestTurn(from, rotationFor(stack));
      if (prefersReducedMotion() || delta === 0) {
        applyTheta(from + delta);
        return;
      }
      cancelTurn.current = tween(DURATIONS.towerTurn, (progress) => applyTheta(from + delta * progress));
    },
    [applyTheta],
  );

  const spans = useMemo(() => (mode === "webgl" ? faceSpans(theta, frame) : []), [mode, theta, frame]);
  const rows = useMemo(() => rowSpans(frame), [frame]);
  const gridColumns = useMemo(() => {
    const pad = 28;
    const usable = Math.max(120, size.width - reservedRight - pad * 2);
    const column = usable / 8;
    return STACK_LETTERS.map((stack, index) => ({ stack, left: pad + index * column, width: column }));
  }, [size.width, reservedRight]);

  const frontStack = useMemo(() => nearestStack(theta), [theta]);

  const columnFor = (stack: StackLetter): { left: number; width: number; shown: boolean; span: FaceSpan | null } | null => {
    if (mode === "grid") {
      const column = gridColumns[STACK_LETTERS.indexOf(stack)] as { left: number; width: number };
      return { ...column, shown: true, span: null };
    }
    const span = spans.find((candidate) => candidate.stack === stack);
    if (!span) return null;
    return { left: span.left, width: span.width, shown: span.visible, span };
  };

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = parseUnitCode(rovingCode);
    if (!current) return;
    let floor = current.floor;
    let stack = current.stack;
    const index = STACK_LETTERS.indexOf(stack);
    const sideways = (towardsRightOnScreen: boolean): StackLetter => {
      // In the turntable the plan runs clockwise from right to left, so the viewer's right is the previous letter.
      const forward = mode === "grid" ? towardsRightOnScreen : !towardsRightOnScreen;
      return STACK_LETTERS[(index + (forward ? 1 : 7)) % 8] as StackLetter;
    };
    switch (event.key) {
      case "ArrowUp":
        floor = Math.min(TOP_FLOOR, floor + 1);
        break;
      case "ArrowDown":
        floor = Math.max(BOTTOM_FLOOR, floor - 1);
        break;
      case "ArrowRight":
        stack = sideways(true);
        break;
      case "ArrowLeft":
        stack = sideways(false);
        break;
      case "Enter":
      case " ": {
        event.preventDefault();
        const element = (event.target as HTMLElement).closest<HTMLElement>("[data-code]");
        if (element) onActivate(element.dataset["code"] as string, element);
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    const next = unitCode(floor, stack);
    if (next === rovingCode) return;
    focusAfterRender.current = next;
    onRove(next);
    if (mode === "webgl" && stack !== current.stack) {
      const span = spans.find((candidate) => candidate.stack === stack);
      if (!span?.visible) turnTo(stack);
    }
  };

  useLayoutEffect(() => {
    const wanted = focusAfterRender.current;
    if (wanted === null) return;
    const element = stageRef.current?.querySelector<HTMLElement>(`[data-code="${wanted}"]`);
    if (element) {
      focusAfterRender.current = null;
      element.focus({ preventScroll: true });
    }
  });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (mode !== "webgl" || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    suppressClick.current = false;
    dragRef.current = { startX: event.clientX, startTheta: thetaRef.current, moved: false, id: event.pointerId };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag) {
      const dx = event.clientX - drag.startX;
      if (!drag.moved && Math.abs(dx) > DRAG_THRESHOLD) {
        drag.moved = true;
        cancelTurn.current?.();
        stageRef.current?.setPointerCapture(drag.id);
        onHover(null, 0, 0);
      }
      if (drag.moved) applyTheta(drag.startTheta + dx * RADIANS_PER_PIXEL);
      return;
    }
  };

  const endDrag = (): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) {
      suppressClick.current = true;
      turnTo(nearestStack(thetaRef.current));
    }
  };

  const hoverFrom = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "touch" || dragRef.current?.moved) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-code]");
    if (cell) onHover(cell.dataset["code"] as string, event.clientX, event.clientY);
  };

  const rowsView = rows.map((row) => {
    const cells = STACK_LETTERS.map((stack) => {
      const code = unitCode(row.floor, stack);
      const column = columnFor(stack);
      const isRoving = code === rovingCode;
      if (!column || (!column.shown && !isRoving)) return null;
      const cellView = view(code);
      const shape = column.span ? cellShape(column.span, row, frame) : { top: 0, height: row.height, slope: 0 };
      return (
        <Cell
          key={code}
          code={code}
          left={column.left}
          width={column.width}
          top={shape.top}
          height={shape.height}
          slope={shape.slope}
          view={cellView}
          roving={isRoving}
          selected={code === selectedCode}
          hovered={code === hoverCode}
          shown={column.shown}
        />
      );
    });
    return (
      <div key={row.floor} role="row" aria-label={`Floor ${row.floor}`} className="tower-row" style={{ top: row.top, height: row.height }}>
        {cells}
      </div>
    );
  });

  const labelFloors = [TOP_FLOOR, 30, 20, 10, BOTTOM_FLOOR];

  return (
    <div
      ref={stageRef}
      className={`stage stage-${mode}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          event.stopPropagation();
          event.preventDefault();
        }
      }}
    >
      {mode === "webgl" ? <canvas ref={canvasRef} className="stage-canvas" aria-hidden="true" /> : null}
      {mode === "webgl" && loading ? <div className="stage-loading" aria-hidden="true" /> : null}
      <div className="floor-labels" aria-hidden="true">
        {rows
          .filter((row) => labelFloors.includes(row.floor))
          .map((row) => (
            <span key={row.floor} style={{ top: row.top + row.height / 2 - 9 }}>
              {row.floor}
            </span>
          ))}
      </div>
      <div className="stack-labels" aria-hidden="true">
        {STACK_LETTERS.map((stack) => {
          const column = columnFor(stack);
          return column?.shown ? (
            <span key={stack} style={{ left: column.left, width: column.width }}>
              {stack}
            </span>
          ) : null;
        })}
      </div>
      <div
        role="grid"
        aria-label="Tower"
        aria-rowcount={36}
        className="tower-grid"
        onKeyDown={move}
        onPointerMove={hoverFrom}
        onPointerOver={hoverFrom}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") onHover(null, 0, 0);
        }}
        onFocus={(event) => {
          const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-code]");
          if (cell) onFocusCell(cell.dataset["code"] as string, cell);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onBlurGrid();
        }}
        onClick={(event) => {
          const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-code]");
          if (cell) onActivate(cell.dataset["code"] as string, cell);
        }}
      >
        {rowsView}
      </div>
      {mode === "webgl" ? (
        <div className="turn-buttons">
          <button type="button" className="button" onClick={() => turnTo(STACK_LETTERS[(STACK_LETTERS.indexOf(frontStack) + 1) % 8] as StackLetter)}>
            Turn left
          </button>
          <button type="button" className="button" onClick={() => turnTo(STACK_LETTERS[(STACK_LETTERS.indexOf(frontStack) + 7) % 8] as StackLetter)}>
            Turn right
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
};
