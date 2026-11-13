import { api, guard } from './api';
import { clear, el, play, shortSha, trapFocus } from './dom';
import { connect, onLive } from './livesocket';
import type { ViewContext } from './main';
import { navigate } from './main';
import { announce, state } from './state';

type HomeBody = {
  project: { id: number; path: string; slug: string; default_branch: string; description: string };
  latest_tag: { name: string; commit: string; message: string | null } | null;
  tags: { name: string; message: string }[];
  latest_pipeline: { id: number; status: string; sha: string } | null;
  health: { open_merge_requests: number; pipelines_passed: string; open_issues: number };
  activity: { id: number; author: string; body: string; at: string }[];
};

export async function renderProjectHome(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const home = await guard(() => api.get<HomeBody>(`/api/projects/${projectId}/home`));
  if (home === null) return;
  const hero = el('section', { class: 'hero dark' }, [
    el('div', { class: 'dots', 'aria-hidden': 'true' }),
    el('div', { class: 'rules', 'aria-hidden': 'true' }, [
      el('span', {}),
      el('span', {}),
      el('span', {}),
      el('span', {}),
    ]),
    el('h1', { class: 'project-name', text: home.project.path }),
    el('div', { class: 'hero-grid' }, [
      el('div', { class: 'col1' }, [
        el('p', { class: 'description', text: home.project.description }),
        el('a', { href: `/projects/${projectId}/-/merge_requests/new`, 'aria-label': 'Open a merge request', class: 'mr-bar' }, [
          el('span', { text: 'Open a merge request' }),
          el('span', { class: 'arrow', text: '→' }),
        ]),
      ]),
      el('div', { class: 'col2' }, [
        home.latest_tag === null
          ? el('div', { class: 'tile' }, [el('p', { class: 'mono gold', text: 'No tags yet' })])
          : el(
              'a',
              {
                href: `/projects/${projectId}/-/commits?ref=${home.latest_tag.name}`,
                'aria-label': `Latest tag ${home.latest_tag.name}`,
                class: 'tile',
              },
              [
                el('p', { class: 'mono gold', text: home.latest_tag.name }),
                el('p', { text: 'Latest tag' }),
              ],
            ),
      ]),
      el('div', { class: 'col3' }, [
        home.latest_pipeline === null
          ? el('div', { class: 'tile' }, [el('p', { class: 'mono', text: 'No pipelines yet' })])
          : el(
              'a',
              {
                href: `/projects/${projectId}/-/pipelines/${home.latest_pipeline.id}`,
                'aria-label': `Latest pipeline on ${home.project.default_branch}: ${home.latest_pipeline.status}`,
                class: 'tile',
              },
              [
                el('p', { class: 'mono', text: shortSha(home.latest_pipeline.sha) }),
                el('p', { text: `Latest pipeline: ${home.latest_pipeline.status}` }),
              ],
            ),
      ]),
    ]),
  ]);
  const health = el('section', { role: 'region', 'aria-label': 'Project health', class: 'stats dark' }, [
    statCard('Open merge requests', String(home.health.open_merge_requests)),
    statCard('Pipelines passed', home.health.pipelines_passed),
    statCard('Open issues', String(home.health.open_issues)),
  ]);
  ctx.main.append(hero, health);
  if (home.tags.length > 0) {
    ctx.main.append(releaseCarousel(home.tags));
  }
  const activity = el('ul', { role: 'list', 'aria-label': 'Recent activity', class: 'activity dark' });
  for (const item of home.activity) {
    activity.append(
      el('li', {}, [
        el('p', { class: 'mono kicker', text: `// ${item.author}` }),
        el('p', { class: 'title', text: item.body.split('\n')[0] }),
        el('p', { class: 'muted', text: item.at }),
      ]),
    );
  }
  ctx.main.append(activity);
  ctx.main.append(
    el('nav', { 'aria-label': 'Project', class: 'project-nav' }, [
      el('a', { href: `/projects/${projectId}/-/files?ref=${home.project.default_branch}`, text: 'Files' }),
      el('a', { href: `/projects/${projectId}/-/merge_requests`, text: 'Merge requests' }),
      el('a', { href: `/projects/${projectId}/-/pipelines`, text: 'Pipelines' }),
      el('a', { href: `/projects/${projectId}/-/issues`, text: 'Issues' }),
      el('a', { href: `/projects/${projectId}/-/boards/1`, text: 'Board' }),
      el('a', { href: `/projects/${projectId}/-/train?target=${home.project.default_branch}`, text: 'Merge train' }),
      el('a', { href: `/projects/${projectId}/-/environments`, text: 'Environments' }),
      el('a', { href: `/projects/${projectId}/-/metrics`, text: 'Delivery metrics' }),
      el('a', { href: `/projects/${projectId}/-/wiki/home`, text: 'Wiki' }),
      el('a', { href: `/projects/${projectId}/-/settings`, text: 'Settings' }),
      el('a', { href: `/projects/${projectId}/-/export`, text: 'Export' }),
      el('a', { href: `/projects/${projectId}/-/audit`, text: 'Audit' }),
    ]),
  );
}

function statCard(label: string, value: string): HTMLElement {
  return el('div', { role: 'group', 'aria-label': label, class: 'stat' }, [
    el('p', { class: 'mono kicker', text: `[ ${label} ]` }),
    el('p', { class: 'mono value', text: value }),
    el('p', { class: 'caption', text: label }),
  ]);
}

function releaseCarousel(tags: { name: string; message: string }[]): HTMLElement {
  let index = 0;
  const slide = el('p', { class: 'release-slide' });
  const counter = el('p', { class: 'mono counter' });
  const update = (): void => {
    const tag = tags[index];
    clear(slide);
    slide.append(el('span', { class: 'gradient', text: '// ' }), document.createTextNode(tag.message || tag.name));
    counter.textContent = `${index + 1} / ${tags.length}`;
  };
  const previous = el('button', { type: 'button', 'aria-label': 'Previous release', class: 'round' }, ['‹']);
  const next = el('button', { type: 'button', 'aria-label': 'Next release', class: 'round' }, ['›']);
  previous.addEventListener('click', () => {
    index = (index - 1 + tags.length) % tags.length;
    update();
  });
  next.addEventListener('click', () => {
    index = (index + 1) % tags.length;
    update();
  });
  const region = el('section', { role: 'region', 'aria-label': 'Release notes', class: 'carousel dark', tabindex: '0' }, [
    slide,
    counter,
    previous,
    next,
  ]);
  region.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      index = (index - 1 + tags.length) % tags.length;
      update();
    }
    if (event.key === 'ArrowRight') {
      index = (index + 1) % tags.length;
      update();
    }
  });
  update();
  return region;
}

export async function renderFiles(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const project = await guard(() => api.get<{ default_branch: string }>(`/api/projects/${projectId}`));
  if (project === null) return;
  const ref = ctx.query.get('ref') ?? project.default_branch;
  const path = ctx.query.get('path') ?? '';
  const tree = await guard(() =>
    api.get<{ entries: { name: string; type: string; id: string }[] }>(
      `/api/projects/${projectId}/tree?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`,
    ),
  );
  ctx.main.append(el('h1', { text: 'Files' }), el('p', { class: 'mono', text: `[ ${ref} ]` }));
  const entries = tree?.entries ?? [];
  if (entries.length === 0 && path === '') {
    ctx.main.append(emptyState('// FILES', 'This project is empty', 'Add a file', `/projects/${projectId}/-/edit?ref=${ref}&path=README.md`));
    return;
  }
  const treeNode = el('ul', { role: 'tree', 'aria-label': 'Files', class: 'tree dark' });
  entries.forEach((entry, index) => {
    const full = path === '' ? entry.name : `${path}/${entry.name}`;
    const item = el('li', {
      role: 'treeitem',
      'aria-label': entry.name,
      tabindex: index === 0 ? '0' : '-1',
      'data-path': full,
      'data-type': entry.type,
      'aria-expanded': entry.type === 'tree' ? 'false' : null,
      text: entry.name,
    });
    item.addEventListener('keydown', (event) => handleTreeKey(event, treeNode, projectId, ref, full, entry.type));
    item.addEventListener('click', () => {
      openEntry(projectId, ref, full, entry.type);
    });
    treeNode.append(item);
  });
  ctx.main.append(treeNode);
  if (path !== '') {
    const file = await guard(() =>
      api.get<{ content: string; path: string }>(
        `/api/projects/${projectId}/files?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`,
      ),
    );
    if (file !== null) {
      ctx.main.append(
        el('section', { class: 'file dark' }, [
          el('div', { class: 'file-header strip-surface' }, [
            el('p', { class: 'mono', text: file.path }),
            el('a', { href: `/projects/${projectId}/-/blame?ref=${ref}&path=${path}`, text: 'Blame' }),
            el('a', { href: `/projects/${projectId}/-/commits?ref=${ref}&path=${path}`, text: 'History' }),
            el('a', { href: `/projects/${projectId}/-/edit?ref=${ref}&path=${path}`, text: 'Edit' }),
          ]),
          el('pre', { class: 'mono code', text: file.content }),
        ]),
      );
    }
  }
}

function openEntry(projectId: number, ref: string, path: string, type: string): void {
  if (type === 'tree') navigate(`/projects/${projectId}/-/files?ref=${ref}&path=${encodeURIComponent(path)}`);
  else navigate(`/projects/${projectId}/-/files?ref=${ref}&path=${encodeURIComponent(path)}`);
}

function handleTreeKey(
  event: KeyboardEvent,
  tree: HTMLElement,
  projectId: number,
  ref: string,
  path: string,
  type: string,
): void {
  const items = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const index = items.indexOf(event.currentTarget as HTMLElement);
  const focusAt = (next: number): void => {
    const target = items[Math.max(0, Math.min(items.length - 1, next))];
    for (const item of items) item.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
  };
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusAt(index + 1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusAt(index - 1);
    return;
  }
  if (event.key === 'Home') {
    event.preventDefault();
    focusAt(0);
    return;
  }
  if (event.key === 'End') {
    event.preventDefault();
    focusAt(items.length - 1);
    return;
  }
  if (event.key === 'ArrowRight' && type === 'tree') {
    event.preventDefault();
    openEntry(projectId, ref, path, type);
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    const parent = path.split('/').slice(0, -2).join('/');
    navigate(`/projects/${projectId}/-/files?ref=${ref}&path=${encodeURIComponent(parent)}`);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    openEntry(projectId, ref, path, type);
    return;
  }
  if (/^[a-z0-9]$/i.test(event.key)) {
    const start = index + 1;
    for (let step = 0; step < items.length; step += 1) {
      const candidate = items[(start + step) % items.length];
      if ((candidate.textContent ?? '').toLowerCase().startsWith(event.key.toLowerCase())) {
        focusAt(items.indexOf(candidate));
        return;
      }
    }
  }
}

export function emptyState(eyebrow: string, headline: string, buttonText: string, href: string): HTMLElement {
  const action = el('a', { href, 'aria-label': buttonText, class: 'empty-button' }, [buttonText]);
  return el('section', { class: 'empty dark' }, [
    el('p', { class: 'mono eyebrow', text: eyebrow }),
    el('h2', { text: headline }),
    action,
  ]);
}

export async function renderBlame(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const project = await guard(() => api.get<{ default_branch: string }>(`/api/projects/${projectId}`));
  if (project === null) return;
  const ref = ctx.query.get('ref') ?? project.default_branch;
  const path = ctx.query.get('path') ?? '';
  const blame = await guard(() =>
    api.get<{ lines: { line: number; commit: string; author: string; text: string }[] }>(
      `/api/projects/${projectId}/blame?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`,
    ),
  );
  ctx.main.append(el('h1', { text: `Blame ${path}` }));
  const table = el('table', { 'aria-label': 'Blame', class: 'mono dark' }, [
    el('thead', {}, [
      el('tr', {}, [el('th', { text: 'Commit' }), el('th', { text: 'Author' }), el('th', { text: 'Line' }), el('th', { text: 'Text' })]),
    ]),
  ]);
  const body = el('tbody');
  for (const line of blame?.lines ?? []) {
    body.append(
      el('tr', {}, [
        el('td', { text: shortSha(line.commit) }),
        el('td', { text: line.author }),
        el('td', { text: String(line.line) }),
        el('td', { text: line.text }),
      ]),
    );
  }
  table.append(body);
  ctx.main.append(table);
}

export async function renderCommits(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const project = await guard(() => api.get<{ default_branch: string }>(`/api/projects/${projectId}`));
  if (project === null) return;
  const ref = ctx.query.get('ref') ?? project.default_branch;
  const path = ctx.query.get('path') ?? '';
  const commits = await guard(() =>
    api.get<{ commits: { id: string; message: string; author: string; committed_at: string }[] }>(
      `/api/projects/${projectId}/commits?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`,
    ),
  );
  ctx.main.append(el('h1', { text: 'History' }));
  const list = el('ul', { role: 'list', class: 'rows dark mono' });
  for (const commit of commits?.commits ?? []) {
    list.append(
      el('li', {}, [
        el('a', { href: `/projects/${projectId}/-/commit/${commit.id}`, text: shortSha(commit.id) }),
        el('span', { text: ` ${commit.message.split('\n')[0]} ` }),
        el('span', { class: 'muted', text: commit.author }),
      ]),
    );
  }
  ctx.main.append(list);
}

export async function renderCommit(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const id = ctx.params.commit;
  const commit = await guard(() =>
    api.get<{
      id: string;
      message: string;
      author: string;
      committed_at: string;
      diffs: { path: string; hunks: { header: string; lines: { type: string; old: number | null; new: number | null; text: string }[] }[] }[];
    }>(`/api/projects/${projectId}/commits/${id}`),
  );
  if (commit === null) return;
  const heading = el('h1', { text: `Commit ${shortSha(commit.id)}`, tabindex: '-1' });
  ctx.main.append(heading, el('p', { class: 'mono', text: commit.message }), el('p', { class: 'muted', text: commit.author }));
  for (const diff of commit.diffs) {
    const block = el('section', { class: 'file dark' }, [
      el('div', { class: 'file-header strip-surface' }, [el('p', { class: 'mono', text: diff.path })]),
    ]);
    for (const hunk of diff.hunks) {
      block.append(el('p', { class: 'mono hunk', text: hunk.header }));
      for (const line of hunk.lines) {
        block.append(
          el('p', {
            class: `mono diff-line ${line.type}`,
            text: `${line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}${line.text}`,
          }),
        );
      }
    }
    ctx.main.append(block);
  }
  heading.focus();
}

export async function renderCompare(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const from = ctx.query.get('from') ?? '';
  const to = ctx.query.get('to') ?? '';
  const result = await guard(() =>
    api.get<{ merge_base: string; diffs: { path: string }[] }>(
      `/api/projects/${projectId}/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  );
  ctx.main.append(
    el('h1', { text: 'Compare refs' }),
    el('p', { class: 'mono', text: `[ ${from} -> ${to} ]` }),
    el('p', { class: 'mono muted', text: `merge base ${result === null ? 'none' : shortSha(result.merge_base)}` }),
  );
  const list = el('ul', { role: 'list', class: 'rows dark mono' });
  for (const diff of result?.diffs ?? []) list.append(el('li', { text: diff.path }));
  ctx.main.append(list);
}

type EditorTab = { path: string; content: string; conflict: boolean };

export async function renderEditor(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const project = await guard(() => api.get<{ default_branch: string }>(`/api/projects/${projectId}`));
  if (project === null) return;
  const ref = ctx.query.get('ref') ?? project.default_branch;
  const path = ctx.query.get('path') ?? '';
  connect(projectId);
  const headRow = await guard(() => api.get<{ commit: string | null }>(`/api/projects/${projectId}/branch_head?name=${encodeURIComponent(ref)}`));
  let baseCommit = headRow?.commit ?? null;
  const tabs: EditorTab[] = [];
  const storageKey = (file: string): string => `spurline:${projectId}:${ref}:${file}`;

  const tabList = el('div', { role: 'tablist', 'aria-label': 'Open files', class: 'tabs' });
  const editors = el('div', { class: 'editors' });
  const message = el('textarea', { 'aria-label': 'Commit message', id: 'commit-message', rows: '3' });
  const targetBranch = el('select', { 'aria-label': 'Target branch', id: 'target-branch' }, [
    el('option', { value: ref, text: ref, selected: true }),
  ]);
  const newBranch = el('input', { type: 'text', 'aria-label': 'New branch name', id: 'new-branch' });
  const commit = el('button', { type: 'button', 'aria-label': 'Commit' }, ['Commit']);
  const refresh = el('button', { type: 'button', 'aria-label': 'Refresh and reapply', hidden: true }, ['Refresh and reapply']);

  const addTab = (file: string, content: string): void => {
    if (tabs.some((tab) => tab.path === file)) return;
    const restored = window.localStorage.getItem(storageKey(file));
    tabs.push({ path: file, content: restored ?? content, conflict: false });
    if (restored !== null) announce('Restored unsaved changes in 1 file.');
    renderTabs();
  };

  const renderTabs = (): void => {
    clear(tabList);
    clear(editors);
    for (const tab of tabs) {
      const name = `${tab.path}${tab.conflict ? ' (conflict)' : ''}`;
      const control = el('button', {
        type: 'button',
        role: 'tab',
        'aria-label': name,
        'aria-selected': 'true',
        'data-conflict': tab.conflict ? 'true' : 'false',
      }, [name]);
      tabList.append(control);
      const area = el('textarea', { 'aria-label': `Edit ${tab.path}`, class: 'mono editor', rows: '14' });
      area.value = tab.content;
      area.addEventListener('input', () => {
        tab.content = area.value;
        window.localStorage.setItem(storageKey(tab.path), area.value);
      });
      editors.append(area);
      editors.append(
        el('div', { class: 'tab-actions' }, [
          el('button', { type: 'button', 'aria-label': `Rename ${tab.path}` }, ['Rename']),
          el('button', { type: 'button', 'aria-label': `Delete ${tab.path}` }, ['Delete']),
        ]),
      );
    }
  };

  if (path !== '') {
    const file = await guard(() =>
      api.get<{ content: string }>(
        `/api/projects/${projectId}/files?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`,
      ),
    );
    addTab(path, file?.content ?? '');
  }

  const newFileDialog = el('div', { role: 'dialog', 'aria-label': 'New file', class: 'sheet', hidden: true });
  const newFilePath = el('input', { type: 'text', 'aria-label': 'File path' });
  const newFileCreate = el('button', { type: 'button', 'aria-label': 'Create file' }, ['Create file']);
  newFileDialog.append(el('h2', { text: 'New file' }), newFilePath, newFileCreate);
  const newFileButton = el('button', { type: 'button', 'aria-label': 'New file' }, ['New file']);
  newFileButton.addEventListener('click', () => {
    newFileDialog.hidden = false;
    newFilePath.focus();
    const release = trapFocus(newFileDialog, newFileButton, () => {
      newFileDialog.hidden = true;
      release();
    });
  });
  newFileCreate.addEventListener('click', () => {
    addTab(newFilePath.value, '');
    newFileDialog.hidden = true;
    newFileButton.focus();
  });

  commit.addEventListener('click', () => {
    void (async () => {
      const branch = newBranch.value === '' ? targetBranch.value : newBranch.value;
      const markers = tabs.find((tab) => /^(<<<<<<< |=======$|>>>>>>> )/m.test(tab.content));
      if (markers !== undefined) {
        announce('Remove all conflict markers before committing.');
        return;
      }
      const existing = await guard(() =>
        api.get<{ entries: { name: string }[] }>(`/api/projects/${projectId}/tree?ref=${encodeURIComponent(ref)}&path=`),
      );
      void existing;
      const actions = [];
      for (const tab of tabs) {
        const file = await api
          .get<{ content: string }>(
            `/api/projects/${projectId}/files?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(tab.path)}`,
          )
          .catch(() => null);
        actions.push({ action: file === null ? 'create' : 'update', path: tab.path, content: tab.content });
      }
      try {
        const result = await api.post<{ commit: string; short: string }>(
          `/api/projects/${projectId}/commits`,
          {
            branch,
            start_ref: newBranch.value === '' ? undefined : targetBranch.value,
            base_commit: newBranch.value === '' ? baseCommit : baseCommit,
            message: message.value,
            actions,
          },
          commit as HTMLButtonElement,
        );
        for (const tab of tabs) window.localStorage.removeItem(storageKey(tab.path));
        announce(`Committed ${result.short} to ${branch}.`);
        navigate(`/projects/${projectId}/-/commit/${result.commit}`);
      } catch (error) {
        const failure = error as { status?: number; body?: { error: string; message: string } };
        if (failure.status === 409 && failure.body?.error === 'stale_base') {
          refresh.hidden = false;
          announce(failure.body.message);
          return;
        }
        announce(failure.body?.message ?? 'Commit failed.');
      }
    })();
  });

  refresh.addEventListener('click', () => {
    void (async () => {
      const head = await guard(() =>
        api.get<{ commit: string | null }>(`/api/projects/${projectId}/branch_head?name=${encodeURIComponent(ref)}`),
      );
      baseCommit = head?.commit ?? null;
      for (const tab of tabs) {
        const file = await api
          .get<{ content: string }>(
            `/api/projects/${projectId}/files?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(tab.path)}`,
          )
          .catch(() => null);
        if (file !== null && file.content !== tab.content) {
          tab.conflict = true;
          tab.content = `<<<<<<< ${ref}\n${file.content}=======\n${tab.content}>>>>>>> local\n`;
        }
      }
      renderTabs();
      refresh.hidden = true;
    })();
  });

  ctx.main.append(
    el('h1', { text: 'Web editor' }),
    el('div', { class: 'editor-layout' }, [
      el('div', { class: 'editor-side' }, [
        el('button', { type: 'button', 'aria-label': 'Show files' }, ['Show files']),
        newFileButton,
        newFileDialog,
      ]),
      el('div', { class: 'editor-main' }, [
        tabList,
        editors,
        el('div', { class: 'commit-form card' }, [
          el('label', { for: 'target-branch', text: 'Target branch' }),
          targetBranch,
          el('label', { for: 'new-branch', text: 'New branch name' }),
          newBranch,
          el('label', { for: 'commit-message', text: 'Commit message' }),
          message,
          commit,
          refresh,
        ]),
      ]),
    ]),
  );
  onLive(() => undefined);
}

export async function renderCiEditor(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const project = await guard(() => api.get<{ default_branch: string }>(`/api/projects/${projectId}`));
  if (project === null) return;
  const ref = ctx.query.get('ref') ?? project.default_branch;
  const file = await api
    .get<{ content: string }>(
      `/api/projects/${projectId}/files?ref=${encodeURIComponent(ref)}&path=spurline.pipeline.yml`,
    )
    .catch(() => null);
  const area = el('textarea', { 'aria-label': 'Pipeline config', class: 'mono editor', rows: '20' });
  area.value = file?.content ?? '';
  const results = el('section', { role: 'region', 'aria-label': 'Lint results', class: 'card' });
  const jobs = el('ul', { role: 'list', 'aria-label': 'Expanded jobs', class: 'rows' });
  const check = el('button', { type: 'button', 'aria-label': 'Check config' }, ['Check config']);
  check.addEventListener('click', () => {
    void (async () => {
      const result = await guard(() =>
        api.post<{ valid: boolean; errors: string[]; summary: string; jobs: { name: string; stage: string; variables: Record<string, string> }[] }>(
          `/api/projects/${projectId}/ci/lint`,
          { content: area.value, ref },
          check as HTMLButtonElement,
        ),
      );
      if (result === null) return;
      clear(results);
      results.append(el('h2', { text: 'Lint results' }), el('p', { text: result.summary }));
      for (const message of result.errors) {
        const item = el('button', { type: 'button', 'aria-label': message }, [message]);
        item.addEventListener('click', () => {
          const match = /^Line (\d+):/.exec(message);
          const line = match === null ? 1 : Number(match[1]);
          const lines = area.value.split('\n').slice(0, line - 1).join('\n');
          area.focus();
          area.setSelectionRange(lines.length === 0 ? 0 : lines.length + 1, lines.length === 0 ? 0 : lines.length + 1);
        });
        results.append(item);
      }
      clear(jobs);
      for (const job of result.jobs) {
        const variables = Object.entries(job.variables)
          .map(([key, value]) => `${key}=${value}`)
          .join(' ');
        jobs.append(el('li', { text: `${job.name} (${job.stage}) ${variables}` }));
      }
      announce(result.summary);
    })();
  });
  ctx.main.append(el('h1', { text: 'Pipeline config' }), area, check, results, jobs);
}
