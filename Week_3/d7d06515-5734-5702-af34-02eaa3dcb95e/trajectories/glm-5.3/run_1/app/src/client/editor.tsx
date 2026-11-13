import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiFailure } from "./api.js";
import { copy, trialEndedBanner } from "../shared/copy.js";
import { idlePrompt, prompts, resolveCommand } from "../shared/commands.js";
import { formatLength, round } from "../shared/format.js";
import {
  applyGrid,
  applyOrtho,
  applyPolar,
  distanceTo,
  fitViewport,
  parseCoordinate,
  toModel,
  zoomPercent,
  type CanvasBox,
  type Point,
  type SnapCandidate,
  type Viewport,
} from "./canvas.js";
import type { DrawingObject, Layer, Units } from "../shared/types.js";
import type {
  ActivityResponse,
  CommandResponse,
  DrawingResponse,
  IssuesResponse,
  MeasureResponse,
  MeResponse,
} from "./types.js";
import { CanvasView, nearestObjectTo } from "./canvas-view.js";
import { EditorPanels } from "./panels.js";
import { EditorDialogs, ConflictDialog } from "./dialogs.js";
import { Ribbon, LayoutTabs, EditorHeader, StatusBar, CommandLine } from "./editor-chrome.js";

export interface AidsState {
  osnap: boolean;
  ortho: boolean;
  polar: boolean;
  snapGrid: boolean;
  otrack: boolean;
}

export interface RunningCommand {
  name: string;
  step: number;
  points: Point[];
  handles: string[];
  buffer: string;
  /** The chain's original start, so C can close back to it. */
  origin?: Point;
}

export function EditorPage(props: {
  me: MeResponse | null;
  drawingId: string;
  linkToken: string | null;
  onMe: () => void;
}): JSX.Element {
  const [drawing, setDrawing] = useState<DrawingResponse | null>(null);
  const [view, setView] = useState<Viewport | null>(null);
  const [box, setBox] = useState<CanvasBox | null>(null);
  const [aids, setAids] = useState<AidsState>(() => loadAids());
  const [selection, setSelection] = useState<string[]>([]);
  const [command, setCommand] = useState<RunningCommand | null>(null);
  const [history, setHistory] = useState<Array<{ id: number; text: string }>>([]);
  const [prompt, setPrompt] = useState(idlePrompt);
  const [collaborators, setCollaborators] = useState<Array<{ name: string; state: string }>>([]);
  const [sync, setSync] = useState("");
  const [activity, setActivity] = useState<string[]>([]);
  const [issues, setIssues] = useState<IssuesResponse["issues"]>([]);
  const [dialog, setDialog] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [remoteHighlights, setRemoteHighlights] = useState<string[]>([]);
  const [traceActive, setTraceActive] = useState<string | null>(null);
  const [traceStrokes, setTraceStrokes] = useState<DrawingObject[]>([]);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [trialEnded, setTrialEnded] = useState(false);
  const insertBuffer = useRef<{ block: string; scale: number; rotation: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tabId = useMemo(() => Math.random().toString(36).slice(2), []);
  const lastInput = useRef(0);
  const commandRef = useRef<RunningCommand | null>(null);
  commandRef.current = command;

  const units: Units = drawing?.units ?? "mm";

  const pushHistory = useCallback((text: string): void => {
    setHistory((current) => [...current.slice(-40), { id: Date.now() + Math.random(), text }]);
  }, []);

  const announce = useCallback((text: string): void => {
    setAnnouncement(text);
  }, []);

  // ---- Load drawing and side data ----
  const load = useCallback(async (): Promise<void> => {
    const headers: Record<string, string> = props.linkToken ? { authorization: `Link ${props.linkToken}` } : {};
    try {
      const doc = await api<DrawingResponse>(`/api/drawings/${props.drawingId}`, { headers });
      setDrawing(doc);
      setSync(copy.syncSynced(doc.version));
      const act = await api<ActivityResponse>(`/api/drawings/${props.drawingId}/activity`, { headers });
      setActivity(act.entries.map((e) => e.text));
      const iss = await api<IssuesResponse>(`/api/drawings/${props.drawingId}/issues`, { headers });
      setIssues(iss.issues);
    } catch (err) {
      if (err instanceof ApiFailure && (err.code === "link_expired" || err.code === "link_revoked")) {
        window.location.reload();
      }
    }
  }, [props.drawingId, props.linkToken]);

  useEffect(() => {
    void load();
    if (!props.linkToken) {
      void api(`/api/drawings/${props.drawingId}/opened`, { method: "POST" }).catch(() => undefined);
    }
  }, [load, props.drawingId, props.linkToken]);

  // ---- Fit view once drawing and box exist ----
  useEffect(() => {
    const node = wrapRef.current;
    if (!node || !drawing) return;
    const measure = (): void => {
      const rect = node.getBoundingClientRect();
      const b: CanvasBox = { left: 0, top: 0, width: rect.width, height: rect.height };
      setBox(b);
      setView((current) => current ?? fitViewport(visibleOf(drawing), b));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [drawing]);

  // ---- Live events ----
  useEffect(() => {
    if (!drawing) return;
    const events = new EventSource(`/api/drawings/${props.drawingId}/events`);
    const on = (name: string, fn: (data: Record<string, unknown>) => void): void => {
      events.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent).data)));
    };
    on("change", (data) => {
      const version = Number(data.version ?? 0);
      const changed = (data.changed as string[]) ?? [];
      const actor = String(data.actor ?? "");
      setSync(copy.syncing);
      void load().then(() => {
        if (actor !== (props.me?.user.name ?? "") && changed.length > 0) {
          setRemoteHighlights(changed);
          setTimeout(() => setRemoteHighlights([]), 1600);
        }
      });
      void version;
    });
    on("presence", (data) => {
      setCollaborators((data.collaborators as Array<{ name: string; state: string }>) ?? []);
    });
    on("activity", (data) => {
      const entry = data.entry as { text: string } | undefined;
      if (entry) setActivity((current) => [entry.text, ...current].slice(0, 50));
    });
    on("issues", (data) => setIssues((data.issues as IssuesResponse["issues"]) ?? []));
    on("trace", (data) => {
      const submitted = data.submitted as { name: string; reviewer: string } | undefined;
      if (submitted) {
        pushHistory(copy.traceSubmitted(submitted.name, submitted.reviewer));
        void load();
      }
      const trace = data.trace as { state?: string } | undefined;
      if (trace?.state === "submitted") void load();
    });
    on("link", (data) => {
      const status = String(data.status ?? "");
      if (status === "revoked" || status === "expired") window.location.reload();
    });
    on("trial", (data) => {
      const ended = Boolean(data.ended);
      if (ended) setTrialEnded(true);
    });
    on("sync", (data) => {
      const state = String(data.state ?? "live");
      if (state === "paused") setSync(copy.syncPaused);
    });
    events.onerror = () => setSync(copy.syncPaused);
    return () => events.close();
  }, [drawing, load, props.drawingId, pushHistory]);

  // ---- Presence heartbeat ----
  const trackInput = useCallback((): void => {
    const now = Date.now();
    if (now - lastInput.current >= 2000) {
      lastInput.current = now;
      void api(`/api/drawings/${props.drawingId}/presence`, { json: { tab_id: tabId } }).catch(() => undefined);
    }
  }, [props.drawingId, tabId]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      trackInput();
      const target = e.target as HTMLElement;
      const inText = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      if (e.key === "Escape") {
        if (commandRef.current) {
          setCommand(null);
          setPrompt(idlePrompt);
          pushHistory(copy.cancelled);
          inputRef.current?.focus();
        } else if (dialog) {
          setDialog(null);
        } else {
          setSelection([]);
        }
        return;
      }
      // Editor shortcuts work whichever control has focus. Ctrl+Z and Ctrl+Y
      // stay text edits while typing in a field.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setDialog("export");
        return;
      }
      const isTextEdit = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y");
      if (inText && isTextEdit) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void runCommand("UNDO", {});
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void runCommand("REDO", {});
        return;
      }
      if (inText) return;
      const aidKeys: Record<string, keyof AidsState> = {
        F3: "osnap",
        F8: "ortho",
        F9: "snapGrid",
        F10: "polar",
        F11: "otrack",
      };
      if (e.key === "F1") {
        e.preventDefault();
        setDialog("reference");
        return;
      }
      if (aidKeys[e.key]) {
        e.preventDefault();
        setAids((current) => toggleAidState(current, aidKeys[e.key], pushHistory));
        return;
      }
      if ((e.key === "+" || e.key === "-") && target.className.includes("canvas")) {
        zoomBy(e.key === "+" ? 1.25 : 1 / 1.25);
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog, trackInput, pushHistory]);

  useEffect(() => {
    if (drawing !== null) inputRef.current?.focus();
  }, [drawing]);

  useEffect(() => {
    const onInsert = (e: Event): void => {
      const detail = (e as CustomEvent<{ block: string; scale: number; rotation: number }>).detail;
      insertBuffer.current = detail;
      const refusal = checkAccess("INSERT");
      if (refusal) {
        pushHistory(refusal);
        return;
      }
      setCommand({ name: "INSERT", step: 0, points: [], handles: [], buffer: `${detail.block}|${detail.scale}|${detail.rotation}` });
      setPrompt(prompts.INSERT[0]);
      inputRef.current?.focus();
    };
    window.addEventListener("corbel-insert", onInsert);
    return () => window.removeEventListener("corbel-insert", onInsert);
  }, []);

  const zoomBy = (factor: number): void => {
    setView((current) => {
      if (!current || !box) return current;
      const cx = box.width / 2;
      const cy = box.height / 2;
      const model = toModel(cx, cy, current, box);
      const scale = current.scale * factor;
      return { scale, centre: model, fittedScale: current.fittedScale };
    });
  };

  useEffect(() => {
    const onZoom = (e: Event): void => {
      const detail = (e as CustomEvent<{ factor: number; x: number; y: number }>).detail;
      setView((current) => {
        if (!current || !box) return current;
        const anchor = toModel(detail.x, detail.y, current, box);
        const scale = current.scale * detail.factor;
        const nx = anchor[0] + (box.width / 2 - detail.x) / scale;
        const ny = anchor[1] - (box.height / 2 - detail.y) / scale;
        return { scale, centre: [nx, ny], fittedScale: current.fittedScale };
      });
    };
    window.addEventListener("corbel-zoom", onZoom);
    return () => window.removeEventListener("corbel-zoom", onZoom);
  }, [box]);

  // ---- Commands ----
  const traceCommands = new Set(["LINE", "PLINE", "CIRCLE", "MTEXT", "ERASE"]);

  const runCommand = async (name: string, args: Record<string, unknown>): Promise<void> => {
    if (!drawing) return;
    // Inside an active trace, the trace commands draw on the trace, never the base.
    if (traceActive && traceCommands.has(name) && drawing.access === "markup") {
      const traceHeaders: Record<string, string> = props.linkToken ? { authorization: `Link ${props.linkToken}` } : {};
      await api(`/api/traces/${traceActive}/commands`, { json: { command: name, args }, headers: traceHeaders });
      await load();
      return;
    }
    if (drawing.access === "markup" && !traceActive && traceCommands.has(name)) {
      pushHistory(copy.markupOnly);
      return;
    }
    setSync(copy.syncing);
    try {
      const headers: Record<string, string> = props.linkToken ? { authorization: `Link ${props.linkToken}` } : {};
      const result = await api<CommandResponse>(`/api/drawings/${props.drawingId}/commands`, {
        json: { base_version: drawing.version, command: name, args },
        headers,
      });
      setSync(copy.syncSynced(result.version));
      if (result.history) pushHistory(result.history);
      await load();
      if (result.locked.length > 0 && !result.history) pushHistory(copy.lockedOut(result.locked.length));
      const dims = result.objects.filter((o) => o.type === "dimension");
      for (const dim of dims) {
        const text = (dim as { text?: string }).text ?? "";
        announce(copy.dimensionAdded(text));
      }
      return;
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.code === "version_conflict") {
          const changed = (err.extra.changed as string[]) ?? [];
          setConflict(copy.conflictDialog(changed.length));
          setDrawing((current) => (current ? { ...current, version: Number(err.extra.current_version) } : current));
          setSync(copy.syncConflict(Number(err.extra.current_version)));
        } else if (err.code === "trial_ended") {
          setTrialEnded(true);
          pushHistory(trialEndedBanner);
        } else if (err.code === "view_only") {
          pushHistory(copy.viewOnly);
        } else if (err.code === "markup_only") {
          pushHistory(copy.markupOnly);
        } else if (err.code === "layer_zero") {
          pushHistory(copy.layerZeroDelete);
        } else if (err.code === "layer_current") {
          pushHistory(copy.layerCurrentDelete(""));
        } else if (err.code === "layer_locked") {
          pushHistory(copy.layerLockedDelete(""));
        } else if (err.code === "layer_in_use") {
          pushHistory(copy.layerInUse("", Number(err.extra.objects ?? 0)));
        } else {
          const first = Object.values(err.fields)[0];
          pushHistory(first ?? err.code);
        }
      }
    }
  };

  const checkAccess = (name: string): string | null => {
    if (!drawing) return null;
    const baseCommands = new Set([
      "LINE", "PLINE", "RECTANG", "CIRCLE", "ARC", "POLYGON", "SPLINE", "MTEXT", "INSERT",
      "DIMLINEAR", "DIMALIGNED", "DIMRADIUS", "DIMANGULAR", "MOVE", "COPY", "ROTATE", "SCALE",
      "MIRROR", "ERASE", "OFFSET", "TRIM", "EXTEND", "FILLET", "PROPERTIES", "REVCLOUD",
    ]);
    if (!baseCommands.has(name)) return null;
    if (drawing.access === "view") return copy.viewOnly;
    if (drawing.access === "markup" && !traceActive) return copy.markupOnly;
    return null;
  };

  const startCommand = (name: string): void => {
    const refusal = checkAccess(name);
    if (refusal) {
      pushHistory(refusal);
      return;
    }
    if (name === "UNDO" || name === "REDO") {
      void runCommand(name, {});
      return;
    }
    if (name === "LAYER") {
      setDialog("layers");
      return;
    }
    if (name === "INSERT") {
      setDialog("blocks");
      return;
    }
    if (name === "ZOOM") {
      setCommand({ name, step: 0, points: [], handles: [], buffer: "" });
      setPrompt(prompts.ZOOM[0]);
      inputRef.current?.focus();
      return;
    }
    const withBlock = insertBuffer.current;
    if (name === "INSERT_BLOCK") {
      setCommand({ name: "INSERT", step: 0, points: [], handles: [], buffer: `${withBlock!.block}|${withBlock!.scale}|${withBlock!.rotation}` });
      setPrompt(prompts.INSERT[0]);
      inputRef.current?.focus();
      return;
    }
    setCommand({ name, step: 0, points: [], handles: [], buffer: "" });
    setPrompt(nextPromptFor(name, 0));
    inputRef.current?.focus();
  };

  const nextPromptFor = (name: string, step: number): string => {
    const list = prompts[name] ?? [];
    return list[Math.min(step, list.length - 1)] ?? idlePrompt;
  };

  const lastPoint = (): Point | null => {
    const running = commandRef.current;
    if (!running || running.points.length === 0) return null;
    return running.points[running.points.length - 1];
  };

  const resolvePoint = (modelPoint: Point, snapped: SnapCandidate | null): Point => {
    let result = snapped && aids.osnap ? snapped.point : modelPoint;
    if (aids.ortho) result = applyOrtho(result, lastPoint());
    else if (aids.polar) result = applyPolar(result, lastPoint());
    else if (aids.snapGrid && !snapped) result = applyGrid(result);
    return [round(result[0], 6), round(result[1], 6)];
  };

  const submitLine = async (text: string): Promise<void> => {
    trackInput();
    const trimmedValue = text.trim();
    const running = commandRef.current;
    if (running) {
      await feedCommand(running, trimmedValue);
      return;
    }
    if (trimmedValue === "") return;
    // A typed handle at the idle prompt selects that object.
    const handlePick = /^#([0-9A-F]+)$/i.exec(trimmedValue);
    if (handlePick) {
      const handle = handlePick[1].toUpperCase();
      const obj = drawing?.objects.find((o) => o.handle === handle);
      if (!obj) {
        pushHistory(copy.noObjectFound);
        return;
      }
      setSelection((current) => (current.includes(handle) ? current : [...current, handle]));
      inputRef.current?.focus();
      return;
    }
    const resolved = resolveCommand(trimmedValue);
    if (resolved) {
      pushHistory(`Command: ${resolved}`);
      startCommand(resolved);
      return;
    }
    pushHistory(copy.unknownCommand(trimmedValue));
  };

  const feedCommand = async (running: RunningCommand, text: string): Promise<void> => {
    const name = running.name;
    const upper = text.toUpperCase();
    if (name === "ZOOM") {
      if (upper === "E" && box) {
        setView(fitViewport(drawing ? visibleOf(drawing) : [], box));
        setCommand(null);
        setPrompt(idlePrompt);
      }
      return;
    }
    if (upper === "U" && running.points.length > 0) {
      const step = Math.max(0, running.step - 1);
      setCommand({ ...running, points: running.points.slice(0, -1), step });
      setPrompt(nextPromptFor(name, step));
      return;
    }
    if (upper === "C" && (name === "LINE" || name === "PLINE" || name === "SPLINE") && running.points.length >= 1 && running.origin) {
      // C closes the chain back to the origin and ends the command.
      await runCommand("LINE", { points: [...running.points, running.origin], close: false });
      setCommand(null);
      setPrompt(idlePrompt);
      return;
    }
    if (name === "MTEXT" && running.step === 2) {
      if (trimmed(text) === "") return;
      const [first, opposite] = running.points;
      const position: Point = [Math.min(first[0], opposite[0]), Math.max(first[1], opposite[1])];
      await runCommand("MTEXT", {
        position,
        width: Math.abs(opposite[0] - first[0]) || 1000,
        height: 250,
        contents: text,
      });
      setCommand(null);
      setPrompt(idlePrompt);
      return;
    }
    if (name === "MIRROR" && running.step === 3) {
      await runCommand("MIRROR", {
        handles: running.handles,
        first: running.points[0],
        second: running.points[1],
        erase_source: upper.startsWith("Y"),
      });
      setCommand(null);
      setPrompt(idlePrompt);
      return;
    }
    if (text === "" && ["MOVE", "COPY", "ROTATE", "SCALE", "MIRROR", "ERASE", "OFFSET", "TRIM", "EXTEND", "FILLET"].includes(name)) {
      if (name === "OFFSET" || name === "TRIM" || name === "EXTEND" || name === "FILLET") {
        // Repeated until Enter.
        setCommand(null);
        setPrompt(idlePrompt);
        return;
      }
      if (running.step === 0 && running.handles.length === 0) {
        setCommand(null);
        setPrompt(idlePrompt);
        return;
      }
      if (name === "ERASE") {
        await runCommand("ERASE", { handles: running.handles });
        setCommand(null);
        setPrompt(idlePrompt);
        return;
      }
      const nextStep = 1;
      setCommand({ ...running, step: nextStep });
      setPrompt(nextPromptFor(name, nextStep));
      return;
    }
    const handleMatch = /^#([0-9A-F]+)$/i.exec(trimmed(text));
    if (handleMatch && ["MOVE", "COPY", "ROTATE", "SCALE", "MIRROR", "ERASE", "TRIM", "EXTEND", "OFFSET", "FILLET"].includes(name)) {
      const handle = handleMatch[1].toUpperCase();
      if (name === "TRIM" || name === "EXTEND") {
        setCommand({ ...running, handles: [handle] });
        return;
      }
      if (name === "OFFSET") {
        // A typed handle selects the object to offset; then the side point.
        setCommand({ ...running, handles: [handle], step: 2 });
        setPrompt(nextPromptFor("OFFSET", 2));
        return;
      }
      setCommand({ ...running, handles: [...running.handles, handle] });
      return;
    }
    const point = parseCoordinate(text, lastPoint(), units);
    if (point) {
      await acceptPoint(running, resolvePoint(point, null));
      return;
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed(text))) {
      await acceptNumber(running, Number.parseFloat(trimmed(text)));
      return;
    }
    pushHistory(copy.invalidPoint);
    setPrompt(nextPromptFor(name, running.step));
  };

  const acceptNumber = async (running: RunningCommand, value: number): Promise<void> => {
    const name = running.name;
    if (value <= 0 && ["CIRCLE", "POLYGON", "OFFSET", "FILLET", "SCALE"].includes(name)) {
      pushHistory(copy.requiresPositive);
      return;
    }
    switch (name) {
      case "CIRCLE":
        if (running.step === 1) {
          await runCommand("CIRCLE", { center: running.points[0], radius: value });
          setCommand(null);
          setPrompt(idlePrompt);
        }
        break;
      case "ARC":
        if (running.step === 1) {
          setCommand({ ...running, buffer: String(value), step: 2 });
          setPrompt(nextPromptFor("ARC", 2));
        } else if (running.step === 2) {
          await runCommand("ARC", {
            center: running.points[0],
            radius: Number.parseFloat(running.buffer),
            start_angle: value,
            end_angle: value,
          });
          setCommand(null);
          setPrompt(idlePrompt);
        }
        break;
      case "POLYGON":
        if (running.step === 0) {
          if (value < 3) {
            pushHistory(copy.requiresPositive);
            return;
          }
          setCommand({ ...running, buffer: String(value), step: 1 });
          setPrompt(nextPromptFor("POLYGON", 1));
        } else if (running.step === 2) {
          await runCommand("POLYGON", { center: running.points[0], sides: Number.parseInt(running.buffer), radius: value });
          setCommand(null);
          setPrompt(idlePrompt);
        }
        break;
      case "OFFSET":
        if (running.step === 0) {
          setCommand({ ...running, buffer: String(value), step: 1 });
          setPrompt(nextPromptFor("OFFSET", 1));
        }
        break;
      case "FILLET":
        if (running.step === 0) {
          setCommand({ ...running, buffer: String(value), step: 1 });
          setPrompt(nextPromptFor("FILLET", 1));
        }
        break;
      case "ROTATE":
        if (running.step === 2) {
          await runCommand("ROTATE", { handles: running.handles, base: running.points[0], angle: value });
          setCommand(null);
          setPrompt(idlePrompt);
        }
        break;
      case "SCALE":
        if (running.step === 2) {
          await runCommand("SCALE", { handles: running.handles, base: running.points[0], factor: value });
          setCommand(null);
          setPrompt(idlePrompt);
        }
        break;
    }
  };

  const acceptPoint = async (running: RunningCommand, point: Point): Promise<void> => {
    const name = running.name;
    const next = [...running.points, point];
    switch (name) {
      case "DIST":
        if (running.step === 0) {
          setCommand({ ...running, points: next, step: 1 });
          setPrompt(nextPromptFor("DIST", 1));
        } else {
          const headers: Record<string, string> = props.linkToken ? { authorization: `Link ${props.linkToken}` } : {};
          const result = await api<MeasureResponse>(`/api/drawings/${props.drawingId}/measure`, {
            json: { first: running.points[0], second: point },
            headers,
          });
          pushHistory(result.text);
          announce(`${result.text} (${units === "m" ? "meters" : "millimeters"})`);
          setCommand(null);
          setPrompt(idlePrompt);
        }
        return;
      case "LINE":
      case "PLINE":
      case "SPLINE":
        if (running.points.length === 0) {
          setCommand({ ...running, points: next, origin: point, step: 1 });
          setPrompt(nextPromptFor(name, 1));
        } else {
          await runCommand("LINE", { points: [...running.points, point], close: false });
          setCommand({ name, step: 2, points: [point], handles: [], buffer: "", origin: running.origin });
          setPrompt(nextPromptFor(name, 2));
        }
        return;
      case "RECTANG":
        if (running.step === 0) {
          setCommand({ ...running, points: next, step: 1 });
          setPrompt(nextPromptFor("RECTANG", 1));
        } else {
          await runCommand("RECTANG", { first: running.points[0], other: point });
          setCommand(null);
          setPrompt(idlePrompt);
        }
        return;
      case "CIRCLE":
        if (running.step === 0) {
          setCommand({ ...running, points: next, step: 1 });
          setPrompt(nextPromptFor("CIRCLE", 1));
        }
        return;
      case "ARC":
        if (running.step === 0) {
          setCommand({ ...running, points: next, step: 1 });
          setPrompt(nextPromptFor("ARC", 1));
        }
        return;
      case "POLYGON":
        if (running.step === 1) {
          setCommand({ ...running, points: next, step: 2 });
          setPrompt(nextPromptFor("POLYGON", 2));
        }
        return;
      case "MTEXT":
        if (running.step === 0) {
          setCommand({ ...running, points: next, step: 1 });
          setPrompt(nextPromptFor("MTEXT", 1));
        } else if (running.step === 1) {
          setCommand({ ...running, points: next, step: 2 });
          setPrompt(nextPromptFor("MTEXT", 2));
        }
        return;
      case "MOVE":
      case "COPY":
        if (running.step === 1) {
          setCommand({ ...running, points: next, step: 2 });
          setPrompt(nextPromptFor(name, 2));
        } else {
          await runCommand(name, { handles: running.handles, from: running.points[0], to: point });
          setCommand(null);
          setPrompt(idlePrompt);
        }
        return;
      case "ROTATE":
        if (running.step === 1) {
          setCommand({ ...running, points: next, step: 2 });
          setPrompt(nextPromptFor("ROTATE", 2));
        } else {
          const angle = (Math.atan2(point[1] - running.points[0][1], point[0] - running.points[0][0]) * 180) / Math.PI;
          await runCommand("ROTATE", { handles: running.handles, base: running.points[0], angle });
          setCommand(null);
          setPrompt(idlePrompt);
        }
        return;
      case "SCALE":
        if (running.step === 1) {
          setCommand({ ...running, points: next, step: 2 });
          setPrompt(nextPromptFor("SCALE", 2));
        } else {
          const factor = Math.hypot(point[0] - running.points[0][0], point[1] - running.points[0][1]) / 1000;
          await runCommand("SCALE", { handles: running.handles, base: running.points[0], factor: Math.max(0.01, factor) });
          setCommand(null);
          setPrompt(idlePrompt);
        }
        return;
      case "MIRROR":
        if (running.step === 1) {
          setCommand({ ...running, points: next, step: 2 });
          setPrompt(nextPromptFor("MIRROR", 2));
        } else {
          setCommand({ ...running, points: next, step: 3 });
          setPrompt(nextPromptFor("MIRROR", 3));
        }
        return;
      case "DIMLINEAR":
      case "DIMALIGNED":
        if (running.step < 2) {
          setCommand({ ...running, points: next, step: running.step + 1 });
          setPrompt(nextPromptFor(name, running.step + 1));
        } else {
          await runCommand(name, { first: running.points[0], second: running.points[1], location: point });
          setCommand(null);
          setPrompt(idlePrompt);
        }
        return;
      case "DIMRADIUS": {
        const target = drawing ? nearestObjectTo(drawing, running.points[0], 10) : null;
        if (!target || (target.type !== "circle" && target.type !== "arc")) {
          pushHistory(copy.noObjectFound);
          return;
        }
        if (running.step === 0) {
          setCommand({ ...running, handles: [target.handle], points: next, step: 1 });
          setPrompt(nextPromptFor("DIMRADIUS", 1));
        } else {
          await runCommand("DIMRADIUS", { handle: running.handles[0], location: point });
          setCommand(null);
          setPrompt(idlePrompt);
        }
        return;
      }
      case "DIMANGULAR":
        if (running.step === 0) {
          const target = drawing ? nearestObjectTo(drawing, point, 10) : null;
          if (!target) {
            pushHistory(copy.noObjectFound);
            return;
          }
          setCommand({ ...running, handles: [target.handle], step: 1 });
          setPrompt(nextPromptFor("DIMANGULAR", 1));
        } else if (running.step === 1) {
          const target = drawing ? nearestObjectTo(drawing, point, 10) : null;
          if (!target) {
            pushHistory(copy.noObjectFound);
            return;
          }
          setCommand({ ...running, handles: [...running.handles, target.handle], step: 2 });
          setPrompt(nextPromptFor("DIMANGULAR", 2));
        } else {
          await runCommand("DIMANGULAR", { first_handle: running.handles[0], second_handle: running.handles[1], location: point });
          setCommand(null);
          setPrompt(idlePrompt);
        }
        return;
      case "TRIM":
      case "EXTEND": {
        const target = drawing ? nearestObjectTo(drawing, point, 10) : null;
        if (!target) {
          pushHistory(copy.noObjectFound);
          return;
        }
        await runCommand(name, { handle: target.handle, pick: point });
        setPrompt(nextPromptFor(name, 0));
        return;
      }
      case "OFFSET":
        if (running.step === 1) {
          const target = drawing ? nearestObjectTo(drawing, point, 10) : null;
          if (!target) {
            pushHistory(copy.noObjectFound);
            return;
          }
          setCommand({ ...running, handles: [target.handle], step: 2 });
          setPrompt(nextPromptFor("OFFSET", 2));
        } else if (running.step === 2) {
          await runCommand("OFFSET", {
            handle: running.handles[0],
            distance: Number.parseFloat(running.buffer),
            side: point,
          });
          setCommand({ name: "OFFSET", step: 1, points: [], handles: [], buffer: running.buffer });
          setPrompt(nextPromptFor("OFFSET", 1));
        }
        return;
      case "FILLET":
        if (running.step === 1) {
          const target = drawing ? nearestObjectTo(drawing, point, 10) : null;
          if (!target) {
            pushHistory(copy.noObjectFound);
            return;
          }
          setCommand({ ...running, handles: [target.handle], step: 2 });
          setPrompt(nextPromptFor("FILLET", 2));
        } else if (running.step === 2) {
          const target = drawing ? nearestObjectTo(drawing, point, 10) : null;
          if (!target) {
            pushHistory(copy.noObjectFound);
            return;
          }
          await runCommand("FILLET", { handles: [running.handles[0], target.handle], radius: Number.parseFloat(running.buffer) });
          setCommand(null);
          setPrompt(idlePrompt);
        }
        return;
      case "INSERT": {
        const [block, scaleText, rotationText] = running.buffer.split("|");
        await runCommand("INSERT", {
          block: block ?? "Door 900",
          position: point,
          scale: Number.parseFloat(scaleText ?? "1") || 1,
          rotation: Number.parseFloat(rotationText ?? "0") || 0,
        });
        announce(copy.blockInserted(block ?? "Door 900", formatLength(point[0], units), formatLength(point[1], units)));
        setCommand(null);
        setPrompt(idlePrompt);
        return;
      }
      case "REVCLOUD":
        if (running.step === 0) {
          setCommand({ ...running, points: next, step: 1 });
          setPrompt(nextPromptFor("REVCLOUD", 1));
        } else if (traceActive) {
          const traceHeaders: Record<string, string> = props.linkToken ? { authorization: `Link ${props.linkToken}` } : {};
          await api(`/api/traces/${traceActive}/commands`, {
            json: { command: "REVCLOUD", args: { first: running.points[0], opposite: point } },
            headers: traceHeaders,
          });
          setCommand(null);
          setPrompt(idlePrompt);
          await load();
        } else {
          pushHistory(copy.markupOnly);
        }
        return;
      default:
        return;
    }
  };

  const handleCanvasPick = useCallback(
    (point: Point, snapped: SnapCandidate | null): Promise<void> => {
      const resolved = resolvePoint(point, snapped);
      const running = commandRef.current;
      if (running) {
        return acceptPoint(running, resolved);
      }
      const target = drawing ? nearestObjectTo(drawing, resolved, 5 / (view?.scale ?? 1)) : null;
      if (target) {
        setSelection((current) => (current.includes(target.handle) ? current : [...current, target.handle]));
      } else {
        setSelection([]);
      }
      return Promise.resolve();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawing, view, aids, traceActive, units],
  );

  const handleTraceOpen = useCallback(
    async (traceId: string, name: string): Promise<void> => {
      setTraceActive(traceId);
      setTraceStrokes([]);
      const trace = drawing?.traces.find((t) => t.id === traceId);
      if (trace) setTraceStrokes(trace.objects);
      pushHistory(copy.tracing(name));
    },
    [drawing, pushHistory],
  );

  const ready = drawing !== null && view !== null && box !== null;

  const selectedObjects = drawing === null ? [] : drawing.objects.filter((o) => selection.includes(o.handle));
  const trialOver = trialEnded || (drawing?.access === "owner" && props.me?.trial.ended === true);

  if (!ready || drawing === null || view === null || box === null) {
    return (
      <div className="editor">
        <div className="editor-main">
          <div className="canvas-wrap" ref={wrapRef} />
        </div>
        <div className="empty-state">Loading…</div>
      </div>
    );
  }

  return (
    <div className="editor">
      <EditorHeader
        drawing={drawing}
        me={props.me}
        sync={sync || copy.syncSynced(drawing.version)}
        collaborators={collaborators}
        onDialog={setDialog}
        onUndoRedo={(name) => void runCommand(name, {})}
        trialEnded={trialOver}
      />
      <Ribbon drawing={drawing} traceActive={traceActive !== null} onStart={startCommand} />
      {traceActive && (
        <div className="status-chip" role="status" aria-label="Trace" style={{ margin: "6px 10px", display: "inline-flex" }}>
          {copy.tracing(drawing.traces.find((t) => t.id === traceActive)?.name ?? "")}
        </div>
      )}
      {(trialOver || props.me === null) && drawing.access !== "view" && props.me?.trial.ended && (
        <div className="banner banner-error" role="status" aria-label="Service status">{trialEndedBanner}</div>
      )}
      <div className="editor-main">
        <EditorPanels
          drawing={drawing}
          selected={selectedObjects}
          onSelection={setSelection}
          onCommand={(name, args) => void runCommand(name, args)}
          onReload={load}
          issues={issues}
          activity={activity}
          traceActive={traceActive}
          onTraceActive={(id) => {
            if (id === null) {
              setTraceActive(null);
              setTraceStrokes([]);
            } else {
              const trace = drawing.traces.find((t) => t.id === id);
              if (trace) void handleTraceOpen(id, trace.name);
            }
          }}
          onInsert={insertBuffer.current}
          me={props.me}
          linkToken={props.linkToken}
        />
        <div className="canvas-wrap" ref={wrapRef}>
          <CanvasView
            drawing={drawing}
            view={view}
            box={box}
            aids={aids}
            selection={selection}
            traceActive={traceActive}
            remoteHighlights={remoteHighlights}
            traceStrokes={traceStrokes}
            units={units}
            onCursor={setCursor}
            onPick={(point, snapped) => void handleCanvasPick(point, snapped)}
            onTrackInput={trackInput}
          />
        </div>
      </div>
      <LayoutTabs drawing={drawing} onCommand={(name, args) => void runCommand(name, args)} />
      <StatusBar
        aids={aids}
        onToggle={(aid) => setAids((current) => toggleAidState(current, aid, pushHistory))}
        cursor={cursor}
        zoom={zoomPercent(view)}
        units={units}
      />
      <CommandLine
        history={history}
        prompt={prompt}
        inputRef={inputRef}
        onSubmit={(text) => void submitLine(text)}
        onCancel={() => {
          setCommand(null);
          setPrompt(idlePrompt);
          pushHistory(copy.cancelled);
        }}
      />
      <AnnouncementsRegion text={announcement} />
      {conflict && (
        <ConflictDialog
          text={conflict}
          onClose={() => {
            setConflict(null);
            inputRef.current?.focus();
          }}
          onLoadLatest={async () => {
            await load();
            setConflict(null);
            inputRef.current?.focus();
          }}
        />
      )}
      {dialog && (
        <EditorDialogs
          dialog={dialog}
          onClose={() => {
            setDialog(null);
            inputRef.current?.focus();
          }}
          drawing={drawing}
          onCommand={(name, args) => void runCommand(name, args)}
          onReload={load}
          me={props.me}
          onStartTrace={async (id) => {
            const trace = drawing.traces.find((t) => t.id === id);
            if (trace) await handleTraceOpen(id, trace.name);
            setDialog(null);
            inputRef.current?.focus();
          }}
          onAnnounce={announce}
          onCommandHistory={pushHistory}
        />
      )}
    </div>
  );
}

function AnnouncementsRegion(props: { text: string | null }): JSX.Element {
  return (
    <div className="sr-only" role="status" aria-label="Announcements" aria-live="polite">
      {props.text}
    </div>
  );
}

function visibleOf(doc: DrawingResponse): DrawingObject[] {
  const map = new Map<string, Layer>();
  for (const layer of doc.layers) map.set(layer.name, layer);
  return doc.objects.filter((o) => {
    const layer = map.get(o.layer);
    return layer && layer.on && !layer.frozen;
  });
}

function loadAids(): AidsState {
  const saved = sessionStorage.getItem("corbel_aids");
  return saved ? (JSON.parse(saved) as AidsState) : { osnap: true, ortho: false, polar: false, snapGrid: false, otrack: false };
}

function toggleAidState(current: AidsState, aid: keyof AidsState, push: (text: string) => void): AidsState {
  const next: AidsState = { ...current, [aid]: !current[aid] };
  if (aid === "ortho" && next.ortho) next.polar = false;
  if (aid === "polar" && next.polar) next.ortho = false;
  sessionStorage.setItem("corbel_aids", JSON.stringify(next));
  const lines: Record<keyof AidsState, [string, string]> = {
    osnap: ["<Osnap on>", "<Osnap off>"],
    ortho: ["<Ortho on>", "<Ortho off>"],
    polar: ["<Polar on>", "<Polar off>"],
    snapGrid: ["<Snap on>", "<Snap off>"],
    otrack: ["<Otrack on>", "<Otrack off>"],
  };
  push(next[aid] ? lines[aid][0] : lines[aid][1]);
  return next;
}

function trimmed(text: string): string {
  return text.trim();
}

export function distanceToObject(obj: DrawingObject, p: Point): number {
  return distanceTo(obj, p);
}
