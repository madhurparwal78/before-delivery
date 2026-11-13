import { api, guard } from './api';
import { el } from './dom';
import type { ViewContext } from './main';

export async function renderDashboard(ctx: ViewContext): Promise<void> {
  const heading = el('h1', { text: 'Your projects', tabindex: '-1' });
  ctx.main.append(heading);
  const result = await guard(() =>
    api.get<{ projects: { id: number; path: string; slug: string; role: string }[] }>('/api/projects'),
  );
  const list = el('ul', { role: 'list', 'aria-label': 'Projects', class: 'rows' });
  for (const project of result?.projects ?? []) {
    list.append(
      el('li', {}, [
        el('a', { href: `/projects/${project.id}`, text: project.path }),
        el('span', { class: 'mono muted', text: project.role }),
      ]),
    );
  }
  if ((result?.projects ?? []).length === 0) {
    list.append(el('li', { text: 'No projects yet' }));
  }
  ctx.main.append(list);
  heading.focus();
}

export async function renderGroup(ctx: ViewContext): Promise<void> {
  const path = ctx.params.path;
  const found = await guard(() => api.get<{ id: number }>(`/api/groups/by_path?path=${encodeURIComponent(path)}`));
  if (found === null) return;
  const group = await guard(() =>
    api.get<{
      id: number;
      path: string;
      name: string;
      visibility: string;
      subgroups: { id: number; path: string }[];
      projects: { id: number; path: string }[];
      members: { username: string; effective_role: string }[];
      epics: { iid: number; title: string }[];
    }>(`/api/groups/${found.id}`),
  );
  if (group === null) return;
  ctx.main.append(
    el('h1', { text: group.path }),
    el('p', { class: 'mono muted', text: `[ ${group.visibility} ]` }),
    el('section', { role: 'region', 'aria-label': 'Subgroups', class: 'card' }, [
      el('h2', { text: 'Subgroups' }),
      el(
        'ul',
        { role: 'list' },
        group.subgroups.map((item) => el('li', {}, [el('a', { href: `/groups/${item.path}`, text: item.path })])),
      ),
    ]),
    el('section', { role: 'region', 'aria-label': 'Projects', class: 'card' }, [
      el('h2', { text: 'Projects' }),
      el(
        'ul',
        { role: 'list' },
        group.projects.map((item) => el('li', {}, [el('a', { href: `/projects/${item.id}`, text: item.path })])),
      ),
    ]),
    el('section', { role: 'region', 'aria-label': 'Members', class: 'card' }, [
      el('h2', { text: 'Members' }),
      el(
        'ul',
        { role: 'list' },
        group.members.map((item) =>
          el('li', { text: `${item.username} — ${item.effective_role}` }),
        ),
      ),
    ]),
    el('section', { role: 'region', 'aria-label': 'Epics', class: 'card' }, [
      el('h2', { text: 'Epics' }),
      el(
        'ul',
        { role: 'list' },
        group.epics.map((item) =>
          el('li', {}, [el('a', { href: `/groups/${group.path}/-/epics/${item.iid}`, text: `&${item.iid} ${item.title}` })]),
        ),
      ),
    ]),
  );
}

export async function renderSearch(ctx: ViewContext): Promise<void> {
  const scope = ctx.query.get('scope') ?? 'issues';
  const query = ctx.query.get('q') ?? '';
  const box = document.getElementById('global-search');
  if (box instanceof HTMLInputElement) box.value = query;
  const select = el('select', { 'aria-label': 'Scope', id: 'search-scope' }, [
    el('option', { value: 'code', text: 'code', selected: scope === 'code' }),
    el('option', { value: 'issues', text: 'issues', selected: scope === 'issues' }),
    el('option', { value: 'requests', text: 'requests', selected: scope === 'requests' }),
    el('option', { value: 'wiki', text: 'wiki', selected: scope === 'wiki' }),
  ]);
  select.addEventListener('change', () => {
    window.history.pushState({}, '', `/search?scope=${select.value}&q=${encodeURIComponent(query)}`);
    void renderSearchResults(ctx, select.value, query);
  });
  ctx.main.append(el('h1', { text: 'Search' }), select);
  await renderSearchResults(ctx, scope, query);
}

async function renderSearchResults(ctx: ViewContext, scope: string, query: string): Promise<void> {
  const existing = ctx.main.querySelector('[aria-label="Results"]');
  if (existing !== null) existing.remove();
  const countNode = ctx.main.querySelector('.result-count');
  if (countNode !== null) countNode.remove();
  const result = await guard(() =>
    api.get<{ count: number; results: Record<string, unknown>[] }>(
      `/api/search?scope=${scope}&q=${encodeURIComponent(query)}`,
    ),
  );
  const count = result?.count ?? 0;
  ctx.main.append(el('p', { class: 'result-count', text: `${count} results` }));
  const list = el('ul', { role: 'list', 'aria-label': 'Results', class: 'rows' });
  for (const item of result?.results ?? []) {
    const label =
      scope === 'code'
        ? `${String(item.project)} ${String(item.path)}:${String(item.line)} ${String(item.text)}`
        : scope === 'wiki'
          ? `${String(item.project)} ${String(item.title)}`
          : `${String(item.project)} #${String(item.iid)} ${String(item.title)}`;
    list.append(el('li', { text: label }));
  }
  ctx.main.append(list);
}
