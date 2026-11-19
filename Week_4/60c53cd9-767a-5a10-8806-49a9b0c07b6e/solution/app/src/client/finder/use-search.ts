/** The finder's search: filters in the address, newest-input-wins, paging, the rate-limit wait and the outage retry. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicUnit, SearchReply } from "../../shared/api-types.js";
import { pagedText, recoveryText, searchRateLimitMessage, FIELD_MESSAGES } from "../../shared/copy.js";
import {
  FACET_LIMIT,
  emptyFilters,
  filtersFromAddress,
  filtersToPairs,
  validateFilters,
  type FacetName,
  type FieldErrors,
  type SearchFilters,
} from "../../shared/search-rules.js";
import { api, errorOf, NetworkError } from "../api.js";
import { useNotify } from "../notices.js";
import { writeAddress } from "../router.js";

const DEBOUNCE_MS = 250;
const OUTAGE_RETRY_MS = 10_000;

export const finderAddress = (filters: SearchFilters, unit: string | null): string => {
  const params = new URLSearchParams(filtersToPairs(filters));
  if (unit) params.set("unit", unit);
  const query = params.toString();
  return query === "" ? "/finder" : `/finder?${query}`;
};

const searchPath = (filters: SearchFilters, after?: string): string => {
  const params = new URLSearchParams(filtersToPairs(filters));
  if (after) params.set("after", after);
  const query = params.toString();
  return query === "" ? "/api/search" : `/api/search?${query}`;
};

interface SearchState {
  readonly filters: SearchFilters;
  readonly errors: FieldErrors;
  readonly reply: SearchReply | null;
  readonly rows: readonly PublicUnit[];
  readonly total: number | null;
  readonly hasMore: boolean;
  readonly busy: boolean;
  readonly paging: boolean;
  readonly outage: string | null;
  readonly rateLimit: { seconds: number; message: string } | null;
  readonly pageError: string | null;
  readonly focusRow: string | null;
}

export interface SearchActions {
  readonly toggle: (name: FacetName, value: string) => void;
  readonly setText: (q: string) => void;
  readonly setPrice: (which: "priceMin" | "priceMax", value: string) => void;
  readonly clear: () => void;
  readonly loadMore: () => void;
  /** Restores filters and the open home from the address (initial load, Back, Forward). */
  readonly restore: (unit: (code: string | null) => void) => void;
  readonly clearFocusRow: () => void;
}

/** Search state for the finder. `currentUnit` is carried in every address the finder writes. */
export const useSearch = (currentUnit: () => string | null): [SearchState, SearchActions] => {
  const notify = useNotify();
  const [filters, setFilters] = useState<SearchFilters>(emptyFilters);
  const filtersRef = useRef(filters);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [reply, setReply] = useState<SearchReply | null>(null);
  const [rows, setRows] = useState<readonly PublicUnit[]>([]);
  const rowsRef = useRef<readonly PublicUnit[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [paging, setPaging] = useState(false);
  const [outage, setOutage] = useState<string | null>(null);
  const outageRef = useRef<string | null>(null);
  const [rateLimit, setRateLimit] = useState<{ seconds: number; message: string } | null>(null);
  const rateLimitRef = useRef(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const sequence = useRef(0);
  const pageSequence = useRef(0);
  const sentFilters = useRef<SearchFilters>(emptyFilters());
  const typing = useRef<number | undefined>(undefined);

  const applyRows = (next: readonly PublicUnit[]): void => {
    rowsRef.current = next;
    setRows(next);
  };

  const runSearch = useCallback(async (next: SearchFilters): Promise<void> => {
    sequence.current += 1;
    pageSequence.current += 1;
    const mine = sequence.current;
    setPaging(false);
    if (rateLimitRef.current) return;
    setBusy(true);
    sentFilters.current = next;
    let result;
    try {
      result = await api<SearchReply>("GET", searchPath(next));
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      if (mine === sequence.current) setBusy(false);
      return;
    }
    if (mine !== sequence.current) return;
    setBusy(false);
    if (result.ok) {
      const body = result.body;
      setReply(body);
      applyRows(body.hits);
      setTotal(body.total);
      setCursor(body.nextCursor);
      setPageError(null);
      if (outageRef.current !== null) {
        outageRef.current = null;
        setOutage(null);
        notify(recoveryText(body.total));
      }
      return;
    }
    const error = errorOf(result);
    if (result.status === 429) {
      const seconds = Math.max(1, Number(result.headers.get("retry-after") ?? "1"));
      rateLimitRef.current = true;
      setRateLimit({ seconds, message: error?.message ?? searchRateLimitMessage(seconds) });
    } else if (result.status === 503) {
      if (outageRef.current === null) {
        outageRef.current = error?.message ?? "";
        setOutage(outageRef.current);
      }
    } else if (result.status === 422 && error?.fields) {
      setErrors(error.fields as FieldErrors);
    }
  }, [notify]);

  // The rate-limit wait: count down once a second, send nothing, then send exactly one search from the filters as they stand.
  useEffect(() => {
    if (rateLimit === null) return undefined;
    const tick = window.setInterval(() => {
      setRateLimit((previous) => {
        if (previous === null) return null;
        const seconds = previous.seconds - 1;
        return seconds <= 0 ? null : { seconds, message: searchRateLimitMessage(seconds) };
      });
    }, 1000);
    return () => window.clearInterval(tick);
  }, [rateLimit === null]);

  const wasWaiting = useRef(false);
  useEffect(() => {
    if (rateLimit !== null) {
      wasWaiting.current = true;
      return;
    }
    if (wasWaiting.current) {
      wasWaiting.current = false;
      rateLimitRef.current = false;
      const valid = Object.keys(validateFilters(filtersRef.current)).length === 0;
      void runSearch(valid ? filtersRef.current : sentFilters.current);
    }
  }, [rateLimit, runSearch]);

  // The outage retry: the same search every ten seconds until one succeeds.
  useEffect(() => {
    if (outage === null) return undefined;
    const retry = window.setInterval(() => void runSearch(sentFilters.current), OUTAGE_RETRY_MS);
    return () => window.clearInterval(retry);
  }, [outage === null, runSearch]);

  /** Applies a settled set of filters: validates, writes the address (one history entry) and searches. */
  const settle = useCallback(
    (next: SearchFilters, push: boolean): void => {
      filtersRef.current = next;
      setFilters(next);
      const found = validateFilters(next);
      setErrors(found);
      if (Object.keys(found).length > 0) return;
      if (push) writeAddress(finderAddress(next, currentUnit()), "push");
      void runSearch(next);
    },
    [currentUnit, runSearch],
  );

  const toggle = useCallback(
    (name: FacetName, value: string): void => {
      if (outageRef.current !== null) return;
      const current = filtersRef.current;
      const has = current[name].includes(value);
      if (!has && current[name].length >= FACET_LIMIT) {
        setErrors((previous) => ({ ...previous, [name]: FIELD_MESSAGES.facetTooMany }));
        return;
      }
      const values = has ? current[name].filter((existing) => existing !== value) : [...current[name], value];
      settle({ ...current, [name]: values }, true);
    },
    [settle],
  );

  const debounced = useCallback(
    (next: SearchFilters): void => {
      filtersRef.current = next;
      setFilters(next);
      window.clearTimeout(typing.current);
      typing.current = window.setTimeout(() => settle(filtersRef.current, true), DEBOUNCE_MS);
    },
    [settle],
  );

  const setText = useCallback(
    (q: string): void => {
      if (outageRef.current === null) debounced({ ...filtersRef.current, q });
    },
    [debounced],
  );

  const setPrice = useCallback(
    (which: "priceMin" | "priceMax", value: string): void => {
      if (outageRef.current === null) debounced({ ...filtersRef.current, [which]: value });
    },
    [debounced],
  );

  const clear = useCallback((): void => {
    if (outageRef.current !== null) return;
    window.clearTimeout(typing.current);
    settle(emptyFilters(), true);
  }, [settle]);

  const loadMore = useCallback((): void => {
    if (cursor === null || paging) return;
    pageSequence.current += 1;
    const page = pageSequence.current;
    const owner = sequence.current;
    setPaging(true);
    setPageError(null);
    void api<SearchReply>("GET", searchPath(sentFilters.current, cursor))
      .then((result) => {
        if (page !== pageSequence.current || owner !== sequence.current) return;
        setPaging(false);
        if (!result.ok) {
          setPageError(errorOf(result)?.message ?? "");
          return;
        }
        const known = new Set(rowsRef.current.map((row) => row.code));
        const fresh = result.body.hits.filter((hit) => !known.has(hit.code));
        const merged = rowsRef.current
          .map((row) => result.body.hits.find((hit) => hit.code === row.code) ?? row)
          .concat(fresh);
        applyRows(merged);
        setTotal(result.body.total);
        setCursor(result.body.nextCursor);
        notify(pagedText(fresh.length, merged.length, result.body.total));
        const target = fresh[0] ?? merged[merged.length - 1];
        if (target) setFocusRow(target.code);
      })
      .catch((error: unknown) => {
        if (!(error instanceof NetworkError)) throw error;
        if (page === pageSequence.current) setPaging(false);
      });
  }, [cursor, paging, notify]);

  const restore = useCallback(
    (unit: (code: string | null) => void): void => {
      const params = new URLSearchParams(window.location.search);
      const next = filtersFromAddress(params);
      const code = params.get("unit");
      const canonical = finderAddress(next, code);
      if (canonical !== window.location.pathname + window.location.search) writeAddress(canonical, "replace");
      window.clearTimeout(typing.current);
      filtersRef.current = next;
      setFilters(next);
      setErrors({});
      unit(code);
      void runSearch(next);
    },
    [runSearch],
  );

  useEffect(() => () => window.clearTimeout(typing.current), []);

  const state: SearchState = {
    filters,
    errors,
    reply,
    rows,
    total,
    hasMore: cursor !== null,
    busy,
    paging,
    outage,
    rateLimit,
    pageError,
    focusRow,
  };
  return [state, { toggle, setText, setPrice, clear, loadMore, restore, clearFocusRow: () => setFocusRow(null) }];
};
