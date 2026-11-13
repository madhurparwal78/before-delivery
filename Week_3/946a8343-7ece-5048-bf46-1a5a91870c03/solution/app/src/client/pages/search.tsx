// `/search?scope=&q=`: `combobox "Scope"`, the result count and `list "Results"`. The query box is the header's `searchbox "Search"`.
import "../styles/project.css";
import { api, useResource } from "../api.ts";
import { A, setQuery, useQuery } from "../router.ts";
import { Main } from "../shell/main.tsx";
import { Chip } from "../ui/chip.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { Select, type SelectOption } from "../ui/fields.tsx";
import { useTitle } from "../ui/page.tsx";
import type { SearchAnswer, SearchResult } from "./project/types.ts";

const SCOPES: readonly SelectOption[] = [
  { value: "code", label: "Code" },
  { value: "issues", label: "Issues" },
  { value: "requests", label: "Merge requests" },
  { value: "wiki", label: "Wiki" },
];

function hrefOf(scope: string, result: SearchResult): string {
  const project = `/projects/${result.project_id}`;
  if (scope === "issues") return `${project}/-/issues/${result.iid}`;
  if (scope === "requests") return `${project}/-/merge_requests/${result.iid}`;
  if (scope === "wiki") return `${project}/-/wiki/${result.slug}`;
  return `${project}/-/files?${new URLSearchParams({ path: result.path ?? "" }).toString()}`;
}

function ResultItem({ scope, result }: { scope: string; result: SearchResult }) {
  const title =
    scope === "code" ? `${result.path}:${result.line}` : scope === "wiki" ? (result.title ?? result.slug ?? "") : `${scope === "issues" ? "#" : "!"}${result.iid} ${result.title ?? ""}`;
  const line = scope === "code" || scope === "wiki" ? result.text : undefined;
  return (
    <li class="sp-result">
      <A href={hrefOf(scope, result)} class="sp-result__link">
        <span class="sp-result__project sp-mono">{result.project}</span>
        <span class="sp-result__title">{title}</span>
        {line ? <span class="sp-result__text sp-mono">{line}</span> : null}
        {result.state ? <Chip>{result.state}</Chip> : null}
        {result.confidential ? <Chip tone="wait">confidential</Chip> : null}
      </A>
    </li>
  );
}

export default function SearchPage() {
  useTitle("Search");
  const query = useQuery();
  const scope = SCOPES.some((option) => option.value === query.get("scope")) ? (query.get("scope") ?? "code") : "code";
  const q = query.get("q") ?? "";
  const found = useResource(
    (signal) => (q === "" ? Promise.resolve<SearchAnswer>({ count: 0, results: [] }) : api.get<SearchAnswer>(`/api/search?${new URLSearchParams({ scope, q }).toString()}`, { signal })),
    [scope, q],
  );
  return (
    <Main>
      <div class="sp-container sp-search-page">
        <h1 class="sp-page-title">Search</h1>
        <Select label="Scope" name="scope" value={scope} options={SCOPES} class="sp-search-page__scope" onChange={(event) => setQuery({ scope: event.currentTarget.value })} />
        {found.error ? <Notice>{found.error.message}</Notice> : null}
        {found.loading && !found.data ? <Skeleton rows={4} height={64} /> : null}
        {found.data ? (
          <>
            <p class="sp-search-page__count">{`${found.data.count} results`}</p>
            <ul class="sp-results" aria-label="Results">
              {found.data.results.map((result, index) => (
                <ResultItem key={index} scope={scope} result={result} />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </Main>
  );
}
