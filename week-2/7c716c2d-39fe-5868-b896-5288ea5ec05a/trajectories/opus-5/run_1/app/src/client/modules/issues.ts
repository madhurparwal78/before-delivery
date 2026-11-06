import { api, ApiCallError } from '../api.js';
import { copy, statusLabels } from '../copy.js';
import { clear, el, openDialog } from '../dom.js';
import { formatDate } from '../format.js';
import {
  assigneeButtonName,
  openAssigneePicker,
  openStatusPicker,
  saveDueDate,
  statusButtonName,
} from '../issueactions.js';
import { createIssueList } from '../issuelist.js';
import { navigate, rewrite, type Route } from '../router.js';
import {
  announce,
  focusDetailTitle,
  notFoundSheet,
  titleBlock,
  type ModuleContext,
  type ModuleHandle,
} from '../shell.js';
import { onStreamEvent } from '../stream.js';
import { nameOf, state, subscribe } from '../store.js';
import { attachmentsPanel } from '../uploads.js';
import type { Issue } from '../../shared/types.js';

type Filters = { project: string | null; cycle: string };

export function issuesModule(context: ModuleContext): ModuleHandle {
  let filters: Filters = { project: null, cycle: 'current' };
  let openKey: string | null = null;
  let openIssueBody: Issue | null = null;
  let notFound = false;
  let sequence = 0;
  let wantFocus = false;

  const projectFilter = el('select', { 'aria-label': 'Project filter', class: 'mono' });
  const cycleFilter = el('select', { 'aria-label': 'Cycle filter', class: 'mono' });
  const newIssue = el('button', { type: 'button', text: 'New issue' });
  const list = createIssueList({
    label: 'Issues',
    onOpen: (issue, row) => {
      openKey = issue.key;
      wantFocus = true;
      navigate(address());
      renderSheet();
      context.openDetail(row);
    },
  });
  const sheet = el('div', { class: 'sheet' });

  context.list.append(
    el('div', { class: 'toolbar' }, [
      el('label', { class: 'field' }, [el('span', { text: 'Project' }), projectFilter]),
      el('label', { class: 'field' }, [el('span', { text: 'Cycle' }), cycleFilter]),
      newIssue,
    ]),
    list.element,
  );
  list.attachShortcuts(context.list);
  context.detail.append(sheet);

  function address(): string {
    const query = new URLSearchParams();
    if (filters.project !== null) query.set('project', filters.project);
    if (filters.cycle !== 'current') query.set('cycle', filters.cycle);
    const search = query.toString();
    const base = openKey === null ? '/issues' : `/issues/${openKey}`;
    return search === '' ? base : `${base}?${search}`;
  }

  function renderFilters(): void {
    clear(projectFilter);
    projectFilter.append(el('option', { value: '', text: 'All projects' }));
    for (const project of [...state.projects].sort((left, right) => (left.name < right.name ? -1 : 1))) {
      projectFilter.append(el('option', { value: project.id, text: project.name }));
    }
    projectFilter.value = filters.project ?? '';

    clear(cycleFilter);
    cycleFilter.append(el('option', { value: 'current', text: 'Current cycle' }));
    cycleFilter.append(el('option', { value: 'all', text: 'All cycles' }));
    cycleFilter.append(el('option', { value: 'none', text: 'No cycle' }));
    for (let number = 1; number <= state.currentCycle; number += 1) {
      cycleFilter.append(el('option', { value: String(number), text: `Cycle ${number}` }));
    }
    cycleFilter.value = filters.cycle;
  }

  projectFilter.addEventListener('change', () => {
    filters = { ...filters, project: projectFilter.value === '' ? null : projectFilter.value };
    navigate(address());
  });
  cycleFilter.addEventListener('change', () => {
    filters = { ...filters, cycle: cycleFilter.value };
    navigate(address());
  });
  newIssue.addEventListener('click', openNewIssueDialog);

  function openNewIssueDialog(): void {
    openDialog({
      name: 'New issue',
      build: (body, dialog) => {
        const title = el('input', { type: 'text', id: 'new-issue-title' });
        const description = el('textarea', { id: 'new-issue-description' });
        const project = el('select', { id: 'new-issue-project' });
        for (const entry of state.projects) project.append(el('option', { value: entry.id, text: entry.name }));
        if (filters.project !== null) project.value = filters.project;
        const error = el('p', { class: 'field-error' });
        const create = el('button', { type: 'button', text: 'Create issue' });
        create.addEventListener('click', () => {
          void api<Issue>('POST', '/api/issues', {
            body: { project_id: project.value, title: title.value, description: description.value },
          })
            .then((issue) => {
              announce(copy.issueCreated(issue.key));
              dialog.close();
              openKey = issue.key;
              openIssueBody = issue;
              navigate(address());
              renderSheet();
              void load();
            })
            .catch((failure: unknown) => {
              if (!(failure instanceof ApiCallError)) return;
              if (failure.code === 'validation') {
                error.textContent = copy.issueTitleMissing;
                announce(copy.issueTitleMissing);
              } else if (failure.code === 'cycle_closed') {
                announce(copy.cycleEnded(state.currentCycle));
              }
            });
        });
        body.append(
          el('h2', { class: 'display', text: 'New issue' }),
          el('label', { for: 'new-issue-title', text: 'Title' }),
          title,
          error,
          el('label', { for: 'new-issue-description', text: 'Description' }),
          description,
          el('label', { for: 'new-issue-project', text: 'Project' }),
          project,
          create,
        );
        project.setAttribute('aria-label', 'Project');
        title.setAttribute('aria-label', 'Title');
        description.setAttribute('aria-label', 'Description');
      },
    });
  }

  async function load(): Promise<void> {
    const mine = sequence + 1;
    sequence = mine;
    const query = new URLSearchParams();
    if (filters.project !== null) query.set('project', filters.project);
    if (filters.cycle !== 'all') query.set('cycle', filters.cycle);
    try {
      const result = await api<{ issues: Issue[] }>('GET', `/api/issues?${query.toString()}`);
      if (mine !== sequence) return;
      list.setIssues(result.issues);
      const open = result.issues.find((issue) => issue.key === openKey);
      if (open !== undefined) setOpenIssue(open);
    } catch (error) {
      if (mine !== sequence) return;
      if (error instanceof ApiCallError && error.code === 'not_found') {
        filters = { ...filters, project: null };
        renderFilters();
        rewrite(address());
        void load();
      }
    }
  }

  function renderSheet(): void {
    const keepTitleFocus =
      document.activeElement !== null &&
      sheet.contains(document.activeElement) &&
      document.activeElement.hasAttribute('data-detail-title');
    clear(sheet);
    if (openKey === null) {
      sheet.append(el('p', { class: 'empty', 'data-detail-title': 'true', text: 'Choose an issue to see its sheet.' }));
      return;
    }
    if (notFound) {
      sheet.append(notFoundSheet());
      return;
    }
    const issue = openIssueBody;
    if (issue === null || issue.key !== openKey) {
      void api<Issue>('GET', `/api/issues/${openKey}`)
        .then((loaded) => {
          notFound = false;
          setOpenIssue(loaded);
        })
        .catch(() => {
          notFound = true;
          renderSheet();
        });
      return;
    }
    const due = el('input', { type: 'text', class: 'mono', id: 'due-date' });
    due.setAttribute('aria-label', 'Due date');
    due.value = issue.due_date ?? '';
    due.addEventListener('change', () => {
      void saveDueDate(issue.key, due.value === '' ? null : due.value).then((result) => {
        if (result.ok && result.date !== null) due.value = result.date;
      });
    });
    const statusButton = el('button', {
      type: 'button',
      'aria-label': statusButtonName(issue),
      text: statusLabels[issue.status],
    });
    statusButton.addEventListener('click', () => {
      openStatusPicker(issue, statusButton);
    });
    const assigneeButton = el('button', {
      type: 'button',
      'aria-label': assigneeButtonName(issue),
      text: issue.assignee_id === null ? 'Unassigned' : nameOf(issue.assignee_id),
    });
    assigneeButton.addEventListener('click', () => {
      openAssigneePicker(issue, assigneeButton);
    });

    sheet.append(
      titleBlock(issue.key, statusLabels[issue.status], issue.due_date === null ? '' : formatDate(issue.due_date)),
      el('h1', { class: 'display', 'data-detail-title': 'true', text: issue.title }),
      el('p', { class: 'description', text: issue.description }),
      el('div', { class: 'facts' }, [
        fact('Status', statusButton),
        fact('Assignee', assigneeButton),
        fact(
          'Cycle',
          el('span', {
            class: 'mono',
            text: issue.cycle_number === null ? 'No cycle' : copy.cycleHeading(issue.cycle_number),
          }),
        ),
        fact('Due date', due),
        fact(
          'Parent',
          issue.parent_key === null
            ? el('span', { text: 'None' })
            : el('a', { href: `/issues/${issue.parent_key}`, class: 'mono', text: issue.parent_key }),
        ),
        fact(
          'Sub-issues',
          el(
            'span',
            { class: 'mono' },
            issue.sub_issue_keys.length === 0
              ? [document.createTextNode('None')]
              : issue.sub_issue_keys.map((key) => el('a', { href: `/issues/${key}`, class: 'mono', text: `${key} ` })),
          ),
        ),
      ]),
      attachmentsPanel({
        parentPath: `/api/issues/${issue.key}/attachments`,
        attachments: issue.attachments,
        onAttached: (attachment) => {
          issue.attachments = [...issue.attachments, attachment];
        },
      }),
    );
    if (keepTitleFocus) wantFocus = true;
    settleFocus();
  }

  /** The sheet is redrawn only when the issue it shows has changed. */
  function setOpenIssue(issue: Issue): void {
    if (JSON.stringify(issue) === JSON.stringify(openIssueBody)) return;
    openIssueBody = issue;
    renderSheet();
  }

  function settleFocus(): void {
    if (!wantFocus) return;
    wantFocus = false;
    focusDetailTitle();
  }

  function fact(label: string, value: Node): HTMLElement {
    return el('div', { class: 'fact' }, [el('span', { class: 'fact-label', text: label }), value]);
  }

  const unsubscribeStore = subscribe((keys) => {
    if (keys.has('projects') || keys.has('currentCycle')) renderFilters();
  });

  const unsubscribeStream = onStreamEvent((event) => {
    if (event.name === 'reset') {
      void load();
      return;
    }
    if (event.name === 'revoked' && event.data.scope === 'project') {
      if (openIssueBody !== null && openIssueBody.project_id === event.data.id) {
        notFound = true;
        openIssueBody = null;
        renderSheet();
      }
      void load();
      return;
    }
    if (event.name !== 'issue') return;
    const issue = event.data as unknown as Issue;
    const matchesProject = filters.project === null || issue.project_id === filters.project;
    const matchesCycle =
      filters.cycle === 'all' ||
      (filters.cycle === 'none' && issue.cycle_number === null) ||
      (filters.cycle === 'current' && issue.cycle_number === state.currentCycle) ||
      issue.cycle_number === Number(filters.cycle);
    if (openKey === issue.key) {
      openIssueBody = issue;
      renderSheet();
    }
    if (matchesProject && matchesCycle) {
      if (!list.patch(issue)) void load();
    } else if (list.rowFor(issue.key) !== undefined) {
      void load();
    }
  });

  return {
    id: 'issues',
    firstPane: 'list',
    route(route: Route) {
      const projectParam = route.query.get('project');
      const cycleParam = route.query.get('cycle');
      const knownProject =
        projectParam !== null && state.projects.some((project) => project.id === projectParam) ? projectParam : null;
      const cycle =
        cycleParam === null
          ? 'current'
          : cycleParam === 'all' || cycleParam === 'none' || /^\d+$/.test(cycleParam)
            ? cycleParam
            : 'current';
      const corrected =
        (projectParam !== null && knownProject === null) || (cycleParam !== null && cycle !== cycleParam);
      filters = { project: knownProject, cycle };
      const wantedKey = route.segments.length > 2 ? 'unknown path' : route.segments[1] ?? null;
      if (wantedKey !== openKey) {
        openKey = wantedKey;
        openIssueBody = null;
        notFound = false;
        wantFocus = wantedKey !== null;
      }
      renderFilters();
      if (corrected) rewrite(address());
      renderSheet();
      if (openKey !== null) context.openDetail(null);
      else context.showList();
      void load();
    },
    destroy() {
      unsubscribeStore();
      unsubscribeStream();
      list.destroy();
      clear(context.list);
      clear(context.detail);
    },
  };
}
