import { useCallback, useEffect, useRef, useState } from "react";
import { useAnnounce } from "./announce";
import { ApiError, type Match, type Paged, RequestKey, call, messageOf } from "./api";
import { setServerNow } from "./clock";
import { currentPath, signInReturningTo } from "./draft";
import { playersPerMatch } from "./format";
import { useSession } from "./session";

interface MatchFilter {
  level?: string;
  day?: string;
}

export interface JoinState {
  pending: boolean;
  error: string | null;
}

const refreshMs = 10_000;
const refreshCodes = new Set(["MATCH_FULL", "MATCH_CLOSED", "SLOT_TAKEN", "HOLD_EXPIRED"]);

/** The open matches for a level and day: re-read every 10 seconds and after each of the player's own actions. */
export function useMatches(filter: MatchFilter) {
  const session = useSession();
  const announce = useAnnounce();
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [joins, setJoins] = useState<Record<string, JoinState>>({});
  const filterKey = `${filter.level ?? ""}|${filter.day ?? ""}`;
  const signedIn = session.state === "signed-in";
  const latest = useRef(0);
  const keys = useRef(new Map<string, RequestKey>());
  // The last status each listed match was read with, so a match the viewer is in that turns from open to cancelled
  // while the page is open is announced once, and one already cancelled when first read never is.
  const statuses = useRef(new Map<string, Match["status"]>());

  const refresh = useCallback(async () => {
    if (session.state === "loading") return;
    const query = new URLSearchParams();
    if (filter.level) query.set("level", filter.level);
    if (filter.day) query.set("day", filter.day);
    const ticket = ++latest.current;
    try {
      const body = await call<Paged<Match>>(`/api/matches${query.size ? `?${query}` : ""}`);
      if (ticket !== latest.current) return;
      if (body.items[0]) setServerNow(body.items[0].server_now);
      for (const match of body.items) {
        const before = statuses.current.get(match.id);
        statuses.current.set(match.id, match.status);
        if (match.joined && before === "open" && match.status === "cancelled") announce("Match cancelled.");
      }
      setMatches(body.items);
      setFailed(null);
    } catch (error) {
      if (ticket === latest.current) setFailed(messageOf(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, session.state, announce]);

  useEffect(() => {
    setMatches(null);
    void refresh();
    const timer = window.setInterval(() => void refresh(), refreshMs);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const join = useCallback(
    async (match: Match) => {
      if (!signedIn) {
        signInReturningTo(currentPath());
        return;
      }
      const requestKey = keys.current.get(match.id) ?? new RequestKey();
      keys.current.set(match.id, requestKey);
      setJoins((current) => ({ ...current, [match.id]: { pending: true, error: null } }));
      try {
        const joined = await call<Match>(`/api/matches/${match.id}/join`, { method: "POST", body: {}, key: requestKey.for(match.id) });
        requestKey.settle(null);
        setServerNow(joined.server_now);
        latest.current++; // a refresh sent before this answer reads the match as it was; this answer wins
        setMatches((current) => current?.map((m) => (m.id === joined.id ? joined : m)) ?? current);
        setJoins((current) => ({ ...current, [match.id]: { pending: false, error: null } }));
        announce("You joined the match.");
        if (joined.status === "full" || joined.players === playersPerMatch) announce("Match is full.");
      } catch (error) {
        requestKey.settle(error);
        setJoins((current) => ({ ...current, [match.id]: { pending: false, error: messageOf(error) } }));
        if (error instanceof ApiError && refreshCodes.has(error.code)) void refresh();
      }
      void refresh();
    },
    [announce, refresh, signedIn],
  );

  return { matches, failed, joins, join };
}
