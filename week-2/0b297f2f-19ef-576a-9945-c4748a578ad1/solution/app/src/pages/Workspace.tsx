import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { request } from "../api";
import { say, VIEW_SENTENCE } from "../copy";
import { prefersReducedMotion, useLayout } from "../layout";
import { setQuery } from "../router";
import { SceneView, type SceneHandle } from "../scene/SceneView";
import type { WorkSpec } from "../scene/room";
import { isFailure, useStore } from "../store";
import { dialogOpen, focusWhenReady, isTextField, wrapTab } from "../ui/focus";
import { Shell } from "../ui/Shell";
import type { ObjectRecord, Photo, Placement, Undo, View } from "../types";
import { fieldFor, LuxDialog, PositionDialog, type PositionDraft, type PositionErrors } from "./dialogs";
import { Inspector } from "./Inspector";
import { Ledger } from "./Ledger";
import { mayMove, mayRemove } from "./permissions";
import { focusPreviewHeading, PreviewPanel } from "./PreviewPanel";
import { Rail, type RailActions } from "./Rail";
import { UndoToast, type ToastState } from "./UndoToast";

type Dialog =
  | { kind: "place"; object: ObjectRecord; opener: HTMLElement }
  | { kind: "details"; placementId: string; opener: HTMLElement; version: number }
  | { kind: "lux"; placementId: string; opener: HTMLElement };

interface Override {
  offsetMm: number;
  centreHeightMm: number;
  /** the placement version the move started from: a newer one on the server means someone else moved it */
  version: number;
}

const NUDGE_REST_MS = 500;
const VIEW_PARAM: Record<string, View> = { plan: "plan", wall: "wall", light: "light", "light-eye": "light" };

function handleFor(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-handle="${CSS.escape(id)}"]`);
}

function ledgerHeading(): HTMLElement | null {
  return document.getElementById("ledger-heading");
}

function cardPart(objectId: string, part: "heading" | string): HTMLElement | null {
  const card = document.querySelector<HTMLElement>(`[data-object-id="${CSS.escape(objectId)}"]`);
  if (!card) return null;
  return part === "heading" ? card.querySelector<HTMLElement>(".card-title") : card.querySelector<HTMLElement>(`[data-action="${part}"]`);
}

export function Workspace() {
  const store = useStore();
  const layout = useLayout();
  const reduced = useMemo(prefersReducedMotion, []);
  const initial = useMemo(() => new URLSearchParams(location.search), []);
  const [view, setView] = useState<View>(() => VIEW_PARAM[initial.get("view") ?? ""] ?? "plan");
  const viewRef = useRef(view);
  const [selectedId, setSelectedId] = useState<string | null>(initial.get("work"));
  const [railOpen, setRailOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastRef = useRef<ToastState | null>(null);
  toastRef.current = toast;
  const [undoBusy, setUndoBusy] = useState(false);
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
  const overridesRef = useRef(overrides);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const [uploading, setUploading] = useState<Set<string>>(new Set());
  const scene = useRef<SceneHandle>(null);
  const railButton = useRef<HTMLButtonElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const previewSheet = useRef<HTMLDivElement>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saving = useRef(new Set<string>());
  const resave = useRef(new Set<string>());

  const staff = store.staff;
  const unit = store.unit;
  const walls = useMemo(() => store.exhibition?.gallery.walls ?? [], [store.exhibition]);
  const placementsById = useMemo(() => new Map((store.placements ?? []).map((p) => [p.id, p])), [store.placements]);
  const placementsRef = useRef(placementsById);
  placementsRef.current = placementsById;
  const objectsRef = useRef(store.objects);
  objectsRef.current = store.objects;
  const staffRef = useRef(staff);
  staffRef.current = staff;
  const unitRef = useRef(unit);
  unitRef.current = unit;

  const rows = useMemo(() => {
    if (!store.placements) return null;
    const order = walls.map((w) => w.id);
    return store.placements
      .map((p) => {
        const o = overrides.get(p.id);
        return o ? { ...p, offsetMm: o.offsetMm, centreHeightMm: o.centreHeightMm } : p;
      })
      .sort((a, b) => order.indexOf(a.wallId) - order.indexOf(b.wallId) || a.offsetMm - b.offsetMm || a.id.localeCompare(b.id));
  }, [store.placements, overrides, walls]);

  const works = useMemo<WorkSpec[]>(
    () =>
      (rows ?? []).map((p) => ({
        id: p.id,
        title: p.objectTitle,
        wallId: p.wallId,
        offsetMm: p.offsetMm,
        centreHeightMm: p.centreHeightMm,
        widthMm: p.widthMm,
        heightMm: p.heightMm,
        luxStatus: p.luxStatus,
      })),
    [rows],
  );
  const selected = rows?.find((p) => p.id === selectedId) ?? null;
  const overCount = (store.placements ?? []).filter((p) => p.luxStatus === "over").length;

  const putOverride = (id: string, value: Override | null) => {
    const next = new Map(overridesRef.current);
    if (value) next.set(id, value);
    else next.delete(id);
    overridesRef.current = next;
    setOverrides(next);
  };

  const markPending = (key: string, on: boolean) => {
    if (on) pendingRef.current.add(key);
    else pendingRef.current.delete(key);
    setPending(new Set(pendingRef.current));
  };

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setQuery({ work: id });
  }, []);

  const chooseView = useCallback((next: View) => {
    if (next === viewRef.current) return;
    viewRef.current = next;
    setView(next);
    if (next === "light") setLegendOpen(false);
    scene.current?.setView(next);
  }, []);

  const onSettled = useCallback(
    (settledView: View) => {
      store.announce(VIEW_SENTENCE[settledView]);
      const param = settledView === "plan" ? null : settledView === "light" && scene.current?.eyeLevel() ? "light-eye" : settledView;
      setQuery({ view: param });
    },
    [store],
  );

  // Restore view, selection and panel from the address once the data is in (an instant cut).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !store.placements || !store.exhibition) return;
    restored.current = true;
    const work = initial.get("work");
    if (work && !store.placements.some((p) => p.id === work)) select(null);
    const param = initial.get("view") ?? "";
    if (VIEW_PARAM[param] && param !== "plan") scene.current?.restore(VIEW_PARAM[param], param === "wall" || param === "light-eye");
    else if (param) setQuery({ view: null });
    if (initial.get("panel") === "preview") {
      if (window.innerWidth < 600) setPreviewOpen(true);
      focusPreviewHeading();
    }
  }, [store.placements, store.exhibition, initial, select]);

  // A selected work that disappears leaves nothing selected.
  useEffect(() => {
    if (restored.current && selectedId && store.placements && !store.placements.some((p) => p.id === selectedId)) select(null);
  }, [store.placements, selectedId, select]);

  const showToast = (kind: "remove" | "move", undo: Undo, p: Placement) =>
    setToast({ actionId: undo.actionId, kind, title: p.objectTitle, placementId: p.id, deadline: performance.now() + undo.remainingMs });

  const saveMove = async (id: string, extra: Partial<PositionDraft> = {}): Promise<PositionErrors | null> => {
    if (saving.current.has(id)) {
      resave.current.add(id);
      return null;
    }
    const p = placementsRef.current.get(id);
    const o = overridesRef.current.get(id);
    if (!p) return null;
    const sent = o ?? { offsetMm: p.offsetMm, centreHeightMm: p.centreHeightMm, version: p.version };
    saving.current.add(id);
    try {
      const data = await request<{ placement: Placement; undo: Undo }>("PATCH", `/api/placements/${id}`, {
        version: sent.version,
        offsetMm: sent.offsetMm,
        centreHeightMm: sent.centreHeightMm,
        ...extra,
      });
      placementsRef.current.set(id, data.placement);
      store.putPlacement(data.placement);
      const now = overridesRef.current.get(id);
      if (!now || (now.offsetMm === sent.offsetMm && now.centreHeightMm === sent.centreHeightMm)) putOverride(id, null);
      else putOverride(id, { ...now, version: data.placement.version });
      store.announce(say.moved(data.placement.objectTitle, data.placement.offsetMm, unitRef.current));
      showToast("move", data.undo, data.placement);
      return null;
    } catch (failure) {
      putOverride(id, null);
      if (!isFailure(failure)) throw failure;
      const latest = failure.detail.placement;
      if (latest) {
        placementsRef.current.set(id, latest);
        store.putPlacement(latest);
        store.announce(say.stale(p.objectTitle));
        return null;
      }
      if (failure.status === 403 || failure.code === "placement_locked") {
        store.announce(say.notMovable(p.objectTitle));
        return null;
      }
      const { reason } = failure.detail;
      const fields = failure.fields;
      store.announce(failure.status === 422 && !reason ? Object.values(fields)[0] ?? failure.message : failure.message);
      const errors: PositionErrors = {};
      if (reason) errors[fieldFor(reason) ?? "offset"] = failure.message;
      for (const [k, m] of Object.entries(fields)) errors[fieldFor(k) ?? "offset"] = m;
      return Object.keys(errors).length ? errors : null;
    } finally {
      saving.current.delete(id);
      if (resave.current.delete(id) && overridesRef.current.has(id)) void saveMove(id);
    }
  };

  const nudge = (p: Placement, dOffset: number, dCentre: number) => {
    const base = overridesRef.current.get(p.id) ?? { offsetMm: p.offsetMm, centreHeightMm: p.centreHeightMm, version: p.version };
    putOverride(p.id, { ...base, offsetMm: base.offsetMm + dOffset, centreHeightMm: base.centreHeightMm + dCentre });
    clearTimeout(timers.current.get(p.id));
    timers.current.set(
      p.id,
      setTimeout(() => {
        timers.current.delete(p.id);
        void saveMove(p.id);
      }, NUDGE_REST_MS),
    );
  };

  const onHandleKey = (e: ReactKeyboardEvent<HTMLButtonElement>, p: Placement) => {
    const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (viewRef.current === "light") {
      if (arrows.includes(e.key)) {
        e.preventDefault();
        const handles = [...document.querySelectorAll<HTMLElement>("[data-handle]")];
        const at = handles.indexOf(e.currentTarget);
        const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
        handles[Math.max(0, Math.min(handles.length - 1, at + (back ? -1 : 1)))]?.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        setDialog({ kind: "lux", placementId: p.id, opener: e.currentTarget });
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      setDialog({ kind: "details", placementId: p.id, opener: e.currentTarget, version: (placementsRef.current.get(p.id) ?? p).version });
      return;
    }
    if (!arrows.includes(e.key)) return;
    e.preventDefault();
    const current = placementsRef.current.get(p.id) ?? p;
    if (!mayMove(staffRef.current, current)) {
      store.announce(say.notMovable(p.objectTitle));
      return;
    }
    const step = e.shiftKey ? 100 : 10;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") nudge(current, e.key === "ArrowLeft" ? -step : step, 0);
    else if (current.heightOverride) nudge(current, 0, e.key === "ArrowDown" ? -step : step);
  };

  const closeRail = useCallback((focusButton: boolean) => {
    setRailOpen(false);
    if (focusButton) focusWhenReady(() => railButton.current);
  }, []);
  const closePreview = useCallback((focusButton: boolean) => {
    setPreviewOpen(false);
    if (focusButton) focusWhenReady(() => previewButton.current);
  }, []);

  const openRail = () => {
    flushSync(() => {
      setPreviewOpen(false);
      setRailOpen(true);
    });
    focusWhenReady(() => drawer.current?.querySelector<HTMLElement>(".card-title") ?? null);
  };
  const openPreview = () => {
    flushSync(() => {
      setRailOpen(false);
      setPreviewOpen(true);
    });
    focusPreviewHeading();
  };

  // Tapping outside an open drawer or sheet closes it.
  useEffect(() => {
    if (!railOpen && !previewOpen) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (document.querySelector("dialog[open]")?.contains(t)) return;
      if (railOpen && !drawer.current?.contains(t) && !railButton.current?.contains(t)) closeRail(false);
      if (previewOpen && !previewSheet.current?.contains(t) && !previewButton.current?.contains(t)) closePreview(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [railOpen, previewOpen, closeRail, closePreview]);

  const runUndo = async () => {
    const t = toastRef.current;
    if (!t || undoBusy) return;
    setUndoBusy(true);
    try {
      const data = await request<{ placement: Placement }>("POST", `/api/undo/${t.actionId}`);
      flushSync(() => {
        store.putPlacement(data.placement);
        putOverride(data.placement.id, null);
        setToast(null);
      });
      void store.refresh(["objects"]);
      store.announce(say.undone(t.title));
      focusWhenReady(() => handleFor(data.placement.id));
    } catch (failure) {
      flushSync(() => setToast(null));
      focusWhenReady(ledgerHeading);
      if (isFailure(failure, 410)) store.announce(say.undoExpired);
      else if (isFailure(failure) && failure.status === 409) store.announce(say.undoChanged(t.title));
      else if (isFailure(failure)) store.announce(failure.message);
    } finally {
      setUndoBusy(false);
    }
  };
  const runUndoRef = useRef(runUndo);
  runUndoRef.current = runUndo;

  // View shortcuts and the undo shortcut work from any workspace control except text fields and dialogs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen() || isTextField(e.target) || store.services?.database === "down") return;
      if (!e.ctrlKey && !e.metaKey && !e.altKey && ["1", "2", "3"].includes(e.key)) {
        e.preventDefault();
        chooseView((["plan", "wall", "light"] as View[])[Number(e.key) - 1]);
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z" && toastRef.current) {
        e.preventDefault();
        void runUndoRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chooseView, store.services]);

  // Focus never stays on a control a refresh removed: it moves to the nearest published heading.
  const lastFocus = useRef<{ el: HTMLElement; fallback: () => HTMLElement | null } | null>(null);
  useEffect(() => {
    const track = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      const card = el.closest?.<HTMLElement>("[data-object-id]");
      if (card && el !== card.querySelector(".card-title")) {
        const id = card.dataset.objectId!;
        lastFocus.current = { el, fallback: () => cardPart(id, "heading") };
      } else if (el.dataset?.handle) lastFocus.current = { el, fallback: ledgerHeading };
      else if (el.closest?.(".preview-panel") && el.id !== "preview-heading") {
        lastFocus.current = { el, fallback: () => document.getElementById("preview-heading") };
      } else lastFocus.current = null;
    };
    document.addEventListener("focusin", track);
    return () => document.removeEventListener("focusin", track);
  }, []);
  useEffect(() => {
    const last = lastFocus.current;
    if (last && !last.el.isConnected && (document.activeElement === document.body || !document.activeElement)) {
      lastFocus.current = null;
      last.fallback()?.focus();
    }
  });

  const cardAction = async (p: Placement, verb: "claim" | "release" | "hang" | "sign-off") => {
    const key = `${verb}:${p.id}`;
    if (pendingRef.current.has(key)) return;
    markPending(key, true);
    const title = p.objectTitle;
    try {
      const data = await request<{ placement: Placement }>("POST", `/api/placements/${p.id}/${verb}`);
      flushSync(() => store.putPlacement(data.placement));
      void store.refresh(["objects"]);
      if (verb === "claim") {
        store.announce(say.claimed(title));
        focusWhenReady(() => cardPart(p.objectId, "Mark hung"));
      } else if (verb === "release") {
        store.announce(say.released(title));
        focusWhenReady(() => cardPart(p.objectId, "Claim"));
      } else {
        store.announce(verb === "hang" ? say.hung(title) : say.signedOff(title));
        focusWhenReady(() => cardPart(p.objectId, "heading"));
      }
    } catch (failure) {
      if (!isFailure(failure)) throw failure;
      const winner = failure.detail.claimedBy;
      if (winner) {
        flushSync(() => store.putPlacement({ ...p, status: "claimed", claimedBy: winner }));
        store.announce(say.lostClaim(winner.name, title));
      } else if (failure.code === "condition_not_recorded") store.announce(say.noPhoto(title));
      else if (failure.code === "over_budget") store.announce(say.overBudget(title));
      else store.announce(failure.message);
      void store.refresh(["placements", "objects"]);
      focusWhenReady(() => cardPart(p.objectId, "heading"));
    } finally {
      markPending(key, false);
    }
  };

  const attach = async (o: ObjectRecord, file: File, input: HTMLInputElement) => {
    setUploading((s) => new Set(s).add(o.id));
    try {
      const data = await request<{ photo: Photo }>("POST", `/api/objects/${o.id}/photos`, file, {
        "Content-Type": file.type || "application/octet-stream",
      });
      const latest = objectsRef.current?.find((x) => x.id === o.id) ?? o;
      store.putObject({ ...latest, photos: [...latest.photos, data.photo], conditionRecorded: true });
      store.announce(say.photoAttached(o.title));
    } catch (failure) {
      if (!isFailure(failure)) throw failure;
      if (failure.code === "image_store_unavailable") store.announce(say.photoStoreDown(o.title));
      else if (failure.status === 413) store.announce(say.photoTooLarge);
      else if (failure.status === 415) store.announce(say.photoWrongType);
      else store.announce(failure.message);
    } finally {
      setUploading((s) => {
        const next = new Set(s);
        next.delete(o.id);
        return next;
      });
      input.value = "";
    }
  };

  const railActions: RailActions = {
    place: (o, opener) => setDialog({ kind: "place", object: o, opener }),
    claim: (p) => void cardAction(p, "claim"),
    release: (p) => void cardAction(p, "release"),
    hang: (p) => void cardAction(p, "hang"),
    signOff: (p) => void cardAction(p, "sign-off"),
    attach: (o, file, input) => void attach(o, file, input),
  };

  const placeWork = async (o: ObjectRecord, draft: PositionDraft): Promise<PositionErrors | null> => {
    try {
      const data = await request<{ placement: Placement }>("POST", "/api/placements", { objectId: o.id, ...draft });
      flushSync(() => {
        store.putPlacement(data.placement);
        store.putObject({ ...o, placementId: data.placement.id, placementStatus: data.placement.status });
        setDialog(null);
        setRailOpen(false);
      });
      store.announce(say.placed(o.title, data.placement.wallName));
      focusWhenReady(() => handleFor(data.placement.id));
      return null;
    } catch (failure) {
      if (!isFailure(failure)) throw failure;
      store.announce(failure.message);
      const { reason } = failure.detail;
      const errors: PositionErrors = {};
      if (reason) errors[fieldFor(reason) ?? "offset"] = failure.message;
      for (const [k, m] of Object.entries(failure.fields)) errors[fieldFor(k) ?? "wall"] = m;
      if (!Object.keys(errors).length) errors.wall = failure.message;
      return errors;
    }
  };

  const remove = async (p: Placement) => {
    const key = `remove:${p.id}`;
    if (pendingRef.current.has(key)) return;
    markPending(key, true);
    try {
      const data = await request<{ placement: Placement; undo: Undo }>("DELETE", `/api/placements/${p.id}`);
      flushSync(() => {
        store.putPlacement(data.placement);
        showToast("remove", data.undo, p);
      });
      void store.refresh(["objects"]);
      store.announce(say.removed(p.objectTitle, p.wallName));
      focusWhenReady(() => document.querySelector<HTMLElement>("[data-undo]"));
    } catch (failure) {
      if (isFailure(failure)) store.announce(failure.message);
    } finally {
      markPending(key, false);
    }
  };

  const viewGroup = (
    <div role="group" aria-label="View" className="view-group">
      {(["plan", "wall", "light"] as View[]).map((v) => (
        <button key={v} type="button" aria-pressed={view === v} className="view-button" onClick={() => chooseView(v)}>
          {v === "plan" ? "Plan" : v === "wall" ? "Wall" : "Light"}
        </button>
      ))}
    </div>
  );

  const railToggle = (
    <button
      ref={railButton}
      type="button"
      className="btn btn-secondary toggle"
      aria-expanded={railOpen}
      aria-controls={railOpen ? "objects-rail" : undefined}
      onClick={() => (railOpen ? closeRail(true) : openRail())}
    >
      Objects
    </button>
  );

  const rail = (
    <Rail
      objects={store.objects}
      placements={placementsById}
      staff={staff}
      unit={unit}
      pending={pending}
      uploading={uploading}
      actions={railActions}
    />
  );

  const legend = view === "light" && (
    <div className="legend-wrap">
      {layout !== "desk" && (
        <button type="button" className="btn btn-quiet toggle" aria-expanded={legendOpen} onClick={() => setLegendOpen((o) => !o)}>
          Lux legend
        </button>
      )}
      {(layout === "desk" || legendOpen) && (
        <section aria-label="Lux legend" className="legend">
          <p>
            <span className="legend-swatch legend-within" aria-hidden="true" />
            Within limit: ink outline
          </p>
          <p>
            <span className="legend-swatch legend-over" aria-hidden="true" />
            Over budget: red outline with hatching
          </p>
          <p className="legend-ramp">
            <span aria-hidden="true" className="ramp" />
            Wall tint: pale at low lux, warm at high lux
          </p>
        </section>
      )}
    </div>
  );

  const ex = store.exhibition;
  const detailsPlacement = dialog?.kind === "details" || dialog?.kind === "lux" ? placementsById.get(dialog.placementId) : undefined;

  return (
    <Shell
      section="gallery"
      headerEnd={
        layout !== "phone" && (
          <>
            {viewGroup}
            {layout === "tablet" && railToggle}
          </>
        )
      }
    >
      <main id="main" tabIndex={-1} className={`workspace layout-${layout}`}>
        <div className="titles">
          <h1 className="display" tabIndex={-1}>{ex ? ex.exhibition.title : <span className="skeleton-text">Loading the exhibition</span>}</h1>
          <h2 className="display-2">{ex ? ex.gallery.name : <span className="skeleton-text">Loading the gallery</span>}</h2>
        </div>
        <div className="columns">
          {layout === "desk" && rail}
          <div className="scene-column">
            {layout === "phone" && viewGroup}
            {legend}
            <div className="scene-box">
              <SceneView
                ref={scene}
                label="Gallery scene"
                walls={walls}
                works={works}
                selectedId={selectedId}
                reduced={reduced}
                hooks={{
                  onSettled,
                  onSelect: (id) => select(id),
                  canMove: (id) => {
                    const p = placementsRef.current.get(id);
                    return p ? mayMove(staffRef.current, p) : false;
                  },
                  onNotMovable: (id) => {
                    const p = placementsRef.current.get(id);
                    if (p) store.announce(say.notMovable(p.objectTitle));
                  },
                  onDrag: (id, offsetMm) => {
                    const p = placementsRef.current.get(id);
                    if (!p) return;
                    const started = overridesRef.current.get(id)?.version ?? p.version;
                    putOverride(id, offsetMm === p.offsetMm ? null : { offsetMm, centreHeightMm: p.centreHeightMm, version: started });
                  },
                  onDragEnd: (id) => void saveMove(id),
                }}
              />
              {toast && (
                <UndoToast
                  toast={toast}
                  busy={undoBusy}
                  onUndo={() => void runUndo()}
                  onExpire={(hadFocus) => {
                    setToast(null);
                    if (hadFocus) focusWhenReady(ledgerHeading);
                  }}
                />
              )}
            </div>
            <p className="over-count num">
              {overCount > 0 && <span className="hatch-swatch" aria-hidden="true" />}
              {`${overCount} over budget`}
            </p>
            <h2 id="ledger-heading" tabIndex={-1} className="section-title">
              Scene ledger
            </h2>
            <Ledger rows={rows} layout={layout} unit={unit} selectedId={selectedId} onSelect={(p) => select(p.id)} onHandleKey={onHandleKey} />
          </div>
          <Inspector
            selected={selected}
            unit={unit}
            canRemove={Boolean(selected && mayRemove(staff, selected))}
            removing={selected ? pending.has(`remove:${selected.id}`) : false}
            onRemove={(p) => void remove(p)}
            onDetails={(p, opener) => setDialog({ kind: "details", placementId: p.id, opener, version: p.version })}
          >
            {/* Mounted with the walls above it, so it never jumps down when they arrive. */}
            {layout !== "phone" && ex && <PreviewPanel />}
          </Inspector>
        </div>
        {layout !== "desk" && railOpen && (
          <div
            ref={drawer}
            className={layout === "tablet" ? "drawer" : "sheet"}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !dialogOpen()) {
                e.preventDefault();
                closeRail(true);
              }
              if (!dialogOpen()) wrapTab(e, e.currentTarget);
            }}
          >
            {rail}
          </div>
        )}
        {layout === "phone" && previewOpen && (
          <div
            ref={previewSheet}
            className="sheet"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !dialogOpen()) {
                e.preventDefault();
                closePreview(true);
              }
              if (!dialogOpen()) wrapTab(e, e.currentTarget);
            }}
          >
            <PreviewPanel />
          </div>
        )}
        {layout === "phone" && (
          <div className="phone-bar">
            {railToggle}
            <button
              ref={previewButton}
              type="button"
              className="btn btn-secondary toggle"
              aria-expanded={previewOpen}
              onClick={() => (previewOpen ? closePreview(true) : openPreview())}
            >
              Lender preview
            </button>
          </div>
        )}
      </main>
      {dialog?.kind === "place" && (
        <PositionDialog
          idPrefix="place"
          label="Place work"
          submitLabel="Save placement"
          closeLabel="Cancel"
          walls={walls}
          showWall
          unit={unit}
          initial={null}
          opener={dialog.opener}
          onClose={() => setDialog(null)}
          onSubmit={(draft) => placeWork(dialog.object, draft)}
        />
      )}
      {dialog?.kind === "details" && detailsPlacement && (
        <PositionDialog
          idPrefix="details"
          label="Placement details"
          submitLabel="Save"
          closeLabel="Close"
          walls={walls}
          showWall={staff?.role === "curator"}
          unit={unit}
          initial={{ ...detailsPlacement, ...overrides.get(detailsPlacement.id) }}
          opener={dialog.opener}
          onClose={() => setDialog(null)}
          onSubmit={async (draft) => {
            const p = placementsRef.current.get(detailsPlacement.id);
            if (!p || !mayMove(staffRef.current, p)) {
              store.announce(say.notMovable(detailsPlacement.objectTitle));
              setDialog(null);
              return null;
            }
            clearTimeout(timers.current.get(p.id));
            putOverride(p.id, { offsetMm: draft.offsetMm, centreHeightMm: draft.centreHeightMm, version: dialog.version });
            const errors = await saveMove(p.id, {
              heightOverride: draft.heightOverride,
              ...(staffRef.current?.role === "curator" ? { wallId: draft.wallId } : {}),
            });
            if (!errors) setDialog(null);
            return errors;
          }}
        />
      )}
      {dialog?.kind === "lux" && detailsPlacement && (
        <LuxDialog placement={detailsPlacement} opener={dialog.opener} onClose={() => setDialog(null)} />
      )}
    </Shell>
  );
}
