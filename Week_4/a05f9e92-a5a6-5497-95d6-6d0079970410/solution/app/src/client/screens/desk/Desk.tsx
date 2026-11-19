import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { RecordJson } from "../../../server/records.js";
import type { Value } from "../../../shared/expression.js";
import { CREATABLE_TABLES } from "../../../shared/record-rules.js";
import { TABLE_LABELS, type Table } from "../../../shared/types.js";
import { ApiFailure, get, post } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { useTopics } from "../../lib/live.js";
import { Link, navigate, useLocation } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { received, shownOf, type SlaView } from "../../lib/sla.js";
import { Button, loadingScreen, Page, StateScreen, useViewport, type Loaded } from "../../lib/ui.js";
import { NewRecordForm } from "../record/NewRecordForm.js";
import { RecordForm } from "../record/RecordForm.js";
import { BulkDialog, ColumnsDialog } from "./Dialogs.js";
import { ExportProgress, useExport } from "./Exporter.js";
import { FilterDialog } from "./FilterDialog.js";
import { Cards, Grid } from "./Grid.js";
import {
  bulkFields,
  columnsFor,
  DEFAULT_COLUMNS,
  DEFAULT_QUEUE,
  groupableFields,
  listContextOf,
  readView,
  rowOf,
  TABLE_PLURALS,
  urlFor,
  type ListContext,
  type ListJson,
  type Row,
  type SavedFilter,
  type View,
} from "./model.js";

interface ListData extends Omit<ListJson, "records"> {
  rows: Row[];
}

interface Report {
  ok: number;
  failed: number;
  lines: string[];
}

type DialogName = "filter" | "bulk" | "columns" | null;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const typesText = (target: EventTarget | null): boolean => target instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

function newRecordsText(count: number): string {
  return count === 1 ? "1 new record" : `${count} new records`;
}

function PaneState({ line, button, onClick }: { line: string; button: string; onClick: () => void }): JSX.Element {
  return (
    <div className="pane-state">
      <p className="state-line">{line}</p>
      <div className="state-action">
        <Button onClick={onClick}>{button}</Button>
      </div>
    </div>
  );
}

function useQueues(accessVersion: number): { queues: SavedFilter[] | null; reload: () => void } {
  const [queues, setQueues] = useState<SavedFilter[] | null>(null);
  const reload = useCallback(() => {
    get<{ filters: SavedFilter[] }>("/api/filters?table=incident").then(
      (loaded) => setQueues(loaded.filters.filter((f) => f.shared)),
      () => setQueues([]),
    );
  }, []);
  useEffect(reload, [reload, accessVersion]);
  return { queues, reload };
}

/** The record a save has just created: its form takes focus on its heading once, on every viewport. */
let createdRecord: string | null = null;

/** Numbers this browser's person created: the new-records notice is for records someone else creates. */
const ownRecords = new Set<string>();

/** The ticket workspace: queues, list and record form. The address holds the queue, filter, group and page. */
export function Desk(): JSX.Element {
  const { path, search } = useLocation();
  // The list behind an open new-record form or just-saved record; it keeps the queue or filter out of the address.
  const [behind, setBehind] = useState<ListContext | null>(null);
  const view = readView(path, search, behind);
  if (view.table === null) return <StateScreen line="That page isn't on the switchyard." button="Back to your desk" onClick={() => navigate("/desk")} />;
  return <Workspace key={view.table} view={view} table={view.table} onBehind={setBehind} />;
}

function Workspace({ view, table, onBehind }: { view: View; table: Table; onBehind: (behind: ListContext | null) => void }): JSX.Element {
  const session = useSession();
  const announce = useAnnounce();
  const viewport = useViewport();
  const phone = viewport === "phone";
  const desktop = viewport === "desktop";
  const { queues, reload: reloadQueues } = useQueues(session.accessVersion);

  const queue = view.mode === "queue" && queues ? (queues.find((q) => q.id === view.queueId) ?? queues.find((q) => q.name === DEFAULT_QUEUE) ?? null) : null;
  const listName = view.mode === "queue" ? (queue?.name ?? (queues === null ? DEFAULT_QUEUE : TABLE_PLURALS[table])) : TABLE_PLURALS[table];
  const filterText = view.mode === "queue" ? (queue?.filter ?? "") : view.filter;
  const ready = view.mode === "raw" || queues !== null;
  const group = groupableFields(table).some((f) => f.name === view.group) ? view.group : "";

  const allColumns = useMemo(() => columnsFor(table), [table]);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(DEFAULT_COLUMNS));
  const columns = useMemo(() => allColumns.filter((c) => chosen.has(c.key)), [allColumns, chosen]);
  const exportColumns = useMemo(() => columns.flatMap((c) => (c.field ? [c.field] : [])), [columns]);
  const valueFields = [...new Set([...columns.filter((c) => c.extra).flatMap((c) => (c.field ? [c.field] : [])), ...(group ? [group] : [])])];

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filterText) params.set("filter", filterText);
    if (view.page > 1) params.set("page", String(view.page));
    if (group) {
      params.set("group_by", group);
      params.set("sort", group);
      params.set("dir", "asc");
    }
    if (valueFields.length > 0) params.set("columns", valueFields.join(","));
    return params.toString();
  }, [filterText, view.page, group, valueFields.join(",")]);

  const load = useCallback(async (): Promise<ListData> => {
    const { records, ...rest } = await get<ListJson>(`/api/tables/${table}/records?${query}`);
    const at = performance.now();
    return { ...rest, rows: records.map((summary) => rowOf(summary, at)) };
  }, [table, query]);

  const [list, setList] = useState<Loaded<ListData>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<DialogName>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [backFocus, setBackFocus] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [changeTitle, setChangeTitle] = useState<string | null>(null);
  // The record whose subject (change title or number) is known; on the phone the record waits for it so the subject never grows over it.
  const [subjectFor, setSubjectFor] = useState<string | null>(null);
  const latest = useRef(list);
  latest.current = list;
  const generation = useRef(0);
  const wantFocus = useRef(false);
  const listPane = useRef<HTMLDivElement>(null);
  const reportHeading = useRef<HTMLHeadingElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const exporter = useExport(table, filterText, exportColumns);

  useEffect(() => {
    if (!ready) return undefined;
    const mine = ++generation.current;
    setSelected(new Set());
    setPending(new Set());
    load().then(
      (data) => {
        if (mine !== generation.current) return;
        setList({ status: "ready", data });
        if (wantFocus.current) {
          wantFocus.current = false;
          setFocusSignal((n) => n + 1);
        }
      },
      (error: unknown) => mine === generation.current && setList({ status: "error", error }),
    );
    return () => {
      generation.current++;
    };
  }, [ready, load, attempt, session.accessVersion]);

  /** Refetches the page and folds it in: rows update in place, new matches wait behind the notice. */
  const merge = useCallback(
    async (changed: ReadonlySet<string>): Promise<void> => {
      const mine = generation.current;
      let fresh: ListData;
      try {
        fresh = await load();
      } catch {
        return;
      }
      const before = latest.current;
      if (mine !== generation.current || before.status !== "ready") return;
      const shown = new Set(before.data.rows.map((r) => r.summary.number));
      const byNumber = new Map(fresh.rows.map((r) => [r.summary.number, r]));
      const rows = before.data.rows.flatMap((r) => byNumber.get(r.summary.number) ?? []);
      const added = fresh.rows.filter((r) => !shown.has(r.summary.number) && changed.has(r.summary.number) && !ownRecords.has(r.summary.number)).map((r) => r.summary.number);
      setList({ status: "ready", data: { ...fresh, rows } });
      if (added.length > 0) setPending((current) => new Set([...current, ...added]));
    },
    [load],
  );

  const refreshSoon = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void merge(new Set()), 300);
  }, [merge]);

  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  useTopics([`list:${table}`], (message) => void merge(new Set((message.data.numbers as string[] | undefined) ?? [])));

  const shownNumbers = list.status === "ready" ? list.data.rows.map((r) => r.summary.number) : [];
  useTopics(
    shownNumbers.map((n) => `sla:${n}`),
    (message) => {
      const number = message.topic.slice("sla:".length);
      const sla = shownOf(received((message.data.slas as SlaView[] | undefined) ?? []));
      setList((current) => (current.status === "ready" ? { status: "ready", data: { ...current.data, rows: current.data.rows.map((r) => (r.summary.number === number ? { ...r, sla } : r)) } } : current));
      refreshSoon();
    },
  );

  useEffect(() => {
    if (pending.size > 0) announce(newRecordsText(pending.size));
  }, [pending.size, announce]);

  useEffect(() => {
    if (list.status === "ready" && list.data.rows.length === 0 && list.data.total > 0 && view.page > 1) go({ page: 1 }, true);
  }, [list, view]);

  useEffect(() => {
    setMissing(false);
    setChangeTitle(null);
    if (!view.record) return undefined;
    let current = true;
    get<{ record: RecordJson }>(`/api/records/${view.record}`).then(
      (result) => {
        if (!current) return;
        setChangeTitle(result.record.table === "change" ? String(result.record.fields.title?.value ?? "") : null);
        setSubjectFor(view.record);
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof ApiFailure && error.status === 404) setMissing(true);
        setSubjectFor(view.record);
      },
    );
    return () => {
      current = false;
    };
  }, [view.record, session.accessVersion]);

  useEffect(() => {
    if (report) reportHeading.current?.focus();
  }, [report]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "F6" || document.querySelector('[role="dialog"]')) return;
      const nav = desktop ? document.querySelector<HTMLElement>('nav[aria-label="Queues"]') : null;
      const regions = [nav, listPane.current, document.querySelector<HTMLElement>('main form, main [role="form"]'), document.querySelector<HTMLElement>('main [aria-label="Activity"]')].filter((r): r is HTMLElement => r !== null);
      if (regions.length === 0) return;
      event.preventDefault();
      const at = regions.reduce((found, r, i) => (r.contains(document.activeElement) ? i : found), -1);
      const step = event.shiftKey ? -1 : 1;
      const target = regions[at < 0 ? (step === 1 ? 0 : regions.length - 1) : (at + step + regions.length) % regions.length]!;
      const inside = target.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"], li[tabindex="0"], a[aria-current="page"]') ?? target.querySelector<HTMLElement>(FOCUSABLE);
      if (inside) inside.focus();
      else {
        target.tabIndex = -1;
        target.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [desktop]);

  /** Moves to another workspace state; a change to the list alone, made while a record or form is open, changes the remembered list too. */
  const go = (next: Partial<View>, replace = false): void => {
    const target = { ...view, ...next };
    if ((view.record !== null || view.newTable !== null) && next.record === undefined && next.newTable === undefined) onBehind(listContextOf(target));
    navigate(urlFor(target), replace);
  };

  const open = (number: string): void => {
    setBackFocus(null);
    go({ record: number, newTable: null });
  };

  const back = (): void => {
    setBackFocus(view.record);
    go({ record: null, newTable: null });
  };

  const created = (number: string): void => {
    createdRecord = number;
    ownRecords.add(number);
    navigate(`/desk/records/${number}`, true);
  };

  const startNew = (newTable: Table): void => {
    if (!view.newTable) onBehind(listContextOf(view));
    go({ newTable, record: null });
  };

  useEffect(() => {
    if (view.record === null && view.newTable === null) onBehind(null);
  }, [view.record, view.newTable, onBehind]);

  const apply = (filter: string): void => {
    setDialog(null);
    const next: Partial<View> = { mode: "raw", queueId: null, filter, page: 1 };
    const listOf = (v: View): string => urlFor({ ...v, record: null, newTable: null });
    if (view.remembered ? listOf({ ...view, ...next }) === listOf(view) : urlFor({ ...view, ...next }) === location.pathname + location.search) setTimeout(() => setFocusSignal((n) => n + 1), 0);
    else {
      wantFocus.current = true;
      go(next);
    }
  };

  const showNew = async (): Promise<void> => {
    try {
      const data = await load();
      setList({ status: "ready", data });
      setPending(new Set());
      setFocusSignal((n) => n + 1);
    } catch {
      announce("Switchyard could not load this. Try again.");
    }
  };

  const bulk = async (field: string, value: Value): Promise<void> => {
    const numbers = list.status === "ready" ? list.data.rows.filter((r) => selected.has(r.summary.number)).map((r) => r.summary.number) : [];
    try {
      const { results } = await post<{ results: Array<{ number: string; ok: boolean; message?: string }> }>("/api/records/bulk", { numbers, fields: { [field]: value } });
      const ok = results.filter((r) => r.ok).length;
      const failed = results.length - ok;
      announce(`${ok} updated, ${failed} not updated.`);
      setDialog(null);
      setSelected(new Set());
      setReport({ ok, failed, lines: results.map((r) => (r.ok ? `${r.number} updated` : `${r.number} not updated: ${r.message ?? ""}`)) });
      void merge(new Set());
    } catch (error) {
      announce(error instanceof ApiFailure ? error.message : "Switchyard could not load this. Try again.");
    }
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !typesText(event.target)) {
      event.preventDefault();
      setDialog("filter");
    }
  };

  if (missing) return <StateScreen line="That page isn't on the switchyard." button="Back to your desk" onClick={() => navigate("/desk")} />;
  const phoneRecord = phone && (view.record !== null || view.newTable !== null);
  const retry = (): void => {
    setList({ status: "loading" });
    setAttempt((n) => n + 1);
  };
  const gate = phoneRecord ? null : loadingScreen(list, listName, retry);
  if (gate) return gate;

  const data = list.status === "ready" ? list.data : null;
  const subject = view.newTable ? (phone ? `New ${TABLE_LABELS[view.newTable]}` : listName) : (changeTitle ?? (phoneRecord ? view.record! : listName));
  const emptyLine = data && data.total === 0 ? (view.mode === "queue" ? `Nothing waiting in ${listName}.` : "No records match this filter.") : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  const newButtons = CREATABLE_TABLES.filter((t) => (t === "change" ? session.isOperator : session.isDesk)).map((t) => (
    <Button key={t} variant="outline" onClick={() => startNew(t)}>
      {`New ${TABLE_LABELS[t].toLowerCase()}`}
    </Button>
  ));

  const listPaneContent = (): JSX.Element | null => {
    if (!data) return null;
    if (emptyLine) {
      return (
        <>
          <div className="desk-toolbar">{newButtons}</div>
          {view.mode === "queue" ? (
            <PaneState line={emptyLine} button="Show all open incidents" onClick={() => navigate("/desk")} />
          ) : (
            <PaneState line={emptyLine} button="Clear filter" onClick={() => go({ mode: "raw", filter: "", page: 1 })} />
          )}
        </>
      );
    }
    return (
      <>
        <div className="desk-toolbar">
          {newButtons}
          <Button variant="outline" onClick={() => setDialog("filter")}>
            Filter
          </Button>
          <div className="toolbar-select">
            <label htmlFor="group-by">Group by</label>
            <select id="group-by" value={group} onChange={(event) => go({ group: event.target.value, page: 1 })}>
              <option value="">No grouping</option>
              {groupableFields(table).map((f) => (
                <option key={f.name} value={f.name}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          {phone ? null : (
            <Button variant="outline" onClick={() => setDialog("columns")}>
              Choose columns
            </Button>
          )}
          {phone ? null : (
            <Button variant="outline" disabled={selected.size === 0} onClick={() => setDialog("bulk")}>
              Update selected
            </Button>
          )}
          <Button variant="outline" onClick={exporter.start}>
            Export
          </Button>
        </div>
        {pending.size > 0 ? (
          <div className="desk-notice">
            <Button onClick={() => void showNew()}>{newRecordsText(pending.size)}</Button>
          </div>
        ) : null}
        {exporter.job ? <ExportProgress job={exporter.job} /> : null}
        {report ? (
          <section className="bulk-report" aria-label="Bulk update report">
            <h2 ref={reportHeading} tabIndex={-1}>
              Bulk update report
            </h2>
            <ul>
              {report.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {phone ? (
          <Cards name={listName} rows={data.rows} groupField={group} groups={data.groups} openNumber={view.record} onOpen={open} focusSignal={focusSignal} focusNumber={backFocus} />
        ) : (
          <Grid
            name={listName}
            table={table}
            rows={data.rows}
            columns={columns}
            groupField={group}
            groups={data.groups}
            selected={selected}
            onSelect={(next) => setSelected(next)}
            openNumber={view.record}
            onOpen={open}
            focusSignal={focusSignal}
            onEdited={() => void merge(new Set())}
          />
        )}
        <div className="pager">
          <Button variant="outline" disabled={data.page <= 1} onClick={() => go({ page: data.page - 1 })}>
            Previous page
          </Button>
          <span>{`Page ${data.page} of ${pages}, ${data.total} ${data.total === 1 ? "record" : "records"}`}</span>
          <Button variant="outline" disabled={data.page >= pages} onClick={() => go({ page: data.page + 1 })}>
            Next page
          </Button>
        </div>
      </>
    );
  };

  return (
    <Page subject={subject} wide compact={phoneRecord && changeTitle === null}>
      {phoneRecord && view.record !== null && subjectFor !== view.record ? null : (
      <div className="desk">
        {desktop ? (
          <nav aria-label="Queues" className="desk-nav">
            <h2>Queues</h2>
            <ul>
              {(queues ?? []).map((q) => (
                <li key={q.id}>
                  <Link to={`/desk?queue=${q.id}`} aria-current={view.mode === "queue" && queue?.id === q.id ? "page" : undefined} className="queue-link">
                    {q.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {phoneRecord ? null : (
          <div ref={listPane} className={`desk-list ${emptyLine ? "desk-list-empty" : ""}`} onKeyDown={onListKey}>
            {listPaneContent()}
          </div>
        )}
        {phone && !phoneRecord ? null : (
          <div className="desk-record">
            {view.newTable ? (
              <NewRecordForm key={view.newTable} table={view.newTable} onBack={phone ? back : undefined} onCreated={created} />
            ) : view.record ? (
              <RecordForm key={view.record} number={view.record} onBack={phone ? back : undefined} focusHeading={phone || view.record === createdRecord} onHeadingFocused={() => (createdRecord = null)} />
            ) : (
              <p className="desk-hint">Select a record to open it here.</p>
            )}
          </div>
        )}
      </div>
      )}
      {dialog === "filter" ? <FilterDialog table={table} filter={filterText} sheet={phone} onClose={() => setDialog(null)} onApply={apply} onSaved={reloadQueues} /> : null}
      {dialog === "bulk" ? <BulkDialog fields={bulkFields(table)} count={selected.size} onClose={() => setDialog(null)} onUpdate={(field, value) => void bulk(field, value)} /> : null}
      {dialog === "columns" ? <ColumnsDialog columns={allColumns} chosen={chosen} onChange={setChosen} onClose={() => setDialog(null)} /> : null}
    </Page>
  );
}
