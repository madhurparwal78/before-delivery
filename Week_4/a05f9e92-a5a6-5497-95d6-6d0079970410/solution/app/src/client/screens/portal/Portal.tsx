import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Guide, CatalogItem } from "../../../server/catalog.js";
import { get } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { useTopics } from "../../lib/live.js";
import { Link, navigate } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { Button, Page, Rest, StatusBlock, useLoad, type Loaded } from "../../lib/ui.js";
import { PortalActions } from "./common.js";

const GUIDE_ID = "new-starter";

/** The line shown inside a region while its data loads or fails. */
function regionState<T>(state: Loaded<T>, subject: string, retry: () => void): JSX.Element | null {
  if (state.status === "ready") return null;
  if (state.status === "loading") return <p className="muted">Loading {subject}...</p>;
  return (
    <div className="region-error">
      <p>Switchyard could not load this. Try again.</p>
      <Button variant="outline" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

interface Article {
  number: string;
  title: string;
}

function KnowledgeSearch(): JSX.Element {
  const [text, setText] = useState("");
  const [searched, setSearched] = useState<{ query: string; articles: Article[] } | null>(null);
  const [failed, setFailed] = useState(false);

  const search = (event: FormEvent): void => {
    event.preventDefault();
    const query = text.trim();
    setFailed(false);
    get<{ articles: Article[] }>(`/api/knowledge/articles?q=${encodeURIComponent(query)}`).then(
      ({ articles }) => setSearched({ query, articles }),
      () => setFailed(true),
    );
  };

  let results: ReactNode = <p className="muted">Look for an answer before you report a fault.</p>;
  if (failed) results = <p className="form-error">Switchyard could not load this. Try again.</p>;
  else if (searched && searched.articles.length === 0) {
    results = (
      <div className="search-empty">
        <p className="state-line">No articles match "{searched.query}".</p>
        <Button onClick={() => navigate("/portal/fault")}>Report a fault</Button>
      </div>
    );
  } else if (searched) {
    results = (
      <ul className="link-list" aria-label="Knowledge results">
        {searched.articles.map((article) => (
          <li key={article.number}>
            <Link to={`/portal/knowledge/${article.number}`}>{article.title}</Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Rest label="Search knowledge" className="portal-search">
      <h2>Search knowledge</h2>
      <form className="search-form" role="search" onSubmit={search}>
        <input type="search" aria-label="Search knowledge" placeholder="Describe the problem" value={text} onChange={(event) => setText(event.target.value)} />
        <Button type="submit">Search</Button>
      </form>
      {results}
    </Rest>
  );
}

function CatalogRegion(): JSX.Element {
  const { state, reload } = useLoad(async () => {
    const [{ items }, { guide }] = await Promise.all([get<{ items: Array<Pick<CatalogItem, "id" | "name">> }>("/api/catalog/items"), get<{ guide: Pick<Guide, "id" | "name"> }>(`/api/catalog/guides/${GUIDE_ID}`)]);
    return { items, guide };
  }, []);
  return (
    <Rest label="Catalog" className="portal-catalog">
      <h2>Catalog</h2>
      {regionState(state, "catalog", reload)}
      {state.status === "ready" ? (
        <>
          <ul className="link-list">
            {state.data.items.map((item) => (
              <li key={item.id}>
                <Link to={`/portal/items/${item.id}`}>{item.name}</Link>
              </li>
            ))}
          </ul>
          <h3>Order guide</h3>
          <ul className="link-list">
            <li>
              <Link to={`/portal/guides/${state.data.guide.id}`}>{state.data.guide.name}</Link>
            </li>
          </ul>
        </>
      ) : null}
    </Rest>
  );
}

/** One entry of My requests: an incident of the caller or a request, with the instant it was made. */
interface Mine {
  to: string;
  name: string;
  state: string;
  stateLabel: string;
  at: string;
  watch: string[];
}

interface MyRecord {
  number: string;
  state: string;
  state_label: string;
  short_description: string;
  values?: { created_at?: string; request?: string };
}

/** The request items of the requests the person made or is requested-for on: requests are read through their items. */
const MY_REQUEST_ITEMS = "(request.requester = me()) or (request.requested_for = me())";

/** Every page of a list, newest first. */
async function newestFirst(table: "incident" | "request_item", filter: string, columns: string): Promise<MyRecord[]> {
  const found: MyRecord[] = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ columns, sort: "created_at", dir: "desc", page: String(page), filter });
    const result = await get<{ records: MyRecord[]; total: number }>(`/api/tables/${table}/records?${query}`);
    found.push(...result.records);
    if (result.records.length === 0 || found.length >= result.total) return found;
  }
}

async function loadRequest(number: string, at: string): Promise<Mine> {
  const { request } = await get<{ request: { state: "open" | "closed"; items: Array<{ number: string }> } }>(`/api/requests/${encodeURIComponent(number)}`);
  return { to: `/portal/requests/${number}`, name: number, state: request.state, stateLabel: request.state === "open" ? "Open" : "Closed", at, watch: request.items.map((item) => item.number) };
}

async function loadMine(): Promise<Mine[]> {
  const [incidents, items] = await Promise.all([newestFirst("incident", "caller = me()", "created_at"), newestFirst("request_item", MY_REQUEST_ITEMS, "request,created_at")]);
  const faults = incidents.map(
    (record): Mine => ({ to: `/portal/incidents/${record.number}`, name: `${record.number} ${record.short_description}`, state: record.state, stateLabel: record.state_label, at: record.values?.created_at ?? "", watch: [record.number] }),
  );
  const made = new Map<string, string>();
  for (const { values } of items) if (values?.request && !made.has(values.request)) made.set(values.request, values.created_at ?? "");
  const requests = await Promise.all([...made].map(([number, at]) => loadRequest(number, at)));
  return [...faults, ...requests].sort((a, b) => b.at.localeCompare(a.at) || b.name.localeCompare(a.name));
}

function MyRequests(): JSX.Element {
  const session = useSession();
  const announce = useAnnounce();
  const { state, reload } = useLoad(loadMine, [session.accessVersion]);
  const known = useRef(new Map<string, string>());
  const entries = state.status === "ready" ? state.data : [];

  useEffect(() => {
    for (const entry of entries) {
      const before = known.current.get(entry.to);
      if (before !== undefined && before !== entry.state && entry.to.includes("/incidents/")) announce(`Your request ${entry.watch[0]} is now ${entry.stateLabel}.`);
      known.current.set(entry.to, entry.state);
    }
  }, [entries, announce]);

  useTopics([...entries.flatMap((entry) => entry.watch.map((n) => `record:${n}`)), "list:incident", "list:request_item"], reload);

  return (
    <Rest label="My requests" className="portal-mine">
      <h2>My requests</h2>
      {regionState(state, "your requests", reload)}
      {state.status === "ready" && entries.length === 0 ? <p className="muted">You have not asked for anything yet.</p> : null}
      {entries.length > 0 ? (
        <ul className="record-list">
          {entries.map((entry) => (
            <li key={entry.to} className="record-row">
              <Link to={entry.to}>
                {entry.name}: <StatusBlock outlined={entry.state === "closed"}>{entry.stateLabel}</StatusBlock>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Rest>
  );
}

export function Portal(): JSX.Element {
  return (
    <Page subject="Ask the desk" wide>
      <PortalActions home />
      <div className="portal-grid">
        <KnowledgeSearch />
        <CatalogRegion />
        <MyRequests />
      </div>
    </Page>
  );
}
