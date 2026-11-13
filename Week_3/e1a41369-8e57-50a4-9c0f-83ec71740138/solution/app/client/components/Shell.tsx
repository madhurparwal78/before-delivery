import { useEffect, useState, type ReactNode } from "react";
import type { Invite, Party, QuestFixture, TaskLists } from "../../shared/api";
import { ApiError, api } from "../api";
import { connectLive, loadChat } from "../live";
import { navigate } from "../router";
import { getState, resetState, setState, useStore } from "../store";
import { ErrorStrip } from "./ErrorStrip";
import { Notices } from "./Notices";
import { PlayerBar } from "./PlayerBar";
import { RestBanner } from "./RestBanner";

/** Load what the live stream has not delivered yet, only where nothing arrived first. */
async function bootstrap(): Promise<void> {
  try {
    const me = await api<import("../../shared/api").Player>("GET", "/api/me");
    if (!getState().me) setState({ me });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) navigate("/signin", true);
    return;
  }
  const [tasks, party, invites, fixtures] = await Promise.all([
    api<TaskLists>("GET", "/api/tasks"),
    api<{ party: Party | null }>("GET", "/api/party"),
    api<{ invites: Invite[] }>("GET", "/api/invites"),
    api<{ quests: QuestFixture[] }>("GET", "/api/quest-fixtures"),
  ]);
  setState((current) => ({
    tasks: current.tasks ?? tasks,
    party: current.party === undefined ? party.party : current.party,
    invites: current.me && current.invites.length > 0 ? current.invites : invites.invites,
    fixtures: fixtures.quests,
  }));
}

export function Shell({ children }: { children: ReactNode }) {
  const me = useStore((state) => state.me);
  const partyId = useStore((state) => state.party?.id);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    resetState();
    const close = connectLive();
    void bootstrap().then(() => setStarted(true));
    return close;
  }, []);

  useEffect(() => {
    if (partyId) void loadChat(partyId);
  }, [partyId]);

  if (!me || !started) return <PlayerBar />;
  return (
    <>
      <PlayerBar />
      <RestBanner />
      <ErrorStrip />
      {children}
      <Notices />
    </>
  );
}
