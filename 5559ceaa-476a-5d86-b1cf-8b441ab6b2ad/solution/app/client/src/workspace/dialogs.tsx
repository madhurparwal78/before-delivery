import { useEffect, useRef, useState } from "react";
import { api, newKey, Refusal, UNEXPECTED } from "../api";
import { Dialog } from "../dialog";
import { EMAIL_ERROR, validEmail } from "../pages/auth";
import type { FileMeta, ImportPlan, Member, Project, Session } from "../types";

const NAME_ERROR = "Enter the learner's name (1 to 80 characters).";

export function MembersDialog({
  open,
  onClose,
  project,
  members,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  members: Member[];
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<{ text: string; chip?: string }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Member | null>(null);
  const [rows, setRows] = useState<Member[]>(members);
  const emailField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    api<{ project: Project }>(`/api/projects/${project.id}`)
      .then((r) => setRows(r.project.members))
      .catch(() => undefined);
  }, [open, project.id]);

  useEffect(() => {
    setRows((current) => {
      const known = new Map(current.map((m) => [m.user_id, m]));
      return members.map((m) => ({ ...m, email_status: known.get(m.user_id)?.email_status ?? m.email_status }));
    });
  }, [members]);

  const invite = async () => {
    const fields: string[] = [];
    if (!validEmail(email)) fields.push(EMAIL_ERROR);
    if (name.trim().length < 1 || [...name.trim()].length > 80) fields.push(NAME_ERROR);
    if (fields.length) return setStatus({ text: fields.join(" ") });
    setBusy(true);
    setStatus({ text: "Sending invite…" });
    try {
      const r = await api<{ invite: { email: string; email_status: "sent" | "queued" }; member: Member }>(
        `/api/projects/${project.id}/invites`,
        { method: "POST", body: { email: email.trim(), name: name.trim() }, headers: { "Idempotency-Key": newKey() } },
      );
      setStatus({ text: `Invite recorded for ${r.invite.email}.`, chip: r.invite.email_status === "sent" ? "Email sent" : "Email queued" });
      setRows((list) => (list.some((m) => m.user_id === r.member.user_id) ? list.map((m) => (m.user_id === r.member.user_id ? r.member : m)) : [...list, r.member]));
      setEmail("");
      setName("");
      emailField.current?.focus();
    } catch (error) {
      const code = error instanceof Refusal ? error.code : "";
      const fields = error instanceof Refusal ? (error.body.fields as Record<string, string> | undefined) : undefined;
      setStatus({
        text:
          code === "seat_taken"
            ? "This one-to-one project already has a learner. Remove them first."
            : code === "group_full"
              ? "This group already has six learners."
              : code === "validation"
                ? [fields?.email ? EMAIL_ERROR : "", fields?.name ? NAME_ERROR : ""].filter(Boolean).join(" ") || UNEXPECTED
                : UNEXPECTED,
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: Member) => {
    setConfirming(null);
    setStatus({ text: `Removing ${member.name}…` });
    try {
      await api(`/api/projects/${project.id}/members/${member.user_id}`, { method: "DELETE" });
      setRows((list) => list.filter((m) => m.user_id !== member.user_id));
      setStatus({ text: `${member.name} was removed. Their access has ended.` });
    } catch {
      setStatus({ text: UNEXPECTED });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Members" wide>
      <form
        className="dialog-body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void invite();
        }}
      >
        <p className="dialog-copy">
          {project.kind === "group" ? "A group holds up to six learners." : "A one-to-one project holds one learner."} Each invite
          sends one email with a sign-in link to this project.
        </p>
        <div className="field-row">
          <label className="field">
            <span>Learner email</span>
            <input ref={emailField} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">
            <span>Learner name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={120} />
          </label>
        </div>
        <div className="dialog-actions dialog-actions-start">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            Send invite
          </button>
        </div>
        <p role="status" aria-label="Members status" className="region">
          {status.text}
          {status.chip && <span className="chip">{status.chip}</span>}
        </p>
        <ul aria-label="Members" className="member-list">
          {rows.map((m) => (
            <li key={m.user_id} className="member-row">
              <span className="member-name">{m.name}</span>
              <span className="member-role">{m.role === "mentor" ? "Mentor" : "Student"}</span>
              {m.email_status === "queued" && <span className="chip">Email queued</span>}
              {m.role === "student" && (
                <button type="button" className="button button-quiet" onClick={() => setConfirming(m)}>
                  Remove <span className="visually-hidden">{m.name}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </form>
      <Dialog open={confirming !== null} onClose={() => setConfirming(null)} title={`Remove ${confirming?.name ?? ""}?`} role="alertdialog" destructive>
        <div className="dialog-body">
          <p className="dialog-copy">They lose access straight away, including any open session.</p>
          <div className="dialog-actions">
            <button type="button" className="button" data-cancel onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button type="button" className="button button-danger" onClick={() => confirming && void remove(confirming)}>
              Remove
            </button>
          </div>
        </div>
      </Dialog>
    </Dialog>
  );
}

function parseLocal(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number) as [number, number, number, number, number, number];
  const when = new Date(y, m - 1, d, h, min);
  return Number.isNaN(when.getTime()) ? null : when;
}

export function ScheduleDialog({ open, onClose, projectId, onScheduled }: { open: boolean; onClose: () => void; projectId: string; onScheduled: (s: Session) => void }) {
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    const when = parseLocal(startsAt);
    if (!title.trim() || [...title.trim()].length > 80) return setError("Give the session a title of 1 to 80 characters.");
    if (!when) return setError("Enter a start time like 2026-11-02 16:30.");
    try {
      const r = await api<{ session: Session }>(`/api/projects/${projectId}/sessions`, {
        method: "POST",
        body: { title: title.trim(), scheduled_for: when.toISOString() },
      });
      onScheduled(r.session);
      setTitle("");
      setStartsAt("");
      setError("");
      onClose();
    } catch {
      setError(UNEXPECTED);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Schedule session">
      <form
        className="dialog-body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>Session title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </label>
        <label className="field">
          <span>Starts at</span>
          <input type="text" inputMode="numeric" placeholder="2026-11-02 16:30" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="dialog-actions">
          <button type="submit" className="button button-primary">
            Schedule
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function fileFailure(error: unknown): string {
  if (!(error instanceof Refusal)) return UNEXPECTED;
  if (error.code === "path_taken") return "A file already exists at that path.";
  if (error.code === "validation") {
    const fields = (error.body.fields ?? {}) as Record<string, string>;
    return Object.values(fields).join(" ") || UNEXPECTED;
  }
  if (error.code === "not_driver") return "Only the driver can change files during a live session.";
  if (error.code === "session_paused") return "Session paused — editing resumes when the mentor resumes.";
  return UNEXPECTED;
}

export function NewFileDialog({ open, onClose, projectId, onCreated }: { open: boolean; onClose: () => void; projectId: string; onCreated: (f: FileMeta) => void }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    try {
      const r = await api<{ file: FileMeta }>(`/api/projects/${projectId}/files`, { method: "POST", body: { path: path.trim(), content: "" } });
      setPath("");
      setError("");
      onClose();
      onCreated(r.file);
    } catch (failure) {
      setError(fileFailure(failure));
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="New file">
      <form
        className="dialog-body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>File path</span>
          <input className="mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="src/app.js" spellCheck={false} />
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="dialog-actions">
          <button type="submit" className="button button-primary">
            Create file
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export type RenameTarget = { kind: "file"; id: string; path: string } | { kind: "folder"; path: string };

export function RenameDialog({ target, onClose, projectId }: { target: RenameTarget | null; onClose: () => void; projectId: string }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (target) {
      setPath(target.path);
      setError("");
    }
  }, [target]);
  const submit = async () => {
    if (!target) return;
    try {
      if (target.kind === "file") {
        await api(`/api/projects/${projectId}/files/${target.id}`, { method: "PATCH", body: { path: path.trim() } });
      } else {
        await api(`/api/projects/${projectId}/folders/rename`, { method: "POST", body: { from: target.path, to: path.trim() } });
      }
      onClose();
    } catch (failure) {
      setError(fileFailure(failure));
    }
  };
  return (
    <Dialog open={target !== null} onClose={onClose} title="Rename">
      <form
        className="dialog-body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>New path</span>
          <input className="mono" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} />
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="dialog-actions">
          <button type="submit" className="button button-primary">
            Save name
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteDialog({ file, onClose, projectId }: { file: FileMeta | null; onClose: () => void; projectId: string }) {
  const [error, setError] = useState("");
  const last = useRef<FileMeta | null>(null);
  if (file) last.current = file;
  const remove = async () => {
    if (!file) return;
    try {
      await api(`/api/projects/${projectId}/files/${file.id}`, { method: "DELETE" });
      setError("");
      onClose();
    } catch (failure) {
      setError(fileFailure(failure));
    }
  };
  return (
    <Dialog open={file !== null} onClose={onClose} title={`Delete ${last.current?.path ?? ""}?`} role="alertdialog" destructive>
      <div className="dialog-body">
        <p className="dialog-copy">The file leaves the project. Checkpoints that hold it keep their copy.</p>
        {error && <p className="field-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="button" data-cancel onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button-danger" onClick={() => void remove()}>
            Delete
          </button>
        </div>
      </div>
    </Dialog>
  );
}

const REASONS: Record<string, (limit?: number) => string> = {
  path_traversal: () => "leaves the project folder",
  absolute_path: () => "uses an absolute path",
  path_too_long: () => "has a path over 255 characters",
  symlink: () => "is a symbolic link",
  disallowed_type: () => "is not an allowed file type",
  content_mismatch: () => "isn't readable text",
  unsafe_svg: () => "contains script",
  duplicate_path: () => "appears more than once",
  file_too_large: (limit) => `is over the per-file limit of ${limit} bytes`,
  total_too_large: (limit) => `brings the total over ${limit} bytes`,
  too_many_entries: (limit) => `has more than ${limit} entries`,
  ratio_exceeded: (limit) => `expands more than ${limit} times its packed size`,
  not_a_zip: () => "isn't a zip archive",
};

export interface ImportReport {
  text: string;
  lines?: string[];
}

export function ImportDialog({
  open,
  onClose,
  projectId,
  onReport,
  onPlanned,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onReport: (report: ImportReport) => void;
  onPlanned: (plan: ImportPlan) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const check = async () => {
    if (!file) return onReport({ text: "Choose a zip to check." });
    setBusy(true);
    onReport({ text: "Checking the zip…" });
    try {
      const r = await api<{ import: ImportPlan }>(`/api/projects/${projectId}/imports`, {
        method: "POST",
        raw: file,
        contentType: "application/zip",
      });
      const plan = r.import;
      const count = (status: string) => plan.entries.filter((e) => e.status === status).length;
      onReport({ text: `${count("new")} new, ${count("changed")} changed, ${count("unchanged")} unchanged, ${plan.only_in_project.length} only in the project.` });
      onPlanned(plan);
    } catch (error) {
      const code = error instanceof Refusal ? error.code : "";
      if (code === "import_rejected" && error instanceof Refusal) {
        const entries = (error.body.entries ?? []) as Array<{ path: string; reason: string; limit?: number }>;
        onReport({
          text: `Zip rejected: ${entries.length} problem(s) found. Nothing was imported.`,
          lines: entries.map((e) => `${e.path} — ${(REASONS[e.reason] ?? (() => e.reason))(e.limit)}`),
        });
      } else if (code === "too_large" && error instanceof Refusal) {
        onReport({ text: `The zip is over the upload limit of ${String(error.body.limit_bytes)} bytes.` });
      } else if (code === "storage_unavailable") {
        onReport({ text: "Storage is unreachable, so zips can't be imported right now." });
      } else {
        onReport({ text: UNEXPECTED });
      }
      onClose();
    } finally {
      setBusy(false);
      setFile(null);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Import zip">
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void check();
        }}
      >
        <p className="dialog-copy">
          Zips up to 5,000,000 bytes, 500 entries, 1,000,000 bytes per file and 20,000,000 bytes in total; text files only.
        </p>
        <label className="field">
          <span>Starter zip</span>
          <input ref={input} type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            Check zip
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const APPLY_ERRORS: Record<string, string> = {
  import_plan_expired: "This zip check has expired. Upload it again.",
  import_plan_stale: "Files changed since this zip was checked. Upload it again.",
  import_already_applied: "This import was already applied.",
  session_in_progress: "Imports are applied between sessions.",
  storage_unavailable: "Storage is unreachable, so zips can't be imported right now.",
};

export function ReviewImportDialog({
  plan,
  onClose,
  onReport,
  onApplied,
}: {
  plan: ImportPlan | null;
  onClose: () => void;
  onReport: (report: ImportReport) => void;
  onApplied: (files: FileMeta[]) => void;
}) {
  const [choices, setChoices] = useState<Record<string, "keep" | "replace">>({});
  const [busy, setBusy] = useState(false);
  const last = useRef<ImportPlan | null>(null);
  if (plan) last.current = plan;
  const shown = last.current;
  useEffect(() => {
    if (plan) setChoices(Object.fromEntries(plan.entries.filter((e) => e.status === "changed").map((e) => [e.path, "keep"])));
  }, [plan]);
  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await api<{ import: { added: number; replaced: number; kept: number }; files: FileMeta[] }>(`/api/imports/${plan.id}/apply`, {
        method: "POST",
        body: { decisions: choices },
      });
      onReport({ text: `Import applied: ${r.import.added} added, ${r.import.replaced} replaced, ${r.import.kept} kept.` });
      onApplied(r.files);
    } catch (error) {
      onReport({ text: APPLY_ERRORS[error instanceof Refusal ? error.code : ""] ?? UNEXPECTED });
    } finally {
      setBusy(false);
      onClose();
    }
  };
  const changed = shown?.entries.filter((e) => e.status === "changed") ?? [];
  const added = shown?.entries.filter((e) => e.status === "new") ?? [];
  return (
    <Dialog open={plan !== null} onClose={onClose} title="Review import" wide>
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <h3 className="list-title">Changed in the zip</h3>
        {changed.length === 0 && <p className="dialog-copy">No file differs from the project.</p>}
        {changed.map((entry) => (
          <div key={entry.path} role="radiogroup" aria-label={entry.path} className="decision">
            <span className="mono decision-path">{entry.path}</span>
            <label className="choice">
              <input
                type="radio"
                name={`d-${entry.path}`}
                checked={choices[entry.path] !== "replace"}
                onChange={() => setChoices((c) => ({ ...c, [entry.path]: "keep" }))}
              />
              <span>Keep student's</span>
            </label>
            <label className="choice">
              <input
                type="radio"
                name={`d-${entry.path}`}
                checked={choices[entry.path] === "replace"}
                onChange={() => setChoices((c) => ({ ...c, [entry.path]: "replace" }))}
              />
              <span>Replace with zip</span>
            </label>
          </div>
        ))}
        <h3 className="list-title">New files</h3>
        <ul aria-label="New files" className="path-list">
          {added.length === 0 && <li className="link-empty">None</li>}
          {added.map((e) => (
            <li key={e.path} className="mono">
              {e.path}
            </li>
          ))}
        </ul>
        <h3 className="list-title">Only in project</h3>
        <ul aria-label="Only in project" className="path-list">
          {(shown?.only_in_project ?? []).length === 0 && <li className="link-empty">None</li>}
          {(shown?.only_in_project ?? []).map((p) => (
            <li key={p} className="mono">
              {p}
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            Apply import
          </button>
        </div>
      </form>
    </Dialog>
  );
}
