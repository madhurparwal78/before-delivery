import type { Db } from './db.js';
import { LiveHub } from './live.js';
import type { LiveClient, PresenceRow } from './live.js';
import type { MapState, StoreTopic, GroupOutcome } from './engine.js';
import type {
  Operation, GroupResponse, RecoveredEntry, Role, TopicNode, CrossLink, Boundary, VersionInfo, PersonInfo,
} from '../shared/types.js';
import type { Settings } from '../shared/settings.js';
import type { S3 } from './storage.js';
import { loadMapState, saveMapState } from './context.js';

/**
 * Services: the durable server state. One instance is shared by the
 * HTTP routes, the live hub and the grading routes.
 */
export class Services {
  db: Db;
  hub = new LiveHub();
  settings: Settings;
  s3: S3 | null;
  storageDown = false;
  dbReady = false;

  constructor(db: Db, settings: Settings, s3: S3 | null) {
    this.db = db;
    this.settings = settings;
    this.s3 = s3;
  }
}

export interface RoleOnMap {
  role: Role;
  username: string;
  guest: boolean;
}

export async function loadMapFor(svc: Services, mapId: string) {
  return loadMapState(svc.db, mapId);
}

export { saveMapState };

export function presenceColourFor(svc: Services, mapId: string, username: string): number {
  return svc.hub.allocateColour(mapId, username);
}

export function presenceList(svc: Services, mapId: string): PersonInfo[] {
  const rows = svc.hub.listPresence(mapId);
  const out: PersonInfo[] = [];
  for (const r of rows) {
    out.push({ username: r.username, role: r.role as Role, guest: r.guest, colour: r.colour });
  }
  return out;
}

export type { LiveClient, PresenceRow, StoreTopic, GroupOutcome, MapState, Operation, GroupResponse, RecoveredEntry, CrossLink, Boundary, VersionInfo };
