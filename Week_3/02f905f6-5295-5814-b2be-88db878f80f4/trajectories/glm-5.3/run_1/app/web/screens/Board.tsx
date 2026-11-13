import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, cents, pieceNumber, type Clay, type Firing, type Kiln, type Piece } from "../api.js";

const SHELF = 23;
const POSTS = [
  { x: 11, y: 0.5, size: 1 },
  { x: 2.5, y: 16.5, size: 1 },
  { x: 19.5, y: 16.5, size: 1 }
];

// Client-side preview of the placement rules. The server is the decider on
// Place; this mirror only chooses the ink or hatch of a lifted footprint.
interface PreviewFootprint {
  shape: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function bounds(shape: string, rotation: number, dims: { w: number; h: number }): { w: number; h: number } {
  if (shape === "rectangular") {
    return rotation === 90 || rotation === 270 ? { w: dims.h, h: dims.w } : { w: dims.w, h: dims.h };
  }
  return { w: dims.w, h: dims.h };
}

function pastEdge(fp: PreviewFootprint): boolean {
  if (fp.shape === "rectangular") {
    const corners: Array<[number, number]> = [
      [fp.x, fp.y],
      [fp.x + fp.w, fp.y],
      [fp.x, fp.y + fp.h],
      [fp.x + fp.w, fp.y + fp.h]
    ];
    return corners.some(([cx, cy]) => {
      const dx = cx - 11.5;
      const dy = cy - 11.5;
      return dx * dx + dy * dy > 11.5 * 11.5;
    });
  }
  const cx = fp.x + fp.w / 2;
  const cy = fp.y + fp.h / 2;
  const dx = cx - 11.5;
  const dy = cy - 11.5;
  return Math.sqrt(dx * dx + dy * dy) + fp.w / 2 > 11.5;
}

function meetsPost(fp: PreviewFootprint, post: { x: number; y: number; size: number }): boolean {
  if (fp.shape === "rectangular") {
    return fp.x < post.x + post.size && post.x < fp.x + fp.w && fp.y < post.y + post.size && post.y < fp.y + fp.h;
  }
  const cx = fp.x + fp.w / 2;
  const cy = fp.y + fp.h / 2;
  const r = fp.w / 2;
  const nx = Math.max(post.x, Math.min(cx, post.x + post.size));
  const ny = Math.max(post.y, Math.min(cy, post.y + post.size));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

function overlaps(a: PreviewFootprint, b: PreviewFootprint): boolean {
  const aRound = a.shape !== "rectangular";
  const bRound = b.shape !== "rectangular";
  if (aRound && bRound) {
    const ax = a.x + a.w / 2;
    const ay = a.y + a.h / 2;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const dx = ax - bx;
    const dy = ay - by;
    const rsum = a.w / 2 + b.w / 2;
    return dx * dx + dy * dy < rsum * rsum;
  }
  if (!aRound && !bRound) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }
  const [rect, circ] = aRound ? [b, a] : [a, b];
  const cx = circ.x + circ.w / 2;
  const cy = circ.y + circ.h / 2;
  const r = circ.w / 2;
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

interface PlacementState {
  pieceNumber: number;
  x: number;
  y: number;
  rotation: number;
  layer: number;
  lifted: boolean;
  isMove: boolean;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);
  return reduced;
}

function FillMeter({ fill, animate }: { fill: number; animate: boolean }): React.ReactElement {
  const [displayed, setDisplayed] = useState(fill);
  const prevRef = useRef(fill);
  useEffect(() => {
    if (!animate) {
      setDisplayed(fill);
      prevRef.current = fill;
      return;
    }
    const from = prevRef.current;
    prevRef.current = fill;
    if (from === fill) return;
    const steps = Math.abs(fill - from);
    const started = performance.now();
    const duration = 600;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = Math.round(from + (fill - from) * t);
      setDisplayed(eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fill, animate]);
  return (
    <span className="fill-meter">
      <meter aria-label="Load fill" min={0} max={100} value={displayed} />
      <span className="num fill-count">
        Load {displayed}% full
      </span>
    </span>
  );
}

export default function Board(): React.ReactElement {
  const [kilns, setKilns] = useState<Kiln[]>([]);
  const [clays, setClays] = useState<Clay[]>([]);
  const [selectedKiln, setSelectedKiln] = useState<string>("");
  const [firing, setFiring] = useState<Firing | null>(null);
  const [queue, setQueue] = useState<Piece[]>([]);
  const [layer, setLayer] = useState(1);
  const [placement, setPlacement] = useState<PlacementState | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [firingResult, setFiringResult] = useState<string | null>(null);
  const [showNewFiring, setShowNewFiring] = useState(false);
  const [newProfileId, setNewProfileId] = useState<number | "">("");
  const [showUnload, setShowUnload] = useState(false);
  const [pickupShelf, setPickupShelf] = useState("");
  const [damagePiece, setDamagePiece] = useState<number | null>(null);
  const [damageKind, setDamageKind] = useState<"glaze_run" | "crack">("glaze_run");
  const [damagePhotoId, setDamagePhotoId] = useState<string | null>(null);
  const [damagePhotoState, setDamagePhotoState] = useState<"idle" | "uploading" | "attached">("idle");
  const [damageNote, setDamageNote] = useState("");
  const [refreshNote, setRefreshNote] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [svgSize, setSvgSize] = useState(560);
  const placementRef = useRef<PlacementState | null>(null);
  const announceRef = useRef<string | null>(null);
  const firingResultRef = useRef<string | null>(null);
  const xFieldRef = useRef<HTMLInputElement | null>(null);
  const svgWrapRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  placementRef.current = placement;
  announceRef.current = announce;
  firingResultRef.current = firingResult;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 599px)");
    setNarrow(mq.matches);
    const listener = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    const onResize = () => {
      const wrap = svgWrapRef.current;
      if (wrap) {
        setSvgSize(Math.min(wrap.clientWidth, 640));
      }
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const loadKilns = useCallback(async () => {
    try {
      const ks = await api.get<Kiln[]>("/api/kilns");
      setKilns(ks);
      setSelectedKiln((prev) => (prev && ks.some((k) => k.id === prev) ? prev : ks[0]?.id ?? ""));
    } catch {
      // signed out or unreachable: the board refresh handles the notice
    }
  }, []);

  const loadBoard = useCallback(async () => {
    try {
      const ks = await api.get<Kiln[]>("/api/kilns");
      setKilns(ks);
      let kilnId = selectedKiln;
      if (!kilnId || !ks.some((k) => k.id === kilnId)) {
        kilnId = ks[0]?.id ?? "";
        setSelectedKiln(kilnId);
      }
      const kiln = ks.find((k) => k.id === kilnId);
      const f = kiln?.current_firing_id ? await api.get<Firing>(`/api/firings/${kiln.current_firing_id}`) : null;
      setFiring(f);
      const q = await api.get<Piece[]>("/api/queue");
      setQueue(q);
      setRefreshNote(false);
    } catch {
      setRefreshNote(true);
    }
  }, [selectedKiln]);

  useEffect(() => {
    void loadKilns();
    api.get<Clay[]>("/api/clays").then(setClays).catch(() => setClays([]));
  }, [loadKilns]);

  useEffect(() => {
    void loadBoard();
    const timer = setInterval(() => void loadBoard(), 5000);
    return () => clearInterval(timer);
  }, [loadBoard]);

  // Keep the placement panel honest when others place the piece being placed.
  useEffect(() => {
    if (!placement || !firing) return;
    const placedElsewhere = firing.layers.some((l) =>
      l.placements.some((p) => p.piece_number === placement.pieceNumber)
    );
    if (placedElsewhere && placement.lifted && !placement.isMove) {
      // The stub for this piece is gone: keep the panel open with the notice.
      setAnnounce(`Piece ${pieceNumber(placement.pieceNumber)} was placed elsewhere.`);
    }
  }, [firing, placement]);

  const layerCount = firing?.layers.length ?? 1;
  useEffect(() => {
    if (layer > layerCount) setLayer(layerCount);
  }, [layerCount, layer]);

  const currentLayer = firing?.layers.find((l) => l.layer === layer) ?? null;
  const currentLayerPlacements = currentLayer?.placements ?? [];

  const [queueAll, setQueueAll] = useState<Piece[]>([]);
  useEffect(() => {
    api.get<Piece[]>("/api/pieces").then(setQueueAll).catch(() => setQueueAll([]));
  }, [firing, queue.length]);

  const scale = svgSize / SHELF;

  const liftedFootprint = useMemo(() => {
    if (!placement) return null;
    const piece = queueAll.find((p) => p.number === placement.pieceNumber);
    if (!piece) return null;
    const dims =
      piece.shape === "rectangular"
        ? { w: Number(piece.sides_in.length), h: Number(piece.sides_in.width) }
        : { w: Number(piece.sides_in.diameter), h: Number(piece.sides_in.diameter) };
    const b = bounds(piece.shape, placement.rotation, dims);
    return { shape: piece.shape, x: placement.x, y: placement.y, w: b.w, h: b.h };
  }, [placement, queueAll]);

  const placedPieces = useMemo(() => {
    if (!firing) return [];
    const nums = firing.layers.flatMap((l) => l.placements.map((p) => p.piece_number));
    return nums.map((n) => queueAll.find((p) => p.number === n)).filter((p): p is Piece => p !== undefined);
  }, [firing]);

  const kiln = kilns.find((k) => k.id === selectedKiln);

  const collision = useMemo(() => {
    const fp = liftedFootprint;
    if (!fp || !placement) return null;
    const piece = queueAll.find((p) => p.number === placement.pieceNumber);
    const firingProfile = firing?.profile;
    if (piece && firingProfile && kiln) {
      // Preview of the server's refusal order: stage, clay, cone, height, then geometry.
      const stage = piece.plan === "glaze_only" ? "glaze" : piece.stage ?? "bisque";
      if (firingProfile.stage !== stage) return `Wrong stage: piece needs ${stage} firing`;
      const clay = clays.find((c) => c.id === piece.clay_id);
      if (clay) {
        const order = ["06", "04", "02", "6", "10"];
        if (order.indexOf(firingProfile.cone) > order.indexOf(clay.max_cone)) {
          return `Clay not rated for cone ${firingProfile.cone}`;
        }
      }
      if (firingProfile.stage === "glaze" && piece.cone && firingProfile.cone !== piece.cone) {
        return `Wrong cone: piece is cone ${piece.cone}`;
      }
      if (Number(queueAll.find((p) => p.number === placement.pieceNumber)?.sides_in.height ?? 0) + 1 > Number(kiln.post_height_in)) {
        return "Too tall for this layer";
      }
    }
    if (pastEdge(fp)) return "Past shelf edge";
    for (const post of POSTS) {
      if (meetsPost(fp, post)) return "Overlaps post";
    }
    let lowest: number | null = null;
    for (const p of currentLayerPlacements) {
      if (placement?.isMove && p.piece_number === placement.pieceNumber) continue;
      const other: PreviewFootprint = { shape: p.shape, x: Number(p.x), y: Number(p.y), w: Number(p.width_in), h: Number(p.depth_in) };
      if (overlaps(fp, other) && (lowest === null || p.piece_number < lowest)) lowest = p.piece_number;
    }
    if (lowest !== null) return `Overlaps Piece ${pieceNumber(lowest)}`;
    return null;
  }, [liftedFootprint, currentLayerPlacements, placement, firing, kiln, clays, queueAll]);

  const moveBy = useCallback(
    (dx: number, dy: number) => {
      setPlacement((p) => {
        if (!p) return p;
        const nx = Math.max(0, Math.min(SHELF, p.x + dx));
        const ny = Math.max(0, Math.min(SHELF, p.y + dy));
        return { ...p, x: Math.round(nx * 2) / 2, y: Math.round(ny * 2) / 2 };
      });
    },
    []
  );

  const rotate = useCallback(() => {
    setPlacement((p) => (p ? { ...p, rotation: (p.rotation + 90) % 360 } : p));
  }, []);

  // Keyboard shortcuts work whatever board control has focus.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = target.tagName === "INPUT" && ["x-field", "y-field", "rotation-field"].includes(target.id);
      if (!placementRef.current) return;
      if (inField && e.key !== "Enter") return;
      switch (e.key) {
        case "ArrowLeft":
          if (inField) return;
          e.preventDefault();
          moveBy(-0.5, 0);
          break;
        case "ArrowRight":
          if (inField) return;
          e.preventDefault();
          moveBy(0.5, 0);
          break;
        case "ArrowUp":
          if (inField) return;
          e.preventDefault();
          moveBy(0, -0.5);
          break;
        case "ArrowDown":
          if (inField) return;
          e.preventDefault();
          moveBy(0, 0.5);
          break;
        case "r":
        case "R":
          if (inField) return;
          e.preventDefault();
          rotate();
          break;
        case "Enter":
          if (inField) {
            // In the X, Y and Rotation fields Enter commits the typed value;
            // the onChange handler has already moved the footprint there.
            e.preventDefault();
            return;
          }
          if (target.tagName !== "BUTTON" || target.id === "place-btn") {
            e.preventDefault();
            void placePiece();
          }
          break;
        case "Escape":
          cancelPlacement();
          break;
        case "Delete":
          if (target.tagName !== "INPUT") {
            e.preventDefault();
            void removeFromShelf();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const cancelPlacement = () => {
    setPlacement(null);
  };

  const pickPiece = async (piece: Piece) => {
    // First clear position: scan rows top to bottom, left to right.
    const dims =
      piece.shape === "rectangular"
        ? { w: Number(piece.sides_in.length), h: Number(piece.sides_in.width) }
        : { w: Number(piece.sides_in.diameter), h: Number(piece.sides_in.diameter) };
    const placedFps: PreviewFootprint[] = currentLayerPlacements.map((p) => ({
      shape: p.shape,
      x: Number(p.x),
      y: Number(p.y),
      w: Number(p.width_in),
      h: Number(p.depth_in)
    }));
    let start = { x: 0, y: 0 };
    let found = false;
    for (let y = 0; y <= SHELF && !found; y += 0.5) {
      for (let x = 0; x <= SHELF && !found; x += 0.5) {
        const b = bounds(piece.shape, 0, dims);
        const fp: PreviewFootprint = { shape: piece.shape, x, y, w: b.w, h: b.h };
        if (!pastEdge(fp) && !POSTS.some((post) => meetsPost(fp, post)) && !placedFps.some((o) => overlaps(fp, o))) {
          start = { x, y };
          found = true;
        }
      }
    }
    setPlacement({ pieceNumber: piece.number, x: start.x, y: start.y, rotation: 0, layer, lifted: true, isMove: false });
    requestAnimationFrame(() => {
      document.getElementById("placement-heading")?.focus();
    });
  };

  const openPlacedPiece = (pieceNumberValue: number) => {
    const l = firing?.layers.find((ly) => ly.placements.some((p) => p.piece_number === pieceNumberValue));
    const p = l?.placements.find((pp) => pp.piece_number === pieceNumberValue);
    if (!l || !p) return;
    setLayer(l.layer);
    setPlacement({ pieceNumber: pieceNumberValue, x: Number(p.x), y: Number(p.y), rotation: p.rotation, layer: l.layer, lifted: true, isMove: true });
    requestAnimationFrame(() => {
      document.getElementById("placement-heading")?.focus();
    });
  };

  const placePiece = async () => {
    const p = placementRef.current;
    if (!p || !firing) return;
    if (collision) {
      setAnnounce(`Not placed: ${collision}.`);
      return;
    }
    try {
      const res = p.isMove
        ? await api.patch<{ fill_percent: number }>(`/api/firings/${firing.id}/placements/${p.pieceNumber}`, {
            layer: p.layer,
            x: p.x,
            y: p.y,
            rotation: p.rotation
          })
        : await api.post<{ fill_percent: number }>(`/api/firings/${firing.id}/placements`, {
            piece_number: p.pieceNumber,
            layer: p.layer,
            x: p.x,
            y: p.y,
            rotation: p.rotation
          });
      setAnnounce(`Placed Piece ${pieceNumber(p.pieceNumber)} on layer ${p.layer}. Load ${res.fill_percent}% full.`);
      setPlacement(null);
      await loadBoard();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "placement_refused") {
          setAnnounce(`Not placed: ${err.message}.`);
        } else {
          setAnnounce(`Not placed: ${err.message}.`);
        }
      } else {
        setAnnounce("Not saved — the studio server is unreachable.");
      }
    }
  };

  const removeFromShelf = async () => {
    const p = placementRef.current;
    if (!p || !firing) return;
    try {
      const res = await api.del<{ fill_percent: number }>(`/api/firings/${firing.id}/placements/${p.pieceNumber}`);
      setAnnounce(`Removed Piece ${pieceNumber(p.pieceNumber)} from layer ${p.layer}. Load ${res.fill_percent}% full.`);
      setPlacement(null);
      await loadBoard();
    } catch {
      setAnnounce("Not saved — the studio server is unreachable.");
    }
  };

  const createFiring = async () => {
    const kiln = kilns.find((k) => k.id === selectedKiln);
    if (!kiln || newProfileId === "") return;
    setFiringResult("Creating firing…");
    try {
      const f = await api.post<Firing>("/api/firings", { kiln_id: kiln.id, profile_id: Number(newProfileId) });
      setFiringResult(`Firing created with ${f.profile.name}.`);
      setShowNewFiring(false);
      await loadBoard();
    } catch (err) {
      setFiringResult(err instanceof ApiError && err.code === "kiln_busy" ? "This kiln already has a firing in progress." : "Something went wrong.");
    }
  };

  const startFiring = async () => {
    if (!firing) return;
    setFiringResult("Starting firing…");
    try {
      const f = await api.post<Firing>(`/api/firings/${firing.id}/start`);
      setFiringResult(`Firing started. Unload opens ${f.cool_until_label}.`);
      await loadBoard();
    } catch (err) {
      setFiringResult(err instanceof ApiError && err.code === "empty_load" ? "Place at least one piece before starting." : "Something went wrong.");
    }
  };

  const unload = async () => {
    if (!firing) return;
    const damage =
      damagePiece !== null && damagePhotoId
        ? [{ piece_number: damagePiece, kind: damageKind, photo_id: damagePhotoId, note: damageNote || null }]
        : [];
    setFiringResult("Unloading…");
    try {
      await api.post(`/api/firings/${firing.id}/unload`, {
        pickup_shelf: pickupShelf,
        damage
      });
      setFiringResult("Firing unloaded. Pickup notices are on their way.");
      setShowUnload(false);
      setDamagePiece(null);
      setDamagePhotoId(null);
      setDamagePhotoState("idle");
      setDamageNote("");
      await loadBoard();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "kiln_not_cool") {
          setFiringResult(err.message === "Kiln still firing" ? "Kiln still firing" : "Kiln still cooling");
        } else if (err.status === 422 && err.fields?.pickup_shelf) {
          setFiringResult("Enter a pickup shelf");
        } else {
          setFiringResult(err.message);
        }
      } else {
        setFiringResult("Something went wrong.");
      }
    }
  };

  const unloadEnabled = firing?.status === "unloadable";
  const placedInFiring = useMemo(() => {
    if (!firing) return new Set<number>();
    return new Set(firing.layers.flatMap((l) => l.placements.map((p) => p.piece_number)));
  }, [firing]);

  // SVG geometry: 23in square, circle shelf centred.
  const px = (v: number): number => v * scale;
  const gridLines: React.ReactElement[] = [];
  for (let i = 0; i <= SHELF; i += 0.5) {
    const strong = i % 5 === 0;
    gridLines.push(
      <line key={`h${i}`} x1={0} y1={px(i)} x2={px(SHELF)} y2={px(i)} stroke="rgba(75,56,38,0.12)" strokeWidth={strong ? 1 : 0.4} />
    );
    gridLines.push(
      <line key={`v${i}`} x1={px(i)} y1={0} x2={px(i)} y2={px(SHELF)} stroke="rgba(75,56,38,0.12)" strokeWidth={strong ? 1 : 0.4} />
    );
  }

  return (
    <main>
      <h1>Load board</h1>
      <div className="board">
        {narrow ? (
          <div className="pane" style={{ padding: "0.6rem 0.9rem" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="kiln-select">Kiln</label>
              <select
                id="kiln-select"
                aria-label="Kiln"
                value={selectedKiln}
                onChange={(e) => {
                  setSelectedKiln(e.target.value);
                  setLayer(1);
                }}
              >
                {kilns.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <nav className="pane kiln-rail" aria-label="Kilns">
            {kilns.map((k) => (
              <a
                key={k.id}
                href={`#kiln-${k.id}`}
                className={k.id === selectedKiln ? "active" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  setSelectedKiln(k.id);
                  setLayer(1);
                }}
              >
                <strong>{k.name}</strong>
                <span className="small-note">
                  {k.current_firing_id ? (firing && firing.id === k.current_firing_id ? firing.status_label : "Load in progress") : "No current firing"}
                </span>
              </a>
            ))}
          </nav>
        )}

        <div>
          <div className="pane shelf-pane">
            <div className="firing-strip" style={{ justifyContent: "space-between" }}>
              <div role="tablist" aria-label="Layers" style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                {firing
                  ? firing.layers.map((l) => (
                      <button
                        key={l.layer}
                        role="tab"
                        aria-selected={l.layer === layer}
                        onClick={() => setLayer(l.layer)}
                        style={{ minHeight: 44, minWidth: 44, padding: "0.35rem 0.7rem" }}
                      >
                        Layer {l.layer}
                      </button>
                    ))
                  : null}
              </div>
              <div>
                {narrow ? (
                  <div className="field-row" style={{ gap: "0.4rem" }}>
                    <button onClick={() => setLayer((l) => Math.max(1, l - 1))}>Previous layer</button>
                    <span className="num" aria-live="polite">
                      Layer {layer} of {layerCount}
                    </span>
                    <button onClick={() => setLayer((l) => Math.min(layerCount, l + 1))}>Next layer</button>
                  </div>
                ) : null}
                <p className="num">
                  {currentLayer?.height_in ? `Layer height ${currentLayer.height_in} in` : "Layer empty"}
                </p>
                <FillMeter fill={firing?.fill_percent ?? 0} animate={!reduced} />
              </div>
            </div>
            <div ref={svgWrapRef} style={{ width: "100%", position: "relative" }}>
              <svg
                className="shelf-svg"
                width={svgSize}
                height={svgSize}
                viewBox={`0 0 ${px(SHELF)} ${px(SHELF)}`}
                role="group"
                aria-label={`Shelf layer ${layer}`}
              >
                <circle cx={px(11.5)} cy={px(11.5)} r={px(11.5)} fill="var(--mat)" stroke="var(--ink-soft)" strokeWidth="1.5" />
                {gridLines}
                {POSTS.map((p, i) => (
                  <rect key={i} x={px(p.x)} y={px(p.y)} width={px(p.size)} height={px(p.size)} fill="var(--ink-soft)" opacity={0.7} />
                ))}
                {currentLayerPlacements.map((p) => {
                  const isLifted = placement?.isMove && placement.pieceNumber === p.piece_number;
                  if (isLifted) return null;
                  return (
                    <g key={p.piece_number}>
                      {p.shape === "rectangular" ? (
                        <rect
                          x={px(Number(p.x))}
                          y={px(Number(p.y))}
                          width={px(Number(p.width_in))}
                          height={px(Number(p.depth_in))}
                          fill="rgba(93,127,95,0.35)"
                          stroke="var(--green-deep)"
                          strokeWidth="1.5"
                          rx={2}
                          className="motion-settle"
                        />
                      ) : (
                        <circle
                          cx={px(Number(p.x) + Number(p.width_in) / 2)}
                          cy={px(Number(p.y) + Number(p.depth_in) / 2)}
                          r={px(Number(p.width_in) / 2)}
                          fill="rgba(93,127,95,0.35)"
                          stroke="var(--green-deep)"
                          strokeWidth="1.5"
                          className="motion-settle"
                        />
                      )}
                    </g>
                  );
                })}
                {liftedFootprint ? (
                  <g className={reduced ? "" : "motion-step"} style={{ filter: "drop-shadow(0 3px 4px rgba(51,36,21,0.4))" }}>
                    {liftedFootprint.shape === "rectangular" ? (
                      <rect
                        x={px(liftedFootprint.x)}
                        y={px(liftedFootprint.y)}
                        width={px(liftedFootprint.w)}
                        height={px(liftedFootprint.h)}
                        fill={collision ? "url(#hatch)" : "rgba(178,84,43,0.25)"}
                        stroke={collision ? "var(--hazard)" : "var(--ink-strong)"}
                        strokeWidth="2"
                        strokeDasharray={collision ? "6 4" : undefined}
                        rx={2}
                      />
                    ) : (
                      <circle
                        cx={px(liftedFootprint.x + liftedFootprint.w / 2)}
                        cy={px(liftedFootprint.y + liftedFootprint.h / 2)}
                        r={px(liftedFootprint.w / 2)}
                        fill={collision ? "url(#hatch)" : "rgba(178,84,43,0.25)"}
                        stroke={collision ? "var(--hazard)" : "var(--ink-strong)"}
                        strokeWidth="2"
                        strokeDasharray={collision ? "6 4" : undefined}
                      />
                    )}
                    <defs>
                      <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <rect width="6" height="6" fill="rgba(124,35,32,0.18)" />
                        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--hazard)" strokeWidth="2" />
                      </pattern>
                    </defs>
                  </g>
                ) : null}
              </svg>
            </div>
            {currentLayerPlacements.map((p) => {
              const isLifted = placement?.isMove && placement.pieceNumber === p.piece_number;
              if (isLifted) return null;
              const round = p.shape !== "rectangular";
              return (
                <button
                  key={p.piece_number}
                  className="footprint-btn"
                  aria-label={`Placed Piece ${pieceNumber(p.piece_number)}`}
                  title={`Placed Piece ${pieceNumber(p.piece_number)}`}
                  onClick={() => openPlacedPiece(p.piece_number)}
                  style={{
                    position: "absolute",
                    left: px(Number(p.x)),
                    top: px(Number(p.y)),
                    width: px(Number(p.width_in)),
                    height: px(Number(p.depth_in)),
                    minHeight: 0,
                    minWidth: 0,
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: round ? "50%" : 3
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "0.72rem",
                      lineHeight: 1,
                      color: "var(--ink-strong)",
                      background: "var(--pane)",
                      border: "1px solid var(--rule)",
                      borderRadius: 4,
                      padding: "1px 4px",
                      pointerEvents: "none"
                    }}
                  >
                    {pieceNumber(p.piece_number)}
                  </span>
                </button>
              );
            })}

            <div className="firing-strip" style={{ borderTop: "1px solid var(--rule)" }}>
              <div role="status" aria-live="polite" aria-label="Firing status">
                {firing ? (
                  <span>
                    {firing.status_label}
                    {firing.status === "firing" || firing.status === "cooling" || firing.status === "unloadable" ? (
                      <>
                        {" "}· Firing ends <span className="num">{firing.firing_ends_at_label}</span>
                        {" "}· Unload opens <span className="num">{firing.cool_until_label}</span>
                      </>
                    ) : null}
                  </span>
                ) : (
                  <span>No current firing.</span>
                )}
              </div>
              <div className="field-row">
                <button onClick={() => { setShowNewFiring(true); setNewProfileId(kiln?.profiles[0]?.id ?? ""); }} disabled={!!firing}>
                  New firing
                </button>
                <button className="primary" onClick={() => void startFiring()} disabled={!firing || firing.status !== "building"}>
                  Start firing
                </button>
                <button
                  onClick={() => { setShowUnload(true); setPickupShelf(""); }}
                  aria-disabled={!unloadEnabled}
                  disabled={!unloadEnabled}
                >
                  Unload
                </button>
              </div>
              {firing && !unloadEnabled ? (
                <span className="small-note">
                  {firing.status === "cooling" ? "Kiln still cooling" : firing.status === "firing" ? "Kiln still firing" : ""}{" "}
                  {firing.cool_until_label ? <>Unload opens <span className="num">{firing.cool_until_label}</span></> : null}
                </span>
              ) : null}
              {refreshNote ? <span className="small-note hazard">Board not refreshed — retrying.</span> : null}
              <div role="status" aria-live="polite" className="status-line" aria-label="Firing result" style={{ width: "100%" }}>
                {firingResult ? <span>{firingResult}</span> : <span className="sr-only">Firing result</span>}
              </div>
            </div>
          </div>

          {placement ? (
            <div className="placement-panel" role="region" aria-label="Placement" style={{ marginTop: "1rem" }}>
              <h3 id="placement-heading" tabIndex={-1}>
                Placing Piece <span className="num">{pieceNumber(placement.pieceNumber)}</span>
              </h3>
              <p className={collision ? "hazard status-line" : "ok status-line"} role="status">
                {collision ?? "Position clear"}
              </p>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="x-field">X (in)</label>
                  <input
                    id="x-field"
                    type="number"
                    step="0.5"
                    min="0"
                    max="23"
                    value={placement.x}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setPlacement((p) => (p ? { ...p, x: Number.isFinite(v) ? v : p.x } : p));
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="y-field">Y (in)</label>
                  <input
                    id="y-field"
                    type="number"
                    step="0.5"
                    min="0"
                    max="23"
                    value={placement.y}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setPlacement((p) => (p ? { ...p, y: Number.isFinite(v) ? v : p.y } : p));
                    }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="rotation-field">Rotation (degrees)</label>
                  <input
                    id="rotation-field"
                    type="number"
                    step="90"
                    min="0"
                    max="270"
                    value={placement.rotation}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setPlacement((p) => (p ? { ...p, rotation: Number.isFinite(v) ? v : p.rotation } : p));
                    }}
                  />
                </div>
              </div>
              <div className="field-row" style={{ flexWrap: "wrap" }}>
                <button onClick={() => moveBy(-0.5, 0)} aria-label="Move left">← Move left</button>
                <button onClick={() => moveBy(0.5, 0)} aria-label="Move right">Move right →</button>
                <button onClick={() => moveBy(0, -0.5)} aria-label="Move up">↑ Move up</button>
                <button onClick={() => moveBy(0, 0.5)} aria-label="Move down">Move down ↓</button>
                <button onClick={rotate}>Rotate</button>
              </div>
              <div className="field-row" style={{ marginTop: "0.6rem" }}>
                <button id="place-btn" className="primary" onClick={() => void placePiece()}>
                  Place
                </button>
                <button onClick={cancelPlacement}>Cancel</button>
                {placement.isMove ? (
                  <button className="danger" onClick={() => void removeFromShelf()}>
                    Remove from shelf
                  </button>
                ) : null}
              </div>
              <div role="status" aria-live="polite" className="status-line" aria-label="Shelf announcements" style={{ marginTop: "0.5rem" }}>
                {announce ? <span className={announce.startsWith("Not") ? "hazard" : "ok"}>{announce}</span> : <span className="sr-only">Shelf announcements</span>}
              </div>
            </div>
          ) : (
            <div role="status" aria-live="polite" className="status-line" aria-label="Shelf announcements" style={{ marginTop: "0.5rem" }}>
              {announce ? <span className={announce.startsWith("Not") ? "hazard" : "ok"}>{announce}</span> : <span className="sr-only">Shelf announcements</span>}
            </div>
          )}
        </div>

        <div className="pane">
          <h2>Queued pieces</h2>
          <ul aria-label="Queued pieces" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {queue
              .filter((p) => !placedInFiring.has(p.number) && !firing?.layers.some((l) => l.placements.some((pp) => pp.piece_number === p.number)))
              .map((p) => (
                <li key={p.number}>
                  <button className="stub" onClick={() => void pickPiece(p)}>
                    <strong className="num">Piece {pieceNumber(p.number)}</strong>
                    <span className="num small-note" style={{ display: "block" }}>
                      {p.sides_in.length && p.sides_in.width
                        ? `${p.sides_in.length} × ${p.sides_in.width} × ${p.sides_in.height} in`
                        : `${p.sides_in.diameter} × ${p.sides_in.height} in`}{" "}
                      · {cents(p.fee_cents)}
                    </span>
                    <span className="small-note" style={{ display: "block" }}>
                      {(p.plan === "glaze_only" ? "glaze" : p.stage ?? "bisque") === "bisque" ? "Bisque" : "Glaze"} · Cone {p.cone ?? "—"}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
          {queue.length === 0 ? <p>Nothing in the queue.</p> : null}
        </div>
      </div>

      {showNewFiring ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="dialog" aria-modal="true" aria-label="New firing">
            <h2>New firing</h2>
            <div className="field">
              <label htmlFor="profile-select">Profile</label>
              <select
                id="profile-select"
                value={newProfileId}
                onChange={(e) => setNewProfileId(Number(e.target.value))}
                autoFocus
              >
                {(kiln?.profiles ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <button className="primary" onClick={() => void createFiring()}>
                Create firing
              </button>
              <button onClick={() => setShowNewFiring(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      {showUnload ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="dialog" aria-modal="true" aria-label="Unload firing">
            <h2>Unload firing</h2>
            <div className="field">
              <label htmlFor="pickup-shelf">Pickup shelf</label>
              <input
                id="pickup-shelf"
                value={pickupShelf}
                onChange={(e) => setPickupShelf(e.target.value.toUpperCase())}
                autoFocus
              />
            </div>
            {(firing?.layers.flatMap((l) => l.placements) ?? []).map((p) => (
              <div key={p.piece_number} className="hairline-row" style={{ padding: "0.6rem 0" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={damagePiece === p.piece_number}
                    onChange={(e) => setDamagePiece(e.target.checked ? p.piece_number : null)}
                    aria-label={`Report damage on Piece ${pieceNumber(p.piece_number)}`}
                  />
                  Report damage on Piece <span className="num">{pieceNumber(p.piece_number)}</span>
                </label>
              </div>
            ))}
            {damagePiece !== null ? (
              <div className="pane" style={{ marginTop: "0.6rem" }}>
                <div className="field-row" role="radiogroup" aria-label="Damage kind">
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                    <input type="radio" name="damage-kind" value="glaze_run" checked={damageKind === "glaze_run"} onChange={() => setDamageKind("glaze_run")} />
                    Glaze run
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                    <input type="radio" name="damage-kind" value="crack" checked={damageKind === "crack"} onChange={() => setDamageKind("crack")} />
                    Crack
                  </label>
                </div>
                <div className="field">
                  <label htmlFor="damage-photo">Damage photo for Piece {pieceNumber(damagePiece)}</label>
                  <input
                    id="damage-photo"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic"
                    capture="environment"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setDamagePhotoState("uploading");
                      const form = new FormData();
                      form.append("photo", file);
                      try {
                        const res = await api.upload<{ photo_id: string }>("/api/photos", form);
                        setDamagePhotoId(res.photo_id);
                        setDamagePhotoState("attached");
                      } catch {
                        setDamagePhotoState("idle");
                      }
                    }}
                  />
                  <div role="status" aria-live="polite" className="status-line" aria-label="Photo upload">
                    {damagePhotoState === "uploading" ? "Uploading photo…" : damagePhotoState === "attached" ? "Photo attached" : ""}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="damage-note">Damage note</label>
                  <textarea id="damage-note" rows={2} value={damageNote} onChange={(e) => setDamageNote(e.target.value)} style={{ minHeight: 44 }} />
                </div>
              </div>
            ) : null}
            <div className="field-row" style={{ marginTop: "0.8rem" }}>
              <button className="primary" onClick={() => void unload()}>
                Confirm unload
              </button>
              <button onClick={() => setShowUnload(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
