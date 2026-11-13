// `/groups/<path>/-/epics/<iid>`: an epic. The group is found by its path among the viewer's groups, then the epic is read from
// `GET /api/groups/<id>/epics/<iid>`. Follows `epic` messages of the group's projects.
import { useMemo } from "preact/hooks";
import { api, useResource } from "../api.ts";
import { useRoute, A } from "../router.ts";
import { Main } from "../shell/main.tsx";
import { Card } from "../ui/card.tsx";
import { Chip } from "../ui/chip.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { useTitle } from "../ui/page.tsx";
import { asNumber } from "../util.ts";
import { useGroupByPath } from "./planning/filters.ts";
import { LabelChips, NoteList } from "./planning/parts.tsx";
import { readEpic, readNamedList, type EpicDetail } from "./planning/types.ts";
import { useEpicLive } from "./planning/group-live.ts";
import "../styles/planning.css";

function useProjectIds(): Map<string, number> {
  const projects = useResource<Map<string, number>>(async (signal) => {
    const ids = new Map<string, number>();
    for (const project of readNamedList(await api.get<unknown>("/api/me/projects", { signal }), "projects")) ids.set(project.path, project.id);
    return ids;
  }, []);
  return useMemo(() => projects.data ?? new Map<string, number>(), [projects.data]);
}

function EpicScreen({ path, iid }: { path: string; iid: string }) {
  const group = useGroupByPath(path);
  const groupId = group.data?.id ?? null;
  const epic = useResource<EpicDetail | null>(async (signal) => {
    if (groupId === null) return null;
    return readEpic(await api.get<unknown>(`/api/groups/${groupId}/epics/${encodeURIComponent(iid)}`, { signal }));
  }, [groupId, iid]);
  const projectIds = useProjectIds();
  const groupProjects = useResource<number[]>(async (signal) => {
    if (groupId === null) return [];
    const raw = await api.get<unknown>(`/api/groups/${groupId}`, { signal });
    return readNamedList(raw, "projects").map((project) => project.id);
  }, [groupId]);
  const liveIds = useMemo(() => {
    const ids = new Set<number>(groupProjects.data ?? []);
    for (const issue of epic.data?.issues ?? []) {
      const id = projectIds.get(issue.project);
      if (id !== undefined) ids.add(id);
    }
    return [...ids].sort((a, b) => a - b);
  }, [groupProjects.data, epic.data, projectIds]);
  useEpicLive(liveIds, asNumber(Number(iid)) ?? 0, () => void epic.reload());
  const detail = epic.data ?? null;
  const missing = group.data === null && !group.loading;
  const title = detail ? detail.title : `Epic &${iid}`;
  useTitle(title);
  return (
    <div class="sp-container sp-planning">
      <p class="sp-kicker sp-epic-kicker">{`&${iid}`}</p>
      <h1 tabIndex={-1} class="sp-page-title">
        {title}
      </h1>
      {group.error ? <Notice>{group.error.message}</Notice> : null}
      {epic.error ? <Notice>{epic.error.message}</Notice> : null}
      {missing ? <Notice>Group not found.</Notice> : null}
      {!detail && !epic.error && !missing ? <Skeleton rows={4} height={64} /> : null}
      {detail ? (
        <>
          <div class="sp-epic-head">
            <Chip tone={detail.state === "closed" ? "idle" : "live"}>{detail.state === "closed" ? "Closed" : "Open"}</Chip>
            {detail.confidential ? <Chip tone="wait">Confidential</Chip> : null}
            <LabelChips labels={detail.labels} />
            {detail.parent !== null ? <A href={`/groups/${path}/-/epics/${detail.parent}`}>{`Parent epic &${detail.parent}`}</A> : null}
          </div>
          {detail.description === "" ? null : <p class="sp-issue-description">{detail.description}</p>}
          <section role="region" aria-label="Epic dates" class="sp-epic-dates">
            <p>{detail.startDate === null ? "Start not set" : `Start ${detail.startDate}`}</p>
            <p>{detail.dueDate === null ? "Due not set" : `Due ${detail.dueDate}`}</p>
          </section>
          <div class="sp-epic-grid">
            <Card title="Child epics" level={2}>
              <ul aria-label="Child epics" class="sp-epic-list">
                {detail.children.map((child) => (
                  <li key={child.iid}>
                    <A href={`/groups/${path}/-/epics/${child.iid}`} class="sp-epic-list__link">
                      <span class="sp-epic-list__id">{`&${child.iid}`}</span>
                      <span>{child.title}</span>
                    </A>
                  </li>
                ))}
              </ul>
              {detail.children.length === 0 ? <p class="sp-muted">No child epics.</p> : null}
            </Card>
            <Card title="Issues" level={2}>
              <ul aria-label="Epic issues" class="sp-epic-list">
                {detail.issues.map((issue) => {
                  const projectId = projectIds.get(issue.project);
                  const inner = (
                    <>
                      <span class="sp-epic-list__id">{`${issue.project.slice(issue.project.lastIndexOf("/") + 1)}#${issue.iid}`}</span>
                      <span>{issue.title}</span>
                      {issue.milestone === null ? null : <span class="sp-muted">{issue.milestone}</span>}
                    </>
                  );
                  return (
                    <li key={`${issue.project}#${issue.iid}`}>
                      {projectId === undefined ? <span class="sp-epic-list__link">{inner}</span> : <A href={`/projects/${projectId}/-/issues/${issue.iid}`} class="sp-epic-list__link">{inner}</A>}
                    </li>
                  );
                })}
              </ul>
              {detail.issues.length === 0 ? <p class="sp-muted">No issues in this epic.</p> : null}
            </Card>
          </div>
          <Card title="Activity" level={2}>
            <NoteList notes={detail.notes} label="Epic activity" />
            {detail.notes.length === 0 ? <p class="sp-muted">No activity yet.</p> : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}

export default function GroupEpicPage() {
  const { params } = useRoute();
  const path = params["path"] ?? "";
  const iid = params["iid"] ?? "";
  return (
    <Main band>
      <EpicScreen key={`${path}/${iid}`} path={path} iid={iid} />
    </Main>
  );
}
