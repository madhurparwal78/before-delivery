import { api, guard } from './api';
import { clear, el, play, shortSha, trapFocus } from './dom';
import { connect, onLive } from './livesocket';
import type { ViewContext } from './main';
import { navigate } from './main';
import { announce, state } from './state';
import { Car, loadTrain, renderTrainList } from './views_train';
import { emptyState } from './views_repo';

export type Check = { name: string; state: string; text: string };

export type Thread = {
  id: number;
  position: { path: string; old_line: number | null; new_line: number | null; end_line: number | null; version: number } | null;
  current_line: number | null;
  resolved: boolean;
  outdated: boolean;
  notes: { id: number; author: string; body: string; system: boolean; pending: boolean }[];
  suggestions: { id: number; path: string; start_line: number; end_line: number; lines: string[]; state: string }[];
};

export type RequestBody = {
  iid: number;
  id: number;
  title: string;
  state: string;
  draft: boolean;
  author: string;
  source: string;
  target: string;
  description: string;
  source_head: string | null;
  target_head: string | null;
  merge_base: string | null;
  latest_version: number | null;
  versions: { number: number; base: string; head: string; start: string }[];
  checks: Check[];
  approvals: { rules: { name: string; kind: string; required: number; given: number; optional: boolean; eligible: string[] }[]; approved_by: string[] };
  owners_problems: string[];
  head_pipeline: { id: number; status: string } | null;
  train: { position: number; sha: string; pipeline_id: number | null } | null;
  auto_merge: boolean;
  closes: number[];
  viewing: string[];
  reports: {
    tests: { text: string };
    coverage: { text: string };
    quality: { text: string };
    security: { text: string; findings: { id: number; severity: string; title: string; state: string; path: string; line: number }[] };
  };
  threads: Thread[];
};

export function requestHeader(projectId: number, request: RequestBody): HTMLElement {
  return el('header', { class: 'mr-header dark' }, [
    el('p', { class: 'mono kicker', text: `[ ${request.source} -> ${request.target} ]` }),
    el('p', { class: 'mono id', text: `!${request.iid}` }),
    el('h1', { text: request.title, tabindex: '-1', class: 'mr-title' }),
    el('nav', { 'aria-label': 'Merge request', class: 'mr-nav' }, [
      el('a', { href: `/projects/${projectId}/-/merge_requests/${request.iid}`, text: 'Overview' }),
      el('a', { href: `/projects/${projectId}/-/commits?ref=${request.source}`, text: 'Commits' }),
      el('a', { href: `/projects/${projectId}/-/pipelines?ref=${request.source}`, text: 'Pipelines' }),
      el('a', { href: `/projects/${projectId}/-/merge_requests/${request.iid}/changes`, text: 'Changes' }),
    ]),
  ]);
}

export async function loadRequest(projectId: number, iid: number): Promise<RequestBody | null> {
  return guard(() => api.get<RequestBody>(`/api/projects/${projectId}/merge_requests/${iid}`));
}

export async function renderRequests(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const result = await guard(() =>
    api.get<{ merge_requests: { iid: number; title: string; state: string; source: string; target: string }[] }>(
      `/api/projects/${projectId}/merge_requests`,
    ),
  );
  ctx.main.append(el('h1', { text: 'Merge requests' }));
  if ((result?.merge_requests ?? []).length === 0) {
    ctx.main.append(
      emptyState('// MERGE REQUESTS', 'No merge requests yet', 'Open a merge request', `/projects/${projectId}/-/merge_requests/new`),
    );
    return;
  }
  const list = el('ul', { role: 'list', class: 'rows dark' });
  for (const request of result?.merge_requests ?? []) {
    list.append(
      el('li', {}, [
        el('a', {
          href: `/projects/${projectId}/-/merge_requests/${request.iid}`,
          text: `!${request.iid} ${request.title}`,
        }),
        el('span', { class: 'mono muted', text: `[ ${request.source} -> ${request.target} ] ${request.state}` }),
      ]),
    );
  }
  ctx.main.append(list);
}

export async function renderNewRequest(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const refs = await guard(() => api.get<{ branches: { name: string }[] }>(`/api/projects/${projectId}/refs`));
  const project = await guard(() => api.get<{ default_branch: string }>(`/api/projects/${projectId}`));
  const source = el('select', { 'aria-label': 'Source branch', id: 'source-branch' });
  const target = el('select', { 'aria-label': 'Target branch', id: 'target-branch' });
  for (const branch of refs?.branches ?? []) {
    source.append(el('option', { value: branch.name, text: branch.name }));
    target.append(el('option', { value: branch.name, text: branch.name, selected: branch.name === project?.default_branch }));
  }
  const title = el('input', { type: 'text', 'aria-label': 'Title', id: 'title' });
  const description = el('textarea', { 'aria-label': 'Description', id: 'description', rows: '5' });
  const assignees = el('input', { type: 'text', 'aria-label': 'Assignees', id: 'assignees' });
  const reviewers = el('input', { type: 'text', 'aria-label': 'Reviewers', id: 'reviewers' });
  const deleteSource = el('input', { type: 'checkbox', 'aria-label': 'Delete source branch when merged', id: 'delete-source' });
  const submit = el('button', { type: 'button', 'aria-label': 'Create merge request' }, ['Create merge request']);
  const summary = el('div', { role: 'alert', class: 'error-summary', hidden: true });
  const titleError = el('p', { class: 'field-error', id: 'title-error' });
  title.setAttribute('aria-describedby', 'title-error');
  submit.addEventListener('click', () => {
    void (async () => {
      titleError.textContent = '';
      summary.hidden = true;
      try {
        const result = await api.post<{ iid: number }>(
          `/api/projects/${projectId}/merge_requests`,
          {
            title: title.value,
            source: source.value,
            target: target.value,
            description: description.value,
            assignees: assignees.value.split(' ').filter((item) => item !== ''),
            reviewers: reviewers.value.split(' ').filter((item) => item !== ''),
            delete_source_branch: deleteSource.checked,
          },
          submit as HTMLButtonElement,
        );
        navigate(`/projects/${projectId}/-/merge_requests/${result.iid}`);
      } catch (error) {
        const failure = error as { body?: { message: string; details?: { fields?: Record<string, string> } } };
        const fields = failure.body?.details?.fields ?? {};
        const items: HTMLElement[] = [];
        for (const [field, text] of Object.entries(fields)) {
          if (field === 'title') titleError.textContent = text;
          items.push(el('li', {}, [el('a', { href: `#${field}`, text })]));
        }
        if (items.length === 0 && failure.body !== undefined) {
          items.push(el('li', {}, [el('a', { href: '#title', text: failure.body.message })]));
        }
        summary.replaceChildren(el('h2', { text: 'Fix these problems:' }), el('ul', {}, items));
        summary.hidden = false;
        announce(failure.body?.message ?? 'Could not create the merge request.');
      }
    })();
  });
  ctx.main.append(
    el('h1', { text: 'New merge request' }),
    summary,
    el('div', { class: 'card form' }, [
      el('label', { for: 'source-branch', text: 'Source branch' }),
      source,
      el('label', { for: 'target-branch', text: 'Target branch' }),
      target,
      el('label', { for: 'title', text: 'Title' }),
      title,
      titleError,
      el('label', { for: 'description', text: 'Description' }),
      description,
      el('label', { for: 'assignees', text: 'Assignees' }),
      assignees,
      el('label', { for: 'reviewers', text: 'Reviewers' }),
      reviewers,
      el('label', { for: 'delete-source', text: 'Delete source branch when merged' }),
      deleteSource,
      submit,
    ]),
  );
}

export type PanelHandles = {
  panel: HTMLElement;
  refresh: () => Promise<void>;
};

let previousChecks = new Map<string, string>();

export function buildPanel(projectId: number, request: RequestBody, reload: () => Promise<void>): HTMLElement {
  const checks = el('section', { role: 'region', 'aria-label': 'Merge checks', class: 'card' }, [
    el('h2', { text: 'Merge checks' }),
  ]);
  const checkList = el('ul', { role: 'list', class: 'checks' });
  for (const check of request.checks) {
    const item = el('li', {
      role: 'listitem',
      'aria-label': `Merge check ${check.name}, ${check.state}`,
      'data-check': check.name,
      'data-state': check.state,
      class: `check ${check.state}`,
      text: check.state === 'failed' ? check.text : `${check.name}: ${check.state}`,
    });
    if (previousChecks.get(check.name) !== undefined && previousChecks.get(check.name) !== check.state) {
      play(item, 'check-flip');
    }
    checkList.append(item);
  }
  previousChecks = new Map(request.checks.map((check) => [check.name, check.state]));
  checks.append(checkList);

  const approvals = el('section', { role: 'region', 'aria-label': 'Approvals', class: 'card' }, [
    el('h2', { text: 'Approvals' }),
  ]);
  for (const rule of request.approvals.rules) {
    approvals.append(el('p', { class: 'rule', text: `${rule.name}: ${rule.given} of ${rule.required}` }));
  }
  const approved = state.me !== null && request.approvals.approved_by.includes(state.me.username);
  const approveButton = el('button', { type: 'button', 'aria-label': approved ? 'Revoke approval' : 'Approve' }, [
    approved ? 'Revoke approval' : 'Approve',
  ]);
  approveButton.addEventListener('click', () => {
    void (async () => {
      const path = `/api/projects/${projectId}/merge_requests/${request.iid}/approve`;
      const result = approved
        ? await guard(() => api.del<{ rules: unknown[] }>(path, approveButton as HTMLButtonElement))
        : await guard(() =>
            api.post<{ announcement: string }>(path, { sha: request.source_head }, approveButton as HTMLButtonElement),
          );
      if (result !== null && 'announcement' in (result as Record<string, unknown>)) {
        announce(String((result as { announcement: string }).announcement));
      }
      await reload();
      const next = document.querySelector<HTMLElement>('[aria-label="Revoke approval"]');
      if (next !== null) next.focus();
    })();
  });
  approvals.append(approveButton);

  const problems = el('section', { role: 'region', 'aria-label': 'Owners problems', class: 'card' }, [
    el('h2', { text: 'Owners problems' }),
    ...request.owners_problems.map((problem) => el('p', { text: problem })),
  ]);

  const threads = el('section', { role: 'region', 'aria-label': 'Threads', class: 'card' }, [
    el('h2', { text: 'Threads' }),
    threadList(projectId, request, reload),
  ]);

  const viewing = el('section', { role: 'region', 'aria-label': 'Viewing now', class: 'card' }, [
    el('h2', { text: 'Viewing now' }),
    el('p', { text: request.viewing.join(' ') }),
  ]);

  const reports = el('div', { class: 'reports' }, [
    el('section', { role: 'region', 'aria-label': 'Test summary', class: 'card' }, [
      el('h2', { text: 'Test summary' }),
      el('p', { text: request.reports.tests.text }),
    ]),
    el('section', { role: 'region', 'aria-label': 'Coverage', class: 'card' }, [
      el('h2', { text: 'Coverage' }),
      el('p', { text: request.reports.coverage.text }),
    ]),
    el('section', { role: 'region', 'aria-label': 'Code quality', class: 'card' }, [
      el('h2', { text: 'Code quality' }),
      el('p', { text: request.reports.quality.text }),
    ]),
    securityRegion(projectId, request, reload),
  ]);

  const actions = el('div', { class: 'panel-actions card' });
  if (request.state === 'merged') {
    actions.append(el('h2', { text: `Merged into ${request.target}`, tabindex: '-1', class: 'merged-heading' }));
  } else {
    actions.append(
      mergeButton(projectId, request, reload),
      autoMergeButton(projectId, request, reload),
      trainButton(projectId, request, reload),
      el('button', { type: 'button', 'aria-label': 'Rebase' }, ['Rebase']),
      el('button', { type: 'button', 'aria-label': request.draft ? 'Mark as ready' : 'Close merge request' }, [
        request.draft ? 'Mark as ready' : 'Close merge request',
      ]),
    );
    const rebase = actions.querySelector<HTMLButtonElement>('[aria-label="Rebase"]');
    if (rebase !== null) {
      rebase.addEventListener('click', () => {
        void (async () => {
          await guard(() =>
            api.post(`/api/projects/${projectId}/merge_requests/${request.iid}/rebase`, {}, rebase),
          );
          await reload();
        })();
      });
    }
    const stateButton = actions.querySelector<HTMLButtonElement>(
      request.draft ? '[aria-label="Mark as ready"]' : '[aria-label="Close merge request"]',
    );
    if (stateButton !== null) {
      stateButton.addEventListener('click', () => {
        void (async () => {
          await guard(() =>
            api.patch(
              `/api/projects/${projectId}/merge_requests/${request.iid}`,
              { state_event: request.draft ? 'ready' : 'close' },
              stateButton,
            ),
          );
          await reload();
        })();
      });
    }
  }

  const trainHost = el('ul', { class: 'train' });
  const panel = el('aside', { role: 'complementary', 'aria-label': 'Merge request panel', class: 'panel' }, [
    checks,
    approvals,
    problems,
    threads,
    viewing,
    trainHost,
    reports,
    actions,
  ]);
  void loadTrain(projectId, request.target).then((cars) => renderTrainList(trainHost, cars, new Map()));
  return panel;
}

function securityRegion(projectId: number, request: RequestBody, reload: () => Promise<void>): HTMLElement {
  const region = el('section', { role: 'region', 'aria-label': 'Security', class: 'card' }, [
    el('h2', { text: 'Security' }),
    el('p', { text: request.reports.security.text }),
  ]);
  const reason = el('input', { type: 'text', 'aria-label': 'Dismissal reason' });
  region.append(reason);
  for (const finding of request.reports.security.findings) {
    const row = el('div', { class: 'finding' }, [
      el('p', { text: `${finding.severity} ${finding.title} (${finding.state})` }),
    ]);
    for (const [label, next] of [
      ['Confirm finding', 'confirmed'],
      ['Dismiss finding', 'dismissed'],
      ['Resolve finding', 'resolved'],
      ['Reopen finding', 'detected'],
    ] as const) {
      const control = el('button', { type: 'button', 'aria-label': label }, [label]);
      control.addEventListener('click', () => {
        void (async () => {
          await guard(() =>
            api.patch(
              `/api/projects/${projectId}/findings/${finding.id}`,
              { state: next, reason: reason.value },
              control as HTMLButtonElement,
            ),
          );
          await reload();
        })();
      });
      row.append(control);
    }
    region.append(row);
  }
  return region;
}

function mergeButton(projectId: number, request: RequestBody, reload: () => Promise<void>): HTMLButtonElement {
  const control = el('button', { type: 'button', 'aria-label': 'Merge' }, ['Merge']);
  control.addEventListener('click', () => {
    void (async () => {
      const result = await guard(() =>
        api.post<{ state: string }>(
          `/api/projects/${projectId}/merge_requests/${request.iid}/merge`,
          { sha: request.source_head },
          control as HTMLButtonElement,
        ),
      );
      if (result === null) return;
      announce(`Merged into ${request.target}.`);
      await reload();
      const heading = document.querySelector<HTMLElement>('.merged-heading');
      if (heading !== null) heading.focus();
    })();
  });
  return control;
}

function autoMergeButton(projectId: number, request: RequestBody, reload: () => Promise<void>): HTMLButtonElement {
  const label = request.auto_merge ? 'Cancel auto-merge' : 'Set to auto-merge';
  const control = el('button', { type: 'button', 'aria-label': label }, [label]);
  control.addEventListener('click', () => {
    void (async () => {
      const path = `/api/projects/${projectId}/merge_requests/${request.iid}/auto_merge`;
      if (request.auto_merge) await guard(() => api.del(path, control as HTMLButtonElement));
      else await guard(() => api.post(path, { sha: request.source_head }, control as HTMLButtonElement));
      await reload();
    })();
  });
  return control;
}

function trainButton(projectId: number, request: RequestBody, reload: () => Promise<void>): HTMLElement {
  const wrapper = el('span', { class: 'train-actions' });
  const onTrain = request.train !== null;
  const label = onTrain ? 'Remove from train' : 'Add to merge train';
  const control = el('button', { type: 'button', 'aria-label': label }, [label]);
  control.addEventListener('click', () => {
    void (async () => {
      const path = `/api/projects/${projectId}/merge_requests/${request.iid}/train`;
      if (onTrain) await guard(() => api.del(path, control as HTMLButtonElement));
      else await guard(() => api.post(path, {}, control as HTMLButtonElement));
      await reload();
      const car = document.querySelector<HTMLElement>(`[data-iid="${request.iid}"]`);
      if (car !== null) car.focus();
    })();
  });
  const now = el('button', { type: 'button', 'aria-label': 'Merge now' }, ['Merge now']);
  now.addEventListener('click', () => {
    void (async () => {
      await guard(() =>
        api.post(`/api/projects/${projectId}/merge_requests/${request.iid}/train/merge_now`, {}, now as HTMLButtonElement),
      );
      await reload();
    })();
  });
  wrapper.append(control, now);
  return wrapper;
}

function threadList(projectId: number, request: RequestBody, reload: () => Promise<void>): HTMLElement {
  const list = el('div', { class: 'threads' });
  for (const thread of request.threads) {
    const place =
      thread.position === null
        ? 'merge request'
        : thread.position.end_line !== null
          ? `${thread.position.path} lines ${thread.position.new_line ?? thread.position.old_line}-${thread.position.end_line}`
          : `${thread.position.path} line ${thread.position.new_line ?? thread.position.old_line}`;
    const label =
      thread.position === null
        ? `Thread on merge request, ${thread.resolved ? 'resolved' : 'unresolved'}`
        : `Thread on ${place}, ${thread.resolved ? 'resolved' : 'unresolved'}`;
    const article = el('article', {
      'aria-label': label,
      'data-thread': String(thread.id),
      'data-outdated': thread.outdated ? 'true' : 'false',
      'data-resolved': thread.resolved ? 'true' : 'false',
      tabindex: '0',
      class: 'thread',
    });
    if (thread.outdated) article.append(el('p', { class: 'badge', text: 'Outdated' }));
    for (const note of thread.notes) {
      article.append(el('p', { class: 'note' }, [el('strong', { text: `${note.author}: ` }), note.body]));
    }
    for (const suggestion of thread.suggestions) {
      const apply = el('button', { type: 'button', 'aria-label': 'Apply suggestion' }, ['Apply suggestion']);
      apply.addEventListener('click', () => {
        void (async () => {
          await guard(() =>
            api.post(
              `/api/projects/${projectId}/merge_requests/${request.iid}/suggestions/apply`,
              { ids: [suggestion.id] },
              apply as HTMLButtonElement,
            ),
          );
          await reload();
        })();
      });
      const batch = el('button', { type: 'button', 'aria-label': 'Add to batch' }, ['Add to batch']);
      article.append(apply, batch);
    }
    const resolve = el('button', {
      type: 'button',
      'aria-label': thread.resolved ? 'Reopen thread' : 'Resolve thread',
    }, [thread.resolved ? 'Reopen thread' : 'Resolve thread']);
    resolve.addEventListener('click', () => {
      void (async () => {
        const result = await guard(() =>
          api.patch<{ unresolved: number }>(
            `/api/projects/${projectId}/merge_requests/${request.iid}/threads/${thread.id}`,
            { resolved: !thread.resolved },
            resolve as HTMLButtonElement,
          ),
        );
        if (result !== null && !thread.resolved) {
          announce(
            result.unresolved === 0
              ? 'Thread resolved. No unresolved threads left.'
              : result.unresolved === 1
                ? 'Thread resolved. 1 unresolved thread left.'
                : `Thread resolved. ${result.unresolved} unresolved threads left.`,
          );
        } else if (result !== null) {
          announce('Thread reopened.');
        }
        await reload();
        const row = document.querySelector<HTMLElement>(
          `[data-line-key="${thread.position?.path ?? ''}:${thread.current_line ?? thread.position?.new_line ?? 0}"]`,
        );
        if (row !== null) row.focus();
      })();
    });
    const reply = el('textarea', { 'aria-label': 'Reply', rows: '2' });
    const replyButton = el('button', { type: 'button', 'aria-label': 'Reply' }, ['Reply']);
    replyButton.addEventListener('click', () => {
      void (async () => {
        await guard(() =>
          api.post(
            `/api/projects/${projectId}/merge_requests/${request.iid}/threads/${thread.id}/notes`,
            { body: reply.value },
            replyButton as HTMLButtonElement,
          ),
        );
        await reload();
      })();
    });
    const move = el('button', { type: 'button', 'aria-label': 'Move to issue' }, ['Move to issue']);
    move.addEventListener('click', () => {
      void (async () => {
        const result = await guard(() =>
          api.post<{ issue_iid: number; moved: number }>(
            `/api/projects/${projectId}/merge_requests/${request.iid}/threads/move_to_issue`,
            {},
            move as HTMLButtonElement,
          ),
        );
        if (result !== null) {
          announce(
            result.moved === 1
              ? `Moved 1 thread to #${result.issue_iid}.`
              : `Moved ${result.moved} threads to #${result.issue_iid}.`,
          );
        }
        await reload();
      })();
    });
    article.append(resolve, reply, replyButton, move);
    list.append(article);
  }
  return list;
}

function bottomSheet(projectId: number, request: RequestBody, reload: () => Promise<void>, files: HTMLElement): HTMLElement {
  const sheet = el('div', { role: 'dialog', 'aria-label': 'Panel', class: 'sheet bottom', hidden: true });
  const tabs = el('div', { role: 'tablist', 'aria-label': 'Panel tabs' });
  const panes = el('div', { class: 'panes' });
  const panel = buildPanel(projectId, request, reload);
  const checksPane = el('div', { role: 'tabpanel', 'aria-label': 'Checks' }, [panel]);
  const threadsPane = el('div', { role: 'tabpanel', 'aria-label': 'Threads', hidden: true }, [
    threadList(projectId, request, reload),
  ]);
  const filesPane = el('div', { role: 'tabpanel', 'aria-label': 'Files', hidden: true }, [files]);
  for (const [label, pane] of [
    ['Checks', checksPane],
    ['Threads', threadsPane],
    ['Files', filesPane],
  ] as const) {
    const tab = el('button', { type: 'button', role: 'tab', 'aria-label': label, 'aria-selected': label === 'Checks' ? 'true' : 'false' }, [
      label,
    ]);
    tab.addEventListener('click', () => {
      for (const other of tabs.querySelectorAll('[role="tab"]')) other.setAttribute('aria-selected', 'false');
      tab.setAttribute('aria-selected', 'true');
      checksPane.hidden = label !== 'Checks';
      threadsPane.hidden = label !== 'Threads';
      filesPane.hidden = label !== 'Files';
    });
    tabs.append(tab);
  }
  panes.append(checksPane, threadsPane, filesPane);
  sheet.append(tabs, panes);
  return sheet;
}

export async function renderRequest(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const iid = Number(ctx.params.iid);
  connect(projectId);
  const host = el('div', { class: 'mr-layout' });
  ctx.main.append(host);
  const reload = async (): Promise<void> => {
    const request = await loadRequest(projectId, iid);
    if (request === null) return;
    clear(host);
    const files = el('nav', { 'aria-label': 'Files', class: 'file-list' });
    host.append(requestHeader(projectId, request));
    const centre = el('div', { class: 'centre' });
    centre.append(
      el('p', { class: 'description', text: request.description }),
      el('section', { role: 'region', 'aria-label': 'Closing issues', class: 'card' }, [
        el('p', {
          text:
            request.closes.length === 0
              ? 'Merging closes no issues.'
              : request.closes.length === 1
                ? `Merging closes 1 issue: #${request.closes[0]}.`
                : `Merging closes ${request.closes.length} issues: ${request.closes.map((id) => `#${id}`).join(', ')}.`,
        }),
      ]),
    );
    const filter = el('select', { 'aria-label': 'Activity filter' }, [
      el('option', { value: 'all', text: 'All activity' }),
      el('option', { value: 'comments', text: 'Comments only' }),
      el('option', { value: 'history', text: 'History only' }),
    ]);
    const activity = el('div', { class: 'activity-list' });
    const loadNotes = async (): Promise<void> => {
      const notes = await guard(() =>
        api.get<{ notes: { id: number; author: string; body: string; system: boolean }[] }>(
          `/api/projects/${projectId}/merge_requests/${iid}/notes?filter=${filter.value}`,
        ),
      );
      clear(activity);
      for (const note of notes?.notes ?? []) {
        activity.append(
          el('p', { class: note.system ? 'system-note' : 'note' }, [
            el('strong', { text: `${note.author}: ` }),
            note.body,
          ]),
        );
      }
    };
    filter.addEventListener('change', () => {
      void loadNotes();
    });
    const comment = el('textarea', { 'aria-label': 'Comment', rows: '3' });
    const commentButton = el('button', { type: 'button', 'aria-label': 'Comment' }, ['Comment']);
    commentButton.addEventListener('click', () => {
      void (async () => {
        await guard(() =>
          api.post(
            `/api/projects/${projectId}/merge_requests/${iid}/threads`,
            { body: comment.value, position: null },
            commentButton as HTMLButtonElement,
          ),
        );
        comment.value = '';
        await reload();
      })();
    });
    centre.append(filter, activity, comment, commentButton);
    await loadNotes();
    const panel = buildPanel(projectId, request, reload);
    const openPanel = el('button', { type: 'button', 'aria-label': 'Open panel', class: 'phone-only' }, ['Open panel']);
    const sheet = bottomSheet(projectId, request, reload, files);
    openPanel.addEventListener('click', () => {
      sheet.hidden = false;
      play(sheet, 'sheet-rise');
      const first = sheet.querySelector<HTMLElement>('[role="tab"]');
      if (first !== null) first.focus();
      const release = trapFocus(sheet, openPanel, () => {
        sheet.hidden = true;
        release();
      });
    });
    host.append(openPanel, el('div', { class: 'panes-3' }, [files, centre, panel]), sheet);
  };
  await reload();
  onLive((message) => {
    const data = message.data as { announcement?: string; iid?: number; recipient?: string };
    if (typeof data.announcement === 'string') {
      if (data.recipient === undefined || (state.me !== null && data.recipient === state.me.username)) {
        announce(data.announcement);
      }
    }
    if (['merge_request', 'thread', 'approvals', 'checks', 'review', 'train', 'version'].includes(message.type)) {
      void reload();
    }
  });
  const heading = ctx.main.querySelector<HTMLElement>('.mr-title');
  if (heading !== null) heading.focus();
}

type DiffLine = { type: string; old: number | null; new: number | null; text: string };
type DiffFile = { path: string; hunks: { header: string; lines: DiffLine[] }[] };

export async function renderChanges(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const iid = Number(ctx.params.iid);
  connect(projectId);
  let view = ctx.query.get('view') === 'split' ? 'split' : 'inline';
  const from = ctx.query.get('from') ?? 'target';
  const to = ctx.query.get('to');
  let currentFile = ctx.query.get('file');
  let currentLine = ctx.query.get('line') === null ? null : Number(ctx.query.get('line'));
  let reviewOpen = false;
  let pendingCount = 0;
  let rangeAnchor: number | null = null;

  const host = el('div', { class: 'mr-layout' });
  ctx.main.append(host);

  const updateUrl = (): void => {
    const params = new URLSearchParams();
    if (currentFile !== null) params.set('file', currentFile);
    if (currentLine !== null) params.set('line', String(currentLine));
    params.set('view', view);
    params.set('from', from);
    if (to !== null) params.set('to', to);
    window.history.replaceState({}, '', `/projects/${projectId}/-/merge_requests/${iid}/changes?${params.toString()}`);
  };

  const reload = async (): Promise<void> => {
    const request = await loadRequest(projectId, iid);
    if (request === null) return;
    const diff = await guard(() =>
      api.get<{ diffs: DiffFile[] }>(
        `/api/projects/${projectId}/merge_requests/${iid}/diff?from=${from}${to === null ? '' : `&to=${to}`}`,
      ),
    );
    const files = diff?.diffs ?? [];
    const latestVersion = request.latest_version ?? 1;
    clear(host);
    host.append(requestHeader(projectId, request));
    const fileNav = el('nav', { 'aria-label': 'Files', class: 'file-list', tabindex: '-1' });
    for (const file of files) {
      const link = el('button', { type: 'button', 'aria-label': file.path, 'data-file': file.path }, [file.path]);
      link.addEventListener('click', () => {
        currentFile = file.path;
        updateUrl();
        void reload();
      });
      fileNav.append(link);
    }
    const grid = el('div', { role: 'grid', 'aria-label': 'Diff', class: 'diff dark mono', 'data-view': view });
    const threads = request.threads;
    const shown = currentFile === null ? files : files.filter((file) => file.path === currentFile);
    for (const file of shown) {
      grid.append(
        el('div', { class: 'file-header strip-surface' }, [
          el('p', { class: 'mono', text: file.path }),
          contextButton('Expand context above'),
          contextButton('Expand context below'),
        ]),
      );
      for (const hunk of file.hunks) {
        grid.append(el('div', { class: 'hunk mono', text: hunk.header }));
        for (const line of hunk.lines) {
          const number = line.type === 'del' ? line.old : line.new;
          const kind = line.type === 'add' ? 'added' : line.type === 'del' ? 'removed' : 'unchanged';
          const open = threads.filter(
            (thread) =>
              !thread.resolved &&
              thread.position !== null &&
              thread.position.path === file.path &&
              (thread.current_line ?? thread.position.new_line ?? thread.position.old_line) === number,
          ).length;
          const suffix = open === 0 ? '' : open === 1 ? ', 1 unresolved thread' : `, ${open} unresolved threads`;
          const row = el('div', {
            role: 'row',
            'aria-label': `Line ${number ?? 0} ${kind}, ${file.path}${suffix}`,
            tabindex: '-1',
            class: `diff-line ${line.type}`,
            'data-file': file.path,
            'data-line': String(number ?? 0),
            'data-kind': kind,
            'data-line-key': `${file.path}:${number ?? 0}`,
          }, [
            el('span', { role: 'gridcell', class: 'num', text: String(number ?? '') }),
            el('span', { role: 'gridcell', class: 'text', text: line.text }),
          ]);
          row.addEventListener('click', (event) => {
            currentFile = file.path;
            currentLine = number;
            updateUrl();
            if ((event as MouseEvent).shiftKey && rangeAnchor !== null) {
              openCommentBox(row, file.path, rangeAnchor, number ?? 0);
            }
            rangeAnchor = number;
          });
          grid.append(row);
        }
      }
    }
    const viewButtons = el('div', { class: 'view-toggle' }, [
      toggleButton('Inline view', view === 'inline', () => {
        view = 'inline';
        updateUrl();
        void reload();
      }),
      toggleButton('Side-by-side view', view === 'split', () => {
        view = 'split';
        updateUrl();
        void reload();
      }),
    ]);
    const compareFrom = el('select', { 'aria-label': 'Compare from' }, [
      el('option', { value: 'target', text: 'Target branch', selected: from === 'target' }),
      ...request.versions.map((version) =>
        el('option', { value: String(version.number), text: `Version ${version.number}`, selected: from === String(version.number) }),
      ),
    ]);
    const compareTo = el('select', { 'aria-label': 'Compare to' }, [
      ...request.versions.map((version) =>
        el('option', {
          value: String(version.number),
          text: `Version ${version.number}`,
          selected: to === String(version.number) || (to === null && version.number === request.latest_version),
        }),
      ),
    ]);
    const applyCompare = (): void => {
      const params = new URLSearchParams();
      if (currentFile !== null) params.set('file', currentFile);
      params.set('view', view);
      params.set('from', compareFrom.value);
      params.set('to', compareTo.value);
      navigate(`/projects/${projectId}/-/merge_requests/${iid}/changes?${params.toString()}`);
    };
    compareFrom.addEventListener('change', applyCompare);
    compareTo.addEventListener('change', applyCompare);

    const finish = el('button', { type: 'button', 'aria-label': 'Finish review' }, ['Finish review']);
    const submitDialog = el('div', { role: 'dialog', 'aria-label': 'Submit review', class: 'sheet', hidden: true });
    const summary = el('textarea', { 'aria-label': 'Summary', rows: '3' });
    const submit = el('button', { type: 'button', 'aria-label': 'Submit review' }, ['Submit review']);
    const discard = el('button', { type: 'button', 'aria-label': 'Discard review' }, ['Discard review']);
    const pendingText = el('p', { class: 'pending-count', text: `Pending comments: ${pendingCount}` });
    submitDialog.append(el('h2', { text: 'Submit review' }), pendingText, summary, submit, discard);
    let lastRow: HTMLElement | null = null;
    finish.addEventListener('click', () => {
      lastRow = grid.querySelector<HTMLElement>('[role="row"]:focus') ?? lastRow;
      submitDialog.hidden = false;
      summary.focus();
      const release = trapFocus(submitDialog, finish, () => {
        submitDialog.hidden = true;
        release();
      });
    });
    submit.addEventListener('click', () => {
      void (async () => {
        const result = await guard(() =>
          api.post<{ published: number }>(
            `/api/projects/${projectId}/merge_requests/${iid}/review`,
            { summary: summary.value },
            submit as HTMLButtonElement,
          ),
        );
        submitDialog.hidden = true;
        if (result !== null) {
          announce(
            result.published === 1 ? 'Review submitted: 1 comment' : `Review submitted: ${result.published} comments`,
          );
        }
        reviewOpen = false;
        pendingCount = 0;
        await reload();
        const target = lastRow === null ? null : grid.querySelector<HTMLElement>(`[data-line-key="${lastRow.dataset.lineKey ?? ''}"]`);
        if (target !== null) target.focus();
      })();
    });
    discard.addEventListener('click', () => {
      void (async () => {
        await guard(() => api.del(`/api/projects/${projectId}/merge_requests/${iid}/review`, discard as HTMLButtonElement));
        submitDialog.hidden = false;
        reviewOpen = false;
        pendingCount = 0;
        submitDialog.hidden = true;
        await reload();
      })();
    });

    const panel = buildPanel(projectId, request, reload);
    const openPanel = el('button', { type: 'button', 'aria-label': 'Open panel', class: 'phone-only' }, ['Open panel']);
    const sheet = bottomSheet(projectId, request, reload, fileNav.cloneNode(true) as HTMLElement);
    openPanel.addEventListener('click', () => {
      sheet.hidden = false;
      play(sheet, 'sheet-rise');
      const first = sheet.querySelector<HTMLElement>('[role="tab"]');
      if (first !== null) first.focus();
      const release = trapFocus(sheet, openPanel, () => {
        sheet.hidden = true;
        release();
      });
    });
    const centre = el('div', { class: 'centre' }, [viewButtons, compareFrom, compareTo, finish, submitDialog, grid]);
    host.append(
      el('button', { type: 'button', 'aria-label': 'Show files', class: 'tablet-only' }, ['Show files']),
      openPanel,
      el('div', { class: 'panes-3' }, [fileNav, centre, panel]),
      sheet,
    );

    const rows = (): HTMLElement[] => [...grid.querySelectorAll<HTMLElement>('[role="row"]')];
    const focusRow = (row: HTMLElement | undefined): void => {
      if (row === undefined) return;
      row.tabIndex = 0;
      row.focus();
      row.scrollIntoView({ block: 'center' });
      currentFile = row.dataset.file ?? currentFile;
      currentLine = Number(row.dataset.line ?? '0');
      updateUrl();
    };

    const openCommentBoxFor = (row: HTMLElement, start: number, end: number): void => {
      openCommentBox(row, row.dataset.file ?? '', start, end);
    };

    function openCommentBox(row: HTMLElement, path: string, start: number, end: number): void {
      const existing = grid.querySelector('.comment-box');
      if (existing !== null) existing.remove();
      const label = start === end ? `Comment on line ${start}` : `Comment on lines ${start}-${end}`;
      const box = el('div', { class: 'comment-box' });
      const area = el('textarea', { 'aria-label': label, rows: '3' });
      const add = el('button', { type: 'button', 'aria-label': 'Add comment' }, ['Add comment']);
      const startReview = el('button', { type: 'button', 'aria-label': 'Start review' }, ['Start review']);
      const addToReview = el('button', { type: 'button', 'aria-label': 'Add to review' }, ['Add to review']);
      const cancel = el('button', { type: 'button', 'aria-label': 'Cancel' }, ['Cancel']);
      const post = async (pending: boolean): Promise<void> => {
        await guard(() =>
          api.post(
            `/api/projects/${projectId}/merge_requests/${iid}/threads`,
            {
              body: area.value,
              pending,
              position: {
                path,
                old_line: row.dataset.kind === 'removed' ? start : null,
                new_line: row.dataset.kind === 'removed' ? null : start,
                end_line: end === start ? null : end,
                version: latestVersion,
              },
            },
            add as HTMLButtonElement,
          ),
        );
        if (pending) pendingCount += 1;
        box.remove();
        await reload();
        const target = grid.querySelector<HTMLElement>(`[data-line-key="${path}:${start}"]`);
        if (target !== null) target.focus();
      };
      add.addEventListener('click', () => void post(false));
      startReview.addEventListener('click', () => {
        reviewOpen = true;
        void post(true);
      });
      addToReview.addEventListener('click', () => void post(true));
      cancel.addEventListener('click', () => {
        box.remove();
        row.focus();
      });
      area.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void post(reviewOpen);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          box.remove();
          row.focus();
        }
      });
      box.append(area, add, reviewOpen ? addToReview : startReview, cancel);
      row.after(box);
      area.focus();
    }

    grid.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
      const all = rows();
      const index = all.indexOf(target.closest('[role="row"]') as HTMLElement);
      if (event.key === 'j') {
        event.preventDefault();
        focusRow(all[index + 1]);
        return;
      }
      if (event.key === 'k') {
        event.preventDefault();
        focusRow(all[Math.max(0, index - 1)]);
        return;
      }
      if (event.key === 'n' || event.key === 'p') {
        event.preventDefault();
        const file = all[index]?.dataset.file ?? '';
        const paths = [...new Set(all.map((row) => row.dataset.file ?? ''))];
        const position = paths.indexOf(file);
        const nextFile = paths[event.key === 'n' ? position + 1 : position - 1];
        if (nextFile === undefined) return;
        focusRow(all.find((row) => row.dataset.file === nextFile));
        return;
      }
      if (event.key === ']' || event.key === '[') {
        event.preventDefault();
        const articles = [...document.querySelectorAll<HTMLElement>('article[data-resolved="false"]')];
        if (articles.length === 0) return;
        const active = articles.findIndex((article) => article === document.activeElement);
        const next = articles[(active + (event.key === ']' ? 1 : -1) + articles.length) % articles.length];
        next.focus();
        return;
      }
      if (event.key === 'c') {
        event.preventDefault();
        const row = all[index];
        if (row === undefined) return;
        const line = Number(row.dataset.line ?? '0');
        openCommentBoxFor(row, rangeAnchor ?? line, line);
        return;
      }
      if (event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const row = all[index];
        if (row === undefined) return;
        const line = Number(row.dataset.line ?? '0');
        if (rangeAnchor === null) rangeAnchor = line;
        const next = all[event.key === 'ArrowDown' ? index + 1 : index - 1];
        if (next === undefined) return;
        focusRow(next);
        const end = Number(next.dataset.line ?? '0');
        openCommentBoxFor(next, Math.min(rangeAnchor, end), Math.max(rangeAnchor, end));
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'e') return;
      const article = document.activeElement?.closest('article[data-thread]');
      if (article === null || article === undefined) return;
      const resolve = article.querySelector<HTMLButtonElement>('[aria-label="Resolve thread"]');
      if (resolve !== null) resolve.click();
    });

    wireTouch(grid, shown, (path) => {
      currentFile = path;
      updateUrl();
      void reload();
    }, projectId, iid, latestVersion, reload);

    if (currentLine !== null && currentFile !== null) {
      const row = grid.querySelector<HTMLElement>(`[data-line-key="${currentFile}:${currentLine}"]`);
      if (row !== null) focusRow(row);
    }
  };
  await reload();
  onLive((message) => {
    const data = message.data as { announcement?: string; recipient?: string };
    if (typeof data.announcement === 'string') {
      if (data.recipient === undefined || (state.me !== null && data.recipient === state.me.username)) {
        announce(data.announcement);
      }
    }
    if (['thread', 'review', 'approvals', 'checks', 'version', 'merge_request'].includes(message.type)) {
      void reload();
    }
  });
}

function toggleButton(label: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const control = el('button', { type: 'button', 'aria-label': label, 'aria-pressed': pressed ? 'true' : 'false' }, [
    label,
  ]);
  control.addEventListener('click', onClick);
  return control;
}

function contextButton(label: string): HTMLButtonElement {
  return el('button', { type: 'button', 'aria-label': label, 'data-expand': '20' }, [label]);
}

function wireTouch(
  grid: HTMLElement,
  files: DiffFile[],
  changeFile: (path: string) => void,
  projectId: number,
  iid: number,
  version: number,
  reload: () => Promise<void>,
): void {
  let startX = 0;
  let startY = 0;
  let timer = 0;
  grid.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      const row = (event.target as HTMLElement).closest('[role="row"]');
      if (row === null) return;
      timer = window.setTimeout(() => {
        openLineSheet(row as HTMLElement, projectId, iid, version, reload);
      }, 500);
    },
    { passive: true },
  );
  grid.addEventListener(
    'touchmove',
    (event) => {
      const touch = event.touches[0];
      if (Math.abs(touch.clientX - startX) > 8 || Math.abs(touch.clientY - startY) > 8) {
        window.clearTimeout(timer);
      }
    },
    { passive: true },
  );
  grid.addEventListener(
    'touchend',
    (event) => {
      window.clearTimeout(timer);
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) <= 80 || Math.abs(dy) >= 40) return;
      const paths = files.map((file) => file.path);
      const row = grid.querySelector<HTMLElement>('[role="row"]');
      const current = row?.dataset.file ?? paths[0];
      const index = paths.indexOf(current);
      const next = dx < 0 ? index + 1 : index - 1;
      const all = [...new Set(paths)];
      const target = all[next];
      if (target === undefined) return;
      changeFile(target);
      announce(`File ${next + 1} of ${all.length}: ${target}`);
    },
    { passive: true },
  );
}

function openLineSheet(
  row: HTMLElement,
  projectId: number,
  iid: number,
  version: number,
  reload: () => Promise<void>,
): void {
  const line = Number(row.dataset.line ?? '0');
  const sheet = el('div', { role: 'dialog', 'aria-label': `Comment on line ${line}`, class: 'sheet bottom' });
  const area = el('textarea', { 'aria-label': 'Comment', rows: '3' });
  const add = el('button', { type: 'button', 'aria-label': 'Add comment' }, ['Add comment']);
  const startReview = el('button', { type: 'button', 'aria-label': 'Start review' }, ['Start review']);
  const cancel = el('button', { type: 'button', 'aria-label': 'Cancel' }, ['Cancel']);
  const post = async (pending: boolean): Promise<void> => {
    await guard(() =>
      api.post(
        `/api/projects/${projectId}/merge_requests/${iid}/threads`,
        {
          body: area.value,
          pending,
          position: {
            path: row.dataset.file ?? '',
            old_line: row.dataset.kind === 'removed' ? line : null,
            new_line: row.dataset.kind === 'removed' ? null : line,
            end_line: null,
            version,
          },
        },
        add as HTMLButtonElement,
      ),
    );
    sheet.remove();
    await reload();
  };
  add.addEventListener('click', () => void post(false));
  startReview.addEventListener('click', () => void post(true));
  cancel.addEventListener('click', () => {
    sheet.remove();
    row.focus();
  });
  sheet.append(area, add, startReview, cancel);
  document.body.append(sheet);
  play(sheet, 'sheet-rise');
  area.focus();
  const release = trapFocus(sheet, row, () => {
    sheet.remove();
    release();
  });
}

export async function renderConflicts(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const iid = Number(ctx.params.iid);
  const result = await guard(() =>
    api.get<{ files: { path: string; content: string }[]; source: string; target: string }>(
      `/api/projects/${projectId}/merge_requests/${iid}/conflicts`,
    ),
  );
  if (result === null) return;
  ctx.main.append(el('h1', { text: 'Resolve conflicts' }));
  const choices = new Map<string, string[]>();
  const editors = new Map<string, HTMLTextAreaElement>();
  for (const file of result.files) {
    const hunks = file.content.split('\n').filter((line) => line.startsWith('<<<<<<< ')).length;
    const section = el('section', { class: 'file dark' }, [
      el('div', { class: 'file-header strip-surface' }, [el('p', { class: 'mono', text: file.path })]),
    ]);
    choices.set(file.path, new Array(hunks).fill('ours'));
    for (let index = 0; index < hunks; index += 1) {
      const ours = el('button', { type: 'button', 'aria-label': 'Use ours' }, ['Use ours']);
      const theirs = el('button', { type: 'button', 'aria-label': 'Use theirs' }, ['Use theirs']);
      ours.addEventListener('click', () => {
        const list = choices.get(file.path) ?? [];
        list[index] = 'ours';
      });
      theirs.addEventListener('click', () => {
        const list = choices.get(file.path) ?? [];
        list[index] = 'theirs';
      });
      section.append(ours, theirs);
    }
    const area = el('textarea', { 'aria-label': 'Conflict editor', class: 'mono editor', rows: '12' });
    area.value = file.content;
    editors.set(file.path, area);
    const inline = el('button', { type: 'button', 'aria-label': 'Edit inline' }, ['Edit inline']);
    section.append(inline, area);
    ctx.main.append(section);
  }
  const commit = el('button', { type: 'button', 'aria-label': 'Commit resolution' }, ['Commit resolution']);
  commit.addEventListener('click', () => {
    void (async () => {
      const files = result.files.map((file) => {
        const area = editors.get(file.path);
        if (area !== undefined && area.value !== file.content) return { path: file.path, content: area.value };
        return { path: file.path, hunks: choices.get(file.path) ?? [] };
      });
      const outcome = await guard(() =>
        api.post<{ commit: string }>(
          `/api/projects/${projectId}/merge_requests/${iid}/conflicts`,
          { files },
          commit as HTMLButtonElement,
        ),
      );
      if (outcome === null) return;
      navigate(`/projects/${projectId}/-/merge_requests/${iid}`);
      window.setTimeout(() => {
        const region = document.querySelector<HTMLElement>('[aria-label="Merge checks"]');
        if (region !== null) {
          region.tabIndex = -1;
          region.focus();
        }
      }, 50);
    })();
  });
  ctx.main.append(commit);
}

export async function renderTrain(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const project = await guard(() => api.get<{ default_branch: string }>(`/api/projects/${projectId}`));
  if (project === null) return;
  const target = ctx.query.get('target') ?? project.default_branch;
  connect(projectId);
  ctx.main.append(el('h1', { text: `Merge train for ${target}` }));
  const host = el('ul', { class: 'train dark' });
  ctx.main.append(host);
  let previous = new Map<number, Car>();
  const reload = async (): Promise<void> => {
    const cars = await loadTrain(projectId, target);
    if (cars.length === 0 && previous.size === 0) {
      clear(host);
      host.append(el('li', {}, [emptyState('// MERGE TRAIN', 'The train is empty', 'Open merge requests', `/projects/${projectId}/-/merge_requests`)]));
      return;
    }
    renderTrainList(host, cars, previous);
    previous = new Map(cars.map((car) => [car.iid, car]));
  };
  await reload();
  onLive((message) => {
    const data = message.data as { announcement?: string; recipient?: string };
    if (typeof data.announcement === 'string') {
      if (data.recipient === undefined || (state.me !== null && data.recipient === state.me.username)) {
        announce(data.announcement);
      }
    }
    if (message.type === 'train' || message.type === 'pipeline') void reload();
  });
}
