// Shared live data for every staff page: who is working, units, the exhibition, placements, objects,
// the preview, service status, and the two live regions. Polls events, preview and status.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiFailure, get, own, setStaffId, whenIdle } from "./api";
import { BANNERS, say, teamSentence } from "./copy";
import type { Unit } from "../shared/units";
import type { ExhibitionData, HangEvent, ObjectRecord, Placement, Preview, Services, Staff } from "./types";

const EVENTS_RETRY_MS = 1500;
/** The pause after an answer with no new events; with the request itself, well inside the 2 s the brief allows. */
const EVENTS_EVERY_MS = 1500;
/** Waits on wall-clock time through the abort-signal timer rather than setTimeout, so live updates keep
 *  arriving while the page's own timers are held (a frozen or throttled clock). */
const wallPause = (ms: number) =>
  new Promise<void>((resolve) => AbortSignal.timeout(ms).addEventListener("abort", () => resolve(), { once: true }));
const PREVIEW_EVERY_MS = 4000;
const STATUS_EVERY_MS = 3000;
/** Team updates keeps the last few refreshes' sentences, so a change that lands just after another doesn't hide it. */
const TEAM_KEPT = 3;

interface Message {
  text: string;
  key: number;
}

interface PreviewState {
  preview: Preview;
  /** performance.now() when the response that carried remainingMs arrived. */
  syncedAt: number;
}

type Listener = (events: HangEvent[]) => void;

interface Store {
  staffList: Staff[];
  staff: Staff | null;
  unit: Unit;
  services: Services | null;
  exhibition: ExhibitionData | null;
  placements: Placement[] | null;
  objects: ObjectRecord[] | null;
  preview: PreviewState | null;
  said: Message;
  team: Message[];
  chooseStaff: (id: string) => void;
  chooseUnit: (unit: Unit) => void;
  announce: (text: string) => void;
  refresh: (what: ("placements" | "objects" | "exhibition" | "preview")[]) => Promise<void>;
  putPlacement: (p: Placement) => void;
  putObject: (o: ObjectRecord) => void;
  putPreview: (p: Preview) => void;
  setWall: (wallId: string, plannedLux: number) => void;
  retryStatus: () => Promise<void>;
  onEvents: (listener: Listener) => () => void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore outside StoreProvider");
  return store;
}

const STAFF_KEY = "hangline.workingAs";
const UNIT_KEY = "hangline.units";

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [unit, setUnit] = useState<Unit>(() => (readLocal(UNIT_KEY) === "in" ? "in" : "cm"));
  const [services, setServices] = useState<Services | null>(null);
  const [exhibition, setExhibition] = useState<ExhibitionData | null>(null);
  const [placements, setPlacements] = useState<Placement[] | null>(null);
  const [objects, setObjects] = useState<ObjectRecord[] | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [said, setSaid] = useState<Message>({ text: "", key: 0 });
  const [team, setTeam] = useState<Message[]>([]);
  const unitRef = useRef(unit);
  unitRef.current = unit;
  const lastSeq = useRef<number | null>(null);
  const seqKnown = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (!seqKnown.current) {
    let resolve = () => undefined as void;
    const promise = new Promise<void>((r) => (resolve = r));
    seqKnown.current = { promise, resolve };
  }
  const listeners = useRef(new Set<Listener>());
  const databaseDown = useRef(false);

  const announce = useCallback((text: string) => setSaid((m) => ({ text, key: m.key + 1 })), []);

  const loadPlacements = useCallback(async () => {
    const data = await get<{ placements: Placement[] }>("/api/placements");
    setPlacements(data.placements);
  }, []);
  const loadObjects = useCallback(async () => {
    const data = await get<{ objects: ObjectRecord[] }>("/api/objects");
    setObjects(data.objects);
  }, []);
  const loadExhibition = useCallback(async () => setExhibition(await get<ExhibitionData>("/api/exhibition")), []);
  const loadPreview = useCallback(async () => {
    const data = await get<{ preview: Preview }>("/api/preview");
    setPreview({ preview: data.preview, syncedAt: performance.now() });
  }, []);
  /** The timed re-sync keeps the countdown and recipients current; a status change arrives with its event. */
  const resyncPreview = useCallback(async () => {
    const data = await get<{ preview: Preview }>("/api/preview");
    setPreview((shown) =>
      shown && (shown.preview.id !== data.preview.id || shown.preview.status !== data.preview.status)
        ? shown
        : { preview: data.preview, syncedAt: performance.now() },
    );
  }, []);

  const refresh = useCallback(
    async (what: ("placements" | "objects" | "exhibition" | "preview")[]) => {
      const loaders = { placements: loadPlacements, objects: loadObjects, exhibition: loadExhibition, preview: loadPreview };
      await Promise.all(what.map((w) => loaders[w]().catch(() => undefined)));
    },
    [loadPlacements, loadObjects, loadExhibition, loadPreview],
  );

  const start = useCallback(async () => {
    const data = await get<{ staff: Staff[] }>("/api/staff");
    setStaffList(data.staff);
    const chosen = data.staff.find((s) => s.id === readLocal(STAFF_KEY)) ?? data.staff[0];
    setStaffId(chosen.id);
    setStaff(chosen);
    const events = await get<{ latestSeq: number }>("/api/events");
    lastSeq.current ??= events.latestSeq;
    seqKnown.current?.resolve();
    await refresh(["exhibition", "placements", "objects", "preview"]);
  }, [refresh]);

  const startRef = useRef(start);
  startRef.current = start;
  const started = useRef(false);

  const pollStatus = useCallback(async () => {
    try {
      const data = await get<{ services: Services }>("/api/status");
      const wasDown = databaseDown.current;
      databaseDown.current = data.services.database === "down";
      setServices(data.services);
      // The banner, the focus move and the recovery sentence all follow the same status read.
      if (wasDown && !databaseDown.current) announce(say.databaseBack);
      if (!databaseDown.current && (!started.current || wasDown)) {
        if (!started.current) {
          started.current = true;
          await startRef.current().catch(() => {
            started.current = false;
          });
        } else {
          await refresh(["exhibition", "placements", "objects", "preview"]);
        }
      }
    } catch {
      // the server itself is unreachable; keep the last known status
    }
  }, [announce, refresh]);

  useEffect(() => {
    void pollStatus();
    const timer = setInterval(() => void pollStatus(), STATUS_EVERY_MS);
    return () => clearInterval(timer);
  }, [pollStatus]);

  useEffect(() => {
    if (!staff) return;
    let stopped = false;
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    // Asks for new events about every 1.5 s, at once again while events keep arriving,
    // so other sessions' changes show within seconds.
    const loop = async () => {
      while (!stopped) {
        await seqKnown.current?.promise;
        await whenIdle();
        const epoch = own.epoch;
        let data: { events: HangEvent[]; latestSeq: number };
        try {
          data = await get(`/api/events?after=${lastSeq.current ?? 0}`);
        } catch {
          await pause(EVENTS_RETRY_MS);
          continue;
        }
        if (stopped) return;
        // A change this tab made while the answer was in flight may be in it: ask again once idle.
        if (own.inflight > 0 || own.epoch !== epoch) continue;
        if (!data.events.length) {
          lastSeq.current = Math.max(lastSeq.current ?? 0, data.latestSeq);
          await wallPause(EVENTS_EVERY_MS);
          continue;
        }
        lastSeq.current = data.events[data.events.length - 1].seq;
        const theirs = data.events.filter((e) => !own.seqs.has(e.seq));
        if (theirs.length) {
          const text = theirs.map((e) => teamSentence(e, unitRef.current)).join(" ");
          setTeam((kept) => [...kept, { text, key: (kept.at(-1)?.key ?? 0) + 1 }].slice(-TEAM_KEPT));
        }
        const kinds = new Set(data.events.map((e) => e.kind.split(".")[0]));
        const what = new Set<"placements" | "objects" | "exhibition" | "preview">();
        if (kinds.has("placement") || kinds.has("object") || kinds.has("photo")) {
          what.add("placements");
          what.add("objects");
        }
        if (kinds.has("wall")) {
          what.add("placements");
          what.add("exhibition");
        }
        if (kinds.has("preview")) what.add("preview");
        await refresh([...what]);
        listeners.current.forEach((l) => l(data.events));
      }
    };
    void loop();
    return () => {
      stopped = true;
    };
  }, [staff, refresh]);

  useEffect(() => {
    if (!staff) return;
    const timer = setInterval(() => void resyncPreview().catch(() => undefined), PREVIEW_EVERY_MS);
    const visible = () => {
      if (document.visibilityState === "visible") void resyncPreview().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [staff, resyncPreview]);

  const store = useMemo<Store>(
    () => ({
      staffList,
      staff,
      unit,
      services,
      exhibition,
      placements,
      objects,
      preview,
      said,
      team,
      chooseStaff: (id) => {
        const next = staffList.find((s) => s.id === id);
        if (!next) return;
        setStaffId(next.id);
        writeLocal(STAFF_KEY, next.id);
        setStaff(next);
      },
      chooseUnit: (next) => {
        writeLocal(UNIT_KEY, next);
        setUnit(next);
      },
      announce,
      refresh,
      putPlacement: (p) =>
        setPlacements((list) => {
          if (!list) return list;
          if (p.status === "removed") return list.filter((x) => x.id !== p.id);
          return list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
        }),
      putObject: (o) =>
        setObjects((list) => (list ? (list.some((x) => x.id === o.id) ? list.map((x) => (x.id === o.id ? o : x)) : [...list, o]) : list)),
      putPreview: (p) => setPreview({ preview: p, syncedAt: performance.now() }),
      setWall: (wallId, plannedLux) =>
        setExhibition((ex) =>
          ex ? { ...ex, gallery: { ...ex.gallery, walls: ex.gallery.walls.map((w) => (w.id === wallId ? { ...w, plannedLux } : w)) } } : ex,
        ),
      retryStatus: pollStatus,
      onEvents: (listener) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
    }),
    [staffList, staff, unit, services, exhibition, placements, objects, preview, said, team, announce, refresh, pollStatus],
  );

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function bannerTexts(services: Services | null): { key: keyof Services; text: string }[] {
  if (!services) return [];
  return (Object.keys(BANNERS) as (keyof Services)[]).filter((k) => services[k] === "down").map((key) => ({ key, text: BANNERS[key] }));
}

export function isFailure(error: unknown, status?: number): error is ApiFailure {
  return error instanceof ApiFailure && (status === undefined || error.status === status);
}
