import { statusLabels, statusOrder } from './copy.js';
import { clear, el, setText } from './dom.js';
import { formatDate } from './format.js';
import {
  assigneeButtonName,
  openAssigneePicker,
  openStatusPicker,
  statusButtonName,
} from './issueactions.js';
import { nameOf } from './store.js';
import type { Issue, IssueStatus } from '../shared/types.js';

export type IssueListView = {
  element: HTMLElement;
  attachShortcuts: (region: HTMLElement) => void;
  setIssues: (issues: Issue[]) => void;
  patch: (issue: Issue) => boolean;
  issues: () => Issue[];
  selected: () => string | null;
  select: (key: string) => void;
  rowFor: (key: string) => HTMLElement | undefined;
  destroy: () => void;
};

/**
 * The ruled issue list the Issues and Cycle modules share, with the Issues list
 * order, selection and the status and assignee shortcuts.
 */
export function createIssueList(options: {
  label: string;
  onOpen: (issue: Issue, row: HTMLElement) => void;
}): IssueListView {
  const grid = el('div', { class: 'rows', role: 'grid', 'aria-label': options.label });
  const rows = new Map<string, HTMLElement>();
  let issues: Issue[] = [];
  let selectedKey: string | null = null;

  function groups(): { status: IssueStatus; rows: Issue[] }[] {
    return statusOrder
      .map((status) => ({
        status,
        rows: issues
          .filter((issue) => issue.status === status)
          .sort((left, right) => compareKeys(left.key, right.key)),
      }))
      .filter((group) => group.rows.length > 0);
  }

  function orderedKeys(): string[] {
    return groups().flatMap((group) => group.rows.map((issue) => issue.key));
  }

  function render(): void {
    const hadFocus = grid.contains(document.activeElement);
    clear(grid);
    rows.clear();
    for (const group of groups()) {
      const rowgroup = el('div', { class: 'rowgroup', role: 'rowgroup' }, [
        el('div', { class: 'group-heading', role: 'presentation', text: statusLabels[group.status] }),
      ]);
      for (const issue of group.rows) rowgroup.append(buildRow(issue));
      grid.append(rowgroup);
    }
    const keys = orderedKeys();
    if (selectedKey === null || !keys.includes(selectedKey)) selectedKey = keys[0] ?? null;
    applySelection();
    if (hadFocus && selectedKey !== null) rows.get(selectedKey)?.focus();
  }

  function buildRow(issue: Issue): HTMLElement {
    const row = el('div', {
      class: 'row issue-row',
      role: 'row',
      tabindex: '-1',
      'data-key': issue.key,
      'aria-label': `${issue.key} ${issue.title}`,
    });
    const statusButton = el('button', {
      type: 'button',
      class: 'cell-button mono',
      'aria-label': statusButtonName(issue),
      text: statusLabels[issue.status],
    });
    statusButton.addEventListener('click', () => {
      openStatusPicker(current(issue.key), statusButton);
    });
    const assigneeButton = el('button', {
      type: 'button',
      class: 'cell-button',
      'aria-label': assigneeButtonName(issue),
      text: issue.assignee_id === null ? 'Unassigned' : nameOf(issue.assignee_id),
    });
    assigneeButton.addEventListener('click', () => {
      openAssigneePicker(current(issue.key), assigneeButton);
    });
    row.append(
      el('span', { class: 'cell key mono', role: 'gridcell', text: issue.key }),
      el('span', { class: 'cell title', role: 'gridcell', text: issue.title }),
      el('span', { class: 'cell status', role: 'gridcell' }, [statusButton]),
      el('span', { class: 'cell assignee', role: 'gridcell' }, [assigneeButton]),
      el('span', {
        class: 'cell due mono',
        role: 'gridcell',
        text: issue.due_date === null ? '' : formatDate(issue.due_date),
      }),
    );
    row.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('button') !== null) return;
      selectedKey = issue.key;
      applySelection();
      options.onOpen(current(issue.key), row);
    });
    row.addEventListener('focus', () => {
      selectedKey = issue.key;
      applySelection();
    });
    rows.set(issue.key, row);
    return row;
  }

  function current(key: string): Issue {
    const found = issues.find((issue) => issue.key === key);
    if (found === undefined) throw new Error(`Issue ${key} left the list`);
    return found;
  }

  function applySelection(): void {
    for (const [key, node] of rows) {
      const selected = key === selectedKey;
      node.setAttribute('tabindex', selected ? '0' : '-1');
      node.classList.toggle('selected', selected);
    }
  }

  function patchRow(issue: Issue): boolean {
    const node = rows.get(issue.key);
    if (node === undefined) return false;
    const previous = issues.find((entry) => entry.key === issue.key);
    issues = issues.map((entry) => (entry.key === issue.key ? issue : entry));
    if (previous !== undefined && previous.status !== issue.status) {
      render();
      return true;
    }
    node.setAttribute('aria-label', `${issue.key} ${issue.title}`);
    const cells = [...node.querySelectorAll<HTMLElement>('.cell')];
    const title = cells[1];
    if (title !== undefined) setText(title, issue.title);
    const statusButton = cells[2]?.querySelector('button');
    if (statusButton !== null && statusButton !== undefined) {
      statusButton.setAttribute('aria-label', statusButtonName(issue));
      setText(statusButton, statusLabels[issue.status]);
    }
    const assigneeButton = cells[3]?.querySelector('button');
    if (assigneeButton !== null && assigneeButton !== undefined) {
      assigneeButton.setAttribute('aria-label', assigneeButtonName(issue));
      setText(assigneeButton, issue.assignee_id === null ? 'Unassigned' : nameOf(issue.assignee_id));
    }
    const dueCell = cells[4];
    if (dueCell !== undefined) setText(dueCell, issue.due_date === null ? '' : formatDate(issue.due_date));
    return true;
  }

  function onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.matches('input, textarea, select')) return;
    const keys = orderedKeys();
    if (keys.length === 0) return;
    const index = selectedKey === null ? -1 : keys.indexOf(selectedKey);
    const move = (next: number): void => {
      event.preventDefault();
      selectedKey = keys[Math.min(Math.max(next, 0), keys.length - 1)] ?? selectedKey;
      applySelection();
      if (selectedKey !== null) rows.get(selectedKey)?.focus();
    };
    if (event.key === 'j' || event.key === 'J') return move(index + 1);
    if (event.key === 'k' || event.key === 'K') return move(index - 1);
    if (selectedKey === null) return;
    const node = rows.get(selectedKey);
    if (node === undefined) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      options.onOpen(current(selectedKey), node);
      return;
    }
    if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      openStatusPicker(current(selectedKey), node);
      return;
    }
    if (event.key === 'a' || event.key === 'A') {
      event.preventDefault();
      openAssigneePicker(current(selectedKey), node);
    }
  }

  let host: HTMLElement = grid;
  host.addEventListener('keydown', onKeydown);

  return {
    element: grid,
    /** The shortcuts work wherever focus sits inside the list region. */
    attachShortcuts(region: HTMLElement) {
      host.removeEventListener('keydown', onKeydown);
      host = region;
      host.addEventListener('keydown', onKeydown);
    },
    setIssues(next) {
      issues = next;
      render();
    },
    patch: patchRow,
    issues: () => issues,
    selected: () => selectedKey,
    select(key) {
      selectedKey = key;
      applySelection();
    },
    rowFor: (key) => rows.get(key),
    destroy() {
      host.removeEventListener('keydown', onKeydown);
      clear(grid);
    },
  };
}

export function compareKeys(left: string, right: string): number {
  const [leftProject, leftNumber] = splitKey(left);
  const [rightProject, rightNumber] = splitKey(right);
  if (leftProject !== rightProject) return leftProject < rightProject ? -1 : 1;
  return leftNumber - rightNumber;
}

function splitKey(key: string): [string, number] {
  const index = key.lastIndexOf('-');
  return [key.slice(0, index), Number(key.slice(index + 1))];
}
