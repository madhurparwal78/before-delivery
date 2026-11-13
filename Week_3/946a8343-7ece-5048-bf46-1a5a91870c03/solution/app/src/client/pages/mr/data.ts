// Merge request page data, shared by the overview and the changes page.
//   useMergeRequestPage(project, iid, { notes? })   { mr, threads, notes, settings, status, error, reload, patch }: one live
//       resource (reloads on merge_request, thread, review, approvals, checks, version, pipeline, job, train and presence
//       messages of this request) and tells the server which request this page has open (`Viewing now`). Pending-review threads
//       are only returned to their author by the server. `notes` holds every thread note and system note (pass
//       `{ notes: false }` to skip that request); `patch` replaces the loaded request without a request (optimistic updates).
//   useMrCaps(mr)       what the signed-in user may do on this request, from the live role (controls leave when the role drops)
//   mrPath(project, iid, tab?)   page address of the request
//   closingText(closes)          text of region "Closing issues"
import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { api, type ApiError, useResource } from "../../api.ts";
import { type LivePage, sendPresence, useLiveResource } from "../../live.ts";
import { useRole } from "../../role.ts";
import { useUser } from "../../session.ts";
import { asNumber, isRecord } from "../../util.ts";

export type CheckState = "passed" | "failed" | "inactive";

export interface MrCheck {
  name: string;
  state: CheckState;
  text: string;
}

export interface ApprovalRule {
  name: string;
  kind: "rule" | "owners" | "security";
  required: number;
  given: number;
  optional: boolean;
}

export interface Approvals {
  rules: ApprovalRule[];
  approved_by: string[];
}

export interface MrVersion {
  number: number;
  base: string | null;
  head: string;
  start: string | null;
}

export interface TrainCar {
  position: number;
  sha: string;
  pipeline_id: number | null;
}

export interface MergeRequestDetail {
  iid: number;
  title: string;
  state: "opened" | "closed" | "merged";
  draft: boolean;
  author: string;
  source: string;
  target: string;
  description: string;
  assignees: string[];
  reviewers: string[];
  delete_source_branch: boolean;
  source_head: string | null;
  target_head: string | null;
  merge_base: string | null;
  versions: MrVersion[];
  checks: MrCheck[];
  approvals: Approvals;
  owners_problems: string[];
  head_pipeline: { id: number; status: string } | null;
  train: TrainCar | null;
  auto_merge: boolean;
  closes: number[];
  viewing: string[];
  merge_commit: string | null;
  merged_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: number;
  author: string;
  body: string;
  system: boolean;
  pending: boolean;
  thread_id: number | null;
  created_at: string;
}

export interface NotePosition {
  path: string;
  old_line: number | null;
  new_line: number | null;
  end_line: number | null;
  version: number;
}

export interface Suggestion {
  id: number;
  note_id: number;
  path: string;
  start_line: number;
  end_line: number;
  lines: string[];
  state: "open" | "applied" | "outdated";
}

export interface ThreadView {
  id: number;
  position: NotePosition | null;
  current_line: number | null;
  resolved: boolean;
  outdated: boolean;
  notes: Note[];
  suggestions: Suggestion[];
}

type MergeMethod = "merge_commit" | "squash" | "fast_forward" | "rebase";

export interface ProjectSettings {
  merge_method: MergeMethod;
  merge_trains: boolean;
  pipelines_must_succeed: boolean;
  reset_approvals_on_push: boolean;
  author_can_approve: boolean;
  auto_resolve_outdated: boolean;
}

export type PageStatus = "loading" | "ready" | "error";

interface MrPageData {
  mr: MergeRequestDetail;
  threads: ThreadView[];
  notes: Note[];
}

export interface MrPage {
  project: string;
  iid: number;
  mr: MergeRequestDetail | null;
  threads: ThreadView[];
  notes: Note[];
  settings: ProjectSettings | null;
  status: PageStatus;
  error: ApiError | null;
  reload(): Promise<void>;
  /** Filled in by MrFrame (from inside <LiveMain>) so that data-seq waits for this page's reloads. */
  livePage: { current: LivePage | null };
  patch(change: (current: MergeRequestDetail) => MergeRequestDetail): void;
}

const LIVE_TYPES = ["merge_request", "thread", "review", "approvals", "checks", "version", "pipeline", "job", "train", "presence"] as const;

/** Messages that name a request count only for that request; the rest (pipeline, job, train) may touch any of them. */
export function concernsRequest(iid: number, data: Record<string, unknown>): boolean {
  const named = asNumber(data.iid);
  return named === null || named === iid;
}

export function mrBase(project: string | number, iid: number): string {
  return `/api/projects/${encodeURIComponent(String(project))}/merge_requests/${iid}`;
}

export function mrPath(project: string | number, iid: number, tab: "overview" | "changes" | "conflicts" = "overview"): string {
  const root = `/projects/${encodeURIComponent(String(project))}/-/merge_requests/${iid}`;
  return tab === "overview" ? root : `${root}/${tab}`;
}

export function closingText(closes: readonly number[]): string {
  if (closes.length === 0) return "Merging closes no issues.";
  return `Merging closes ${closes.length} ${closes.length === 1 ? "issue" : "issues"}: ${closes.map((iid) => `#${iid}`).join(", ")}.`;
}

function settingsOf(raw: unknown): ProjectSettings | null {
  const body = isRecord(raw) && isRecord(raw.project) ? raw.project : raw;
  if (!isRecord(body) || !isRecord(body.settings)) return null;
  const s = body.settings;
  const method = s.merge_method;
  return {
    merge_method: method === "squash" || method === "fast_forward" || method === "rebase" ? method : "merge_commit",
    merge_trains: s.merge_trains === true,
    pipelines_must_succeed: s.pipelines_must_succeed === true,
    reset_approvals_on_push: s.reset_approvals_on_push === true,
    author_can_approve: s.author_can_approve === true,
    auto_resolve_outdated: s.auto_resolve_outdated === true,
  };
}

export function useMergeRequestPage(project: string, iid: number, options: { notes?: boolean } = {}): MrPage {
  const withNotes = options.notes !== false;
  const livePage = useRef<LivePage | null>(null);
  const resource = useLiveResource<MrPageData>({
    project,
    types: LIVE_TYPES,
    deps: [project, iid, withNotes],
    match: (message) => concernsRequest(iid, message.data),
    livePage,
    load: async (signal) => {
      const base = mrBase(project, iid);
      const [mr, threads, notes] = await Promise.all([
        api.get<MergeRequestDetail>(base, { signal }),
        api.get<{ threads: ThreadView[] }>(`${base}/threads`, { signal }),
        withNotes ? api.get<{ notes: Note[] }>(`${base}/notes`, { signal }) : Promise.resolve({ notes: [] as Note[] }),
      ]);
      return { mr, threads: threads.threads, notes: notes.notes };
    },
  });
  const projectInfo = useResource(async (signal) => settingsOf(await api.get<unknown>(`/api/projects/${encodeURIComponent(project)}`, { signal })), [project]);

  useLayoutEffect(() => {
    sendPresence(project, iid);
    return () => sendPresence(project, null);
  }, [project, iid]);

  const { data, error, reload, setData } = resource;
  const status: PageStatus = data !== undefined ? "ready" : error ? "error" : "loading";
  return useMemo(
    () => ({
      project,
      iid,
      mr: data?.mr ?? null,
      threads: data?.threads ?? [],
      notes: data?.notes ?? [],
      settings: projectInfo.data ?? null,
      status,
      error,
      reload,
      livePage,
      patch: (change) => {
        if (data) setData(() => ({ ...data, mr: change(data.mr) }));
      },
    }),
    [project, iid, data, error, status, reload, livePage, setData, projectInfo.data],
  );
}

export interface MrCaps {
  /** Developer or above: edit, merge, comment-resolve, train. */
  write: boolean;
  /** Developer or above, or a custom role holding `approve`. */
  approve: boolean;
  /** The signed-in user wrote this request; authors approve only when the project lets them. */
  author: boolean;
  authorMayApprove: boolean;
  comment: boolean;
  /** Maintainer or above: merge a car now. */
  manageTrain: boolean;
  /** Maintainer or above, or a custom role holding `dismiss_finding`. */
  findings: boolean;
  username: string | null;
}

export function useMrCaps(mr: MergeRequestDetail | null, settings: ProjectSettings | null): MrCaps {
  const { atLeast, can } = useRole();
  const me = useUser();
  const username = me?.username ?? null;
  return {
    write: atLeast("developer"),
    approve: atLeast("developer") || can("approve"),
    author: mr !== null && username !== null && mr.author === username,
    authorMayApprove: settings?.author_can_approve === true,
    comment: atLeast("reporter"),
    manageTrain: atLeast("maintainer"),
    findings: atLeast("maintainer") || can("dismiss_finding"),
    username,
  };
}
