import type { ComponentChildren, JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { GRID_MAX, GRID_STEP_PX, type Layout } from "../../shared/layout.js";
import { CARDINALITY, refText, typeText, type Model, type Ref } from "../../shared/model.js";
import { copy } from "../copy.js";
import { prefersReducedMotion } from "../ui.js";
import { columnKeys, columnLabel, entityLabel } from "./describe.js";
import {
  ENTITY_WIDTH,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  boxHeight,
  groupBounds,
  linkKey,
  linkPath,
  positionsOf,
  type Point,
  type Positions,
} from "./geometry.js";
import { GLIDE_MS, easeOut, playDraw, playEnter, playLift } from "./motion.js";

export const ZOOM_MIN = 25;
export const ZOOM_MAX = 200;

export interface DiagramProps {
  label: string;
  model: Model;
  layout: Layout;
  selection: string[];
  canEdit: boolean;
  glideToken: number;
  onMove: (entity: string, x: number, y: number) => void;
  onSelection: (selection: string[], announcement: string) => void;
  onLink: (from: Ref, to: Ref) => void;
  onAnnounce: (text: string) => void;
  onDetail: (entity: string) => void;
  onRename: (entity: string) => void;
  onGroup: () => void;
  onFocusEntity: (entity: string | null) => void;
  /** Width in pixels the first view should fit, zooming out in 25 percent steps (to 50 percent at most) when needed. */
  fitWidth?: number;
  children?: ComponentChildren;
}

type Gesture =
  | { kind: "pan"; pointer: number; start: Point; pan: Point; moved: boolean; entity: string | null; touch: boolean }
  | { kind: "move"; pointer: number; entity: string; start: Point; origin: Point; moved: boolean; delta: Point }
  | { kind: "link"; pointer: number; from: Ref; start: Point; current: Point }
  | { kind: "pinch"; startDistance: number; startZoom: number; mid: Point; pan: Point };

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z)));
const clampGrid = (n: number) => Math.min(GRID_MAX, Math.max(0, n));

function columnRef(element: Element | null): Ref | null {
  const column = element?.closest("[data-column]")?.getAttribute("data-column");
  if (!column) return null;
  const dot = column.indexOf(".");
  return { entity: column.slice(0, dot), column: column.slice(dot + 1) };
}

export function Diagram(props: DiagramProps) {
  const { model, layout, selection } = props;
  const region = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState<Point>({ x: 24, y: 56 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [override, setOverride] = useState<Positions | null>(null);
  const [linkFrom, setLinkFrom] = useState<Ref | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const shown = useRef<Positions>({});
  const previousModel = useRef<Model | null>(null);
  const glideSeen = useRef(props.glideToken);

  useLayoutEffect(() => {
    if (!props.fitWidth || !region.current) return;
    const available = region.current.clientWidth - 48;
    let fit = 100;
    while (fit > 50 && (props.fitWidth * fit) / 100 > available) fit -= 25;
    setZoom(fit);
  }, []);

  const base = positionsOf(layout, model);
  const positions: Positions = { ...base, ...(override ?? {}) };
  if (gesture?.kind === "move")
    positions[gesture.entity] = { x: gesture.origin.x + gesture.delta.x, y: gesture.origin.y + gesture.delta.y };
  shown.current = positions;
  const shownBefore = useRef<Positions>({});
  useEffect(() => {
    shownBefore.current = shown.current;
  });

  // Entrance and connector motion for what a parse added.
  useLayoutEffect(() => {
    const previous = previousModel.current;
    previousModel.current = model;
    if (!previous || !region.current) return;
    const root = region.current;
    const before = new Set(previous.entities.map((e) => e.name));
    for (const entity of model.entities) {
      if (before.has(entity.name)) continue;
      const node = root.querySelector<SVGGElement>(`[data-entity="${CSS.escape(entity.name)}"]`);
      if (node) playEnter(node);
    }
    const links = new Set(previous.links.map(linkKey));
    for (const link of model.links) {
      const key = linkKey(link);
      if (links.has(key)) continue;
      const group = root.querySelector<SVGGElement>(`[data-link="${CSS.escape(key)}"]`);
      const rows = [link.from, link.to]
        .map((ref) => root.querySelector<SVGGElement>(`[data-column="${CSS.escape(refText(ref))}"]`))
        .filter((r): r is SVGGElement => r !== null);
      if (group) playDraw(group, rows);
    }
  }, [model]);

  // Arrange glides every entity from where it was shown to its new cell.
  useLayoutEffect(() => {
    if (glideSeen.current === props.glideToken) return;
    glideSeen.current = props.glideToken;
    const from = { ...shownBefore.current };
    const to = positionsOf(layout, model);
    const moving = model.entities.map((e) => e.name).filter((n) => from[n] && (from[n]!.x !== to[n]!.x || from[n]!.y !== to[n]!.y));
    if (moving.length === 0 || prefersReducedMotion()) return;
    for (const name of moving) {
      const node = region.current?.querySelector<SVGGElement>(`[data-entity="${CSS.escape(name)}"]`);
      if (node) playLift(node);
    }
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / GLIDE_MS);
      const k = easeOut(t);
      const next: Positions = {};
      for (const name of moving)
        next[name] = { x: from[name]!.x + (to[name]!.x - from[name]!.x) * k, y: from[name]!.y + (to[name]!.y - from[name]!.y) * k };
      setOverride(t < 1 ? next : null);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    setOverride(Object.fromEntries(moving.map((n) => [n, from[n]!])));
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [props.glideToken]);

  const scale = zoom / 100;
  const toDiagram = (clientX: number, clientY: number): Point => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - pan.x) / scale, y: (clientY - rect.top - pan.y) / scale };
  };

  const zoomAround = (next: number, anchor?: Point) => {
    const z = clampZoom(next);
    const rect = svg.current?.getBoundingClientRect();
    const center = anchor ?? { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
    const s0 = zoom / 100;
    const s1 = z / 100;
    setPan({ x: center.x - ((center.x - pan.x) / s0) * s1, y: center.y - ((center.y - pan.y) / s0) * s1 });
    setZoom(z);
  };
  const zoomIn = () => zoomAround(Math.floor(zoom / 25) * 25 + 25);
  const zoomOut = () => zoomAround(Math.ceil(zoom / 25) * 25 - 25);

  const focusColumn = (ref: Ref) => {
    region.current?.querySelector<SVGGElement>(`[data-column="${CSS.escape(refText(ref))}"]`)?.focus();
  };
  const focusEntity = (name: string) => {
    region.current?.querySelector<SVGGElement>(`[data-entity="${CSS.escape(name)}"]`)?.focus();
  };

  const toggleSelection = (name: string, additive: boolean) => {
    if (!additive) {
      props.onSelection([name], copy.selected(name, 1));
      return;
    }
    if (selection.includes(name)) {
      const next = selection.filter((n) => n !== name);
      props.onSelection(next, copy.deselected(name, next.length));
    } else {
      const next = [...selection, name];
      props.onSelection(next, copy.selected(name, next.length));
    }
  };

  const moveBy = (name: string, dx: number, dy: number) => {
    const at = layout.entities[name];
    if (!at) return;
    props.onMove(name, clampGrid(at.x + dx), clampGrid(at.y + dy));
  };

  const finishLink = (from: Ref, to: Ref | null) => {
    if (!to) {
      props.onAnnounce(copy.linkCancelled);
      return;
    }
    if (to.entity === from.entity && to.column === from.column) {
      props.onAnnounce(copy.sameColumn);
      return;
    }
    props.onLink(from, to);
  };

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    const columnEl = target.closest("[data-column]");
    const entityEl = target.closest("[data-entity]");
    const entity = entityEl?.getAttribute("data-entity") ?? null;
    const key = event.key;

    if (linkFrom) {
      const ref = columnRef(target);
      if (key === "Escape") {
        event.preventDefault();
        setLinkFrom(null);
        props.onAnnounce(copy.linkCancelled);
        focusColumn(linkFrom);
        return;
      }
      if (key === "Enter" && ref) {
        event.preventDefault();
        if (ref.entity === linkFrom.entity && ref.column === linkFrom.column) {
          props.onAnnounce(copy.sameColumn);
          return;
        }
        setLinkFrom(null);
        props.onLink(linkFrom, ref);
        return;
      }
      if ((key === "ArrowUp" || key === "ArrowDown") && ref) {
        event.preventDefault();
        const owner = model.entities.find((e) => e.name === ref.entity)!;
        const index = owner.columns.findIndex((c) => c.name === ref.column);
        const next = owner.columns[Math.min(owner.columns.length - 1, Math.max(0, index + (key === "ArrowDown" ? 1 : -1)))]!;
        focusColumn({ entity: owner.name, column: next.name });
        return;
      }
      if (key === "Tab") {
        event.preventDefault();
        const names = model.entities.map((e) => e.name);
        const current = names.indexOf(ref?.entity ?? linkFrom.entity);
        const next = model.entities[(current + (event.shiftKey ? -1 : 1) + names.length) % names.length]!;
        focusColumn({ entity: next.name, column: next.columns[0]!.name });
        return;
      }
    }

    if (key === "+" || key === "=") {
      event.preventDefault();
      zoomIn();
      return;
    }
    if (key === "-" || key === "−") {
      event.preventDefault();
      zoomOut();
      return;
    }
    if (key === "0") {
      event.preventDefault();
      zoomAround(100);
      return;
    }
    if ((key === "g" || key === "G") && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      props.onGroup();
      return;
    }

    if (columnEl && entity) {
      const ref = columnRef(columnEl)!;
      const owner = model.entities.find((e) => e.name === entity)!;
      const index = owner.columns.findIndex((c) => c.name === ref.column);
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        const next = owner.columns[Math.min(owner.columns.length - 1, Math.max(0, index + (key === "ArrowDown" ? 1 : -1)))]!;
        focusColumn({ entity, column: next.name });
      } else if (key === "Escape") {
        event.preventDefault();
        focusEntity(entity);
      } else if ((key === "l" || key === "L") && props.canEdit) {
        event.preventDefault();
        setLinkFrom(ref);
        props.onAnnounce(copy.linkStarted(refText(ref)));
      }
      return;
    }

    if (entityEl && entity) {
      const step = event.shiftKey ? 5 : 1;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (moves[key]) {
        event.preventDefault();
        if (props.canEdit) moveBy(entity, moves[key]![0], moves[key]![1]);
      } else if (key === " ") {
        event.preventDefault();
        toggleSelection(entity, true);
      } else if (key === "Enter") {
        event.preventDefault();
        const owner = model.entities.find((e) => e.name === entity);
        if (owner?.columns[0]) focusColumn({ entity, column: owner.columns[0].name });
      } else if (key === "Escape") {
        event.preventDefault();
        if (selection.length) props.onSelection([], copy.selectionCleared);
      } else if (key === "i" || key === "I") {
        event.preventDefault();
        props.onDetail(entity);
      } else if ((key === "r" || key === "R") && props.canEdit) {
        event.preventDefault();
        props.onRename(entity);
      }
      return;
    }

    if (target === region.current) {
      const stepPx = 2 * GRID_STEP_PX * scale;
      const pans: Record<string, [number, number]> = {
        ArrowLeft: [stepPx, 0],
        ArrowRight: [-stepPx, 0],
        ArrowUp: [0, stepPx],
        ArrowDown: [0, -stepPx],
      };
      if (pans[key]) {
        event.preventDefault();
        setPan({ x: pan.x + pans[key]![0], y: pan.y + pans[key]![1] });
      } else if (key === "Escape" && selection.length) {
        event.preventDefault();
        props.onSelection([], copy.selectionCleared);
      }
    }
  };

  const onPointerDown = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    const target = event.target as Element;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    svg.current!.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const rect = svg.current!.getBoundingClientRect();
      setGesture({
        kind: "pinch",
        startDistance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startZoom: zoom,
        mid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top },
        pan,
      });
      return;
    }
    const touch = event.pointerType === "touch";
    const handle = target.closest("[data-handle]");
    const entity = target.closest("[data-entity]")?.getAttribute("data-entity") ?? null;
    if (handle && props.canEdit) {
      event.preventDefault();
      const ref = columnRef(handle)!;
      const start = toDiagram(event.clientX, event.clientY);
      setGesture({ kind: "link", pointer: event.pointerId, from: ref, start, current: start });
      return;
    }
    if (!touch && entity && target.closest(".entity-header") && props.canEdit) {
      event.preventDefault();
      setGesture({
        kind: "move",
        pointer: event.pointerId,
        entity,
        start: { x: event.clientX, y: event.clientY },
        origin: base[entity]!,
        moved: false,
        delta: { x: 0, y: 0 },
      });
      return;
    }
    setGesture({ kind: "pan", pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, pan, moved: false, entity, touch });
  };

  const onPointerMove = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!gesture) return;
    if (gesture.kind === "pinch") {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      if (!a || !b) return;
      const z = clampZoom((gesture.startZoom * Math.hypot(a.x - b.x, a.y - b.y)) / gesture.startDistance);
      const s0 = gesture.startZoom / 100;
      const s1 = z / 100;
      setZoom(z);
      setPan({
        x: gesture.mid.x - ((gesture.mid.x - gesture.pan.x) / s0) * s1,
        y: gesture.mid.y - ((gesture.mid.y - gesture.pan.y) / s0) * s1,
      });
      return;
    }
    if (event.pointerId !== gesture.pointer) return;
    if (gesture.kind === "pan") {
      const dx = event.clientX - gesture.start.x;
      const dy = event.clientY - gesture.start.y;
      const moved = gesture.moved || Math.hypot(dx, dy) > 4;
      if (moved) setPan({ x: gesture.pan.x + dx, y: gesture.pan.y + dy });
      if (moved !== gesture.moved) setGesture({ ...gesture, moved });
    } else if (gesture.kind === "move") {
      const delta = { x: (event.clientX - gesture.start.x) / scale, y: (event.clientY - gesture.start.y) / scale };
      setGesture({ ...gesture, moved: gesture.moved || Math.hypot(delta.x, delta.y) > 3, delta });
    } else if (gesture.kind === "link") {
      setGesture({ ...gesture, current: toDiagram(event.clientX, event.clientY) });
    }
  };

  const onPointerUp = (event: JSX.TargetedPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (!gesture) return;
    if (gesture.kind === "pinch") {
      if (pointers.current.size === 0) setGesture(null);
      return;
    }
    if (event.pointerId !== gesture.pointer) return;
    setGesture(null);
    if (gesture.kind === "link") {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const inside = element && region.current?.contains(element) ? element : null;
      finishLink(gesture.from, columnRef(inside));
    } else if (gesture.kind === "move") {
      const delta = gesture.delta;
      if (gesture.moved) {
        const x = clampGrid(Math.round((gesture.origin.x + delta.x) / GRID_STEP_PX));
        const y = clampGrid(Math.round((gesture.origin.y + delta.y) / GRID_STEP_PX));
        props.onMove(gesture.entity, x, y);
      } else toggleSelection(gesture.entity, event.shiftKey);
    } else if (gesture.kind === "pan" && !gesture.moved && gesture.entity) {
      if (gesture.touch) props.onDetail(gesture.entity);
      else toggleSelection(gesture.entity, event.shiftKey);
    }
  };

  const onWheel = (event: JSX.TargetedWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (event.ctrlKey) {
      const rect = svg.current!.getBoundingClientRect();
      zoomAround(zoom * Math.exp(-event.deltaY / 300), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    } else setPan({ x: pan.x - event.deltaX, y: pan.y - event.deltaY });
  };

  useEffect(() => {
    const node = svg.current!;
    const block = (e: WheelEvent) => e.preventDefault();
    node.addEventListener("wheel", block, { passive: false });
    return () => node.removeEventListener("wheel", block);
  }, []);

  const groupOf = new Map<string, string>();
  for (const group of model.groups) for (const name of group.entities) groupOf.set(name, group.name);
  const linkPreview = gesture?.kind === "link" ? gesture : null;

  return (
    <div
      role="region"
      aria-label={props.label}
      tabIndex={0}
      class={`diagram ${linkFrom ? "is-linking" : ""}`}
      ref={region}
      onKeyDown={onKeyDown}
      onFocusIn={(e) => props.onFocusEntity((e.target as Element).closest("[data-entity]")?.getAttribute("data-entity") ?? null)}
    >
      <svg
        class="diagram-svg"
        ref={svg}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
          {model.groups.map((group) => {
            const bounds = groupBounds(model, group.entities, positions);
            if (!bounds) return null;
            const colour = layout.groups[group.name]?.color ?? "blue";
            return (
              <g class={`group-region colour-${colour}`} key={group.name} aria-hidden="true">
                <rect class="group-fill" x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} rx="10" />
                <rect class="group-strip" x={bounds.x} y={bounds.y} width={bounds.width} height="26" rx="10" />
                <text class="group-name" x={bounds.x + 12} y={bounds.y + 18}>
                  {group.name}
                </text>
              </g>
            );
          })}
          {model.links.map((link) => {
            const key = linkKey(link);
            const connector = linkPath(model, link, positions);
            return (
              <g key={key} class="link" data-link={key} data-cardinality={CARDINALITY[link.token]} aria-hidden="true">
                <path class="link-line" d={connector.d} />
                <circle class="link-end" cx={connector.start.x} cy={connector.start.y} r="3.5" />
                <rect
                  class="link-end"
                  x={connector.end.x - (connector.end.x > connector.start.x ? 4 : 0)}
                  y={connector.end.y - 6}
                  width="4"
                  height="12"
                />
              </g>
            );
          })}
          {model.entities.map((entity) => {
            const at = positions[entity.name]!;
            const cell = layout.entities[entity.name];
            const colour = cell?.color ?? "slate";
            const height = boxHeight(entity);
            return (
              <g
                key={entity.name}
                class="entity"
                transform={`translate(${at.x} ${at.y})`}
                data-entity={entity.name}
                data-x={String(cell?.x ?? 0)}
                data-y={String(cell?.y ?? 0)}
                data-group={groupOf.get(entity.name) ?? ""}
                data-color={colour}
                data-selected={selection.includes(entity.name) ? "true" : "false"}
                role="group"
                tabindex={0}
                aria-label={entityLabel(model, entity)}
              >
                <g class="entity-body">
                  <rect class="entity-box" width={ENTITY_WIDTH} height={height} rx="8" />
                  <g class={`entity-header colour-${colour}`}>
                    <rect class="entity-strip" width={ENTITY_WIDTH} height={HEADER_HEIGHT} rx="8" />
                    <rect class="entity-strip" y={HEADER_HEIGHT - 8} width={ENTITY_WIDTH} height="8" />
                    <text class="entity-name" x="12" y="21">
                      {entity.name}
                    </text>
                  </g>
                  <g role="list" aria-label={`Columns of ${entity.name}`}>
                    {entity.columns.map((column, index) => {
                      const keys = columnKeys(model, entity, column);
                      const y = HEADER_HEIGHT + index * ROW_HEIGHT;
                      const ref = `${entity.name}.${column.name}`;
                      return (
                        <g
                          key={column.name}
                          class="column-row"
                          role="listitem"
                          tabindex={-1}
                          aria-label={columnLabel(model, entity, column)}
                          data-column={ref}
                          data-type={typeText(column.type)}
                          data-key={keys.join(" ")}
                          transform={`translate(0 ${y})`}
                          onFocus={() => linkFrom && props.onAnnounce(copy.linkTarget(ref))}
                        >
                          <rect class="row-bg" width={ENTITY_WIDTH} height={ROW_HEIGHT} />
                          <rect class="row-flash" width={ENTITY_WIDTH} height={ROW_HEIGHT} />
                          <text class="column-keys" x="10" y="16">
                            {keys.map((k) => (k === "primary" ? "PK" : k === "unique" ? "U" : "FK")).join(" ")}
                          </text>
                          <text class="column-name" x="44" y="16">
                            {column.name}
                          </text>
                          <text class="column-type" x={ENTITY_WIDTH - 18} y="16" text-anchor="end">
                            {typeText(column.type)}
                          </text>
                          <g class="handle" data-handle={ref} aria-hidden="true">
                            <circle class="handle-hit" cx={ENTITY_WIDTH} cy={ROW_HEIGHT / 2} r="11" />
                            <circle class="handle-dot" cx={ENTITY_WIDTH} cy={ROW_HEIGHT / 2} r="4.5" />
                          </g>
                        </g>
                      );
                    })}
                  </g>
                </g>
              </g>
            );
          })}
          {linkPreview && (
            <line
              class="link-preview"
              data-preview="true"
              x1={linkPreview.start.x}
              y1={linkPreview.start.y}
              x2={linkPreview.current.x}
              y2={linkPreview.current.y}
            />
          )}
        </g>
      </svg>
      {props.children}
      <div class="zoom-pill">
        <button type="button" class="zoom-button" aria-label="Zoom out" disabled={zoom <= ZOOM_MIN} onClick={zoomOut}>
          −
        </button>
        <span role="status" aria-label="Zoom" class="zoom-status">
          Zoom {zoom}%
        </span>
        <button type="button" class="zoom-button" aria-label="Zoom in" disabled={zoom >= ZOOM_MAX} onClick={zoomIn}>
          +
        </button>
      </div>
    </div>
  );
}
