import { useSyncExternalStore } from "react";
import type { ChatMessage, Invite, Party, Player, Quest, QuestFixture, TaskLists } from "../shared/api";

interface State {
  me: Player | null;
  tasks: TaskLists | null;
  /** undefined until the first party event; null when the player is in no party. */
  party: Party | null | undefined;
  invites: Invite[];
  quest: Quest | null;
  chat: ChatMessage[];
  fixtures: QuestFixture[];
  alert: string | null;
  /** Tasks with an action in flight: their controls refuse a second press. */
  pendingTasks: string[];
  /** The list tab shown on phones. */
  tab: "habits" | "dailies" | "todos" | "rewards";
}

let state: State = { me: null, tasks: null, party: undefined, invites: [], quest: null, chat: [], fixtures: [], alert: null, pendingTasks: [], tab: "habits" };
const listeners = new Set<() => void>();

export const getState = (): State => state;

export function setState(change: Partial<State> | ((current: State) => Partial<State>)): void {
  state = { ...state, ...(typeof change === "function" ? change(state) : change) };
  for (const listener of listeners) listener();
}

export function resetState(): void {
  setState({ me: null, tasks: null, party: undefined, invites: [], quest: null, chat: [], alert: null, tab: "habits" });
}

export function useStore<T>(select: (current: State) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(state),
  );
}
