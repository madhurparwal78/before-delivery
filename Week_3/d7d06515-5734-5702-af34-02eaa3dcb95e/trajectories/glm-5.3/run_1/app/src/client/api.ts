import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiResult<T> {
  status: number;
  body: T;
  headers: Headers;
}

export interface ApiErrorShape {
  error?: string;
  errors?: Record<string, string>;
}

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields: Record<string, string>,
    public extra: Record<string, unknown>,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const options: RequestInit = { ...init, headers: { ...(init?.headers ?? {}) }, credentials: "same-origin" };
  if (init?.json !== undefined) {
    (options.headers as Record<string, string>)["content-type"] = "application/json";
    options.body = JSON.stringify(init.json);
    options.method = init.method ?? "POST";
  }
  const res = await fetch(path, options);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const shape = (body ?? {}) as ApiErrorShape;
    throw new ApiFailure(
      res.status,
      shape.error ?? "unknown",
      shape.errors ?? {},
      (body ?? {}) as Record<string, unknown>,
    );
  }
  return body as T;
}

/** Sends link pages' token as the Link auth header when present. */
export function linkHeaders(token: string | null): Record<string, string> {
  return token ? { authorization: `Link ${token}` } : {};
}

export function useLivePolling(callback: () => void, deps: unknown[] = []): void {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  });
  useEffect(() => {
    saved.current();
    const events = new EventSource("/api/events");
    events.onopen = () => undefined;
    events.onmessage = () => saved.current();
    return () => events.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export interface UseAnnouncer {
  message: string | null;
  announce: (text: string) => void;
}

export function useAnnouncer(): UseAnnouncer {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((text: string) => {
    setMessage(null);
    clearTimeout(timer.current ?? undefined);
    requestAnimationFrame(() => {
      setMessage(text);
      timer.current = setTimeout(() => setMessage(null), 8000);
    });
  }, []);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);
  return { message, announce };
}

export function formatDateKeyInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function debounce<F extends (...args: never[]) => void>(fn: F, ms: number): (...args: Parameters<F>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<F>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
