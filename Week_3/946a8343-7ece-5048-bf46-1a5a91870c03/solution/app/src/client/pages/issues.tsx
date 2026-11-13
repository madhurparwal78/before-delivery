// `/projects/<id>/-/issues`: the issue list and the form that creates one. Creating lands on the new issue with focus on its
// level 1 title heading. Not a live page, but the list follows `issue` messages.
import { useState } from "preact/hooks";
import { announce } from "../announce.tsx";
import { api, asApiError } from "../api.ts";
import { useLiveResource } from "../live.ts";
import { useRole } from "../role.ts";
import { A, navigate, requestFocusOnArrival, useRoute } from "../router.ts";
import { Main } from "../shell/main.tsx";
import { Button } from "../ui/button.tsx";
import { Card } from "../ui/card.tsx";
import { Chip } from "../ui/chip.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { ErrorSummary, Notice, Skeleton, type SummaryError } from "../ui/feedback.tsx";
import { Checkbox, TextArea, TextField } from "../ui/fields.tsx";
import { useTitle } from "../ui/page.tsx";
import { asNumber, isRecord } from "../util.ts";
import { LabelChips, StateWord } from "./planning/parts.tsx";
import { readIssueRows, type IssueRow } from "./planning/types.ts";
import "../styles/planning.css";

const FIELDS = ["title", "description", "confidential"] as const;

function NewIssueForm({ projectId }: { projectId: string }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [confidential, setConfidential] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    setNotice(null);
    setAttempt((n) => n + 1);
    try {
      const created = await api.post<unknown>(`/api/projects/${encodeURIComponent(projectId)}/issues`, { title, description, confidential });
      const iid = isRecord(created) ? asNumber(created.iid) : null;
      if (iid === null) return;
      const path = `/projects/${projectId}/-/issues/${iid}`;
      requestFocusOnArrival(path);
      navigate(path);
    } catch (cause) {
      const failure = asApiError(cause);
      const fields = failure.fieldErrors();
      if (failure.status === 422 && Object.keys(fields).length > 0) setErrors(fields);
      else {
        setNotice(failure.message);
        announce(failure.message, "error");
      }
    } finally {
      setPending(false);
    }
  }

  const summary: SummaryError[] = FIELDS.flatMap((field) => {
    const message = errors[field];
    return message === undefined ? [] : [{ field, message }];
  });

  return (
    <Card id="new-issue" title="New issue" kicker="ISSUES">
      {notice !== null ? <Notice>{notice}</Notice> : null}
      <form onSubmit={submit} noValidate class="sp-plan-form">
        <ErrorSummary errors={summary} focusSignal={attempt} />
        <TextField label="Title" name="title" value={title} error={errors["title"] ?? null} onInput={(event) => setTitle(event.currentTarget.value)} />
        <TextArea label="Description" name="description" value={description} error={errors["description"] ?? null} onInput={(event) => setDescription(event.currentTarget.value)} />
        <Checkbox label="Confidential" name="confidential" checked={confidential} error={errors["confidential"] ?? null} onChange={(event) => setConfidential(event.currentTarget.checked)} />
        <Button type="submit" pending={pending}>
          Create issue
        </Button>
      </form>
    </Card>
  );
}

function IssuesScreen({ projectId }: { projectId: string }) {
  useTitle("Issues");
  const { atLeast } = useRole();
  const issues = useLiveResource<IssueRow[]>({
    project: projectId,
    types: ["issue"],
    deps: [projectId],
    load: async (signal) => readIssueRows(await api.get<unknown>(`/api/projects/${encodeURIComponent(projectId)}/issues`, { signal })),
  });
  const canCreate = atLeast("reporter");
  const openForm = () => {
    const field = document.getElementById("field-title");
    field?.scrollIntoView({ block: "center" });
    field?.focus();
  };
  return (
    <div class="sp-container sp-planning">
      <h1 tabIndex={-1} class="sp-page-title">
        Issues
      </h1>
      {issues.error ? <Notice>{issues.error.message}</Notice> : null}
      {issues.loading && !issues.data ? <Skeleton rows={4} height={72} /> : null}
      {issues.data && issues.data.length === 0 ? (
        <EmptyState eyebrow="ISSUES" headline="No issues yet" action={canCreate ? { label: "New issue", onClick: openForm } : undefined} />
      ) : null}
      {issues.data && issues.data.length > 0 ? (
        <ul aria-label="Issues" class="sp-issue-list">
          {issues.data.map((issue) => (
            <li key={issue.id} class="sp-issue-row">
              <A href={`/projects/${projectId}/-/issues/${issue.iid}`} class="sp-issue-row__link">
                <span class="sp-issue-row__id">{`#${issue.iid}`}</span>
                <span class="sp-issue-row__title">{issue.title}</span>
                <span class="sp-issue-row__facts">
                  <LabelChips labels={issue.labels} />
                  {issue.confidential ? <Chip tone="wait">Confidential</Chip> : null}
                  <StateWord state={issue.state} />
                </span>
              </A>
            </li>
          ))}
        </ul>
      ) : null}
      {canCreate ? <NewIssueForm projectId={projectId} /> : null}
    </div>
  );
}

export default function IssuesPage() {
  const { params } = useRoute();
  const projectId = params["id"] ?? "";
  return (
    <Main band project={projectId} pageKeys={["project"]}>
      <IssuesScreen projectId={projectId} />
    </Main>
  );
}
