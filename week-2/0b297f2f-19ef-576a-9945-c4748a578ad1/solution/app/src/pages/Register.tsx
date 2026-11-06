import { useCallback, useEffect, useRef, useState } from "react";
import { formatLength } from "../../shared/units";
import { get } from "../api";
import { luxHours, luxText, photoCount, poundsText, statusText } from "../format";
import { useLayout } from "../layout";
import { navigate, setQuery } from "../router";
import { useStore } from "../store";
import { Button } from "../ui/Button";
import { Link, Shell } from "../ui/Shell";
import { focusWhenReady } from "../ui/focus";
import type { ObjectRecord } from "../types";
import { ObjectForm } from "./ObjectForm";
import { rememberRecord } from "./Record";

const SEARCH_REST_MS = 300;
const SORTS = [
  ["number", "Object number"],
  ["title", "Title"],
  ["lender", "Lender"],
  ["lux", "Lux limit"],
] as const;
const COLUMNS = ["Object number", "Title", "Lender", "Dimensions", "Lux limit", "Lux-hour budget", "Insurance value", "Condition", "Placement"];
/** Cards lead with the linked title; the other eight values follow in column order. */
const CARD_ORDER = [1, 0, 2, 3, 4, 5, 6, 7, 8];

interface Query {
  q: string;
  lender: string;
  sort: string;
  dir: string;
}

function readQuery(): Query {
  const p = new URLSearchParams(location.search);
  return { q: p.get("q") ?? "", lender: p.get("lender") ?? "", sort: p.get("sort") ?? "number", dir: p.get("dir") ?? "asc" };
}

function apiQuery(q: Query): string {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.lender) p.set("lender", q.lender);
  p.set("sort", q.sort);
  p.set("dir", q.dir);
  return p.toString();
}

/** The Loan register: its search, lender filter, sort and order live in the address. */
export function Register() {
  const store = useStore();
  const layout = useLayout();
  const [query, setQueryState] = useState<Query>(readQuery);
  const [results, setResults] = useState<ObjectRecord[] | null>(null);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const placements = new Map((store.placements ?? []).map((p) => [p.id, p]));

  const load = useCallback(async (q: Query) => {
    const ticket = ++latest.current;
    try {
      const data = await get<{ objects: ObjectRecord[] }>(`/api/objects?${apiQuery(q)}`);
      if (ticket === latest.current) setResults(data.objects);
    } catch {
      // a refused or failed search leaves the last shown results
    }
  }, []);

  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    if (store.staff) void load(queryRef.current);
  }, [store.staff, load]);

  useEffect(() => {
    const back = () => {
      const q = readQuery();
      setQueryState(q);
      clearTimeout(timer.current);
      void load(q);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [load]);

  useEffect(
    () =>
      store.onEvents((events) => {
        if (events.some((e) => e.kind.startsWith("object") || e.kind.startsWith("photo") || e.kind.startsWith("placement"))) {
          void load(queryRef.current);
        }
      }),
    [store, load],
  );

  const change = (patch: Partial<Query>) => {
    const next = { ...query, ...patch };
    setQueryState(next);
    setQuery(
      { q: next.q || null, lender: next.lender || null, sort: next.sort === "number" ? null : next.sort, dir: next.dir === "asc" ? null : next.dir },
      "push",
    );
    clearTimeout(timer.current);
    void load(next);
  };

  const typed = (text: string) => {
    const next = { ...query, q: text };
    setQueryState(next);
    setQuery({ q: text || null }, "replace");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(next), SEARCH_REST_MS);
  };

  const lenders = store.exhibition?.lenders ?? [];
  const count = results ? (results.length === 1 ? "1 record" : `${results.length} records`) : "";
  const placement = (o: ObjectRecord) => {
    const p = o.placementId ? placements.get(o.placementId) : undefined;
    return statusText(o.placementStatus, p?.claimedBy?.name ?? null);
  };
  const cells = (o: ObjectRecord) => [
    o.objectNumber,
    o.title,
    o.lenderName ?? "Ashgrove collection",
    `${formatLength(o.widthMm, store.unit)} × ${formatLength(o.heightMm, store.unit)}`,
    luxText(o.luxLimit),
    `${luxHours(o.luxHourBudget)} lux-hours`,
    poundsText(o.insuranceValueGbp),
    photoCount(o.photos.length),
    placement(o),
  ];

  return (
    <Shell section="register">
      <main id="main" tabIndex={-1} className={`register layout-${layout}`}>
        <h1 className="display" tabIndex={-1}>
          Loan register
        </h1>
        <div className="register-controls">
          <div className="field field-search">
            <label htmlFor="register-search">Search records</label>
            <div className="search-box">
              <svg className="search-glyph" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
                <path d="M12.6 12.6 17 17" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
              <input
                id="register-search"
                type="search"
                autoComplete="off"
                placeholder="Title or object number"
                value={query.q}
                onChange={(e) => typed(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="register-lender">Lender filter</label>
            <select id="register-lender" value={query.lender} onChange={(e) => change({ lender: e.target.value })}>
              <option value="">All lenders</option>
              <option value="collection">Ashgrove collection</option>
              {lenders.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="register-sort">Sort by</label>
            <select id="register-sort" value={query.sort} onChange={(e) => change({ sort: e.target.value })}>
              {SORTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label" id="register-order">
              Order
            </span>
            <div role="radiogroup" aria-labelledby="register-order" className="segmented">
              {(
                [
                  ["asc", "Ascending"],
                  ["desc", "Descending"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="segment">
                  <input type="radio" name="register-order" checked={query.dir === value} onChange={() => change({ dir: value })} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
          {store.staff?.role === "registrar" && (
            <Button tone="primary" className="add-object" onClick={(e) => setAdding(e.currentTarget)}>
              Add object
            </Button>
          )}
        </div>
        <p role="status" aria-label="Records count" className="records-count num">
          {count}
        </p>
        {results && results.length === 0 && (
          <div className="empty">
            <svg viewBox="0 0 64 48" width="64" height="48" aria-hidden="true">
              <rect x="6" y="6" width="52" height="36" fill="none" stroke="currentColor" strokeWidth="2" />
              <rect x="14" y="13" width="36" height="22" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
            </svg>
            <p>No records match.</p>
          </div>
        )}
        {!results && <div className="skeleton-table" aria-hidden="true" />}
        {results && results.length > 0 && layout === "desk" && (
          <div className="table-wrap">
            <table aria-label="Loan register" className="register-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((o) => (
                  <tr key={o.id}>
                    {cells(o).map((value, i) =>
                      i === 1 ? (
                        <td key={i}>
                          <Link href={`/records/${o.id}`}>{value}</Link>
                        </td>
                      ) : (
                        <td key={i} className={i >= 4 && i <= 6 ? "num" : i === 7 ? "nowrap" : undefined}>
                          {value}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {results && results.length > 0 && layout !== "desk" && (
          <ul aria-label="Loan register" className="record-cards">
            {results.map((o) => {
              const values = cells(o);
              return (
                <li key={o.id} className="record-card">
                  <dl>
                    {CARD_ORDER.map((i) => (
                      <div key={COLUMNS[i]} className={i === 1 ? "record-card-title" : undefined}>
                        <dt>{COLUMNS[i]}</dt>
                        <dd>{i === 1 ? <Link href={`/records/${o.id}`}>{values[i]}</Link> : values[i]}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      {adding && (
        <ObjectForm
          opener={adding}
          unit={store.unit}
          onClose={() => setAdding(null)}
          onSaved={(o) => {
            rememberRecord(o);
            setAdding(null);
            navigate(`/records/${o.id}`);
            focusWhenReady(() => document.querySelector<HTMLElement>("main h1[data-record]"), 60);
          }}
        />
      )}
    </Shell>
  );
}
