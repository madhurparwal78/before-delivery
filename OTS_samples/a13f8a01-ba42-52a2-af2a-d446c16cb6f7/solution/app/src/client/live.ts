import { useEffect, useRef } from "react";
import type { LiveCounts, LiveHead, Pen, User } from "../shared/types.js";
import { api } from "./api.js";
import { loadConfig } from "./config.js";

interface LiveHandlers {
  counts?: (counts: LiveCounts) => void;
  head?: (head: LiveHead) => void;
  account?: () => void;
}

interface Subscription {
  pens: readonly string[];
  handlers: LiveHandlers;
}

const subscriptions = new Set<Subscription>();
let source: EventSource | null = null;
let connectedTo = "";
let polling: number | null = null;

function each(call: (handlers: LiveHandlers) => void): void {
  for (const subscription of subscriptions) call(subscription.handlers);
}

async function pollOnce(): Promise<void> {
  const ids = new Set([...subscriptions].flatMap((subscription) => subscription.pens));
  for (const id of ids) {
    const pen = await api.get<Pen>(`/api/pens/${id}`).catch(() => null);
    if (pen === null) continue;
    each((handlers) => handlers.counts?.({ pen_id: pen.id, likes: pen.likes, forks: pen.forks }));
    each((handlers) => handlers.head?.({ pen_id: pen.id, head: pen.head }));
  }
  if ([...subscriptions].some((subscription) => subscription.handlers.account)) {
    const me = await api.get<{ user: User }>("/api/me").catch(() => null);
    if (me?.user.verified) each((handlers) => handlers.account?.());
  }
}

async function schedulePoll(): Promise<void> {
  const { live_poll_ms } = await loadConfig();
  polling = window.setTimeout(() => {
    void pollOnce().then(() => {
      if (polling !== null) void schedulePoll();
    });
  }, live_poll_ms);
}

function stopPolling(): void {
  if (polling !== null) window.clearTimeout(polling);
  polling = null;
}

function parse<T>(event: Event): T {
  return JSON.parse((event as MessageEvent<string>).data) as T;
}

function connect(): void {
  const wanted = [...new Set([...subscriptions].flatMap((subscription) => subscription.pens))].sort().join(",");
  if (subscriptions.size === 0) {
    source?.close();
    source = null;
    connectedTo = "";
    stopPolling();
    return;
  }
  if (source !== null && wanted === connectedTo) return;
  source?.close();
  connectedTo = wanted;
  source = new EventSource(`/api/events?pens=${wanted}`);
  source.addEventListener("counts", (event) => each((handlers) => handlers.counts?.(parse<LiveCounts>(event))));
  source.addEventListener("head", (event) => each((handlers) => handlers.head?.(parse<LiveHead>(event))));
  source.addEventListener("account", () => each((handlers) => handlers.account?.()));
  source.onopen = stopPolling;
  source.onerror = () => {
    if (polling === null) void schedulePoll();
  };
}

export function useLive(pens: readonly string[], handlers: LiveHandlers, active = true): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  const key = pens.join(",");
  useEffect(() => {
    if (!active) return;
    const subscription: Subscription = {
      pens: key === "" ? [] : key.split(","),
      handlers: {
        counts: (counts) => latest.current.counts?.(counts),
        head: (head) => latest.current.head?.(head),
        ...(latest.current.account ? { account: () => latest.current.account?.() } : {}),
      },
    };
    subscriptions.add(subscription);
    connect();
    return () => {
      subscriptions.delete(subscription);
      connect();
    };
  }, [key, active]);
}
