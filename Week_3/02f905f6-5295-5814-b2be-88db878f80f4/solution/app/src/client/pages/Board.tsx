// The load board: kiln rail, the true-scale shelf with layer tabs and fill, the placement panel and the
// firing strip, and the ticket column. Shelf Pack works by pointer, touch and keyboard alone.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type RefObject } from "react";
import type { Firing, Kiln, Piece, PlacementResult } from "../../shared/api";
import {
  checkPlacement,
  firstClearPosition,
  footprintOf,
  GRID_MAX_HALVES,
  gridHalves,
  isRotation,
  type Cone,
  type Neighbour,
  type PieceForPlacement,
  type Rotation,
  type Shape,
  type Shelf,
  type SidesHalves,
} from "../../shared/rules";
import { request } from "../api";
import { FillNumeral } from "../board/FillNumeral";
import { FiringStrip } from "../board/FiringStrip";
import { PlacementPanel } from "../board/PlacementPanel";
import { placedFootprint, ShelfDrawing } from "../board/ShelfDrawing";
import { Tickets } from "../board/Tickets";
import { useBoardData } from "../board/useBoardData";
import { Status } from "../components/Status";
import { halvesOf, halvesText } from "../format";
import { DURATION, tween } from "../motion";
import { Link, navigate, useLocation } from "../router";

interface Lifted {
  number: string;
  origin: "stub" | "placed";
  shape: Shape;
  sides: SidesHalves;
  x: number;
  y: number;
  rotation: Rotation;
  piece: PieceForPlacement;
  /** the saved layer of a placed piece being moved */
  savedLayer: number | null;
}

const NARROW = "(max-width: 599px)";

function shelfOf(kiln: Kiln): Shelf {
  return {
    diameter: halvesOf(kiln.shelf_diameter_in),
    posts: kiln.posts.map((p) => ({ x: halvesOf(p.x), y: halvesOf(p.y), size: halvesOf(p.size_in) })),
    postHeight: halvesOf(kiln.post_height_in),
  };
}

function sidesOfPiece(piece: Piece): SidesHalves {
  const s = piece.sides_in;
  return {
    length: s.length ? halvesOf(s.length) : undefined,
    width: s.width ? halvesOf(s.width) : undefined,
    diameter: s.diameter ? halvesOf(s.diameter) : undefined,
    height: halvesOf(s.height),
  };
}

const clamp = (v: number) => Math.max(0, Math.min(GRID_MAX_HALVES, v));

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function Board() {
  const location = useLocation();
  const { data, setData, refresh } = useBoardData();
  const narrow = useNarrow();
  const kilnId = location.searchParams.get("kiln") ?? data.kilns[0]?.id ?? null;
  const kiln = data.kilns.find((k) => k.id === kilnId) ?? data.kilns[0] ?? null;
  const firing: Firing | null = kiln ? (data.firings[kiln.id] ?? null) : null;
  const [layer, setLayer] = useState(1);
  const [slideFrom, setSlideFrom] = useState<"left" | "right" | null>(null);
  const [lifted, setLifted] = useState<Lifted | null>(null);
  /** What the user has typed in X, Y or Rotation; null shows the footprint's own value. */
  const [texts, setTexts] = useState<{ x: string | null; y: string | null; rotation: string | null; note: string }>({ x: null, y: null, rotation: null, note: "" });
  const [news, setNews] = useState("");
  const [busy, setBusy] = useState(false);
  const [settle, setSettle] = useState<{ number: string; tick: number } | null>(null);
  const opener = useRef<HTMLElement | SVGGElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const focusAfter = useRef<string | null>(null);
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
  const stageWidth = useWidth(stage);

  const layers = kiln?.layers ?? 1;
  const current = Math.min(layer, layers);
  const shelf = kiln ? shelfOf(kiln) : null;
  const layerData = firing?.layers.find((l) => l.layer === current) ?? null;
  const placements = layerData?.placements ?? [];
  const building = firing?.status === "building";

  // Switching kiln drops a lifted footprint and starts at layer 1.
  useEffect(() => {
    setLifted(null);
    setLayer(1);
    setSlideFrom(null);
  }, [kiln?.id]);

  const neighbours: Neighbour[] = useMemo(
    () => placements.filter((p) => p.piece_number !== lifted?.number).map((p) => ({ pieceNumber: p.piece_number, footprint: placedFootprint(p) })),
    [placements, lifted?.number],
  );

  const liftedFootprint = lifted ? footprintOf(lifted.shape, lifted.sides, lifted.rotation, lifted.x, lifted.y) : null;
  const refusal =
    lifted && liftedFootprint && firing && shelf
      ? checkPlacement(lifted.piece, { stage: firing.profile.stage, cone: firing.profile.cone }, shelf, liftedFootprint, neighbours)
      : null;
  const gone =
    lifted !== null &&
    !pending.current &&
    data.loaded &&
    (lifted.origin === "stub"
      ? !data.queue.some((p) => p.number === lifted.number)
      : !firing?.layers.some((l) => l.placements.some((p) => p.piece_number === lifted.number)));

  const setPosition = useCallback((x: number, y: number) => {
    setLifted((l) => (l ? { ...l, x: clamp(x), y: clamp(y) } : l));
    setTexts((t) => ({ ...t, x: null, y: null, note: "" }));
  }, []);

  const move = useCallback((dx: number, dy: number) => {
    setLifted((l) => (l ? { ...l, x: clamp(l.x + dx), y: clamp(l.y + dy) } : l));
    setTexts((t) => ({ ...t, x: null, y: null, note: "" }));
  }, []);

  const rotate = useCallback(() => {
    setLifted((l) => (l ? { ...l, rotation: ((l.rotation + 90) % 360) as Rotation } : l));
    setTexts((t) => ({ ...t, rotation: null, note: "" }));
  }, []);

  useLayoutEffect(() => {
    if (!lifted) return;
    heading.current?.focus({ preventScroll: true });
    // On a phone the tickets sit below the shelf: bring the shelf and the panel back into view.
    if (narrow) window.scrollTo({ top: 0, behavior: "instant" });
    else heading.current?.scrollIntoView({ block: "nearest" });
  }, [lifted?.number]);

  useEffect(() => {
    const number = focusAfter.current;
    if (!number) return;
    const target = document.querySelector<HTMLElement>(`[data-piece="${number}"]`) ?? document.querySelector<HTMLElement>(`[data-stub="${number}"]`);
    if (target) {
      target.focus();
      focusAfter.current = null;
    }
  });

  const pick = (piece: Piece, element: HTMLElement) => {
    if (!firing || !shelf || !building) return;
    opener.current = element;
    const sides = sidesOfPiece(piece);
    const clay = data.clays.find((c) => c.id === piece.clay_id);
    const info: PieceForPlacement = { stage: piece.stage, cone: piece.cone, clayMaxCone: (clay?.max_cone ?? "10") as Cone, height: sides.height };
    const others = placements.map((p) => ({ pieceNumber: p.piece_number, footprint: placedFootprint(p) }));
    const start = firstClearPosition(info, { stage: firing.profile.stage, cone: firing.profile.cone }, shelf, (x, y) => footprintOf(piece.shape, sides, 0, x, y), others);
    setLifted({ number: piece.number, origin: "stub", shape: piece.shape, sides, x: start.x, y: start.y, rotation: 0, piece: info, savedLayer: null });
    setTexts({ x: null, y: null, rotation: null, note: "" });
  };

  const openPlaced = (number: string, element: SVGGElement) => {
    if (!firing || !building) return;
    const spot = firing.layers.flatMap((l) => l.placements.map((p) => ({ ...p, layer: l.layer }))).find((p) => p.piece_number === number);
    if (!spot) return;
    opener.current = element;
    const turned = spot.rotation === 90 || spot.rotation === 270;
    const w = halvesOf(spot.width_in);
    const d = halvesOf(spot.depth_in);
    const sides: SidesHalves = spot.shape === "rectangular" ? { length: turned ? d : w, width: turned ? w : d, height: halvesOf(spot.height_in) } : { diameter: w, height: halvesOf(spot.height_in) };
    // A placed piece already passed the stage, clay and cone checks for this firing.
    const info: PieceForPlacement = { stage: firing.profile.stage, cone: firing.profile.cone, clayMaxCone: "10", height: sides.height };
    const x = halvesOf(spot.x);
    const y = halvesOf(spot.y);
    setLifted({ number, origin: "placed", shape: spot.shape, sides, x, y, rotation: spot.rotation, piece: info, savedLayer: spot.layer });
    setTexts({ x: null, y: null, rotation: null, note: "" });
  };

  const cancel = useCallback(() => {
    setLifted(null);
    opener.current?.focus();
  }, []);

  const applyLocal = (number: string, result: PlacementResult, target: Lifted) => {
    if (!firing || !liftedFootprint) return;
    const placed = {
      piece_number: number,
      shape: target.shape,
      x: result.placement.x,
      y: result.placement.y,
      rotation: result.placement.rotation,
      width_in: halvesText(liftedFootprint.w),
      depth_in: halvesText(liftedFootprint.d),
      height_in: halvesText(target.sides.height),
    };
    const next: Firing = {
      ...firing,
      fill_percent: result.fill_percent,
      layers: firing.layers.map((l) => {
        const others = l.placements.filter((p) => p.piece_number !== number);
        return l.layer === result.placement.layer ? { ...l, height_in: result.layer_height_in, placements: [...others, placed] } : { ...l, placements: others };
      }),
    };
    setData((d) => ({ ...d, firings: { ...d.firings, [firing.kiln_id]: next }, queue: d.queue.filter((p) => p.number !== number) }));
  };

  const place = useCallback(async () => {
    if (!lifted || !firing || busy || gone) return;
    const target = lifted;
    const body = { layer: current, x: target.x / 2, y: target.y / 2, rotation: target.rotation };
    setBusy(true);
    pending.current = true;
    const result =
      target.origin === "stub"
        ? await request<PlacementResult>("POST", `/api/firings/${firing.id}/placements`, { piece_number: target.number, ...body })
        : await request<PlacementResult>("PATCH", `/api/firings/${firing.id}/placements/${target.number}`, body);
    setBusy(false);
    pending.current = false;
    if (result.ok) {
      setNews(`Placed Piece ${target.number} on layer ${result.data.placement.layer}. Load ${result.data.fill_percent}% full.`);
      applyLocal(target.number, result.data, target);
      setSettle((s) => ({ number: target.number, tick: (s?.tick ?? 0) + 1 }));
      setLifted(null);
      focusAfter.current = target.number;
      void refresh();
    } else if (result.network || result.status >= 500) {
      setNews("Not saved — the studio server is unreachable.");
    } else {
      setNews(`Not placed: ${(result.error?.message ?? "the shelf refused it").replace(/\.$/, "")}.`);
      void refresh();
    }
  }, [lifted, firing, busy, gone, current, refresh]);

  const remove = useCallback(async () => {
    if (!lifted || lifted.origin !== "placed" || !firing || busy) return;
    const target = lifted;
    setBusy(true);
    pending.current = true;
    const result = await request<{ fill_percent: number }>("DELETE", `/api/firings/${firing.id}/placements/${target.number}`);
    setBusy(false);
    pending.current = false;
    if (result.ok) {
      setNews(`Removed Piece ${target.number} from layer ${target.savedLayer ?? current}. Load ${result.data.fill_percent}% full.`);
      setData((d) => ({
        ...d,
        firings: {
          ...d.firings,
          [firing.kiln_id]: { ...firing, fill_percent: result.data.fill_percent, layers: firing.layers.map((l) => ({ ...l, placements: l.placements.filter((p) => p.piece_number !== target.number) })) },
        },
      }));
      setLifted(null);
      focusAfter.current = target.number;
      void refresh();
    } else if (result.network || result.status >= 500) {
      setNews("Not saved — the studio server is unreachable.");
    } else {
      setNews(`Not removed: ${(result.error?.message ?? "the shelf refused it").replace(/\.$/, "")}.`);
    }
  }, [lifted, firing, busy, current, refresh]);

  // Board-wide keys while a footprint is lifted, whatever board control has focus.
  useEffect(() => {
    if (!lifted) return;
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const target = event.target as HTMLElement | null;
      if (target?.dataset.coordinate === "true" && event.key !== "Escape") return;
      const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      let handled = true;
      if (step[event.key]) move(...step[event.key]);
      else if (event.key === "r" || event.key === "R") rotate();
      else if (event.key === "Enter") void place();
      else if (event.key === "Escape") cancel();
      else if (event.key === "Delete" && lifted.origin === "placed") void remove();
      else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [lifted, move, rotate, place, cancel, remove]);

  /** A typed coordinate moves the footprint as soon as it is a valid value; anything else waits. */
  const apply = (field: "x" | "y" | "rotation", text: string): boolean => {
    if (field === "rotation") {
      const value = text.trim() === "" ? null : Number(text);
      if (!isRotation(value)) return false;
      setLifted((l) => (l ? { ...l, rotation: value } : l));
      return true;
    }
    const halves = gridHalves(text);
    if (halves === null) return false;
    setLifted((l) => (l ? { ...l, [field]: halves } : l));
    return true;
  };

  const type = (field: "x" | "y" | "rotation", text: string) => {
    const applied = apply(field, text);
    setTexts((t) => ({ ...t, [field]: text, note: applied ? "" : t.note }));
  };

  const shownText = (field: "x" | "y" | "rotation") =>
    texts[field] ?? (lifted ? (field === "rotation" ? String(lifted.rotation) : halvesText(lifted[field])) : "");

  const commit = (field: "x" | "y" | "rotation") => {
    const text = shownText(field);
    if (apply(field, text) || text.trim() === "") return;
    setTexts((t) => ({ ...t, note: field === "rotation" ? "Rotation is 0, 90, 180 or 270." : "X and Y go in half-inch steps from 0 to 23." }));
  };

  const showLayer = (next: number) => {
    if (next < 1 || next > layers || next === current) return;
    setSlideFrom(next > current ? "right" : "left");
    setLayer(next);
  };

  useLayoutEffect(() => {
    const element = group.current;
    if (!element || !narrow || !slideFrom) return;
    const offset = slideFrom === "right" ? 48 : -48;
    return tween(DURATION.carousel, (p) => {
      element.style.transform = `translateX(${(1 - p) * offset}px)`;
      element.style.opacity = String(0.3 + 0.7 * p);
    });
  }, [current]);

  const onTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const next = event.key === "ArrowRight" ? current + 1 : event.key === "ArrowLeft" ? current - 1 : event.key === "Home" ? 1 : event.key === "End" ? layers : null;
    if (next === null || next < 1 || next > layers) return;
    event.preventDefault();
    showLayer(next);
    document.getElementById(`layer-tab-${next}`)?.focus();
  };

  const swipeStart = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" && narrow) swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const swipeEnd = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(event.clientY - start.y)) showLayer(dx < 0 ? current + 1 : current - 1);
  };

  const pxPerInch = stageWidth > 0 && shelf ? stageWidth / (shelf.diameter / 2 + 1.2) : 20;
  const height = layerData?.height_in ?? null;

  return (
    <div className="board">
      <aside className="kiln-rail" aria-label="Kiln rail">
        <nav aria-label="Kilns" className="kiln-nav">
          <ul>
            {data.kilns.map((k) => {
              const f = data.firings[k.id] ?? null;
              return (
                <li key={k.id} className={k.id === kiln?.id ? "is-current" : ""}>
                  <Link href={`/board?kiln=${k.id}`} aria-current={k.id === kiln?.id ? "page" : undefined}>
                    {k.name}
                  </Link>
                  <span className="rail-status small">{f ? <Status status={f.status} label={f.status_label} /> : <Status status={null} label="No firing" />}</span>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="kiln-pick field">
          <label htmlFor="kiln-select">Kiln</label>
          <select id="kiln-select" className="select" value={kiln?.id ?? ""} onChange={(e) => navigate(`/board?kiln=${e.target.value}`)}>
            {data.kilns.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </div>
      </aside>

      <div className="board-centre">
        <div className="shelf-top">
          <div className="layer-tabs" role="tablist" aria-label="Layers">
            {Array.from({ length: layers }, (_unused, i) => i + 1).map((n) => (
              <button
                key={n}
                id={`layer-tab-${n}`}
                type="button"
                role="tab"
                aria-selected={n === current}
                aria-controls="shelf-panel"
                tabIndex={n === current ? 0 : -1}
                className="layer-tab"
                onClick={() => showLayer(n)}
                onKeyDown={onTabKey}
              >
                Layer {n}
              </button>
            ))}
          </div>
          <div className="layer-stepper">
            <button type="button" className="btn" onClick={() => showLayer(current - 1)} disabled={current <= 1}>
              Previous layer
            </button>
            <span className="layer-count">
              Layer {current} of {layers}
            </span>
            <button type="button" className="btn" onClick={() => showLayer(current + 1)} disabled={current >= layers}>
              Next layer
            </button>
          </div>
          <div className="shelf-figures">
            <span className="layer-height">{height ? <span>Layer height <span className="num-strong">{height} in</span></span> : <span>Layer empty</span>}</span>
            <FillNumeral key={kiln?.id ?? "none"} value={firing?.fill_percent ?? 0} />
          </div>
        </div>

        <div className="shelf-area">
          <div className="shelf-stage" ref={stage} id="shelf-panel" role="tabpanel" aria-labelledby={`layer-tab-${current}`}>
            {shelf ? (
              <div
                key={current}
                ref={group}
                className="shelf-group"
                role="group"
                aria-label={`Shelf layer ${current}`}
                onPointerDown={swipeStart}
                onPointerUp={swipeEnd}
                onPointerCancel={() => (swipe.current = null)}
              >
                <ShelfDrawing
                  shelf={shelf}
                  placements={placements}
                  lifted={lifted && liftedFootprint ? { number: lifted.number, footprint: liftedFootprint, refusal: gone ? null : refusal } : null}
                  openNumber={lifted?.origin === "placed" ? lifted.number : null}
                  settle={settle}
                  pxPerInch={pxPerInch}
                  onOpenPlaced={openPlaced}
                  onDrag={(x, y) => setPosition(x, y)}
                />
              </div>
            ) : (
              <p className="muted">Loading the board…</p>
            )}
          </div>
          <div className="panel-slot">
            {lifted ? (
              <PlacementPanel
                key={lifted.number}
                heading={heading}
                busy={busy}
                state={{
                  number: lifted.number,
                  placed: lifted.origin === "placed",
                  gone,
                  refusal,
                  xText: shownText("x"),
                  yText: shownText("y"),
                  rotationText: shownText("rotation"),
                  coordNote: texts.note,
                }}
                onMove={move}
                onRotate={rotate}
                onType={type}
                onCommit={commit}
                onPlace={() => void place()}
                onCancel={cancel}
                onRemove={() => void remove()}
              />
            ) : (
              <div className="panel-idle stub">
                <h3>Pack a shelf</h3>
                <p className="small">
                  {building ? "Pick a ticket to lift its footprint over this layer." : firing ? "This load is no longer being built." : "Press New firing to start a load on this kiln."}
                </p>
                <ul className="small key-list">
                  <li>
                    <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> move <span className="num">½ in</span>
                  </li>
                  <li>
                    <kbd>R</kbd> turns <span className="num">90°</span>
                  </li>
                  <li>
                    <kbd>Enter</kbd> places, <kbd>Esc</kbd> puts it back
                  </li>
                  <li>
                    <kbd>Delete</kbd> takes a placed piece off
                  </li>
                </ul>
              </div>
            )}
            <p role="status" aria-label="Shelf announcements" className="shelf-news">
              {news}
            </p>
          </div>
        </div>

        {kiln ? <FiringStrip key={kiln.id} kiln={kiln} firing={firing} stale={data.stale} onChanged={() => void refresh()} /> : null}
      </div>

      {data.loaded ? (
      <Tickets
        queue={data.queue}
        loaded={data.loaded}
        firingStage={firing?.profile.stage ?? null}
        canPick={building}
        selected={lifted?.origin === "stub" ? lifted.number : null}
        onPick={pick}
      />
      ) : null}
    </div>
  );
}
