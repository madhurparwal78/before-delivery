import { useEffect, useState } from "preact/hooks";
import type { Account, CurrentGameweek, NoticesView } from "../shared/api.ts";
import { request } from "./api.ts";

// App-wide state: the signed-in account, the server's current gameweek and the notice inbox.
interface AppState {
  me: Account | null;
  ready: boolean;
  gameweek: CurrentGameweek | null;
  notices: NoticesView | null;
  inboxDown: boolean;
}

let state: AppState = { me: null, ready: false, gameweek: null, notices: null, inboxDown: false };
const subscribers = new Set<() => void>();

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const notify of subscribers) notify();
}

export function getState(): AppState {
  return state;
}

export function useApp(): AppState {
  const [, setTick] = useState(0);
  useEffect(() => {
    const notify = () => setTick((tick) => tick + 1);
    subscribers.add(notify);
    return () => void subscribers.delete(notify);
  }, []);
  return state;
}

export async function refreshGameweek(): Promise<void> {
  const result = await request<CurrentGameweek>("GET", "/api/gameweeks/current");
  if (result.ok) setState({ gameweek: result.data });
}

export async function refreshNotices(): Promise<NoticesView | null> {
  const result = await request<NoticesView>("GET", "/api/notices");
  if (result.ok) {
    setState({ notices: result.data, inboxDown: false });
    return result.data;
  }
  if (result.status === 503) setState({ inboxDown: true });
  return null;
}
