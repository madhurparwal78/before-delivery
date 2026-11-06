// Newest-first lists read 50 rows at a time with opaque cursors (usage rows, webhook deliveries).
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Icon } from "./icons";

interface CursorPage<T> {
  rows: T[];
  next: string | null;
}

interface CursorPages<T> {
  rows: T[];
  replace: (update: (rows: T[]) => T[]) => void;
  controls: JSX.Element;
}

export function useCursorPages<T>(load: (cursor: string | null) => Promise<CursorPage<T>>, onError: (error: unknown) => void): CursorPages<T> {
  const [trail, setTrail] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState<CursorPage<T>>({ rows: [], next: null });
  const cursor = trail[trail.length - 1] ?? null;

  useEffect(() => {
    let live = true;
    load(cursor).then((result) => live && setPage(result), (error: unknown) => live && onError(error));
    return () => {
      live = false;
    };
  }, [cursor]);

  const controls = (
    <div class="paging">
      <button type="button" class="button" disabled={trail.length < 2} onClick={() => setTrail(trail.slice(0, -1))}>
        <Icon name="chevron-left" />
        Previous page
      </button>
      <button type="button" class="button" disabled={page.next === null} onClick={() => page.next && setTrail([...trail, page.next])}>
        Next page
        <Icon name="chevron-right" />
      </button>
    </div>
  );
  return {
    rows: page.rows,
    replace: (update) => setPage((p) => ({ ...p, rows: update(p.rows) })),
    controls,
  };
}
