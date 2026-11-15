import { useEffect, useRef } from "preact/hooks";
import type { LiveEvent } from "../shared/types";
import { getState, setState } from "./store";

type Handler = (event: LiveEvent) => void;

const watchers = new Map<number, { pens: string[]; handler: Handler }>();
let nextWatcher = 1;
let source: EventSource | null = null;
let sourceKey = "";
let reopenTimer: number | undefined;

function dispatch(event: LiveEvent): void {
  if (event.type === "account") {
    const user = getState().user;
    if (user && !user.verified) setState({ user: { ...user, verified: true }, accountStatus: "Email verified. You can now save versions." });
  }
  for (const watcher of watchers.values()) watcher.handler(event);
}

function reopen(): void {
  const pens = [...new Set([...watchers.values()].flatMap((watcher) => watcher.pens))].sort();
  const wanted = getState().user || pens.length > 0 ? `/api/events?pens=${pens.join(",")}` : "";
  if (wanted === sourceKey && source) return;
  source?.close();
  source = null;
  sourceKey = wanted;
  if (wanted === "") return;
  const stream = new EventSource(wanted);
  stream.addEventListener("counts", (event) => dispatch({ type: "counts", data: JSON.parse((event as MessageEvent<string>).data) }));
  stream.addEventListener("head", (event) => dispatch({ type: "head", data: JSON.parse((event as MessageEvent<string>).data) }));
  stream.addEventListener("account", () => dispatch({ type: "account", data: { verified: true } }));
  source = stream;
}

export function refreshLive(): void {
  window.clearTimeout(reopenTimer);
  reopenTimer = window.setTimeout(reopen, 0);
}

/** Keeps a live stream open for these pens (and the account) while the calling screen is shown. */
export function useLive(pens: readonly string[], handler: Handler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const key = pens.join(",");
  useEffect(() => {
    const id = nextWatcher++;
    watchers.set(id, { pens: key === "" ? [] : key.split(","), handler: (event) => handlerRef.current(event) });
    refreshLive();
    return () => {
      watchers.delete(id);
      refreshLive();
    };
  }, [key]);
}
