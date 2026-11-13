import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { EDITION, PHONE_MAX_WIDTH, plateOf, SHELF_COLUMNS, TABLET_MAX_WIDTH, type CellState } from "../../../shared/domain.js";
import { chooseBox, consumeFocus, holds } from "../state/hold.js";
import { cellStates, shelf } from "../state/market.js";
import { story } from "../state/story.js";
import { useStore } from "../state/store.js";
import type { ShelfLayout, ShelfMapping } from "../scene/index.js";
import { CellShape } from "./CellShape.js";
import { LABELS } from "./copy.js";
import { extentOf, tokenPx, useLayoutChange } from "./layout.js";
import "../styles/shelf.css";

/**
 * The DOM grid over the 3D boxes: one tab stop with roving focus, transparent over WebGL, drawn without it.
 * The scene says where the boxes are on screen each frame; the grid container follows with a transform.
 */

/** The largest cell; at the far end of the shelf range the camera draws it at about three quarters, which stays above the 44 px target. */
const MAX_CELL = 64;
const GAP = 8;
const TYPING_PAUSE_MS = 500;
const DIGITS = /^[0-9]$/;

interface Geometry {
  columns: number;
  rows: number;
  cellPx: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

const measure = (): Geometry => {
  const width = window.innerWidth;
  const columns = width <= PHONE_MAX_WIDTH ? SHELF_COLUMNS.phone : width <= TABLET_MAX_WIDTH ? SHELF_COLUMNS.tablet : SHELF_COLUMNS.laptop;
  const rows = EDITION / columns;
  const top = extentOf("chrome") + extentOf("band") + GAP;
  const available = Math.max(0, window.innerHeight - Math.max(extentOf("dock"), tokenPx("--bar-height")) - GAP - top);
  const cellPx = Math.floor(Math.min(width / columns, MAX_CELL));
  return { columns, rows, cellPx, left: (width - columns * cellPx) / 2, top, width: columns * cellPx, height: Math.min(rows * cellPx, available) };
};

const same = (a: Geometry, b: Geometry): boolean => (Object.keys(a) as (keyof Geometry)[]).every((key) => a[key] === b[key]);

const layoutOf = (geometry: Geometry, scrollTop: number): ShelfLayout => ({
  columns: geometry.columns, rows: geometry.rows, cellPx: geometry.cellPx, left: geometry.left, top: geometry.top, scrollTop,
  width: window.innerWidth, height: window.innerHeight,
});

interface CellProps {
  index: number;
  state: CellState;
  tabbable: boolean;
  drawn: boolean;
}

const Cell = memo(({ index, state, tabbable, drawn }: CellProps) => {
  const number = index + 1;
  return (
    <div
      role="gridcell"
      data-index={index}
      tabIndex={tabbable ? 0 : -1}
      aria-label={`Box ${number}, ${plateOf(number)}, ${state}`}
      className={`cell cell--${state}`}
    >
      {drawn ? <CellShape state={state} /> : null}
      <span className="cell__number" aria-hidden="true">{number}</span>
    </div>
  );
});

const indexOf = (target: EventTarget): number | null => {
  const cell = target instanceof Element ? target.closest<HTMLElement>('[role="gridcell"]') : null;
  return cell ? Number(cell.dataset.index) : null;
};

export const ShelfGrid = () => {
  const controller = story();
  const shelfState = useStore(shelf);
  const holdState = useStore(holds);
  const [geometry, setGeometry] = useState<Geometry>(measure);
  const [focusIndex, setFocusIndex] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const typed = useRef({ digits: "", wait: 0 });
  const drawn = controller.mode === "still";

  const place = useCallback(
    (mapping: ShelfMapping): void => {
      const element = scroller.current;
      if (!element) return;
      element.style.visibility = mapping.visible ? "visible" : "hidden";
      element.style.pointerEvents = mapping.visible ? "auto" : "none";
      element.style.transform = `translate(${mapping.tx}px, ${mapping.ty}px) scale(${mapping.k})`;
    },
    [],
  );

  useLayoutChange(() => setGeometry((current) => { const next = measure(); return same(current, next) ? current : next; }));

  useLayoutEffect(() => {
    controller.setShelfLayout(layoutOf(geometry, scroller.current?.scrollTop ?? 0));
    place(controller.shelfMapping());
  }, [controller, geometry, place, shelfState.loaded]);

  useEffect(() => controller.subscribe((info) => place(info.mapping)), [controller, place]);

  const focusCell = useCallback((index: number): void => {
    setFocusIndex(index);
    scroller.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus();
  }, []);

  const request = holdState.focus;
  useEffect(() => {
    if (request?.target !== "cell") return;
    focusCell(request.number - 1);
    consumeFocus();
  }, [request, focusCell]);

  const onScroll = (): void => {
    controller.setShelfLayout(layoutOf(geometry, scroller.current?.scrollTop ?? 0));
    place(controller.shelfMapping());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = indexOf(event.target);
    if (at === null) return;
    const column = at % geometry.columns;
    const move: Record<string, number | undefined> = {
      ArrowLeft: column > 0 ? at - 1 : at,
      ArrowRight: column < geometry.columns - 1 && at < EDITION - 1 ? at + 1 : at,
      ArrowUp: at - geometry.columns >= 0 ? at - geometry.columns : at,
      ArrowDown: at + geometry.columns < EDITION ? at + geometry.columns : at,
      Home: 0,
      End: EDITION - 1,
    };
    const target = move[event.key];
    if (target !== undefined) {
      event.preventDefault();
      focusCell(target);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void chooseBox(at + 1);
    } else if (DIGITS.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      window.clearTimeout(typed.current.wait);
      typed.current.digits += event.key;
      typed.current.wait = window.setTimeout(() => {
        const number = Number(typed.current.digits);
        typed.current.digits = "";
        if (number >= 1 && number <= EDITION) focusCell(number - 1);
      }, TYPING_PAUSE_MS);
    }
  };

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const at = indexOf(event.target);
    if (at !== null) void chooseBox(at + 1);
  };

  if (!shelfState.loaded) return null;
  const own = holdState.live ? holdState.number : null;
  const states = cellStates(shelfState.states, own);
  const rows = Array.from({ length: geometry.rows }, (_, row) => row);

  return (
    <div
      ref={scroller}
      className="shelf"
      style={{ left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.height, "--cell": `${geometry.cellPx}px` } as CSSProperties}
      onScroll={onScroll}
    >
      <div
        role="grid"
        aria-label={LABELS.shelf.grid}
        aria-rowcount={geometry.rows}
        aria-colcount={geometry.columns}
        className="shelf__grid"
        onKeyDown={onKeyDown}
        onClick={onClick}
        onFocus={(event) => {
          const at = indexOf(event.target);
          if (at !== null) setFocusIndex(at);
        }}
      >
        {rows.map((row) => (
          <div role="row" key={row} className="shelf__row">
            {states.slice(row * geometry.columns, (row + 1) * geometry.columns).map((state, column) => {
              const index = row * geometry.columns + column;
              return (
                <Cell key={index} index={index} state={state} tabbable={index === focusIndex} drawn={drawn} />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
