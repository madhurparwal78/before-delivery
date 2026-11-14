import { useCallback, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Answer, get, useInterval } from "./lib";

type Page<T> = { items: T[]; next_cursor: string | null };

export type Compare<T> = (a: T, b: T) => number;

function withQuery(base: string, limit: number, cursor: string | null) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set("cursor", cursor);
  return `${base}${base.includes("?") ? "&" : "?"}${q}`;
}

/**
 * A paged list that refreshes from its first row, through the last loaded
 * position, keeping loaded rows, focus and pending row controls.
 */
export function usePagedList<T extends { id: string }>(base: string, compare: Compare<T>, onPage?: (p: any, more: boolean) => void) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  const rowsRef = useRef<T[] | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const focusMemo = useRef<{ id: string; control: string; index: number } | null>(null);
  const container = useRef<HTMLElement | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);

  const remember = () => {
    const el = document.activeElement as HTMLElement | null;
    const row = el?.closest<HTMLElement>("[data-row]");
    if (!row || !container.current?.contains(row) || !el?.dataset.control) {
      focusMemo.current = null;
      return;
    }
    const all = Array.from(container.current.querySelectorAll<HTMLElement>("[data-row]"));
    focusMemo.current = { id: row.dataset.row!, control: el.dataset.control, index: all.indexOf(row) };
  };

  const apply = (fresh: T[], cursor: string | null) => {
    const old = new Map((rowsRef.current ?? []).map((r) => [r.id, r]));
    const merged = fresh.map((r) => (pendingRef.current[r.id] && old.has(r.id) ? old.get(r.id)! : r));
    remember();
    rowsRef.current = merged;
    setRows(merged);
    setNext(cursor);
  };

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const gen = ++generation.current;
    try {
      const loaded = rowsRef.current;
      const last = loaded && loaded.length ? loaded[loaded.length - 1] : null;
      if (!last) {
        const a = await get<Page<T>>(withQuery(base, 20, null));
        if (a.status !== 200 || gen !== generation.current) return;
        onPage?.(a.data, false);
        apply(a.data.items, a.data.next_cursor);
        return;
      }
      const all: T[] = [];
      let cursor: string | null = null;
      let meta: Page<T> | null = null;
      const done = (after: string | null) => {
        onPage?.({ ...meta, items: all }, false);
        apply(all, after);
      };
      for (;;) {
        const a: Answer<Page<T>> = await get<Page<T>>(withQuery(base, 50, cursor));
        if (a.status !== 200 || gen !== generation.current) return;
        meta = a.data;
        const items = a.data.items;
        const beyond = items.findIndex((r) => compare(r, last) > 0);
        if (beyond >= 0) {
          const kept = items.slice(0, beyond);
          all.push(...kept);
          if (!all.length) {
            const first = await get<Page<T>>(withQuery(base, 20, null));
            if (first.status !== 200 || gen !== generation.current) return;
            onPage?.(first.data, false);
            apply(first.data.items, first.data.next_cursor);
            return;
          }
          let after = cursor;
          if (kept.length) {
            const b = await get<Page<T>>(withQuery(base, kept.length, cursor));
            if (b.status !== 200 || gen !== generation.current) return;
            after = b.data.next_cursor;
          }
          done(after);
          return;
        }
        all.push(...items);
        if (!a.data.next_cursor) {
          done(null);
          return;
        }
        cursor = a.data.next_cursor;
      }
    } finally {
      busy.current = false;
    }
  }, [base]);

  const loadMore = async () => {
    if (!next) return;
    generation.current++;
    const a = await get<Page<T>>(withQuery(base, 20, next));
    if (a.status !== 200) return;
    onPage?.(a.data, true);
    const seen = new Set((rowsRef.current ?? []).map((r) => r.id));
    const merged = [...(rowsRef.current ?? []), ...a.data.items.filter((r) => !seen.has(r.id))];
    rowsRef.current = merged;
    setRows(merged);
    setNext(a.data.next_cursor);
    if (!a.data.next_cursor) {
      requestAnimationFrame(() => {
        const all = container.current?.querySelectorAll<HTMLElement>("[data-row]");
        const lastRow = all?.[all.length - 1];
        (lastRow?.querySelector<HTMLElement>("[data-control]") ?? lastRow)?.focus();
      });
    }
  };

  useInterval(refresh, 10000);

  useLayoutEffect(() => {
    const memo = focusMemo.current;
    focusMemo.current = null;
    const root = container.current;
    if (!memo || !root) return;
    const active = document.activeElement;
    if (active && active !== document.body && root.contains(active)) return;
    const same = root.querySelector<HTMLElement>(`[data-row="${CSS.escape(memo.id)}"] [data-control="${memo.control}"]`);
    if (same) return same.focus({ preventScroll: true });
    const all = Array.from(root.querySelectorAll<HTMLElement>("[data-row]"));
    for (const r of all.slice(Math.max(0, memo.index))) {
      const c = r.querySelector<HTMLElement>(`[data-control="${memo.control}"]`);
      if (c) return c.focus({ preventScroll: true });
    }
    const more = root.querySelector<HTMLElement>('[data-control="more"]');
    if (more) return more.focus({ preventScroll: true });
    root.querySelector<HTMLElement>("table")?.focus({ preventScroll: true });
  }, [rows]);

  const setRow = (id: string, patch: Partial<T>) => {
    const merged = (rowsRef.current ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r));
    rowsRef.current = merged;
    setRows(merged);
  };

  const setRowPending = (id: string, control: string | null) =>
    setPending((p) => {
      const n = { ...p };
      if (control) n[id] = control;
      else delete n[id];
      pendingRef.current = n;
      return n;
    });

  return { rows, next, pending, refresh, loadMore, container, setRow, setRowPending };
}
