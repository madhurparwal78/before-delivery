// Explore: the search state, its address, the search run, and the regions it arranges for each layout band.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { formatIso } from "../../../shared/time";
import { api, ApiFailure, query } from "../../lib/api";
import { Modal } from "../../lib/dialog";
import { useShown } from "../../lib/format";
import { useLive } from "../../lib/live";
import { navigate } from "../../lib/router";
import { announce, update, useAppState, type AppState } from "../../lib/store";
import { Button, EmptyBand, ErrorSummary, Field, useBusy } from "../../lib/ui";
import { useBand } from "../../lib/viewport";
import { Cards } from "./Cards";
import { Document } from "./Document";
import { Fields, Pills, type FieldsHandle } from "./Fields";
import { Grid, type GridHandle } from "./Grid";
import { Histogram, HistogramPlaceholder, type HistogramHandle } from "./Histogram";
import { LiveTail } from "./LiveTail";
import {
  countSentence, decodePills, DEFAULT_COLUMNS, encodeState, pillFilters, type ApiEvent, type Bucket, type FieldInfo,
  type Pill, type PillValue, type SearchState, type Stats,
} from "./model";
import { QueryBar, type QueryBarHandle } from "./QueryBar";
import { TimeRangeDialog } from "./TimeRange";

const QUERY_PROBLEMS = new Set(["query_syntax", "query_too_long", "query_too_deep", "query_work_limit", "query_time_budget"]);
const WEEK_MS = 604_800_000;
const DEFAULT_RANGE_MS = 900_000;

interface Snapshot { id: string; total: number; partial: boolean; skipped_generations: number }
interface Page { events: ApiEvent[]; next: string | null; total: number; new_events: number }
type SearchStatus = "loading" | "done" | "error";

function SaveSearchDialog({ state, onClose }: { state: SearchState; onClose: () => void }) {
  const [name, setName] = useState("");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        await api.post("/api/saved-searches", { name, stream: state.stream, q: state.q, filters: pillFilters(state.pills), from: state.from, to: state.to });
        announce(`Search ${name} saved.`);
        onClose();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <Modal label="Save search" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorSummary failure={failure} labels={{ name: "Search name" }} />
        <Field label="Search name" error={failure?.fields.name}>
          {(props) => <input {...props} type="text" data-field="name" value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Save</button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

function ColumnsDialog({ fields, columns, onChange, onClose }: { fields: string[]; columns: string[]; onChange: (columns: string[]) => void; onClose: () => void }) {
  const names = [...new Set([...fields, ...columns])];
  return (
    <Modal label="Columns" onClose={onClose}>
      <div className="stack-tight">
        {names.map((field) => (
          <label key={field} className="check">
            <input type="checkbox" checked={columns.includes(field)} onChange={(event) => onChange(event.target.checked ? [...columns, field] : columns.filter((c) => c !== field))} />
            <span className="mono">{field}</span>
          </label>
        ))}
      </div>
      <div className="dialog-actions"><Button primary onClick={onClose}>Done</Button></div>
    </Modal>
  );
}

const filtersToPills = (filters: unknown): Pill[] =>
  Array.isArray(filters)
    ? filters.filter((f) => f.op === "eq" || f.op === "ne").map((f) => ({ field: String(f.field), value: f.value as PillValue, mode: f.op === "eq" ? "include" : "exclude", enabled: true }))
    : [];

export function ExplorePage() {
  const zone = useAppState((s) => s.me?.time_zone ?? "UTC");
  const role = useAppState((s) => s.me?.space.role);
  const shown = useShown();
  const band = useBand();
  const [streams, setStreams] = useState<string[] | null>(null);
  const [state, setState] = useState<SearchState | null>(null);
  const [status, setStatus] = useState<SearchStatus>("loading");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [buckets, setBuckets] = useState<{ interval: string; buckets: Bucket[] } | null>(null);
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [newEvents, setNewEvents] = useState(0);
  const [queryError, setQueryError] = useState<{ message: string; position: number | null } | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [expired, setExpired] = useState<string | null>(null);
  const [savedProblem, setSavedProblem] = useState<string | null>(null);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [docIndex, setDocIndex] = useState<number | null>(null);
  const [tailing, setTailing] = useState(false);
  const [dialog, setDialog] = useState<"range" | "save" | "columns" | "filters" | null>(null);

  const token = useRef(0);
  const pager = useRef<{ id: string; next: string | null; events: ApiEvent[]; loading: Promise<void> | null }>({ id: "", next: null, events: [], loading: null });
  const selectedRef = useRef<string | null>(null);
  const lastDoc = useRef<number | null>(null);
  const queryBar = useRef<QueryBarHandle>(null);
  const histogram = useRef<HistogramHandle>(null);
  const fieldsRef = useRef<FieldsHandle>(null);
  const grid = useRef<GridHandle>(null);
  const panel = useRef<HTMLDivElement>(null);
  selectedRef.current = selectedField;

  const loadStats = useCallback(async (field: string, next: SearchState): Promise<void> => {
    try {
      setStatsError(null);
      setStats(await api.get<Stats>(`/api/fields/stats${query({ field, stream: next.stream, q: next.q, from: next.from, to: next.to, filters: JSON.stringify(pillFilters(next.pills)) })}`));
    } catch (error) {
      setStats(null);
      setStatsError((error as ApiFailure).message);
    }
  }, []);

  const runSearch = useCallback(async (next: SearchState, kind: "found" | "brush"): Promise<void> => {
    const mine = ++token.current;
    setStatus("loading");
    setQueryError(null);
    setFailure(null);
    setExpired(null);
    setDocIndex(null);
    try {
      update({ serverNowMs: (await api.get<{ now_ms: number }>("/api/time")).now_ms });
      const filters = pillFilters(next.pills);
      const base = { stream: next.stream, from: next.from, to: next.to };
      const [fieldList, made] = await Promise.all([
        api.get<{ fields: FieldInfo[] }>(`/api/fields${query(base)}`),
        api.post<Snapshot>("/api/snapshots", { ...base, q: next.q, filters, sort: next.sort }).catch((error: unknown) => error as ApiFailure),
      ]);
      if (mine !== token.current) return;
      setFields(fieldList.fields);
      if (made instanceof ApiFailure) {
        if (QUERY_PROBLEMS.has(made.code)) {
          setQueryError({ message: made.message, position: made.position });
          if (made.position !== null) queryBar.current?.caretTo(made.position - 1);
          setSnapshot(null);
          pager.current = { id: "", next: null, events: [], loading: null };
          setEvents([]);
          setStatus("error");
          return;
        }
        throw made;
      }
      const params = query({ ...base, q: next.q, filters: JSON.stringify(filters), tz: zone });
      const [first, hist] = await Promise.all([
        api.get<Page>(`/api/snapshots/${made.id}`),
        api.get<{ interval: string; buckets: Bucket[] }>(`/api/histogram${params}`),
      ]);
      if (mine !== token.current) return;
      pager.current = { id: made.id, next: first.next, events: first.events, loading: null };
      setSnapshot(made);
      setEvents(first.events);
      setNewEvents(first.new_events);
      setBuckets(hist);
      if (selectedRef.current) await loadStats(selectedRef.current, next);
      if (mine !== token.current) return;
      setStatus("done");
      announce(kind === "brush" ? `Time range set: ${countSentence(made.total)}` : countSentence(made.total));
    } catch (error) {
      if (mine !== token.current) return;
      setFailure(error instanceof ApiFailure ? error : new ApiFailure(0, "error", String(error)));
      setStatus("error");
    }
  }, [loadStats, zone]);

  const commit = useCallback((next: SearchState, kind: "found" | "brush" = "found"): void => {
    setState(next);
    navigate(encodeState(next), true);
    void runSearch(next, kind);
  }, [runSearch]);

  useEffect(() => {
    void (async () => {
      const list = await api.get<{ streams: Array<{ name: string }> }>("/api/streams").catch(() => null);
      const names = (list?.streams.map((s) => s.name) ?? []).sort();
      setStreams(names);
      const params = new URLSearchParams(window.location.search);
      const savedId = params.get("saved");
      let initial: Partial<SearchState> = { stream: params.get("stream") ?? names[0] ?? "", q: params.get("q") ?? "", pills: decodePills(params.get("filters")), sort: params.get("sort"), from: params.get("from") ?? "", to: params.get("to") ?? "" };
      if (savedId) {
        try {
          const saved = await api.get<{ stream: string; q: string; filters: unknown; from: string; to: string; problem?: string }>(`/api/saved-searches/${savedId}`);
          if (saved.problem) {
            setSavedProblem(saved.problem);
            setStatus("done");
            return;
          }
          initial = { stream: saved.stream, q: saved.q, pills: filtersToPills(saved.filters), sort: null, from: saved.from, to: saved.to };
        } catch (error) {
          setFailure(error as ApiFailure);
          setStatus("error");
          return;
        }
      }
      if (!initial.stream) {
        setStatus("done");
        return;
      }
      if (!initial.from || !initial.to) {
        const { now_ms: now } = await api.get<{ now_ms: number }>("/api/time");
        update({ serverNowMs: now });
        initial = { ...initial, to: initial.to || formatIso(now), from: initial.from || formatIso((initial.to ? Date.parse(initial.to) : now) - DEFAULT_RANGE_MS) };
      }
      commit(initial as SearchState);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void api.get<{ settings: NonNullable<AppState["settings"]> }>("/api/config").then((config) => update({ settings: config.settings }), () => undefined);
  }, []);

  const loadNext = useCallback((): Promise<void> => {
    const current = pager.current;
    if (current.loading) return current.loading;
    if (current.next === null) return Promise.resolve();
    const work = api.get<Page>(`/api/snapshots/${current.id}?after=${current.next}`).then(
      (page) => {
        if (pager.current.id !== current.id) return;
        pager.current = { ...pager.current, next: page.next, events: [...pager.current.events, ...page.events], loading: null };
        setEvents(pager.current.events);
        setNewEvents(page.new_events);
      },
      (error: unknown) => {
        pager.current = { ...pager.current, loading: null, next: null };
        if (error instanceof ApiFailure && error.status === 410) setExpired(error.message);
        else setFailure(error as ApiFailure);
      },
    );
    pager.current.loading = work;
    return work;
  }, []);

  const loadThrough = useCallback(async (index: number): Promise<void> => {
    while (pager.current.events.length <= index && pager.current.next !== null) await loadNext();
  }, [loadNext]);

  useLive(["upload"], () => {
    const id = pager.current.id;
    if (!id) return;
    api.get<Page>(`/api/snapshots/${id}`).then((page) => setNewEvents(page.new_events), (error: unknown) => {
      if (error instanceof ApiFailure && error.status === 410) setExpired(error.message);
    });
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "F6") return;
      event.preventDefault();
      const regions: Array<{ element: Element | null | undefined; focus: () => void }> = [
        { element: document.querySelector('[aria-label="Query"]'), focus: () => queryBar.current?.focus() },
        { element: document.querySelector('[role="group"][aria-label="Histogram"]'), focus: () => histogram.current?.focus() },
        { element: document.querySelector('[role="list"][aria-label="Fields"], ul[aria-label="Fields"]'), focus: () => fieldsRef.current?.focus() },
        { element: document.querySelector('[role="grid"][aria-label="Events"], [role="list"][aria-label="Events"]'), focus: () => grid.current?.focusCurrent() },
        { element: document.querySelector('[role="region"][aria-label="Document"]'), focus: () => panel.current?.querySelector<HTMLElement>('[aria-label="Close document"]')?.focus() },
      ].filter((region) => region.element);
      const at = regions.findIndex((region) => region.element?.contains(document.activeElement));
      const step = event.shiftKey ? -1 : 1;
      const next = at === -1 ? (step === 1 ? 0 : regions.length - 1) : (at + step + regions.length) % regions.length;
      regions[next]?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useLayoutEffect(() => {
    if (docIndex === null && lastDoc.current !== null) {
      const row = lastDoc.current;
      lastDoc.current = null;
      if (band === "phone") document.querySelector<HTMLElement>(`article[aria-label^="Event ${row + 1} of"]`)?.focus();
      else grid.current?.focusRow(row);
    }
  }, [docIndex, band]);

  const open = (index: number): void => {
    lastDoc.current = index;
    setDocIndex(index);
  };

  if (!streams) return <div className="stack"><h1>Explore</h1></div>;

  const widen = async (): Promise<void> => {
    const { now_ms: now } = await api.get<{ now_ms: number }>("/api/time");
    if (state) commit({ ...state, from: formatIso(now - WEEK_MS), to: formatIso(now) });
  };

  const addPill = (field: string, value: PillValue, mode: "include" | "exclude"): void => {
    if (!state || state.pills.some((p) => p.field === field && p.value === value && p.mode === mode)) return;
    commit({ ...state, pills: [...state.pills, { field, value, mode, enabled: true }] });
  };

  const selectField = (field: string): void => {
    setSelectedField(field);
    if (state) void loadStats(field, state);
  };

  const changeStream = (name: string): void => {
    if (!state) return;
    setSelectedField(null);
    setStats(null);
    commit({ ...state, stream: name, pills: [], sort: null });
  };

  const sortBy = (column: string): void => {
    if (state) commit({ ...state, sort: state.sort === `${column}:desc` ? `${column}:asc` : `${column}:desc` });
  };

  const rangeText = state ? `Showing ${shown(state.from)} to ${shown(state.to)}` : "";
  const total = snapshot?.total ?? 0;
  const doc = docIndex === null ? undefined : events[docIndex];
  const panels = (
    <>
      <Fields ref={fieldsRef} fields={fields} selected={selectedField} stats={stats} statsError={statsError} onSelect={selectField} onFilter={addPill} />
    </>
  );
  const pills = state ? <Pills pills={state.pills} onChange={(next) => commit({ ...state, pills: next })} /> : null;
  const empty = status === "done" && total === 0;
  const message = failure ? (
    <div role="alert" aria-label="Search failed" className="error-box outage">
      <p>{failure.message}</p>
      <Button onClick={() => state && commit(state)}>Retry</Button>
    </div>
  ) : expired ? (
    <div role="alert" aria-label="Snapshot expired" className="error-box outage">
      <p>{expired}</p>
      <Button onClick={() => state && commit(state)}>Start a new search</Button>
    </div>
  ) : queryError ? (
    <div role="alert" aria-label="Query error" className="error-box"><p>{queryError.message}</p></div>
  ) : savedProblem ? (
    <div role="alert" aria-label="Saved search error" className="error-box"><p>{savedProblem}</p></div>
  ) : snapshot?.partial ? (
    <p role="status" aria-label="Partial results" className="notice">
      Partial results: {snapshot.skipped_generations} archived {snapshot.skipped_generations === 1 ? "generation" : "generations"} skipped because storage is unavailable.
    </p>
  ) : null;

  return (
    <div className={`explore band-${band}`}>
      <QueryBar
        ref={queryBar} streams={streams} stream={state?.stream ?? ""} q={state?.q ?? ""} from={state?.from ?? ""} to={state?.to ?? ""} rangeText={rangeText} compact={band === "phone"}
        error={queryError?.message ?? null}
        onStream={changeStream}
        onRun={(q) => state && commit({ ...state, q })}
        onRange={() => setDialog("range")}
      />
      {band === "phone" ? (
        <div className="phone-actions">
          <Button onClick={() => setDialog("range")}>Time range</Button>
          <Button onClick={() => setDialog("filters")}>Filters</Button>
          <span className="range-text mono small">{rangeText}</span>
        </div>
      ) : null}
      {band !== "phone" && state?.pills.length ? <div className="pills-row">{pills}</div> : null}
      {buckets ? <Histogram ref={histogram} interval={buckets.interval} buckets={buckets.buckets} onBrush={(from, to) => state && commit({ ...state, from, to }, "brush")} /> : <HistogramPlaceholder />}
      <div className="explore-body">
        {band !== "phone" ? <aside className="fields-col">{panels}</aside> : null}
        <section className="results-col">
          <div className="toolbar">
            <Button onClick={() => setTailing(!tailing)} aria-pressed={tailing} disabled={!state}>Live tail</Button>
            <Button onClick={() => setDialog("save")} disabled={!state || role === "viewer"}>Save search</Button>
            {band !== "phone" ? <Button onClick={() => setDialog("columns")}>Columns</Button> : null}
            {newEvents > 0 ? <Button primary aria-label="Show new events" onClick={() => state && commit(state)}>{`${newEvents} new ${newEvents === 1 ? "event" : "events"} since this search`}</Button> : null}
            <div className="toolbar-message">{message}</div>
          </div>
          {tailing && state ? (
            <LiveTail stream={state.stream} />
          ) : empty || !state ? (
            <EmptyBand line="No events in this range."><Button primary onClick={() => void widen()}>Widen to last 7 days</Button></EmptyBand>
          ) : (
            <div className="results-frame">
              {band === "phone" ? (
                <Cards events={events} total={total} state={status} selected={docIndex} loadThrough={loadThrough} onOpen={open} />
              ) : (
                <Grid
                  ref={grid} events={events} total={total} columns={columns} widths={widths} sort={state.sort} state={status} selected={docIndex}
                  loadThrough={loadThrough} onWidth={(column, width) => setWidths((current) => ({ ...current, [column]: width }))} onSort={sortBy} onOpen={open}
                />
              )}
              {doc ? (
                <div ref={panel} className="document-slot">
                  <Document
                    event={doc} state={state} canEdit={role !== "viewer"}
                    onClose={() => setDocIndex(null)}
                    onSaved={(saved) => setEvents((current) => current.map((e, k) => (k === docIndex ? { ...e, ...saved } : e)))}
                  />
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
      {dialog === "range" && state ? (
        <TimeRangeDialog
          zone={zone} from={Date.parse(state.from)} to={Date.parse(state.to)} onClose={() => setDialog(null)}
          onApply={(from, to) => commit({ ...state, from: formatIso(from), to: formatIso(to) })}
        />
      ) : null}
      {dialog === "save" && state ? <SaveSearchDialog state={state} onClose={() => setDialog(null)} /> : null}
      {dialog === "columns" ? <ColumnsDialog fields={fields.map((f) => f.field)} columns={columns} onChange={setColumns} onClose={() => setDialog(null)} /> : null}
      {dialog === "filters" && state ? (
        <Modal label="Filters" onClose={() => setDialog(null)} sheet>
          {pills}
          {panels}
          <div className="dialog-actions"><Button primary onClick={() => setDialog(null)}>Done</Button></div>
        </Modal>
      ) : null}
    </div>
  );
}

