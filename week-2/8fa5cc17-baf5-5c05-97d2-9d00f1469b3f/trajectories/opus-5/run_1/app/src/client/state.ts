import { api, SessionInfo } from './api';
import { CollectionDto, SavedQueryDto, TypeDto } from './types';
import { ThemeName } from '../shared/tokens';

export type WorkspaceState = {
  session: SessionInfo;
  types: TypeDto[];
  collections: CollectionDto[];
  queries: SavedQueryDto[];
  dailyRecent: { date: string; object_id: string }[];
};

const BUILTIN_ORDER = ['Source', 'Person', 'Concept', 'Daily note'];

let state: WorkspaceState | null = null;

export function workspace(): WorkspaceState {
  if (state === null) throw new Error('workspace state is not loaded');
  return state;
}

export function homeZone(): string {
  return workspace().session.home_time_zone;
}

export function theme(): ThemeName {
  return workspace().session.theme;
}

export function setTheme(next: ThemeName): void {
  workspace().session.theme = next;
  document.documentElement.setAttribute('data-theme', next);
}

export function setHomeZone(zone: string): void {
  workspace().session.home_time_zone = zone;
}

/** Library order: Source, Person, Concept, Daily note, then the owner's types, oldest first. */
export function libraryOrder(types: TypeDto[]): TypeDto[] {
  const builtins = BUILTIN_ORDER.map((name) => types.find((type) => type.name === name)).filter(
    (type): type is TypeDto => type !== undefined,
  );
  const rest = types.filter((type) => !BUILTIN_ORDER.includes(type.name));
  return [...builtins, ...rest];
}

export async function loadWorkspace(session: SessionInfo): Promise<WorkspaceState> {
  const [types, collections, queries, daily] = await Promise.all([
    api.get<{ types: TypeDto[] }>('/api/types'),
    api.get<{ collections: CollectionDto[] }>('/api/collections'),
    api.get<{ queries: SavedQueryDto[] }>('/api/queries'),
    api.get<{ notes: { date: string; object_id: string }[] }>('/api/daily/recent'),
  ]);
  state = {
    session,
    types: types.ok ? libraryOrder(types.data.types) : [],
    collections: collections.ok ? collections.data.collections : [],
    queries: queries.ok ? queries.data.queries : [],
    dailyRecent: daily.ok ? daily.data.notes : [],
  };
  return state;
}

export async function refreshLibrary(): Promise<void> {
  if (state === null) return;
  const [types, collections, queries, daily] = await Promise.all([
    api.get<{ types: TypeDto[] }>('/api/types'),
    api.get<{ collections: CollectionDto[] }>('/api/collections'),
    api.get<{ queries: SavedQueryDto[] }>('/api/queries'),
    api.get<{ notes: { date: string; object_id: string }[] }>('/api/daily/recent'),
  ]);
  if (types.ok) state.types = libraryOrder(types.data.types);
  if (collections.ok) state.collections = collections.data.collections;
  if (queries.ok) state.queries = queries.data.queries;
  if (daily.ok) state.dailyRecent = daily.data.notes;
}

export function typeById(id: string): TypeDto | undefined {
  return workspace().types.find((type) => type.id === id);
}
