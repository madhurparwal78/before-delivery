import { useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  announceActivity, motion, onActivity, openActivityStream, ownRoleChanged, queuedFromReply, session, syncedSeq, watchViewport,
  type ActivityEvent,
} from "../app-state.ts";
import { afterRender, api, ApiFailure, enc, isAdmin, mayCurate, newKey, useStore, viewerTime, type Tag } from "../lib.ts";
import { Shell } from "../shell.tsx";
import { focusEl, Icon, Overlay } from "../ui.tsx";
import { HopList, LineageCanvas, LineageHeader, sweepAttr, type LineageProps } from "./canvas.tsx";
import { AssetPane, ColumnPane, tagControls, type TagAction } from "./detail.tsx";
import { DeprecateDialog, ReinstateDialog, SuppressDialog, VerifyDialog, type DeprecateReply, type ReinstateReply } from "./dialogs.tsx";
import {
  applyLineageUpdate, applyTagUpdate, applyTrace, drawingAtRest, navigate, nextBoundary, resetDownstream, stepFor, sweepProgress,
  type Drawing, type Trace,
} from "./drawing.ts";
import { Facets, Results, SearchBox } from "./search.tsx";
import { readUrl, urlFor, type AssetDetail, type ColumnRead, type FacetGroup, type LineageBody, type SearchBody, type UrlState } from "./types.ts";

type Width = "wide" | "mid" | "narrow";
const wideQuery = matchMedia("(min-width: 1200px)");
const midQuery = matchMedia("(min-width: 768px)");
const currentWidth = (): Width => (wideQuery.matches ? "wide" : midQuery.matches ? "mid" : "narrow");

type DialogKind = "verify" | "deprecate" | "reinstate" | "suppress";
interface DialogState {
  kind: DialogKind;
  id: number;
  open: boolean;
  tag?: Tag;
}

interface PointInTime {
  k: number;
  at: string | null;
}

const LINEAGE_CHANGED = "Lineage changed since this trace. Trace again to include it.";

function failureOf(error: unknown): ApiFailure {
  return error instanceof ApiFailure ? error : new ApiFailure(0, "unknown", "Something went wrong. Try again.");
}

/** Focus after a confirmed tag action: the first shown replacement control for the tag, else the heading (DP-37). */
function focusTagReplacement(tag: string): void {
  const region = document.querySelector('[aria-label="Column detail"]');
  const labels = [`Withdraw ${tag}`, `Tag ${tag}`, `Suppress ${tag}`, `Lift ${tag} suppression`];
  for (const label of labels) {
    const el = region?.querySelector(`[data-focus-key="ctl-${label}"]`);
    if (el) {
      focusEl(el);
      return;
    }
  }
  focusEl(document.getElementById("column-heading"));
}

/** After a confirmed certification move: Verify, Deprecate, Reinstate, else the Asset detail heading (DP-57). */
function focusCertification(): void {
  for (const key of ["cert-verify", "cert-deprecate", "cert-reinstate"]) {
    if (focusEl(document.querySelector(`[data-focus-key="${key}"]`))) return;
  }
  focusEl(document.getElementById("asset-heading"));
}

export function Catalog() {
  const me = useStore(session)!;
  const motionValue = useStore(motion);
  const [url, setUrlState] = useState<UrlState>(readUrl);
  const urlRef = useRef(url);
  const [pit] = useState<PointInTime | null>(() => {
    const u = readUrl();
    if (!u.asOf) return null;
    if (!isAdmin(session.get()!.role) || !/^\d+$/.test(u.asOf)) {
      const live = { ...u, asOf: "" };
      history.replaceState(history.state, "", urlFor(live));
      urlRef.current = live;
      return null;
    }
    return { k: Number(u.asOf), at: null };
  });
  const [pitAt, setPitAt] = useState<string | null>(null);
  const [newer, setNewer] = useState(0);
  const [queryText, setQueryText] = useState(url.q);
  const [search, setSearch] = useState<SearchBody | null>(null);
  const [searchStatus, setSearchStatus] = useState("");
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [column, setColumn] = useState<ColumnRead | null>(null);
  const [drawing, setDrawingState] = useState<Drawing | null>(null);
  const drawingRef = useRef<Drawing | null>(null);
  const [trace, setTraceState] = useState<Trace | null>(null);
  const traceRef = useRef<Trace | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const [chosen, setChosen] = useState<string | null>(null);
  const [tabStop, setTabStop] = useState<string | null>(null);
  const [canvasLayout, setCanvasLayout] = useState<"settling" | "settled">("settled");
  const [summary, setSummary] = useState("");
  const [lineageStatus, setLineageStatus] = useState("");
  const [width, setWidth] = useState<Width>(currentWidth);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState<Tag>("PII");
  const [undoBatch, setUndoBatch] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [ready, setReady] = useState(false);

  const requests = useRef({ search: 0, asset: 0, column: 0, drawing: 0, trace: 0 });
  const announcedCount = useRef<number | null>(null);
  const latestSearch = useRef<Promise<void>>(Promise.resolve());
  const sweepTimer = useRef<number | undefined>(undefined);
  const deferredCanvas = useRef<(() => void)[]>([]);
  const lastNode = useRef<{ focus: string; column: string } | null>(null);
  const columnOpener = useRef<{ kind: "node" | "row"; column: string } | null>(null);
  const pendingFocus = useRef<(() => void) | null>(null);
  const lastFocusKey = useRef<{ key: string; inColumn: boolean; inAsset: boolean; inRail: boolean } | null>(null);
  const writes = useRef({ count: 0, waiters: [] as (() => void)[] });
  const debounce = useRef<number | undefined>(undefined);
  const bulkPending = useRef(false);
  const settleTimer = useRef<number | undefined>(undefined);

  const live = pit === null;
  const curate = mayCurate(me.role);
  const asOfParam = (prefix: "?" | "&") => (pit ? `${prefix}as_of_seq=${pit.k}` : "");

  const setUrl = (next: UrlState, mode: "push" | "replace") => {
    urlRef.current = next;
    if (mode === "push") history.pushState(null, "", urlFor(next));
    else history.replaceState(history.state, "", urlFor(next));
    setUrlState(next);
  };
  const setDrawing = (d: Drawing | null) => {
    drawingRef.current = d;
    setDrawingState(d);
  };
  const setTrace = (t: Trace | null) => {
    traceRef.current = t;
    setTraceState(t);
  };

  // ---- reads, each surface painting only its latest request (DP-20) ----

  const runSearch = (mode: "user" | "refresh"): Promise<void> => {
    const id = ++requests.current.search;
    const u = urlRef.current;
    const p = new URLSearchParams();
    for (const k of ["q", "tag", "owner", "state", "term"] as const) if (u[k]) p.set(k, u[k]);
    if (pit) p.set("as_of_seq", String(pit.k));
    if (mode === "user") setSearchStatus("Searching...");
    const work = (async () => {
      try {
        const body = await api<SearchBody>("GET", `/api/search?${p}`);
        if (id !== requests.current.search) return;
        setSearch(body);
        if (pit && body.as_of_at !== undefined) setPitAt(body.as_of_at ?? null);
        if (mode === "user" || body.total !== announcedCount.current) {
          setSearchStatus(`Matching assets: ${body.total}`);
          announcedCount.current = body.total;
        }
      } catch (error) {
        if (id !== requests.current.search) return;
        const f = failureOf(error);
        if (pit && f.status === 422 && f.fields.as_of_seq) {
          location.replace(urlFor({ ...urlRef.current, asOf: "" }));
          return;
        }
        if (mode === "user") setSearchStatus(f.status === 422 ? Object.values(f.fields)[0] ?? f.message : "Search is unavailable. Try again.");
      }
    })();
    latestSearch.current = work;
    return work;
  };

  const fetchAsset = (id: string) => api<unknown>("GET", `/api/assets/${enc(id)}${asOfParam("?")}`).then((b) => (pit ? (b as { asset: AssetDetail }).asset : (b as AssetDetail)));
  const fetchColumn = (id: string) => api<unknown>("GET", `/api/columns/${enc(id)}${asOfParam("?")}`).then((b) => (pit ? (b as { column: ColumnRead }).column : (b as ColumnRead)));
  const fetchLineage = (id: string, direction: "upstream" | "downstream") =>
    api<LineageBody>("GET", `/api/columns/${enc(id)}/lineage?direction=${direction}${asOfParam("&")}`);

  const loadAsset = async (id: string) => {
    const req = ++requests.current.asset;
    try {
      const detail = await fetchAsset(id);
      if (req !== requests.current.asset) return null;
      setAsset(detail);
      return detail;
    } catch {
      return null;
    }
  };

  const loadColumn = async (id: string) => {
    const req = ++requests.current.column;
    try {
      const c = await fetchColumn(id);
      if (req !== requests.current.column) return;
      setColumn(c);
    } catch {
      /* the next refresh tries again */
    }
  };

  const cancelSweep = () => {
    window.clearTimeout(sweepTimer.current);
    requests.current.trace++;
    deferredCanvas.current = [];
  };

  /** Draw the canvas at rest for a focus column, exactly as when the column is opened. */
  const redraw = async (focusColumn: string, choose: boolean): Promise<(() => void) | null> => {
    const req = ++requests.current.drawing;
    try {
      const [up, down] = await Promise.all([fetchLineage(focusColumn, "upstream"), fetchLineage(focusColumn, "downstream")]);
      if (req !== requests.current.drawing) return null;
      return () => {
        cancelSweep();
        setTrace(null);
        setSummary("");
        setLineageStatus("");
        setDrawing(drawingAtRest(up, down));
        if (choose) {
          setChosen(focusColumn);
          setTabStop(focusColumn);
        } else {
          setChosen((c) => (c && (c === focusColumn || up.reached.some((r) => r.column === c) || down.reached.some((r) => r.column === c)) ? c : null));
          setTabStop((t) => t ?? focusColumn);
        }
      };
    } catch {
      return null;
    }
  };

  const canvasFocusFor = (u: UrlState, a: AssetDetail | null) => u.column || (a && a.id === u.asset ? a.columns[0]?.id ?? "" : "");

  // ---- live updates (DP-04, DP-85, DP-95, DP-97, DP-99) ----

  const ownWritesDone = () =>
    writes.current.count === 0 ? Promise.resolve() : new Promise<void>((resolve) => writes.current.waiters.push(resolve));

  const beginWrite = () => {
    writes.current.count++;
  };
  const endWrite = () => {
    writes.current.count--;
    if (writes.current.count === 0) for (const w of writes.current.waiters.splice(0)) w();
  };

  const canvasUpdate = async (kind: "tags" | "lineage") => {
    const d = drawingRef.current;
    if (!d) return;
    const focus = d.focus;
    const [up, down] = await Promise.all([fetchLineage(focus, "upstream"), fetchLineage(focus, "downstream")]);
    const apply = () => {
      const current = drawingRef.current;
      if (!current || current.focus !== focus) return;
      if (kind === "tags") {
        setDrawing(applyTagUpdate(current, up, down));
        return;
      }
      const { drawing: next, changed } = applyLineageUpdate(current, up, down);
      if (!changed) return;
      const announce = !current.changeAnnounced;
      setDrawing({ ...next, changeAnnounced: true });
      if (announce) setLineageStatus(LINEAGE_CHANGED);
      if (motion.get() === "reduced") setCanvasLayout("settled");
      else {
        setCanvasLayout("settling");
        window.clearTimeout(settleTimer.current);
        settleTimer.current = window.setTimeout(() => setCanvasLayout("settled"), 250);
      }
    };
    const t = traceRef.current;
    if (t && t.phase === "running") deferredCanvas.current.push(apply);
    else apply();
  };

  const refreshWorkspace = async (actions: Set<string>) => {
    const u = urlRef.current;
    const tasks: Promise<unknown>[] = [runSearch("refresh")];
    if (u.asset) tasks.push(loadAsset(u.asset));
    if (u.column) tasks.push(loadColumn(u.column));
    if ([...actions].some((a) => a.startsWith("tag.") || a.startsWith("certification."))) tasks.push(canvasUpdate("tags"));
    if (actions.has("lineage.add") || actions.has("lineage.remove")) tasks.push(canvasUpdate("lineage"));
    await Promise.all(tasks.map((t) => t.catch(() => undefined)));
    await latestSearch.current;
  };

  const roleChanged = async () => {
    const focusedTrace = document.activeElement?.getAttribute("data-focus-key") === "trace";
    const inRail = !!document.activeElement?.closest(".panel-rail");
    const user = await ownRoleChanged();
    if (pit && !isAdmin(user.role)) {
      location.replace(urlFor({ ...urlRef.current, asOf: "" }));
      return;
    }
    const t = traceRef.current;
    let restoreTrace: (() => void) | null = null;
    if (!mayCurate(user.role) && t && t.phase !== "done" && drawingRef.current) {
      cancelSweep();
      setTrace(null);
      setSummary("");
      restoreTrace = await redraw(drawingRef.current.focus, false);
    }
    setDialog((d) => {
      if (!d || !d.open) return d;
      const allowed = d.kind === "reinstate" ? isAdmin(user.role) : mayCurate(user.role);
      return allowed ? d : { ...d, open: false };
    });
    if (!mayCurate(user.role)) {
      setSelected(new Set());
      setUndoBatch(null);
    }
    const u = urlRef.current;
    await Promise.all([runSearch("refresh"), u.asset ? loadAsset(u.asset) : null, u.column ? loadColumn(u.column) : null]);
    restoreTrace?.();
    await afterRender();
    if (focusedTrace && document.activeElement?.getAttribute("data-focus-key") !== "trace") {
      focusEl(inRail ? document.getElementById("close-lineage") : document.querySelector('.canvas [aria-label="Zoom in"]'));
    }
  };

  const queue = useRef<ActivityEvent[]>([]);
  const processing = useRef(false);
  const drain = async () => {
    if (processing.current) return;
    processing.current = true;
    try {
      while (queue.current.length) {
        await ownWritesDone();
        const batch = queue.current.splice(0);
        const mine = batch.find((e) => e.action === "user.role_change" && e.target.id === session.get()!.id);
        const actions = new Set(batch.filter((e) => !e.action.startsWith("user.") && e.action !== "evidence.download").map((e) => e.action));
        if (mine) await roleChanged();
        if (actions.size) await refreshWorkspace(actions);
        await afterRender();
        syncedSeq.set(Math.max(...batch.map((e) => e.seq)));
      }
    } catch {
      /* a failed refresh leaves the screen as it was; the next event retries */
    } finally {
      processing.current = false;
    }
  };

  // ---- first load ----

  useLayoutEffect(() => {
    void (async () => {
      const u = urlRef.current;
      const first = runSearch("user");
      if (u.asset) {
        const [detail] = await Promise.all([loadAsset(u.asset), u.column ? loadColumn(u.column) : null]);
        await first;
        setReady(true);
        const focus = canvasFocusFor(u, detail);
        if (focus) (await redraw(focus, true))?.();
      } else {
        await first;
        setReady(true);
      }
    })();
    if (pit) {
      syncedSeq.set(pit.k);
      openActivityStream(pit.k);
      let seen = false;
      return onActivity((event) => {
        if (event.action === "user.role_change" && event.target.id === session.get()!.id) void roleChanged();
        if (event.seq <= pit.k) return;
        setNewer((n) => {
          const next = n + 1;
          if (!seen) {
            seen = true;
            announceActivity(`${next} newer changes since seq ${pit.k}.`);
          }
          return next;
        });
      });
    }
    openActivityStream(null);
    return onActivity((event) => {
      queue.current.push(event);
      void drain();
    });
  }, []);

  // ---- breakpoints and focus across them (Choosing a node: Focus across a breakpoint) ----

  useLayoutEffect(() => {
    const onChange = () => {
      const next = currentWidth();
      setWidth((prev) => {
        if (prev === next) return prev;
        const active = document.activeElement as HTMLElement | null;
        if (next === "narrow" && prev !== "narrow" && active?.closest(".canvas")) {
          if (active.dataset.column) lastNode.current = { focus: drawingRef.current?.focus ?? "", column: active.dataset.column };
          pendingFocus.current = () => focusEl(document.getElementById("open-lineage"));
        } else if (next !== "narrow" && prev === "narrow" && active?.closest(".panel-rail")) {
          const col = active.dataset.column;
          pendingFocus.current = col
            ? () => focusEl(document.querySelector(`.canvas [data-column="${CSS.escape(col)}"]`))
            : () => focusEl(document.querySelector('.canvas [data-focus-key="trace"]') ?? document.querySelector('.canvas [aria-label="Zoom in"]'));
          setRailOpen(false);
        } else if (next !== "narrow" && prev === "narrow" && active?.closest(".panel-sheet")) {
          pendingFocus.current = () => focusEl(document.getElementById("search-catalog"));
          setSheetOpen(false);
        }
        return next;
      });
    };
    wideQuery.addEventListener("change", onChange);
    midQuery.addEventListener("change", onChange);
    const unwatch = watchViewport(onChange);
    return () => {
      wideQuery.removeEventListener("change", onChange);
      midQuery.removeEventListener("change", onChange);
      unwatch();
    };
  }, []);

  // ---- focus bookkeeping: a removed control hands focus to its published replacement ----

  useLayoutEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const el = event.target as HTMLElement;
      const key = el.dataset?.focusKey ?? (el.dataset?.column ? `node:${el.dataset.column}` : "");
      lastFocusKey.current = key
        ? { key, inColumn: !!el.closest('[aria-label="Column detail"]'), inAsset: !!el.closest('[aria-label="Asset detail"]'), inRail: !!el.closest(".panel-rail") }
        : null;
      if (el.dataset?.column && drawingRef.current) lastNode.current = { focus: drawingRef.current.focus, column: el.dataset.column };
    };
    /** Focus the person moved away on purpose is not restored; focus lost to a removed control is. */
    const onFocusOut = (event: FocusEvent) => {
      const el = event.target as HTMLElement;
      void Promise.resolve().then(() => {
        if (el.isConnected && document.activeElement === document.body) lastFocusKey.current = null;
      });
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  useLayoutEffect(() => {
    if (pendingFocus.current) {
      const run = pendingFocus.current;
      pendingFocus.current = null;
      run();
      return;
    }
    const last = lastFocusKey.current;
    const focused = document.activeElement;
    const focusDropped = !focused || focused === document.body;
    if (!last || !focusDropped) return;
    if (last.key.startsWith("node:")) {
      const col = last.key.slice(5);
      const scope = last.inRail ? ".panel-rail" : ".canvas";
      if (focusEl(document.querySelector(`${scope} [data-column="${CSS.escape(col)}"]`))) return;
    }
    if (last.key.startsWith("ctl-")) return focusTagReplacement(last.key.endsWith("suppression") ? last.key.split(" ")[1] : last.key.split(" ").pop()!);
    if (last.key.startsWith("cert-")) return focusCertification();
    if (last.key === "bulk" || last.key === "undo") return void focusEl(document.getElementById("asset-heading"));
    if (last.inColumn) return void focusEl(document.getElementById("column-heading"));
    if (last.inAsset) return void focusEl(document.getElementById("asset-heading"));
  });

  // ---- reduced motion switched on mid-sweep jumps to the finished form ----

  useLayoutEffect(() => {
    const t = traceRef.current;
    if (motionValue === "reduced" && t?.phase === "running") finishSweep(t);
  }, [motionValue]);

  // ---- the sweep (DP-42..44, DP-48) ----

  const finishSweep = (t: Trace) => {
    window.clearTimeout(sweepTimer.current);
    const done: Trace = { ...t, phase: "done" };
    setTrace(done);
    setNow(performance.now());
    setSummary(t.body!.summary);
    const deferred = deferredCanvas.current.splice(0);
    for (const apply of deferred) apply();
  };

  const tick = (gen: number) => {
    const t = traceRef.current;
    if (!t || t.gen !== gen || t.phase !== "running") return;
    const at = performance.now();
    if (sweepProgress(t, at).done) return finishSweep(t);
    setNow(at);
    sweepTimer.current = window.setTimeout(() => tick(gen), Math.max(1, nextBoundary(t, at)));
  };

  const startTrace = async () => {
    const d = drawingRef.current;
    if (!d || !mayCurate(session.get()!.role)) return;
    cancelSweep();
    const gen = requests.current.trace;
    const reset = resetDownstream({ ...d, changeAnnounced: false });
    setDrawing(reset);
    setTrace({ gen, phase: "pending", t0: 0, step: 140, maxHop: 0, body: null });
    setSummary("Tracing...");
    setLineageStatus("");
    try {
      const body = await fetchLineage(d.focus, "downstream");
      if (gen !== requests.current.trace || !drawingRef.current || drawingRef.current.focus !== d.focus) return;
      const t0 = performance.now();
      const maxHop = body.totals.hops;
      const running: Trace = { gen, phase: "running", t0, step: stepFor(maxHop), maxHop, body };
      setDrawing(applyTrace(drawingRef.current, body));
      if (motion.get() === "reduced" || maxHop === 0) return finishSweep(running);
      setTrace(running);
      setNow(t0);
      sweepTimer.current = window.setTimeout(() => tick(gen), nextBoundary(running, t0));
    } catch {
      if (gen !== requests.current.trace) return;
      setTrace(null);
      setSummary("Trace is unavailable. Try again.");
    }
  };

  // ---- opening things ----

  /** Choosing another focus column cancels the current sweep at once (DP-44). */
  const cancelTraceForNewFocus = () => {
    if (!traceRef.current) return;
    cancelSweep();
    setTrace(null);
    setSummary("");
  };

  const openAsset = async (id: string, focusHeading = false) => {
    cancelTraceForNewFocus();
    setUrl({ ...urlRef.current, asset: id, column: "" }, "push");
    setColumn(null);
    requests.current.column++;
    const detail = await loadAsset(id);
    if (!detail || urlRef.current.asset !== id) return;
    const focus = canvasFocusFor(urlRef.current, detail);
    if (focus) (await redraw(focus, true))?.();
    if (focusHeading) {
      await afterRender();
      focusEl(document.getElementById("asset-heading"));
    }
  };

  const openColumn = async (columnId: string, opener: "node" | "row") => {
    cancelTraceForNewFocus();
    columnOpener.current = { kind: opener, column: columnId };
    const assetId = columnId.slice(0, columnId.lastIndexOf("."));
    const owner = asset?.columns.some((c) => c.id === columnId) ? asset.id : assetId;
    const changedAsset = owner !== urlRef.current.asset;
    setUrl({ ...urlRef.current, asset: owner, column: columnId }, "push");
    const reads: Promise<unknown>[] = [loadColumn(columnId)];
    if (changedAsset) reads.push(loadAsset(owner));
    const draw = redraw(columnId, true);
    await Promise.all(reads);
    (await draw)?.();
    if (opener === "node") {
      await afterRender();
      focusEl(document.getElementById("column-heading"));
    }
  };

  // ---- search controls ----

  const onType = (value: string) => {
    setQueryText(value);
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      setUrl({ ...urlRef.current, q: value }, "replace");
      void runSearch("user");
    }, 300);
  };

  const onFacet = (group: FacetGroup, value: string) => {
    setUrl({ ...urlRef.current, [group]: value }, "push");
    void runSearch("user");
  };

  const onClear = () => {
    window.clearTimeout(debounce.current);
    setQueryText("");
    setUrl({ ...urlRef.current, q: "", tag: "", owner: "", state: "", term: "" }, "push");
    void runSearch("user");
  };

  useLayoutEffect(() => {
    const onPop = () => {
      const prev = urlRef.current;
      const next = readUrl();
      if (pit && next.asOf !== String(pit.k)) {
        location.reload();
        return;
      }
      urlRef.current = next;
      setUrlState(next);
      setQueryText(next.q);
      window.clearTimeout(debounce.current);
      void runSearch("user");
      if (next.asset !== prev.asset) {
        if (!next.asset) setAsset(null);
        else void loadAsset(next.asset).then(async (d) => {
          const focus = canvasFocusFor(urlRef.current, d);
          if (focus) (await redraw(focus, true))?.();
        });
      }
      if (next.column !== prev.column) {
        if (next.column) {
          void loadColumn(next.column);
          void redraw(next.column, true).then((apply) => apply?.());
        } else setColumn(null);
      }
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  // ---- own actions: one paint once the server confirms (DP-31, DP-37, DP-38) ----

  const repaintAfterWrite = async () => {
    const u = urlRef.current;
    const searchId = ++requests.current.search;
    const assetId = ++requests.current.asset;
    const columnId = ++requests.current.column;
    const p = new URLSearchParams();
    for (const k of ["q", "tag", "owner", "state", "term"] as const) if (u[k]) p.set(k, u[k]);
    const focus = drawingRef.current?.focus ?? canvasFocusFor(u, asset);
    const [s, a, c, draw] = await Promise.all([
      api<SearchBody>("GET", `/api/search?${p}`).catch(() => null),
      u.asset ? fetchAsset(u.asset).catch(() => null) : null,
      u.column ? fetchColumn(u.column).catch(() => null) : null,
      focus ? redraw(focus, false) : null,
    ]);
    if (s && searchId === requests.current.search) {
      setSearch(s);
      if (s.total !== announcedCount.current) {
        setSearchStatus(`Matching assets: ${s.total}`);
        announcedCount.current = s.total;
      }
    }
    if (a && assetId === requests.current.asset) setAsset(a);
    if (c && columnId === requests.current.column) setColumn(c);
    draw?.();
  };

  const tagAction = async (action: TagAction, tag: Tag) => {
    if (!column) return;
    const id = column.id;
    if (action === "suppress") {
      setDialog({ kind: "suppress", id: Date.now() + Math.random(), open: true, tag });
      return;
    }
    const pressed = tagControls(column, tag).find((c) => c.action === action)!.label;
    setUndoBatch(null);
    beginWrite();
    announceActivity("Saving...");
    try {
      if (action === "tag") {
        await api("POST", `/api/columns/${enc(id)}/tags`, { tag });
        await repaintAfterWrite();
        announceActivity(`${tag} tag added to ${id}.`);
      } else if (action === "withdraw") {
        const r = await api<{ still_reaching: number }>("DELETE", `/api/columns/${enc(id)}/tags/${tag}`);
        await repaintAfterWrite();
        announceActivity(r.still_reaching > 0
          ? `${tag} tag withdrawn from ${id}. Still reaches ${r.still_reaching} columns through other paths.`
          : `${tag} tag withdrawn from ${id}.`);
      } else {
        await api("DELETE", `/api/columns/${enc(id)}/suppressions/${tag}`);
        await repaintAfterWrite();
        announceActivity(`${tag} suppression lifted on ${id}.`);
      }
      await afterRender();
      focusTagReplacement(tag);
    } catch (error) {
      const f = failureOf(error);
      announceActivity(f.message);
      if (f.status === 409) await repaintAfterWrite();
      await afterRender();
      if (!focusEl(document.querySelector(`[data-focus-key="ctl-${pressed}"]`))) focusTagReplacement(tag);
    } finally {
      endWrite();
    }
  };

  const applyBulk = async () => {
    if (!asset || bulkPending.current) return;
    bulkPending.current = true;
    setUndoBatch(null);
    beginWrite();
    announceActivity("Saving...");
    const columns = asset.columns.map((c) => c.id).filter((c) => selected.has(c));
    try {
      const r = await api<{ batch_id: string | null; tag: string; requested: number; applied: number }>(
        "POST", `/api/assets/${enc(asset.id)}/tags/bulk`, { tag: bulkTag, columns }, { "Idempotency-Key": newKey() },
      );
      await repaintAfterWrite();
      setSelected(new Set());
      announceActivity(`${r.tag} applied to ${r.applied} of ${r.requested} columns.`);
      if (r.applied >= 1 && r.batch_id) setUndoBatch(r.batch_id);
    } catch (error) {
      announceActivity(failureOf(error).message);
    } finally {
      bulkPending.current = false;
      endWrite();
      await afterRender();
      focusEl(document.getElementById("bulk-apply"));
    }
  };

  const undo = async () => {
    if (!undoBatch) return;
    const batch = undoBatch;
    beginWrite();
    announceActivity("Saving...");
    try {
      const r = await api<{ restored: number }>("POST", `/api/tag-batches/${enc(batch)}/undo`, {});
      await repaintAfterWrite();
      setUndoBatch(null);
      announceActivity(`Bulk tag undone on ${r.restored} columns.`);
    } catch (error) {
      announceActivity(failureOf(error).message);
      setUndoBatch(null);
      await repaintAfterWrite();
    } finally {
      endWrite();
      await afterRender();
      focusEl(document.getElementById("bulk-apply"));
    }
  };

  // ---- certification (DP-56, DP-57, DP-60) ----

  const openDialog = (kind: DialogKind) => {
    setUndoBatch(null);
    setDialog({ kind, id: Date.now() + Math.random(), open: true });
  };

  const closeDialog = async (focus: () => void) => {
    setDialog((d) => (d ? { ...d, open: false } : d));
    await afterRender();
    focus();
  };

  const cancelDialog = () => {
    const d = dialog;
    void closeDialog(() => {
      if (!d) return;
      const key = d.kind === "suppress" ? `ctl-Suppress ${d.tag}` : `cert-${d.kind}`;
      if (focusEl(document.querySelector(`[data-focus-key="${key}"]`))) return;
      if (d.kind === "suppress") focusTagReplacement(d.tag!);
      else focusEl(document.getElementById("asset-heading"));
    });
  };

  const certified = (detail: AssetDetail, copy: string) => {
    requests.current.asset++;
    setAsset(detail);
    announceActivity(copy);
    void runSearch("refresh");
    void closeDialog(focusCertification);
  };

  // ---- the lineage drawing's interaction props ----

  const chooseNode = (col: string) => {
    const d = drawingRef.current;
    if (!d) return;
    setChosen(col);
    setTabStop(col);
    const hop = d.nodes.get(col)?.hop ?? 0;
    setLineageStatus(`${col}, hop ${hop}`);
    const scope = (document.activeElement as HTMLElement | null)?.closest(".panel-rail") ? ".panel-rail" : width === "narrow" ? ".panel-rail" : ".canvas";
    focusEl(document.querySelector(`${scope} [data-column="${CSS.escape(col)}"]`));
  };

  const onNodeKey = (event: KeyboardEvent, col: string) => {
    const d = drawingRef.current;
    if (!d) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = navigate(d, col, event.key);
      if (!next) return;
      setTabStop(next);
      const scope = (event.currentTarget as HTMLElement).closest(".panel-rail") ? ".panel-rail" : ".canvas";
      const el = document.querySelector(`${scope} [data-column="${CSS.escape(next)}"]`);
      if (el instanceof HTMLElement) el.focus({ preventScroll: true });
    } else if (event.key === " ") {
      event.preventDefault();
      chooseNode(col);
    } else if (event.key === "Enter") {
      event.preventDefault();
      chooseNode(col);
      if (railOpen) setRailOpen(false);
      void openColumn(col, "node");
    }
  };

  const onColumnDetailKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !columnOpener.current) return;
    const opener = columnOpener.current;
    const target = opener.kind === "node"
      ? document.querySelector(`.canvas [data-column="${CSS.escape(opener.column)}"]`) ?? document.getElementById("open-lineage")
      : document.querySelector(`[data-focus-key="col-${CSS.escape(opener.column)}"]`);
    if (target) {
      event.preventDefault();
      focusEl(target);
    }
  };

  const lineageProps: LineageProps = {
    drawing,
    emptyCopy: "Pick an asset to see its lineage.",
    trace,
    now,
    reducedMotion: motionValue === "reduced",
    chosen,
    tabStop,
    layout: canvasLayout,
    canTrace: curate,
    summary,
    status: lineageStatus,
    onTrace: () => void startTrace(),
    onNodeFocus: (col) => setTabStop(col),
    onChoose: chooseNode,
    onNodeKey,
  };

  const counter = trace ? sweepProgress(trace, now).counted : 0;
  const narrow = width === "narrow";
  const showResults = !narrow || !url.asset;
  const activeFilters = (["tag", "owner", "state", "term"] as const).filter((g) => url[g]).length;
  const searchStatusEl = <div role="status" aria-label="Search status" class="search-status">{searchStatus}</div>;

  const railInitialFocus = (root: HTMLElement): HTMLElement | null => {
    const d = drawingRef.current;
    const remembered = lastNode.current && d && lastNode.current.focus === d.focus ? lastNode.current.column : null;
    for (const col of [remembered, chosen]) {
      const el = col && root.querySelector<HTMLElement>(`[data-column="${CSS.escape(col)}"]`);
      if (el) {
        setTabStop(col);
        return el;
      }
    }
    return root.querySelector<HTMLElement>("#close-lineage");
  };

  const onRailKey = (event: KeyboardEvent) => {
    const t = event.target as HTMLElement;
    if ((event.key === "t" || event.key === "T") && curate && (t.dataset.column || t.dataset.focusKey === "trace" || t.id === "close-lineage")) {
      event.preventDefault();
      void startTrace();
    }
  };

  const pointInTimeNote = pit && (
    <div role="note" aria-label="Point in time" class="note-band pit-note">
      <p>Catalog as of audit seq <span class="mono">{String(pit.k)}</span>. Later changes are not shown.</p>
      <p data-recorded-at="">
        {pit.k === 0 ? "Seq 0 is the seeded first-run state." : <>Seq <span class="mono">{String(pit.k)}</span> was recorded at <span class="mono">{pitAt ? viewerTime(pitAt) : ""}</span>.</>}
      </p>
      {newer > 0 && <p data-newer-changes="">{`${newer} newer changes since seq ${pit.k}.`}</p>}
      <a href={urlFor({ ...url, asOf: "" })}>Back to the live catalog</a>
    </div>
  );

  const detailPane = asset && (
    <div class="detail-pane" onKeyDown={onColumnDetailKey}>
      <AssetPane
        asset={asset}
        live={live}
        curate={curate}
        admin={isAdmin(me.role)}
        canDownload={me.role !== "Viewer"}
        selected={selected}
        bulkTag={bulkTag}
        onSelect={(id, checked) => setSelected((s) => {
          const next = new Set(s);
          if (checked) next.add(id);
          else next.delete(id);
          return next;
        })}
        onBulkTag={setBulkTag}
        onApply={() => void applyBulk()}
        onOpenColumn={(id) => void openColumn(id, "row")}
        onCertify={openDialog}
        onUpstream={(id) => void openAsset(id, true)}
      />
      {column && column.asset.id === asset.id && (
        <ColumnPane column={column} controls={curate && live} onAction={(a, t) => void tagAction(a, t)} />
      )}
    </div>
  );

  if (!ready) return null;

  return (
    <Shell
      screen="catalog"
      pointInTime={pointInTimeNote}
      afterActivity={undoBatch && live && curate ? (
        <button type="button" class="btn btn-quiet undo" data-focus-key="undo" onClick={() => void undo()}>Undo</button>
      ) : null}
    >
      <div class={`workspace workspace-${width}`}>
        <div class="rail">
          {narrow && (
            <button type="button" class="btn btn-quiet filters-open" id="open-filters" aria-expanded={sheetOpen ? "true" : "false"}
              onClick={() => setSheetOpen(true)}>
              <Icon name="sliders" />
              Filters
              <span class="badge mono" data-active-filters="" aria-hidden="true">{String(activeFilters)}</span>
            </button>
          )}
          <SearchBox value={queryText} onInput={onType} />
          {!(narrow && sheetOpen) && searchStatusEl}
          {!narrow && <Facets search={search} url={url} where="rail" onChoose={onFacet} />}
          {showResults && <Results search={search} onClear={onClear} onOpen={(id) => void openAsset(id)} current={url.asset} />}
          {narrow && url.asset && (
            <a class="back-results" href={urlFor({ ...url, asset: "", column: "" })}
              onClick={(e) => (e.preventDefault(), setUrl({ ...urlRef.current, asset: "", column: "" }, "push"), setAsset(null), setColumn(null))}>
              Back to results
            </a>
          )}
          {narrow && url.asset && detailPane}
          {narrow && (
            <button type="button" class="btn btn-quiet lineage-open" id="open-lineage" aria-expanded={railOpen ? "true" : "false"}
              onClick={() => setRailOpen(true)}>
              <Icon name="lineage" />
              Lineage
            </button>
          )}
        </div>
        {!narrow && (
          <div class="canvas-pane">
            <LineageCanvas {...lineageProps} />
          </div>
        )}
        {!narrow && <div class="detail-col">{detailPane}</div>}
      </div>

      {narrow && (
        <Overlay open={sheetOpen} kind="sheet" label="Filters" onEscape={() => (setSheetOpen(false), void afterRender().then(() => focusEl(document.getElementById("open-filters"))))}
          initialFocus={(root) => root.querySelector<HTMLElement>('[aria-label="Tag"] input:checked')}>
          <div class="sheet-head">
            <h2 class="dialog-title">Filters</h2>
            <button type="button" class="btn btn-quiet" onClick={() => (setSheetOpen(false), void afterRender().then(() => focusEl(document.getElementById("open-filters"))))}>
              <Icon name="x" />
              Close filters
            </button>
          </div>
          {searchStatusEl}
          <Facets search={search} url={url} where="sheet" onChoose={onFacet} />
        </Overlay>
      )}

      {narrow && (
        <Overlay open={railOpen} kind="rail" label="Lineage"
          attrs={{ "data-sweep": sweepAttr(trace, now), "data-layout": canvasLayout }}
          onEscape={() => (setRailOpen(false), void afterRender().then(() => focusEl(document.getElementById("open-lineage"))))}
          initialFocus={railInitialFocus}>
          <div class="rail-head" onKeyDown={onRailKey}>
            <button type="button" id="close-lineage" class="btn btn-quiet"
              onClick={() => (setRailOpen(false), void afterRender().then(() => focusEl(document.getElementById("open-lineage"))))}>
              <Icon name="x" />
              Close lineage
            </button>
            <LineageHeader props={lineageProps} counter={counter} />
          </div>
          <div class="rail-body" onKeyDown={onRailKey}>
            <HopList {...lineageProps} />
          </div>
        </Overlay>
      )}

      {dialog?.kind === "verify" && asset && (
        <VerifyDialog key={dialog.id} open={dialog.open} assetId={asset.id} onCancel={cancelDialog}
          onVerified={(d) => certified(d, `Verified. Evidence stored as ${d.evidence!.filename}.`)} />
      )}
      {dialog?.kind === "deprecate" && asset && (
        <DeprecateDialog key={dialog.id} open={dialog.open} assetId={asset.id} onCancel={cancelDialog}
          onDeprecated={(r: DeprecateReply) => {
            queuedFromReply(r.queued_notices);
            certified(r.asset, `Deprecated. Downstream owner notices queued: ${r.notices_queued}.`);
          }} />
      )}
      {dialog?.kind === "reinstate" && asset && (
        <ReinstateDialog key={dialog.id} open={dialog.open} assetId={asset.id} onCancel={cancelDialog}
          onReinstated={(r: ReinstateReply) => {
            queuedFromReply(r.queued_notices);
            certified(r.asset, `Reinstated to draft. Unsent notices cancelled: ${r.notices_cancelled}.`);
          }} />
      )}
      {dialog?.kind === "suppress" && column && (
        <SuppressDialog key={dialog.id} open={dialog.open} columnId={column.id} tag={dialog.tag!} onCancel={cancelDialog}
          onSuppressed={() => {
            const tag = dialog.tag!;
            const id = column.id;
            beginWrite();
            void (async () => {
              try {
                await repaintAfterWrite();
                announceActivity(`${tag} suppressed on ${id}.`);
                await closeDialog(() => focusTagReplacement(tag));
              } finally {
                endWrite();
              }
            })();
          }}
          onRefused={(message) => {
            announceActivity(message);
            void repaintAfterWrite();
          }} />
      )}
    </Shell>
  );
}
