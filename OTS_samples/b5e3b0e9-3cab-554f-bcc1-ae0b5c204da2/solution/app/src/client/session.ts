import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { api, ApiFailure } from "./api.ts";
import type { Layout } from "../shared/layout.ts";
import type { AlertView, Payload, Position } from "../shared/wire.ts";

export interface SessionInfo {
  layout: Layout;
  scenario: string;
  aerodrome: string;
  me: { id: string; instructor: boolean; position: Position | null };
  forms: Record<Position, string[]>;
}

export interface SessionView {
  payload: Payload | null;
  sessionInfo: SessionInfo | null;
  connection: "connecting" | "live" | "lost";
  missing: boolean;
  /** Alerts that arrived with the latest update, and a counter that changes with each update that brings some. */
  fresh: AlertView[];
  freshSeq: number;
}

const INITIAL: SessionView = { payload: null, sessionInfo: null, connection: "connecting", missing: false, fresh: [], freshSeq: 0 };

type StateBody = Payload & SessionInfo;

/** Opens a session: reads its state, then applies every push in the server's order, dropping any older than what is shown. */
function openSession(id: string, onChange: (view: SessionView) => void) {
  let view = INITIAL;
  let socket: WebSocket | null = null;
  let closed = false;
  let everLost = false;

  const set = (next: SessionView): void => {
    view = next;
    onChange(view);
  };

  const apply = (payload: Payload): void => {
    const previous = view.payload;
    if (previous && payload.rev <= previous.rev) return;
    const seen = previous ? Math.max(0, ...previous.alerts.map((a) => a.id)) : Number.POSITIVE_INFINITY;
    const fresh = payload.alerts.filter((a) => a.id > seen);
    set({ ...view, payload, fresh, freshSeq: fresh.length > 0 ? view.freshSeq + 1 : view.freshSeq });
  };

  const refetch = async (): Promise<void> => {
    try {
      const body = await api<StateBody>("GET", `/api/sessions/${id}/state`);
      const { layout, scenario, aerodrome, me, forms, ...payload } = body;
      set({ ...view, sessionInfo: { layout, scenario, aerodrome, me, forms } });
      apply(payload);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) set({ ...view, missing: true });
    }
  };

  const connect = (): void => {
    if (closed) return;
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${scheme}://${window.location.host}/api/sessions/${id}/live`);
    socket.addEventListener("open", () => {
      set({ ...view, connection: "live" });
      if (everLost) void refetch();
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; payload: Payload };
      if (message.type === "state") apply(message.payload);
    });
    socket.addEventListener("close", () => {
      if (closed) return;
      everLost = true;
      set({ ...view, connection: "lost" });
      window.setTimeout(connect, 1000);
    });
  };

  void refetch();
  connect();
  return {
    /** Reads the state again; used after a conflict, when pushes may be held. */
    refetch,
    close: () => {
      closed = true;
      socket?.close();
    },
  };
}

export function useSession(id: string): { view: SessionView; refetch: () => Promise<void> } {
  const [view, setView] = useState<SessionView>(INITIAL);
  const link = useRef<ReturnType<typeof openSession> | null>(null);
  useLayoutEffect(() => {
    setView(INITIAL);
    const opened = openSession(id, setView);
    link.current = opened;
    return () => opened.close();
  }, [id]);
  return { view, refetch: () => link.current?.refetch() ?? Promise.resolve() };
}
