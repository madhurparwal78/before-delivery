// The issue list shared by the Issues and Cycle modules: rows grouped in the status order, J/K
// selection, Enter to open, S and A for the status and assignee pickers.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { api, ApiFailure, get, type Issue, type Person } from "../api";
import { showDate } from "../format";
import { useApp } from "../store";
import { EDGES, STATUSES, STATUS_LABELS, type IssueStatus } from "../../shared/status-edges";
import { Picker, type PickerRequest } from "./Picker";

/** People who can see a project, by name. */
function audienceOf(projectId: string): Promise<Person[]> {
  return get<{ members: Person[] }>(`/api/members?project=${encodeURIComponent(projectId)}`).then((r) => r.members);
}

/** The Issues list order: status order, project key, issue number. */
export function inListOrder(issues: Issue[]): Issue[] {
  const parts = (issue: Issue): [string, number] => {
    const at = issue.key.lastIndexOf("-");
    return [issue.key.slice(0, at), Number(issue.key.slice(at + 1))];
  };
  return [...issues].sort((a, b) => {
    const [projectA, numberA] = parts(a);
    const [projectB, numberB] = parts(b);
    return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || projectA.localeCompare(projectB) || numberA - numberB;
  });
}

export function useIssueActions(onChanged: (issue: Issue) => void): {
  picker: PickerRequest | null;
  closePicker: () => void;
  openStatus: (issue: Issue, anchor: HTMLElement) => void;
  openAssignee: (issue: Issue, anchor: HTMLElement) => void;
} {
  const app = useApp();
  const [picker, setPicker] = useState<PickerRequest | null>(null);

  const openStatus = useCallback(
    (issue: Issue, anchor: HTMLElement) => {
      const returnFocus = document.activeElement as HTMLElement | null;
      const legal = STATUSES.filter((s) => EDGES[issue.status].includes(s));
      setPicker({
        issueKey: issue.key,
        label: "Status",
        anchor,
        returnFocus,
        options: legal.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
        onChoose: (value) => {
          const to = value as IssueStatus;
          api<Issue>("POST", `/api/issues/${issue.key}/transition`, { to })
            .then((updated) => {
              onChanged(updated);
              app.announce(`${issue.key} moved to ${STATUS_LABELS[to]}.`);
            })
            .catch((error: unknown) => {
              if (!(error instanceof ApiFailure)) return;
              if (error.code === "illegal_transition") {
                void get<Issue>(`/api/issues/${issue.key}`)
                  .then((now) => {
                    onChanged(now);
                    app.announce(`${issue.key} can't move from ${STATUS_LABELS[now.status]} to ${STATUS_LABELS[to]}.`);
                  })
                  .catch(() => undefined);
              }
              if (error.code === "open_sub_issues") app.announce(`${issue.key} has open sub-issues. Finish or cancel them first.`);
            });
        },
      });
    },
    [app, onChanged],
  );

  const openAssignee = useCallback(
    (issue: Issue, anchor: HTMLElement) => {
      const returnFocus = document.activeElement as HTMLElement | null;
      void audienceOf(issue.project_id).then((people) => {
        setPicker({
          issueKey: issue.key,
          label: "Assignee",
          anchor,
          returnFocus,
          options: [{ value: "", label: "Unassigned" }, ...people.map((p) => ({ value: p.id, label: p.name }))],
          onChoose: (value) => {
            api<Issue>("PATCH", `/api/issues/${issue.key}`, { assignee_id: value || null })
              .then((updated) => {
                onChanged(updated);
                const name = people.find((p) => p.id === value)?.name;
                app.announce(name ? `${issue.key} assigned to ${name}.` : `${issue.key} unassigned.`);
              })
              .catch(() => undefined);
          },
        });
      });
    },
    [app, onChanged],
  );

  const closePicker = useCallback(() => setPicker(null), []);
  return { picker, closePicker, openStatus, openAssignee };
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target.isContentEditable) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(target.type);
}

/** Wraps a list pane so the shortcuts work wherever focus sits inside it. */
export function IssueRows(props: { issues: Issue[]; onChanged: (issue: Issue) => void; onOpen: (key: string) => void; toolbar?: ReactNode; emptyText: string; loading: boolean }): JSX.Element {
  const { issues, onChanged, onOpen } = props;
  const actions = useIssueActions(onChanged);
  const [selected, setSelected] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const selectedKey = issues.some((i) => i.key === selected) ? selected : (issues[0]?.key ?? null);
  const order = useRef<string[]>([]);
  const { picker, closePicker } = actions;

  /** A row that left the list hands selection, focus and any open picker on to the row that follows it. */
  useLayoutEffect(() => {
    const before = order.current;
    const now = issues.map((i) => i.key);
    order.current = now;
    const leaving = picker !== null && !now.includes(picker.issueKey) ? picker.issueKey : null;
    const lost = selected !== null && !now.includes(selected) && before.includes(selected) ? selected : null;
    const gone = leaving ?? lost;
    const active = document.activeElement;
    const idle = active === null || active === document.body;
    if (gone === null) {
      if (idle && lastFocused.current?.isConnected && !picker) lastFocused.current.focus();
      return;
    }
    if (leaving) closePicker();
    const next = before.slice(before.indexOf(gone) + 1).find((key) => now.includes(key)) ?? now[now.length - 1] ?? null;
    if (lost) setSelected(next);
    if (next && (leaving || idle)) container.current?.querySelector<HTMLElement>(`[data-issue="${CSS.escape(next)}"]`)?.focus();
  }, [issues, picker, closePicker, selected]);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const track = (event: FocusEvent): void => {
      lastFocused.current = event.target as HTMLElement;
    };
    node.addEventListener("focusin", track);
    return () => node.removeEventListener("focusin", track);
  }, []);

  const rowElement = (key: string): HTMLElement | null => container.current?.querySelector<HTMLElement>(`[data-issue="${CSS.escape(key)}"]`) ?? null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
    const key = event.key.toLowerCase();
    const index = issues.findIndex((i) => i.key === selectedKey);
    const issue = issues[index];
    if (key === "j" || key === "k") {
      event.preventDefault();
      const next = issues[Math.max(0, Math.min(issues.length - 1, index + (key === "j" ? 1 : -1)))];
      if (next) {
        setSelected(next.key);
        rowElement(next.key)?.focus();
      }
    } else if (key === "enter" && issue && (event.target as HTMLElement).getAttribute("role") === "row") {
      event.preventDefault();
      onOpen(issue.key);
    } else if ((key === "s" || key === "a") && issue) {
      event.preventDefault();
      const row = rowElement(issue.key);
      const anchor = row?.querySelector<HTMLElement>(key === "s" ? ".status-button" : ".assignee-button") ?? row;
      if (!anchor) return;
      if (key === "s") actions.openStatus(issue, anchor);
      else actions.openAssignee(issue, anchor);
    }
  };

  const groups = STATUSES.map((status) => ({ status, rows: issues.filter((i) => i.status === status) })).filter((g) => g.rows.length > 0);

  return (
    <div className="issue-list" ref={container} onKeyDown={onKeyDown}>
      {props.toolbar}
      {props.loading && issues.length === 0 ? (
        <div className="skeleton" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton-row" />
          ))}
        </div>
      ) : issues.length === 0 ? (
        <p className="list-empty">{props.emptyText}</p>
      ) : (
        <div role="table" aria-label="Issues" className="rows">
          {groups.flatMap((group) => [
            <div role="row" key={`group-${group.status}`} className="group-row">
              <span role="columnheader">
                {STATUS_LABELS[group.status]} <span className="mono">{group.rows.length}</span>
              </span>
            </div>,
            ...group.rows.map((issue) => (
              <div
                role="row"
                key={issue.key}
                data-issue={issue.key}
                aria-label={`${issue.key} ${issue.title}`}
                aria-selected={issue.key === selectedKey}
                tabIndex={issue.key === selectedKey ? 0 : -1}
                className="issue-row"
                onFocus={() => setSelected(issue.key)}
                onClick={() => onOpen(issue.key)}
              >
                <span role="cell" className="mono key">
                  {issue.key}
                </span>
                <span role="cell" className="title">
                  {issue.title}
                </span>
                <span role="cell">
                  <button
                    type="button"
                    tabIndex={-1}
                    className="chip-button status-button"
                    data-status={issue.status}
                    aria-label={`Status: ${STATUS_LABELS[issue.status]}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(issue.key);
                      actions.openStatus(issue, e.currentTarget);
                    }}
                  >
                    <span className="status-dot" aria-hidden="true" />
                    {STATUS_LABELS[issue.status]}
                  </button>
                </span>
                <span role="cell">
                  <button
                    type="button"
                    tabIndex={-1}
                    className="chip-button assignee-button"
                    aria-label={`Assignee: ${issue.assignee_name ?? "Unassigned"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(issue.key);
                      actions.openAssignee(issue, e.currentTarget);
                    }}
                  >
                    {issue.assignee_name ?? "Unassigned"}
                  </button>
                </span>
                <span role="cell" className="mono due">
                  {issue.due_date ? showDate(issue.due_date) : "—"}
                </span>
              </div>
            )),
          ])}
        </div>
      )}
      {actions.picker && <Picker request={actions.picker} onDone={actions.closePicker} />}
    </div>
  );
}
