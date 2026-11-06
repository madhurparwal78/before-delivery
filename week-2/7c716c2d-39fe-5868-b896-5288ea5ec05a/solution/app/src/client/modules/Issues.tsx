// Issues: filters in the address, the grouped list, the issue sheet and the New issue dialog.
import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiFailure, get, type Issue } from "../api";
import { Dialog } from "../components/Dialog";
import { inListOrder, IssueRows, useIssueActions } from "../components/IssueRows";
import { Picker } from "../components/Picker";
import { EmptyNote, NotFound, SheetHeader, TitleBlock } from "../components/Sheet";
import { Attachments, Uploader, withAttachment } from "../components/Uploader";
import { isRealDate, showDate } from "../format";
import { navigate } from "../router";
import { useApp } from "../store";
import { STATUS_LABELS } from "../../shared/status-edges";
import { Panes } from "../components/Panes";

interface Filters {
  project: string | null;
  cycle: string;
}

function readFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  return { project: params.get("project"), cycle: params.get("cycle") ?? "current" };
}

function filterQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.project) params.set("project", filters.project);
  if (filters.cycle !== "current") params.set("cycle", filters.cycle);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function IssuesModule(props: { rest: string[]; search: string }): JSX.Element {
  const app = useApp();
  const filters = readFilters(props.search);
  const current = app.currentCycle;
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const latest = useRef(0);
  const query = filterQuery(filters);
  const openKey = props.rest[0] ? decodeURIComponent(props.rest[0]) : null;

  const projectKnown = filters.project === null || app.projects.length === 0 || app.projects.some((p) => p.id === filters.project);
  const cycleKnown = filters.cycle === "current" || filters.cycle === "all" || filters.cycle === "none" || (/^[1-9]\d*$/.test(filters.cycle) && Number(filters.cycle) <= current);

  useEffect(() => {
    if (projectKnown && cycleKnown) return;
    const fixed = { project: projectKnown ? filters.project : null, cycle: cycleKnown ? filters.cycle : "current" };
    navigate(`${window.location.pathname}${filterQuery(fixed)}`, { replace: true });
  }, [projectKnown, cycleKnown, filters.project, filters.cycle]);

  const load = useCallback(() => {
    const ticket = ++latest.current;
    const params = new URLSearchParams();
    if (filters.project) params.set("project", filters.project);
    if (filters.cycle !== "all") params.set("cycle", filters.cycle);
    setLoading(true);
    get<{ issues: Issue[] }>(`/api/issues?${params.toString()}`)
      .then((r) => {
        if (ticket !== latest.current) return;
        setIssues(r.issues);
        setLoading(false);
      })
      .catch(() => ticket === latest.current && setLoading(false));
  }, [filters.project, filters.cycle]);

  useEffect(() => {
    if (projectKnown && cycleKnown) load();
  }, [load, projectKnown, cycleKnown, app.projects]);

  const onChanged = useCallback((updated: Issue) => setIssues((list) => inListOrder(list.map((i) => (i.key === updated.key ? updated : i)))), []);

  /** An `issue` event updates the list in place; the filter decides whether the row stays. */
  useEffect(
    () =>
      app.on((event) => {
        if (event.name === "reset") load();
        if (event.name === "revoked" && event.data.scope === "project") {
          const gone = event.data.id;
          setIssues((list) => list.filter((i) => i.project_id !== gone));
        }
        if (event.name !== "issue") return;
        const issue = event.data;
        setIssues((list) => {
          const known = list.some((i) => i.key === issue.key);
          const fixedCycle = /^\d+$/.test(filters.cycle) && Number(filters.cycle) < current;
          if (fixedCycle) return known ? inListOrder(list.map((i) => (i.key === issue.key ? issue : i))) : list;
          const inCycle = filters.cycle === "all" || issue.cycle_number === (filters.cycle === "none" ? null : filters.cycle === "current" ? current : Number(filters.cycle));
          const fits = inCycle && (filters.project === null || issue.project_id === filters.project);
          const others = list.filter((i) => i.key !== issue.key);
          return fits ? inListOrder([...others, issue]) : others;
        });
      }),
    [app, load, filters.project, filters.cycle, current],
  );

  const setFilter = (change: Partial<Filters>): void => navigate(`/issues${props.rest[0] ? `/${props.rest[0]}` : ""}${filterQuery({ ...filters, ...change })}`);

  const projectsByName = [...app.projects].sort((a, b) => a.name.localeCompare(b.name));
  const toolbar = (
    <div className="toolbar">
      <div className="toolbar-row">
        <label className="select-field">
          <span>Project</span>
          <select aria-label="Project filter" className="select" value={filters.project ?? ""} onChange={(e) => setFilter({ project: e.target.value || null })}>
            <option value="">All projects</option>
            {projectsByName.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="select-field">
          <span>Cycle</span>
          <select aria-label="Cycle filter" className="select" value={filters.cycle} onChange={(e) => setFilter({ cycle: e.target.value })}>
            <option value="current">Current cycle</option>
            <option value="all">All cycles</option>
            <option value="none">No cycle</option>
            {Array.from({ length: current }, (_, i) => (
              <option key={i + 1} value={String(i + 1)}>{`Cycle ${i + 1}`}</option>
            ))}
          </select>
        </label>
      </div>
      <button type="button" className="button primary" onClick={() => setCreating(true)}>
        <Plus aria-hidden="true" size={18} strokeWidth={1.5} />
        New issue
      </button>
    </div>
  );

  const list = (
    <IssueRows
      issues={issues}
      loading={loading}
      onChanged={onChanged}
      onOpen={(key) => navigate(`/issues/${encodeURIComponent(key)}${query}`)}
      toolbar={toolbar}
      emptyText="No issues match these filters."
    />
  );

  const detail = openKey ? (
    <IssueSheet key={openKey} issueKey={openKey} back={`/issues${query}`} onChanged={onChanged} />
  ) : props.rest.length > 1 ? (
    <NotFound back={`/issues${query}`} />
  ) : (
    <div className="sheet">
      <TitleBlock name="Issues" state={`${issues.length} shown`} changed={app.workspace.today} />
      <h1>Issues</h1>
      <EmptyNote>Choose an issue to open it here. J and K move through the list, S changes status and A changes the assignee.</EmptyNote>
    </div>
  );

  return (
    <>
      <Panes list={list} detail={detail} detailFirst={openKey !== null} detailKey={openKey ?? "none"} />
      {creating && (
        <NewIssueDialog
          defaultProject={filters.project ?? projectsByName[0]?.id ?? ""}
          onClose={() => setCreating(false)}
          onCreated={(issue) => {
            setCreating(false);
            app.announce(`${issue.key} created.`);
            load();
          }}
        />
      )}
    </>
  );
}

function NewIssueDialog(props: { defaultProject: string; onClose: () => void; onCreated: (issue: Issue) => void }): JSX.Element {
  const app = useApp();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [project, setProject] = useState(props.defaultProject);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (title.trim() === "") return setErrors({ title: "Give the issue a title." });
    try {
      props.onCreated(await api<Issue>("POST", "/api/issues", { project_id: project, title, description }));
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "validation") setErrors({ ...error.fields, ...(error.fields.title ? { title: "Give the issue a title." } : {}) });
    }
  };

  return (
    <Dialog label="New issue" onClose={props.onClose}>
      <form className="dialog-body form" noValidate onSubmit={(e) => void submit(e)}>
        <h2>New issue</h2>
        <div className="field">
          <label htmlFor="new-title">Title</label>
          <input id="new-title" className="input" value={title} aria-invalid={errors.title ? true : undefined} onChange={(e) => setTitle(e.target.value)} />
          {errors.title && <p className="field-error">{errors.title}</p>}
        </div>
        <div className="field">
          <label htmlFor="new-description">Description</label>
          <textarea id="new-description" className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new-project">Project</label>
          <select id="new-project" className="select" value={project} onChange={(e) => setProject(e.target.value)}>
            {[...app.projects]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
        <div className="dialog-actions">
          <button type="button" className="button ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Create issue
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function IssueSheet(props: { issueKey: string; back: string; onChanged: (issue: Issue) => void }): JSX.Element {
  const app = useApp();
  const current = app.currentCycle;
  const [issue, setIssue] = useState<Issue | null | "missing">(null);
  const [due, setDue] = useState("");
  const [dueError, setDueError] = useState("");
  const { onChanged } = props;

  const changed = useCallback(
    (updated: Issue) => {
      setIssue(updated);
      setDue(updated.due_date ?? "");
      onChanged(updated);
    },
    [onChanged],
  );
  const actions = useIssueActions(changed);

  useEffect(
    () =>
      app.on((event) => {
        if (event.name === "issue" && event.data.key === props.issueKey) {
          const updated = event.data;
          setIssue((prev) => {
            if (prev && prev !== "missing" && (prev.due_date ?? "") !== (updated.due_date ?? "")) setDue(updated.due_date ?? "");
            return updated;
          });
        }
        if (event.name === "revoked" && event.data.scope === "project") {
          const gone = event.data.id;
          setIssue((prev) => (prev && prev !== "missing" && prev.project_id === gone ? "missing" : prev));
        }
      }),
    [app, props.issueKey],
  );

  useEffect(() => {
    get<Issue>(`/api/issues/${encodeURIComponent(props.issueKey)}`)
      .then((found) => {
        setIssue(found);
        setDue(found.due_date ?? "");
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 404) setIssue("missing");
      });
  }, [props.issueKey]);

  if (issue === "missing") return <NotFound back={props.back} />;
  if (issue === null) return <div className="sheet" aria-busy="true" />;

  const saveDue = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setDueError("");
    if (due !== "" && !isRealDate(due)) {
      setDueError("Enter a date as YYYY-MM-DD.");
      app.announce("Enter a date as YYYY-MM-DD.");
      return;
    }
    try {
      const updated = await api<Issue>("PATCH", `/api/issues/${issue.key}`, { due_date: due || null });
      changed(updated);
      if (updated.due_date) app.announce(updated.due_date_snapped ? `Due date moved to ${showDate(updated.due_date)}, the next working day.` : `Due date set to ${showDate(updated.due_date)}.`);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "validation") {
        setDueError("Enter a date as YYYY-MM-DD.");
        app.announce("Enter a date as YYYY-MM-DD.");
      } else app.announce("Due date not saved.");
    }
  };

  const plan = async (value: string): Promise<void> => {
    try {
      changed(await api<Issue>("PATCH", `/api/issues/${issue.key}`, { cycle_number: value === "" ? null : Number(value) }));
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "cycle_closed") app.announce(`Cycle ${value} has ended. Plan into the current cycle or later.`);
    }
  };

  const project = app.projects.find((p) => p.id === issue.project_id);
  const cycleOptions = Array.from({ length: 6 }, (_, i) => current + i);

  return (
    <article className="sheet">
      <SheetHeader back={props.back} />
      <TitleBlock name={issue.key} state={STATUS_LABELS[issue.status]} changed={issue.updated_at} />
      <p className="eyebrow mono">
        {issue.key} · {project?.name}
      </p>
      <h1>{issue.title}</h1>
      <p className="description">{issue.description || "No description."}</p>
      <dl className="fields">
        <div>
          <dt>Status</dt>
          <dd>
            <button type="button" className="chip-button status-button" data-status={issue.status} aria-label={`Status: ${STATUS_LABELS[issue.status]}`} onClick={(e) => actions.openStatus(issue, e.currentTarget)}>
              <span className="status-dot" aria-hidden="true" />
              {STATUS_LABELS[issue.status]}
            </button>
          </dd>
        </div>
        <div>
          <dt>Assignee</dt>
          <dd>
            <button type="button" className="chip-button assignee-button" aria-label={`Assignee: ${issue.assignee_name ?? "Unassigned"}`} onClick={(e) => actions.openAssignee(issue, e.currentTarget)}>
              {issue.assignee_name ?? "Unassigned"}
            </button>
          </dd>
        </div>
        <div>
          <dt>
            <label htmlFor="issue-cycle">Cycle</label>
          </dt>
          <dd>
            <select id="issue-cycle" className="select" value={issue.cycle_number === null ? "" : String(issue.cycle_number)} onChange={(e) => void plan(e.target.value)}>
              <option value="">No cycle</option>
              {issue.cycle_number !== null && !cycleOptions.includes(issue.cycle_number) && <option value={String(issue.cycle_number)}>{`Cycle ${issue.cycle_number}`}</option>}
              {cycleOptions.map((n) => (
                <option key={n} value={String(n)}>{`Cycle ${n}`}</option>
              ))}
            </select>
          </dd>
        </div>
        <div>
          <dt>
            <label htmlFor="issue-due">Due date</label>
          </dt>
          <dd>
            <form className="inline-form" noValidate onSubmit={(e) => void saveDue(e)}>
              <input id="issue-due" className="input mono" placeholder="YYYY-MM-DD" value={due} aria-invalid={dueError ? true : undefined} onChange={(e) => setDue(e.target.value)} />
              <button type="submit" className="button">
                Set due date
              </button>
            </form>
            {dueError && <p className="field-error">{dueError}</p>}
          </dd>
        </div>
        <div>
          <dt>Parent</dt>
          <dd>
            {issue.parent_key ? (
              <a className="mono" href={`/issues/${issue.parent_key}`} onClick={(e) => (e.preventDefault(), navigate(`/issues/${issue.parent_key}`))}>
                {issue.parent_key}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt>Sub-issues</dt>
          <dd className="sub-issues">
            {issue.sub_issue_keys.length === 0
              ? "—"
              : issue.sub_issue_keys.map((key) => (
                  <a key={key} className="mono" href={`/issues/${key}`} onClick={(e) => (e.preventDefault(), navigate(`/issues/${key}`))}>
                    {key}
                  </a>
                ))}
          </dd>
        </div>
      </dl>
      <section className="attachments-block" aria-label="Attachments">
        <h2>Attachments</h2>
        <Attachments attachments={issue.attachments} />
        <Uploader path={`/api/issues/${encodeURIComponent(issue.key)}/attachments`} onUploaded={(a) => setIssue((prev) => (prev && prev !== "missing" ? { ...prev, attachments: withAttachment(prev.attachments, a) } : prev))} />
      </section>
      {actions.picker && <Picker request={actions.picker} onDone={actions.closePicker} />}
    </article>
  );
}
