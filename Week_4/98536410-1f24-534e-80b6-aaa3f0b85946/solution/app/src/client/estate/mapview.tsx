// The estate map: coastline, markers, clusters and every way of moving the viewport.
import { type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { landPath, useCoastline } from "../coastline";
import { Figure } from "../lib/figure";
import { REGION_NAMES } from "../lib/format";
import { MOTION, commit, easeOutCubic, reducedMotion } from "../lib/motion";
import type { Shop } from "../types";
import { CLUSTER_ZOOM, LAT_PX, LON_PX, type MapEngine, type Phase, type View, project, viewText } from "./engine";
import { StateDot, definitionOf } from "./stateDef";

export type Arrival = "none" | "dropping" | "pulsing";
type ClusterPhase = "clustered" | "separating" | "placed";

interface MapViewProps {
  engine: MapEngine;
  view: View;
  phase: Phase;
  shops: Shop[];
  countKnown: boolean;
  panelOpen: boolean;
  progress: number;
  arrivals: Record<string, Arrival>;
  badges: Record<string, number>;
  onSelect: (id: string, opener: HTMLElement) => void;
  regionRef: RefObject<HTMLDivElement | null>;
  hidden?: boolean;
}

interface Group {
  region: string;
  shops: Shop[];
  lon: number;
  lat: number;
}

function groupByRegion(all: Shop[]): Group[] {
  const regions = new Map<string, Shop[]>();
  for (const shop of all) regions.set(shop.region, [...(regions.get(shop.region) ?? []), shop]);
  return [...regions.entries()].map(([region, members]) => ({
    region, shops: members,
    lon: members.reduce((sum, shop) => sum + shop.lon, 0) / members.length,
    lat: members.reduce((sum, shop) => sum + shop.lat, 0) / members.length,
  }));
}

const TRAVEL_MS = MOTION.clusterTravelMs;

interface Entry {
  key: string;
  box: number;
  raw: { x: number; y: number };
  render: (spot: { x: number; y: number }) => ReactNode;
}

const PIN_GAP = 28;
/** The right edge keeps clear of the zoom buttons. */
const ZOOM_GUTTER = 60;

/**
 * A shop beyond the map's edge stays reachable: its control is held at the edge, inside the page, and
 * controls held on the same edge are spread so each keeps room to be pressed.
 */
function pinToEdges(entries: Entry[], size: { width: number; height: number }): Map<string, { x: number; y: number }> {
  const spots = new Map<string, { x: number; y: number }>();
  const edges: Record<"left" | "right" | "top" | "bottom", Entry[]> = { left: [], right: [], top: [], bottom: [] };
  for (const entry of entries) {
    const half = entry.box / 2;
    const x = Math.min(Math.max(entry.raw.x, half), Math.max(half, size.width - half - ZOOM_GUTTER));
    const y = Math.min(Math.max(entry.raw.y, half), Math.max(half, size.height - half));
    spots.set(entry.key, { x, y });
    if (x !== entry.raw.x) edges[entry.raw.x < half ? "left" : "right"].push(entry);
    else if (y !== entry.raw.y) edges[entry.raw.y < half ? "top" : "bottom"].push(entry);
  }
  for (const [edge, members] of Object.entries(edges)) {
    const vertical = edge === "left" || edge === "right";
    const free = (spot: { x: number; y: number }) => (vertical ? spot.y : spot.x);
    const limit = vertical ? size.height : size.width;
    const ordered = members.map((entry) => ({ entry, spot: spots.get(entry.key) ?? entry.raw })).sort((a, b) => free(a.spot) - free(b.spot));
    const positions = ordered.map((item) => free(item.spot));
    positions.forEach((value, index) => {
      if (index > 0) positions[index] = Math.max(value, (positions[index - 1] ?? 0) + PIN_GAP);
    });
    for (let index = positions.length - 1; index >= 0; index -= 1) {
      const room = limit - 22 - (positions.length - 1 - index) * PIN_GAP;
      positions[index] = Math.min(positions[index] ?? 0, room);
    }
    ordered.forEach((item, index) => {
      const spot = spots.get(item.entry.key) ?? item.entry.raw;
      spots.set(item.entry.key, vertical ? { x: spot.x, y: positions[index] ?? spot.y } : { x: positions[index] ?? spot.x, y: spot.y });
    });
  }
  return spots;
}


interface GraticuleLine {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  major: boolean;
}

/** Meridians and parallels in the map's own longitude/latitude units: every degree up close, every five far away. */
function graticule(view: View, size: { width: number; height: number }): GraticuleLine[] {
  const halfLon = size.width / 2 / (LON_PX * view.zoom);
  const halfLat = size.height / 2 / (LAT_PX * view.zoom);
  const step = view.zoom >= CLUSTER_ZOOM ? 1 : 5;
  const lines: GraticuleLine[] = [];
  const west = view.lon - halfLon;
  const east = view.lon + halfLon;
  const south = view.lat - halfLat;
  const north = view.lat + halfLat;
  for (let lon = Math.ceil(west / step) * step; lon <= east; lon += step) {
    lines.push({ key: `m${lon}`, x1: lon, x2: lon, y1: -north, y2: -south, major: lon % 5 === 0 });
  }
  for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
    lines.push({ key: `p${lat}`, x1: west, x2: east, y1: -lat, y2: -lat, major: lat % 5 === 0 });
  }
  return lines;
}

export function MapView(props: MapViewProps) {
  const { engine, view, phase, shops, countKnown, panelOpen, progress, arrivals, badges, onSelect, regionRef } = props;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const coastline = useCoastline();
  const land = useMemo(() => (coastline ? landPath(coastline) : ""), [coastline]);
  const groups = useMemo(() => groupByRegion(shops), [shops]);
  const separated = view.zoom >= CLUSTER_ZOOM;
  const wasSeparated = useRef(separated);
  const [anim, setAnim] = useState<{ start: number; now: number } | null>(null);
  const loop = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; pinch: number | null; zoom0: number }>({ moved: false, pinch: null, zoom0: 1 });
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    const element = regionRef.current;
    if (!element) return undefined;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [regionRef]);

  // zooming up past the cluster threshold sends each clustered marker out to its own place, in code order
  useLayoutEffect(() => {
    if (separated === wasSeparated.current) return undefined;
    wasSeparated.current = separated;
    window.cancelAnimationFrame(loop.current);
    if (!separated || reducedMotion()) {
      setAnim(null);
      return undefined;
    }
    const start = performance.now();
    setAnim({ start, now: start });
    const longest = (MOTION.clusterStaggerSlots - 1) * MOTION.clusterStaggerMs + TRAVEL_MS;
    const step = (now: number) => {
      const done = now - start >= longest;
      commit(() => setAnim(done ? null : { start, now }));
      if (!done) loop.current = window.requestAnimationFrame(step);
    };
    loop.current = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(loop.current);
  }, [separated]);

  useEffect(() => {
    const element = regionRef.current;
    if (!element) return undefined;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const steps = Math.max(1, Math.round(Math.abs(event.deltaY) / 100));
      engine.zoomBy(event.deltaY < 0 ? 0.25 * steps : -0.25 * steps);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [engine, regionRef]);

  const slotOf = (shop: Shop, group: Group): number => Math.min(group.shops.findIndex((member) => member.id === shop.id), MOTION.clusterStaggerSlots - 1);

  function markerMotion(shop: Shop, group: Group): { phase: ClusterPhase; progress: number } {
    if (group.shops.length < 2) return { phase: "placed", progress: 1 };
    if (!separated) return { phase: "clustered", progress: 0 };
    if (!anim) return { phase: "placed", progress: 1 };
    const elapsed = anim.now - anim.start - slotOf(shop, group) * MOTION.clusterStaggerMs;
    if (elapsed < 0) return { phase: "clustered", progress: 0 };
    if (elapsed < TRAVEL_MS) return { phase: "separating", progress: elapsed / TRAVEL_MS };
    return { phase: "placed", progress: 1 };
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const arrows: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const pan = arrows[event.key];
    if (pan) {
      event.preventDefault();
      engine.panKey(pan[0], pan[1]);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      engine.zoomBy(1);
    } else if (event.key === "-") {
      event.preventDefault();
      engine.zoomBy(-1);
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    suppressClick.current = false;
    if (pointers.current.size === 1) {
      gesture.current = { moved: false, pinch: null, zoom0: view.zoom };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { moved: true, pinch: a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null, zoom0: engine.state.view.zoom };
      suppressClick.current = true;
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const known = pointers.current.get(event.pointerId);
    if (!known) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, next);
    const rect = event.currentTarget.getBoundingClientRect();
    if (pointers.current.size >= 2 && gesture.current.pinch) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      const middle = { x: (a.x + b.x) / 2 - rect.left - rect.width / 2, y: (a.y + b.y) / 2 - rect.top - rect.height / 2 };
      engine.zoomAbout(gesture.current.zoom0 * (gap / gesture.current.pinch), middle);
      return;
    }
    const dx = next.x - known.x;
    const dy = next.y - known.y;
    if (!gesture.current.moved) {
      if (Math.hypot(dx, dy) < 1) return;
      gesture.current.moved = true;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      engine.dragStart();
    }
    engine.dragMove(dx, dy);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    if (pointers.current.size === 0 && gesture.current.moved && gesture.current.pinch === null) engine.dragEnd();
    if (pointers.current.size === 0) gesture.current = { moved: false, pinch: null, zoom0: 1 };
  }

  const place = (lon: number, lat: number) => project(view, size, lon, lat);
  const entries: Entry[] = groups.flatMap((group, groupIndex) => {
    const list: Entry[] = [];
    if (!separated && group.shops.length >= 2) {
      list.push({
        key: `cluster-${group.region}`, box: 56, raw: place(group.lon, group.lat),
        render: (spot) => (
          <button
            key={`cluster-${group.region}`} type="button" className="cluster" data-cluster-count={group.shops.length} data-region={group.region}
            aria-label={`Cluster of ${group.shops.length} shops in ${REGION_NAMES[group.region] ?? group.region}, zoom in`}
            style={{ transform: `translate(${spot.x - 28}px, ${spot.y - 28}px)` }}
            onClick={() => { if (!suppressClick.current) engine.jump({ lon: group.lon, lat: group.lat, zoom: CLUSTER_ZOOM }); }}
          >
            <span>{group.shops.length}</span>
          </button>
        ),
      });
    }
    for (const [shopIndex, shop] of group.shops.entries()) {
      const motion = markerMotion(shop, group);
      const own = place(shop.lon, shop.lat);
      const from = place(group.lon, group.lat);
      const mix = easeOutCubic(motion.progress);
      const hidden = motion.phase === "clustered" && !separated;
      const definition = definitionOf(shop.display_state);
      const badge = badges[shop.id] ?? 0;
      list.push({
        key: shop.id, box: 44,
        raw: motion.phase === "placed" ? own : { x: from.x + (own.x - from.x) * mix, y: from.y + (own.y - from.y) * mix },
        render: (spot) => (
          <button
            key={shop.id} type="button" className="marker"
            style={{ transform: `translate(${spot.x - 22}px, ${spot.y - 22}px)`, visibility: hidden ? "hidden" : "visible", zIndex: 1000 - groupIndex * 100 - shopIndex }}
            data-store-id={shop.id} data-marker-state={shop.display_state} data-arrival={arrivals[shop.id] ?? "none"} data-cluster-phase={motion.phase}
            aria-label={`Open ${shop.name}, ${definition.word}, critical lines: ${shop.critical_lines}`}
            onClick={(event) => { if (!suppressClick.current) onSelect(shop.id, event.currentTarget); }}
          >
            <span className="token"><StateDot state={shop.display_state} /></span>
            <span className="pulse" aria-hidden="true" />
            {badge > 0 ? <Figure kind="review-badge" value={badge} className="badge" /> : null}
          </button>
        ),
      });
    }
    return list;
  });
  const pinned = pinToEdges(entries, size);

  return (
    <div
      ref={props.regionRef}
      className="map-region"
      role="region"
      aria-label="Estate map"
      tabIndex={0}
      hidden={props.hidden}
      data-store-count={countKnown ? shops.length : undefined}
      data-viewport={viewText(view)}
      data-phase={phase}
      data-panel={panelOpen ? "open" : "closed"}
      data-motion={reducedMotion() ? "reduced" : "full"}
      data-review-progress={progress.toFixed(3)}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg className="map-sea" width={size.width} height={size.height} aria-hidden="true" focusable="false">
        <g transform={`translate(${size.width / 2} ${size.height / 2}) scale(${LON_PX * view.zoom} ${LAT_PX * view.zoom}) translate(${-view.lon} ${view.lat})`}>
          {graticule(view, size).map((line) => (
            <line key={line.key} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} className={line.major ? "graticule major" : "graticule"} />
          ))}
          <path d={land} className="land" />
        </g>
      </svg>
      {entries.map((entry) => entry.render(pinned.get(entry.key) ?? entry.raw))}
    </div>
  );
}
