import { SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { announce } from "../announce";
import { get, post } from "../api";
import { Combobox } from "../components/Combobox";
import { FacetGroup, type FacetItem } from "../components/Facets";
import { Sheet } from "../components/Sheet";
import { ActionButton, Band } from "../components/ui";
import { useAction, useDebounce, useIsPhone, useLoad } from "../hooks";
import { Link, navigate, setAddress, useLocation } from "../router";
import { useSession } from "../session";
import { Screen } from "../shell/Page";
import { showToast } from "../toast";
import { formatRange } from "../../shared/money";
import { CITIES, PAY_BANDS, ROLE_FAMILIES, WORK_PATTERNS, nameOf } from "../../shared/reference";
import type { JobSearch, JobSummary } from "../../shared/api";

type Filters = { q: string; city: string[]; role: string[]; remote: string[]; band: string[] };
type Group = { key: Exclude<keyof Filters, "q">; facet: string; label: string; items: readonly { id: string; name: string }[] };

const GROUPS: Group[] = [
  { key: "city", facet: "city", label: "City", items: CITIES },
  { key: "role", facet: "role_family", label: "Role", items: ROLE_FAMILIES },
  { key: "remote", facet: "remote", label: "Work pattern", items: WORK_PATTERNS },
  { key: "band", facet: "pay_band", label: "Pay band", items: PAY_BANDS },
];

const countLine = (count: number): string => (count === 0 ? "No jobs match these filters" : count === 1 ? "1 job found" : `${count} jobs found`);

function readFilters(query: URLSearchParams): Filters {
  return { q: query.get("q") ?? "", city: query.getAll("city"), role: query.getAll("role"), remote: query.getAll("remote"), band: query.getAll("band") };
}

function toQuery(filters: Filters, page?: number): string {
  const params = new URLSearchParams();
  if (filters.q.trim() !== "") params.set("q", filters.q.trim());
  for (const group of GROUPS) filters[group.key].forEach((value) => params.append(group.key, value));
  if (page && page > 1) params.set("page", String(page));
  return params.toString();
}

type Change = { kind: "added" | "removed"; label: string } | undefined;

function JobItem({ job }: { job: JobSummary }) {
  return (
    <li data-id={job.id}>
      <Link to={`/jobs/${job.id}`}>{`${job.title} at ${job.company_name}`}</Link>
      <p className="meta figure">
        {job.city_name} · {nameOf(WORK_PATTERNS, job.remote)} · {formatRange(job.pay_low, job.pay_high)}
      </p>
    </li>
  );
}

export function Jobs() {
  const { query } = useLocation();
  const { me } = useSession();
  const phone = useIsPhone();
  const committed = query.toString();
  const [draft, setDraft] = useState<Filters>(() => readFilters(query));
  const change = useRef<Change>(undefined);
  const clear = useRef<HTMLButtonElement>(null);
  const filtersButton = useRef<HTMLButtonElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const alertAction = useAction();
  const page = Math.max(1, Number(query.get("page")) || 1);

  const results = useLoad(() => get<JobSearch>(`/api/jobs/search?${committed}`), [committed]);
  const data = results.data;

  useEffect(() => {
    const fromAddress = readFilters(new URLSearchParams(committed));
    setDraft((current) => (toQuery(current) === toQuery(fromAddress) ? current : fromAddress));
  }, [committed]);

  const commit = (filters: Filters) => {
    const next = toQuery(filters);
    if (next !== toQuery(readFilters(new URLSearchParams(committed)), page)) setAddress(`/jobs${next ? `?${next}` : ""}`, false);
  };
  useDebounce(toQuery(draft), () => commit(draft), 300, toQuery(draft) !== toQuery(readFilters(new URLSearchParams(committed))));

  const total = data && !data.fallback ? data.total : undefined;
  useEffect(() => {
    if (total === undefined) return;
    const note = change.current;
    change.current = undefined;
    announce(note ? `Filter ${note.kind}: ${note.label}. ${countLine(total)}.` : countLine(total));
  }, [data, total]);

  function toggle(group: Group, item: FacetItem) {
    const present = draft[group.key].includes(item.id);
    change.current = { kind: present ? "removed" : "added", label: item.label };
    setDraft({ ...draft, [group.key]: present ? draft[group.key].filter((id) => id !== item.id) : [...draft[group.key], item.id] });
  }

  function clearFilters() {
    change.current = undefined;
    setDraft({ ...draft, city: [], role: [], remote: [], band: [] });
  }

  async function saveAlert() {
    if (!me) {
      navigate(`/sign-in?next=${encodeURIComponent(`/jobs?${toQuery(draft)}`)}`);
      return;
    }
    const result = await alertAction.run(() => post<{ label: string }>("/api/alerts", draft));
    if (result.ok) showToast(`Alert saved for ${result.data.label}`);
    else announce(result.message);
  }

  const facetGroups = GROUPS.map((group) => (
    <FacetGroup
      key={group.key}
      label={group.label}
      items={group.items.map((item) => ({
        id: item.id,
        label: item.name,
        count: data && !data.fallback ? (data.facets[group.facet]?.[item.id] ?? 0) : undefined,
      }))}
      selected={draft[group.key]}
      onToggle={(item) => toggle(group, item)}
      afterLast={clear}
    />
  ));
  const shown = total ?? 0;
  const fallback = data?.fallback === "by_city";

  return (
    <Screen title="Lab jobs" band={fallback ? <Band>Search is unavailable right now. Showing all jobs by city instead.</Band> : null}>
      <h1 className="page-title">Lab jobs</h1>
      <div className="search-bar">
        <Combobox
          label="Job title"
          value={draft.q}
          onChange={(text) => {
            change.current = undefined;
            setDraft({ ...draft, q: text });
          }}
          load={async (text) => {
            const answer = await get<{ options: string[] }>(`/api/jobs/suggest?q=${encodeURIComponent(text)}`);
            return answer.ok ? answer.data.options.map((title) => ({ id: title, label: title })) : [];
          }}
          onPick={(option) => {
            const next = { ...draft, q: option.label };
            setDraft(next);
            commit(next);
          }}
          onEnter={(text) => commit({ ...draft, q: text })}
        />
        {phone ? (
          <button ref={filtersButton} type="button" className="btn-quiet" aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>
            <SlidersHorizontal size={20} aria-hidden="true" />
            Filters
          </button>
        ) : (
          <button ref={clear} type="button" className="btn-quiet" onClick={clearFilters}>Clear filters</button>
        )}
        <ActionButton type="button" className="btn" busy={alertAction.busy} onClick={() => void saveAlert()}>Save alert</ActionButton>
      </div>
      <div className="search-layout">
        {/* The counts widen the chips in the narrow column; draw the groups with them, not before. */}
        {phone ? null : <div className="facets">{data || results.failure ? facetGroups : null}</div>}
        <div>
          {fallback && data?.fallback === "by_city" ? (
            <ul className="by-city" aria-label="Jobs by city">
              {data.cities.map((entry) => (
                <li key={entry.city}>
                  <h3>{entry.city_name}</h3>
                  <ul>
                    {entry.jobs.map((job) => (
                      <JobItem key={job.id} job={job} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : data ? (
            <>
              <p className="count-line">{countLine(data.total)}</p>
              <ul className="results" aria-label="Job results">
                {data.hits.map((job) => (
                  <JobItem key={job.id} job={job} />
                ))}
              </ul>
              {data.hits.length === 0 ? (
                <div className="empty">
                  <p>No jobs match these filters</p>
                  <Link to="/jobs" className="btn">Show all jobs</Link>
                </div>
              ) : null}
              <div className="pager">
                {page > 1 ? <Link to={`/jobs?${toQuery(readFilters(query), page - 1)}`}>Previous page</Link> : null}
                {page * data.page_size < data.total ? <Link to={`/jobs?${toQuery(readFilters(query), page + 1)}`}>Next page</Link> : null}
              </div>
            </>
          ) : (
            <p>Loading</p>
          )}
        </div>
      </div>
      {phone ? (
        <Sheet title="Filters" open={sheetOpen} onClose={() => setSheetOpen(false)} opener={filtersButton}>
          {facetGroups}
          <div className="row">
            <button ref={clear} type="button" className="btn-quiet" onClick={clearFilters}>Clear filters</button>
            <button type="button" className="btn" onClick={() => setSheetOpen(false)}>{shown === 1 ? "Show 1 job" : `Show ${shown} jobs`}</button>
          </div>
        </Sheet>
      ) : null}
    </Screen>
  );
}
