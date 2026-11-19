// The canvas (brief: Canvas markup, Pointer, Keyboard, Connect mode, Touch, Tethered reroute).
// One SVG in the page: shapes, connectors and groups with their published markup; overlays for
// selection, port dots, lock icons and cursors; HTML pins and the label editor over it.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { copy, shapeLabel } from "../../shared/copy";
import {
  FINE_NUDGE, insertionLayer, insertionPosition, INSERT_H, INSERT_W, moveOffset, NUDGE, nextZoom, portPoint, PORTS, readingOrder, resizeBox,
  type Corner,
  visibleLayerIds, ZOOM_MAX, ZOOM_MIN,
} from "../../shared/geometry";
import { isBlocked, isShown, labelAnchor, routePage } from "../../shared/router";
import { routePath, shapePath } from "../../shared/svg";
import type { Box, Connector, Page, Point, Port, Shape, ShapeKind } from "../../shared/types";
import { announce } from "../announce";
import { Icon, icons } from "../icons";
import {
  commitMoves, connectShapes, selectionLabel, deleteSelection, duplicateSelection, groupSelection, guardLocked, isLocked, layerOf, nudge, select,
  selectedShapes, SETTLE_MS, ungroupSelection, visibleShapes, withGroup, zStep,
} from "./commands";
import { newRef, reducedMotion, type Opener, type WorkspaceStore } from "./store";

const PORT_FADE_IN_MS = 120;
const LONG_PRESS_MS = 500;
const CURSOR_EVERY_MS = 50;
const TAP_SLOP = 6;
/** Pins sit just outside the shape's top-right corner so they never cover it. */
const PIN_OFFSET = 8;

// ------------------------------------------------------------ view transform

function canvasRect(): DOMRect | null {
  return document.getElementById("canvas")?.getBoundingClientRect() ?? null;
}

/** The document point under a viewport pixel (brief: Canvas coordinates). */
function toDocument(store: WorkspaceStore, clientX: number, clientY: number): Point {
  const r = canvasRect();
  return [store.origin[0] + (clientX - (r?.left ?? 0)) / store.zoom, store.origin[1] + (clientY - (r?.top ?? 0)) / store.zoom];
}

/** Zooms to `zoom` keeping the document point under `clientX, clientY` (default: the canvas centre) in place. */
function zoomTo(store: WorkspaceStore, zoom: number, clientX?: number, clientY?: number): void {
  const r = canvasRect();
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  const cx = clientX ?? (r ? r.left + r.width / 2 : 0);
  const cy = clientY ?? (r ? r.top + r.height / 2 : 0);
  const [dx, dy] = toDocument(store, cx, cy);
  store.zoom = next;
  store.origin = [dx - (cx - (r?.left ?? 0)) / next, dy - (cy - (r?.top ?? 0)) / next];
  store.emit();
}

export function zoomStep(store: WorkspaceStore, direction: 1 | -1): void {
  zoomTo(store, nextZoom(store.zoom, direction));
}

export function resetZoom(store: WorkspaceStore): void {
  zoomTo(store, 1);
}

/** Inserts a 160x80 shape at the insertion position, selects it and opens its label editor. */
export function insertShape(store: WorkspaceStore, kind: ShapeKind): void {
  const page = store.page;
  if (!page || !store.editable) return;
  const layer = insertionLayer(page);
  const r = canvasRect();
  if (!layer || !r) return;
  const [x, y] = insertionPosition(page, toDocument(store, r.left + r.width / 2, r.top + r.height / 2));
  const ref = newRef();
  store.submit({ kind: "add_shape", page: page.id, layer, clientRef: ref, shape: { kind, x, y, w: INSERT_W, h: INSERT_H, label: "" } });
  const id = `s_tmp${ref}`;
  store.selection = [id];
  store.focusId = id;
  store.editing = { shapeId: id };
  store.emit();
}

export function openShapeActions(store: WorkspaceStore, opener: Opener, point?: Point): void {
  const shapes = selectedShapes(store);
  if (!shapes.length && !point) return;
  let anchor = point ? { x: point[0], y: point[1], w: 0, h: 0 } : { x: 0, y: 0, w: 0, h: 0 };
  if (!point) {
    const el = document.getElementById(`shape-${shapes[0]?.id}`);
    const b = el?.getBoundingClientRect();
    if (b) anchor = { x: b.left, y: b.top, w: b.width, h: b.height };
  }
  store.menu = { kind: "shape-actions", anchor, opener };
  store.emit();
}

// ------------------------------------------------------------ drawing helpers

function wrapLabel(text: string, width: number, height: number): string[] {
  const perLine = Math.max(4, Math.floor((width - 12) / 7));
  const maxLines = Math.max(1, Math.floor((height - 4) / 16));
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= perLine || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${(kept[maxLines - 1] ?? "").slice(0, perLine - 1)}…`;
    return kept;
  }
  return lines;
}

function Label({ shape }: { shape: Box & { label: string } }) {
  if (!shape.label) return null;
  const lines = wrapLabel(shape.label, shape.w, shape.h);
  const top = shape.y + shape.h / 2 - ((lines.length - 1) * 16) / 2;
  return (
    <text class="shape-label" x={shape.x + shape.w / 2} y={top} text-anchor="middle" dominant-baseline="central">
      {lines.map((line, i) => <tspan key={i} x={shape.x + shape.w / 2} y={top + i * 16}>{line}</tspan>)}
    </text>
  );
}

function Lock({ x, y, zoom }: { x: number; y: number; zoom: number }) {
  const size = 14 / Math.max(zoom, 0.5);
  return (
    <g class="lock-icon" transform={`translate(${x + 4} ${y + 4}) scale(${size / 24})`} aria-hidden="true">
      {icons.lock.map(([tag, attrs], i) => {
        const Tag = tag as "path";
        return <Tag key={i} {...(attrs as Record<string, string>)} />;
      })}
    </g>
  );
}

// ------------------------------------------------------------ gestures

type Gesture =
  | { kind: "move"; pointer: number; touch: boolean; sx: number; sy: number; ids: string[]; starts: Map<string, Box>; moved: boolean; began: number }
  | { kind: "resize"; pointer: number; corner: Corner; id: string; start: Box; sx: number; sy: number; moved: boolean; began: number }
  | { kind: "marquee"; pointer: number; sx: number; sy: number; start: Point; end: Point; additive: boolean; moved: boolean }
  | { kind: "pan"; pointer: number; lx: number; ly: number; sx: number; sy: number; moved: boolean; shape: string | null }
  | { kind: "pinch"; ids: [number, number]; d0: number; zoom0: number; doc: Point }
  | { kind: "connect"; pointer: number; from: Shape; port: Port; at: Point };

interface ConnectMode {
  source: string;
  index: number;
  port: Port | null;
}

/** Graphics roles from WAI-ARIA Graphics, which the JSX role type does not list. */
const symbolRole: Record<string, string> = { role: "graphics-symbol" };
const documentRole: Record<string, string> = { role: "graphics-document" };

/** The connector label's box, centred on the midpoint of the route's longest segment. */
const LABEL_BOX_W = 240;
const LABEL_BOX_H = 20;

const CORNERS: [Corner, (b: Box) => Point][] = [
  ["nw", (b) => [b.x, b.y]], ["ne", (b) => [b.x + b.w, b.y]], ["sw", (b) => [b.x, b.y + b.h]], ["se", (b) => [b.x + b.w, b.y + b.h]],
];

export function Canvas({ store }: { store: WorkspaceStore }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorSent = useRef({ at: -Infinity, timer: null as ReturnType<typeof setTimeout> | null, last: null as Point | null });
  const [connect, setConnect] = useState<ConnectMode | null>(null);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [memberOf, setMemberOf] = useState<string | null>(null);
  const [dots, setDots] = useState<{ ids: string[]; start: number; out: number | null } | null>(null);
  const [linkLine, setLinkLine] = useState<{ a: Point; b: Point } | null>(null);
  const [labelValue, setLabelValue] = useState("");
  const [, setFrame] = useState(0);
  const editorRef = useRef<HTMLInputElement>(null);

  const page = store.page;
  const zoom = store.zoom;
  const [ox, oy] = store.origin;
  const editable = store.editable;
  const reduce = reducedMotion();

  // Port-dot fades run frame by frame.
  useEffect(() => {
    if (!dots || reduce) return undefined;
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      if (dots.out !== null && now - dots.out >= SETTLE_MS) {
        setDots(null);
        return;
      }
      setFrame((f) => f + 1);
      if (dots.out !== null || now - dots.start < PORT_FADE_IN_MS) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [dots, reduce]);

  useLayoutEffect(() => {
    if (store.editing) {
      const editing = store.editing;
      const current = page?.shapes.find((s) => s.id === store.resolve(editing.shapeId))?.label ?? "";
      setLabelValue(current);
      requestAnimationFrame(() => editorRef.current?.focus());
      editorRef.current?.focus();
    }
  }, [store.editing]);

  if (!page) return null;

  const visible = visibleLayerIds(page);
  const layerOrder = new Map(page.layers.map((l) => [l.id, l.order]));
  const preview = store.dragPreview;
  const drawnShapes = preview ? page.shapes.map((s) => (preview.has(s.id) ? { ...s, ...(preview.get(s.id) as Box) } : s)) : page.shapes;
  const drawnPage: Page = preview ? { ...page, shapes: drawnShapes } : page;
  const routes = preview ? routePage(drawnPage) : null;
  const shapeById = new Map(drawnShapes.map((s) => [s.id, s]));
  const shown = drawnShapes.filter((s) => visible.has(s.layer)).sort((a, b) => (layerOrder.get(a.layer) ?? 0) - (layerOrder.get(b.layer) ?? 0) || a.z - b.z);
  const order = readingOrder(shown);
  const selected = new Set(store.selection.map((id) => store.resolve(id)));
  const roving = (store.focusId && shapeById.has(store.resolve(store.focusId)) ? store.resolve(store.focusId) : order[0]?.id) ?? null;
  const candidates = connect ? order.filter((s) => s.id !== connect.source && !isLocked(page, s)) : [];
  const target = connect ? candidates[connect.index] : undefined;
  const now = performance.now();
  const routeOf = (c: Connector) => routes?.get(c.id)?.route ?? c.route;

  // ------------------------------------------------------------ helpers bound to this render

  const focusShape = (id: string | null) => {
    store.focusId = id;
    store.focusKey = id ? `shape:${store.keyFor(id)}` : "canvas";
    store.emit();
  };

  const shapeAt = (el: EventTarget | null): Shape | null => {
    const g = (el as Element | null)?.closest?.("[id^='shape-']");
    return g ? (page.shapes.find((s) => s.id === g.id.slice(6)) ?? null) : null;
  };

  const endGesturePreview = () => {
    store.dragPreview = null;
    store.emit();
  };

  const sendCursor = (point: Point) => {
    const state = cursorSent.current;
    state.last = point;
    const elapsed = performance.now() - state.at;
    const fire = () => {
      state.timer = null;
      state.at = performance.now();
      if (state.last) store.sendCursor(page.id, Math.round(state.last[0]), Math.round(state.last[1]));
    };
    if (elapsed >= CURSOR_EVERY_MS) fire();
    else if (!state.timer) state.timer = setTimeout(fire, CURSOR_EVERY_MS - elapsed);
  };

  const pickShape = (shape: Shape, additive: boolean) => {
    if (!guardLocked(page, shape)) return false;
    const group = withGroup(page, shape);
    setMemberOf(null);
    if (additive) {
      const has = group.every((id) => selected.has(id));
      select(store, has ? [...selected].filter((id) => !group.includes(id)) : [...new Set([...selected, ...group])]);
    } else if (!group.every((id) => selected.has(id)) || selected.size !== group.length) {
      if (!selected.has(shape.id)) select(store, group);
    }
    return true;
  };

  const movingSet = (shape: Shape): string[] => {
    const ids = selected.has(shape.id) ? [...selected] : withGroup(page, shape);
    const all = new Set<string>();
    for (const id of ids) {
      const s = page.shapes.find((x) => x.id === id);
      if (s && !isLocked(page, s)) for (const m of withGroup(page, s)) all.add(m);
    }
    return [...all];
  };

  const startDots = (ids: string[]) => setDots({ ids, start: performance.now(), out: null });
  const fadeDots = () => {
    if (reduce) setDots(null);
    else setDots((d) => (d ? { ...d, out: performance.now() } : null));
  };

  // ------------------------------------------------------------ pointer

  const onPointerDown = (e: PointerEvent) => {
    const svg = svgRef.current;
    if (!svg || e.button > 0) return;
    const touch = e.pointerType === "touch";
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (touch && pointers.current.size === 2) {
      if (longPress.current) clearTimeout(longPress.current);
      const [a, b] = [...pointers.current.entries()] as [[number, Point], [number, Point]];
      const mid: Point = [(a[1][0] + b[1][0]) / 2, (a[1][1] + b[1][1]) / 2];
      if (gesture.current?.kind === "move") endGesturePreview();
      gesture.current = { kind: "pinch", ids: [a[0], b[0]], d0: Math.hypot(a[1][0] - b[1][0], a[1][1] - b[1][1]) || 1, zoom0: store.zoom, doc: toDocument(store, mid[0], mid[1]) };
      return;
    }
    if (pointers.current.size > 1) return;
    svg.setPointerCapture?.(e.pointerId);
    const el = e.target as Element;
    const handle = el.closest?.("[data-handle]");
    if (handle && editable) {
      e.preventDefault();
      const id = handle.getAttribute("data-shape") as string;
      const s = page.shapes.find((x) => x.id === id);
      if (!s) return;
      if (selected.size === 1 && !s.group) {
        gesture.current = { kind: "resize", pointer: e.pointerId, corner: handle.getAttribute("data-handle") as Corner, id, start: { x: s.x, y: s.y, w: s.w, h: s.h }, sx: e.clientX, sy: e.clientY, moved: false, began: performance.now() };
      } else {
        // In a multi-selection or a group the handles only mark the selection; dragging one moves it.
        const ids = movingSet(s);
        gesture.current = { kind: "move", pointer: e.pointerId, touch, sx: e.clientX, sy: e.clientY, ids, starts: new Map(ids.map((m) => [m, page.shapes.find((x) => x.id === m) as Box])), moved: false, began: performance.now() };
      }
      return;
    }
    const dot = el.closest?.("[data-port]");
    if (dot && editable && !touch) {
      e.preventDefault();
      const from = page.shapes.find((x) => x.id === dot.getAttribute("data-shape"));
      if (from) gesture.current = { kind: "connect", pointer: e.pointerId, from, port: dot.getAttribute("data-port") as Port, at: toDocument(store, e.clientX, e.clientY) };
      return;
    }
    const shape = shapeAt(el);
    if (shape) {
      e.preventDefault();
      focusShape(shape.id);
      if (touch) {
        const point: Point = [e.clientX, e.clientY];
        longPress.current = setTimeout(() => {
          longPress.current = null;
          gesture.current = null;
          endGesturePreview();
          if (!isLocked(page, shape) || guardLocked(page, shape)) {
            setMemberOf(null);
            select(store, withGroup(page, shape));
            openShapeActions(store, svg, point);
          }
        }, LONG_PRESS_MS);
        if (selected.has(shape.id) && editable && !isLocked(page, shape)) {
          const ids = movingSet(shape);
          gesture.current = { kind: "move", pointer: e.pointerId, touch, sx: e.clientX, sy: e.clientY, ids, starts: new Map(ids.map((id) => [id, page.shapes.find((s) => s.id === id) as Box])), moved: false, began: performance.now() };
        } else {
          gesture.current = { kind: "pan", pointer: e.pointerId, lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, shape: shape.id };
        }
        return;
      }
      if (!pickShape(shape, e.shiftKey) || e.shiftKey || !editable) return;
      const ids = movingSet(shape);
      gesture.current = { kind: "move", pointer: e.pointerId, touch, sx: e.clientX, sy: e.clientY, ids, starts: new Map(ids.map((id) => [id, page.shapes.find((s) => s.id === id) as Box])), moved: false, began: performance.now() };
      return;
    }
    e.preventDefault();
    focusShape(null);
    if (touch) {
      gesture.current = { kind: "pan", pointer: e.pointerId, lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, shape: null };
      return;
    }
    const start = toDocument(store, e.clientX, e.clientY);
    gesture.current = { kind: "marquee", pointer: e.pointerId, sx: e.clientX, sy: e.clientY, start, end: start, additive: e.shiftKey, moved: false };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "mouse") sendCursor(toDocument(store, e.clientX, e.clientY));
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    const g = gesture.current;
    if (!g) {
      if (e.pointerType === "mouse" && editable) setHover(shapeAt(e.target)?.id ?? (e.target as Element).closest?.("[data-port]")?.getAttribute("data-shape") ?? null);
      return;
    }
    if (g.kind === "pinch") {
      const a = pointers.current.get(g.ids[0]);
      const b = pointers.current.get(g.ids[1]);
      if (!a || !b) return;
      const r = canvasRect();
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, g.zoom0 * (Math.hypot(a[0] - b[0], a[1] - b[1]) / g.d0)));
      const mid: Point = [(a[0] + b[0]) / 2 - (r?.left ?? 0), (a[1] + b[1]) / 2 - (r?.top ?? 0)];
      store.zoom = next;
      store.origin = [g.doc[0] - mid[0] / next, g.doc[1] - mid[1] / next];
      store.emit();
      return;
    }
    if ("pointer" in g && g.pointer !== e.pointerId) return;
    const far = "sx" in g && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > TAP_SLOP;
    if (far && longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
    switch (g.kind) {
      case "move": {
        if (!g.moved && !far) return;
        if (!g.moved) startDots(g.ids);
        g.moved = true;
        const dx = (e.clientX - g.sx) / store.zoom;
        const dy = (e.clientY - g.sy) / store.zoom;
        const [ox, oy] = moveOffset([...g.starts.values()], dx, dy, e.altKey || !store.snap);
        store.dragPreview = new Map([...g.starts].map(([id, b]) => [id, { ...b, x: b.x + ox, y: b.y + oy }]));
        store.emit();
        return;
      }
      case "resize": {
        if (!g.moved && !far) return;
        if (!g.moved) startDots([g.id]);
        g.moved = true;
        const dx = (e.clientX - g.sx) / store.zoom;
        const dy = (e.clientY - g.sy) / store.zoom;
        store.dragPreview = new Map([[g.id, resizeBox(g.start, g.corner, dx, dy, e.altKey || !store.snap)]]);
        store.emit();
        return;
      }
      case "marquee":
        if (!g.moved && !far) return;
        g.moved = true;
        g.end = toDocument(store, e.clientX, e.clientY);
        setMarquee({ a: g.start, b: g.end });
        return;
      case "pan":
        if (!g.moved && !far) return;
        g.moved = true;
        store.origin = [store.origin[0] - (e.clientX - g.lx) / store.zoom, store.origin[1] - (e.clientY - g.ly) / store.zoom];
        g.lx = e.clientX;
        g.ly = e.clientY;
        store.emit();
        return;
      case "connect": {
        g.at = toDocument(store, e.clientX, e.clientY);
        setLinkLine({ a: portPoint(g.from, g.port), b: g.at });
        return;
      }
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    if (g.pointer !== e.pointerId) return;
    gesture.current = null;
    switch (g.kind) {
      case "move": {
        const final = store.dragPreview;
        if (g.moved && final) {
          const moves = new Map([...final].map(([id, next]) => [id, { start: g.starts.get(id) as Box, next }]));
          commitMoves(store, moves, selectionLabel(g.ids.map((id) => page.shapes.find((s) => s.id === id)).filter((s): s is Shape => !!s)));
          fadeDots();
        } else if (g.touch) {
          const shape = page.shapes.find((s) => s.id === g.ids[0]);
          if (shape) pickShape(shape, false);
        }
        endGesturePreview();
        return;
      }
      case "resize": {
        const final = store.dragPreview?.get(g.id);
        const resized = page.shapes.find((s) => s.id === g.id);
        if (g.moved && final && resized) commitMoves(store, new Map([[g.id, { start: g.start, next: final }]]), shapeLabel(resized));
        fadeDots();
        endGesturePreview();
        return;
      }
      case "marquee": {
        setMarquee(null);
        if (!g.moved) {
          if (!g.additive) select(store, []);
          setMemberOf(null);
          return;
        }
        const x1 = Math.min(g.start[0], g.end[0]);
        const x2 = Math.max(g.start[0], g.end[0]);
        const y1 = Math.min(g.start[1], g.end[1]);
        const y2 = Math.max(g.start[1], g.end[1]);
        const inside = visibleShapes(page).filter((s) => !isLocked(page, s) && s.x >= x1 && s.y >= y1 && s.x + s.w <= x2 && s.y + s.h <= y2);
        const ids = new Set(g.additive ? [...selected] : []);
        for (const s of inside) for (const id of withGroup(page, s)) ids.add(id);
        select(store, [...ids]);
        return;
      }
      case "pan":
        if (!g.moved) {
          const shape = g.shape ? page.shapes.find((s) => s.id === g.shape) : null;
          if (shape) pickShape(shape, false);
          else select(store, []);
        }
        return;
      case "connect": {
        setLinkLine(null);
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const to = shapeAt(hit) ?? page.shapes.find((s) => s.id === hit?.closest?.("[data-port]")?.getAttribute("data-shape"));
        if (!to || to.id === g.from.id || !guardLocked(page, to)) return;
        const near = PORTS.reduce((best, port) => {
          const p = portPoint(to, port);
          const b = portPoint(to, best);
          return Math.hypot(p[0] - g.at[0], p[1] - g.at[1]) < Math.hypot(b[0] - g.at[0], b[1] - g.at[1]) ? port : best;
        }, "n" as Port);
        store.submit({ kind: "add_connector", page: page.id, from: { shape: g.from.id, port: g.port }, to: { shape: to.id, port: near }, label: "", clientRef: newRef() });
        announce(copy.connected(shapeLabel(g.from), shapeLabel(to)));
        return;
      }
    }
  };

  const onPointerCancel = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (longPress.current) clearTimeout(longPress.current);
    gesture.current = null;
    setMarquee(null);
    setLinkLine(null);
    endGesturePreview();
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomTo(store, store.zoom * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
    else {
      store.origin = [store.origin[0] + e.deltaX / store.zoom, store.origin[1] + e.deltaY / store.zoom];
      store.emit();
    }
  };

  // ------------------------------------------------------------ keyboard

  const focusedShape = () => (roving ? page.shapes.find((s) => s.id === roving) ?? null : null);

  const onKeyDown = (e: KeyboardEvent) => {
    if (store.editing || e.defaultPrevented) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const current = document.activeElement?.closest?.("[id^='shape-']") ? focusedShape() : null;
    if (connect) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") setConnect(null);
      else if (["ArrowRight", "ArrowDown"].includes(e.key)) setConnect({ ...connect, index: (connect.index + 1) % candidates.length });
      else if (["ArrowLeft", "ArrowUp"].includes(e.key)) setConnect({ ...connect, index: (connect.index - 1 + candidates.length) % candidates.length });
      else if (["1", "2", "3", "4"].includes(e.key)) setConnect({ ...connect, port: (["n", "e", "s", "w"] as const)[Number(e.key) - 1] ?? null });
      else if (e.key === "Enter") {
        const source = page.shapes.find((s) => s.id === connect.source);
        if (source && target) connectShapes(store, source, target, connect.port);
        setConnect(null);
        focusShape(connect.source);
      }
      return;
    }
    const arrows: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const arrow = arrows[e.key];
    if (arrow && e.altKey && !e.shiftKey && !ctrl) {
      e.preventDefault();
      if (!order.length) return;
      const index = order.findIndex((s) => s.id === roving);
      const step = arrow[0] + arrow[1] > 0 ? 1 : -1;
      const next = order[Math.min(order.length - 1, Math.max(0, index + step))];
      if (next) focusShape(next.id);
      return;
    }
    if (arrow && !e.altKey && !ctrl) {
      e.preventDefault();
      const distance = e.shiftKey ? FINE_NUDGE : NUDGE;
      if (!store.selection.length && current && !guardLocked(page, current)) return;
      const moved = nudge(store, arrow[0] * distance, arrow[1] * distance);
      if (moved.length && !reduce) {
        startDots(moved);
        fadeDots();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (memberOf) {
        select(store, page.shapes.filter((s) => s.group === memberOf).map((s) => s.id));
        setMemberOf(null);
      } else select(store, []);
      return;
    }
    if (e.key === " " && e.shiftKey && current) {
      e.preventDefault();
      pickShape(current, true);
      return;
    }
    if ((e.key === " " || e.key === "Enter") && !e.shiftKey && !ctrl && current) {
      e.preventDefault();
      const group = withGroup(page, current);
      const isSelected = group.every((id) => selected.has(id)) && selected.size === group.length;
      if (!isSelected && !selected.has(current.id)) {
        pickShape(current, false);
        return;
      }
      if (e.key === "Enter") {
        if (current.group && !memberOf && selected.size > 1) {
          const first = page.shapes.filter((s) => s.group === current.group).sort((a, b) => a.z - b.z)[0];
          if (first) {
            setMemberOf(current.group);
            select(store, [first.id]);
            focusShape(first.id);
          }
          return;
        }
        if (editable && guardLocked(page, current)) {
          store.editing = { shapeId: current.id };
          store.emit();
        }
      }
      return;
    }
    if (ctrl && e.code === "KeyA" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      select(store, visibleShapes(page).filter((s) => !isLocked(page, s)).map((s) => s.id));
      return;
    }
    if (ctrl && e.code === "KeyG" && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) ungroupSelection(store);
      else groupSelection(store);
      return;
    }
    if (ctrl && e.code === "KeyD" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      duplicateSelection(store);
      return;
    }
    if (ctrl && (e.code === "BracketRight" || e.code === "BracketLeft")) {
      e.preventDefault();
      zStep(store, e.code === "BracketRight" ? "forward" : "backward");
      return;
    }
    if (ctrl || e.altKey) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (!editable) return;
      const next = deleteSelection(store);
      focusShape(next);
      return;
    }
    if (e.code === "KeyR" && !e.shiftKey) {
      e.preventDefault();
      insertShape(store, "rectangle");
      return;
    }
    if (e.code === "KeyC" && !e.shiftKey && current) {
      e.preventDefault();
      if (!editable) return;
      const list = order.filter((s) => s.id !== current.id && !isLocked(page, s));
      if (!list.length) return;
      const after = list.findIndex((s) => order.indexOf(s) > order.indexOf(current));
      setConnect({ source: current.id, index: after < 0 ? 0 : after, port: null });
      return;
    }
    if (e.code === "KeyM" && !e.shiftKey && selected.size) {
      e.preventDefault();
      const first = selectedShapes(store)[0];
      if (!first) return;
      store.commentTarget = first.id;
      if (innerWidth < 768) store.sheet = "comments";
      else store.tab = "comments";
      store.composerFocus++;
      store.emit();
      return;
    }
    if (e.key === "F10" && e.shiftKey && selected.size) {
      e.preventDefault();
      openShapeActions(store, document.activeElement instanceof SVGElement || document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
  };

  // ------------------------------------------------------------ label editor

  const editing = store.editing;
  const editBox: Box | null = editing ? (shapeById.get(store.resolve(editing.shapeId)) ?? null) : null;

  /** Enter commits the label; Escape keeps the old label. Focus returns to the shape either way. */
  const finishEditing = (commitValue: boolean) => {
    const ed = store.editing;
    if (!ed) return;
    store.editing = null;
    const shape = page.shapes.find((s) => s.id === store.resolve(ed.shapeId));
    if (commitValue && shape && shape.label !== labelValue) store.submit({ kind: "update_shape", shape: shape.id, set: { label: labelValue } });
    focusShape(shape?.id ?? null);
  };

  // ------------------------------------------------------------ render

  const pins = store.comments.filter((c) => !c.parent && !c.resolved && c.anchored && c.page === page.id);
  const emptyPage = shown.length === 0;
  const dotOpacity = (start: number, out: number | null) => {
    if (reduce) return 1;
    if (out !== null) return Math.max(0, 1 - (now - out) / SETTLE_MS);
    return Math.min(1, (now - start) / PORT_FADE_IN_MS);
  };
  const dotIds = dots ? new Set(dots.ids) : null;
  const tethered = dotIds ? page.connectors.filter((c) => isShown(drawnPage, c, visible) && (dotIds.has(c.from.shape) || dotIds.has(c.to.shape))) : [];

  const renderShape = (s: Shape) => {
    const layer = layerOf(page, s);
    const label = shapeLabel(s);
    const path = shapePath(s.kind, s);
    const glide = store.glides.get(s.id);
    const gliding = glide && now - glide.start < 240;
    return (
      <g key={store.keyFor(s.id)} id={`shape-${s.id}`} {...symbolRole} aria-roledescription={s.kind} aria-label={label}
        aria-description={layer?.locked ? copy.lockedDescription(layer.name) : undefined}
        data-x={s.x} data-y={s.y} data-w={s.w} data-h={s.h} data-layer={s.layer} data-selected={selected.has(s.id) ? "true" : undefined}
        data-focus-key={`shape:${store.keyFor(s.id)}`} tabindex={s.id === roving ? 0 : -1} class={`shape kind-${s.kind}${gliding ? " gliding" : ""}`}
        onFocus={() => {
          store.focusId = s.id;
          setFocused(s.id);
        }} onBlur={() => setFocused((f) => (f === s.id ? null : f))}>
        {path ? <path class="shape-outline" d={path} /> : <rect class="shape-hit" x={s.x} y={s.y} width={s.w} height={s.h} />}
        <Label shape={s} />
      </g>
    );
  };

  const layers: preact.JSX.Element[] = [];
  const emitted = new Set<string>();
  for (const s of shown) {
    if (s.group) {
      if (emitted.has(s.group)) continue;
      emitted.add(s.group);
      const members = shown.filter((m) => m.group === s.group);
      layers.push(
        <g key={`group-${store.keyFor(s.group)}`} id={`group-${s.group}`} role="group" aria-label={copy.groupName(members.length)}>
          {members.map(renderShape)}
        </g>,
      );
    } else layers.push(renderShape(s));
  }

  const connectors = page.connectors.filter((c) => isShown(drawnPage, c, visible)).map((c) => {
    const route = routeOf(c);
    const a = shapeById.get(c.from.shape);
    const b = shapeById.get(c.to.shape);
    if (!a || !b || route.length < 2) return null;
    const blocked = isBlocked(drawnPage, c, route);
    const [lx, ly] = labelAnchor(route);
    return (
      <g key={store.keyFor(c.id)} id={`connector-${c.id}`} {...symbolRole} aria-roledescription="connector"
        aria-label={copy.connectorName(shapeLabel(a), shapeLabel(b), blocked)} data-points={route.map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).join(" ")}
        data-from={`${c.from.shape}:${c.from.port}`} data-to={`${c.to.shape}:${c.to.port}`} data-blocked={blocked ? "true" : undefined}
        data-settling={store.settling.has(c.id) ? "true" : undefined} class={`connector${blocked ? " blocked" : ""}`}>
        <path d={routePath(route)} marker-end="url(#arrowhead)" />
        {c.label && (
          // The label is HTML inside a foreignObject centred on the label anchor, so it reads as text to every
          // assistive technology and keeps a paper chip behind it.
          <foreignObject class="connector-label-box" x={lx - LABEL_BOX_W / 2} y={ly - LABEL_BOX_H / 2} width={LABEL_BOX_W} height={LABEL_BOX_H}>
            <text class="connector-label"><span>{c.label}</span></text>
          </foreignObject>
        )}
      </g>
    );
  });

  const handleSize = 8 / zoom;
  const selectedShown = shown.filter((s) => selected.has(s.id));
  const focusRing = focused ? shapeById.get(focused) : undefined;

  return (
    <div class="canvas-wrap" onWheel={onWheel}>
      <div class="pins">
        {pins.map((c) => {
          const s = shapeById.get(c.shape);
          if (!s || !visible.has(s.layer)) return null;
          return (
            <button key={c.id} type="button" id={`pin-${c.id}`} class="pin" aria-label={copy.pinName(c.author.name, shapeLabel(s))}
              style={{ left: `${(s.x + s.w - ox) * zoom + PIN_OFFSET}px`, top: `${(s.y - oy) * zoom - PIN_OFFSET}px` }}
              onClick={() => {
                store.openThread = c.id;
                store.commentTarget = c.shape;
                if (innerWidth < 768) store.sheet = "comments";
                else store.tab = "comments";
                store.emit();
              }}>
              <Icon name="comment" size={14} />
            </button>
          );
        })}
      </div>
      <svg ref={svgRef} id="canvas" {...documentRole} aria-roledescription="diagram" aria-label={`${page.name} canvas`}
        tabindex={roving ? -1 : 0} data-focus-key="canvas" class={connect ? "connecting" : ""}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
        onPointerLeave={() => setHover(null)} onKeyDown={onKeyDown}>
        <defs>
          <pattern id="grid-minor" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" class="grid-minor" />
          </pattern>
          <pattern id="grid-major" width="120" height="120" patternUnits="userSpaceOnUse">
            <rect width="120" height="120" fill="url(#grid-minor)" />
            <path d="M120 0H0V120" class="grid-major" />
          </pattern>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10" class="arrowhead" />
          </marker>
        </defs>
        <g transform={`translate(${-ox * zoom} ${-oy * zoom}) scale(${zoom})`}>
          <rect class="paper" x={ox} y={oy} width={10000 / zoom} height={10000 / zoom} fill="url(#grid-major)" aria-hidden="true" />
          {layers}
          {connectors}
          <g class="overlay" aria-hidden="true">
            {shown.filter((s) => isLocked(page, s)).map((s) => <Lock key={`lock-${s.id}`} x={s.x} y={s.y} zoom={zoom} />)}
            {[...store.glides].map(([id, g]) => {
              const s = shapeById.get(id);
              if (!s || now - g.start >= 240) return null;
              const t = Math.min(1, (now - g.start) / 240);
              const k = (1 - t) ** 3;
              const path = shapePath(s.kind, { ...s, x: s.x + g.dx * k, y: s.y + g.dy * k });
              return path ? <path key={`ghost-${id}`} class="ghost" d={path} /> : null;
            })}
            {selectedShown.map((s) => (
              <g key={`sel-${s.id}`}>
                <rect class="selection" x={s.x - 3 / zoom} y={s.y - 3 / zoom} width={s.w + 6 / zoom} height={s.h + 6 / zoom} />
                {CORNERS.map(([corner, at]) => {
                  const [hx, hy] = at(s);
                  return <rect key={corner} class="handle" data-handle={corner} data-shape={s.id} x={hx - handleSize / 2} y={hy - handleSize / 2} width={handleSize} height={handleSize} />;
                })}
              </g>
            ))}
            {focusRing && <rect class="focus-ring" x={focusRing.x - 8 / zoom} y={focusRing.y - 8 / zoom} width={focusRing.w + 16 / zoom} height={focusRing.h + 16 / zoom} />}
            {target && <rect class="connect-target" x={target.x - 3 / zoom} y={target.y - 3 / zoom} width={target.w + 6 / zoom} height={target.h + 6 / zoom} />}
            {connect && candidates.flatMap((s) => PORTS.map((p) => {
              const [px, py] = portPoint(s, p);
              const chosen = s === target && connect.port === p;
              return <circle key={`cp-${s.id}-${p}`} class={`port-dot${chosen ? " chosen" : ""}`} cx={px} cy={py} r={(chosen ? 6 : 4) / zoom} />;
            }))}
            {dots && tethered.flatMap((c) => {
              const route = routeOf(c);
              const ends = [route[0], route[route.length - 1]].filter((p): p is Point => !!p);
              return ends.map((p, i) => <circle key={`td-${c.id}-${i}`} class="port-dot" cx={p[0]} cy={p[1]} r={4 / zoom} style={{ opacity: dotOpacity(dots.start, dots.out) }} />);
            })}
            {!connect && !dots && hover && editable && (() => {
              const s = shapeById.get(hover);
              if (!s || !visible.has(s.layer) || isLocked(page, s)) return null;
              return PORTS.map((p) => {
                const [px, py] = portPoint(s, p);
                return <circle key={`hp-${p}`} class="port-dot hover-port" data-port={p} data-shape={s.id} cx={px} cy={py} r={5 / zoom} />;
              });
            })()}
            {marquee && <rect class="marquee" x={Math.min(marquee.a[0], marquee.b[0])} y={Math.min(marquee.a[1], marquee.b[1])} width={Math.abs(marquee.a[0] - marquee.b[0])} height={Math.abs(marquee.a[1] - marquee.b[1])} />}
            {linkLine && <path class="link-line" d={`M${linkLine.a[0]} ${linkLine.a[1]}L${linkLine.b[0]} ${linkLine.b[1]}`} />}
          </g>
          {[...store.cursors.values()].filter((c) => c.page === page.id).map((c) => {
            const at = store.cursorAt(c, now);
            return (
              <g key={c.userId} id={`cursor-${c.userId}`} data-cursor-of={c.userId} aria-hidden="true" class="cursor" transform={`translate(${at.x} ${at.y}) scale(${1 / zoom})`}>
                <path d="M0 0L0 16L4.5 12L7.5 19L10 18L7 11L12.5 11Z" class="cursor-arrow" />
                <rect x="12" y="16" width={c.name.length * 7 + 12} height="20" rx="2" class="cursor-tag" />
                <text x="18" y="30" class="cursor-name">{c.name}</text>
              </g>
            );
          })}
        </g>
      </svg>
      {emptyPage && (
        <div class="empty-page" aria-hidden="false">
          <Icon name="compass" size={28} />
          <p>{copy.emptyPage}</p>
        </div>
      )}
      {editBox && (
        <input ref={editorRef} class="label-editor" aria-label="Label" value={labelValue}
          style={{ left: `${(editBox.x - ox) * zoom}px`, top: `${(editBox.y + editBox.h / 2 - oy) * zoom - 16}px`, width: `${Math.max(120, editBox.w * zoom)}px` }}
          onInput={(e) => setLabelValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              finishEditing(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              finishEditing(false);
            }
          }} />
      )}
    </div>
  );
}

