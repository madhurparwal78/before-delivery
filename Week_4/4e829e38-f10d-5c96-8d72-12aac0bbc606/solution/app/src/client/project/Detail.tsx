import { useRef, useState } from "preact/hooks";
import { api, get } from "../api";
import { useLive, useMount, useResource } from "../hooks";
import { Icon } from "../icons";
import { viewTask } from "../live";
import { reducedMotion, tween } from "../motion";
import { SAVE_FAILED, type ProjectData } from "../project-data";
import { announce, configStore, openModal, outageStore, toast } from "../store";
import type { Field, Me, ProjectInfo, RuleRun, Task, TaskDetail } from "../types";
import { Dialog, FieldError, Pill, Status, useBusy } from "../ui";
import { ConfirmDelete } from "./dialogs";

interface Props {
  taskId: string;
  project: ProjectInfo;
  me: Me;
  data: ProjectData;
  onClose: () => void;
  onDeleted: (task: Task) => void;
}

const SLIDE_PX = 8;
const SLIDE_MS = 160;

const CHIP: Record<string, string> = {
  requested: "Awaiting approval", approved: "Approved", changes_requested: "Changes requested", rejected: "Rejected",
};

function megabytes(bytes: number): string {
  return bytes % 1048576 === 0 ? `${bytes / 1048576} MB` : `${bytes} bytes`;
}

function RunEntry({ run, fresh }: { run: RuleRun; fresh: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  useMount(() => {
    const el = ref.current!;
    if (!fresh || reducedMotion()) {
      el.dataset.motion = "settled";
      el.dataset.slideOffset = "0.00";
      return undefined;
    }
    el.dataset.motion = "entering";
    const running = tween(
      SLIDE_MS,
      (eased) => {
        const offset = SLIDE_PX * (1 - eased);
        el.dataset.slideOffset = offset.toFixed(2);
        el.style.transform = `translateX(${offset}px)`;
      },
      () => {
        el.dataset.motion = "settled";
        el.style.transform = "";
      },
    );
    return () => running.cancel();
  }, []);
  return (
    <li ref={ref} class="run" data-depth={run.depth} style={{ marginLeft: `${run.depth * 16}px` }}>
      <span data-part="summary" class="run-summary">{run.summary}</span>
      <span data-part="detail" class="run-detail muted">{run.detail}</span>
    </li>
  );
}

function StaleDialog({ onLoadLatest, onKeep, close }: { onLoadLatest: () => void; onKeep: () => void; close: () => void }) {
  return (
    <Dialog label="This task changed" onClose={close} class="dialog-small">
      <h2>This task changed</h2>
      <p>Someone saved this task after you opened it.</p>
      <div class="dialog-actions">
        <Pill onClick={() => { onLoadLatest(); close(); }}>Load latest</Pill>
        <Pill kind="outline" onClick={() => { onKeep(); close(); }}>Keep my edit</Pill>
      </div>
    </Dialog>
  );
}

function DecideDialog({ task, close, onDecided }: { task: TaskDetail; close: () => void; onDecided: (text: string) => void }) {
  const [decision, setDecision] = useState("");
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  const submit = (event: Event) => {
    event.preventDefault();
    void run(async () => {
      const result = await api<{ status: string }>("POST", `/api/tasks/${task.id}/decision`, { decision, comment });
      setErrors(result.errors);
      if (result.ok) {
        const text = result.data.status === "approved" ? "Approved" : result.data.status === "rejected" ? "Rejected" : "Changes requested";
        close();
        onDecided(text);
      } else if (!Object.keys(result.errors).length) toast(SAVE_FAILED);
    });
  };
  return (
    <Dialog label={`Decide on ${task.name}`} onClose={close}>
      <form onSubmit={submit} noValidate>
        <h2>{`Decide on ${task.name}`}</h2>
        <fieldset class="radio-column">
          <legend class="sr-only">Decision</legend>
          {([["approve", "Approve"], ["request_changes", "Request changes"], ["reject", "Reject"]] as const).map(([value, label]) => (
            <label key={value} class="check-row">
              <input type="radio" name="decision" checked={decision === value} onChange={() => setDecision(value)} />
              <span>{label}</span>
            </label>
          ))}
          <FieldError id="decision-error" text={errors.decision} />
        </fieldset>
        <div class="field">
          <label for="decision-comment">Comment</label>
          <textarea id="decision-comment" rows={3} value={comment} aria-invalid={errors.comment ? "true" : undefined}
            aria-describedby={errors.comment ? "decision-comment-error" : undefined} onInput={(e) => setComment((e.target as HTMLTextAreaElement).value)} />
          <FieldError id="decision-comment-error" text={errors.comment} />
        </div>
        <div class="dialog-actions">
          <Pill type="submit" busy={busy} onClick={submit}>Submit decision</Pill>
          <Pill kind="outline" onClick={close}>Cancel</Pill>
        </div>
      </form>
    </Dialog>
  );
}

export { DecideDialog };

export function Detail({ taskId, project, me, data, onClose, onDeleted }: Props) {
  const detail = useResource<TaskDetail | "gone">(async () => {
    const result = await get<TaskDetail>(`/api/tasks/${taskId}`);
    if (result.status === 404) return "gone";
    return result.ok ? result.data : undefined;
  }, [taskId], (e) => e.task === taskId || (e.t === "tasks" && (e.ids as string[] | undefined)?.includes(taskId) === true)
    || (e.t === "tasks" && (e.deleted as string[] | undefined)?.includes(taskId) === true) || e.t === "structure");
  const known = useRef<Set<string> | null>(null);
  const runs = useResource<{ runs: RuleRun[]; fresh: Set<string> }>(async () => {
    const result = await get<{ runs: RuleRun[] }>(`/api/tasks/${taskId}/rule-runs`);
    if (!result.ok) return undefined;
    const seen = known.current;
    const fresh = new Set(seen ? result.data.runs.filter((r) => !seen.has(r.id)).map((r) => r.id) : []);
    known.current = new Set(result.data.runs.map((r) => r.id));
    return { runs: result.data.runs, fresh };
  }, [taskId], (e) => e.t === "tasks" && (e.runs as string[] | undefined)?.includes(taskId) === true);

  const task = detail.data && detail.data !== "gone" ? detail.data : null;
  const [draft, setDraft] = useState({ name: "", description: "" });
  const [dirty, setDirty] = useState({ name: false, description: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [approver, setApprover] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, runUpload] = useBusy();
  const [requesting, runRequest] = useBusy();
  const holding = useRef<Record<string, boolean>>({});
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const fileInput = useRef<HTMLInputElement>(null);

  useMount(() => viewTask(taskId), [taskId]);
  useMount(() => {
    known.current = null;
    return () => {
      for (const field of ["name", "description"]) {
        if (holding.current[field]) void api("DELETE", `/api/tasks/${taskId}/hold`, { field });
      }
    };
  }, [taskId]);
  useMount(() => {
    const timer = setInterval(() => {
      for (const field of ["name", "description"]) if (holding.current[field]) void api("POST", `/api/tasks/${taskId}/hold`, { field });
    }, Math.max(1000, configStore.get().holdTimeoutMs / 3));
    return () => clearInterval(timer);
  }, [taskId]);

  useLive((event) => {
    if (event.t === "tasks" && (event.deleted as string[] | undefined)?.includes(taskId)) onClose();
  });

  useMount(() => {
    if (!task) return;
    setDraft((d) => ({
      name: dirtyRef.current.name ? d.name : task.name,
      description: dirtyRef.current.description ? d.description : task.description,
    }));
  }, [task?.name, task?.description, task?.id]);

  if (detail.data === "gone") {
    queueMicrotask(onClose);
    return null;
  }
  if (!task || !runs.data) return <div class="detail-body"><p class="muted">Loading</p></div>;

  const heldBy = (field: string) => task.holds.find((h) => h.field === field && h.holder.id !== me.id)?.holder.name;
  const field = (name: "name" | "description") => ({
    value: draft[name],
    readOnly: !!heldBy(name),
    "aria-readonly": heldBy(name) ? ("true" as const) : ("false" as const),
    onInput: (e: Event) => {
      setDraft({ ...draft, [name]: (e.target as HTMLInputElement).value });
      setDirty({ ...dirty, [name]: true });
    },
    onFocus: () => {
      if (heldBy(name)) return;
      void api("POST", `/api/tasks/${taskId}/hold`, { field: name }).then((r) => {
        if (r.ok) holding.current[name] = true;
        else detail.reload();
      });
    },
    onBlur: () => {
      if (!dirtyRef.current[name] && holding.current[name]) {
        holding.current[name] = false;
        void api("DELETE", `/api/tasks/${taskId}/hold`, { field: name });
      }
    },
  });

  const applyServer = (saved: Task) => {
    data.setTasks((all) => all.map((t) => (t.id === saved.id ? { ...saved, blocks: saved.blocks ?? t.blocks } : t)));
    detail.reload();
  };

  const saveText = async (name: "name" | "description", version = task.version) => {
    const result = await api<Task>("PATCH", `/api/tasks/${taskId}`, { version, [name]: draft[name] });
    if (result.ok) {
      holding.current[name] = false;
      setDirty({ ...dirtyRef.current, [name]: false });
      setErrors({ ...errors, [name]: "" });
      applyServer(result.data);
      return;
    }
    if (result.status === 409 && result.code === "stale_task") {
      const latest = (result.data as unknown as { latest: number }).latest;
      openModal((close) => (
        <StaleDialog close={close}
          onKeep={() => void saveText(name, latest)}
          onLoadLatest={() => void loadLatest(name)} />
      ));
      return;
    }
    if (result.status === 409) return void detail.reload();
    if (result.errors[name]) setErrors({ ...errors, [name]: result.errors[name] });
    else toast(SAVE_FAILED);
  };

  const loadLatest = async (name: "name" | "description") => {
    const latest = await get<TaskDetail>(`/api/tasks/${taskId}`);
    if (!latest.ok) return;
    detail.set(latest.data);
    setDraft((d) => ({ ...d, [name]: latest.data[name] }));
    setDirty({ ...dirtyRef.current, [name]: false });
  };

  const saveOther = (patch: Record<string, unknown>, optimistic?: (t: Task) => Partial<Task>) => {
    void data.save(task.id, patch, optimistic ? (all) => all.map((t) => (t.id === task.id ? { ...t, ...optimistic(t) } : t)) : undefined)
      .then((result) => {
        if (result && !result.ok && result.errors) setErrors((e) => ({ ...e, ...result.errors }));
        detail.reload();
      });
  };

  const upload = (file: File) => void runUpload(async () => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: form, credentials: "same-origin" });
    if (response.ok) {
      setUploadError("");
      outageStore.set(false);
      detail.reload();
    } else if (response.status === 413) {
      const limit = Number(response.headers.get("x-upload-limit-bytes"));
      setUploadError(`File is larger than ${megabytes(limit)}`);
    } else if (response.status === 503) {
      setUploadError("Attachment failed: file storage is unavailable. Nothing was saved.");
      outageStore.set(true);
    } else setUploadError(SAVE_FAILED);
  });

  const requestApproval = () => void runRequest(async () => {
    const result = await api("POST", `/api/tasks/${taskId}/approval`, { approverId: approver });
    if (result.ok) announce("Approval status", "Approval requested");
    else setErrors({ ...errors, approverId: result.errors.approverId ?? "" });
    detail.reload();
  });

  const approval = task.approval;
  const pending = approval.status === "requested";
  const customFields: Field[] = project.fields;
  const decide = () => openModal((close) => (
    <DecideDialog task={task} close={close} onDecided={(text) => { announce("Approval status", `Decision saved: ${text}`); detail.reload(); }} />
  ));

  return (
    <div class="detail-body">
      <header class="detail-head">
        <h2 class="detail-title">{task.name}</h2>
        <button type="button" class="icon-button round" aria-label="Close task" onClick={onClose}><Icon name="x" size={20} /></button>
      </header>
      <div class="detail-actions">
        <Pill kind="danger" onClick={() => openModal((close) => (
          <ConfirmDelete name={task.name} close={close} onConfirm={async () => {
            const result = await api("DELETE", `/api/tasks/${task.id}`);
            if (!result.ok) return void toast(SAVE_FAILED);
            announce("List status", "Task deleted");
            const removed = data.bundle?.tasks.find((t) => t.id === task.id) ?? (task as unknown as Task);
            return () => onDeleted(removed);
          }} />
        ))}>Delete task</Pill>
      </div>

      <div class="field">
        <label for="detail-name">Name</label>
        <input id="detail-name" type="text" {...field("name")} aria-invalid={errors.name ? "true" : undefined}
          aria-describedby={errors.name ? "detail-name-error" : undefined} />
        {heldBy("name") && <p class="hold-note">{`Being edited by ${heldBy("name")}`}</p>}
        <FieldError id="detail-name-error" text={errors.name} />
        <Pill kind="outline" onClick={() => void saveText("name")}>Save name</Pill>
      </div>
      <div class="field">
        <label for="detail-description">Description</label>
        <textarea id="detail-description" rows={3} {...field("description")} />
        {heldBy("description") && <p class="hold-note">{`Being edited by ${heldBy("description")}`}</p>}
        <Pill kind="outline" onClick={() => void saveText("description")}>Save description</Pill>
      </div>

      <div class="detail-grid">
        <div class="field">
          <label for="detail-assignee">Assignee</label>
          <select id="detail-assignee" value={task.assigneeId ?? ""} onChange={(e) => {
            const value = (e.target as HTMLSelectElement).value || null;
            saveOther({ assigneeId: value }, () => ({ assigneeId: value }));
          }}>
            <option value="">Unassigned</option>
            {project.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {([["start", "Start"], ["due", "Due"]] as const).map(([key, label]) => (
          <div class="field" key={key}>
            <label for={`detail-${key}`}>{label}</label>
            <input id={`detail-${key}`} type="text" placeholder="YYYY-MM-DD" defaultValue={task[key] ?? ""} key={`${key}-${task[key]}`}
              aria-invalid={errors[key] ? "true" : undefined} aria-describedby={errors[key] ? `detail-${key}-error` : undefined}
              onChange={(e) => {
                const value = (e.target as HTMLInputElement).value.trim() || null;
                setErrors({ ...errors, [key]: "" });
                saveOther({ [key]: value }, () => ({ [key]: value }));
              }} />
            <FieldError id={`detail-${key}-error`} text={errors[key]} />
          </div>
        ))}
        <div class="field">
          <label for="detail-effort">Effort</label>
          <input id="detail-effort" type="text" inputMode="decimal" defaultValue={task.effort === null ? "" : String(task.effort)} key={`effort-${task.effort}`}
            aria-invalid={errors.effort ? "true" : undefined} aria-describedby={errors.effort ? "detail-effort-error" : undefined}
            onChange={(e) => {
              const raw = (e.target as HTMLInputElement).value.trim();
              const value = raw === "" ? null : Number(raw);
              if (value !== null && Number.isNaN(value)) return setErrors({ ...errors, effort: "Effort must be 0 or more hours" });
              setErrors({ ...errors, effort: "" });
              saveOther({ effort: value }, () => ({ effort: value }));
            }} />
          <FieldError id="detail-effort-error" text={errors.effort} />
        </div>
        {customFields.map((f) => {
          const value = task.values[f.name];
          if (f.type === "formula") {
            return <div class="field" key={f.id}><span class="label">{f.name}</span><output class="num formula-output">{value === null || value === undefined || value === "" ? "blank" : String(value)}</output></div>;
          }
          if (f.type === "multi_select") {
            const chosen = Array.isArray(value) ? value : [];
            return (
              <fieldset class="field check-list" key={f.id}>
                <legend>{f.name}</legend>
                {f.options.map((o) => (
                  <label key={o} class="check-row">
                    <input type="checkbox" checked={chosen.includes(o)} onChange={() => {
                      const next = chosen.includes(o) ? chosen.filter((c) => c !== o) : [...chosen, o];
                      saveOther({ values: { [f.name]: next } });
                    }} />
                    <span>{o}</span>
                  </label>
                ))}
              </fieldset>
            );
          }
          if (f.type === "single_select") {
            return (
              <div class="field" key={f.id}>
                <label for={`detail-field-${f.id}`}>{f.name}</label>
                <select id={`detail-field-${f.id}`} value={typeof value === "string" ? value : ""} onChange={(e) => saveOther({ values: { [f.name]: (e.target as HTMLSelectElement).value || null } })}>
                  <option value="">None</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            );
          }
          return (
            <div class="field" key={f.id}>
              <label for={`detail-field-${f.id}`}>{f.name}</label>
              <input id={`detail-field-${f.id}`} type="text" defaultValue={value === null || value === undefined ? "" : String(value)} key={`${f.id}-${String(value)}`}
                onChange={(e) => {
                  const raw = (e.target as HTMLInputElement).value.trim();
                  saveOther({ values: { [f.name]: raw === "" ? null : f.type === "number" ? Number(raw) : raw } });
                }} />
            </div>
          );
        })}
      </div>

      <section class="detail-section" aria-labelledby="approval-title">
        <h3 id="approval-title">Approval</h3>
        {approval.status && <span class={`status-chip chip-${approval.status}`}>{CHIP[approval.status]}</span>}
        <Status name="Approval status" />
        {pending && approval.approverId === me.id && <Pill onClick={decide}>Decide</Pill>}
        {!pending && (
          <div class="approval-request">
            <label for="detail-approver">Approver</label>
            <select id="detail-approver" value={approver} onChange={(e) => setApprover((e.target as HTMLSelectElement).value)}>
              <option value="">Choose an approver</option>
              {project.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <Pill kind="outline" busy={requesting} onClick={requestApproval}>Request approval</Pill>
            <FieldError id="approver-error" text={errors.approverId} />
          </div>
        )}
      </section>

      <section class="detail-section" aria-labelledby="viewing-title">
        <h3 id="viewing-title">Viewing now</h3>
        <ul class="plain-list" aria-label="Viewing now">{task.viewing.map((v) => <li key={v.id}>{v.name}</li>)}</ul>
      </section>

      <section class="detail-section" aria-labelledby="runs-title">
        <h3 id="runs-title">Rule runs</h3>
        <ul class="run-list plain-list" aria-label="Rule runs">
          {runs.data.runs.map((run) => <RunEntry key={run.id} run={run} fresh={runs.data!.fresh.has(run.id)} />)}
        </ul>
        {runs.data.runs.length === 0 && <p class="muted">No rules have run on this task.</p>}
      </section>

      <section class="detail-section" aria-labelledby="history-title">
        <h3 id="history-title">History</h3>
        <ul class="plain-list history-list" aria-label="History">
          {task.history.map((h, i) => <li key={`${h.createdAt}-${i}`}>{h.text}<span class="muted num"> {h.createdAt.slice(0, 16).replace("T", " ")}</span></li>)}
        </ul>
      </section>

      <section class="detail-section" aria-labelledby="attachments-title">
        <h3 id="attachments-title">Attachments</h3>
        <ul class="plain-list" aria-label="Attachments">
          {task.attachments.map((a) => <li key={a.id}><a href={`/api/attachments/${a.id}`} download>{a.name}</a> <span class="muted num">{a.size} bytes</span></li>)}
        </ul>
        {uploadError && <p role="alert" class="upload-alert">{uploadError}</p>}
        <input ref={fileInput} type="file" class="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => {
          const input = e.target as HTMLInputElement;
          const file = input.files?.[0];
          input.value = "";
          if (file) upload(file);
        }} />
        <Pill kind="outline" busy={uploading} onClick={() => fileInput.current?.click()}><Icon name="paperclip" size={18} />Attach file</Pill>
      </section>

    </div>
  );
}
