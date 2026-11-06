// The public home: the network band, the stats band and the two-column directory whose filters live in the address.
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { useResource } from "../hooks";
import { Heading, Link } from "../router";
import { Dialog } from "../ui/Dialog";
import { ChoiceGroup } from "../ui/forms";
import { Icon } from "../ui/Icon";
import { Empty, Fig } from "../ui/Table";
import type { Exchange, Jurisdiction } from "../types";
import { formatDate, formatMoney } from "../../shared/format";
import { NetworkBand, PublicPage, REGION_LABELS, STATUS_LABELS, StatsBand, type Stats } from "./chrome";

interface Filters {
  region: string;
  status: string;
  q: string;
}

const REGION_OPTIONS = [{ value: "", label: "All regions" }, ...Object.entries(REGION_LABELS).map(([value, label]) => ({ value, label }))];
const STATUS_OPTIONS = [{ value: "", label: "Any status" }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))];

function readFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const pick = (key: string, allowed: { value: string }[]) => {
    const value = params.get(key) ?? "";
    return allowed.some((o) => o.value === value) ? value : "";
  };
  return { region: pick("region", REGION_OPTIONS), status: pick("status", STATUS_OPTIONS), q: params.get("q") ?? "" };
}

/** The address of a set of filters: a default choice drops its key. */
function addressOf(f: Filters): string {
  const params = new URLSearchParams();
  if (f.region) params.set("region", f.region);
  if (f.status) params.set("status", f.status);
  if (f.q) params.set("q", f.q);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function query(pairs: [string, string][]): string {
  const params = new URLSearchParams(pairs.filter(([, v]) => v !== ""));
  const text = params.toString();
  return text ? `?${text}` : "";
}

function JurisdictionRule({ j }: { j: Jurisdiction }) {
  return (
    <>
      <span class={`rule-status rule-${j.status}`}>{STATUS_LABELS[j.status]}</span>
      {j.status === "in_force" && j.thresholdCents !== null && j.inForceSince && (
        <span class="rule-line"><Fig>{formatMoney(j.currency, j.thresholdCents)}</Fig> <span class="muted">since</span> <Fig>{formatDate(j.inForceSince)}</Fig></span>
      )}
      {j.announcedChange && (
        <span class="rule-line">
          <span class="muted">Announced:</span> <Fig>{formatMoney(j.currency, j.announcedChange.thresholdCents)}</Fig>{" "}
          <span class="muted">from</span> <Fig>{formatDate(j.announcedChange.takesEffectOn)}</Fig>
        </span>
      )}
      {j.status === "no_rule" && <span class="rule-line muted">No Travel Rule threshold yet</span>}
    </>
  );
}

function FilterControls({ filters, place, onRegion, onStatus, onSearch, onCommit }: {
  filters: Filters;
  place: "rail" | "sheet";
  onRegion: (v: string) => void;
  onStatus: (v: string) => void;
  onSearch: (v: string) => void;
  onCommit: () => void;
}) {
  return (
    <>
      <ChoiceGroup name={`${place}-region`} label="Region" value={filters.region} options={REGION_OPTIONS} onChange={onRegion} layout={place === "rail" ? "column" : "row"} />
      <ChoiceGroup name={`${place}-status`} label="Status" value={filters.status} options={STATUS_OPTIONS} onChange={onStatus} layout={place === "rail" ? "column" : "row"} />
      <div class="field">
        <label class="field-label" for={`${place}-search`}>Search exchanges</label>
        <input id={`${place}-search`} type="search" class="input" value={filters.q} autoComplete="off"
          onInput={(e) => onSearch(e.currentTarget.value)} onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
          }} />
      </div>
    </>
  );
}

export function HomePage() {
  const [filters, setFilters] = useState<Filters>(() => readFilters(location.search));
  const current = useRef(filters);
  const committed = useRef(addressOf(filters));
  const seq = useRef(0);
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[] | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[] | null>(null);
  const [announce, setAnnounce] = useState("");
  const [sheet, setSheet] = useState(false);
  const [entering, setEntering] = useState(true);
  const [stats] = useResource<Stats>("/api/public/stats");
  const [allJurisdictions] = useResource<{ jurisdictions: Jurisdiction[] }>("/api/public/jurisdictions");
  const names = new Map((allJurisdictions.state === "ready" ? allJurisdictions.data.jurisdictions : []).map((j) => [j.code, j.name]));

  /** Latest input wins: an older answer that arrives later is ignored. */
  const load = async (f: Filters) => {
    const mine = ++seq.current;
    const [j, e] = await Promise.all([
      api<{ jurisdictions: Jurisdiction[] }>("GET", `/api/public/jurisdictions${query([["region", f.region], ["status", f.status]])}`, { quiet: true }),
      api<{ exchanges: Exchange[] }>("GET", `/api/public/exchanges${query([["q", f.q], ["region", f.region], ["status", f.status]])}`, { quiet: true }),
    ]);
    if (mine !== seq.current) return;
    if (j.ok) setJurisdictions(j.data.jurisdictions);
    if (e.ok) {
      setExchanges(e.data.exchanges);
      const n = e.data.exchanges.length;
      setAnnounce(n === 1 ? "1 exchange matches" : `${n} exchanges match`);
    }
  };

  const apply = (next: Filters) => {
    current.current = next;
    setFilters(next);
    void load(next);
  };

  /** A committed change adds one history entry; typing in progress only rewrites the current one. */
  const commitSearch = () => {
    const address = addressOf(current.current);
    if (address === committed.current) return;
    history.replaceState(null, "", committed.current);
    history.pushState(null, "", address);
    committed.current = address;
  };

  const choose = (key: "region" | "status", value: string) => {
    commitSearch();
    const next = { ...current.current, [key]: value };
    const address = addressOf(next);
    if (address !== committed.current) {
      history.pushState(null, "", address);
      committed.current = address;
    }
    apply(next);
  };

  const typed = (q: string) => {
    const next = { ...current.current, q };
    history.replaceState(null, "", addressOf(next));
    apply(next);
  };

  useEffect(() => {
    void load(current.current);
    const restore = () => {
      committed.current = location.pathname + location.search;
      apply(readFilters(location.search));
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const controls = (place: "rail" | "sheet") => (
    <FilterControls filters={filters} place={place} onRegion={(v) => choose("region", v)} onStatus={(v) => choose("status", v)}
      onSearch={typed} onCommit={commitSearch} />
  );
  const active = [REGION_LABELS[filters.region], filters.status && STATUS_LABELS[filters.status as Jurisdiction["status"]], filters.q && `“${filters.q}”`]
    .filter(Boolean).join(" · ");

  return (
    <PublicPage>
      <NetworkBand>
        <p class="band-kicker">Travel Rule handshake desk</p>
        <Heading class="band-title">Every withdrawal, answered before it leaves</Heading>
        <p class="band-lede">Look up the Travel Rule in force in each jurisdiction, the changes already announced, and the exchanges listed on the desk.</p>
      </NetworkBand>
      <StatsBand stats={stats.state === "ready" ? stats.data : null} />
      <section class="directory" aria-label="Directory">
        <div class="directory-rail">
          <h2 class="directory-rail-title">Filter the directory</h2>
          {controls("rail")}
        </div>
        <div class="directory-narrow">
          <button type="button" class="button button-quiet button-icon-text" onClick={() => setSheet(true)}>
            <Icon name="menu" />
            <span>Filters</span>
          </button>
          <p class="directory-active muted">{active || "All regions · Any status"}</p>
        </div>
        <Dialog open={sheet} label="Filters" kind="sheet" onClose={() => setSheet(false)}>
          {controls("sheet")}
          <div class="form-actions">
            <button type="button" class="button button-primary" onClick={() => setSheet(false)}>Show results</button>
          </div>
        </Dialog>
        <p role="status" aria-label="Directory status" class="directory-status muted">{announce}</p>
        <div class={`results${entering ? " entering" : ""}`} onAnimationEnd={(e) => {
          if (e.currentTarget.getAnimations({ subtree: true }).every((a) => a.playState !== "running")) setEntering(false);
        }}>
          <div class="result-column">
            <h2 id="jurisdictions" tabIndex={-1} class="result-title">Jurisdictions</h2>
            <ul aria-label="Jurisdictions" class="cards">
              {(jurisdictions ?? []).map((j, i) => (
                <li key={j.code} class="card" style={{ "--i": i }}>
                  <Link href={`/jurisdictions/${j.code}`} class="card-link">
                    <span class="card-name">{j.name}</span>
                    <Icon name="chevron" size={18} />
                  </Link>
                  <span class="card-meta"><span class="code fig">{j.code}</span> {REGION_LABELS[j.region]}</span>
                  <JurisdictionRule j={j} />
                </li>
              ))}
            </ul>
            {jurisdictions?.length === 0 && <Empty />}
          </div>
          <div class="result-column">
            <h2 id="listed-exchanges" tabIndex={-1} class="result-title">Listed exchanges</h2>
            <ul aria-label="Listed exchanges" class="cards">
              {(exchanges ?? []).map((e, i) => (
                <li key={e.slug} class="card" style={{ "--i": i }}>
                  <Link href={`/exchanges/${e.slug}`} class="card-link">
                    <span class="card-name">{e.name}</span>
                    <Icon name="chevron" size={18} />
                  </Link>
                  <span class="card-meta">{names.get(e.jurisdictionCode) ?? e.jurisdictionCode} · {REGION_LABELS[e.region]}</span>
                  <span class={`network network-${e.onNetwork ? "on" : "off"}`}>
                    <span class="network-dot" aria-hidden="true" />
                    {e.onNetwork ? "On the network" : "Off the network"}
                  </span>
                </li>
              ))}
            </ul>
            {exchanges?.length === 0 && <Empty />}
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
