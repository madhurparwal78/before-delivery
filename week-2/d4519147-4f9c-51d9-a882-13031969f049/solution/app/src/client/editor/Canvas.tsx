import { memo, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { crossingHeading } from "../../shared/derive.ts";
import { portPoint } from "../../shared/geometry.ts";
import { plainLabel } from "../../shared/label.ts";
import { SYSTEM_KINDS, type Connector, type PageDoc, type Point, type PortSide, type Shape, type Zone } from "../../shared/model.ts";
import { announce } from "../announce.tsx";
import { KindIcon } from "../icons.tsx";
import { markerKeys, tallyText, type MarkerView } from "./boundary.ts";
import { connectFromPort, moveItems } from "./edits.ts";
import { Label } from "./Label.tsx";
import { useStore, type PageStore, type View } from "./store.ts";

const STEP = 8;

/* Items */

const ShapeItem = memo(function ShapeItem({ shape, selected, editable, layer }: { shape: Shape; selected: boolean; editable: boolean; layer: number }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${plainLabel(shape.label)}, ${SYSTEM_KINDS[shape.kind]}`}
      aria-pressed={selected}
      data-item={shape.id}
      data-kind="shape"
      className={`shape${selected ? " is-selected" : ""}`}
      style={{ left: shape.x, top: shape.y, width: shape.width, height: shape.height, zIndex: 100 + layer }}
    >
      <span className="shape-icon"><KindIcon kind={shape.kind} size={18} /></span>
      <span className="shape-label"><Label text={shape.label} /></span>
      {editable && (["n", "e", "s", "w"] as const).map((p) => <span key={p} className={`port port-${p}`} data-port={p} aria-hidden="true" />)}
    </div>
  );
});

function Digits({ from, to, t }: { from: number; to: number; t: number }) {
  if (t >= 1 || from === to) return <>{to}</>;
  const width = Math.max(String(from).length, String(to).length);
  const a = String(from).padStart(width, "0"), b = String(to).padStart(width, "0");
  return (
    <>
      {Array.from(b).map((digit, i) => {
        const da = Number(a[i]), db = Number(digit);
        const offset = da + (db - da) * t;
        return (
          <span key={i} className="roll">
            <span className="roll-strip" style={{ transform: `translateY(${-offset * 10}%)` }}>
              {"0123456789".split("").map((d) => <span key={d}>{d}</span>)}
            </span>
          </span>
        );
      })}
    </>
  );
}

const word = (n: number, w: string) => `${w}${n === 1 ? "" : "s"}`;

function Tally({ systems, crossings, roll }: { systems: number; crossings: number; roll?: { from: [number, number]; to: [number, number]; t: number } }) {
  return (
    <span aria-hidden="true" className="tally-text">
      {roll ? <Digits from={roll.from[0]} to={systems} t={roll.t} /> : systems} {word(systems, "system")} · {roll ? <Digits from={roll.from[1]} to={crossings} t={roll.t} /> : crossings} {word(crossings, "crossing")}
    </span>
  );
}

const ZoneItem = memo(function ZoneItem({ zone, selected, systems, crossings, roll }: {
  zone: Zone; selected: boolean; systems: number; crossings: number; roll?: { from: [number, number]; to: [number, number]; t: number };
}) {
  return (
    <div className={`zone zone-${zone.kind}`} style={{ left: zone.x, top: zone.y, width: zone.width, height: zone.height }}>
      <svg className="zone-frame" width={zone.width} height={zone.height} aria-hidden="true" focusable="false">
        <rect x="1" y="1" width={Math.max(0, zone.width - 2)} height={Math.max(0, zone.height - 2)} />
      </svg>
      <div role="button" tabIndex={0} aria-label={`Zone ${zone.name}`} aria-pressed={selected} data-item={zone.id} data-kind="zone" className={`zone-button${selected ? " is-selected" : ""}`}>
        <div className="zone-header"><span className="zone-name">{zone.name}</span></div>
      </div>
      <div role="group" aria-label={`${zone.name} tally ${tallyText(systems, crossings)}`} className="zone-tally">
        <Tally systems={systems} crossings={crossings} roll={roll} />
      </div>
      {zone.note !== "" && (
        <div role="note" aria-label={`${zone.name} note`} className="zone-note"><Label text={zone.note} /></div>
      )}
    </div>
  );
});

const PAD = 12;

interface Box { x: number; y: number; w: number; h: number }
type LabelSide = "above" | "below" | "right" | "left";
interface LabelSpot { at: Point; side: LabelSide }

const LABEL_H = 19, LABEL_GAP = 6, LABEL_MAX_W = 240;
/** Zone header strips (with an 8-unit clearance below) and crossing markers, which connector labels keep clear of. */
const HEADER_CLEARANCE = 32 + 8, MARKER_CLEARANCE = 12;
/** Where along a segment a label may sit: its middle first, then a third of the way from either end. */
const SLIDES = [1 / 2, 1 / 3, 2 / 3];

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Places a connector label on the longest segment where it is clear of every obstacle: above or below a horizontal
 * segment, right or left of a vertical one, at its middle or a third of the way along. Without a clear spot it sits at
 * the middle of the longest segment.
 */
function placeLabel(points: Point[], text: string, obstacles: Box[]): LabelSpot {
  const w = Math.min(LABEL_MAX_W, text.length * 6.6 + 14);
  const segments: { a: Point; b: Point; len: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (a && b) segments.push({ a, b, len: Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) });
  }
  segments.sort((p, q) => q.len - p.len);
  type Spot = LabelSpot & { box: Box };
  const spots = segments.flatMap(({ a, b }) => SLIDES.flatMap((f): Spot[] => {
    const at: Point = [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f)];
    return a[0] === b[0]
      ? [
        { at, side: "right", box: { x: at[0] + LABEL_GAP, y: at[1] - LABEL_H / 2, w, h: LABEL_H } },
        { at, side: "left", box: { x: at[0] - LABEL_GAP - w, y: at[1] - LABEL_H / 2, w, h: LABEL_H } },
      ]
      : [
        { at, side: "above", box: { x: at[0] - w / 2, y: at[1] - LABEL_GAP - LABEL_H, w, h: LABEL_H } },
        { at, side: "below", box: { x: at[0] - w / 2, y: at[1] + LABEL_GAP, w, h: LABEL_H } },
      ];
  }));
  const clear = spots.find((spot) => !obstacles.some((o) => overlaps(spot.box, o)));
  const chosen = clear ?? spots[0];
  return chosen ? { at: chosen.at, side: chosen.side } : { at: points[0] ?? [0, 0], side: "above" };
}

function ConnectorItem({ connector, points, selected, source, target, obstacles }: { connector: Connector; points: Point[]; selected: boolean; source: string; target: string; obstacles: Box[] }) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs) - PAD, y0 = Math.min(...ys) - PAD;
  const w = Math.max(...xs) - x0 + PAD, h = Math.max(...ys) - y0 + PAD;
  const d = points.map((p, i) => `${i ? "L" : "M"}${p[0] - x0} ${p[1] - y0}`).join(" ");
  const label = connector.label === "" ? null : placeLabel(points, plainLabel(connector.label), obstacles);
  const end = points[points.length - 1]!, before = points[points.length - 2] ?? end;
  const angle = (Math.atan2(end[1] - before[1], end[0] - before[0]) * 180) / Math.PI;
  // The label sits beside the button, not inside it: the button's name is fixed by the brief and must not
  // contain text it does not include (axe label-content-name-mismatch). data-item keeps a click on it selecting.
  return (
    <>
    <div
      role="button"
      tabIndex={0}
      aria-label={`Connector from ${source} to ${target}`}
      aria-pressed={selected}
      data-item={connector.id}
      data-kind="connector"
      className={`connector${selected ? " is-selected" : ""}`}
      style={{ left: x0, top: y0, width: w, height: h }}
    >
      <svg width={w} height={h} aria-hidden="true" focusable="false">
        <path className="connector-hit" d={d} />
        <path className="connector-line" d={d} />
        <path className="connector-head" d="M-7 -4 L0 0 L-7 4" transform={`translate(${end[0] - x0} ${end[1] - y0}) rotate(${angle})`} />
      </svg>
    </div>
    {label && (
      <div className="connector-label-layer" style={{ left: x0, top: y0 }}>
        <span className={`connector-label label-${label.side}`} data-item={connector.id} data-kind="connector" style={{ left: label.at[0] - x0, top: label.at[1] - y0 }}><Label text={connector.label} /></span>
      </div>
    )}
    </>
  );
}

function Marker({ marker, zone, heading }: { marker: MarkerView; zone: Zone; heading: Point }) {
  const angle = (Math.atan2(heading[1], heading[0]) * 180) / Math.PI;
  return (
    <div
      role="img"
      aria-label={`Crossing on ${zone.name}, ${marker.direction === "in" ? "entering" : "leaving"}`}
      className={`marker${zone.kind === "cde" ? " marker-cde" : ""}`}
      style={{ left: marker.x, top: marker.y, opacity: marker.opacity, transform: `translate(-50%, -50%) scale(${marker.scale})` }}
    >
      <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true" focusable="false">
        <path className="marker-diamond" d="M0 -7 L7 0 L0 7 L-7 0 Z" />
        <path className="marker-chevron" d="M-2 -3.2 L1.8 0 L-2 3.2" transform={`rotate(${angle})`} />
      </svg>
    </div>
  );
}

/* Gestures */

type Gesture =
  | { type: "pan"; id: number; sx: number; sy: number; view: View; moved: boolean; item: string | null; shift: boolean }
  | { type: "move"; id: number; sx: number; sy: number; ids: Set<string>; base: PageDoc; dx: number; dy: number; item: string; toggleOff: boolean }
  | { type: "pinch"; d0: number; view: View; anchor: Point }
  | { type: "connect"; id: number; from: string; port: PortSide; end: Point };

export function Canvas({ store, paneRef }: { store: PageStore; paneRef: React.RefObject<HTMLDivElement | null> }) {
  useStore(store);
  const doc = store.display;
  const derived = store.derived;
  const frame = store.frame;
  const view = store.view;
  const editable = !store.readOnly;
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const [draft, setDraft] = useState<{ from: Point; to: Point } | null>(null);

  useLayoutEffect(() => {
    if (!store.focusRequest || !paneRef.current) return;
    const el = paneRef.current.querySelector<HTMLElement>(`[data-item="${CSS.escape(store.focusRequest)}"]`);
    store.focusRequest = null;
    el?.focus();
  });

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const v = store.view;
      if (event.ctrlKey || event.metaKey) {
        const rect = pane.getBoundingClientRect();
        const px = event.clientX - rect.left, py = event.clientY - rect.top;
        const zoom = Math.min(4, Math.max(0.25, v.zoom * Math.exp(-event.deltaY * 0.002)));
        const cx = v.x + px / v.zoom, cy = v.y + py / v.zoom;
        store.setView({ x: cx - px / zoom, y: cy - py / zoom, zoom });
      } else {
        store.setView({ ...v, x: v.x + event.deltaX / v.zoom, y: v.y + event.deltaY / v.zoom });
      }
    };
    pane.addEventListener("wheel", onWheel, { passive: false });
    return () => pane.removeEventListener("wheel", onWheel);
  }, [store, paneRef]);

  /** A pane pointer event's position inside the canvas pane. */
  const local = (e: { clientX: number; clientY: number; currentTarget: Element }): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  const toCanvas = (p: Point, v: View = store.view): Point => [v.x + p[0] / v.zoom, v.y + p[1] / v.zoom];

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()] as [Point, Point];
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    gesture.current = { type: "pinch", d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, view: store.view, anchor: toCanvas(mid) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // A primary contact starts a new gesture: no other pointer is down, whatever earlier events were lost.
    if (e.isPrimary) {
      if (gesture.current?.type === "move") store.setPreview(null);
      if (gesture.current) setDraft(null);
      pointers.current.clear();
      gesture.current = null;
    }
    pointers.current.set(e.pointerId, local(e));
    paneRef.current?.setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      // A second finger cancels a one-finger move: nothing is recorded, and the gesture continues as a pinch.
      if (gesture.current?.type === "move") store.setPreview(null);
      setDraft(null);
      startPinch();
      return;
    }
    if (pointers.current.size > 2) return;
    const target = e.target as HTMLElement;
    const portEl = editable ? target.closest<HTMLElement>("[data-port]") : null;
    const itemEl = target.closest<HTMLElement>("[data-item]");
    const id = itemEl?.dataset.item ?? null;
    const kind = itemEl?.dataset.kind;
    const p = local(e);
    if (portEl && itemEl && id) {
      e.preventDefault();
      itemEl.focus();
      gesture.current = { type: "connect", id: e.pointerId, from: id, port: portEl.dataset.port as PortSide, end: toCanvas(p) };
      return;
    }
    if (editable && id && (kind === "shape" || kind === "zone")) {
      let toggleOff = false;
      if (!store.selection.has(id)) {
        if (e.shiftKey) store.toggle(id);
        else store.select([id]);
      } else if (e.shiftKey) toggleOff = true;
      gesture.current = { type: "move", id: e.pointerId, sx: p[0], sy: p[1], ids: new Set(store.selection), base: store.doc, dx: 0, dy: 0, item: id, toggleOff };
      return;
    }
    if (itemEl && id && itemEl.tabIndex < 0) {
      // A connector's label sits beside its button: focus the button, as a press on the button itself would.
      e.preventDefault();
      paneRef.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(id)}"]`)?.focus();
    }
    gesture.current = { type: "pan", id: e.pointerId, sx: p[0], sy: p[1], view: store.view, moved: false, item: id, shift: e.shiftKey };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.type === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const zoom = Math.min(4, Math.max(0.25, g.view.zoom * (Math.hypot(a[0] - b[0], a[1] - b[1]) / g.d0)));
      const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      store.setView({ x: g.anchor[0] - mid[0] / zoom, y: g.anchor[1] - mid[1] / zoom, zoom });
      return;
    }
    if (g.id !== e.pointerId) return;
    if (g.type === "pan") {
      const dx = p[0] - g.sx, dy = p[1] - g.sy;
      if (Math.abs(dx) + Math.abs(dy) > 2) g.moved = true;
      store.setView({ ...g.view, x: g.view.x - dx / g.view.zoom, y: g.view.y - dy / g.view.zoom });
    } else if (g.type === "move") {
      const zoom = store.view.zoom;
      const dx = Math.round((p[0] - g.sx) / zoom / STEP) * STEP, dy = Math.round((p[1] - g.sy) / zoom / STEP) * STEP;
      if (dx === g.dx && dy === g.dy) return;
      g.dx = dx;
      g.dy = dy;
      const preview = moveItems(g.base, g.ids, dx, dy, "drag");
      if (preview !== "overlap") store.setPreview(dx === 0 && dy === 0 ? null : preview);
    } else if (g.type === "connect") {
      g.end = toCanvas(p);
      setDraft({ from: portPoint(store.doc.shapes.find((s) => s.id === g.from)!, g.port), to: g.end });
    }
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.type === "pinch") {
      if (pointers.current.size < 2) gesture.current = null;
      return;
    }
    if (g.id !== e.pointerId) return;
    gesture.current = null;
    if (cancelled) {
      store.setPreview(null);
      setDraft(null);
      return;
    }
    if (g.type === "move") {
      if (g.dx === 0 && g.dy === 0) {
        store.setPreview(null);
        if (g.toggleOff) store.toggle(g.item);
        return;
      }
      const result = moveItems(g.base, g.ids, g.dx, g.dy, "full");
      if (result === "overlap") {
        store.setPreview(null);
        announce("Zones can't overlap.");
      } else store.edit(result);
    } else if (g.type === "pan") {
      if (g.moved) return;
      if (g.item) {
        if (g.shift) store.toggle(g.item);
        else store.select([g.item]);
      } else if (!g.shift) store.clearSelection();
    } else if (g.type === "connect") {
      setDraft(null);
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-kind="shape"]');
      const to = hit?.dataset.item;
      if (to && to !== g.from) {
        const made = connectFromPort(store.doc, g.from, g.port, to);
        store.edit(made.doc);
        const label = (sid: string) => plainLabel(made.doc.shapes.find((s) => s.id === sid)?.label ?? "");
        announce(`Connected ${label(g.from)} to ${label(to)}.`);
      }
    }
  };

  const zoneById = new Map(doc.zones.map((z) => [z.id, z]));
  const shapeById = new Map(doc.shapes.map((s) => [s.id, s]));
  const tallies = new Map(derived.zones.map((z) => [z.id, z]));
  const layers = new Map([...doc.shapes].sort((a, b) => a.z - b.z).map((s, i) => [s.id, i]));
  const settled = markerKeys(derived);
  const settledByKey = new Map(settled.map((m) => [m.key, m]));
  const markers: MarkerView[] = frame ? frame.markers : settled;
  const connectorById = new Map(doc.connectors.map((c) => [c.id, c]));
  const grid = 24 * view.zoom;
  const labelObstacles: Box[] = [
    ...doc.zones.map((z) => ({ x: z.x, y: z.y, w: z.width, h: HEADER_CLEARANCE })),
    ...settled.map((m) => ({ x: m.x - MARKER_CLEARANCE, y: m.y - MARKER_CLEARANCE, w: 2 * MARKER_CLEARANCE, h: 2 * MARKER_CLEARANCE })),
  ];

  return (
    <div
      ref={paneRef}
      className={`canvas-pane${editable ? "" : " is-readonly"}${store.connectFrom ? " is-connecting" : ""}`}
      role="application"
      aria-label="Diagram canvas"
      tabIndex={0}
      style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${-view.x * view.zoom}px ${-view.y * view.zoom}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onLostPointerCapture={(e) => {
        if (pointers.current.has(e.pointerId)) finish(e, true);
      }}
    >
      <div className="world" style={{ transform: `translate(${-view.x * view.zoom}px, ${-view.y * view.zoom}px) scale(${view.zoom})` }}>
        {doc.zones.map((z) => (
          <ZoneItem key={z.id} zone={z} selected={store.selection.has(z.id)} systems={tallies.get(z.id)?.systems ?? 0} crossings={tallies.get(z.id)?.crossings ?? 0} roll={frame?.tallies.get(z.id)} />
        ))}
        {doc.connectors.map((c) => (
          <ConnectorItem
            key={c.id}
            connector={c}
            points={frame?.connectors.get(c.id) ?? c.points}
            selected={store.selection.has(c.id)}
            source={plainLabel(shapeById.get(c.from.shapeId)?.label ?? "")}
            target={plainLabel(shapeById.get(c.to.shapeId)?.label ?? "")}
            obstacles={labelObstacles}
          />
        ))}
        {doc.shapes.map((s) => (
          <ShapeItem key={s.id} shape={s} selected={store.selection.has(s.id)} editable={editable} layer={layers.get(s.id) ?? 0} />
        ))}
        {markers.map((m) => {
          const zone = zoneById.get(m.zoneId);
          const connector = connectorById.get(m.connectorId);
          const at = settledByKey.get(m.key) ?? m;
          return zone && connector ? <Marker key={m.key} marker={m} zone={zone} heading={crossingHeading(connector, at.x, at.y)} /> : null;
        })}
        {draft && (
          <svg className="connect-draft" aria-hidden="true" focusable="false" style={{ left: 0, top: 0 }}>
            <path d={`M${draft.from[0]} ${draft.from[1]} L${draft.to[0]} ${draft.to[1]}`} />
          </svg>
        )}
      </div>
    </div>
  );
}
