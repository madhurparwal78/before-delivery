// New merge request form. Branches come from GET /api/projects/:id/refs; field errors come back from the API (422) and show as an
// error summary plus the field's own message. Success opens the request and focuses its level 1 heading.
import { useState } from "preact/hooks";
import { api, useAction, useResource } from "../api.ts";
import { navigate, useQuery, useRoute } from "../router.ts";
import { useProject } from "../role.ts";
import { Button, Checkbox, ErrorSummary, Notice, Select, Skeleton, TextArea, TextField } from "../ui/index.ts";
import { Page } from "../ui/page.tsx";
import "../styles/mr.css";
import { mrPath } from "./mr/data.ts";
import { requestMrFocus } from "./mr/parts.tsx";

interface Branch {
  name: string;
  commit: string;
  protected: boolean;
}

const FIELDS = ["source", "target", "title", "description", "assignees", "reviewers"] as const;

function names(text: string): string[] {
  return text.split(/\s+/u).filter((name) => name !== "");
}

export default function MergeRequestNewPage() {
  const { params } = useRoute();
  const query = useQuery();
  const project = params.id ?? "";
  const { defaultBranch } = useProject();
  const refs = useResource(async (signal) => (await api.get<{ branches: Branch[] }>(`/api/projects/${encodeURIComponent(project)}/refs`, { signal })).branches, [project]);
  const [source, setSource] = useState(query.get("source") ?? "");
  const [target, setTarget] = useState(query.get("target") ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignees, setAssignees] = useState("");
  const [reviewers, setReviewers] = useState("");
  const [deleteSource, setDeleteSource] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const create = useAction(async () => {
    const made = await api.post<{ iid: number }>(`/api/projects/${encodeURIComponent(project)}/merge_requests`, {
      title,
      source: chosenSource,
      target: chosenTarget,
      description,
      assignees: names(assignees),
      reviewers: names(reviewers),
      delete_source_branch: deleteSource,
    });
    const path = mrPath(project, made.iid);
    requestMrFocus(path, "heading");
    navigate(path);
  });

  const branches = refs.data ?? [];
  const chosenTarget = branches.some((branch) => branch.name === target) ? target : (branches.find((branch) => branch.name === defaultBranch)?.name ?? branches[0]?.name ?? "");
  const chosenSource = branches.some((branch) => branch.name === source) ? source : (branches.find((branch) => branch.name !== chosenTarget)?.name ?? "");
  const options = branches.map((branch) => ({ value: branch.name, label: branch.name }));
  const errors = create.error?.fieldErrors() ?? {};
  const summary = FIELDS.filter((field) => errors[field] !== undefined).map((field) => ({ field, message: errors[field] ?? "" }));
  const strip = create.error && summary.length === 0 ? create.error.message : null;

  return (
    <Page title="New merge request" project={project}>
      <form
        class="sp-mrform"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setAttempts((n) => n + 1);
          void create.run();
        }}
      >
        <ErrorSummary errors={summary} focusSignal={attempts} />
        {strip ? <Notice>{strip}</Notice> : null}
        {refs.loading && refs.data === undefined ? (
          <Skeleton rows={2} height={48} />
        ) : (
          <>
            <Select label="Source branch" name="source" value={chosenSource} options={options} error={errors.source ?? null} onChange={(event) => setSource(event.currentTarget.value)} />
            <Select label="Target branch" name="target" value={chosenTarget} options={options} error={errors.target ?? null} onChange={(event) => setTarget(event.currentTarget.value)} />
          </>
        )}
        <TextField label="Title" name="title" value={title} error={errors.title ?? null} onInput={(event) => setTitle(event.currentTarget.value)} />
        <TextArea label="Description" name="description" value={description} error={errors.description ?? null} onInput={(event) => setDescription(event.currentTarget.value)} />
        <TextField
          label="Assignees"
          name="assignees"
          value={assignees}
          description="Usernames separated by spaces."
          error={errors.assignees ?? null}
          onInput={(event) => setAssignees(event.currentTarget.value)}
        />
        <TextField
          label="Reviewers"
          name="reviewers"
          value={reviewers}
          description="Usernames separated by spaces."
          error={errors.reviewers ?? null}
          onInput={(event) => setReviewers(event.currentTarget.value)}
        />
        <Checkbox label="Delete source branch when merged" name="delete-source" checked={deleteSource} onChange={(event) => setDeleteSource(event.currentTarget.checked)} />
        <Button type="submit" pending={create.pending}>
          Create merge request
        </Button>
      </form>
    </Page>
  );
}
