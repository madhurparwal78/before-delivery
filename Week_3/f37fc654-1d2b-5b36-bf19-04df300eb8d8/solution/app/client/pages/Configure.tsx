// `/c/<commission id>/configure` — place every required piece in a to-scale plan of the room, choose
// size and extras, and watch the quote recount from the server's reply to the latest choice.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ADD_ONS, GRID_M, SIZES, TURN_DEG, type AddOn, type Size } from "../../shared/catalog";
import { metres, usd } from "../../shared/format";
import { Icon } from "../components/icons";
import { HttpError, call } from "../lib/api";
import { prefersReduced, useReducedMotion } from "../lib/motion";
import { toast } from "../lib/notices";
import { Failed, Missing, Skeleton, failureText, useLoad, useScene, type Commission, type LayoutItem, type Piece } from "./common";
import type { StoredFile } from "./Files";

const snap = (v: number): number => Math.round(v / GRID_M) * GRID_M;

/** A top-down drawing of each piece inside its footprint (unit square, y down). */
const GLYPHS: Record<string, string> = {
  "camera-reactive-wall": "M0.04 0.5H0.96M0.5 0.2V0.8",
  "portrait-kiosk": "M0.2 0.2H0.8V0.8H0.2Z M0.35 0.5A0.15 0.15 0 1 0 0.65 0.5A0.15 0.15 0 1 0 0.35 0.5",
  "projection-room": "M0.5 0.15V0.85M0.15 0.5H0.85M0.5 0.5L0.9 0.1M0.5 0.5L0.1 0.1",
  "ambient-sound": "M0.25 0.5A0.25 0.25 0 1 0 0.75 0.5A0.25 0.25 0 1 0 0.25 0.5M0.42 0.5A0.08 0.08 0 1 0 0.58 0.5A0.08 0.08 0 1 0 0.42 0.5",
  "night-lighting": "M0.5 0.1V0.3M0.5 0.7V0.9M0.1 0.5H0.3M0.7 0.5H0.9M0.36 0.5A0.14 0.14 0 1 0 0.64 0.5A0.14 0.14 0 1 0 0.36 0.5",
  "photo-takeaway": "M0.15 0.3H0.85V0.7H0.15Z M0.3 0.5H0.7",
};
const CONFLICT = "This layout changed in another window. Showing the latest version.";

interface QuoteView { lines: { label: string; amountCents: number }[]; subtotalCents: number; taxCents: number; totalCents: number }

function useNarrow(): boolean {
  const query = matchMedia("(max-width: 767px)");
  const [narrow, setNarrow] = useState(query.matches);
  useEffect(() => {
    const onChange = (): void => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [query]);
  return narrow;
}

/** The amount with each changed digit rolling to its new value; the text is the final value at once. */
function RollingAmount({ cents }: { cents: number }) {
  const text = usd(cents);
  const previous = useRef(text);
  const box = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = text;
    if (before === text || prefersReduced() || !box.current) return;
    const spans = box.current.querySelectorAll<HTMLElement>(".digit");
    spans.forEach((span, i) => {
      const old = before[before.length - text.length + i];
      if (!old || old === text[i] || !/\d/.test(text[i])) return;
      span.setAttribute("data-from", old);
      span.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)" })
        .finished.then(() => span.removeAttribute("data-from"), () => undefined);
    });
  }, [text]);
  return <span ref={box} className="digits">{Array.from(text).map((ch, i) => <span key={`${text.length}-${i}`} className="digit">{ch}</span>)}</span>;
}

/** The top-down outline of the latest GLB model, as a polygon in the unit square, or null. */
async function glbOutline(fileId: string): Promise<[number, number][] | null> {
  const response = await fetch(`/api/files/${fileId}/content`, { credentials: "same-origin" });
  if (!response.ok) return null;
  const bytes = new DataView(await response.arrayBuffer());
  try {
    const jsonLength = bytes.getUint32(12, true);
    const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes.buffer, 20, jsonLength))) as {
      meshes?: { primitives: { attributes: { POSITION?: number } }[] }[];
      accessors?: { bufferView: number; count: number; byteOffset?: number }[];
      bufferViews?: { byteOffset?: number; byteStride?: number }[];
    };
    const accessorIndex = gltf.meshes?.[0]?.primitives[0]?.attributes.POSITION;
    if (accessorIndex === undefined || !gltf.accessors || !gltf.bufferViews) return null;
    const accessor = gltf.accessors[accessorIndex];
    const view = gltf.bufferViews[accessor.bufferView];
    const binStart = 20 + jsonLength + 8;
    const stride = view.byteStride ?? 12;
    const points: [number, number][] = [];
    for (let i = 0; i < accessor.count; i++) {
      const at = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * stride;
      points.push([bytes.getFloat32(at, true), bytes.getFloat32(at + 8, true)]);
    }
    if (points.length < 3) return null;
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o: number[], a: number[], b: number[]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (list: [number, number][]): [number, number][] => list.reduce<[number, number][]>((hull, p) => {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
      hull.push(p);
      return hull;
    }, []);
    const hull = [...half(points).slice(0, -1), ...half([...points].reverse()).slice(0, -1)];
    const xs = hull.map((p) => p[0]);
    const zs = hull.map((p) => p[1]);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    if (maxX - minX <= 0 || maxZ - minZ <= 0) return null;
    return hull.map(([x, z]) => [(x - minX) / (maxX - minX), (z - minZ) / (maxZ - minZ)]);
  } catch {
    return null;
  }
}

interface Frame { scale: number; ox: number; oy: number }

export function Configure({ id }: { id: string }) {
  const [load, reload] = useLoad<Commission>(`/api/commissions/${id}`);
  const [files] = useLoad<{ files: StoredFile[] }>(`/api/commissions/${id}/files`);
  const reduced = useReducedMotion();
  const narrow = useNarrow();
  const [items, setItems] = useState<LayoutItem[]>([]);
  const [saved, setSaved] = useState<LayoutItem[]>([]);
  const [version, setVersion] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [placement, setPlacement] = useState("");
  const [size, setSize] = useState<Size>("compact");
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [quoteStatus, setQuoteStatus] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [outline, setOutline] = useState<[number, number][] | null>(null);
  const [frame, setFrame] = useState<Frame>({ scale: 40, ox: 0, oy: 0 });
  const roomRef = useRef<HTMLElement>(null);
  const pieceRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const previewSeq = useRef(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ kind: string; pointer: number; startX: number; startY: number; fromX: number; fromY: number; samples: { x: number; y: number; t: number }[] } | null>(null);
  const motionRaf = useRef(0);
  const c = load.status === "ready" ? load.data : null;
  useScene("configurator", c ? { roomW: c.room.widthM, roomD: c.room.depthM, silhouette: c.installationType } : {});

  useEffect(() => {
    if (!c) return;
    setItems(c.layout.items);
    setSaved(c.layout.items);
    setVersion(c.layout.version);
    setSize(c.options.size);
    setAddOns(c.options.addOns);
    setQuote(c.quote);
  }, [c]);

  useEffect(() => {
    const glb = files.status === "ready" ? files.data.files.filter((f) => f.kind === "installation_glb").pop() : undefined;
    if (glb) void glbOutline(glb.id).then(setOutline);
  }, [files]);

  // Fit the room into the scene area (above the open sheet on phones).
  useLayoutEffect(() => {
    const el = roomRef.current;
    if (!el || !c) return undefined;
    const fit = (): void => {
      const rect = el.getBoundingClientRect();
      const usableH = narrow && sheetOpen ? rect.height * 0.4 - (rect.top < 0 ? 0 : 0) : rect.height;
      const pad = 44;
      const scale = Math.max(8, Math.min((rect.width - pad * 2) / c.room.widthM, (usableH - pad * 2) / c.room.depthM));
      setFrame({ scale, ox: (rect.width - c.room.widthM * scale) / 2, oy: (usableH - c.room.depthM * scale) / 2 });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [c, narrow, sheetOpen]);

  const pieceOf = useCallback((kind: string): Piece | undefined => c?.requiredPieces.find((p) => p.kind === kind), [c]);

  const describe = (item: LayoutItem): string => `${pieceOf(item.kind)?.label ?? item.kind} at ${metres(item.x)} m, ${metres(item.y)} m, turned ${item.rotationDeg}°`;

  const drop = useCallback(async (next: LayoutItem[], kind: string) => {
    if (!c) return;
    try {
      const result = await call<{ version: number; items: LayoutItem[] }>(`/api/commissions/${c.id}/layout`, { method: "PUT", json: { version, items: next } });
      setVersion(result.version);
      setSaved(result.items);
      setItems(result.items);
      const placed = result.items.find((i) => i.kind === kind);
      if (placed) setPlacement(`Placed ${describe(placed)}.`);
      void reload();
    } catch (error) {
      if (error instanceof HttpError && error.status === 412) {
        const fresh = await call<Commission>(`/api/commissions/${c.id}`);
        setVersion(fresh.layout.version);
        setSaved(fresh.layout.items);
        setItems(fresh.layout.items);
        setPlacement(CONFLICT);
        return;
      }
      setItems(saved);
      setPlacement(error instanceof HttpError && error.status === 422 ? Object.values(error.errors)[0] ?? "" : failureText(error));
    }
  }, [c, version, saved, reload, pieceOf]);

  const move = (kind: string, change: (i: LayoutItem) => LayoutItem): LayoutItem[] => {
    const next = items.map((i) => (i.kind === kind ? change(i) : i));
    setItems(next);
    return next;
  };

  const place = (piece: Piece): void => {
    if (!c) return;
    const item = { kind: piece.kind, x: snap(c.room.widthM / 2), y: snap(c.room.depthM / 2), rotationDeg: 0 };
    setItems([...items.filter((i) => i.kind !== piece.kind), item]);
    setSelected(piece.kind);
    if (narrow) setSheetOpen(false);
    requestAnimationFrame(() => pieceRefs.current[piece.kind]?.focus());
  };

  const onRoomKey = (event: KeyboardEvent<HTMLElement>): void => {
    const kind = selected;
    if (!kind || !items.some((i) => i.kind === kind)) return;
    const step = event.shiftKey ? 1 : GRID_M;
    const turns: Record<string, number> = { r: TURN_DEG, R: -TURN_DEG };
    const deltas: Record<string, [number, number]> = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (event.key in deltas) {
      event.preventDefault();
      const [dx, dy] = deltas[event.key];
      move(kind, (i) => ({ ...i, x: snap(i.x + dx), y: snap(i.y + dy) }));
    } else if (event.key in turns) {
      event.preventDefault();
      move(kind, (i) => ({ ...i, rotationDeg: (((i.rotationDeg + (event.shiftKey ? -TURN_DEG : TURN_DEG)) % 360) + 360) % 360 }));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void drop(items, kind);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      const before = saved.find((i) => i.kind === kind);
      setItems(before ? items.map((i) => (i.kind === kind ? before : i)) : items.filter((i) => i.kind !== kind));
    }
  };

  const toScreen = (x: number, y: number): [number, number] => (c ? [frame.ox + x * frame.scale, frame.oy + (c.room.depthM - y) * frame.scale] : [0, 0]);

  const settleAndDrop = (kind: string, from: { x: number; y: number }, velocity: { x: number; y: number }): void => {
    if (!c) return;
    const piece = pieceOf(kind);
    const reach = piece ? Math.hypot(piece.widthM, piece.depthM) / 2 : 0.5;
    let pos = { ...from };
    let v = { ...velocity };
    let last = performance.now();
    const target = (): { x: number; y: number } => ({ x: snap(pos.x), y: snap(pos.y) });
    const finish = (): void => {
      const next = items.map((i) => (i.kind === kind ? { ...i, ...target() } : i));
      setItems(next);
      void drop(next, kind);
    };
    if (reduced || Math.hypot(v.x, v.y) <= 0.3) {
      pos = { ...from };
      finish();
      return;
    }
    let phase: "glide" | "spring" = "glide";
    let springFrom = { ...pos };
    let springStart = 0;
    const tick = (): void => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (phase === "glide") {
        pos = { x: pos.x + v.x * dt, y: pos.y + v.y * dt };
        const decay = 0.92 ** (dt * 60);
        v = { x: v.x * decay, y: v.y * decay };
        const hitWall = pos.x - reach < 0 || pos.x + reach > c.room.widthM || pos.y - reach < 0 || pos.y + reach > c.room.depthM;
        pos = { x: Math.min(c.room.widthM - reach, Math.max(reach, pos.x)), y: Math.min(c.room.depthM - reach, Math.max(reach, pos.y)) };
        if (hitWall || Math.hypot(v.x, v.y) < 0.05) {
          phase = "spring";
          springFrom = { ...pos };
          springStart = now;
        }
      } else {
        const t = (now - springStart) / 1000;
        const omega = 12;
        const k = (1 + omega * t) * Math.exp(-omega * t);
        const goal = target();
        pos = { x: goal.x + (springFrom.x - goal.x) * k, y: goal.y + (springFrom.y - goal.y) * k };
        if (t >= 0.5) {
          finish();
          return;
        }
      }
      setItems((list) => list.map((i) => (i.kind === kind ? { ...i, x: pos.x, y: pos.y } : i)));
      motionRaf.current = requestAnimationFrame(tick);
    };
    motionRaf.current = requestAnimationFrame(tick);
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, item: LayoutItem): void => {
    cancelAnimationFrame(motionRaf.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(item.kind);
    drag.current = { kind: item.kind, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, fromX: item.x, fromY: item.y, samples: [{ x: item.x, y: item.y, t: performance.now() }] };
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    const x = d.fromX + (event.clientX - d.startX) / frame.scale;
    const y = d.fromY - (event.clientY - d.startY) / frame.scale;
    d.samples = [...d.samples.slice(-5), { x, y, t: performance.now() }];
    setItems((list) => list.map((i) => (i.kind === d.kind ? { ...i, x, y } : i)));
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    drag.current = null;
    const last = d.samples[d.samples.length - 1];
    const first = d.samples[0];
    const moved = Math.hypot(last.x - d.fromX, last.y - d.fromY) > 0.01;
    if (!moved) return;
    const span = (last.t - first.t) / 1000;
    const velocity = span > 0.004 ? { x: (last.x - first.x) / span, y: (last.y - first.y) / span } : { x: 0, y: 0 };
    settleAndDrop(d.kind, { x: last.x, y: last.y }, velocity);
  };

  const preview = (nextSize: Size, nextAddOns: AddOn[]): void => {
    if (!c) return;
    setSize(nextSize);
    setAddOns(nextAddOns);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      const mine = ++previewSeq.current;
      void call<QuoteView>(`/api/commissions/${c.id}/quote-preview`, { json: { size: nextSize, addOns: nextAddOns } }).then((q) => {
        if (mine !== previewSeq.current) return;
        setQuote(q);
        setQuoteStatus(`Quote updated: ${usd(q.totalCents)} including tax.`);
      }, () => undefined);
    }, 250);
  };

  const saveQuote = async (): Promise<void> => {
    if (!c) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewSeq.current += 1;
    try {
      const result = await call<{ quote: QuoteView; layout: { version: number; items: LayoutItem[] } }>(`/api/commissions/${c.id}/options`, { method: "PUT", json: { size, addOns } });
      setQuote(result.quote);
      setVersion(result.layout.version);
      setSaved(result.layout.items);
      setItems(result.layout.items);
      setQuoteStatus(`Quote updated: ${usd(result.quote.totalCents)} including tax.`);
      void reload();
    } catch (error) {
      if (error instanceof HttpError && error.code === "options_locked") toast("Size and extras are locked at this stage of the commission.");
      else toast(failureText(error));
    }
  };

  useEffect(() => () => cancelAnimationFrame(motionRaf.current), []);

  useEffect(() => {
    if (!narrow || !sheetOpen) return undefined;
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && !(document.activeElement instanceof HTMLElement && document.activeElement.closest(".room"))) setSheetOpen(false);
    };
    addEventListener("keydown", onEscape);
    return () => removeEventListener("keydown", onEscape);
  }, [narrow, sheetOpen]);

  if (load.status === "missing") return <Missing />;
  if (load.status === "failed") return <Failed message={load.message} />;
  if (!c) return <main className="column"><Skeleton rows={4} /></main>;

  const required = c.requiredPieces;
  const unplaced = required.filter((p) => !items.some((i) => i.kind === p.kind));
  const door = (() => {
    const { widthM: w, depthM: d, doorWall } = c.room;
    if (doorWall === "front") return { gap: [[w / 2 - 0.6, 0], [w / 2 + 0.6, 0]], zone: [w / 2 - 0.6, 0, 1.2, 0.6] };
    if (doorWall === "back") return { gap: [[w / 2 - 0.6, d], [w / 2 + 0.6, d]], zone: [w / 2 - 0.6, d - 0.6, 1.2, 0.6] };
    if (doorWall === "left") return { gap: [[0, d / 2 - 0.6], [0, d / 2 + 0.6]], zone: [0, d / 2 - 0.6, 0.6, 1.2] };
    return { gap: [[w, d / 2 - 0.6], [w, d / 2 + 0.6]], zone: [w - 0.6, d / 2 - 0.6, 0.6, 1.2] };
  })();
  const [zx, zy, zw, zh] = door.zone;
  const zoneTopLeft = toScreen(zx, zy + zh);
  const gapA = toScreen(door.gap[0][0], door.gap[0][1]);
  const gapB = toScreen(door.gap[1][0], door.gap[1][1]);
  const corner = toScreen(0, c.room.depthM);

  const inspector = (
    <div className="inspector" hidden={narrow && !sheetOpen}>
      <div className="stack">
        <h2 style={{ fontSize: 21 }}>{c.title}</h2>
        <p className="muted">{c.room.widthM} × {c.room.depthM} m · door on the {c.room.doorWall} wall · {c.venue.name}</p>
      </div>
      <section className="stack" aria-labelledby="pieces-title">
        <h3 id="pieces-title">Pieces</h3>
        <ul className="list" aria-label="Pieces to place">
          {required.map((p) => (
            <li key={p.kind}>
              <div className="section-head">
                <span>{p.label} <span className="muted">{p.widthM} × {p.depthM} m</span></span>
                {unplaced.includes(p)
                  ? <button type="button" className="button" onClick={() => place(p)}>Place {p.label}</button>
                  : <span className="badge on">Placed</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <fieldset>
        <legend>Size</legend>
        <div role="radiogroup" aria-label="Size" className="stack" style={{ gap: 8 }}>
          {(Object.keys(SIZES) as Size[]).map((s) => (
            <label key={s} className="option">
              <input type="radio" name="size" value={s} checked={size === s} onChange={() => preview(s, addOns)} />
              <span>{SIZES[s].label}</span><span className="price">{SIZES[s].priceCents ? `+${usd(SIZES[s].priceCents)}` : "Included"}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Extras</legend>
        <div role="group" aria-label="Extras" className="stack" style={{ gap: 8 }}>
          {(Object.keys(ADD_ONS) as AddOn[]).map((a) => (
            <label key={a} className="option">
              <input type="checkbox" checked={addOns.includes(a)} onChange={() => preview(size, addOns.includes(a) ? addOns.filter((x) => x !== a) : (Object.keys(ADD_ONS) as AddOn[]).filter((x) => x === a || addOns.includes(x)))} />
              <span>{ADD_ONS[a].label}</span><span className="price">+{usd(ADD_ONS[a].priceCents)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <section role="region" aria-label="Quote" className="stack">
        <h3>Quote</h3>
        {quote && (
          <>
            <div className="quote-lines">{quote.lines.map((l) => <div key={l.label}><span>{l.label}</span><span>{usd(l.amountCents)}</span></div>)}</div>
            <div className="quote-total"><span>Total</span><RollingAmount cents={quote.totalCents} /></div>
          </>
        )}
        <p role="status" aria-label="Quote total" className="muted">{quoteStatus}</p>
        <button type="button" className="button primary" onClick={() => void saveQuote()}>Save quote</button>
      </section>
      <p role="status" aria-label="Placement status" className="status-line">{placement}</p>
    </div>
  );

  return (
    <main className="configure">
      <section ref={roomRef} role="region" aria-label="Room" className="room" onKeyDown={onRoomKey}>
        <svg className="plan" aria-hidden="true">
          <rect x={corner[0]} y={corner[1]} width={c.room.widthM * frame.scale} height={c.room.depthM * frame.scale} fill="rgba(10,14,24,0.78)" stroke="#ffffff" strokeWidth="3" />
          {Array.from({ length: Math.floor(c.room.widthM) - 1 }, (_, i) => {
            const [x] = toScreen(i + 1, 0);
            return <line key={`x${i}`} x1={x} x2={x} y1={corner[1]} y2={corner[1] + c.room.depthM * frame.scale} stroke="rgba(255,255,255,0.14)" />;
          })}
          {Array.from({ length: Math.floor(c.room.depthM) - 1 }, (_, i) => {
            const [, y] = toScreen(0, i + 1);
            return <line key={`y${i}`} x1={corner[0]} x2={corner[0] + c.room.widthM * frame.scale} y1={y} y2={y} stroke="rgba(255,255,255,0.14)" />;
          })}
          <rect x={zoneTopLeft[0]} y={zoneTopLeft[1]} width={zw * frame.scale} height={zh * frame.scale} fill="rgba(34,113,227,0.18)" stroke="#2271e3" strokeDasharray="4 4" />
          <line x1={gapA[0]} y1={gapA[1]} x2={gapB[0]} y2={gapB[1]} stroke="#0a0e18" strokeWidth="6" />
          <path d={`M${gapA[0]} ${gapA[1]} l${(gapB[1] - gapA[1]) / 3} ${(gapA[0] - gapB[0]) / 3}`} stroke="#2271e3" strokeWidth="2" />
          <path d={`M${gapB[0]} ${gapB[1]} l${(gapB[1] - gapA[1]) / 3} ${(gapA[0] - gapB[0]) / 3}`} stroke="#2271e3" strokeWidth="2" />
          <text x={(gapA[0] + gapB[0]) / 2} y={(gapA[1] + gapB[1]) / 2 + (c.room.doorWall === "front" ? 18 : -10)} fill="#a0a4ae" fontSize="12" textAnchor="middle">Door</text>
        </svg>
        {items.map((item) => {
          const piece = pieceOf(item.kind);
          if (!piece) return null;
          const [sx, sy] = toScreen(item.x, item.y);
          const w = piece.widthM * frame.scale;
          const h = piece.depthM * frame.scale;
          const box = Math.max(44, w, h);
          const main = item.kind === c.installationType;
          return (
            <button
              key={item.kind}
              ref={(el) => { pieceRefs.current[item.kind] = el; }}
              type="button"
              className="piece"
              aria-label={describe(item)}
              aria-pressed={selected === item.kind}
              style={{ left: sx - box / 2, top: sy - box / 2, width: box, height: box }}
              onFocus={() => setSelected(item.kind)}
              onClick={() => setSelected(item.kind)}
              onPointerDown={(e) => onPointerDown(e, item)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <span className="footprint" style={{ width: w, height: h, transform: `rotate(${-item.rotationDeg}deg)` }}>
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                  {main && outline
                    ? <polygon points={outline.map(([x, z]) => `${x},${z}`).join(" ")} fill="rgba(168,230,255,0.35)" stroke="#a8e6ff" strokeWidth="0.02" vectorEffect="non-scaling-stroke" />
                    : <path d={GLYPHS[item.kind]} fill="none" stroke="#a8e6ff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
                </svg>
              </span>
              <span className="piece-label" aria-hidden="true">{piece.label}</span>
            </button>
          );
        })}
        <p className="hint room-hint" aria-hidden="true">ARROWS move · SHIFT+ARROWS 1 m · R rotate · ENTER ↵ drop</p>
      </section>
      {narrow ? (
        <section role="region" aria-label="Inspector" className={`inspector-sheet ${sheetOpen ? "open" : ""}`}>
          <button type="button" className="button sheet-handle" aria-expanded={sheetOpen} onClick={() => setSheetOpen(!sheetOpen)}>
            <Icon name="grip" /> {sheetOpen ? "Hide inspector" : "Show inspector"}
          </button>
          {inspector}
        </section>
      ) : (
        <section role="region" aria-label="Inspector" className="inspector-wrap">{inspector}</section>
      )}
    </main>
  );
}
