import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Debrief, Placement, Prop, Room, RoomDetail, Session, TriggerNode, Version } from '../shared/types.js';
import { COPY } from '../shared/copy.js';
import { mmss } from '../shared/index.js';
import type { Unit } from '../shared/units.js';
import { api, fieldErrors, fetchDebrief, fetchRoom, fetchRooms } from './api.js';
import {
  loadQueue, newOpId, saveQueue, useEventStream, useReducedMotion, useServerClock, withQueueApplied,
  type QueuedChange,
} from './hooks.js';
import { Stage3D } from './stage3d.js';
import { hasWebGL, OVERVIEW_START, orbitView, perspective, multiply } from './stage-math.js';
import { RoomPicker } from './picker.jsx';
import {
  DebriefDialog, NewRoomSheet, PlaytestsSheet, PropLibrarySheet, ShortcutsSheet, TriggerGraphSheet, VersionsSheet,
  type FieldErrors,
} from './sheets.jsx';
import { EditorChrome, MenuPanel, wrapDeg, clampPitch, clampInt } from './chrome.jsx';

type Mode = 'move' | 'rotate' | 'scale';
export type SheetName = null | 'graph' | 'library' | 'versions' | 'playtests' | 'shortcuts' | 'newroom' | 'debrief' | 'palette' | 'proplocked' | 'toolsmenu' | 'sessionmenu';

interface Me { user: { id: string; displayName: string; role: 'owner' | 'co_designer' }; workspace: { id: string; name: string } }

/** The editor: one screen with all its sheets, driven by this one state. */
export function Editor(props: { me: Me; roomId: string | null; navigate: (path: string) => void }): JSX.Element {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [pickerOpen, setPickerOpen] = useState(!props.roomId);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [mode, setMode] = useState<Mode>('move');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [units, setUnits] = useState<Unit>(() => (localStorage.getItem('kb-units') === 'ft' ? 'ft' : 'm'));
  const [live, setLive] = useState(true);
  const [status, setStatus] = useState('');
  const [health, setHealth] = useState<{ postgres: string; valkey: string; minio: string; mail: string } | null>(null);
  const [holders, setHolders] = useState<Record<string, string>>({});
  const [presence, setPresence] = useState<Array<{ userId: string; displayName: string }>>([]);
  const [queue, setQueue] = useState<QueuedChange[]>([]);
  const [offline, setOffline] = useState(false);
  const [cameraState, setCameraState] = useState<'Overview' | 'Walking in' | 'Player height'>('Overview');
  const [cam, setCam] = useState(OVERVIEW_START);
  const [playing, setPlaying] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [props_, setProps] = useState<Prop[]>([]);
  const [pendingUploads, setPendingUploads] = useState<Array<{ name: string }>>([]);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [resyncKey, setResyncKey] = useState(0);
  const [cueOpen, setCueOpen] = useState(false);
  const [focusCopyVersion, setFocusCopyVersion] = useState<string | null>(null);
  const [freezeFocus, setFreezeFocus] = useState(false);
  const [propLocked, setPropLocked] = useState<{ holder: string; label: string } | null>(null);
  const [rotDraft, setRotDraft] = useState<string | null>(null);
  const [paletteMode, setPaletteMode] = useState<'commands' | 'versions'>('commands');
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteActive, setPaletteActive] = useState(0);
  const [sim, setSim] = useState<{ id: string; steps: number; y: number } | null>(null);
  const [solves, setSolves] = useState<Array<{ title: string; elapsedSeconds: number }>>([]);
  const reduced = useReducedMotion();
    const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const playBtnRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<RoomDetail | null>(null);
  detailRef.current = detail;
  const queueRef = useRef<QueuedChange[]>([]);
  queueRef.current = queue;
  const savedCamRef = useRef(OVERVIEW_START);
  const appliedVersions = useRef<Record<string, number>>({});

  const remaining = useServerClock(
    session && session.state === 'running' ? { remainingSeconds: session.remainingSeconds, serverTime: session.serverTime } : null,
    resyncKey
  );

  const announce = useCallback((msg: string) => setStatus(msg), []);

  /* ------------------------------- data loading */
  const refreshRooms = useCallback(async (): Promise<void> => {
    const rs = await fetchRooms();
    setRooms(rs);
  }, []);

  /** Thumbnails: upload a fresh render when the room has none, and 2s after edits stop. */
  const uploadThumbnail = useCallback(async (roomId: string, room: Room, placements: Placement[]): Promise<void> => {
    const { renderThumbnail } = await import('./stage3d.js');
    const data = renderThumbnail(room, placements);
    if (!data) return;
    const blob = await (await fetch(data)).blob();
    const r = await fetch(`/api/rooms/${roomId}/thumbnail`, {
      method: 'PUT',
      body: blob,
      credentials: 'same-origin',
    });
    if (r.ok) setRooms((rs) => rs.map((x) => (x.id === roomId ? { ...x, thumbnailUrl: `/api/rooms/${roomId}/thumbnail` } : x)));
  }, []);

  const openRoom = useCallback(async (roomId: string): Promise<void> => {
    const d = await fetchRoom(roomId);
    if (d) {
      setDetail(d);
      setSession(d.activeSession);
      setSolves(d.activeSession?.solves ?? []);
      setCam(OVERVIEW_START);
      setCameraState('Overview');
      setSelectedId(null);
      appliedVersions.current = {};
      setQueue(loadQueue(roomId));
      await refreshRooms();
    }
  }, [refreshRooms]);

  useEffect(() => {
    if (props.roomId) void openRoom(props.roomId);
  }, [props.roomId, openRoom]);

  useEffect(() => {
    void refreshRooms();
  }, [refreshRooms]);

  useEffect(() => {
    const poll = async (): Promise<void> => {
      try {
        const r = await fetch('/api/health');
        const body = await r.json() as { services: { postgres: string; valkey: string; minio: string; mail: string } };
        setHealth(body.services);
        setLive(true);
      } catch {
        setLive(false);
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 5000);
    return () => clearInterval(t);
  }, []);

  const refreshFrom = useCallback(async (placementId: string): Promise<void> => {
    const cur = detailRef.current;
    if (!cur) return;
    const fresh = await fetchRoom(cur.room.id);
    if (fresh) {
      setDetail(fresh);
      const p = fresh.placements.find((x) => x.id === placementId);
      if (p) appliedVersions.current[placementId] = p.version;
    }
  }, []);

  const showDebrief = useCallback(async (sessionId: string): Promise<void> => {
    const d = await fetchDebrief(sessionId);
    setDebrief(d);
    setSheet('debrief');
  }, []);

  /* ------------------------------- events */
  useEventStream(detail ? `/api/rooms/${detail.room.id}/events` : null, (event, data) => {
    const d = data as Record<string, unknown>;
    if (event === 'placement') {
      if ('placement' in d) {
        const p = d.placement as Placement;
        setDetail((cur) => cur && ({
          ...cur,
          placements: cur.placements.some((x) => x.id === p.id)
            ? cur.placements.map((x) => (x.id === p.id ? p : x))
            : [...cur.placements, p],
        }));
      } else if ('deletedId' in d) {
        const id = d.deletedId as string;
        setDetail((cur) => cur && ({ ...cur, placements: cur.placements.filter((x) => x.id !== id) }));
      }
    } else if (event === 'node') {
      if ('node' in d) {
        const n = d.node as TriggerNode;
        setDetail((cur) => cur && ({
          ...cur,
          nodes: cur.nodes.some((x) => x.id === n.id) ? cur.nodes.map((x) => (x.id === n.id ? n : x)) : [...cur.nodes, n],
        }));
      } else if ('deletedId' in d) {
        const id = d.deletedId as string;
        setDetail((cur) => cur && ({ ...cur, nodes: cur.nodes.filter((x) => x.id !== id) }));
      }
    } else if (event === 'room') {
      const r = d.room as Room;
      if (r.stats) setDetail((cur) => cur && ({ ...cur, room: { ...cur.room, ...r } }));
    } else if (event === 'lock') {
      const lock = d as { lock?: { targetId: string; holder: { displayName: string } }; released?: { targetId: string }; takenFrom?: { userId: string } };
      if (lock.lock) {
        const lk = lock.lock;
        if (lk) setHolders((h) => ({ ...h, [lk.targetId]: lk.holder.displayName }));
        if (lock.takenFrom?.userId === props.me.user.id) {
          const label = detailRef.current?.placements.find((p) => p.id === lock.lock!.targetId)?.label ?? 'the placement';
          announce(COPY.lockTakenOver(lock.lock!.holder.displayName, label));
          void refreshFrom(lock.lock!.targetId);
        }
      } else if (lock.released) {
        setHolders((h) => {
          const next = { ...h };
          delete next[lock.released!.targetId];
          return next;
        });
      }
    } else if (event === 'session') {
      const s = d.session as Session;
      setSession(s);
      setResyncKey((k) => k + 1);
      setSolves(s.solves ?? []);
      if (s.state === 'running' && s.hostUserId === props.me.user.id) setPlaying(true);
      if (s.state === 'ended' && s.hostUserId === props.me.user.id) {
        setPlaying(false);
        setCameraState('Overview');
        setCam(savedCamRef.current);
        void showDebrief(s.id);
      }
    } else if (event === 'version') {
      const v = d.version as Version;
      setVersions((vs) => {
        const idx = vs.findIndex((x) => x.id === v.id);
        if (idx >= 0) {
          const next = [...vs];
          next[idx] = v;
          return next;
        }
        return [v, ...vs];
      });
    } else if (event === 'solve') {
      const s = d as { title: string; elapsedSeconds: number; stats: Room['stats'] };
      setSolves((cur) => [...cur, { title: s.title, elapsedSeconds: s.elapsedSeconds }]);
      setDetail((cur) => cur && ({ ...cur, room: { ...cur.room, stats: s.stats } }));
      setResyncKey((k) => k + 1);
    } else if (event === 'restore') {
      const rd = d as { room: Room; placements: Placement[]; nodes: TriggerNode[]; sceneOrder: string[]; revision: number };
      setDetail((cur) => cur && ({ ...rd, activeSession: cur.activeSession, latestSessionId: cur.latestSessionId }));
    } else if (event === 'presence') {
      setPresence((d as { members: Array<{ userId: string; displayName: string }> }).members ?? []);
    } else if (event === 'live') {
      setLive((d as { available: boolean }).available);
    }
  });

  /* ------------------------------- save queue (DP-48) */
  const enqueue = useCallback((change: QueuedChange): void => {
    setQueue((q) => {
      const next = [...q, change];
      if (detailRef.current) saveQueue(detailRef.current.room.id, next);
      return next;
    });
  }, []);

  const applyLocal = useCallback((change: QueuedChange): void => {
    setDetail((cur) => {
      if (!cur) return cur;
      if (change.kind === 'delete' && change.placementId) {
        return { ...cur, placements: cur.placements.filter((p) => p.id !== change.placementId) };
      }
      if (change.kind === 'patch' && change.placementId && change.body) {
        return { ...cur, placements: cur.placements.map((p) => (p.id === change.placementId ? { ...p, ...change.body } as Placement : p)) };
      }
      return cur;
    });
  }, []);

  const makeChange = useCallback((change: QueuedChange): void => {
    applyLocal(change);
    enqueue(change);
  }, [applyLocal, enqueue]);

  const versionFor = useCallback((placementId: string): number => {
    const applied = appliedVersions.current[placementId];
    if (applied !== undefined) return applied;
    const cur = detailRef.current?.placements.find((p) => p.id === placementId);
    return cur?.version ?? 1;
  }, []);

  useEffect(() => {
    const trySend = async (): Promise<void> => {
      const q = queueRef.current;
      if (!q.length) return;
      const front = q[0];
      let result: { status: number; body: unknown } | null = null;
      const roomId = detailRef.current?.room.id;
      if (!roomId) return;
      try {
        if (front.kind === 'patch' && front.placementId) {
          const version = front.version ?? versionFor(front.placementId);
          const r = await api.patch<{ placement: Placement }>(`/api/rooms/${roomId}/placements/${front.placementId}`, { version, ...front.body }, { 'Op-Id': front.opId });
          result = { status: r.status, body: r.body };
        } else if (front.kind === 'delete' && front.placementId) {
          const r = await api.del(`/api/rooms/${roomId}/placements/${front.placementId}`, { 'Op-Id': front.opId });
          result = { status: r.status, body: r.body };
        } else if (front.kind === 'scene-move' && front.placementId) {
          const r = await api.post<{ sceneOrder: string[] }>(`/api/rooms/${roomId}/placements/${front.placementId}/scene-move`, { direction: front.direction }, { 'Op-Id': front.opId });
          result = { status: r.status, body: r.body };
        }
      } catch {
        result = null;
      }
      if (result === null) {
        setOffline(true);
          return;
      }
      setOffline(false);
      const body = result.body as { placement?: Placement; error?: string; label?: string; deletedBy?: { displayName: string }; holder?: { displayName: string }; sceneOrder?: string[]; current?: Placement } | null;
      if (result.status === 200 && body?.placement) {
        appliedVersions.current[front.placementId ?? ''] = body.placement.version;
        if (front.placementId) {
          setDetail((cur) => cur && ({
            ...cur,
            placements: cur.placements.map((p) => (p.id === front.placementId ? body.placement! : p)),
          }));
        }
      } else if (result.status === 200 && body?.sceneOrder && detailRef.current) {
        setDetail((cur) => cur && ({ ...cur, sceneOrder: body.sceneOrder! }));
      } else if (result.status === 412) {
        const cur = body?.current;
        if (cur) {
          setDetail((d2) => d2 && ({ ...d2, placements: d2.placements.map((p) => (p.id === cur.id ? cur : p)) }));
          appliedVersions.current[cur.id] = cur.version;
        }
        announce(COPY.newerChange);
      } else if (result.status === 410) {
        announce(COPY.deletedPlacementChange(body?.label ?? '', body?.deletedBy?.displayName ?? ''));
      } else if (result.status === 409 && body?.error === 'locked') {
        announce(COPY.heldPlacement(body?.holder?.displayName ?? ''));
        const pid = front.placementId;
        const holderName = body?.holder?.displayName;
        if (pid && holderName) setHolders((h) => ({ ...h, [pid]: holderName }));
      }
      setQueue((q2) => {
        const next = q2.slice(1);
        if (detailRef.current) saveQueue(detailRef.current.room.id, next);
        return next;
      });
    };
    void trySend();
  }, [queue, versionFor, announce]);

  useEffect(() => {
    if (!offline) {
      const onOnline = (): void => setQueue((q) => [...q]);
      window.addEventListener('online', onOnline);
      return () => window.removeEventListener('online', onOnline);
    }
    const t = setInterval(() => setQueue((q) => [...q]), 5000);
    const onOnline = (): void => { clearInterval(t); setQueue((q) => [...q]); };
    window.addEventListener('online', onOnline);
    return () => { clearInterval(t); window.removeEventListener('online', onOnline); };
  }, [offline]);

  const connectionCopy = !queue.length ? COPY.allSaved : offline ? COPY.offline(queue.length) : COPY.saving;

  /* ------------------------------- stage rendering */
  const drawnPlacements = useMemo(
    () => (detail ? withQueueApplied(detail.placements, queue.filter((c) => c.kind !== 'scene-move')) : []),
    [detail, queue]
  );

  useEffect(() => {
    if (!detail) return;
    const roomId = detail.room.id;
    const hasThumb = !!detail.room.thumbnailUrl;
    const t = setTimeout(() => {
      void uploadThumbnail(roomId, detail.room, drawnPlacements);
    }, hasThumb ? 2000 : 300);
    return () => clearTimeout(t);
  }, [detail?.room.id, drawnPlacements.length, detail, drawnPlacements, uploadThumbnail]);

  const drawnSceneOrder = useMemo(() => {
    if (!detail) return [];
    let order = detail.sceneOrder.filter((id) => drawnPlacements.some((p) => p.id === id));
    for (const p of drawnPlacements) if (!order.includes(p.id)) order = [...order, p.id];
    for (const ch of queue.filter((c) => c.kind === 'scene-move' && c.placementId)) {
      const idx = order.indexOf(ch.placementId!);
      const swap = ch.direction === 'up' ? idx - 1 : idx + 1;
      if (idx >= 0 && swap >= 0 && swap < order.length) {
        [order[idx], order[swap]] = [order[swap], order[idx]];
      }
    }
    return order;
  }, [detail, drawnPlacements, queue]);

  useEffect(() => {
    if (!detail || !hasWebGL()) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const render = (): void => {
      const stage = new Stage3D(canvas);
      const dpr = window.devicePixelRatio || 1;
      stage.resize(canvas.clientWidth, canvas.clientHeight, dpr);
      const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      const proj = perspective((50 * Math.PI) / 180, aspect, 50, 60000);
      let view: { m: Float32Array };
      if (cameraState !== 'Overview') {
        const door = drawnPlacements.find((p) => p.kind === 'door');
        const px = door ? door.xMm + door.widthMm / 2 : detail.room.widthMm / 2;
        const pz = Math.min(800, detail.room.depthMm);
        const y = cameraState === 'Walking in' ? 2600 : 1600;
        const r = Math.PI; // facing into the room (+z)
        const cos = Math.cos(r), sin = Math.sin(r);
        const m = new Float32Array(16);
        m[0] = -1; m[2] = 0; m[5] = 1; m[8] = 0; m[10] = -1; m[15] = 1;
        m[12] = px * 1; m[13] = -y; m[14] = pz;
        view = { m };
        void cos; void sin;
      } else {
        view = orbitView(cam, { x: detail.room.widthMm / 2, z: detail.room.depthMm / 2 });
      }
      const mvp = multiply(proj, view);
      const roomModel = (() => {
        const m = new Float32Array(16);
        m[0] = detail.room.widthMm; m[5] = 1; m[10] = detail.room.depthMm; m[15] = 1;
        m[12] = detail.room.widthMm / 2; m[13] = -0.5; m[14] = detail.room.depthMm / 2;
        return m;
      })();
      const model = (p: Placement): Float32Array => {
        const m = new Float32Array(16);
        const rad = (p.rotationDeg * Math.PI) / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        m[0] = cos * p.widthMm; m[2] = sin * p.widthMm;
        m[5] = p.heightMm;
        m[8] = -sin * p.depthMm; m[10] = cos * p.depthMm;
        m[12] = p.xMm + p.widthMm / 2;
        m[13] = (sim?.id === p.id ? sim.y : p.yMm) + p.heightMm / 2;
        m[14] = p.zMm + p.depthMm / 2;
        m[15] = 1;
        return m;
      };
      const eye = cameraState === 'Overview'
        ? [detail.room.widthMm / 2, detail.room.heightMm * 3, -detail.room.depthMm * 2]
        : [0, 1600, 0];
      stage.render({ room: detail.room, placements: drawnPlacements, mvp: mvp.m, model, roomModel, eye, selectedId });
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [detail, drawnPlacements, cam, cameraState, selectedId, sim]);

  /* ------------------------------- interactions */
  const onStagePointerDown = useCallback((e: React.PointerEvent): void => {
    const startX = e.clientX;
    const startY = e.clientY;
    const startCam = { ...cam };
    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      setCam((c) => ({ ...c, yaw: wrapDeg(startCam.yaw + dx * 0.5), pitch: clampPitch(startCam.pitch + dy * 0.5) }));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [cam]);

  const takeLock = useCallback(async (placementId: string): Promise<void> => {
    const roomId = detailRef.current?.room.id;
    if (!roomId) return;
    const r = await api.post<{ lock: { holder: { displayName: string } } }>(`/api/rooms/${roomId}/locks`, { targetType: 'placement', targetId: placementId });
    const body = r.body as { lock?: { holder: { displayName: string } }; holder?: { displayName: string } };
    if (r.status === 200 && body.lock) {
      setHolders((h) => ({ ...h, [placementId]: body.lock!.holder.displayName }));
    } else if (body.holder) {
      setHolders((h) => ({ ...h, [placementId]: body.holder!.displayName }));
      if (body.holder.displayName !== props.me.user.displayName) announce(COPY.heldPlacement(body.holder.displayName));
    }
  }, [announce, props.me.user.displayName]);

  const takeLockNode = useCallback(async (nodeId: string): Promise<void> => {
    const roomId = detailRef.current?.room.id;
    if (!roomId) return;
    const r = await api.post<{ lock: { holder: { displayName: string } } }>(`/api/rooms/${roomId}/locks`, { targetType: 'node', targetId: nodeId });
    const body = r.body as { lock?: { holder: { displayName: string } }; holder?: { displayName: string } };
    if (r.status === 200 && body.lock) setHolders((h) => ({ ...h, [nodeId]: body.lock!.holder.displayName }));
    else if (body.holder) setHolders((h) => ({ ...h, [nodeId]: body.holder!.displayName }));
  }, []);

  const selectPlacement = useCallback((id: string): void => {
    setSelectedId(id);
    void takeLock(id);
  }, [takeLock]);

  useEffect(() => {
    if (!selectedId || !detail) return;
    const t = setInterval(() => { void takeLock(selectedId); }, 10_000);
    return () => clearInterval(t);
  }, [selectedId, detail, takeLock]);

  const nudge = useCallback((key: string, shift: boolean): void => {
    const d = detailRef.current;
    if (!d || !selectedId) return;
    const p = drawnPlacements.find((x) => x.id === selectedId);
    if (!p) return;
    const room = d.room;
    const step = shift ? 100 : 10;
    const holder = holders[selectedId];
    if (holder && holder !== props.me.user.displayName) {
      announce(COPY.heldPlacement(holder));
      return;
    }
    const body: Record<string, number> = {};
    if (mode === 'move') {
      if (key === 'ArrowRight') body.xMm = clampInt(p.xMm + step, 0, room.widthMm);
      if (key === 'ArrowLeft') body.xMm = clampInt(p.xMm - step, 0, room.widthMm);
      if (key === 'ArrowUp') body.zMm = clampInt(p.zMm + step, 0, room.depthMm);
      if (key === 'ArrowDown') body.zMm = clampInt(p.zMm - step, 0, room.depthMm);
    } else if (mode === 'rotate') {
      if (key === 'ArrowRight') body.rotationDeg = wrapDeg(p.rotationDeg + 15);
      if (key === 'ArrowLeft') body.rotationDeg = wrapDeg(p.rotationDeg - 15);
    } else {
      if (key === 'ArrowRight') body.widthMm = clampInt(p.widthMm + 10, 10, room.widthMm);
      if (key === 'ArrowLeft') body.widthMm = clampInt(p.widthMm - 10, 10, room.widthMm);
      if (key === 'ArrowUp') body.heightMm = clampInt(p.heightMm + 10, 10, room.heightMm);
      if (key === 'ArrowDown') body.heightMm = clampInt(p.heightMm - 10, 10, room.heightMm);
    }
    const cur = d.placements.find((x) => x.id === selectedId);
    if (!cur) return;
    for (const k of Object.keys(body)) {
      if (body[k] === (cur as unknown as Record<string, number>)[k]) delete body[k];
    }
    if (!Object.keys(body).length) return;
    makeChange({ kind: 'patch', placementId: selectedId, opId: newOpId(), body, label: p.label });
    void takeLock(selectedId);
  }, [detail, selectedId, mode, holders, props.me, drawnPlacements, makeChange, announce, takeLock]);

  const walkIn = useCallback(async (): Promise<void> => {
    const d = detailRef.current;
    if (!d) return;
    const r = await api.post<{ session: Session }>(`/api/rooms/${d.room.id}/walk-in`);
    const body = r.body as { session?: Session; error?: string };
    if (r.status === 409) {
      if (body.error === 'room_busy') announce(COPY.roomBusy);
      else if (body.error === 'live_unavailable') announce(COPY.valkeyDown);
      return;
    }
    if (r.status !== 201 || !body.session) return;
    setSession(body.session);
    setPlaying(true);
    setResyncKey((k) => k + 1);
    savedCamRef.current = cam;
    if (reduced || !hasWebGL()) setCameraState('Player height');
    else {
      setCameraState('Walking in');
      setTimeout(() => setCameraState('Player height'), 600);
    }
    announce(COPY.playtestStarted);
  }, [announce, cam, reduced]);

  const stopPlay = useCallback(async (): Promise<void> => {
    const s = session;
    if (!s || s.state !== 'running') return;
    await api.post(`/api/playtests/${s.id}/end`);
    setPlaying(false);
    setCameraState('Overview');
    setCam(savedCamRef.current);
    const fresh = await fetchDebrief(s.id);
    setDebrief(fresh);
    setSheet('debrief');
  }, [session]);

  const doPlay = useCallback((): void => {
    if (playing) void stopPlay();
    else void walkIn();
  }, [playing, stopPlay, walkIn]);

  const undo = useCallback(async (): Promise<void> => {
    const d = detailRef.current;
    if (!d) return;
    const r = await api.post<{ undone: { field: string; label: string } }>(`/api/rooms/${d.room.id}/undo`);
    const body = r.body as { undone?: { field: string; label: string }; error?: string; label?: string; deletedBy?: { displayName: string } };
    if (r.status === 200 && body.undone) {
      announce(COPY.undoDone(body.undone.field, body.undone.label));
      await openRoom(d.room.id);
    } else if (r.status === 409 && body?.error === 'nothing_to_undo') {
      announce(COPY.nothingToUndo);
    } else if (r.status === 409 && body?.error === 'undo_conflict') {
      announce(COPY.undoConflict(body?.label ?? '', body?.deletedBy?.displayName ?? ''));
    }
  }, [announce, openRoom]);

  const drop = useCallback((placementId: string): void => {
    const d = detailRef.current;
    if (!d) return;
    const p = drawnPlacements.find((x) => x.id === placementId);
    if (!p || p.kind === 'door' || p.yMm <= 0) return;
    if (reduced || !hasWebGL()) {
      makeChange({ kind: 'patch', placementId, opId: newOpId(), body: { yMm: 0 }, label: p.label });
      return;
    }
    const y0 = p.yMm;
    const start = performance.now();
    const step = (): void => {
      const t = performance.now() - start;
      const k = Math.floor((t * 120) / 1000);
      const y = y0 - (109 * k * (k + 1)) / 320;
      if (y <= 0) {
        setSim({ id: placementId, steps: k, y: 0 });
        makeChange({ kind: 'patch', placementId, opId: newOpId(), body: { yMm: 0 }, label: p.label });
        return;
      }
      setSim({ id: placementId, steps: k, y: Math.round(y) });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [drawnPlacements, makeChange, reduced]);

  const sceneMove = useCallback((placementId: string, dir: 'up' | 'down'): void => {
    const d = detailRef.current;
    if (!d) return;
    const order = [...drawnSceneOrder];
    const idx = order.indexOf(placementId);
    if (idx < 0) return;
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= order.length) return;
    const next = [...order];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    const label = d.placements.find((p) => p.id === placementId)?.label ?? '';
    const otherId = order[dir === 'up' ? idx - 1 : idx + 1];
    const other = d.placements.find((p) => p.id === otherId)?.label ?? '';
    makeChange({ kind: 'scene-move', placementId, opId: newOpId(), direction: dir, label });
    setDetail((cur) => cur && ({ ...cur, sceneOrder: next }));
    announce(dir === 'up' ? COPY.movedAbove(label, other) : COPY.movedBelow(label, other));
  }, [drawnSceneOrder, makeChange, announce]);

  const stepNode = useCallback((delta: number): void => {
    const d = detailRef.current;
    if (!d || !d.nodes.length) return;
    setSheet((s) => (s === null ? 'graph' : s));
    setSelectedNode((cur) => {
      const idx = cur ? d.nodes.findIndex((n) => n.id === cur) : -1;
      const next = ((idx + delta) % d.nodes.length + d.nodes.length) % d.nodes.length;
      return d.nodes[next].id;
    });
  }, []);

  const selectNext = useCallback((delta: number): void => {
    const d = detailRef.current;
    if (!d || !d.placements.length) return;
    setSelectedId((cur) => {
      const idx = cur ? d.placements.findIndex((p) => p.id === cur) : -1;
      const next = ((idx + delta) % d.placements.length + d.placements.length) % d.placements.length;
      const id = d.placements[next].id;
      void takeLock(id);
      return id;
    });
  }, [takeLock]);

  const turnCamera = useCallback((key: string): void => {
    setCam((c) => {
      const yaw = key === 'ArrowRight' ? wrapDeg(c.yaw + 15) : key === 'ArrowLeft' ? wrapDeg(c.yaw - 15) : c.yaw;
      const pitch = key === 'ArrowUp' ? Math.min(80, c.pitch + 15) : key === 'ArrowDown' ? Math.max(5, c.pitch - 15) : c.pitch;
      return { ...c, yaw, pitch };
    });
  }, []);

  /* keyboard (DP-16) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement;
      const tag = target?.tagName;
      const inTextField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
      if (inTextField) return;
      const onTreeItem = target?.closest?.('[role="treeitem"]') != null;
      if (onTreeItem) {
        if (e.key === 'Escape') { setSheet(null); return; }
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          const id = target.closest('[role="treeitem"]')?.getAttribute('data-id') ?? '';
          if (id) sceneMove(id, e.key === 'ArrowUp' ? 'up' : 'down');
          return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const items = Array.from(document.querySelectorAll<HTMLElement>('[role="treeitem"]'));
          const idx = items.indexOf(target.closest('[role="treeitem"]') as HTMLElement);
          const nextIdx = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? idx + 1 : idx - 1;
          items[Math.max(0, Math.min(items.length - 1, nextIdx))]?.focus();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const id = target.closest('[role="treeitem"]')?.getAttribute('data-id');
          if (id) selectPlacement(id);
          return;
        }
        return;
      }
      if (pickerOpen) return;
      if (sheet !== null && sheet !== 'graph') return;
      const mac = e.metaKey;
      if ((e.ctrlKey || mac) && e.key.toLowerCase() === 'z') { e.preventDefault(); void undo(); return; }
      if ((e.ctrlKey || mac) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteMode('commands'); setPaletteQuery(''); setPaletteActive(0); setSheet('palette');
        return;
      }
      if (sheet === 'graph') {
        if (e.key === 'n') stepNode(1);
        else if (e.key === 'N') stepNode(-1);
        else if (e.key === 't' || e.key === 'T') setSheet(null);
        return;
      }
      switch (e.key) {
        case 'g': setMode('move'); break;
        case 'r': setMode('rotate'); break;
        case 's': setMode('scale'); break;
        case ']': selectNext(1); break;
        case '[': selectNext(-1); break;
        case 'ArrowRight': case 'ArrowLeft': case 'ArrowUp': case 'ArrowDown': {
          e.preventDefault();
          if (selectedId) nudge(e.key, e.shiftKey);
          else if (target?.getAttribute?.('role') === 'region') turnCamera(e.key);
          return;
        }
        case 'Delete':
          if (selectedId) {
            const p = detailRef.current?.placements.find((x) => x.id === selectedId);
            makeChange({ kind: 'delete', placementId: selectedId, opId: newOpId(), label: p?.label ?? '' });
            setSelectedId(null);
          }
          break;
        case 'n': stepNode(1); break;
        case 'N': stepNode(-1); break;
        case 'p': case 'P': doPlay(); break;
        case 't': case 'T': setSheet('graph'); break;
        case 'l': case 'L': setSheet('library'); break;
        case '?': setSheet('shortcuts'); break;
        case 'd': case 'D': if (selectedId) drop(selectedId); break;
        case 'Escape': if (selectedId) setSelectedId(null); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* sheet actions */
  const saveNode = useCallback(async (id: string, fields: Partial<TriggerNode>): Promise<void> => {
    const d = detailRef.current;
    if (!d) return;
    const node = d.nodes.find((n) => n.id === id);
    if (!node) return;
    const r = await api.patch<{ node: TriggerNode }>(`/api/rooms/${d.room.id}/nodes/${id}`, { version: node.version, ...fields });
    if (r.status === 200) {
      const n = (r.body as { node: TriggerNode }).node;
      setDetail((cur) => cur && ({ ...cur, nodes: cur.nodes.map((x) => (x.id === id ? n : x)) }));
      const fresh = await fetchRoom(d.room.id);
      if (fresh) setDetail(fresh);
    } else {
      const errs = fieldErrors(r.body);
      const first = Object.values(errs)[0];
      if (first) announce(first);
      const body = r.body as { error?: string };
      if (body?.error === 'playtest_running') announce(COPY.playtestRunning);
    }
  }, [announce]);

  const addNode = useCallback(async (): Promise<void> => {
    const d = detailRef.current;
    if (!d) return;
    const r = await api.post<{ node: TriggerNode }>(`/api/rooms/${d.room.id}/nodes`, { title: 'New puzzle', kind: 'puzzle' });
    if (r.status === 201) {
      const n = (r.body as { node: TriggerNode }).node;
      setDetail((cur) => cur && ({ ...cur, nodes: [...cur.nodes, n] }));
      setSelectedNode(n.id);
    }
  }, []);

  const deleteNode = useCallback(async (id: string): Promise<void> => {
    const d = detailRef.current;
    if (!d) return;
    const r = await api.del(`/api/rooms/${d.room.id}/nodes/${id}`);
    if (r.status === 204) {
      setDetail((cur) => cur && ({
        ...cur,
        nodes: cur.nodes.filter((n) => n.id !== id).map((n) => ({ ...n, prerequisites: n.prerequisites.filter((p) => p !== id) })),
      }));
      setSelectedNode(null);
      const fresh = await fetchRoom(d.room.id);
      if (fresh) setDetail(fresh);
    }
  }, []);

  const uploadProp = useCallback(async (form: FormData): Promise<void> => {
    const file = form.get('file') as File | null;
    announce(COPY.uploadPending(file?.name ?? ''));
    setPendingUploads((p) => [...p, { name: file?.name ?? '' }]);
    const res = await fetch('/api/props', { method: 'POST', body: form, credentials: 'same-origin' });
    if (res.ok) {
      const body = await res.json() as { prop: Prop };
      const fresh = await fetch('/api/props', { credentials: 'same-origin' });
      if (fresh.ok) setProps(((await fresh.json()) as { props: Prop[] }).props);
      setPendingUploads((p) => p.filter((x) => x.name !== file?.name));
      announce(COPY.uploadSuccess(body.prop.name));
    } else {
      setPendingUploads((p) => p.filter((x) => x.name !== file?.name));
      announce(COPY.uploadFailure);
    }
  }, [announce]);

  const placeProp = useCallback(async (prop: Prop): Promise<void> => {
    const d = detailRef.current;
    if (!d) return;
    const r = await api.post<{ placement: Placement }>(`/api/rooms/${d.room.id}/placements`, {
      kind: 'prop', label: prop.name, propId: prop.id,
      xMm: Math.max(0, Math.round(d.room.widthMm / 2 - prop.widthMm / 2)),
      zMm: Math.max(0, Math.round(d.room.depthMm / 2 - prop.depthMm / 2)),
      yMm: 0, rotationDeg: 0,
    });
    if (r.status === 201) {
      const p = (r.body as { placement: Placement }).placement;
      setDetail((cur) => cur && ({ ...cur, placements: [...cur.placements, p], sceneOrder: [...cur.sceneOrder, p.id] }));
      setSheet(null);
      await refreshRooms();
    }
  }, [refreshRooms]);

  const deleteProp = useCallback(async (prop: Prop): Promise<void> => {
    const r = await api.del(`/api/props/${prop.id}`);
    if (r.status === 204) {
      const fresh = await fetch('/api/props', { credentials: 'same-origin' });
      if (fresh.ok) setProps(((await fresh.json()) as { props: Prop[] }).props);
    }
  }, []);

  const freezeVersion = useCallback(async (label: string): Promise<void> => {
    const d = detailRef.current;
    if (!d) return;
    announce(COPY.freezePending);
    const r = await api.post<{ version: Version }>(`/api/rooms/${d.room.id}/versions`, { label });
    if (r.status === 201) {
      const v = (r.body as { version: Version }).version;
      setVersions((vs) => [v, ...vs.map((x) => (x.state === 'frozen' && x.id !== v.id ? { ...x, state: 'superseded' as const, supersededBy: v.number } : x))]);
      announce(COPY.freezeSuccess(v.number));
      setFocusCopyVersion(v.id);
    } else {
      announce(COPY.freezeFailure);
    }
  }, [announce]);

  const copyLink = useCallback(async (v: Version): Promise<void> => {
    if (v.packUrl) {
      await navigator.clipboard.writeText(v.packUrl).catch(() => undefined);
      announce(COPY.linkCopied);
    }
  }, [announce]);

  const regenerateLink = useCallback(async (v: Version): Promise<void> => {
    const r = await api.post<{ packUrl: string }>(`/api/versions/${v.id}/link`);
    if (r.status === 201) {
      const url = (r.body as { packUrl: string }).packUrl;
      setVersions((vs) => vs.map((x) => (x.id === v.id ? { ...x, packUrl: url } : x)));
      announce(COPY.linkRegenerated);
    }
  }, [announce]);

  const revokeLink = useCallback(async (v: Version): Promise<void> => {
    const r = await api.del(`/api/versions/${v.id}/link`);
    if (r.status === 204) {
      setVersions((vs) => vs.map((x) => (x.id === v.id ? { ...x, packUrl: null } : x)));
      announce(COPY.linkRevoked);
    }
  }, [announce]);

  const schedulePlaytest = useCallback(async (iso: string): Promise<FieldErrors> => {
    const d = detailRef.current;
    if (!d) return {};
    const r = await api.post<{ session: Session }>('/api/playtests', { roomId: d.room.id, startsAt: iso });
    if (r.status === 201) {
      setSession((r.body as { session: Session }).session);
      return {};
    }
    return fieldErrors(r.body);
  }, []);

  const inviteTester = useCallback(async (sessionId: string, email: string): Promise<void> => {
    const r = await api.post<{ invite: { emailStatus: string } }>(`/api/playtests/${sessionId}/invites`, { email });
    if (r.status === 201) {
      const inv = (r.body as { invite: { emailStatus: string } }).invite;
      announce(inv.emailStatus === 'sent' ? COPY.inviteSent(email) : inv.emailStatus === 'queued' ? COPY.inviteQueued(email) : COPY.inviteFailed(email));
      const fresh = await api.get<{ session: Session }>(`/api/playtests/${sessionId}`);
      if (fresh.status === 200) setSession((fresh.body as { session: Session }).session);
    } else {
      const errs = fieldErrors(r.body);
      const first = Object.values(errs)[0];
      announce(first ?? COPY.inviteFailed(email));
    }
  }, [announce]);

  const sessionAction = useCallback(async (sessionId: string, action: 'open' | 'start' | 'end' | 'cancel'): Promise<void> => {
    const r = await api.post<{ session: Session }>(`/api/playtests/${sessionId}/${action}`);
    if (r.status === 200) {
      const s = (r.body as { session: Session }).session;
      setSession(s);
      setResyncKey((k) => k + 1);
      if (s.state === 'running') setPlaying(true);
      if (s.state === 'ended') {
        setPlaying(false);
        const d = await fetchDebrief(sessionId);
        setDebrief(d);
        setSheet('debrief');
      }
      const d = detailRef.current;
      if (d) {
        const fresh = await fetchRoom(d.room.id);
        if (fresh) setDetail(fresh);
      }
    } else {
      const body = r.body as { error: string };
      if (body.error === 'room_busy') announce(COPY.roomBusy);
      else if (body.error === 'live_unavailable') announce(COPY.valkeyDown);
    }
  }, [announce]);

  const sendHint = useCallback(async (sessionId: string, text: string): Promise<FieldErrors> => {
    const r = await api.post<{ hint: unknown }>(`/api/playtests/${sessionId}/hints`, { text });
    if (r.status === 201) {
      const s = await api.get<{ session: Session }>(`/api/playtests/${sessionId}`);
      if (s.status === 200) setSession((s.body as { session: Session }).session);
      return {};
    }
    if (r.status === 429) {
      const body = r.body as unknown as { retryAfterSeconds: number };
      announce(COPY.nextHintIn(mmss(body.retryAfterSeconds)));
      return {};
    }
    return fieldErrors(r.body);
  }, [announce]);

  const restoreVersion = useCallback(async (versionId: string, number: number): Promise<void> => {
    const d = detailRef.current;
    if (!d) return;
    const r = await api.post<{ revision: number }>(`/api/rooms/${d.room.id}/restore`, { versionId });
    if (r.status === 200) {
      const rev = (r.body as { revision: number }).revision;
      announce(COPY.restoreDone(number, rev));
      await openRoom(d.room.id);
      setSheet(null);
      setPaletteMode('commands');
    } else {
      const body = r.body as { error?: string };
      if (body?.error === 'prop_missing') announce('A prop in this version is no longer in the library.');
    }
  }, [announce, openRoom]);

  useEffect(() => {
    if (sheet === 'versions' && detail) {
      void fetch(`/api/rooms/${detail.room.id}/versions`).then(async (r) => {
        if (r.ok) setVersions(((await r.json()) as { versions: Version[] }).versions);
      });
    }
    if (sheet === 'library') {
      void fetch('/api/props', { credentials: 'same-origin' }).then(async (r) => {
        if (r.ok) setProps(((await r.json()) as { props: Prop[] }).props);
      });
    }
  }, [sheet, detail]);

  /* command palette */
  const commands = useMemo(() => {
    if (paletteMode === 'versions') {
      return versions.map((v) => ({
        name: `Version ${v.number} — ${v.label}`,
        run: (): void => { void restoreVersion(v.id, v.number); },
        needsLive: false,
      }));
    }
    return [
      { name: 'Start playtest', run: (): void => { doPlay(); setSheet(null); }, needsLive: true },
      { name: 'Freeze version...', run: (): void => { setFreezeFocus(true); setSheet('versions'); }, needsLive: false },
      { name: 'Restore version...', run: (): void => { setPaletteMode('versions'); setPaletteQuery(''); setPaletteActive(0); }, needsLive: false },
      { name: 'Open Versions', run: (): void => setSheet('versions'), needsLive: false },
      { name: 'Open Prop library', run: (): void => setSheet('library'), needsLive: false },
      { name: 'Open Trigger graph', run: (): void => setSheet('graph'), needsLive: false },
      { name: 'Keyboard shortcuts', run: (): void => setSheet('shortcuts'), needsLive: false },
    ];
  }, [paletteMode, versions, doPlay, restoreVersion]);

  const filteredCommands = useMemo(() => {
    const q = paletteQuery.toLowerCase();
    return commands.filter((c) => c.name.toLowerCase().includes(q));
  }, [commands, paletteQuery]);

  const selected = selectedId ? drawnPlacements.find((p) => p.id === selectedId) ?? null : null;
  const valkeyDown = !live || health?.valkey === 'down';
  const minioDown = health?.minio === 'down';
  const banner = valkeyDown ? COPY.valkeyDown : minioDown ? COPY.minioDown : null;

  return (
    <>
      {detail && (
        <EditorChrome
          me={props.me}
          detail={detail}
          drawnPlacements={drawnPlacements}
          drawnSceneOrder={drawnSceneOrder}
          selected={selected}
          selectedId={selectedId}
          sim={sim}
          mode={mode}
          units={units}
          banner={banner}
          valkeyDown={valkeyDown}
          connectionCopy={connectionCopy}
          playing={playing}
          session={session}
          remaining={remaining}
          presence={presence.length || 1}
          solves={solves}
          cueOpen={cueOpen}
          holders={holders}
          rotDraft={rotDraft}
          setRotDraft={setRotDraft}
          setUnits={(u: Unit) => { setUnits(u); localStorage.setItem('kb-units', u); }}
          onCueToggle={() => setCueOpen(!cueOpen)}
          onMode={setMode}
          onPlay={doPlay}
          onSheet={(s: string) => setSheet(s as SheetName)}
          onPicker={() => setPickerOpen(true)}
          onStepNode={() => stepNode(1)}
          onAddPrimitive={async () => {
            const d = detailRef.current;
            if (!d) return;
            const r = await api.post<{ placement: Placement }>(`/api/rooms/${d.room.id}/placements`, { kind: 'box', label: 'New box' });
            if (r.status === 201) {
              const p = (r.body as { placement: Placement }).placement;
              setDetail((cur) => cur && ({ ...cur, placements: [...cur.placements, p], sceneOrder: [...cur.sceneOrder, p.id] }));
            }
          }}
          onSelect={selectPlacement}
          onSceneMove={sceneMove}
          onRotCommit={(v: number) => {
            if (!selected) return;
            const holder = holders[selected.id];
            if (holder && holder !== props.me.user.displayName) {
              setPropLocked({ holder, label: selected.label });
              setSheet('proplocked');
              return;
            }
            makeChange({ kind: 'patch', placementId: selected.id, opId: newOpId(), body: { rotationDeg: ((v % 360) + 360) % 360 }, label: selected.label });
          }}
          onInvite={async (email) => { if (session) await inviteTester(session.id, email); }}
          playRef={playBtnRef}
        />
      )}

      {/* the stage itself */}
      {detail && (
        <div
          ref={stageRef}
          className="stage-region"
          role="region"
          aria-label="Room stage"
          tabIndex={0}
          data-cam-yaw={String(Math.round(cam.yaw))}
          data-cam-pitch={String(Math.round(cam.pitch))}
          onPointerDown={onStagePointerDown}
        >
          {hasWebGL() ? (
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', touchAction: 'none' }} />
          ) : (
            <FloorPlan room={detail.room} placements={drawnPlacements} />
          )}
        </div>
      )}

      <div className="visually-hidden" role="status" aria-live="polite" id="editor-status">{status}</div>
      <div className="visually-hidden" role="status" aria-live="polite">{cameraState}</div>

      {detail && !drawnPlacements.length && (
        <div style={{ position: 'fixed', left: '50%', top: '46%', transform: 'translate(-50%, -50%)', color: 'var(--muted)', zIndex: 2, pointerEvents: 'none' }}>
          {COPY.emptyRoom}
        </div>
      )}

      {pickerOpen && (
        <RoomPicker
          rooms={rooms}
          loading={!rooms.length}
          actions={{
            onOpenRoom: async (roomId, walk) => {
              setPickerOpen(false);
              props.navigate(`/app/rooms/${roomId}`);
              if (walk) await walkIn();
            },
            onNewRoom: () => setSheet('newroom'),
            onPropLibrary: () => setSheet('library'),
            onVersions: () => setSheet('versions'),
            onShortcuts: () => setSheet('shortcuts'),
            onClose: () => {
              setPickerOpen(false);
              stageRef.current?.focus();
            },
          }}
        />
      )}

      {sheet === 'graph' && detail && (
        <TriggerGraphSheet
          onClose={() => setSheet(null)}
          nodes={detail.nodes}
          placements={detail.placements}
          selectedNodeId={selectedNode}
          holderName={selectedNode ? holders[selectedNode] ?? null : null}
          onSelectNode={(id) => { setSelectedNode(id); void takeLockNode(id); }}
          onSave={saveNode}
          onAdd={addNode}
          onDelete={deleteNode}
        />
      )}

      {sheet === 'library' && (
        <PropLibrarySheet
          onClose={() => setSheet(null)}
          props_={props_}
          pending={pendingUploads}
          onUpload={uploadProp}
          onPlace={placeProp}
          onDelete={deleteProp}
          focusFile={false}
        />
      )}

      {sheet === 'versions' && detail && (
        <VersionsSheet
          onClose={() => { setSheet(null); setFreezeFocus(false); }}
          versions={versions}
          isOwner={props.me.user.role === 'owner'}
          onFreeze={freezeVersion}
          onCopy={copyLink}
          onRegenerate={regenerateLink}
          onRevoke={revokeLink}
          freezeBusy={false}
          focusCopy={focusCopyVersion}
          focusLabel={freezeFocus}
        />
      )}

      {sheet === 'playtests' && (
        <PlaytestsSheet
          onClose={() => setSheet(null)}
          sessions={session ? [session] : []}
          isOwner={props.me.user.role === 'owner'}
          isHostOf={(s) => s.hostUserId === props.me.user.id}
          canControl={(s) => s.hostUserId === props.me.user.id || props.me.user.role === 'owner'}
          onSchedule={schedulePlaytest}
          onInvite={inviteTester}
          onAction={sessionAction}
          onRevoke={async (sessionId, inviteId) => {
            await api.del(`/api/playtests/${sessionId}/invites/${inviteId}`);
            const fresh = await api.get<{ session: Session }>(`/api/playtests/${sessionId}`);
            if (fresh.status === 200) setSession((fresh.body as { session: Session }).session);
          }}
          onResend={async (sessionId, inviteId) => {
            await api.post(`/api/playtests/${sessionId}/invites/${inviteId}/resend`);
            const fresh = await api.get<{ session: Session }>(`/api/playtests/${sessionId}`);
            if (fresh.status === 200) setSession((fresh.body as { session: Session }).session);
          }}
          onHint={sendHint}
        />
      )}

      {sheet === 'shortcuts' && <ShortcutsSheet onClose={() => setSheet(null)} />}

      {sheet === 'newroom' && (
        <NewRoomSheet
          onClose={() => setSheet(null)}
          onCreate={async (name, w, d, h) => {
            const r = await api.post<{ room: Room }>('/api/rooms', { name, widthMm: w, depthMm: d, heightMm: h });
            if (r.status === 201) {
              const created = (r.body as { room: Room }).room;
              setSheet(null);
              setPickerOpen(false);
              props.navigate(`/app/rooms/${created.id}`);
              return {};
            }
            return fieldErrors(r.body);
          }}
        />
      )}

      {sheet === 'debrief' && (
        <DebriefDialog
          onClose={() => setSheet(null)}
          debrief={debrief}
          session={session}
          onClosedFocusPlay={() => playBtnRef.current?.focus()}
        />
      )}

      {sheet === 'palette' && (
        <Dialog label="Command palette" onClose={() => { setSheet(null); setPaletteMode('commands'); }}>
          <input
            role="combobox"
            aria-label="Command"
            aria-expanded
            aria-controls="palette-list"
            value={paletteQuery}
            autoFocus
            onChange={(e) => { setPaletteQuery(e.target.value); setPaletteActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteActive((a) => (a + 1) % Math.max(1, filteredCommands.length)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteActive((a) => (a - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length)); }
              else if (e.key === 'Enter') {
                e.preventDefault();
                const cmd = filteredCommands[paletteActive];
                if (!cmd) return;
                if (cmd.needsLive && valkeyDown) return; // unavailable: Enter does nothing
                cmd.run();
                // Commands that open another dialog keep it open; the rest close the palette.
                const opensSheet = ['Open Versions', 'Open Prop library', 'Open Trigger graph', 'Keyboard shortcuts', 'Freeze version...'].includes(cmd.name);
                if (paletteMode === 'commands' && !opensSheet) {
                  setSheet(null);
                  setPaletteMode('commands');
                }
              }
            }}
          />
          <ul id="palette-list" role="listbox" aria-label="Commands" style={{ listStyle: 'none', maxHeight: 320, overflow: 'auto' }}>
            {filteredCommands.map((c, i) => {
              const disabled = c.needsLive && valkeyDown;
              return (
                <li
                  key={c.name}
                  role="option"
                  aria-selected={i === paletteActive}
                  aria-disabled={disabled || undefined}
                  aria-description={disabled ? COPY.needsLive : undefined}
                  className={i === paletteActive ? 'active' : ''}
                >
                  {c.name}
                </li>
              );
            })}
          </ul>
        </Dialog>
      )}

      {sheet === 'proplocked' && propLocked && selected && (
        <Dialog label="Prop locked" onClose={() => setSheet(null)} variant="small">
          <p style={{ marginBottom: 14 }}>{COPY.propLocked(propLocked.holder, propLocked.label)}</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="cluster-btn" autoFocus onClick={() => { setRotDraft(null); setSheet(null); }}>Cancel</button>
            <button className="cluster-btn primary" onClick={async () => {
              const d = detailRef.current;
              if (d && selected) {
                const r = await api.post(`/api/rooms/${d.room.id}/locks`, { targetType: 'placement', targetId: selected.id, takeOver: true });
                if (r.status === 200) {
                  setHolders((h) => ({ ...h, [selected.id]: props.me.user.displayName }));
                  const v = parseInt(rotDraft ?? '0', 10);
                  makeChange({ kind: 'patch', placementId: selected.id, opId: newOpId(), body: { rotationDeg: ((v % 360) + 360) % 360 }, label: selected.label });
                  announce(COPY.tookOver(selected.label));
                }
              }
              setRotDraft(null);
              setSheet(null);
            }}>Take over</button>
          </div>
        </Dialog>
      )}

      {sheet === 'sessionmenu' && (
        <MenuPanel
          onClose={() => setSheet(null)}
          me={props.me}
          onRun={async (label) => {
            if (label === 'Freeze version' || label === 'Versions') { setSheet('versions'); return; }
            if (label === 'Prop library') { setSheet('library'); return; }
            if (label === 'Keyboard shortcuts') { setSheet('shortcuts'); return; }
            if (label === 'Sign out') {
              await api.post('/api/auth/logout');
              props.navigate('/signin');
            }
          }}
        />
      )}

      {sheet === 'toolsmenu' && (
        <MenuPanel
          onClose={() => setSheet(null)}
          me={props.me}
          variant="tools"
          onRun={async (label) => {
            if (label === 'Move') { setMode('move'); setSheet(null); }
            else if (label === 'Rotate') { setMode('rotate'); setSheet(null); }
            else if (label === 'Scale') { setMode('scale'); setSheet(null); }
            else if (label === 'Scene') { setSheet(null); }
            else if (label === 'Add primitive') {
              await (async () => {
                const d = detailRef.current;
                if (!d) return;
                const r = await api.post<{ placement: Placement }>(`/api/rooms/${d.room.id}/placements`, { kind: 'box', label: 'New box' });
                if (r.status === 201) {
                  const p = (r.body as { placement: Placement }).placement;
                  setDetail((cur) => cur && ({ ...cur, placements: [...cur.placements, p], sceneOrder: [...cur.sceneOrder, p.id] }));
                }
              })();
              setSheet(null);
            } else if (label === 'Upload prop') { setSheet('library'); }
            else if (label === 'Cue timeline') { setCueOpen(!cueOpen); setSheet(null); }
            else if (label === 'Units') {
              const next: Unit = units === 'm' ? 'ft' : 'm';
              setUnits(next);
              localStorage.setItem('kb-units', next);
              setSheet(null);
            }
          }}
        />
      )}
    </>
  );
}

function FloorPlan(props: { room: Room; placements: Placement[] }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, w, h);
    const pad = 70;
    const s = Math.min((w - pad * 2) / props.room.widthMm, (h - pad * 2) / props.room.depthMm);
    const ox = (w - props.room.widthMm * s) / 2;
    const oy = (h - props.room.depthMm * s) / 2;
    ctx.strokeStyle = '#3a4560';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox, oy, props.room.widthMm * s, props.room.depthMm * s);
    ctx.font = '11px Inter, sans-serif';
    for (const p of props.placements) {
      const x = ox + p.xMm * s;
      const z = oy + p.zMm * s;
      ctx.strokeStyle = '#8b95a8';
      if (p.kind === 'cylinder') {
        ctx.beginPath();
        ctx.ellipse(x + (p.widthMm * s) / 2, z + (p.depthMm * s) / 2, (p.widthMm * s) / 2, (p.depthMm * s) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(x, z, p.widthMm * s, p.depthMm * s);
      }
      ctx.fillStyle = '#8b95a8';
      ctx.fillText(p.label, x + 2, z - 4);
      if (p.kind === 'door' && p.entry) {
        ctx.fillStyle = '#ff6b45';
        ctx.fillText('entry', x + 2, z + 12);
      }
    }
  }, [props.room, props.placements]);
  return (
    <>
      <div className="floorplan-notice">{COPY.noWebGL}</div>
      <canvas ref={ref} style={{ width: '100%', height: '100%' }} />
    </>
  );
}

import { Dialog } from './ui.jsx';
