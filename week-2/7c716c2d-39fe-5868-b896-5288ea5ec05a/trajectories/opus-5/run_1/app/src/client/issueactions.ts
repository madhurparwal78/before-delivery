import { api, ApiCallError } from './api.js';
import { copy, statusLabels, statusOrder } from './copy.js';
import { openPicker, type PickerOption } from './dom.js';
import { formatDate } from './format.js';
import { announce } from './shell.js';
import { nameOf, state } from './store.js';
import type { Issue, IssueStatus } from '../shared/types.js';

const edges: Record<IssueStatus, IssueStatus[]> = {
  backlog: ['todo', 'cancelled'],
  todo: ['backlog', 'in_progress', 'cancelled'],
  in_progress: ['todo', 'in_review', 'cancelled'],
  in_review: ['in_progress', 'done', 'cancelled'],
  done: ['in_progress'],
  cancelled: ['backlog'],
};

export function statusOptions(status: IssueStatus): PickerOption[] {
  return statusOrder
    .filter((candidate) => edges[status].includes(candidate))
    .map((candidate) => ({ label: statusLabels[candidate], value: candidate }));
}

export function assigneeOptions(): PickerOption[] {
  const people = [...state.members].sort((left, right) => (left.name < right.name ? -1 : 1));
  return [
    { label: 'Unassigned', value: '' },
    ...people.map((person) => ({ label: person.name, value: person.id })),
  ];
}

export type IssuePatch = Issue & { due_date_snapped?: boolean };

export function openStatusPicker(issue: Issue, anchor: HTMLElement): void {
  openPicker({
    name: 'Status',
    anchor,
    options: statusOptions(issue.status),
    onChoose: (value) => {
      void moveIssue(issue, value as IssueStatus);
    },
  });
}

export function openAssigneePicker(issue: Issue, anchor: HTMLElement): void {
  openPicker({
    name: 'Assignee',
    anchor,
    options: assigneeOptions(),
    onChoose: (value) => {
      void assignIssue(issue, value === '' ? null : value);
    },
  });
}

export async function moveIssue(issue: Issue, to: IssueStatus): Promise<void> {
  try {
    await api<Issue>('POST', `/api/issues/${issue.key}/transition`, { body: { to } });
    announce(copy.issueMoved(issue.key, to));
  } catch (error) {
    if (!(error instanceof ApiCallError)) return;
    if (error.code === 'illegal_transition') announce(copy.issueCantMove(issue.key, issue.status, to));
    else if (error.code === 'open_sub_issues') announce(copy.issueOpenSubIssues(issue.key));
    else if (error.code === 'not_found') announce(copy.issueCantMove(issue.key, issue.status, to));
  }
}

export async function assignIssue(issue: Issue, personId: string | null): Promise<void> {
  try {
    await api<Issue>('PATCH', `/api/issues/${issue.key}`, { body: { assignee_id: personId } });
    if (personId === null) announce(copy.issueUnassigned(issue.key));
    else {
      const name = state.members.find((person) => person.id === personId)?.name ?? '';
      announce(copy.issueAssigned(issue.key, name));
    }
  } catch {
    announce(copy.issueCantMove(issue.key, issue.status, issue.status));
  }
}

export type DueResult = { ok: boolean; date: string | null; snapped: boolean };

export async function saveDueDate(key: string, date: string | null): Promise<DueResult> {
  try {
    const result = await api<IssuePatch>('PATCH', `/api/issues/${key}`, { body: { due_date: date } });
    const snapped = result.due_date_snapped === true;
    if (result.due_date !== null) {
      announce(snapped ? copy.dueDateMoved(formatDate(result.due_date)) : copy.dueDateSet(formatDate(result.due_date)));
    }
    return { ok: true, date: result.due_date, snapped };
  } catch (error) {
    if (error instanceof ApiCallError && error.code === 'validation') announce(copy.badDate);
    else announce(copy.dueDateNotSaved);
    return { ok: false, date: null, snapped: false };
  }
}

export function statusButtonName(issue: Issue): string {
  return `Status: ${statusLabels[issue.status]}`;
}

export function assigneeButtonName(issue: Issue): string {
  const name = issue.assignee_id === null ? 'Unassigned' : nameOf(issue.assignee_id);
  return `Assignee: ${name}`;
}
