// Route table: every page route of the brief's "Page routes" table. Order matters: the first match wins, so specific patterns
// come before the ones that would also match them. `:name` matches one path segment, `*name` one or more.
//
// Route -> page file (src/client/pages/, default export component; page contributors replace the stub in place):
//   /sign-in                                          sign-in.tsx
//   /sign-up                                          sign-up.tsx
//   /                                                 dashboard.tsx
//   /groups/*path/-/epics/:iid                        group-epic.tsx
//   /groups/*path/-/boards/:id                        group-board.tsx
//   /groups/*path                                     group.tsx
//   /projects/:id                                     project-home.tsx
//   /projects/:id/-/files                             files.tsx
//   /projects/:id/-/blame                             blame.tsx
//   /projects/:id/-/commits                           commits.tsx
//   /projects/:id/-/commit/:sha                       commit.tsx
//   /projects/:id/-/compare                           compare.tsx
//   /projects/:id/-/edit                              edit.tsx
//   /projects/:id/-/ci/editor                         ci-editor.tsx
//   /projects/:id/-/merge_requests                    merge-requests.tsx
//   /projects/:id/-/merge_requests/new                merge-request-new.tsx
//   /projects/:id/-/merge_requests/:iid               merge-request.tsx
//   /projects/:id/-/merge_requests/:iid/changes       merge-request-changes.tsx
//   /projects/:id/-/merge_requests/:iid/conflicts     merge-request-conflicts.tsx
//   /projects/:id/-/train                             train.tsx
//   /projects/:id/-/pipelines                         pipelines.tsx
//   /projects/:id/-/pipelines/:pipeline               pipeline.tsx
//   /projects/:id/-/jobs/:job                         job.tsx
//   /projects/:id/-/environments                      environments.tsx
//   /projects/:id/-/environments/:environment         environment.tsx
//   /projects/:id/-/metrics                           metrics.tsx
//   /projects/:id/-/issues                            issues.tsx
//   /projects/:id/-/issues/:iid                       issue.tsx
//   /projects/:id/-/milestones/:milestone             milestone.tsx
//   /projects/:id/-/boards/:board                     board.tsx
//   /projects/:id/-/wiki/:slug/history                wiki-history.tsx
//   /projects/:id/-/wiki/:slug                        wiki-page.tsx
//   /projects/:id/-/settings                          settings.tsx
//   /projects/:id/-/audit                             audit.tsx
//   /projects/:id/-/export                            export.tsx
//   /projects/:id/-/import                            import.tsx
//   /search                                           search.tsx
//   (anything else)                                   not-found.tsx
// Params are read with useRoute().params, the query string with useQuery().
import type { ComponentType } from "preact";
import { matchPattern } from "./router.ts";
import AuditPage from "./pages/audit.tsx";
import BlamePage from "./pages/blame.tsx";
import BoardPage from "./pages/board.tsx";
import CiEditorPage from "./pages/ci-editor.tsx";
import CommitPage from "./pages/commit.tsx";
import CommitsPage from "./pages/commits.tsx";
import ComparePage from "./pages/compare.tsx";
import DashboardPage from "./pages/dashboard.tsx";
import EditPage from "./pages/edit.tsx";
import EnvironmentPage from "./pages/environment.tsx";
import EnvironmentsPage from "./pages/environments.tsx";
import ExportPage from "./pages/export.tsx";
import FilesPage from "./pages/files.tsx";
import GroupBoardPage from "./pages/group-board.tsx";
import GroupEpicPage from "./pages/group-epic.tsx";
import GroupPage from "./pages/group.tsx";
import ImportPage from "./pages/import.tsx";
import IssuePage from "./pages/issue.tsx";
import IssuesPage from "./pages/issues.tsx";
import JobPage from "./pages/job.tsx";
import MergeRequestChangesPage from "./pages/merge-request-changes.tsx";
import MergeRequestConflictsPage from "./pages/merge-request-conflicts.tsx";
import MergeRequestNewPage from "./pages/merge-request-new.tsx";
import MergeRequestPage from "./pages/merge-request.tsx";
import MergeRequestsPage from "./pages/merge-requests.tsx";
import MetricsPage from "./pages/metrics.tsx";
import MilestonePage from "./pages/milestone.tsx";
import NotFoundPage from "./pages/not-found.tsx";
import PipelinePage from "./pages/pipeline.tsx";
import PipelinesPage from "./pages/pipelines.tsx";
import ProjectHomePage from "./pages/project-home.tsx";
import SearchPage from "./pages/search.tsx";
import SettingsPage from "./pages/settings.tsx";
import SignInPage from "./pages/sign-in.tsx";
import SignUpPage from "./pages/sign-up.tsx";
import TrainPage from "./pages/train.tsx";
import WikiHistoryPage from "./pages/wiki-history.tsx";
import WikiPage from "./pages/wiki-page.tsx";

interface RouteDef {
  pattern: string;
  page: ComponentType;
}

const routes: readonly RouteDef[] = [
  { pattern: "/sign-in", page: SignInPage },
  { pattern: "/sign-up", page: SignUpPage },
  { pattern: "/", page: DashboardPage },
  { pattern: "/groups/*path/-/epics/:iid", page: GroupEpicPage },
  { pattern: "/groups/*path/-/boards/:id", page: GroupBoardPage },
  { pattern: "/groups/*path", page: GroupPage },
  { pattern: "/projects/:id", page: ProjectHomePage },
  { pattern: "/projects/:id/-/files", page: FilesPage },
  { pattern: "/projects/:id/-/blame", page: BlamePage },
  { pattern: "/projects/:id/-/commits", page: CommitsPage },
  { pattern: "/projects/:id/-/commit/:sha", page: CommitPage },
  { pattern: "/projects/:id/-/compare", page: ComparePage },
  { pattern: "/projects/:id/-/edit", page: EditPage },
  { pattern: "/projects/:id/-/ci/editor", page: CiEditorPage },
  { pattern: "/projects/:id/-/merge_requests", page: MergeRequestsPage },
  { pattern: "/projects/:id/-/merge_requests/new", page: MergeRequestNewPage },
  { pattern: "/projects/:id/-/merge_requests/:iid", page: MergeRequestPage },
  { pattern: "/projects/:id/-/merge_requests/:iid/changes", page: MergeRequestChangesPage },
  { pattern: "/projects/:id/-/merge_requests/:iid/conflicts", page: MergeRequestConflictsPage },
  { pattern: "/projects/:id/-/train", page: TrainPage },
  { pattern: "/projects/:id/-/pipelines", page: PipelinesPage },
  { pattern: "/projects/:id/-/pipelines/:pipeline", page: PipelinePage },
  { pattern: "/projects/:id/-/jobs/:job", page: JobPage },
  { pattern: "/projects/:id/-/environments", page: EnvironmentsPage },
  { pattern: "/projects/:id/-/environments/:environment", page: EnvironmentPage },
  { pattern: "/projects/:id/-/metrics", page: MetricsPage },
  { pattern: "/projects/:id/-/issues", page: IssuesPage },
  { pattern: "/projects/:id/-/issues/:iid", page: IssuePage },
  { pattern: "/projects/:id/-/milestones/:milestone", page: MilestonePage },
  { pattern: "/projects/:id/-/boards/:board", page: BoardPage },
  { pattern: "/projects/:id/-/wiki/:slug/history", page: WikiHistoryPage },
  { pattern: "/projects/:id/-/wiki/:slug", page: WikiPage },
  { pattern: "/projects/:id/-/settings", page: SettingsPage },
  { pattern: "/projects/:id/-/audit", page: AuditPage },
  { pattern: "/projects/:id/-/export", page: ExportPage },
  { pattern: "/projects/:id/-/import", page: ImportPage },
  { pattern: "/search", page: SearchPage },
];

interface Matched {
  pattern: string;
  params: Record<string, string>;
  page: ComponentType;
}

export function matchRoute(path: string): Matched {
  for (const route of routes) {
    const params = matchPattern(route.pattern, path);
    if (params) return { pattern: route.pattern, params, page: route.page };
  }
  return { pattern: "*", params: {}, page: NotFoundPage };
}
