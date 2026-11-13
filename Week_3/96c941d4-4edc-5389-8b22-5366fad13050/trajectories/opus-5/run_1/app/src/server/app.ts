import { CAMPAIGN } from '../shared/constants.js';
import { Database, SCHEMA } from './db.js';
import { ApiError } from './errors.js';
import { ObjectStore } from './objects.js';
import { SearchIndex } from './search.js';
import { Store } from './store.js';
import { definitionDigest } from './digests.js';
import { loadConfig } from './config.js';
import type { ServerConfig } from './config.js';

export interface AppContext {
  config: ServerConfig;
  database: Database | null;
  store: Store | null;
  objects: ObjectStore | null;
  search: SearchIndex | null;
  schemaReady: boolean;
  indexReady: boolean;
}

export function createContext(): AppContext {
  const config = loadConfig();
  for (const diagnostic of config.diagnostics) {
    process.stderr.write(`[configuration] ${diagnostic}\n`);
  }
  const database = config.database === null ? null : new Database(config.database);
  return {
    config,
    database,
    store: database === null ? null : new Store(database),
    objects: config.objects === null ? null : new ObjectStore(config.objects),
    search: config.search === null ? null : new SearchIndex(config.search),
    schemaReady: false,
    indexReady: false,
  };
}

export function requireObjects(context: AppContext): ObjectStore {
  if (context.objects === null) throw new ApiError('EVIDENCE_UNAVAILABLE');
  return context.objects;
}

export function requireSearch(context: AppContext): SearchIndex {
  if (context.search === null) throw new ApiError('DISCOVERY_UNAVAILABLE');
  return context.search;
}

/** Applies schema and seed data idempotently, retrying on later relevant requests. */
export async function requireStore(context: AppContext): Promise<Store> {
  const store = context.store;
  const database = context.database;
  if (store === null || database === null) throw new ApiError('DATABASE_UNAVAILABLE');
  if (!context.schemaReady) {
    await database.query(SCHEMA);
    for (const encounter of CAMPAIGN) {
      await database.query(
        `INSERT INTO campaign_encounters (id, position, title, definition, digest)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET position = $2, title = $3, definition = $4, digest = $5`,
        [
          encounter.id,
          CAMPAIGN.indexOf(encounter),
          encounter.title,
          JSON.stringify(encounter.definition),
          definitionDigest(encounter.definition),
        ],
      );
    }
    context.schemaReady = true;
  }
  return store;
}

export async function initializeSearch(context: AppContext): Promise<void> {
  if (context.indexReady || context.search === null) return;
  await context.search.initialize();
  context.indexReady = true;
}
