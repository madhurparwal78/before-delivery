import type {
  CatalogueObject,
  Kit,
  Observation,
  ObservingSession,
  Packet,
  Program,
  ProgramDetail,
  Site,
} from '../shared/types.js';
import { api, fetchBytes } from './api.js';
import { appState, updateCopy } from './state.js';

/**
 * Within ten seconds of the first online visit to a working screen the device
 * holds the whole account, so every screen and sketch opens offline.
 */
let running = false;
let done = false;

async function readSessionsWithObservations(): Promise<void> {
  const list = await api.get<{ sessions: ObservingSession[] }>('/api/sessions');
  if (!list.ok || !list.body) return;
  const sessions = list.body.sessions;
  updateCopy((copy) => {
    for (const session of sessions) copy.sessions[session.id] = session;
  });
  const details = await Promise.all(
    sessions.map((session) =>
      api.get<ObservingSession & { observations: Observation[] }>(`/api/sessions/${session.id}`),
    ),
  );
  const observations: Observation[] = [];
  for (const detail of details) {
    if (!detail.ok || !detail.body) continue;
    observations.push(...detail.body.observations);
  }
  updateCopy((copy) => {
    for (const observation of observations) copy.observations[observation.id] = observation;
  });
  await Promise.all(
    observations
      .filter((observation) => observation.sketch !== null)
      .map(async (observation) => {
        const answer = await fetchBytes(`/api/observations/${observation.id}/strokes`);
        if (answer.status === 200 && answer.text !== null) {
          updateCopy((copy) => {
            copy.stroke_files[observation.id] = answer.text as string;
          });
        }
      }),
  );
}

async function readPrograms(): Promise<void> {
  const list = await api.get<{ programs: Program[] }>('/api/programs');
  if (!list.ok || !list.body) return;
  updateCopy((copy) => {
    copy.programs = list.body.programs;
  });
  const details = await Promise.all(
    list.body.programs.map((program) => api.get<ProgramDetail>(`/api/programs/${program.id}`)),
  );
  updateCopy((copy) => {
    for (const detail of details) {
      if (detail.ok && detail.body) copy.program_objects[detail.body.id] = detail.body.objects;
    }
  });
}

export async function prefetchAccount(force = false): Promise<void> {
  if (running) return;
  if (done && !force) return;
  if (!appState().account) return;
  running = true;
  try {
    const [kit, sites, objects, packets] = await Promise.all([
      api.get<Kit>('/api/kit'),
      api.get<{ sites: Site[] }>('/api/sites'),
      api.get<{ objects: CatalogueObject[] }>('/api/objects'),
      api.get<{ packets: Packet[] }>('/api/packets'),
    ]);
    if (kit.offline) return;
    updateCopy((copy) => {
      if (kit.ok && kit.body) copy.kit = kit.body;
      if (sites.ok && sites.body) copy.sites = sites.body.sites;
      if (objects.ok && objects.body) copy.objects = objects.body.objects;
      if (packets.ok && packets.body) {
        for (const packet of packets.body.packets) copy.packets[packet.id] = packet;
      }
    });
    await Promise.all([readSessionsWithObservations(), readPrograms()]);
    updateCopy((copy) => {
      copy.complete = true;
    });
    done = true;
  } finally {
    running = false;
  }
}

export function resetPrefetch(): void {
  done = false;
}
