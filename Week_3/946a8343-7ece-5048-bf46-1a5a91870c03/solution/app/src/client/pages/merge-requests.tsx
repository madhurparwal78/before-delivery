// Merge request list: GET /api/projects/:id/merge_requests?state=, newest first, with the empty start band.
import { useState } from "preact/hooks";
import { api } from "../api.ts";
import { useLiveResource } from "../live.ts";
import { A, useRoute } from "../router.ts";
import { Chip, EmptyState, LinkButton, Notice, Select, Skeleton, StatusBadge, Time } from "../ui/index.ts";
import { Page } from "../ui/page.tsx";
import "../styles/mr.css";
import { mrPath } from "./mr/data.ts";

type StateFilter = "opened" | "merged" | "closed" | "all";

const STATES: ReadonlyArray<{ value: StateFilter; label: string }> = [
  { value: "opened", label: "Open" },
  { value: "merged", label: "Merged" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

interface Listed {
  iid: number;
  title: string;
  state: "opened" | "closed" | "merged";
  draft: boolean;
  author: string;
  source: string;
  target: string;
  created_at: string;
  updated_at: string;
  head_pipeline?: { id: number; status: string } | null;
}

function isState(value: string): value is StateFilter {
  return STATES.some((state) => state.value === value);
}

function stateChip(row: Listed) {
  if (row.state === "merged") return <Chip tone="ok">Merged</Chip>;
  if (row.state === "closed") return <Chip tone="fail">Closed</Chip>;
  return row.draft ? <Chip tone="wait">Draft</Chip> : <Chip tone="ok">Open</Chip>;
}

export default function MergeRequestsPage() {
  const { params } = useRoute();
  const project = params.id ?? "";
  const [state, setState] = useState<StateFilter>("opened");
  const list = useLiveResource<Listed[]>({
    project,
    types: ["merge_request", "pipeline"],
    deps: [project, state],
    load: async (signal) => (await api.get<{ merge_requests: Listed[] }>(`/api/projects/${encodeURIComponent(project)}/merge_requests?state=${state}`, { signal })).merge_requests,
  });
  const newPath = `/projects/${encodeURIComponent(project)}/-/merge_requests/new`;
  const rows = list.data;
  return (
    <Page title="Merge requests" project={project} live>
      <div class="sp-mrlist__bar">
        <Select label="State" name="mr-state" value={state} options={STATES} onChange={(event) => isState(event.currentTarget.value) && setState(event.currentTarget.value)} />
        {rows && rows.length > 0 ? <LinkButton href={newPath}>New merge request</LinkButton> : null}
      </div>
      {list.error && rows === undefined ? <Notice>{list.error.message}</Notice> : null}
      {rows === undefined ? (
        list.error ? null : <Skeleton rows={4} height={72} />
      ) : rows.length === 0 ? (
        <EmptyState eyebrow="MERGE REQUESTS" headline="No merge requests yet" tone="dark" action={{ label: "Open a merge request", href: newPath }} />
      ) : (
        <ul aria-label="Merge requests" class="sp-mrlist">
          {rows.map((row) => (
            <li key={row.iid} class="sp-mrrow">
              <A href={mrPath(project, row.iid)} class="sp-mrrow__title">
                {row.title}
              </A>
              <p class="sp-mrrow__meta">
                <span class="sp-mono">{`!${row.iid}`}</span>
                {stateChip(row)}
                <span class="sp-kicker">{`[ ${row.source} -> ${row.target} ]`}</span>
                <span>{row.author}</span>
                <Time iso={row.updated_at} />
                {row.head_pipeline ? <StatusBadge status={row.head_pipeline.status} label={`Pipeline ${row.head_pipeline.status}`} /> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
