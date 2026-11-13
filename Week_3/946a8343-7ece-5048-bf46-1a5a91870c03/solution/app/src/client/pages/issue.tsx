// `/projects/<id>/-/issues/<iid>`: one issue. A live page: the facts, the labels as scoped chips, the activity (comments and
// system notes in order) and the comment box, where quick actions run when the comment is submitted. The server announces the
// quick action results in its live message, so the page only refreshes.
import { useRef, useState } from "preact/hooks";
import { announce } from "../announce.tsx";
import { api, asApiError, useResource } from "../api.ts";
import { useLiveResource, type LiveMessage } from "../live.ts";
import { useRole } from "../role.ts";
import { A, useFocusOnArrival, useRoute } from "../router.ts";
import { LiveMain } from "../shell/main.tsx";
import { Button } from "../ui/button.tsx";
import { Card } from "../ui/card.tsx";
import { Chip } from "../ui/chip.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { TextArea } from "../ui/fields.tsx";
import { useTitle } from "../ui/page.tsx";
import { asNumber, asString, isRecord } from "../util.ts";
import { LabelChips, NoteList, StateWord } from "./planning/parts.tsx";
import { readIssue, readNotes, type IssueDetail, type NoteItem } from "./planning/types.ts";
import "../styles/planning.css";

function EpicLink({ groupId, iid, title }: { groupId: number; iid: number; title: string }) {
  const group = useResource<string | null>(async (signal) => {
    const raw = await api.get<unknown>(`/api/groups/${groupId}`, { signal });
    return isRecord(raw) ? asString(raw.path) : null;
  }, [groupId]);
  const text = `&${iid} ${title}`;
  return group.data ? <A href={`/groups/${group.data}/-/epics/${iid}`}>{text}</A> : <span>{text}</span>;
}

function Facts({ issue, projectId }: { issue: IssueDetail; projectId: string }) {
  return (
    <dl class="sp-plan-facts">
      <div class="sp-plan-facts__row">
        <dt>Author</dt>
        <dd>{issue.author}</dd>
      </div>
      <div class="sp-plan-facts__row">
        <dt>Assignees</dt>
        <dd>{issue.assignees.length === 0 ? "None" : issue.assignees.map((name) => `@${name}`).join(" ")}</dd>
      </div>
      <div class="sp-plan-facts__row">
        <dt>Milestone</dt>
        <dd>
          {issue.milestone === null ? (
            "None"
          ) : issue.milestoneId === null ? (
            issue.milestone
          ) : (
            <A href={`/projects/${projectId}/-/milestones/${issue.milestoneId}`}>{issue.milestone}</A>
          )}
        </dd>
      </div>
      <div class="sp-plan-facts__row">
        <dt>Weight</dt>
        <dd>{issue.weight === null ? "No weight" : issue.weight}</dd>
      </div>
      <div class="sp-plan-facts__row">
        <dt>Due date</dt>
        <dd>{issue.dueDate ?? "Not set"}</dd>
      </div>
      {issue.estimate !== null ? (
        <div class="sp-plan-facts__row">
          <dt>Estimate</dt>
          <dd>{issue.estimate}</dd>
        </div>
      ) : null}
      {issue.timeSpent !== null ? (
        <div class="sp-plan-facts__row">
          <dt>Time spent</dt>
          <dd>{issue.timeSpent}</dd>
        </div>
      ) : null}
      {issue.epic !== null ? (
        <div class="sp-plan-facts__row">
          <dt>Epic</dt>
          <dd>
            <EpicLink groupId={issue.epic.groupId} iid={issue.epic.iid} title={issue.epic.title} />
          </dd>
        </div>
      ) : null}
      {issue.links.length > 0 ? (
        <div class="sp-plan-facts__row">
          <dt>Linked issues</dt>
          <dd>
            <ul class="sp-plan-linked">
              {issue.links.map((link) => (
                <li key={`${link.kind}${link.iid}`}>
                  <span>{link.kind} </span>
                  <A href={`/projects/${projectId}/-/issues/${link.iid}`}>{`#${link.iid} ${link.title}`}</A>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function IssueScreen({ projectId, iid }: { projectId: string; iid: string }) {
  const number = Number(iid);
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  const { atLeast } = useRole();
  const base = `/api/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(iid)}`;
  const matches = (message: LiveMessage) => asNumber(message.data.iid) === number;
  const issue = useLiveResource<IssueDetail | null>({ project: projectId, types: ["issue"], deps: [projectId, iid], match: matches, load: async (signal) => readIssue(await api.get<unknown>(base, { signal })) });
  const notes = useLiveResource<NoteItem[]>({ project: projectId, types: ["issue"], deps: [projectId, iid], match: matches, load: async (signal) => readNotes(await api.get<unknown>(`${base}/notes`, { signal })) });
  const detail = issue.data ?? null;
  useTitle(detail ? `#${number} ${detail.title}` : `Issue #${number}`);

  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [changing, setChanging] = useState(false);

  async function post(event: Event): Promise<void> {
    event.preventDefault();
    if (posting) return;
    setPosting(true);
    setCommentError(null);
    setNotice(null);
    try {
      await api.post<unknown>(`${base}/notes`, { body: comment });
      setComment("");
      await Promise.all([issue.reload(), notes.reload()]);
    } catch (cause) {
      const failure = asApiError(cause);
      const field = failure.fieldErrors()["body"];
      if (failure.status === 422 && field !== undefined) {
        setCommentError(field);
        announce(field, "error");
      } else {
        setNotice(failure.message);
        announce(failure.message, "error");
      }
    } finally {
      setPosting(false);
    }
  }

  async function changeState(event: "close" | "reopen"): Promise<void> {
    if (changing) return;
    setChanging(true);
    setNotice(null);
    try {
      await api.patch<unknown>(base, { state_event: event });
      await Promise.all([issue.reload(), notes.reload()]);
    } catch (cause) {
      const failure = asApiError(cause);
      setNotice(failure.message);
      announce(failure.message, "error");
    } finally {
      setChanging(false);
    }
  }

  return (
    <div class="sp-container sp-planning">
      <p class="sp-planning__crumb">
        <A href={`/projects/${projectId}/-/issues`}>Issues</A>
      </p>
      <h1 ref={heading} tabIndex={-1} class="sp-page-title sp-issue-title">
        {detail ? detail.title : `Issue #${number}`}
      </h1>
      {issue.error ? <Notice>{issue.error.message}</Notice> : null}
      {notice !== null ? <Notice>{notice}</Notice> : null}
      {issue.loading && !detail && !issue.error ? <Skeleton rows={4} height={64} /> : null}
      {detail ? (
        <>
          <div class="sp-issue-head">
            <span class="sp-issue-head__id">{`#${detail.iid}`}</span>
            <StateWord state={detail.state} />
            {detail.confidential ? <Chip tone="wait">Confidential</Chip> : null}
            <LabelChips labels={detail.labels} />
            {atLeast("reporter") ? (
              detail.state === "closed" ? (
                <Button variant="secondary" pending={changing} onClick={() => void changeState("reopen")}>
                  Reopen issue
                </Button>
              ) : (
                <Button variant="secondary" pending={changing} onClick={() => void changeState("close")}>
                  Close issue
                </Button>
              )
            ) : null}
          </div>
          <div class="sp-issue-body">
            <section class="sp-issue-main" aria-label="Description">
              {detail.description === "" ? <p class="sp-muted">No description.</p> : <p class="sp-issue-description">{detail.description}</p>}
            </section>
            <Card title="Details" level={2} class="sp-issue-side">
              <Facts issue={detail} projectId={projectId} />
            </Card>
          </div>
        </>
      ) : null}
      <section class="sp-plan-activity" aria-labelledby="issue-activity-title">
        <h2 id="issue-activity-title" class="sp-plan-activity__title">
          Activity
        </h2>
        {notes.data && notes.data.length > 0 ? <NoteList notes={notes.data} label="Issue activity" /> : null}
        {notes.data && notes.data.length === 0 ? <p class="sp-muted">No activity yet.</p> : null}
        {detail ? (
          <form onSubmit={post} noValidate class="sp-plan-form sp-comment-form">
            <TextArea label="Comment" name="comment" value={comment} error={commentError} onInput={(event) => setComment(event.currentTarget.value)} />
            <Button type="submit" pending={posting}>
              Comment
            </Button>
          </form>
        ) : null}
      </section>
    </div>
  );
}

export default function IssuePage() {
  const { params } = useRoute();
  const projectId = params["id"] ?? "";
  const iid = params["iid"] ?? "";
  return (
    <LiveMain band project={projectId} pageKeys={[`issue:${iid}`]}>
      <IssueScreen key={iid} projectId={projectId} iid={iid} />
    </LiveMain>
  );
}
