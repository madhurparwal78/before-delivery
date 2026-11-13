// `/projects/<id>/-/milestones/<milestone id>`: the milestone's dates, its issues and the burndown (a drawing of the API's points
// plus the same numbers as a table). Follows `milestone` and `issue` messages.
import { api } from "../api.ts";
import { useLiveResource } from "../live.ts";
import { A, useRoute } from "../router.ts";
import { Main } from "../shell/main.tsx";
import { Card } from "../ui/card.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { useTitle } from "../ui/page.tsx";
import { BurndownChart } from "./planning/burndown.tsx";
import { LabelChips, StateWord } from "./planning/parts.tsx";
import { readBurndown, readIssueRows, readMilestone, type BurndownPoint, type IssueRow, type MilestoneInfo } from "./planning/types.ts";
import "../styles/planning.css";

interface MilestoneView {
  milestone: MilestoneInfo;
  issues: IssueRow[];
  points: BurndownPoint[];
}

function MilestoneScreen({ projectId, milestoneId }: { projectId: string; milestoneId: string }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}`;
  const view = useLiveResource<MilestoneView | null>({
    project: projectId,
    types: ["milestone", "issue"],
    deps: [projectId, milestoneId],
    load: async (signal) => {
      const milestone = readMilestone(await api.get<unknown>(`${base}/milestones/${encodeURIComponent(milestoneId)}`, { signal }));
      if (milestone === null) return null;
      const [issues, burndown] = await Promise.all([
        api.get<unknown>(`${base}/issues?milestone=${encodeURIComponent(milestone.title)}`, { signal }),
        api.get<unknown>(`${base}/milestones/${encodeURIComponent(milestoneId)}/burndown`, { signal }),
      ]);
      return { milestone, issues: readIssueRows(issues), points: readBurndown(burndown) };
    },
  });
  const loaded = view.data ?? null;
  const title = loaded ? loaded.milestone.title : "Milestone";
  useTitle(title);
  return (
    <div class="sp-container sp-planning">
      <h1 tabIndex={-1} class="sp-page-title">
        {title}
      </h1>
      {view.error ? <Notice>{view.error.message}</Notice> : null}
      {view.loading && !view.data && !view.error ? <Skeleton rows={4} height={64} /> : null}
      {loaded ? (
        <>
          <p class="sp-milestone-dates">
            {`${loaded.milestone.start} to ${loaded.milestone.due} (${loaded.milestone.timeZone})`}
          </p>
          <p class="sp-muted">{`${loaded.milestone.opened} open, ${loaded.milestone.closed} closed`}</p>
          <Card title="Burndown" kicker="MILESTONE" level={2}>
            <div class="sp-chart-scroll" role="group" aria-label="Burndown chart" tabIndex={0}>
              <BurndownChart points={loaded.points} />
            </div>
            <div class="sp-plan-table-scroll">
              <table aria-label="Burndown data" class="sp-plan-table">
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Remaining</th>
                    <th scope="col">Future</th>
                  </tr>
                </thead>
                <tbody>
                  {loaded.points.map((point) => (
                    <tr key={point.day}>
                      <td>{point.day}</td>
                      <td>{point.remaining}</td>
                      <td>{point.future ? "true" : "false"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Issues" level={2}>
            {loaded.issues.length === 0 ? (
              <p class="sp-muted">No issues in this milestone.</p>
            ) : (
              <ul aria-label="Milestone issues" class="sp-issue-list">
                {loaded.issues.map((issue) => (
                  <li key={issue.id} class="sp-issue-row">
                    <A href={`/projects/${projectId}/-/issues/${issue.iid}`} class="sp-issue-row__link">
                      <span class="sp-issue-row__id">{`#${issue.iid}`}</span>
                      <span class="sp-issue-row__title">{issue.title}</span>
                      <span class="sp-issue-row__facts">
                        <LabelChips labels={issue.labels} />
                        <StateWord state={issue.state} />
                      </span>
                    </A>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

export default function MilestonePage() {
  const { params } = useRoute();
  const projectId = params["id"] ?? "";
  const milestoneId = params["milestone"] ?? "";
  return (
    <Main band project={projectId} pageKeys={["project"]}>
      <MilestoneScreen key={milestoneId} projectId={projectId} milestoneId={milestoneId} />
    </Main>
  );
}
