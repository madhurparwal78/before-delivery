import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";
import { store } from "./store.ts";
import { formatDate, STATUS_EDGES, statusLabel, type Issue, type Person } from "./types.ts";
import { NotFoundDetail, TitleBlock, useInterval } from "./ui.tsx";

// ---------------------------------------------------------------------------
// Pickers: status and assignee, opened by keyboard or click on any row.
// ---------------------------------------------------------------------------

export interface PickerState {
  kind: "status" | "assignee";
  issueKey: string;
  issue: Issue;
  anchorRect: DOMRect;
}

export function statusOptions(issue: Issue): string[] {
  return STATUS_EDGES[issue.status] ?? [];
}

export function assigneeOptions(issue: Issue, members: Person[]): Person[] {
  const eligible = members.filter((m) => m.role === "owner" || m.role === "member" || m.id === issue.assignee_id);
  return [...eligible].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function PickerLayer(props: {
  picker: PickerState | null;
  issue: Issue | null;
  members: Person[];
  onPickStatus: (to: string) => void;
  onPickAssignee: (personId: string | null) => void;
  onClose: () => void;
}): React.ReactNode {
  const { picker, issue, members, onPickStatus, onPickAssignee, onClose } = props;
  const listRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!picker) return;
    const el = listRef.current;
    const height = el?.offsetHeight ?? 200;
    let top = picker.anchorRect.bottom + 2;
    const viewportH = window.innerHeight;
    if (top + height > viewportH - 4) {
      top = Math.max(4, viewportH - height - 4);
    }
    setPos({ top, left: Math.min(picker.anchorRect.left, window.innerWidth - 180) });
  }, [picker]);

  // Once positioned, the picker takes focus on its first option.
  useEffect(() => {
    if (!picker || !pos) return;
    const first = listRef.current?.querySelector<HTMLElement>("[role='option']");
    first?.focus();
  }, [picker, pos]);

  if (!picker || !issue) return null;
  const options =
    picker.kind === "status"
      ? statusOptions(issue).map((s) => ({ value: s, label: statusLabel(s) }))
      : [{ value: "", label: "Unassigned" }, ...assigneeOptions(issue, members).map((m) => ({ value: m.id, label: m.name }))];

  return (
    <div
      className="pickers"
      role="listbox"
      aria-label={picker.kind === "status" ? "Status" : "Assignee"}
      ref={listRef}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, display: pos ? "block" : "none" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        }
        const focusables = [...(listRef.current?.querySelectorAll<HTMLElement>("[role='option']") ?? [])];
        const idx = focusables.indexOf(document.activeElement as HTMLElement);
        if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
          focusables[Math.min(focusables.length - 1, idx + 1)].focus();
          return;
        }
        if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
          focusables[Math.max(0, idx - 1)].focus();
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          const current = focusables[idx];
          if (current) {
            current.click();
          }
        }
      }}
    >
      {options.map((opt) => (
        <div
          key={opt.value || "unassigned"}
          role="option"
          aria-selected={false}
          tabIndex={-1}
          onClick={() => {
            if (picker.kind === "status") onPickStatus(opt.value);
            else onPickAssignee(opt.value === "" ? null : opt.value);
            onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (picker.kind === "status") onPickStatus(opt.value);
              else onPickAssignee(opt.value === "" ? null : opt.value);
              onClose();
            }
          }}
        >
          {opt.label}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issues list with keyboard triage.
// ---------------------------------------------------------------------------

export function IssuesList(props: {
  issues: Issue[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onOpen: (key: string) => void;
  onPicker: (kind: "status" | "assignee", key: string, rect: DOMRect) => void;
  focusListRef: (el: HTMLDivElement | null) => void;
}): React.ReactNode {
  const { issues, selectedKey, onSelect, onOpen, onPicker } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (containerRef.current && !containerRef.current.contains(target)) return;
      const rows = issues;
      if (rows.length === 0) return;
      const idx = rows.findIndex((i) => i.key === selectedKey);
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        const next = Math.min(rows.length - 1, idx + 1);
        onSelect(rows[next < 0 ? 0 : next].key);
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        const prev = Math.max(0, idx - 1);
        onSelect(rows[prev].key);
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        const issue = rows[idx === -1 ? 0 : idx];
        if (issue) {
          const row = document.querySelector<HTMLElement>(`[data-issue-key="${issue.key}"]`);
          const btn = row?.querySelector<HTMLButtonElement>(`button[aria-label^="Status"]`);
          if (btn) {
            const rect = btn.getBoundingClientRect();
            onPicker("status", issue.key, rect);
          }
        }
      } else if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        const issue = rows[idx === -1 ? 0 : idx];
        if (issue) {
          const row = document.querySelector<HTMLElement>(`[data-issue-key="${issue.key}"]`);
          const btn = row?.querySelector<HTMLButtonElement>(`button[aria-label^="Assignee"]`);
          if (btn) {
            const rect = btn.getBoundingClientRect();
            onPicker("assignee", issue.key, rect);
          }
        }
      } else if (e.key === "Enter") {
        if (target.getAttribute("role") === "option") return;
        const issue = rows[idx === -1 ? 0 : idx];
        if (issue) {
          e.preventDefault();
          onOpen(issue.key);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [issues, selectedKey, onSelect, onOpen, onPicker]);

  const groups = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = groups.get(issue.status) ?? [];
    list.push(issue);
    groups.set(issue.status, list);
  }
  const order = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"];

  return (
    <div ref={containerRef}>
      {order
        .filter((s) => groups.has(s))
        .map((status) => (
          <div key={status}>
            <div className="status-group-header">{statusLabel(status)}</div>
            {(groups.get(status) ?? []).map((issue) => (
              <div
                key={issue.key}
                className={"row" + (issue.key === selectedKey ? " selected" : "")}
                data-issue-key={issue.key}
                tabIndex={-1}
              >
                <span className="key">{issue.key}</span>
                <span className="title">{issue.title}</span>
                <button
                  className="row-btn"
                  aria-label={`Status: ${statusLabel(issue.status)}`}
                  onClick={(e) => {
                    onSelect(issue.key);
                    onPicker("status", issue.key, e.currentTarget.getBoundingClientRect());
                  }}
                >
                  {statusLabel(issue.status)}
                </button>
                <button
                  className="row-btn"
                  aria-label={`Assignee: ${store.personName(issue.assignee_id) || "Unassigned"}`}
                  onClick={(e) => {
                    onSelect(issue.key);
                    onPicker("assignee", issue.key, e.currentTarget.getBoundingClientRect());
                  }}
                >
                  {store.personName(issue.assignee_id) || "Unassigned"}
                </button>
                <span className="meta">{issue.due_date ? formatDate(issue.due_date) : ""}</span>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

export function useIssuesQuery(query: string): { issues: Issue[]; loading: boolean; reload: () => void } {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const requestId = useRef(0);

  const reload = (): void => setTick((t) => t + 1);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    api
      .issues(query)
      .then(({ data }) => {
        if (id !== requestId.current) return;
        setIssues(data.issues);
        setLoading(false);
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setLoading(false);
      });
  }, [query, tick]);

  useEffect(() => {
    const off = store.onStreamEvent((name) => {
      if (name === "issue" || name === "reset") reload();
    });
    return off;
  }, []);

  return { issues, loading, reload };
}

export async function moveIssueStatus(key: string, to: string): Promise<void> {
  const issue = store.issues[key] ?? null;
  try {
    const { data } = await api.transition(key, to);
    store.upsertIssue(data);
    store.announce(`${key} moved to ${statusLabel(to)}.`);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.code === "illegal_transition") {
        store.announce(`${key} can't move from ${statusLabel(issue?.status ?? "")} to ${statusLabel(to)}.`);
        return;
      }
      if (e.code === "open_sub_issues") {
        store.announce(`${key} has open sub-issues. Finish or cancel them first.`);
        return;
      }
      if (e.code === "database_unavailable") {
        store.announce("Tallyroom can't reach its database. Changes are not being saved.");
        return;
      }
    }
    store.announce(`${key} can't move from ${statusLabel(issue?.status ?? "")} to ${statusLabel(to)}.`);
  }
}

export async function assignIssueTo(key: string, personId: string | null): Promise<void> {
  try {
    const { data } = await api.patchIssue(key, { assignee_id: personId });
    store.upsertIssue(data);
    const name = store.personName(personId);
    store.announce(name ? `${key} assigned to ${name}.` : `${key} unassigned.`);
  } catch (e) {
    if (e instanceof ApiError && e.code === "database_unavailable") {
      store.announce("Tallyroom can't reach its database. Changes are not being saved.");
      return;
    }
    store.announce(`${key} can't be assigned right now.`);
  }
}

export function IssueDetail(props: { issueKey: string; onPicker: (kind: "status" | "assignee", key: string, rect: DOMRect, issue?: Issue) => void; onNotFound: () => void }): React.ReactNode {
  const { issueKey } = props;
  const [issue, setIssue] = useState<Issue | null>(null);
  const [missing, setMissing] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .issue(issueKey)
      .then(({ data }) => {
        if (cancelled) return;
        setIssue(data);
        setDueDate(data.due_date ?? "");
        setMissing(false);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === "not_found") {
          setMissing(true);
          setIssue(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [issueKey]);

  useEffect(() => {
    const off = store.onStreamEvent((name, data) => {
      if (name === "issue") {
        const incoming = data as Issue;
        if (incoming.key === issueKey) setIssue(incoming);
      }
    });
    return off;
  }, [issueKey]);

  if (missing) return <NotFoundDetail />;
  if (!issue) return <div className="not-found">Loading…</div>;

  const storageDown = store.status?.storage === "unavailable";

  const saveDueDate = async (): Promise<void> => {
    try {
      const { data } = await api.patchIssue(issueKey, { due_date: dueDate === "" ? null : dueDate });
      store.upsertIssue(data);
      const snapped = (data as Issue & { due_date_snapped: boolean }).due_date_snapped;
      if (snapped) {
        store.announce(`Due date moved to ${formatDate(data.due_date!)}, the next working day.`);
        setDueDate(data.due_date ?? "");
      } else {
        store.announce(`Due date set to ${formatDate(data.due_date!)}.`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.fields?.due_date) {
        store.announce("Enter a date as YYYY-MM-DD.");
        return;
      }
      store.announce("Due date not saved.");
    }
  };

  const upload = async (file: File): Promise<void> => {
    setUploadStatus(`Uploading ${file.name}`);
    try {
      await api.attachFile(`/api/issues/${issueKey}/attachments`, file, (f) => setProgress(f));
      setUploadStatus(`Attached ${file.name}.`);
      store.announce(`Attached ${file.name}.`);
      const { data } = await api.issue(issueKey);
      setIssue(data);
      store.upsertIssue(data);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "too_large") {
          setUploadStatus(`${file.name} is too large and was not attached.`);
          store.announce(`${file.name} is too large and was not attached.`);
          return;
        }
        if (e.code === "storage_unavailable") {
          setUploadStatus("Upload failed: storage is unavailable. Nothing was attached.");
          store.announce("Upload failed: storage is unavailable. Nothing was attached.");
          return;
        }
        if (e.fields?.file) {
          setUploadStatus(e.fields.file);
          store.announce(e.fields.file);
          return;
        }
      }
      setUploadStatus("Upload failed: storage is unavailable. Nothing was attached.");
      store.announce("Upload failed: storage is unavailable. Nothing was attached.");
    }
  };

  return (
    <div>
      <TitleBlock
        keyText={issue.key}
        state={statusLabel(issue.status)}
        changed={formatDate(issue.closed_at?.slice(0, 10) ?? store.workspace?.today ?? "")}
      />
      <h1>{issue.title}</h1>
      <p>{issue.description}</p>
      <div className="section-label">Status and assignee</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="row-btn"
          aria-label={`Status: ${statusLabel(issue.status)}`}
          onClick={(e) => props.onPicker("status", issue.key, e.currentTarget.getBoundingClientRect())}
        >
          {statusLabel(issue.status)}
        </button>
        <button
          className="row-btn"
          aria-label={`Assignee: ${store.personName(issue.assignee_id) || "Unassigned"}`}
          onClick={(e) => props.onPicker("assignee", issue.key, e.currentTarget.getBoundingClientRect())}
        >
          {store.personName(issue.assignee_id) || "Unassigned"}
        </button>
        <span className="meta num">
          Cycle {issue.cycle_number ?? "—"} · due {issue.due_date ? formatDate(issue.due_date) : "—"}
        </span>
      </div>
      {issue.parent_key && (
        <p className="meta">
          Sub-issue of {issue.parent_key}
        </p>
      )}
      {issue.sub_issue_keys.length > 0 && (
        <p className="meta">Sub-issues: {issue.sub_issue_keys.join(", ")}</p>
      )}
      <div className="section-label">Due date</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          aria-label="Due date"
          className="num"
          value={dueDate}
          onChange={(e) => setDueDate(e.currentTarget.value)}
          onBlur={() => void saveDueDate()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void saveDueDate();
          }}
          placeholder="YYYY-MM-DD"
        />
      </div>
      <div className="section-label">Attachments</div>
      <button
        className="btn"
        aria-label="Attach file"
        aria-disabled={storageDown}
        onClick={() => {
          if (storageDown) {
            setUploadStatus("Upload failed: storage is unavailable. Nothing was attached.");
            store.announce("Upload failed: storage is unavailable. Nothing was attached.");
            return;
          }
          fileRef.current?.click();
        }}
      >
        Attach file
      </button>
      <input
        ref={fileRef}
        type="file"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      {progress > 0 && progress < 1 && (
        <div className="progress" aria-label="Upload progress">
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      <div role="status">
        {uploadStatus}
      </div>
      {issue.attachments.map((a) => (
        <a key={a.id} className="attachment-link" href={`/api/attachments/${a.id}`}>
          {a.filename}
        </a>
      ))}
    </div>
  );
}
