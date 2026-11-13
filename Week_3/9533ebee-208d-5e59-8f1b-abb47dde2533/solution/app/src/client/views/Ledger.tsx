import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { liveError, parseDesk } from "../desk.ts";
import { useDecimals, useLive, useNav, useSession } from "../state.tsx";
import { Fig, Mono, Select, widestDecimals } from "../ui.tsx";
import { deskInput } from "../../shared/format.ts";

interface Totals {
  asset: string;
  debits: string;
  credits: string;
  net: string;
}

interface Posting {
  posting_id: string;
  kind: string;
  created_at: string;
  legs: { account: string; asset: string; amount: string }[];
}

// The Ledger view's filters live in the URL: /ledger with `asset`, `limit`, `from` and `to`, in that order, each
// present only when it differs from its default (all assets, 50, no bound). An unknown value falls back to its
// default, and the URL is then rewritten with a history replace.

const LIMITS = ["20", "50", "200"];
const DEFAULT_LIMIT = "50";
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

interface Filter {
  asset: string;
  limit: string;
  from: string;
  to: string;
}

function instantOf(value: string | null): string {
  return value !== null && CANONICAL_INSTANT.test(value) && !Number.isNaN(Date.parse(value)) ? value : "";
}

function readFilter(search: string, assets: string[]): Filter {
  const params = new URLSearchParams(search);
  const asset = params.get("asset") ?? "";
  const limit = params.get("limit") ?? DEFAULT_LIMIT;
  return {
    asset: assets.includes(asset) ? asset : "",
    limit: LIMITS.includes(limit) ? limit : DEFAULT_LIMIT,
    from: instantOf(params.get("from")),
    to: instantOf(params.get("to")),
  };
}

/** The canonical URL of a filter. Instants are written as they are: their colons are not escaped. */
function urlOf(filter: Filter): string {
  const parts = [
    filter.asset ? `asset=${filter.asset}` : "",
    filter.limit !== DEFAULT_LIMIT ? `limit=${filter.limit}` : "",
    filter.from ? `from=${filter.from}` : "",
    filter.to ? `to=${filter.to}` : "",
  ].filter(Boolean);
  return `/ledger${parts.length > 0 ? `?${parts.join("&")}` : ""}`;
}

/** A Posted from / Posted before field: typed in desk time, committed on Enter or on leaving the field. */
function DeskTimeField({ id, label, instant, zone, onCommit }: { id: string; label: string; instant: string; zone: string; onCommit: (instant: string) => void }) {
  const shown = instant && zone ? deskInput(instant, zone) : "";
  const [typed, setTyped] = useState(shown);
  useEffect(() => setTyped(shown), [shown]);
  const error = zone ? liveError(typed, (text) => parseDesk(text, zone)) : undefined;

  function commit() {
    if (!zone || typed === shown) return;
    if (typed.trim() === "") {
      onCommit("");
      return;
    }
    const parsed = parseDesk(typed, zone);
    if (parsed.ok) onCommit(parsed.value);
  }

  return (
    <div className={`field${error ? " field-invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={typed}
        placeholder="YYYY-MM-DD HH:MM"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function LedgerView() {
  const decimalsOf = useDecimals();
  const { market, wall } = useSession();
  const { search, navigate } = useNav();
  const assets = market?.pools.map((p) => p.asset) ?? [];
  const filter = readFilter(search, assets);
  const zone = market?.desk_time_zone ?? "";

  // A URL that holds an unknown or non-canonical value is rewritten with a history replace, never a push.
  const canonical = urlOf(filter);
  useEffect(() => {
    if (market && `${window.location.pathname}${window.location.search}` !== canonical) navigate(canonical, { replace: true });
  }, [market, canonical, navigate]);

  const change = (next: Partial<Filter>) => navigate(urlOf({ ...filter, ...next }));

  const { data: totals } = useLive(() => api<{ assets: Totals[] }>("GET", "/api/ledger/totals").then((b) => b.assets), 5000, []);
  const query = [filter.asset && `asset=${filter.asset}`, `limit=${filter.limit}`, filter.from && `from=${filter.from}`, filter.to && `to=${filter.to}`].filter(Boolean).join("&");
  const { data: postings } = useLive(() => api<{ postings: Posting[] }>("GET", `/api/ledger/postings?${query}`).then((b) => b.postings), 5000, [query]);
  const totalsPad = widestDecimals((totals ?? []).map((t) => t.asset), decimalsOf);
  const legsPad = widestDecimals((postings ?? []).flatMap((p) => p.legs.map((l) => l.asset)), decimalsOf);
  if (!totals || !postings) return null;

  return (
    <section className="sheet-section">
      <h1>Ledger</h1>
      <p className="lede">Every movement is one balanced posting. Each asset's debits and credits net to zero.</p>
      <table aria-label="Ledger totals" className="ledger-table">
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col" className="num">Debits</th>
            <th scope="col" className="num">Credits</th>
            <th scope="col" className="num">Net</th>
          </tr>
        </thead>
        <tbody>
          {(totals ?? []).map((row) => (
            <tr key={row.asset}>
              <th scope="row" data-label="Asset">
                {row.asset}
              </th>
              <td data-label="Debits" className="num">
                <Fig minor={row.debits} decimals={decimalsOf(row.asset)} pad={totalsPad} />
              </td>
              <td data-label="Credits" className="num">
                <Fig minor={row.credits} decimals={decimalsOf(row.asset)} pad={totalsPad} />
              </td>
              <td data-label="Net" className="num">
                <Fig minor={row.net} decimals={decimalsOf(row.asset)} pad={totalsPad} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Postings</h2>
      <div className="form-grid filters">
        <Select
          id="ledger-asset"
          label="Ledger asset"
          value={filter.asset}
          options={[{ value: "", label: "All assets" }, ...assets.map((a) => ({ value: a, label: a }))]}
          onChange={(asset) => change({ asset })}
        />
        <Select id="ledger-limit" label="Postings shown" value={filter.limit} options={LIMITS.map((l) => ({ value: l, label: l }))} onChange={(limit) => change({ limit })} />
        <DeskTimeField id="ledger-from" label="Posted from" instant={filter.from} zone={zone} onCommit={(from) => change({ from })} />
        <DeskTimeField id="ledger-to" label="Posted before" instant={filter.to} zone={zone} onCommit={(to) => change({ to })} />
      </div>
      <table aria-label="Postings" className="ledger-table postings-table">
        <thead>
          <tr>
            <th scope="col">Posting</th>
            <th scope="col">Kind</th>
            <th scope="col">Time</th>
            <th scope="col">Account</th>
            <th scope="col">Asset</th>
            <th scope="col" className="num">Amount</th>
          </tr>
        </thead>
        {(postings ?? []).map((posting) => (
          <tbody key={posting.posting_id} className="posting-group">
            {posting.legs.map((leg, index) => (
              <tr key={`${posting.posting_id}-${index}`} className={index === 0 ? "posting-first" : "posting-leg"}>
                <td data-label="Posting">{index === 0 ? <Mono>{posting.posting_id}</Mono> : null}</td>
                <td data-label="Kind">{index === 0 ? posting.kind : null}</td>
                <td data-label="Time">{index === 0 ? <Mono>{wall(posting.created_at, true)}</Mono> : null}</td>
                <td data-label="Account">
                  <Mono>{leg.account}</Mono>
                </td>
                <td data-label="Asset">{leg.asset}</td>
                <td data-label="Amount" className="num">
                  <Fig minor={leg.amount} decimals={decimalsOf(leg.asset)} pad={legsPad} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </section>
  );
}
