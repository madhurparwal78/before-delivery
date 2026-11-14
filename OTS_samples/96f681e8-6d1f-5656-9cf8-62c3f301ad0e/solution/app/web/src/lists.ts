import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Paged, call, messageOf } from "./api";

const refreshMs = 10_000;
const refreshPage = 50;

interface Options<T> {
  path: string;
  rowId: (row: T) => string;
  /** Negative when `a` sorts before `b` in the list's order. */
  compare: (a: T, b: T) => number;
}

/**
 * A paged list that keeps its place: every refresh re-reads from the first row, 50 at a time, until it has read past
 * the last row the person has loaded, so loaded rows stay, new rows arrive in sort order and gone rows leave.
 */
export function usePagedList<T, P extends Paged<T> = Paged<T>>({ path, rowId, compare }: Options<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [latestPage, setLatestPage] = useState<P | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rowsRef = useRef<T[]>([]);
  const nextRef = useRef<string | null>(null);
  const busy = useRef(false);
  const ticket = useRef(0);

  const fetchPage = useCallback((cursor: string | null, limit?: number) => {
    const query = new URLSearchParams();
    if (limit) query.set("limit", String(limit));
    if (cursor) query.set("cursor", cursor);
    return call<P>(`${path}${query.size ? `?${query}` : ""}`).then((page) => {
      setLatestPage(page);
      return page;
    });
  }, [path]);

  const commit = useCallback((items: T[], cursor: string | null) => {
    rowsRef.current = items;
    nextRef.current = cursor;
    setRows(items);
    setNext(cursor);
    setLoaded(true);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    const mine = ++ticket.current;
    const known = rowsRef.current;
    try {
      if (known.length === 0) {
        const first = await fetchPage(null);
        if (mine === ticket.current) commit(first.items, first.next_cursor);
        return;
      }
      const last = known[known.length - 1];
      const collected: T[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page = await fetchPage(cursor, refreshPage);
        collected.push(...page.items);
        cursor = page.next_cursor;
        if (!cursor || page.items.some((row) => compare(row, last) >= 0)) break;
      }
      // Rows past the last loaded one stay behind `Load more bookings`, so the person keeps their place.
      const kept = collected.filter((row) => compare(row, last) <= 0);
      if (mine !== ticket.current) return;
      if (kept.length < collected.length && nextRef.current !== null) commit(kept, nextRef.current);
      else commit(collected, cursor);
    } catch (e) {
      if (mine === ticket.current) setError(messageOf(e));
    }
  }, [commit, compare, fetchPage]);

  const loadMore = useCallback(async () => {
    if (!next || busy.current) return;
    busy.current = true;
    ticket.current++;
    try {
      const page = await fetchPage(next);
      const seen = new Set(rowsRef.current.map(rowId));
      commit([...rowsRef.current, ...page.items.filter((row) => !seen.has(rowId(row)))], page.next_cursor);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      busy.current = false;
    }
  }, [commit, fetchPage, next, rowId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), refreshMs);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { rows, hasMore: next !== null, loaded, error, loadMore, refresh, latestPage };
}

const moreRow = "\u0000more";

/** Which control of which row holds focus. */
interface Held {
  row: string;
  control: string;
}

/**
 * Keeps focus on the same control of the same row across refreshes. If the row left the list, focus moves to the same
 * control of the next row, then to `Load more bookings`, then to the table.
 */
export function useFocusKeeper(table: React.RefObject<HTMLElement | null>, ids: string[], loadMore: React.RefObject<HTMLElement | null>) {
  const held = useRef<Held | null>(null);
  const order = useRef<string[]>([]);

  useEffect(() => {
    const root = table.current?.closest("[data-focus-scope]") ?? document;
    const track = (event: Event) => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-row-id]");
      const control = target.getAttribute("data-control");
      if (target.hasAttribute("data-more")) held.current = { row: moreRow, control: "more" };
      else held.current = row && control ? { row: row.dataset.rowId as string, control } : null;
    };
    root.addEventListener("focusin", track);
    return () => root.removeEventListener("focusin", track);
  }, [table]);

  useLayoutEffect(() => {
    const previous = order.current;
    order.current = ids;
    const focus = held.current;
    if (!focus) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    if (focus.row === moreRow) {
      const rows = table.current?.querySelectorAll<HTMLElement>("[data-row-id]");
      const lastControl = rows && rows.length > 0 ? rows[rows.length - 1].querySelector<HTMLElement>("[data-control]:not(:disabled)") : null;
      (lastControl ?? table.current)?.focus();
      return;
    }
    const find = (row: string) =>
      document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(row)}"] [data-control="${CSS.escape(focus.control)}"]:not(:disabled)`);
    const same = find(focus.row);
    if (same) {
      same.focus();
      return;
    }
    const from = previous.indexOf(focus.row);
    for (const candidate of previous.slice(from + 1)) {
      const target = ids.includes(candidate) ? find(candidate) : null;
      if (target) {
        target.focus();
        return;
      }
    }
    const fallback = loadMore.current ?? table.current;
    if (fallback) {
      if (!fallback.hasAttribute("tabindex") && fallback === table.current) fallback.setAttribute("tabindex", "-1");
      fallback.focus();
    }
  });
}
