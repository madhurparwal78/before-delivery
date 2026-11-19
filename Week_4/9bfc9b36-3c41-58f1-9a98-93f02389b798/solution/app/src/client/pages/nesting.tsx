/** The nesting screen: claim length, lay panels by keyboard, mouse or touch, watch the hold, cut. */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ApiError, getJson, sendJson } from "../api.js";
import { useLayout } from "../layout.js";
import { useLive } from "../live.js";
import { EASE, play, reducedMotion, useCountTo } from "../motion.js";
import { clockText, minutesSeconds } from "../format.js";
import { Chip, Dialog, DialogForm, SelectField, TextField, UnitPair, useCollection, useDialog, useLoad, usePoll, useSubmitter } from "../ui.js";
import { SailCanvas, outlinePoints } from "./sail.js";
import { useConfirmCut } from "./cutting.js";
import { PENDING, REFUSALS, SUCCESS } from "../../shared/copy.js";
import { outlineExtent, placeOutline } from "../../shared/geometry.js";
import { areaText, grouped, lengthParts, lengthText } from "../../shared/units.js";
import type { Claim, CutResult, Drawing, LayResult, Panel, Stock, StockSummary } from "../../shared/types.js";

export interface NestData {
  drawing: Drawing;
  claims: Claim[];
  stocks: Record<string, Stock>;
  summary: StockSummary;
}

export async function loadNest(code: string, signal: AbortSignal): Promise<NestData> {
  const drawing = await getJson<Drawing>(`/api/drawings/${code}`, signal);
  const claims = await Promise.all((drawing.claim_ids ?? []).map((id) => getJson<Claim>(`/api/claims/${id}`, signal)));
  const codes = [...new Set(claims.filter((claim) => claim.status === "held").map((claim) => claim.stock_code))];
  const [stocks, summary] = await Promise.all([
    Promise.all(codes.map((stockCode) => getJson<Stock>(`/api/stock/${stockCode}`, signal))),
    getJson<StockSummary>("/api/stock/summary", signal),
  ]);
  return { drawing, claims, stocks: Object.fromEntries(stocks.map((stock) => [stock.code, stock])), summary };
}

interface Ghost {
  x: number;
  y: number;
  rotation: 0 | 180;
}

const newestFirst = (a: Claim, b: Claim): number => (a.taken_at === b.taken_at ? (a.id < b.id ? 1 : -1) : a.taken_at < b.taken_at ? 1 : -1);

function clamp(ghost: Ghost, panel: Panel, claim: Claim, usable: number): Ghost {
  const maxX = Math.max(0, claim.length_mm - panel.length_mm);
  const maxY = Math.max(0, usable - panel.width_mm);
  return { ...ghost, x: Math.min(Math.max(ghost.x, 0), maxX), y: Math.min(Math.max(ghost.y, 0), maxY) };
}

// ---- the hold clock --------------------------------------------------------------------------

function useHoldClock(claim: Claim | null, onZero: () => void, onMinute: (claim: Claim) => void): number | null {
  const [, force] = useState(0);
  const arrival = useRef<{ id: string; seconds: number; at: number } | null>(null);
  const warned = useRef(new Set<string>());
  const before = useRef<{ id: string; value: number } | null>(null);
  const asked = useRef<string | null>(null);
  const zero = useRef(onZero);
  zero.current = onZero;
  const minute = useRef(onMinute);
  minute.current = onMinute;

  const id = claim?.id ?? null;
  const seconds = claim?.seconds_remaining ?? null;
  useEffect(() => {
    if (id === null || seconds === null) {
      arrival.current = null;
      return;
    }
    arrival.current = { id, seconds, at: performance.now() };
    before.current = { id, value: seconds };
    force((n) => n + 1);
  }, [id, seconds, claim?.expires_at]);

  const remainingNow = useCallback((): number | null => {
    const mark = arrival.current;
    if (!claim || !mark || mark.id !== claim.id) return claim ? claim.seconds_remaining : null;
    return Math.max(0, Math.ceil(mark.seconds - (performance.now() - mark.at) / 1000));
  }, [claim]);

  useEffect(() => {
    if (!claim) return;
    const timer = window.setInterval(() => {
      const remaining = remainingNow();
      if (remaining === null) return;
      const last = before.current;
      if (last && last.id === claim.id && last.value > 60 && remaining <= 60 && !warned.current.has(claim.id)) {
        warned.current.add(claim.id);
        minute.current(claim);
      }
      before.current = { id: claim.id, value: remaining };
      const stamp = `${claim.id}:${arrival.current?.at ?? 0}`;
      if (remaining === 0 && asked.current !== stamp) {
        asked.current = stamp;
        zero.current();
      }
      force((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [claim, remainingNow]);

  return claim ? remainingNow() : null;
}

/** The remaining length of the hold's roll at poster size, its on-hand area and the offcut count. */
export function RollRemaining({ figures, offcuts }: { figures: Stock | null; offcuts: number }) {
  const shown = useCountTo(figures?.after_laid_mm ?? 0, 320);
  return (
    <section role="region" aria-label="Roll remaining" className="remaining field-cobalt">
      <p className="poster-label">{figures ? `Remaining on ${figures.code}` : "Remaining"}</p>
      <p className="poster">{figures ? <UnitPair parts={lengthParts(shown)} stacked /> : "No hold"}</p>
      <dl className="figures">
        <div>
          <dt>On hand</dt>
          <dd>{areaText(figures?.on_hand_mm2 ?? 0)}</dd>
        </div>
        <div>
          <dt>Offcuts</dt>
          <dd>{offcuts}</dd>
        </div>
      </dl>
    </section>
  );
}

// ---- the claim dialog ------------------------------------------------------------------------

function ClaimDialogBody({ drawing, shelf, onClaimed }: { drawing: Drawing; shelf: Stock[]; onClaimed: (claim: Claim) => Promise<void> }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const options = useMemo(
    () =>
      shelf
        .filter((item) => item.cloth_code === drawing.cloth_code)
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
        .map((item) => ({ value: item.code, label: `${item.code} · lot ${item.lot}` })),
    [shelf, drawing.cloth_code],
  );
  const [code, setCode] = useState("");
  const [length, setLength] = useState("");
  const save = async () => {
    const created = await form.run(async () => {
      const { data } = await sendJson<Claim>("POST", "/api/claims", {
        stock_code: code || options[0]?.value,
        drawing_code: drawing.code,
        length_mm: length.trim() === "" ? undefined : Number(length),
      });
      say(SUCCESS.claim(grouped(data.length_mm), data.stock_code, clockText(data.expires_at)));
      close(true);
      await onClaimed(data);
    }, PENDING.claim);
    if (!created && Object.keys(form.errors).length === 0) close(true);
  };
  return (
    <DialogForm onSubmit={() => void save()} submit="Claim" busy={form.busy}>
      <SelectField label="Roll or offcut" value={code || options[0]?.value || ""} onChange={setCode} options={options} error={form.errors.stock_code} />
      <TextField label="Length (mm)" value={length} onChange={setLength} error={form.errors.length_mm} inputMode="numeric" />
    </DialogForm>
  );
}

// ---- the screen -------------------------------------------------------------------------------

export function Nesting({ code, onDrawing, onCut }: { code: string; onDrawing: (drawing: Drawing) => void; onCut: (result: CutResult) => void }) {
  const { say, refuse } = useLive();
  const layout = useLayout();
  const stamp = useRef(0);
  const applied = useRef(0);
  const latest = useRef<NestData | null>(null);
  const data = useLoad(async (signal) => {
    const mine = ++stamp.current;
    const result = await loadNest(code, signal);
    if (mine >= applied.current) {
      applied.current = mine;
      latest.current = result;
    }
    return result;
  }, [code]);
  const nest = data.data;
  const drawing = nest?.drawing ?? null;
  useEffect(() => {
    if (nest) onDrawing(nest.drawing);
  }, [nest, onDrawing]);

  const held = useMemo(() => (nest?.claims ?? []).filter((claim) => claim.status === "held").sort(newestFirst), [nest]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = held.find((claim) => claim.id === activeId) ?? held[0] ?? null;
  const stock = active && nest ? (nest.stocks[active.stock_code] ?? null) : null;
  const unlaid = useMemo(() => {
    if (!nest) return [] as Panel[];
    const laid = new Set(nest.claims.filter((claim) => claim.status === "held").flatMap((claim) => claim.lays.map((lay) => lay.panel_number)));
    return nest.drawing.panels.filter((panel) => !panel.cut && !laid.has(panel.number));
  }, [nest]);

  const [selected, setSelected] = useState<number | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [lapsed, setLapsed] = useState<string | null>(null);
  const [flying, setFlying] = useState<Set<number>>(new Set());
  const [figures, setFigures] = useState<Stock | null>(null);
  const [focusLay, setFocusLay] = useState(false);

  const regionRef = useRef<HTMLElement>(null);
  const stripBox = useRef<HTMLElement>(null);
  const stripSvg = useRef<SVGSVGElement>(null);
  const canvasBox = useRef<HTMLDivElement>(null);
  const layButton = useRef<HTMLButtonElement>(null);
  const claimButton = useRef<HTMLButtonElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const lastLaid = useRef<Record<string, number[]>>({});
  const flights = useRef(new Map<number, { abort: () => void; reverse: () => void }>());

  const cutting = useConfirmCut(code, onCut);
  const shelf = useCollection<Stock>("/api/stock", Number.POSITIVE_INFINITY);

  // the figures follow the data unless a panel is still travelling to the strip
  useEffect(() => {
    if (flights.current.size === 0) setFigures(stock);
  }, [stock]);
  useEffect(() => {
    if (!nest) return;
    for (const claim of nest.claims) lastLaid.current[claim.id] = claim.lays.map((lay) => lay.panel_number);
  }, [nest]);
  useEffect(() => {
    if (layout === "phone") setPhoneOpen(false);
  }, [layout]);
  // focus falls back into the region when the focused control (a laid panel's button) leaves it
  const focusInside = useRef(false);
  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    const entered = () => {
      focusInside.current = true;
    };
    const left = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && !region.contains(event.relatedTarget)) focusInside.current = false;
    };
    region.addEventListener("focusin", entered);
    region.addEventListener("focusout", left);
    return () => {
      region.removeEventListener("focusin", entered);
      region.removeEventListener("focusout", left);
    };
  }, [nest === null]);
  useEffect(() => {
    const region = regionRef.current;
    if (region && focusInside.current && (document.activeElement === document.body || document.activeElement === null)) region.focus({ preventScroll: true });
  });

  const selectedPanel = nest?.drawing.panels.find((panel) => panel.number === selected) ?? null;
  useEffect(() => {
    if (focusLay && selectedPanel) {
      layButton.current?.focus();
      setFocusLay(false);
    }
  }, [focusLay, selectedPanel]);

  const initialGhost = useCallback(
    (number: number, claim: Claim | null, usable: number): Ghost | null => {
      const panel = nest?.drawing.panels.find((item) => item.number === number);
      if (!panel || !claim) return null;
      const next = claim.next_positions.find((entry) => entry.panel_number === number);
      const start: Ghost = next && next.x_mm !== null && next.y_mm !== null && next.rotation !== null ? { x: next.x_mm, y: next.y_mm, rotation: next.rotation } : { x: 0, y: 0, rotation: 0 };
      return clamp(start, panel, claim, usable);
    },
    [nest],
  );

  const choose = useCallback(
    (number: number) => {
      setSelected(number);
      setGhost(initialGhost(number, active, stock?.usable_width_mm ?? 0));
      if (layout === "phone") {
        setPhoneOpen(false);
        setFocusLay(true);
      }
    },
    [active, initialGhost, layout, stock],
  );

  // clearing the selection when its panel is no longer unlaid (laid elsewhere, undone, lapsed)
  useEffect(() => {
    if (selected !== null && !unlaid.some((panel) => panel.number === selected) && !flying.has(selected)) {
      setSelected(null);
      setGhost(null);
    }
  }, [unlaid, selected, flying]);

  const refreshAll = useCallback(async (): Promise<NestData | null> => {
    const fresh = await data.reload();
    return fresh ?? latest.current;
  }, [data]);

  const handleLapse = useCallback(
    async (claimId: string) => {
      setLapsed(claimId);
      setSelected(null);
      setGhost(null);
      refuse(REFUSALS.claim_lapsed.message);
      await refreshAll();
      claimButton.current?.focus();
    },
    [refreshAll, refuse],
  );

  const checkHold = useCallback(async () => {
    if (!active) return;
    const claimId = active.id;
    const fresh = await getJson<Claim>(`/api/claims/${claimId}`);
    if (fresh.status === "lapsed") await handleLapse(claimId);
    else await refreshAll();
  }, [active, handleLapse, refreshAll]);

  /** The server may have lapsed, released or cut the hold already; a hold it still calls held leaves the countdown alone. */
  const watchHold = useCallback(async () => {
    if (!active) return;
    const fresh = await getJson<Claim>(`/api/claims/${active.id}`);
    if (fresh.status === "lapsed") await handleLapse(active.id);
    else if (fresh.status !== "held") await refreshAll();
  }, [active, handleLapse, refreshAll]);
  usePoll(() => void watchHold(), 5, active !== null);

  const remaining = useHoldClock(active, () => void checkHold(), (claim) => say(SUCCESS.oneMinute(claim.stock_code)));

  // ---- the thread: lift, travel, land -------------------------------------------------------

  const startFlight = (panel: Panel, position: Ghost) => {
    const source = canvasBox.current?.querySelector(`[data-panel="${panel.number}"] polygon`);
    const svg = stripSvg.current;
    const matrix = svg?.getScreenCTM();
    if (reducedMotion() || !source || !svg || !matrix) return null;
    const from = source.getBoundingClientRect();
    const box = outlineExtent(placeOutline(panel, position.x, position.y, position.rotation));
    const topLeft = new DOMPoint(box.minX, box.minY).matrixTransform(matrix);
    const bottomRight = new DOMPoint(box.maxX, box.maxY).matrixTransform(matrix);
    const scale = (bottomRight.x - topLeft.x) / Math.max(1, from.width);
    const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    overlay.setAttribute("viewBox", `0 0 ${panel.length_mm} ${panel.width_mm}`);
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("preserveAspectRatio", "none");
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    shape.setAttribute("points", outlinePoints(panel.outline));
    shape.setAttribute("fill", "#F5F0E6");
    shape.setAttribute("fill-opacity", "0.25");
    shape.setAttribute("stroke", "#F5F0E6");
    shape.setAttribute("stroke-width", "2");
    shape.setAttribute("vector-effect", "non-scaling-stroke");
    overlay.appendChild(shape);
    const style = overlay.style;
    style.position = "fixed";
    style.left = "0px";
    style.top = "0px";
    style.width = `${from.width}px`;
    style.height = `${from.height}px`;
    style.pointerEvents = "none";
    style.zIndex = "60";
    style.overflow = "visible";
    document.body.appendChild(overlay);
    const place = (rect: { x: number; y: number; width: number; height: number }, factor: number, rotate: number) =>
      `translate(${rect.x + rect.width / 2 - from.width / 2}px, ${rect.y + rect.height / 2 - from.height / 2}px) rotate(${rotate}deg) scale(${factor})`;
    const target = { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
    const start = place(from, 1, 0);
    const lifted = place(from, 1.03, 0);
    const lift = overlay.animate([{ transform: start }, { transform: lifted }], { duration: 120, easing: EASE, fill: "both" });
    const travel = overlay.animate([{ transform: lifted }, { transform: place(target, scale, position.rotation) }], { duration: 420, delay: 120, easing: EASE, fill: "both" });
    const fill = shape.animate([{ fillOpacity: 0.25 }, { fillOpacity: 1 }], { duration: 420, delay: 120, easing: EASE, fill: "both" });
    const finished = Promise.all([lift.finished, travel.finished, fill.finished]).then(
      () => true,
      () => false,
    );
    const remove = () => {
      lift.cancel();
      travel.cancel();
      fill.cancel();
      overlay.remove();
    };
    return {
      finished,
      abort: remove,
      reverse: () => {
        travel.reverse();
        fill.reverse();
        lift.reverse();
      },
      remove,
    };
  };

  const layAt = async (number: number, position: Ghost) => {
    const claim = active;
    const panel = nest?.drawing.panels.find((item) => item.number === number);
    if (!claim || !stock || !panel) return;
    refuse(null);
    say(PENDING.lay(number));
    const flight = startFlight(panel, position);
    setFlying((set) => new Set(set).add(number));
    if (flight) flights.current.set(number, { abort: flight.abort, reverse: flight.reverse });
    const settle = () => {
      flights.current.delete(number);
      setFlying((set) => {
        const next = new Set(set);
        next.delete(number);
        return next;
      });
    };
    try {
      const { data: result } = await sendJson<LayResult>("POST", `/api/claims/${claim.id}/lays`, {
        panel_number: number,
        x_mm: position.x,
        y_mm: position.y,
        rotation: position.rotation,
      });
      lastLaid.current[claim.id] = [...(lastLaid.current[claim.id] ?? []), number];
      say(SUCCESS.lay(number, result.stock.kind, result.stock.code, lengthText(result.stock.after_laid_mm)));
      setSelected(null);
      setGhost(null);
      const reloaded = refreshAll();
      if (flight) {
        await Promise.all([flight.finished, reloaded]);
        flight.remove();
        const stillLaid = latest.current?.claims.some((item) => item.id === claim.id && item.lays.some((lay) => lay.panel_number === number)) ?? false;
        settle();
        if (stillLaid) setFigures(latest.current?.stocks[result.stock.code] ?? result.stock);
      } else {
        await reloaded;
        settle();
      }
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (flight) {
        flight.reverse();
        void flight.finished.then(() => flight.remove());
      }
      settle();
      if (failure.code === "claim_lapsed") void handleLapse(claim.id);
      else if (failure.code !== "unauthenticated") refuse(failure.fields.position ?? failure.body.message);
    }
  };

  const undo = async () => {
    const claim = active;
    if (!claim) return;
    const number = (lastLaid.current[claim.id] ?? []).at(-1);
    if (number === undefined) return;
    refuse(null);
    flights.current.get(number)?.abort();
    lastLaid.current[claim.id] = (lastLaid.current[claim.id] ?? []).slice(0, -1);
    try {
      await sendJson<LayResult>("DELETE", `/api/claims/${claim.id}/lays/${number}`);
      say(SUCCESS.undo(number, stock?.kind ?? "roll", claim.stock_code));
      await refreshAll();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (failure.code === "claim_lapsed") void handleLapse(claim.id);
      else refuse(failure.body.message);
      await refreshAll();
    }
  };

  const release = async () => {
    const claim = active;
    if (!claim) return;
    refuse(null);
    try {
      await sendJson<Claim>("POST", `/api/claims/${claim.id}/release`);
      say(SUCCESS.release(claim.stock_code));
      setSelected(null);
      setGhost(null);
      await refreshAll();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      refuse(failure.body.message);
      await refreshAll();
    }
  };

  const move = (dx: number, dy: number) => {
    if (!selectedPanel || !active || !stock) return;
    setGhost((current) => (current ? clamp({ ...current, x: current.x + dx, y: current.y + dy }, selectedPanel, active, stock.usable_width_mm) : current));
  };

  const turn = () => {
    if (!selectedPanel || !active || !stock || !ghost) return;
    const rotation: 0 | 180 = ghost.rotation === 0 ? 180 : 0;
    setGhost(clamp({ ...ghost, rotation }, selectedPanel, active, stock.usable_width_mm));
    say(SUCCESS.turn(selectedPanel.number, rotation));
  };

  const layGhost = () => {
    if (selectedPanel && ghost) void layAt(selectedPanel.number, ghost);
  };

  // keys work anywhere inside the region except in a text field or an open dialog
  const actions = useRef({ move, turn, layGhost, undo });
  actions.current = { move, turn, layGhost, undo };
  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as Element | null;
      if (target?.closest("input, textarea, select, dialog, [contenteditable='true']")) return;
      const step = event.shiftKey ? 10 : 1;
      const handlers: Record<string, () => void> = {
        ArrowRight: () => actions.current.move(step, 0),
        ArrowLeft: () => actions.current.move(-step, 0),
        ArrowDown: () => actions.current.move(0, step),
        ArrowUp: () => actions.current.move(0, -step),
        r: () => actions.current.turn(),
        l: () => actions.current.layGhost(),
        u: () => void actions.current.undo(),
      };
      const handler = handlers[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    region.addEventListener("keydown", onKey);
    return () => region.removeEventListener("keydown", onKey);
  }, [nest === null]);

  // ---- touch and mouse dragging --------------------------------------------------------------

  const drag = useRef<{ kind: "panel" | "ghost"; panel: number; x: number; y: number; moved: boolean; grab: { x: number; y: number }; ghost: Ghost | null } | null>(null);
  const suppressClick = useRef(false);

  const stripPoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const box = stripBox.current?.getBoundingClientRect();
    const matrix = stripSvg.current?.getScreenCTM();
    if (!box || !matrix || !active || !stock) return null;
    if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: Math.min(Math.max(point.x, 0), active.length_mm), y: Math.min(Math.max(point.y, 0), stock.usable_width_mm) };
  };

  const beginPanelDrag = (event: ReactPointerEvent<Element>, number: number) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    drag.current = { kind: "panel", panel: number, x: event.clientX, y: event.clientY, moved: false, grab: { x: 0, y: 0 }, ghost: null };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const beginGhostDrag = (event: ReactPointerEvent<Element>) => {
    if (!selectedPanel || !ghost) return;
    const point = stripPoint(event.clientX, event.clientY);
    drag.current = { kind: "ghost", panel: selectedPanel.number, x: event.clientX, y: event.clientY, moved: true, grab: point ? { x: point.x - ghost.x, y: point.y - ghost.y } : { x: 0, y: 0 }, ghost };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<Element>) => {
    const current = drag.current;
    if (!current || !active || !stock) return;
    const panel = nest?.drawing.panels.find((item) => item.number === current.panel);
    if (!panel) return;
    if (!current.moved) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
      current.moved = true;
      setSelected(panel.number);
    }
    const point = stripPoint(event.clientX, event.clientY);
    if (!point) return;
    const rotation = (current.ghost ?? ghost)?.rotation ?? 0;
    const offset = current.kind === "ghost" ? current.grab : { x: panel.length_mm / 2, y: panel.width_mm / 2 };
    const next = clamp({ x: Math.round(point.x - offset.x), y: Math.round(point.y - offset.y), rotation }, panel, active, stock.usable_width_mm);
    current.ghost = next;
    setGhost(next);
  };

  const endDrag = (event: ReactPointerEvent<Element>) => {
    const current = drag.current;
    drag.current = null;
    if (!current || !current.moved) return;
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 0);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (current.kind === "panel" && current.ghost && stripPoint(event.clientX, event.clientY)) void layAt(current.panel, current.ghost);
  };

  const cancelDrag = () => {
    drag.current = null;
  };

  const dragProps = (number: number) => ({
    onPointerDown: (event: ReactPointerEvent<Element>) => beginPanelDrag(event, number),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: cancelDrag,
  });

  // ---- figures and meter ----------------------------------------------------------------------

  const ratio = figures && figures.remaining_mm > 0 ? figures.after_laid_mm / figures.remaining_mm : 0;
  const lastRatio = useRef(ratio);
  useEffect(() => {
    const element = meter.current;
    if (!element) return;
    const previous = lastRatio.current;
    lastRatio.current = ratio;
    element.style.transform = `scaleX(${ratio})`;
    if (previous !== ratio) play(element, [{ transform: `scaleX(${previous})` }, { transform: `scaleX(${ratio})` }], 320);
  }, [ratio]);

  // ---- render ---------------------------------------------------------------------------------

  if (!nest || !drawing) return <section role="region" aria-label="Nesting" className="nesting" />;
  const panels = drawing.panels;
  const laidHere = active?.lays ?? [];
  const lastPanel = (lastLaid.current[active?.id ?? ""] ?? []).at(-1);
  const hasUnlaid = unlaid.length > 0;
  const showList = layout !== "phone" || phoneOpen;

  return (
    <section role="region" aria-label="Nesting" className={`nesting nesting-${layout}`} ref={regionRef} tabIndex={-1}>
      <div className="nest-canvas field-cobalt" ref={canvasBox}>
        <SailCanvas
          panels={panels}
          label="Sail drawing"
          mode="nest"
          selected={selected}
          onSelect={(number) => {
            if (suppressClick.current) return;
            if (unlaid.some((panel) => panel.number === number)) choose(number);
          }}
          onPointerDown={(event, number) => {
            if (unlaid.some((panel) => panel.number === number)) beginPanelDrag(event, number);
          }}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
          dimmed={new Set(panels.filter((panel) => !unlaid.some((item) => item.number === panel.number)).map((panel) => panel.number))}
          hidden={flying}
        />
      </div>

      <div className="nest-list field-surface">
        {layout === "phone" ? (
          <button type="button" className="button" aria-expanded={phoneOpen} onClick={() => setPhoneOpen((open) => !open)}>
            {`Panels (${unlaid.length} unlaid)`}
          </button>
        ) : null}
        <ul aria-label="Panels" hidden={!showList} className="panel-list">
          {unlaid.map((panel) => (
            <li key={panel.number}>
              <button
                type="button"
                className="button panel-button"
                aria-pressed={selected === panel.number}
                onClick={() => {
                  if (suppressClick.current) return;
                  choose(panel.number);
                }}
                {...dragProps(panel.number)}
              >
                {`Panel ${panel.number}`}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="nest-controls field-ground">
        <SelectField
          label="Active hold"
          value={active?.id ?? ""}
          onChange={(value) => {
            setActiveId(value);
            setSelected(null);
            setGhost(null);
          }}
          options={held.length === 0 ? [{ value: "", label: "No hold yet" }] : held.map((claim) => ({ value: claim.id, label: `${claim.stock_code} · lot ${nest.stocks[claim.stock_code]?.lot ?? ""}` }))}
        />
        {active && remaining !== null ? (
          <p role="timer" aria-label="Hold" className="hold-timer">
            {`Hold ends in ${minutesSeconds(remaining)}`}
          </p>
        ) : lapsed ? (
          <p className="hold-timer">
            <Chip tone="ink">Lapsed</Chip>
          </p>
        ) : null}
        <div role="group" aria-label="Placement" className="readout">
          {selectedPanel && ghost
            ? `x ${lengthText(Math.round(ghost.x))} · y ${lengthText(Math.round(ghost.y))} · ${ghost.rotation}°`
            : "Select a panel to place it."}
        </div>
        <div className="button-row">
          <button type="button" className="button" onClick={turn} disabled={!selectedPanel}>
            Turn 180°
          </button>
          <button type="button" ref={layButton} className={`button ${hasUnlaid ? "primary" : ""}`} onClick={layGhost} disabled={!selectedPanel || !active}>
            Lay
          </button>
          <button type="button" className="button" onClick={() => void undo()} disabled={lastPanel === undefined}>
            Undo
          </button>
          <button type="button" ref={claimButton} className="button" onClick={() => setClaiming(true)}>
            Claim length
          </button>
          <button
            type="button"
            className={`button ${hasUnlaid ? "" : "primary"}`}
            aria-busy={cutting.busy || undefined}
            disabled={!active}
            onClick={() => {
              if (active) void cutting.confirm(active.id);
            }}
          >
            Confirm cut
          </button>
          <button type="button" className="button" onClick={() => void release()} disabled={!active}>
            Release hold
          </button>
        </div>
      </div>

      <section role="region" aria-label="Roll strip" className="roll-strip field-black" ref={stripBox}>
        {active && stock ? (
          <>
            <svg
              ref={stripSvg}
              viewBox={`0 0 ${active.length_mm} ${stock.usable_width_mm}`}
              className="strip-svg"
              preserveAspectRatio="xMinYMid meet"
              role="group"
              aria-label={`Hold on ${stock.code}`}
            >
              <rect x={0} y={0} width={active.length_mm} height={stock.usable_width_mm} className={stock.kind === "offcut" ? "cloth offcut" : "cloth"} />
              {laidHere.map((lay) => (
                <g key={lay.panel_number} role="img" aria-label={`Laid panel ${lay.panel_number}`} className={`laid${flying.has(lay.panel_number) ? " lifted" : ""}`}>
                  <polygon points={outlinePoints(lay.outline)} vectorEffect="non-scaling-stroke" />
                  <text
                    x={outlineExtent(lay.outline).minX + (outlineExtent(lay.outline).maxX - outlineExtent(lay.outline).minX) / 2}
                    y={outlineExtent(lay.outline).minY + (outlineExtent(lay.outline).maxY - outlineExtent(lay.outline).minY) / 2}
                    fontSize={stock.usable_width_mm * 0.28}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {lay.panel_number}
                  </text>
                </g>
              ))}
              {selectedPanel && ghost ? (
                <polygon
                  role="img"
                  aria-label={`Placement of panel ${selectedPanel.number}`}
                  className="ghost"
                  points={outlinePoints(placeOutline(selectedPanel, ghost.x, ghost.y, ghost.rotation))}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={beginGhostDrag}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={cancelDrag}
                />
              ) : null}
            </svg>
            <div className="meter" aria-hidden="true">
              <div className="meter-fill" ref={meter} />
            </div>
          </>
        ) : (
          <p className="strip-empty">Claim length on a roll or offcut to lay panels on it.</p>
        )}
      </section>

      <RollRemaining figures={figures} offcuts={nest.summary.offcuts} />

      {claiming && shelf.ready ? (
        <Dialog title="Claim length" onClose={() => setClaiming(false)}>
          <ClaimDialogBody
            drawing={drawing}
            shelf={shelf.items}
            onClaimed={async (claim) => {
              setActiveId(claim.id);
              setLapsed(null);
              await refreshAll();
            }}
          />
        </Dialog>
      ) : null}
    </section>
  );
}
