import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, call, get } from "./api";
import type { Board, BoardEvent, LinkPage, Listing, Services } from "../shared/types";

export type Source = { kind: "board"; id: string } | { kind: "link"; token: string; embed: boolean };
type Status = "loading" | "ready" | "not_found" | "password";

export interface Snapshot {
  board: Board;
  listing: Listing;
}

interface BoardData {
  status: Status;
  board: Board | null;
  listing: Listing | null;
  services: Services;
  /** Bumped for a post when a comment arrives, and for the board when its members change. */
  ticks: Record<string, number>;
  membersTick: number;
  /** Fetches the board again; resolves with what the screen now holds. */
  reload: () => Promise<Snapshot | null>;
  /** Shows a board setting at once, before the server has answered. */
  applyBoard: (change: Partial<Board>) => void;
  unlock: (password: string) => Promise<boolean>;
}

const basePath = (source: Source): string => (source.kind === "board" ? `/api/boards/${source.id}` : `/api/links/${source.token}`);

/**
 * The board a screen shows, kept live: it is loaded, then every change event from the server reloads it.
 * `onEvent` hears each event as it arrives and `afterLoad` runs after each load with the fresh snapshot.
 */
export function useBoardData(source: Source, onEvent: (event: BoardEvent) => void, afterLoad: (snapshot: Snapshot) => void): BoardData {
  const [status, setStatus] = useState<Status>("loading");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [services, setServices] = useState<Services>({ storage: true, mail: true, push: true });
  const [ticks, setTicks] = useState<Record<string, number>>({});
  const [membersTick, setMembersTick] = useState(0);
  const latest = useRef<Snapshot | null>(null);
  const handlers = useRef({ onEvent, afterLoad });
  handlers.current = { onEvent, afterLoad };
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const key = source.kind === "board" ? source.id : `${source.token}:${source.embed}`;

  const denied = useCallback(
    (reason: "password" | "not_found") => setStatus(reason === "password" && !(source.kind === "link" && source.embed) ? "password" : "not_found"),
    [key],
  );

  const fetchOnce = useCallback(async (): Promise<void> => {
    try {
      const base = basePath(source);
      const next =
        source.kind === "board"
          ? { board: await get<Board>(base), listing: await get<Listing>(`${base}/posts`) }
          : await get<LinkPage>(base).then((page) => ({ board: page.board, listing: page.posts }));
      latest.current = next;
      setSnapshot(next);
      setStatus("ready");
      handlers.current.afterLoad(next);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 404) denied("not_found");
      else if (error.status === 403) denied("password");
      else throw error;
    }
  }, [key, denied]);

  const reload = useCallback((): Promise<Snapshot | null> => {
    if (running.current) {
      again.current = true;
      return running.current.then(() => latest.current);
    }
    const cycle = (async () => {
      do {
        again.current = false;
        await fetchOnce();
      } while (again.current);
    })().finally(() => {
      running.current = null;
    });
    running.current = cycle;
    return cycle.then(() => latest.current);
  }, [fetchOnce]);

  useEffect(() => {
    latest.current = null;
    setSnapshot(null);
    setStatus("loading");
    void reload();
  }, [key, reload]);

  const live = status === "ready";
  useEffect(() => {
    if (!live) return;
    const stream = new EventSource(`${basePath(source)}/events`);
    stream.onopen = () => void reload();
    stream.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as BoardEvent;
      if (event.type === "comment_added") setTicks((current) => ({ ...current, [event.post_id]: (current[event.post_id] ?? 0) + 1 }));
      if (event.type === "members_changed") setMembersTick((tick) => tick + 1);
      handlers.current.onEvent(event);
      void reload();
    };
    // The browser gives up on a stream it may no longer open (a 404 on reconnect): the reload shows why.
    stream.onerror = () => {
      if (stream.readyState === EventSource.CLOSED) void reload();
    };
    stream.addEventListener("services", (message) => setServices(JSON.parse((message as MessageEvent<string>).data) as Services));
    stream.addEventListener("access_lost", (message) => {
      const { reason } = JSON.parse((message as MessageEvent<string>).data) as { reason: "not_found" | "password_required" };
      stream.close();
      denied(reason === "password_required" ? "password" : "not_found");
    });
    return () => stream.close();
  }, [live, key, reload, denied]);

  const applyBoard = useCallback((change: Partial<Board>) => {
    setSnapshot((current) => (current ? { ...current, board: { ...current.board, ...change } } : current));
  }, []);

  const unlock = useCallback(
    async (password: string): Promise<boolean> => {
      try {
        await call("POST", `${basePath(source)}/unlock`, { password });
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 404) return false;
        throw error;
      }
      await reload();
      return true;
    },
    [key, reload],
  );

  return { status, board: snapshot?.board ?? null, listing: snapshot?.listing ?? null, services, ticks, membersTick, reload, applyBoard, unlock };
}
