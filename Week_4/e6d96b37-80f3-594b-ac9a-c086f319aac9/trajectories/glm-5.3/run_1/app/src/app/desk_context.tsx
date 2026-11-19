import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { DeskEvent, DeskState, SessionInfo } from "../shared/types.js";
import { feedback } from "./feedback.js";
import { resumeStagedCommand, takeStagedResume } from "./resume.js";

export interface ApiFailure {
  status: number;
  body: { error: string; message: string; fields?: Record<string, string>; retry_after_seconds?: number };
}

export class ApiError extends Error {
  constructor(public failure: ApiFailure) {
    super(failure.body.message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? init?.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return null as T;
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    throw new ApiError({ status: res.status, body: body as ApiFailure["body"] });
  }
  return body as T;
}

export function getJson<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function putJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export function postForm<T>(path: string, form: FormData): Promise<T> {
  return request<T>(path, { method: "POST", body: form });
}

export function deleteCall<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export interface Desk {
  state: DeskState | null;
  session: SessionInfo | null;
  pending: string | null;
  setPending: (message: string | null) => void;
  error: string | null;
  reportError: (message: string) => void;
  clearError: () => void;
  announce: (message: string) => void;
  announcement: string | null;
  online: boolean;
  refresh: () => Promise<void>;
  lastFailure: ApiError | null;
  setLastFailure: (failure: ApiError | null) => void;
}

const DeskContext = createContext<Desk | null>(null);

export function DeskProvider({ namespace, role, children }: { namespace: string; role: "dealer" | "counterpart"; children: React.ReactNode }) {
  const [state, setState] = useState<DeskState | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [lastFailure, setLastFailure] = useState<ApiError | null>(null);
  const sequenceRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const next = await getJson<DeskState>(`/api/desks/${namespace}/state`);
      setState(next);
      if (next.events.length > 0) {
        sequenceRef.current = Math.max(sequenceRef.current, ...next.events.map((e) => e.sequence));
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.failure.body.message);
      }
    }
  }, [namespace]);

  useEffect(() => {
    void refresh();
    void getJson<SessionInfo>("/api/session").then(setSession).catch(() => undefined);
  }, [refresh]);

  // A staged command resumes exactly once after sign-in or step-up.
  useEffect(() => {
    if (!session || !session.username) return;
    const staged = takeStagedResume();
    if (!staged) return;
    void (async () => {
      setPending(feedback("F_RESUMED"));
      try {
        const outcome = await resumeStagedCommand(staged);
        if (!outcome.ok) {
          setError(outcome.message);
        }
      } finally {
        setPending(null);
        await refresh();
      }
    })();
  }, [session, refresh]);

  useEffect(() => {
    const source = new EventSource(`/api/desks/${namespace}/stream?after=${sequenceRef.current}`);
    source.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as DeskEvent;
      if (parsed.sequence > sequenceRef.current) {
        sequenceRef.current = parsed.sequence;
        void refresh();
      }
    };
    source.onerror = () => {
      setOnline(false);
    };
    source.onopen = () => {
      setOnline(true);
    };
    return () => source.close();
  }, [namespace, refresh]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const value: Desk = {
    state,
    session,
    pending,
    setPending,
    error,
    reportError: (message) => setError(message),
    clearError: () => setError(null),
    announce: (message) => setAnnouncement(message),
    announcement,
    online,
    refresh,
    lastFailure,
    setLastFailure,
  };
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useDesk(): Desk {
  const desk = useContext(DeskContext);
  if (!desk) throw new Error("DeskProvider missing");
  return desk;
}
