import { api, guard } from './api';
import { clear, el } from './dom';
import { connect, onLive } from './livesocket';
import type { ViewContext } from './main';
import { navigate } from './main';
import { announce } from './state';
import { emptyState } from './views_repo';

export async function renderWiki(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const slug = ctx.params.slug;
  connect(projectId);
  const page = await guard(() =>
    api.get<{ slug: string; version: number; title: string; content: string; html: string }>(
      `/api/projects/${projectId}/wiki/${slug}`,
    ),
  );
  if (page === null) return;
  if (page.version === 0) {
    ctx.main.append(emptyState('// WIKI', 'No wiki pages yet', 'Create the first page', `/projects/${projectId}/-/wiki/home`));
  }
  const title = el('input', { type: 'text', 'aria-label': 'Page title' });
  title.value = page.title;
  const content = el('textarea', { 'aria-label': 'Page content', class: 'mono editor', rows: '14' });
  content.value = page.content;
  const save = el('button', { type: 'button', 'aria-label': 'Save page' }, ['Save page']);
  save.addEventListener('click', () => {
    void (async () => {
      const result = await guard(() =>
        api.put<{ version: number; html: string }>(
          `/api/projects/${projectId}/wiki/${slug}`,
          { title: title.value, content: content.value, base_version: page.version },
          save as HTMLButtonElement,
        ),
      );
      if (result === null) return;
      navigate(`/projects/${projectId}/-/wiki/${slug}`);
    })();
  });
  ctx.main.append(
    el('h1', { text: page.title === '' ? slug : page.title }),
    el('div', { class: 'wiki-body', html: page.html }),
    el('div', { class: 'card form' }, [el('label', { text: 'Page title' }), title, el('label', { text: 'Page content' }), content, save]),
    el('a', { href: `/projects/${projectId}/-/wiki/${slug}/history`, text: 'History' }),
  );
}

export async function renderWikiHistory(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const slug = ctx.params.slug;
  const from = ctx.query.get('from') ?? '';
  const to = ctx.query.get('to') ?? '';
  const result = await guard(() =>
    api.get<{ versions: { version: number; title: string; author: string }[]; diff: { type: string; text: string }[] | null }>(
      `/api/projects/${projectId}/wiki/${slug}/versions?from=${from}&to=${to}`,
    ),
  );
  if (result === null) return;
  ctx.main.append(el('h1', { text: `History of ${slug}` }));
  const fromSelect = el('select', { 'aria-label': 'Compare from' }, result.versions.map((version) =>
    el('option', { value: String(version.version), text: `Version ${version.version}`, selected: from === String(version.version) }),
  ));
  const toSelect = el('select', { 'aria-label': 'Compare to' }, result.versions.map((version) =>
    el('option', { value: String(version.version), text: `Version ${version.version}`, selected: to === String(version.version) }),
  ));
  const compare = (): void => {
    navigate(`/projects/${projectId}/-/wiki/${slug}/history?from=${fromSelect.value}&to=${toSelect.value}`);
  };
  fromSelect.addEventListener('change', compare);
  toSelect.addEventListener('change', compare);
  ctx.main.append(fromSelect, toSelect);
  for (const version of result.versions) {
    const restore = el('button', { type: 'button', 'aria-label': 'Restore this version' }, ['Restore this version']);
    restore.addEventListener('click', () => {
      void (async () => {
        await guard(() =>
          api.post(
            `/api/projects/${projectId}/wiki/${slug}/restore`,
            { version: version.version },
            restore as HTMLButtonElement,
          ),
        );
        navigate(`/projects/${projectId}/-/wiki/${slug}`);
      })();
    });
    ctx.main.append(el('p', {}, [`Version ${version.version} by ${version.author} `, restore]));
  }
  if (result.diff !== null) {
    const block = el('div', { class: 'diff dark mono' });
    for (const line of result.diff) {
      block.append(el('p', { class: `diff-line ${line.type}`, text: line.text }));
    }
    ctx.main.append(block);
  }
}

export async function renderSettings(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  connect(projectId);
  const project = await guard(() =>
    api.get<{ settings: Record<string, unknown>; default_branch: string; path: string }>(`/api/projects/${projectId}`),
  );
  if (project === null) return;
  const refs = await guard(() => api.get<{ branches: { name: string; protected: boolean }[]; tags: { name: string }[] }>(`/api/projects/${projectId}/refs`));
  const rules = await guard(() => api.get<{ webhooks: { id: number; url: string; events: string[] }[] }>(`/api/projects/${projectId}/webhooks`).catch(() => ({ webhooks: [] })));
  ctx.main.append(el('h1', { text: 'Settings' }));
  const host = el('div', { class: 'settings light' });
  ctx.main.append(host);

  host.append(
    settingsCard('Protected branches', 'Who may push and merge.', [
      el(
        'ul',
        { role: 'list' },
        (refs?.branches ?? []).filter((branch) => branch.protected).map((branch) => el('li', { text: branch.name })),
      ),
    ]),
    settingsCard('Protected tags', 'Who may create release tags.', [
      el('ul', { role: 'list' }, (refs?.tags ?? []).map((tag) => el('li', { text: tag.name }))),
    ]),
    settingsCard('Push rules', 'Checks every commit must pass.', [el('p', { text: 'Secret detection and file rules.' })]),
    settingsCard('Approval rules', 'Who must approve a merge request.', [el('p', { text: 'Rules apply on protected branches.' })]),
    settingsCard('Merge settings', 'How merge requests land.', mergeSettings(projectId, project.settings)),
    settingsCard('Protected environments', 'Approvals before a deploy runs.', [el('p', { text: 'Production needs approval.' })]),
    settingsCard('Project variables', 'Values the runner receives.', [el('p', { text: 'Set per project.' })]),
    settingsCard('Members', 'Who works on this project.', [el('p', { text: 'Roles pass down from the group.' })]),
    settingsCard('Webhooks', 'Where events are delivered.', [
      el('ul', { role: 'list' }, (rules?.webhooks ?? []).map((hook) => el('li', { text: hook.url }))),
      el('section', { role: 'region', 'aria-label': 'Deliveries', class: 'card' }, [el('h3', { text: 'Deliveries' })]),
    ]),
  );
}

function settingsCard(title: string, explanation: string, children: HTMLElement[]): HTMLElement {
  return el('section', { role: 'region', 'aria-label': title, class: 'card rule-card' }, [
    el('p', { class: 'mono kicker', text: `[ ${title} ]` }),
    el('h2', { text: title }),
    el('p', { class: 'muted large', text: explanation }),
    ...children,
  ]);
}

function mergeSettings(projectId: number, settings: Record<string, unknown>): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const key of ['merge_trains', 'pipelines_must_succeed', 'reset_approvals_on_push', 'author_can_approve', 'auto_resolve_outdated']) {
    const box = el('input', { type: 'checkbox', 'aria-label': key, id: `setting-${key}` });
    box.checked = settings[key] === true;
    box.addEventListener('change', () => {
      void guard(() => api.patch(`/api/projects/${projectId}/settings`, { [key]: box.checked }));
    });
    out.push(el('p', {}, [el('label', { for: `setting-${key}`, text: key }), box]));
  }
  const method = el('select', { 'aria-label': 'merge_method' }, ['merge_commit', 'squash', 'fast_forward', 'rebase'].map((value) =>
    el('option', { value, text: value, selected: settings.merge_method === value }),
  ));
  method.addEventListener('change', () => {
    void guard(() => api.patch(`/api/projects/${projectId}/settings`, { merge_method: method.value }));
  });
  out.push(el('p', {}, [el('label', { text: 'merge_method' }), method]));
  return out;
}

export async function renderAudit(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const result = await guard(() =>
    api.get<{ events: { id: number; actor: string; action: string; target: string; before: unknown; after: unknown; at: string }[] }>(
      `/api/projects/${projectId}/audit`,
    ),
  );
  ctx.main.append(el('h1', { text: 'Audit events' }));
  const list = el('ul', { role: 'list', class: 'rows mono' });
  for (const event of result?.events ?? []) {
    list.append(
      el('li', {
        text: `${event.at} ${event.actor} ${event.action} ${event.target} ${JSON.stringify(event.before)} -> ${JSON.stringify(event.after)}`,
      }),
    );
  }
  ctx.main.append(list);
}

export async function renderExport(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  connect(projectId);
  const host = el('div');
  ctx.main.append(el('h1', { text: 'Project export' }), host);
  let exportId: number | null = null;
  const bar = el('div', { role: 'progressbar', 'aria-label': 'Project export', 'aria-valuenow': '0', tabindex: '-1' });
  const link = el('a', { 'aria-label': 'Download export', hidden: true, text: 'Download export' });
  const error = el('p', { class: 'strip-error', hidden: true });
  const retry = el('button', { type: 'button', 'aria-label': 'Retry export', hidden: true }, ['Retry export']);
  const start = el('button', { type: 'button', 'aria-label': 'Export project' }, ['Export project']);

  const poll = async (): Promise<void> => {
    if (exportId === null) return;
    const result = await guard(() =>
      api.get<{ status: string; progress: number; error: string | null; download: string | null }>(
        `/api/exports/${exportId}`,
      ),
    );
    if (result === null) return;
    bar.setAttribute('aria-valuenow', String(result.progress));
    bar.textContent = `${result.progress}`;
    if (result.status === 'failed') {
      error.hidden = false;
      error.textContent = result.error ?? 'Export failed.';
      retry.hidden = false;
      announce(result.error ?? 'Export failed.');
      return;
    }
    if (result.status === 'finished' && result.download !== null) {
      link.hidden = false;
      link.setAttribute('href', result.download);
      announce('Export ready.');
      return;
    }
    window.setTimeout(() => void poll(), 200);
  };

  const begin = async (control: HTMLButtonElement): Promise<void> => {
    error.hidden = true;
    retry.hidden = true;
    link.hidden = true;
    const result = await guard(() => api.post<{ id: number }>(`/api/projects/${projectId}/exports`, {}, control));
    if (result === null) return;
    exportId = result.id;
    bar.focus();
    void poll();
  };
  start.addEventListener('click', () => void begin(start as HTMLButtonElement));
  retry.addEventListener('click', () => void begin(retry as HTMLButtonElement));
  host.append(start, bar, error, retry, link);
  onLive((message) => {
    if (message.type !== 'export') return;
    const data = message.data as { progress?: number; status?: string; announcement?: string };
    if (typeof data.progress === 'number') {
      bar.setAttribute('aria-valuenow', String(data.progress));
      bar.textContent = String(data.progress);
    }
    if (typeof data.announcement === 'string') announce(data.announcement);
    if (data.status === 'failed') {
      error.hidden = false;
      retry.hidden = false;
    }
    void poll();
  });
}

export async function renderImport(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  connect(projectId);
  const bar = el('div', { role: 'progressbar', 'aria-label': 'Project import', 'aria-valuenow': '0', tabindex: '-1' });
  const picker = el('input', { type: 'file', 'aria-label': 'Choose spurpack file', accept: '.spurpack,text/plain' });
  const dialog = el('div', { role: 'dialog', 'aria-label': 'Import preview', class: 'sheet', hidden: true });
  const preview = el('p');
  const confirm = el('button', { type: 'button', 'aria-label': 'Import' }, ['Import']);
  dialog.append(el('h2', { text: 'Import preview' }), preview, confirm);
  let importId: number | null = null;
  picker.addEventListener('change', () => {
    void (async () => {
      const file = picker.files?.[0];
      if (file === undefined) return;
      const text = await file.text();
      const project = await guard(() => api.get<{ group_id: number }>(`/api/projects/${projectId}`));
      if (project === null) return;
      const result = await guard(() =>
        api.postText<{ id: number; text: string }>(
          `/api/groups/${project.group_id}/imports?slug=imported`,
          text,
        ),
      );
      if (result === null) return;
      importId = result.id;
      preview.textContent = result.text;
      dialog.hidden = false;
    })();
  });
  confirm.addEventListener('click', () => {
    void (async () => {
      if (importId === null) return;
      const result = await guard(() =>
        api.post<{ project: number }>(`/api/imports/${importId}/confirm`, {}, confirm as HTMLButtonElement),
      );
      if (result === null) return;
      dialog.hidden = true;
      navigate(`/projects/${result.project}/-/import`);
    })();
  });
  ctx.main.append(el('h1', { text: 'Project import' }), picker, dialog, bar);
  bar.focus();
  const poll = async (): Promise<void> => {
    const result = await guard(() =>
      api.get<{ status: string; progress: number; counts: { commits: number; issues: number; requests: number } }>(
        `/api/imports/${importId ?? 0}`,
      ),
    );
    if (result === null) return;
    bar.setAttribute('aria-valuenow', String(result.progress));
    bar.textContent = String(result.progress);
    if (result.status === 'finished') {
      announce(
        `Import finished: ${result.counts.commits} commits, ${result.counts.issues} issues, ${result.counts.requests} requests.`,
      );
      return;
    }
    window.setTimeout(() => void poll(), 200);
  };
  onLive((message) => {
    if (message.type !== 'import') return;
    const data = message.data as { progress?: number; announcement?: string };
    if (typeof data.progress === 'number') {
      bar.setAttribute('aria-valuenow', String(data.progress));
      bar.textContent = String(data.progress);
    }
    if (typeof data.announcement === 'string') announce(data.announcement);
  });
}
