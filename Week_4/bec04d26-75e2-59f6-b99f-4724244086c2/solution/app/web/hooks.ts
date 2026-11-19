import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { LiveEvent, ReturnList, ReturnView } from "../shared/types";
import { countsOf } from "../shared/counts";
import { get } from "./api";
import { onLive } from "./live";

/** Calls the handler for every live event while the component is mounted. */
export function useLive(handler: (event: LiveEvent) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => onLive((event) => latest.current(event)), []);
}

/** Loads a list of returns and reloads it when anything that could change it happens. Older answers never win. */
export function useReturnList(path: string): ReturnList | null {
  const [list, setList] = useState<ReturnList | null>(null);
  const latest = useRef({ path, ticket: 0 });
  latest.current.path = path;

  const load = useCallback(async () => {
    const ticket = ++latest.current.ticket;
    const asked = latest.current.path;
    const answer = await get<ReturnList>(asked);
    if (answer.ok && ticket === latest.current.ticket) setList(answer.data);
  }, []);

  useEffect(() => {
    void load();
  }, [path, load]);
  useLive((event) => {
    if (event.type === "return") {
      // Show the pushed return at once, so a line announced about it never runs ahead of the screen.
      flushSync(() => setList((shown) => shown && replaceReturn(shown, event.return)));
    }
    if (event.type === "return" || event.type === "lists" || event.type === "clock") void load();
  });
  return list;
}

function replaceReturn(shown: ReturnList, next: ReturnView): ReturnList {
  const returns = shown.returns.map((r) => (r.id === next.id && r.version <= next.version ? next : r));
  return { returns, counts: countsOf(returns) };
}

/** One return, kept current by live events; a live event never moves it back to an older version. */
export function useReturn(id: string): { view: ReturnView | null; missing: boolean; replace: (view: ReturnView) => void } {
  const [view, setView] = useState<ReturnView | null>(null);
  const [missing, setMissing] = useState(false);
  const accept = useCallback((next: ReturnView) => {
    setView((previous) => (previous && previous.id === next.id && previous.version > next.version ? previous : next));
  }, []);
  useEffect(() => {
    setView(null);
    setMissing(false);
    void get<ReturnView>(`/api/returns/${id}`).then((answer) => {
      if (answer.ok) accept(answer.data);
      else setMissing(true);
    });
  }, [id, accept]);
  useLive((event) => {
    if (event.type === "return" && event.return.id === id) flushSync(() => accept(event.return));
  });
  return { view, missing, replace: accept };
}
