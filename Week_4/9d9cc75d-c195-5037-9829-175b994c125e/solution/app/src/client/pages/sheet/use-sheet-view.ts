import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { api, ApiError, generalErrorCopy, track } from '../../api/client.ts';
import { commit } from '../../api/use-load.ts';
import type { ParameterValue, QueryResult, SheetShape } from '../../../shared/model.ts';

/** The page loader's gen-1 query: its answer, or null when it was refused and the view asks again on mount. */
export interface FirstQuery {
  result: QueryResult | null;
}

/** The last good answer and the shape it was drawn from; a refused view keeps both. */
export interface Shown {
  shape: SheetShape;
  result: QueryResult;
}

export interface SheetView {
  /** the shape on the shelves, which may be ahead of the server while a save runs */
  shape: SheetShape;
  shown: Shown | null;
  /** `status "View notice"`: the server's first notice, a refusal, or a failed save */
  notice: string;
  /** true until the newest query answer has been applied */
  busy: boolean;
  /** Puts `next` on the shelves at once, saves it and queries; `settled` gets the answer that follows. */
  edit: (next: SheetShape, settled?: (result: QueryResult) => void) => Promise<void>;
  /** Queries again with these parameter values (published views) or after a calculation, set or line changed. */
  refresh: (parameters?: Record<string, ParameterValue>, settled?: (result: QueryResult) => void) => Promise<void>;
}

interface Saved {
  version?: number;
}

/**
 * One sheet's save and query loop. Work runs strictly in order on one promise chain, so rapid edits are never lost or
 * reordered: each save sends the newest shape with `If-Match`, and only the last queued job queries. Every query
 * carries a rising `gen`; an answer for an older `gen` is dropped. With `first`, the page already holds the gen-1 answer,
 * so the view paints with its chart and nothing below it moves when the answer lands.
 */
export function useSheetView(sheetId: string, initial: SheetShape, initialVersion: number, first?: FirstQuery): SheetView {
  const answered = first?.result ?? null;
  const [shape, setShape] = useState(initial);
  const [shown, setShown] = useState<Shown | null>(answered && { shape: initial, result: answered });
  const [notice, setNotice] = useState(answered?.notices[0] ?? '');
  const [busy, setBusy] = useState(!answered);
  const latest = useRef(initial);
  const saved = useRef(initial);
  const version = useRef(initialVersion);
  const gen = useRef(first ? 1 : 0);
  const prefetched = useRef(answered !== null);
  const waiting = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const parameters = useRef<Record<string, ParameterValue>>({});
  const callbacks = useRef<((result: QueryResult) => void)[]>([]);

  const save = useCallback(async () => {
    const next = latest.current;
    if (next === saved.current) return;
    const put = () => api.put<Saved>(`/api/sheets/${sheetId}`, next, { 'If-Match': String(version.current) });
    let answer: Saved;
    try {
      answer = await put();
    } catch (caught) {
      if (!(caught instanceof ApiError) || caught.status !== 409 || typeof caught.body.version !== 'number') throw caught;
      version.current = caught.body.version;
      answer = await put();
    }
    version.current = typeof answer.version === 'number' ? answer.version : version.current + 1;
    saved.current = next;
  }, [sheetId]);

  const query = useCallback(async () => {
    const mine = ++gen.current;
    const queried = saved.current;
    const settled = callbacks.current;
    callbacks.current = [];
    try {
      const result = await api.post<QueryResult>(`/api/sheets/${sheetId}/query?gen=${mine}`, {
        filters: [],
        parameters: parameters.current,
        sets: {},
      });
      if (mine !== gen.current) return;
      commit(() => {
        setShown({ shape: queried, result });
        setNotice(result.notices[0] ?? '');
        setBusy(false);
      });
      for (const callback of settled) callback(result);
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught;
      if (mine !== gen.current) return;
      commit(() => {
        setNotice(caught.body.message ?? generalErrorCopy(caught) ?? '');
        setBusy(false);
      });
    }
  }, [sheetId]);

  const enqueue = useCallback(
    (settled?: (result: QueryResult) => void) => {
      if (settled) callbacks.current.push(settled);
      waiting.current += 1;
      const job = chain.current.then(async () => {
        waiting.current -= 1;
        try {
          await save();
        } catch (caught) {
          if (!(caught instanceof ApiError)) throw caught;
          commit(() => {
            setNotice(generalErrorCopy(caught) ?? 'Something went wrong. Try again.');
            setBusy(waiting.current > 0);
          });
          return;
        }
        if (waiting.current === 0) await query();
      });
      chain.current = job.catch(() => undefined);
      return track(() => job);
    },
    [save, query],
  );

  const edit = useCallback(
    (next: SheetShape, settled?: (result: QueryResult) => void) => {
      latest.current = next;
      commit(() => {
        setShape(next);
        setBusy(true);
      });
      return enqueue(settled);
    },
    [enqueue],
  );

  const refresh = useCallback(
    (values?: Record<string, ParameterValue>, settled?: (result: QueryResult) => void) => {
      if (values) parameters.current = values;
      commit(() => setBusy(true));
      return enqueue(settled);
    },
    [enqueue],
  );

  useLayoutEffect(() => {
    if (!prefetched.current) void enqueue();
  }, [enqueue]);

  return { shape, shown, notice, busy, edit, refresh };
}
