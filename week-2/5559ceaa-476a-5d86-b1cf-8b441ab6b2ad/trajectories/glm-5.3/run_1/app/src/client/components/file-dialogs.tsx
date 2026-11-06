import { useRef, useState } from "react";
import { api, ApiCallError } from "../lib/api";
import { Dialog } from "./dialogs";
import type { FileWithContent } from "../workspace/state";

export function NewFileDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (file: FileWithContent) => void;
}): React.ReactElement {
  const [path, setPath] = useState("");
  const [pending, setPending] = useState(false);
  const create = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await api<{ file: FileWithContent }>("POST", `/api/projects/${projectId}/files`, {
        path,
        content: "",
      });
      if (res.data?.file) onCreated(res.data.file);
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog label="New file" onClose={onClose}>
      <h2>New file</h2>
      <label htmlFor="new-file-path">File path</label>
      <input id="new-file-path" value={path} onChange={(e) => setPath(e.target.value)} />
      <button onClick={() => void create()} disabled={pending}>
        Create file
      </button>
    </Dialog>
  );
}

export function RenameFileDialog({
  projectId,
  file,
  onClose,
  onRenamed,
}: {
  projectId: string;
  file: FileWithContent;
  onClose: () => void;
  onRenamed: (file: FileWithContent) => void;
}): React.ReactElement {
  const [path, setPath] = useState(file.path);
  const [pending, setPending] = useState(false);
  const save = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await api<{ file: FileWithContent }>("PATCH", `/api/projects/${projectId}/files/${file.id}`, {
        path,
      });
      if (res.data?.file) onRenamed(res.data.file);
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog label="Rename" onClose={onClose}>
      <h2>Rename</h2>
      <label htmlFor="rename-path">New path</label>
      <input id="rename-path" value={path} onChange={(e) => setPath(e.target.value)} />
      <button onClick={() => void save()} disabled={pending}>
        Save name
      </button>
    </Dialog>
  );
}

export function RenameFolderDialog({
  projectId,
  from,
  onClose,
  onRenamed,
}: {
  projectId: string;
  from: string;
  onClose: () => void;
  onRenamed: () => void;
}): React.ReactElement {
  const [to, setTo] = useState(from);
  const [pending, setPending] = useState(false);
  const save = async () => {
    if (pending) return;
    setPending(true);
    try {
      await api("POST", `/api/projects/${projectId}/folders/rename`, { from, to });
      onRenamed();
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog label="Rename" onClose={onClose}>
      <h2>Rename</h2>
      <p className="mono">{from}</p>
      <label htmlFor="rename-folder-path">New path</label>
      <input id="rename-folder-path" value={to} onChange={(e) => setTo(e.target.value)} />
      <button onClick={() => void save()} disabled={pending}>
        Save name
      </button>
    </Dialog>
  );
}

export function DeleteDialog({
  file,
  onClose,
  onDelete,
}: {
  file: FileWithContent;
  onClose: () => void;
  onDelete: () => void;
}): React.ReactElement {
  return (
    <div className="dialog-backdrop destructive" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div
        ref={(node) => {
          const cancel = node?.querySelector<HTMLElement>('[data-autofocus="cancel"]');
          cancel?.focus();
        }}
        role="alertdialog"
        aria-modal="true"
        aria-label={`Delete ${file.path}?`}
        className="dialog"
      >
        <h2>Delete {file.path}?</h2>
        <p>Deleting removes the file from the project.</p>
        <div className="dialog-actions">
          <button data-autofocus="cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

interface PlanEntry {
  path: string;
  status: string;
  file_id: string | null;
}

export function ImportDialog({
  projectId,
  onClose,
  onPlanned,
}: {
  projectId: string;
  onClose: () => void;
  onPlanned: (plan: {
    id: string;
    entries: PlanEntry[];
    only_in_project: string[];
    ignored: string[];
  } | null, status: string) => void;
}): React.ReactElement {
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const check = async () => {
    const input = inputRef.current;
    const file = input?.files?.[0];
    if (!file || pending) return;
    setPending(true);
    try {
      const bytes = await file.arrayBuffer();
      const res = await api<{
        import: { id: string; entries: PlanEntry[]; only_in_project: string[]; ignored: string[] };
      }>("POST", `/api/projects/${projectId}/imports`, bytes, { "Content-Type": "application/zip" });
      const plan = res.data?.import;
      if (plan) {
        const counts = countBy(plan.entries);
        onPlanned(plan, `${counts.new} new, ${counts.changed} changed, ${counts.unchanged} unchanged, ${plan.only_in_project.length} only in the project.`);
      }
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === "import_rejected") {
          const entries = (err.extra["entries"] as { path: string; reason: string; limit?: number }[]) ?? [];
          const lines = entries.map((e) => `${e.path} — ${reasonText(e.reason, e.limit)}`);
          onPlanned(null, `Zip rejected: ${entries.length} problem(s) found. Nothing was imported. ${lines.join(" ")}`);
        } else if (err.code === "too_large") {
          onPlanned(null, `The zip is over the upload limit of ${String(err.extra["limit_bytes"])} bytes.`);
        } else if (err.code === "storage_unavailable") {
          onPlanned(null, "Storage is unreachable, so zips can't be imported right now.");
        } else {
          onPlanned(null, "Something went wrong. Try again.");
        }
      } else {
        onPlanned(null, "Something went wrong. Try again.");
      }
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog label="Import zip" onClose={onClose}>
      <h2>Import zip</h2>
      <p className="limits mono">Zips up to 5,000,000 bytes, 500 entries, 1,000,000 bytes per file and 20,000,000 bytes in total; text files only.</p>
      <label htmlFor="starter-zip">Starter zip</label>
      <input id="starter-zip" type="file" ref={inputRef} />
      <button onClick={() => void check()} disabled={pending}>
        Check zip
      </button>
    </Dialog>
  );
}

export function ReviewImportDialog({
  plan,
  onClose,
  onApplied,
}: {
  projectId: string;
  plan: { id: string; entries: PlanEntry[]; only_in_project: string[]; ignored: string[] };
  onClose: () => void;
  onApplied: (summary: string) => void;
}): React.ReactElement {
  const changed = plan.entries.filter((e) => e.status === "changed");
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const apply = async () => {
    if (pending) return;
    setPending(true);
    const payload: Record<string, string> = {};
    for (const c of changed) payload[c.path] = decisions[c.path] ?? "keep";
    try {
      const res = await api<{ import: { added: number; replaced: number; kept: number } }>(
        "POST",
        `/api/imports/${plan.id}/apply`,
        { decisions: payload },
      );
      const i = res.data?.import;
      onApplied(`Import applied: ${i?.added ?? 0} added, ${i?.replaced ?? 0} replaced, ${i?.kept ?? 0} kept.`);
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === "import_plan_expired") onApplied("This zip check has expired. Upload it again.");
        else if (err.code === "import_plan_stale") onApplied("Files changed since this zip was checked. Upload it again.");
        else if (err.code === "import_already_applied") onApplied("This import was already applied.");
        else if (err.code === "session_in_progress") onApplied("Imports are applied between sessions.");
        else onApplied("Something went wrong. Try again.");
      } else {
        onApplied("Something went wrong. Try again.");
      }
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog label="Review import" onClose={onClose} wide>
      <h2>Review import</h2>
      {changed.map((c) => (
        <fieldset key={c.path}>
          <legend>{c.path}</legend>
          <div role="radiogroup" aria-label={c.path}>
            <label>
              <input
                type="radio"
                name={`decision-${c.path}`}
                checked={(decisions[c.path] ?? "keep") === "keep"}
                onChange={() => setDecisions((d) => ({ ...d, [c.path]: "keep" }))}
              />
              Keep student's
            </label>
            <label>
              <input
                type="radio"
                name={`decision-${c.path}`}
                checked={decisions[c.path] === "replace"}
                onChange={() => setDecisions((d) => ({ ...d, [c.path]: "replace" }))}
              />
              Replace with zip
            </label>
          </div>
        </fieldset>
      ))}
      <h3>New files</h3>
      <ul aria-label="New files" className="mono">
        {plan.entries.filter((e) => e.status === "new").map((e) => (
          <li key={e.path}>{e.path}</li>
        ))}
      </ul>
      <h3>Only in project</h3>
      <ul aria-label="Only in project" className="mono">
        {plan.only_in_project.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <button onClick={() => void apply()} disabled={pending}>
        Apply import
      </button>
    </Dialog>
  );
}

function countBy(entries: PlanEntry[]): { new: number; changed: number; unchanged: number } {
  return {
    new: entries.filter((e) => e.status === "new").length,
    changed: entries.filter((e) => e.status === "changed").length,
    unchanged: entries.filter((e) => e.status === "unchanged").length,
  };
}

function reasonText(reason: string, limit?: number): string {
  const map: Record<string, string> = {
    path_traversal: "leaves the project folder",
    absolute_path: "uses an absolute path",
    path_too_long: "has a path over 255 characters",
    symlink: "is a symbolic link",
    disallowed_type: "is not an allowed file type",
    content_mismatch: "isn't readable text",
    unsafe_svg: "contains script",
    duplicate_path: "appears more than once",
    file_too_large: `is over the per-file limit of ${limit ?? 1000000} bytes`,
    total_too_large: `brings the total over ${limit ?? 20000000} bytes`,
    too_many_entries: `has more than ${limit ?? 500} entries`,
    ratio_exceeded: `expands more than ${limit ?? 100} times its packed size`,
    not_a_zip: "isn't a zip archive",
  };
  return map[reason] ?? reason;
}
