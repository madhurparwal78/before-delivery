import type {
  CatalogueObject,
  Kit,
  Observation,
  Program,
  ProgramDetail,
  Session,
  SessionWithObservations,
  Site,
} from "../../shared/types";
import { call } from "./http";
import { accountId, app, type ServerCopy } from "./model";
import { saveTouched, type Touched } from "./persist";
import { handleUnauthorized } from "./unauth";

/**
 * Writes a server answer into the device copy, but only while the account that asked is still
 * the account on screen, so a late reply from an earlier account paints nothing.
 */
export async function commit(
  account: string,
  change: (server: ServerCopy) => ServerCopy,
  touched: Touched,
): Promise<boolean> {
  if (accountId() !== account) return false;
  app.set((state) => ({ server: change(state.server) }));
  await saveTouched(account, touched);
  return true;
}

/** A read of one server route: null when unreachable, otherwise status and body. */
async function read<T>(path: string): Promise<{ status: number; body: T } | null> {
  const answer = await call<T>("GET", path);
  return answer ? { status: answer.status, body: answer.body } : null;
}

export async function refreshKit(): Promise<void> {
  const account = accountId();
  if (!account) return;
  const [kit, sites] = await Promise.all([read<Kit>("/api/kit"), read<{ sites: Site[] }>("/api/sites")]);
  if (kit?.status === 200) await commit(account, (s) => ({ ...s, kit: kit.body }), { singles: ["kit"] });
  if (sites?.status === 200) await commit(account, (s) => ({ ...s, sites: sites.body.sites }), { singles: ["sites"] });
}

export async function refreshObjects(): Promise<void> {
  const account = accountId();
  if (!account) return;
  const answer = await read<{ objects: CatalogueObject[] }>("/api/objects");
  if (answer?.status === 200) await commit(account, (s) => ({ ...s, objects: answer.body.objects }), { singles: ["objects"] });
}

export async function refreshPrograms(): Promise<void> {
  const account = accountId();
  if (!account) return;
  const answer = await read<{ programs: Program[] }>("/api/programs");
  if (answer?.status !== 200) return;
  await commit(account, (s) => ({ ...s, programs: answer.body.programs }), { singles: ["programs"] });
}

export async function refreshProgram(id: string): Promise<number | null> {
  const account = accountId();
  if (!account) return null;
  const answer = await read<ProgramDetail>(`/api/programs/${id}`);
  if (!answer) return null;
  if (answer.status === 200) {
    // The checklist names each representative observation, so fetch the ones the device lacks
    // first and paint the screen once, complete.
    const held = app.get().server.observations;
    const lacking = answer.body.objects
      .map((o) => o.qualifying_observation_id)
      .filter((oid): oid is string => oid !== null && !held[oid]);
    const fetched = (await Promise.all(lacking.map((oid) => read<Observation>(`/api/observations/${oid}`))))
      .filter((x): x is { status: number; body: Observation } => x?.status === 200)
      .map((x) => x.body);
    await commit(
      account,
      (s) => {
        const observations = { ...s.observations };
        for (const o of fetched) observations[o.id] = o;
        return { ...s, observations, programDetails: { ...s.programDetails, [id]: answer.body } };
      },
      { programs: [id], observations: fetched.map((o) => o.id) },
    );
  }
  return answer.status;
}

export async function refreshSessionList(): Promise<void> {
  const account = accountId();
  if (!account) return;
  const answer = await read<{ sessions: Session[] }>("/api/sessions");
  if (answer?.status !== 200) return;
  await commit(
    account,
    (s) => {
      const sessions: Record<string, Session> = {};
      for (const next of answer.body.sessions) sessions[next.id] = next;
      return { ...s, sessions };
    },
    { sessions: answer.body.sessions.map((x) => x.id) },
  );
}

/** One session with its observations; the observations of that session are replaced by the answer. */
export async function refreshSession(id: string): Promise<number | null> {
  const account = accountId();
  if (!account) return null;
  const answer = await read<SessionWithObservations>(`/api/sessions/${id}`);
  if (!answer) return null;
  if (answer.status !== 200) return answer.status;
  const { observations, ...session } = answer.body;
  const known = new Set(observations.map((o) => o.id));
  await commit(
    account,
    (s) => {
      const next: Record<string, Observation> = {};
      for (const [key, value] of Object.entries(s.observations)) {
        if (value.session_id !== id || known.has(key)) next[key] = value;
      }
      for (const o of observations) {
        const held = next[o.id];
        if (!held || o.version >= held.version) next[o.id] = o;
      }
      const strokes = { ...s.strokes };
      for (const key of Object.keys(s.observations)) if (!(key in next)) delete strokes[key];
      return { ...s, sessions: { ...s.sessions, [id]: session }, observations: next, strokes };
    },
    {
      sessions: [id],
      observations: observations.map((o) => o.id),
      removedObservations: Object.values(app.get().server.observations)
        .filter((o) => o.session_id === id && !known.has(o.id))
        .map((o) => o.id),
    },
  );
  return 200;
}

export async function refreshStroke(observationId: string): Promise<"ok" | "unavailable" | "none" | "offline"> {
  const account = accountId();
  if (!account) return "offline";
  try {
    const response = await fetch(`/api/observations/${observationId}/strokes`, { credentials: "same-origin", cache: "no-store" });
    if (!app.get().reachable) app.set({ reachable: true });
    if (response.status === 401) handleUnauthorized();
    if (response.status === 503) return "unavailable";
    if (response.status !== 200) return "none";
    const text = await response.text();
    await commit(account, (s) => ({ ...s, strokes: { ...s.strokes, [observationId]: text } }), { strokes: [observationId] });
    return "ok";
  } catch {
    app.set({ reachable: false });
    return "offline";
  }
}

export async function refreshObservation(id: string): Promise<number | null> {
  const account = accountId();
  if (!account) return null;
  const answer = await read<Observation>(`/api/observations/${id}`);
  if (!answer) return null;
  if (answer.status === 200) {
    await commit(account, (s) => ({ ...s, observations: { ...s.observations, [id]: answer.body } }), { observations: [id] });
  }
  return answer.status;
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++]!;
        await work(item);
      }
    }),
  );
}

let refreshing: Promise<void> | null = null;
let refreshAgain = false;

/** Brings the whole account to the device: kit, sites, programs, every session, observation and stroke file. */
export function refreshDevice(): Promise<void> {
  if (refreshing) {
    refreshAgain = true;
    return refreshing;
  }
  refreshing = run().finally(() => {
    refreshing = null;
    if (refreshAgain) {
      refreshAgain = false;
      void refreshDevice();
    }
  });
  return refreshing;
}

async function run(): Promise<void> {
  const account = accountId();
  if (!account || !navigator.onLine) return;
  await Promise.all([refreshKit(), refreshObjects(), refreshPrograms()]);
  const programs = app.get().server.programs ?? [];
  await pool(programs, 4, async (p) => void (await refreshProgram(p.id)));
  await refreshSessionList();
  const sessions = Object.keys(app.get().server.sessions);
  await pool(sessions, 4, async (id) => void (await refreshSession(id)));
  const server = app.get().server;
  const missing = Object.values(server.observations).filter((o) => o.sketch && server.strokes[o.id] === undefined);
  await pool(missing, 6, async (o) => void (await refreshStroke(o.id)));
  await refreshChangedStrokes();
}

/** A stroke file whose checksum no longer matches the observation's sketch is read again. */
async function refreshChangedStrokes(): Promise<void> {
  const server = app.get().server;
  const stale: string[] = [];
  const encoder = new TextEncoder();
  for (const o of Object.values(server.observations)) {
    const text = server.strokes[o.id];
    if (!o.sketch || text === undefined) continue;
    if (encoder.encode(text).length !== o.sketch.strokes_size) stale.push(o.id);
  }
  await pool(stale, 6, async (id) => void (await refreshStroke(id)));
}

/** One object's history: the observations of that object are replaced by the answer. */
export async function refreshHistory(objectId: string): Promise<number | null> {
  const account = accountId();
  if (!account) return null;
  const answer = await read<{ observations: Observation[] }>(`/api/objects/${objectId}/history`);
  if (!answer) return null;
  if (answer.status !== 200) return answer.status;
  const fresh = answer.body.observations;
  const known = new Set(fresh.map((o) => o.id));
  const gone = Object.values(app.get().server.observations)
    .filter((o) => o.object_id === objectId && !known.has(o.id))
    .map((o) => o.id);
  await commit(
    account,
    (s) => {
      const observations = { ...s.observations };
      const strokes = { ...s.strokes };
      for (const id of gone) {
        delete observations[id];
        delete strokes[id];
      }
      for (const o of fresh) {
        const held = observations[o.id];
        if (!held || o.version >= held.version) observations[o.id] = o;
      }
      return { ...s, observations, strokes };
    },
    { observations: fresh.map((o) => o.id), removedObservations: gone },
  );
  return 200;
}
