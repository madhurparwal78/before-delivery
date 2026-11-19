// Route dispatch by feature area. Each returns true when it handled the path.

import { RouteContext } from '../api.js';
import { SessionUser } from '../auth.js';

type Dispatcher = (route: RouteContext, user: SessionUser, path: string) => Promise<boolean>;

const loaders: Array<() => Promise<Dispatcher>> = [
  async () => (await import('./records.js')).records,
  async () => (await import('./config.js')).config,
  async () => (await import('./catalog.js')).catalog,
  async () => (await import('./map.js')).map,
  async () => (await import('./changes.js')).changes,
  async () => (await import('./oncall.js')).oncall,
  async () => (await import('./inbox.js')).inbox,
  async () => (await import('./files.js')).files,
];

export async function dispatch(route: RouteContext, user: SessionUser, path: string): Promise<boolean> {
  for (const load of loaders) {
    const handler = await load();
    if (await handler(route, user, path)) return true;
  }
  return false;
}

export async function dispatchRecords(route: RouteContext, user: SessionUser, path: string): Promise<boolean> {
  return (await import('./records.js')).records(route, user, path);
}

export async function dispatchConfig(route: RouteContext, user: SessionUser, path: string): Promise<boolean> {
  return (await import('./config.js')).config(route, user, path);
}

export async function dispatchCatalog(route: RouteContext, user: SessionUser, path: string): Promise<boolean> {
  return (await import('./catalog.js')).catalog(route, user, path);
}

export async function dispatchMap(route: RouteContext, user: SessionUser, path: string): Promise<boolean> {
  return (await import('./map.js')).map(route, user, path);
}

export async function dispatchChanges(route: RouteContext, user: SessionUser, path: string): Promise<boolean> {
  return (await import('./changes.js')).changes(route, user, path);
}

export async function dispatchOnCall(route: RouteContext, user: SessionUser, path: string): Promise<boolean> {
  return (await import('./oncall.js')).oncall(route, user, path);
}

export async function dispatchInboxApi(route: RouteContext, user: SessionUser, path: string): Promise<boolean> {
  return (await import('./inbox.js')).inbox(route, user, path);
}

export async function dispatchFiles(route: RouteContext, user: SessionUser, path: string): Promise<boolean> {
  return (await import('./files.js')).files(route, user, path);
}
