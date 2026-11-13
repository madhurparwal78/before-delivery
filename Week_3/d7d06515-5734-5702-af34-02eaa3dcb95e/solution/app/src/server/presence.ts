// Presence in Valkey: a set of tab ids per drawing and a hash per tab, each expiring 30 seconds after its last refresh.
import type { Access } from '../shared/types.ts';
import { config } from './config.ts';
import { commands } from './valkey.ts';

const TAB_SECONDS = 30;
const SET_SECONDS = 60;

type PresenceState = 'Editing' | 'Viewing' | 'Away';

/** A person is the account or the share link, identified by the actor key. */
export interface Person { actor: string; name: string; access: Access }

interface Tab extends Person { state: 'Editing' | 'Viewing'; lastInputAt: Date }

const tabsKey = (drawingId: string): string => `presence:${drawingId}`;
const tabKey = (drawingId: string, tabId: string): string => `presence:${drawingId}:${tabId}`;
const stateOf = (access: Access): Tab['state'] => (access === 'owner' || access === 'edit' ? 'Editing' : 'Viewing');

/**
 * Registers a tab (or refreshes its input time when `input` is true). Resolves true when the tab is new;
 * false when it already existed or Valkey did not take it.
 */
export async function touchTab(drawingId: string, tabId: string, person: Person, at: Date, input: boolean): Promise<boolean> {
  const key = tabKey(drawingId, tabId);
  const pipeline = commands.pipeline().hset(key, { name: person.name, access: person.access, state: stateOf(person.access), actor: person.actor });
  if (input) pipeline.hset(key, 'last_input_at', at.toISOString());
  else pipeline.hsetnx(key, 'last_input_at', at.toISOString());
  pipeline.expire(key, TAB_SECONDS).sadd(tabsKey(drawingId), tabId).expire(tabsKey(drawingId), SET_SECONDS);
  try {
    const results = await pipeline.exec();
    return results?.[3]?.[1] === 1;
  } catch {
    return false;
  }
}

/** Extends a tab's life; false when its hash is gone (it expired while Valkey was away). */
export async function refreshTab(drawingId: string, tabId: string): Promise<boolean> {
  try {
    const results = await commands.pipeline().expire(tabKey(drawingId, tabId), TAB_SECONDS).expire(tabsKey(drawingId), SET_SECONDS).exec();
    return results?.[0]?.[1] === 1;
  } catch {
    return false;
  }
}

export async function dropTab(drawingId: string, tabId: string): Promise<void> {
  await commands.pipeline().srem(tabsKey(drawingId), tabId).del(tabKey(drawingId, tabId)).exec().catch(() => undefined);
}

/** Every live tab of the drawing; tabs whose hash expired are removed from the set. Empty when Valkey is unreachable. */
export async function readTabs(drawingId: string): Promise<Tab[]> {
  try {
    const ids = await commands.smembers(tabsKey(drawingId));
    if (ids.length === 0) return [];
    const results = await ids.reduce((pipeline, id) => pipeline.hgetall(tabKey(drawingId, id)), commands.pipeline()).exec();
    const tabs: Tab[] = [];
    const expired: string[] = [];
    ids.forEach((id, i) => {
      const fields = results?.[i]?.[1] as Record<string, string> | undefined;
      if (!fields?.actor || !fields.last_input_at) {
        expired.push(id);
        return;
      }
      tabs.push({
        actor: fields.actor, name: fields.name ?? '', access: fields.access as Access,
        state: fields.state === 'Editing' ? 'Editing' : 'Viewing', lastInputAt: new Date(fields.last_input_at),
      });
    });
    if (expired.length > 0) await commands.srem(tabsKey(drawingId), ...expired);
    return tabs;
  } catch {
    return [];
  }
}

/** One entry per person other than `selfActor`; Away when their newest input is at least the idle time old. */
export function collaborators(tabs: readonly Tab[], now: Date, selfActor: string): { name: string; state: PresenceState }[] {
  const newest = new Map<string, Tab>();
  for (const tab of tabs) {
    const seen = newest.get(tab.actor);
    if (tab.actor !== selfActor && (!seen || tab.lastInputAt > seen.lastInputAt)) newest.set(tab.actor, tab);
  }
  return [...newest.values()]
    .map((tab) => ({
      name: tab.name,
      state: now.getTime() - tab.lastInputAt.getTime() >= config.presenceIdleSeconds * 1000 ? 'Away' as const : tab.state,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.state.localeCompare(b.state));
}
