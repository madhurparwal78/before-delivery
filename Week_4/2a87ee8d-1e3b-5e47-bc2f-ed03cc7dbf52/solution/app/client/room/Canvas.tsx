// The board canvas: frames, clusters, notes and connectors on the dotted ground, panned and zoomed by
// transform. Notes drag with a spring drop and snap back honestly; the keyboard picks up, reorders and moves
// them; the face-down reveal wave runs here.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Minus, MoreHorizontal, Plus } from "lucide-react";
import { api, ApiFailure, opId } from "../api.js";
import { crossfade, entrance, flip, glide, lands, lift, rankGap, snapBack, springDrop } from "../motion.js";
import { noteCount } from "../format.js";
import { Dialog, Ticker } from "../ui.js";
import { CLUSTER_GAP, NOTE_HEIGHT, NOTE_WIDTH } from "../../shared/layout.js";
import { isEnded } from "../../shared/states.js";
import type { Cluster, Frame, Note, Presence } from "../types.js";
import { boardBounds, canCluster, CLUSTER_WIDTH, clusterHeight, freeSpot, isBeingCreated, isCardBack, noteName, notePlace, type NotePatch, type Pending } from "./model.js";
import type { RoomActions, Wave } from "./Room.js";
import { Menu, TitlePrompt } from "./Editors.js";

export interface Cursor extends Presence {
  at: number;
}

export interface CanvasHandle {
  fit: () => void;
  zoomBy: (factor: number) => void;
  centreFrame: (id: string) => void;
  centreNote: (id: string) => void;
  nearestFrame: () => string | null;
  focusNote: (id: string) => void;
}

interface Camera {
  x: number;
  y: number;
  z: number;
}

interface Props {
  actions: RoomActions;
  waves: Map<string, Wave>;
  landed: Set<string>;
  cursors: Map<string, Cursor>;
  reduced: boolean;
  focusHeading: React.MutableRefObject<string | null>;
  onWaveDone: (frameId: string, token: number) => void;
  onPreview: (p: Pending | null) => void;
}

const TOOLBAR_SPACE = 96;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

interface Drag {
  noteId: string;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastT: number;
  vx: number;
  vy: number;
  el: HTMLElement;
  lifted: boolean;
  lift: Animation | null;
}

interface Pick {
  noteId: string;
  frameId: string;
  clusterId: string | null;
  index: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas({ actions, waves, landed, cursors, reduced, focusHeading, onWaveDone, onPreview }, ref) {
  const { board, view, facilitator } = actions;
  const main = useRef<HTMLElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Camera | null>(null);
  const camRef = useRef<Camera>({ x: 0, y: 0, z: 1 });
  if (cam) camRef.current = cam;
  const drag = useRef<Drag | null>(null);
  const pan = useRef<{ id: number; x: number; y: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const springs = useRef(new Map<string, { cx: number; cy: number; vx: number; vy: number; scale: number }>());
  const snaps = useRef(new Map<string, { cx: number; cy: number }>());
  const focusNoteId = useRef<string | null>(null);
  const known = useRef<Set<string> | null>(null);
  const started = useRef(new Set<string>());
  const lastPresence = useRef<{ t: number; x: number; y: number } | null>(null);
  const presenceTimer = useRef(0);
  const [pick, setPick] = useState<Pick | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [frameMenu, setFrameMenu] = useState<{ frameId: string; rename: boolean; at: { x: number; y: number } } | null>(null);
  const [clusterMenu, setClusterMenu] = useState<{ clusterId: string; rename: boolean; at: { x: number; y: number } } | null>(null);
  const below = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4 };
  };
  const status = board.workshop.status;
  const ended = isEnded(status);

  const area = () => {
    const el = main.current;
    return el ? { width: el.clientWidth, height: Math.max(120, el.clientHeight - TOOLBAR_SPACE) } : { width: 800, height: 600 };
  };

  const fitRect = useCallback((r: { x: number; y: number; width: number; height: number }, maxZoom: number) => {
    const a = area();
    const z = clamp(Math.min((a.width - 32) / r.width, (a.height - 32) / r.height), 0.02, maxZoom);
    setCam({ z, x: a.width / 2 - (r.x + r.width / 2) * z, y: a.height / 2 - (r.y + r.height / 2) * z });
  }, []);

  const fit = useCallback(() => fitRect(boardBounds(board.frames), MAX_ZOOM), [board.frames, fitRect]);

  useLayoutEffect(() => {
    if (!cam) fitRect(boardBounds(board.frames), 1);
  }, [cam, board.frames, fitRect]);

  const zoomAt = (factor: number, px: number, py: number, floor = MIN_ZOOM) => {
    const c = camRef.current;
    const z = clamp(c.z * factor, Math.min(floor, c.z), MAX_ZOOM);
    setCam({ z, x: px - ((px - c.x) * z) / c.z, y: py - ((py - c.y) * z) / c.z });
  };

  const noteEl = (id: string) => world.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(id)}"]`) ?? null;

  const centreOn = (wx: number, wy: number, w: number, h: number) => {
    const a = area();
    const c = camRef.current;
    const z = Math.min(c.z, (a.width - 32) / w, (a.height - 32) / h);
    setCam({ z, x: a.width / 2 - wx * z, y: a.height / 2 - wy * z });
  };

  useImperativeHandle(ref, () => ({
    fit,
    zoomBy: (factor) => {
      const a = area();
      zoomAt(factor, a.width / 2, a.height / 2);
    },
    centreFrame: (id) => {
      const f = board.frames.find((x) => x.id === id);
      if (!f) return;
      centreOn(f.x + f.width / 2, f.y + f.height / 2, f.width, f.height);
      main.current?.querySelector<HTMLElement>(`[data-frame-id="${CSS.escape(id)}"] h2`)?.focus({ preventScroll: true });
    },
    centreNote: (id) => {
      const n = view.byId.get(id);
      const f = n && board.frames.find((x) => x.id === n.frameId);
      if (!n || !f) return;
      const p = notePlace(n, view);
      centreOn(f.x + p.x + NOTE_WIDTH / 2, f.y + p.y + NOTE_HEIGHT / 2, NOTE_WIDTH, NOTE_HEIGHT);
      focusNoteId.current = id;
      noteEl(id)?.focus({ preventScroll: true });
    },
    nearestFrame: () => {
      const a = area();
      const c = camRef.current;
      const wx = (a.width / 2 - c.x) / c.z;
      const wy = (a.height / 2 - c.y) / c.z;
      let best: Frame | null = null;
      let bestD = Infinity;
      for (const f of board.frames) {
        const d = Math.hypot(f.x + f.width / 2 - wx, f.y + f.height / 2 - wy);
        if (d < bestD) {
          best = f;
          bestD = d;
        }
      }
      return best?.id ?? null;
    },
    focusNote: (id) => {
      focusNoteId.current = id;
      noteEl(id)?.focus({ preventScroll: true });
    },
  }));

  // Entrance on first load, "note lands" for every note that appears later, queued springs and snap-backs,
  // and focus that must follow a note across re-renders.
  useLayoutEffect(() => {
    const root = world.current;
    if (!root || !cam) return;
    const els = [...root.querySelectorAll<HTMLElement>("[data-note-id]")];
    if (known.current === null) {
      known.current = new Set(els.map((e) => e.dataset.noteId ?? ""));
      entrance(els);
    } else {
      for (const el of els) {
        const id = el.dataset.noteId ?? "";
        if (known.current.has(id)) continue;
        known.current.add(id);
        if (!landed.has(id)) lands(el);
      }
    }
    const z = camRef.current.z;
    for (const [id, s] of springs.current) {
      const el = noteEl(id);
      springs.current.delete(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      springDrop(el, (s.cx - (r.left + r.width / 2)) / z, (s.cy - (r.top + r.height / 2)) / z, s.vx / z, s.vy / z, s.scale);
    }
    for (const [id, s] of snaps.current) {
      const el = noteEl(id);
      snaps.current.delete(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const ring = el.querySelector<HTMLElement>(".snap-ring");
      snapBack(el, (s.cx - (r.left + r.width / 2)) / z, (s.cy - (r.top + r.height / 2)) / z, ring);
      if (reduced && ring) {
        ring.classList.add("on");
        window.setTimeout(() => ring.classList.remove("on"), 1000);
      }
    }
    if (focusNoteId.current) {
      const el = noteEl(focusNoteId.current);
      if (el && document.activeElement !== el && (document.activeElement === document.body || !document.activeElement)) el.focus({ preventScroll: true });
    }
    if (focusHeading.current) {
      const h = main.current?.querySelector<HTMLElement>(`[data-frame-id="${CSS.escape(focusHeading.current)}"] h2`);
      focusHeading.current = null;
      h?.focus({ preventScroll: true });
    }
  });

  // The face-down wave: each frame ranks its flipped cards by distance from its centre; every flip is created
  // now with its rank's delay. With reduced motion the backs crossfade away instead.
  useLayoutEffect(() => {
    for (const [frameId, wave] of waves) {
      const key = `${wave.token}:${frameId}`;
      if (started.current.has(key)) continue;
      started.current.add(key);
      const frame = board.frames.find((f) => f.id === frameId);
      if (!frame) {
        onWaveDone(frameId, wave.token);
        continue;
      }
      const cards = [...wave.ids].flatMap((id) => {
        const n = view.byId.get(id);
        const el = noteEl(id);
        const back = el?.querySelector<HTMLElement>(".card-back-face");
        if (!n || !el || !back) return [];
        const p = notePlace(n, view);
        const d = Math.round(Math.hypot(p.x + NOTE_WIDTH / 2 - frame.width / 2, p.y + NOTE_HEIGHT / 2 - frame.height / 2) * 2) / 2;
        return [{ el, back, d }];
      });
      const distances = [...new Set(cards.map((c) => c.d))].sort((a, b) => a - b);
      const gap = rankGap(distances.length);
      const animations = cards.map((c) => (reduced ? crossfade(c.back) : flip(c.el, c.back, distances.indexOf(c.d) * gap)));
      Promise.all(animations.map((a) => a.finished)).then(
        () => onWaveDone(frameId, wave.token),
        () => onWaveDone(frameId, wave.token),
      );
    }
  });

  // Pointer: pan the empty canvas, pinch with two fingers, drag notes.
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (e.pointerType === "touch") touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (target.closest("button, a, input, textarea, [role=menu], .cluster-head")) return;
    if (e.pointerType === "touch" && touches.current.size > 1) {
      pan.current = null;
      return;
    }
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    main.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const rect = main.current?.getBoundingClientRect();
    if (rect) sendPresence(e.clientX - rect.left, e.clientY - rect.top);
    if (e.pointerType === "touch" && touches.current.size === 2 && touches.current.has(e.pointerId)) {
      const before = [...touches.current.values()];
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const after = [...touches.current.values()];
      const [a0, b0] = before;
      const [a1, b1] = after;
      if (a0 && b0 && a1 && b1 && rect) {
        const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y);
        const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
        if (d0 > 0) zoomAt(d1 / d0, (a1.x + b1.x) / 2 - rect.left, (a1.y + b1.y) / 2 - rect.top);
      }
      return;
    }
    const p = pan.current;
    if (p && p.id === e.pointerId) {
      const c = camRef.current;
      setCam({ ...c, x: c.x + e.clientX - p.x, y: c.y + e.clientY - p.y });
      pan.current = { id: p.id, x: e.clientX, y: e.clientY };
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    touches.current.delete(e.pointerId);
    if (pan.current?.id === e.pointerId) pan.current = null;
  };

  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY / 400), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  /** At most 15 posts a second, only when the position moved; the last position always goes out. */
  const sendPresence = (sx: number, sy: number) => {
    const c = camRef.current;
    const x = clamp(Math.round((sx - c.x) / c.z), -100000, 100000);
    const y = clamp(Math.round((sy - c.y) / c.z), -100000, 100000);
    const last = lastPresence.current;
    if (last && last.x === x && last.y === y) return;
    clearTimeout(presenceTimer.current);
    const wait = last ? last.t + 1000 / 15 - Date.now() : 0;
    const post = () => {
      lastPresence.current = { t: Date.now(), x, y };
      void api("POST", `/api/workshops/${board.workshop.id}/presence`, { x, y }).catch(() => undefined);
    };
    if (wait <= 0) post();
    else presenceTimer.current = window.setTimeout(post, wait);
  };

  const canMove = (n: Note) => !ended && !isCardBack(n) && !isBeingCreated(n);
  const canEdit = canMove;
  const canDelete = (n: Note) => canMove(n) && (facilitator || n.mine);

  const startDrag = (e: ReactPointerEvent<HTMLElement>, n: Note) => {
    if (e.button !== 0 || !canMove(n) || actions.connecting || (e.pointerType === "touch" && touches.current.size > 0)) return;
    e.stopPropagation();
    const el = e.currentTarget;
    drag.current = { noteId: n.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, lastT: e.timeStamp, vx: 0, vy: 0, el, lifted: false, lift: null };
    el.setPointerCapture(e.pointerId);
  };

  const dragMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.lifted && Math.hypot(dx, dy) < 4) return;
    if (!d.lifted) {
      d.lifted = true;
      d.lift = lift(d.el);
      d.el.classList.add("lifted", "dragging");
    }
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.vx = ((e.clientX - d.lastX) / dt) * 1000;
    d.vy = ((e.clientY - d.lastY) / dt) * 1000;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    const z = camRef.current.z;
    d.el.style.translate = `${dx / z}px ${dy / z}px`;
  };

  const dragEnd = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (!d.lifted) return;
    const n = view.byId.get(d.noteId);
    const rect = d.el.getBoundingClientRect();
    const released = { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
    d.lift?.cancel();
    d.el.style.translate = "";
    d.el.classList.remove("lifted", "dragging");
    if (!n) return;
    const hits = document.elementsFromPoint(e.clientX, e.clientY).filter((h) => !d.el.contains(h));
    const clusterHit = hits.map((h) => h.closest<HTMLElement>("[data-cluster-id]")).find(Boolean) ?? null;
    const frameHit = hits.map((h) => h.closest<HTMLElement>("[data-frame-id]")).find(Boolean) ?? null;
    const z = camRef.current.z;
    const c = camRef.current;
    const mainRect = main.current?.getBoundingClientRect();
    const worldX = (released.cx - (mainRect?.left ?? 0) - c.x) / z - NOTE_WIDTH / 2;
    const worldY = (released.cy - (mainRect?.top ?? 0) - c.y) / z - NOTE_HEIGHT / 2;
    let patch: NotePatch;
    const cluster = clusterHit ? view.clusters.find((x) => x.id === clusterHit.dataset.clusterId) : undefined;
    const frameId = frameHit?.dataset.frameId ?? n.frameId;
    const frame = board.frames.find((f) => f.id === frameId) ?? board.frames.find((f) => f.id === n.frameId);
    if (!frame) return;
    if (cluster && canCluster(n)) {
      const list = clusterHit?.querySelector<HTMLElement>(".cluster-list");
      const top = list?.getBoundingClientRect().top ?? 0;
      const rows = cluster.noteIds.filter((id) => id !== n.id);
      const index = clamp(Math.floor((e.clientY - top) / ((NOTE_HEIGHT + CLUSTER_GAP) * z)), 0, rows.length);
      patch = { frameId: cluster.frameId, clusterId: cluster.id, index };
    } else {
      const x = Math.round(worldX - frame.x);
      const y = Math.round(worldY - frame.y);
      patch = frame.id !== n.frameId || n.clusterId ? { x, y, frameId: frame.id, clusterId: null } : { x, y };
    }
    springs.current.set(n.id, { ...released, vx: d.vx, vy: d.vy, scale: reduced ? 1 : 1.04 });
    void actions.move(n.id, patch, () => queueSnap(n.id));
  };

  const queueSnap = (id: string) => {
    const el = noteEl(id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    snaps.current.set(id, { cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
  };

  // Keyboard pick-up: Space lifts, arrows reorder inside the cluster, M moves, Space drops, Escape cancels.
  const clusterOf = (n: Note) => (n.clusterId ? view.clusters.find((c) => c.id === n.clusterId) : undefined);
  const titleOf = (frameId: string, clusterId: string | null) =>
    (clusterId ? view.clusters.find((c) => c.id === clusterId)?.title : undefined) ?? board.frames.find((f) => f.id === frameId)?.title ?? "";
  const looseIn = (frameId: string) => view.notes.filter((n) => n.frameId === frameId && !n.clusterId).sort((a, b) => a.y - b.y || a.x - b.x);

  const onNoteKey = (e: KeyboardEvent<HTMLElement>, n: Note) => {
    if (actions.connecting && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      connectPick(n);
      return;
    }
    if (e.key === "Escape" && actions.connecting) {
      e.preventDefault();
      leaveConnect();
      return;
    }
    focusNoteId.current = n.id;
    const cluster = clusterOf(n);
    if (e.key === " ") {
      e.preventDefault();
      if (!pick) {
        if (!canMove(n)) return;
        setPick({ noteId: n.id, frameId: n.frameId, clusterId: n.clusterId ?? null, index: cluster ? cluster.noteIds.indexOf(n.id) : 0 });
        lift(e.currentTarget);
        actions.say("Picked up. Up and down arrows reorder, M moves to another cluster or frame, Space drops, Escape cancels.");
        return;
      }
      drop(n);
      return;
    }
    if (pick?.noteId === n.id) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        if (!cluster) return;
        const at = cluster.noteIds.indexOf(n.id);
        const index = clamp(at + (e.key === "ArrowUp" ? -1 : 1), 0, cluster.noteIds.length - 1);
        onPreview({ key: "preview", noteId: n.id, patch: { frameId: cluster.frameId, clusterId: cluster.id, index } });
        actions.say(`Position ${index + 1} of ${cluster.noteIds.length} in ${cluster.title}`);
        return;
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setMoving(n.id);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelPick();
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!canEdit(n)) return;
      actions.openEditor({ mode: "edit", noteId: n.id, text: n.text ?? "", facilitatorOnly: n.facilitatorOnly ?? false, image: n.kind === "image" });
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && canDelete(n)) {
      e.preventDefault();
      actions.remove(n.id);
    }
  };

  const unlift = (id: string) => noteEl(id)?.getAnimations().forEach((a) => a.cancel());

  const drop = (n: Note) => {
    if (!pick) return;
    const cluster = clusterOf(n);
    setPick(null);
    onPreview(null);
    unlift(n.id);
    if (cluster) {
      const index = cluster.noteIds.indexOf(n.id);
      actions.say(`Dropped. Position ${index + 1} of ${cluster.noteIds.length} in ${cluster.title}`);
      if (index !== pick.index || cluster.id !== pick.clusterId) void actions.move(n.id, { frameId: cluster.frameId, clusterId: cluster.id, index }, () => queueSnap(n.id));
    } else {
      const loose = looseIn(n.frameId);
      actions.say(`Dropped. Position ${loose.findIndex((x) => x.id === n.id) + 1} of ${loose.length} in ${titleOf(n.frameId, null)}`);
    }
  };

  const cancelPick = () => {
    if (!pick) return;
    setPick(null);
    onPreview(null);
    unlift(pick.noteId);
    actions.say(`Move cancelled. Note returned to ${titleOf(pick.frameId, pick.clusterId)}.`);
  };

  const moveTo = (n: Note, frameId: string, clusterId: string | null) => {
    setMoving(null);
    setPick(null);
    onPreview(null);
    unlift(n.id);
    focusNoteId.current = n.id;
    const frame = board.frames.find((f) => f.id === frameId);
    if (!frame) return;
    if (clusterId) {
      const cluster = view.clusters.find((c) => c.id === clusterId);
      const count = (cluster?.noteIds.filter((id) => id !== n.id).length ?? 0) + 1;
      actions.say(`Moved to ${cluster?.title ?? ""}, position ${count} of ${count}`);
      void actions.move(n.id, { frameId, clusterId }, () => queueSnap(n.id));
    } else {
      const count = looseIn(frameId).filter((x) => x.id !== n.id).length + 1;
      const spot = freeSpot(frame, view);
      actions.say(`Moved to ${frame.title}, position ${count} of ${count}`);
      void actions.move(n.id, { frameId, clusterId: null, x: spot.x, y: spot.y }, () => queueSnap(n.id));
    }
  };

  // Connectors: pick a first note, then a second; picking a joined pair removes their connector.
  const leaveConnect = () => {
    setConnectFrom(null);
    actions.setConnecting(false);
  };
  const connectPick = (n: Note) => {
    if (!connectFrom) {
      setConnectFrom(n.id);
      actions.say("First note chosen. Choose the note to connect it to.");
      return;
    }
    const from = connectFrom;
    setConnectFrom(null);
    if (from === n.id) return;
    const existing = board.connectors.find((c) => (c.fromNoteId === from && c.toNoteId === n.id) || (c.fromNoteId === n.id && c.toNoteId === from));
    const request = existing ? api("DELETE", `/api/connectors/${existing.id}`) : api("POST", `/api/workshops/${board.workshop.id}/connectors`, { clientOpId: opId(), fromNoteId: from, toNoteId: n.id });
    request.then(
      () => {
        actions.say(existing ? "Connector removed" : "Notes connected");
        void actions.refresh();
      },
      (err: unknown) => actions.complain(err instanceof ApiFailure && err.code === "validation" ? (Object.values(err.fields)[0] ?? err.message) : actions.failed(err)),
    );
  };

  useEffect(() => {
    if (!actions.connecting) setConnectFrom(null);
  }, [actions.connecting]);

  const camera = cam ?? camRef.current;
  const frameOf = new Map(board.frames.map((f) => [f.id, f]));
  const sortedClusters = (frameId: string) => view.clusters.filter((c) => c.frameId === frameId).sort((a, b) => a.y - b.y || a.x - b.x);
  const flipping = new Set([...waves.values()].flatMap((w) => [...w.ids]));
  const silentParticipant = !facilitator && status === "silent_round";

  const renderNote = (n: Note & { saving?: boolean }, inCluster: boolean) => {
    const back = isCardBack(n);
    const classes = [
      "note",
      back ? "card-back" : "sticky",
      n.facilitatorOnly ? "note-private" : "",
      n.mine && !n.revealed ? "note-mine-hidden" : "",
      pick?.noteId === n.id ? "lifted" : "",
      connectFrom === n.id ? "connect-from" : "",
      inCluster ? "in-cluster" : "",
    ].join(" ");
    return (
      <button
        key={n.id}
        type="button"
        data-note-id={n.id}
        className={classes}
        aria-label={noteName(n)}
        style={inCluster ? undefined : { left: n.x, top: n.y }}
        onPointerDown={(e) => startDrag(e, n)}
        onPointerMove={dragMove}
        onPointerUp={dragEnd}
        onPointerCancel={dragEnd}
        onKeyDown={(e) => onNoteKey(e, n)}
        onClick={() => actions.connecting && connectPick(n)}
        onDoubleClick={() => {
          if (canEdit(n)) actions.openEditor({ mode: "edit", noteId: n.id, text: n.text ?? "", facilitatorOnly: n.facilitatorOnly ?? false, image: n.kind === "image" });
        }}
        onBlur={(e) => {
          if (e.relatedTarget && focusNoteId.current === n.id) focusNoteId.current = null;
        }}
      >
        {back ? (
          n.authorName ? <span className="note-author">{n.authorName}</span> : null
        ) : n.kind === "image" ? (
          <img className="note-image" src={n.imageUrl ?? ""} alt="" draggable={false} />
        ) : (
          <span className="note-text">{n.text}</span>
        )}
        {n.saving && <span className="saving-tag">Saving…</span>}
        {flipping.has(n.id) && <span className="card-back-face" aria-hidden="true" />}
        <span className="snap-ring" aria-hidden="true" />
      </button>
    );
  };

  const renderCluster = (c: Cluster) => {
    const voting = status === "voting" && !facilitator;
    const showTotal = facilitator ? status === "voting" || ended : ended;
    return (
      <div key={c.id} role="group" aria-label={`Cluster: ${c.title}`} className="cluster" data-cluster-id={c.id} style={{ left: c.x, top: c.y, width: CLUSTER_WIDTH, minHeight: clusterHeight(c) }}>
        <div className="cluster-head">
          <span className="cluster-title">{c.title}</span>
          <span className="mono cluster-count">{noteCount(c.noteCount)}</span>
          {showTotal && (
            <span className="mono cluster-dots-total">
              <Ticker value={String(c.dotTotal ?? 0)} /> dots
            </span>
          )}
          {!ended && status !== "silent_round" && status !== "voting" && (
            <button type="button" className="icon-btn icon-btn-small" aria-label="Cluster options" aria-haspopup="menu" onClick={(e) => setClusterMenu({ clusterId: c.id, rename: false, at: below(e.currentTarget) })}>
              <MoreHorizontal aria-hidden="true" size={18} strokeWidth={1.75} />
            </button>
          )}
        </div>
        {clusterMenu?.clusterId === c.id && !clusterMenu.rename && (
          <Menu
            at={clusterMenu.at}
            onClose={() => setClusterMenu(null)}
            items={[
              { label: "Rename", run: () => setClusterMenu({ ...clusterMenu, rename: true }) },
              {
                label: "Delete cluster",
                run: () => {
                  setClusterMenu(null);
                  api("DELETE", `/api/clusters/${c.id}`).then(
                    () => {
                      actions.say(`Cluster ${c.title} deleted`);
                      void actions.refresh();
                    },
                    (err: unknown) => actions.complain(actions.failed(err)),
                  );
                },
              },
            ]}
          />
        )}
        <ul className="cluster-list">
          {c.noteIds.map((id) => {
            const n = view.byId.get(id);
            return n ? <li key={id}>{renderNote(n, true)}</li> : null;
          })}
        </ul>
        {voting && <DotControls cluster={c} actions={actions} />}
      </div>
    );
  };

  const connectorLines = board.connectors.flatMap((k) => {
    const a = view.byId.get(k.fromNoteId);
    const b = view.byId.get(k.toNoteId);
    const fa = a && frameOf.get(a.frameId);
    const fb = b && frameOf.get(b.frameId);
    if (!a || !b || !fa || !fb) return [];
    const pa = notePlace(a, view);
    const pb = notePlace(b, view);
    const ca = { x: fa.x + pa.x + NOTE_WIDTH / 2, y: fa.y + pa.y + NOTE_HEIGHT / 2 };
    const cb = { x: fb.x + pb.x + NOTE_WIDTH / 2, y: fb.y + pb.y + NOTE_HEIGHT / 2 };
    const edge = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const t = Math.min(dx ? NOTE_WIDTH / 2 / Math.abs(dx) : Infinity, dy ? NOTE_HEIGHT / 2 / Math.abs(dy) : Infinity, 1);
      return { x: from.x + dx * t, y: from.y + dy * t };
    };
    const s = edge(ca, cb);
    const t = edge(cb, ca);
    return [<line key={k.id} x1={s.x} y1={s.y} x2={t.x} y2={t.y} />];
  });
  const bounds = boardBounds(board.frames);

  return (
    <main
      ref={main}
      aria-label="Board"
      className={actions.connecting ? "canvas connecting" : "canvas"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === "Escape" && actions.connecting) leaveConnect();
      }}
    >
      <div ref={world} className="world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`, ["--zoom" as string]: String(camera.z) }}>
        <svg className="connectors" aria-hidden="true" style={{ left: bounds.x - 4000, top: bounds.y - 4000, width: bounds.width + 8000, height: bounds.height + 8000 }} viewBox={`${bounds.x - 4000} ${bounds.y - 4000} ${bounds.width + 8000} ${bounds.height + 8000}`}>
          {connectorLines}
        </svg>
        {view.frames.map((f) => {
          const wave = waves.get(f.id);
          return (
            <section key={f.id} role="region" aria-labelledby={`frame-${f.id}`} className="frame" data-frame-id={f.id} style={{ left: f.x, top: f.y, width: f.width, height: f.height }}>
              <div className="frame-head">
                <h2 id={`frame-${f.id}`} tabIndex={0} className="frame-title">
                  {f.title}
                </h2>
                <span className="mono frame-counter">{wave ? wave.counter : f.counter}</span>
              </div>
              {facilitator && !ended && (
                <button type="button" className="icon-btn frame-options" aria-label="Frame options" aria-haspopup="menu" aria-expanded={frameMenu?.frameId === f.id && !frameMenu.rename} onClick={(e) => setFrameMenu({ frameId: f.id, rename: false, at: below(e.currentTarget) })}>
                  <MoreHorizontal aria-hidden="true" size={20} strokeWidth={1.75} />
                </button>
              )}
              {frameMenu?.frameId === f.id && !frameMenu.rename && (
                <Menu
                  at={frameMenu.at}
                  onClose={() => setFrameMenu(null)}
                  items={[
                    { label: "Rename", run: () => setFrameMenu({ ...frameMenu, rename: true }) },
                    { label: "Move to trash", run: () => trashFrame(f) },
                  ]}
                />
              )}
              {sortedClusters(f.id).map(renderCluster)}
              {view.notes
                .filter((n) => n.frameId === f.id && !n.clusterId)
                .sort((a, b) => a.y - b.y || a.x - b.x)
                .map((n) => renderNote(n, false))}
            </section>
          );
        })}
      </div>
      {!silentParticipant &&
        [...cursors.values()].map((c) => <CursorMark key={c.cursorId} cursor={c} camera={camera} />)}
      {frameMenu?.rename && (
        <TitlePrompt
          label="Frame title"
          submit="Save title"
          initial={board.frames.find((f) => f.id === frameMenu.frameId)?.title ?? ""}
          onCancel={() => setFrameMenu(null)}
          onSubmit={async (title) => {
            try {
              await api("PATCH", `/api/frames/${frameMenu.frameId}`, { clientOpId: opId(), title });
              setFrameMenu(null);
              actions.say(`Frame renamed to ${title}`);
              void actions.refresh();
            } catch (err) {
              actions.complain(err instanceof ApiFailure && err.code === "validation" ? (Object.values(err.fields)[0] ?? err.message) : actions.failed(err));
            }
          }}
        />
      )}
      {clusterMenu?.rename && (
        <TitlePrompt
          label="Cluster title"
          submit="Save title"
          initial={view.clusters.find((c) => c.id === clusterMenu.clusterId)?.title ?? ""}
          onCancel={() => setClusterMenu(null)}
          onSubmit={async (title) => {
            try {
              await api("PATCH", `/api/clusters/${clusterMenu.clusterId}`, { clientOpId: opId(), title });
              setClusterMenu(null);
              actions.say(`Cluster renamed to ${title}`);
              void actions.refresh();
            } catch (err) {
              actions.complain(err instanceof ApiFailure && err.code === "validation" ? (Object.values(err.fields)[0] ?? err.message) : actions.failed(err));
            }
          }}
        />
      )}
      {moving && (
        <MoveDialog
          actions={actions}
          noteId={moving}
          onClose={() => setMoving(null)}
          onPick={(frameId, clusterId) => {
            const n = view.byId.get(moving);
            if (n) moveTo(n, frameId, clusterId);
          }}
          returnTo={() => noteEl(moving)}
        />
      )}
    </main>
  );

  function trashFrame(f: Frame) {
    setFrameMenu(null);
    api<{ trashItem: { id: string } }>("POST", `/api/frames/${f.id}/trash`, { clientOpId: opId() }).then(
      (r) => {
        void actions.refresh();
        actions.undoable(`Frame ${f.title} moved to trash`, () => {
          api<{ restored: { notes: number } }>("POST", `/api/trash/${r.trashItem.id}/restore`, { clientOpId: opId() }).then(
            (x) => {
              actions.say(`Frame ${f.title} restored with ${noteCount(x.restored.notes)}`);
              void actions.refresh();
            },
            (err: unknown) => actions.complain(actions.failed(err)),
          );
        });
      },
      (err: unknown) => actions.complain(actions.failed(err)),
    );
  }
});

function DotControls({ cluster, actions }: { cluster: Cluster; actions: RoomActions }) {
  const [busy, setBusy] = useState<"add" | "remove" | null>(null);
  const [delta, setDelta] = useState(0);
  const run = async (kind: "add" | "remove") => {
    setBusy(kind);
    setDelta(kind === "add" ? 1 : -1);
    try {
      const r = await api<{ dotsRemaining: number }>("POST", `/api/clusters/${cluster.id}/dots${kind === "add" ? "" : "/return"}`, { clientOpId: opId() });
      await actions.refresh();
      actions.say(kind === "add" ? `Dot placed on ${cluster.title}. ${r.dotsRemaining} left.` : `Dot removed from ${cluster.title}. ${r.dotsRemaining} left.`);
    } catch (e) {
      actions.complain(actions.failed(e));
      void actions.refresh();
    } finally {
      setDelta(0);
      setBusy(null);
    }
  };
  return (
    <div className="cluster-dots">
      <button type="button" className="icon-btn dot-btn" aria-label={`Add dot to ${cluster.title}`} disabled={busy !== null} onClick={() => void run("add")}>
        <Plus aria-hidden="true" size={18} strokeWidth={1.75} />
      </button>
      <button type="button" className="icon-btn dot-btn" aria-label={`Remove dot from ${cluster.title}`} disabled={busy !== null} onClick={() => void run("remove")}>
        <Minus aria-hidden="true" size={18} strokeWidth={1.75} />
      </button>
      <span className="mono">{Math.max(0, (cluster.myDots ?? 0) + delta)} of yours</span>
    </div>
  );
}

function CursorMark({ cursor, camera }: { cursor: Cursor; camera: Camera }) {
  const el = useRef<HTMLDivElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const place = (x: number, y: number) => `translate(${x * camera.z + camera.x}px, ${y * camera.z + camera.y}px)`;
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { x: cursor.x, y: cursor.y };
    if (prev && el.current && (prev.x !== cursor.x || prev.y !== cursor.y)) glide(el.current, place(prev.x, prev.y), place(cursor.x, cursor.y));
  }, [cursor.x, cursor.y]);
  const hue = cursor.hue;
  return (
    <div ref={el} className="cursor" aria-hidden="true" style={{ transform: place(cursor.x, cursor.y), ["--hue" as string]: String(hue) }}>
      <span className="cursor-halo" />
      <svg className="cursor-glyph" width="18" height="22" viewBox="0 0 18 22">
        <path d="M1 1 L1 17 L5.5 13 L8.5 20.5 L11.5 19.2 L8.6 12 L15 12 Z" />
      </svg>
      {cursor.name !== undefined && <span className="cursor-label">{cursor.name}</span>}
    </div>
  );
}

function MoveDialog({
  actions,
  noteId,
  onClose,
  onPick,
  returnTo,
}: {
  actions: RoomActions;
  noteId: string;
  onClose: () => void;
  onPick: (frameId: string, clusterId: string | null) => void;
  returnTo: () => HTMLElement | null;
}) {
  const { board, view } = actions;
  const note = view.byId.get(noteId);
  const frames = [...board.frames].sort((a, b) => a.position - b.position);
  const options = frames.flatMap((f) => [
    ...(note && canCluster(note)
      ? view.clusters.filter((c) => c.frameId === f.id && c.id !== note.clusterId).map((c) => ({ id: `c-${c.id}`, label: `Cluster: ${c.title} (${f.title})`, frameId: f.id, clusterId: c.id as string | null }))
      : []),
    ...(note && (note.frameId !== f.id || note.clusterId) ? [{ id: `f-${f.id}`, label: `Frame: ${f.title}`, frameId: f.id, clusterId: null as string | null }] : []),
  ]);
  const [active, setActive] = useState(0);
  const chosen = options[active];
  return (
    <Dialog title="Move note" onClose={onClose} returnTo={returnTo}>
      <ul
        role="listbox"
        aria-label="Destinations"
        tabIndex={0}
        data-autofocus
        className="listbox"
        aria-activedescendant={chosen ? `dest-${chosen.id}` : undefined}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => clamp(i + (e.key === "ArrowDown" ? 1 : -1), 0, options.length - 1));
          } else if (e.key === "Enter" && chosen) {
            e.preventDefault();
            onPick(chosen.frameId, chosen.clusterId);
          }
        }}
      >
        {options.map((o, i) => (
          <li key={o.id} id={`dest-${o.id}`} role="option" aria-selected={i === active} className={i === active ? "option active" : "option"} onClick={() => onPick(o.frameId, o.clusterId)}>
            {o.label}
          </li>
        ))}
      </ul>
      {options.length === 0 && <p className="empty">There is nowhere else to move this note.</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
