import { api, guard } from './api';
import { clear, el, play } from './dom';
import { connect, onLive } from './livesocket';
import type { ViewContext } from './main';
import { navigate } from './main';
import { announce } from './state';
import { emptyState } from './views_repo';

type Issue = {
  id: number;
  iid: number;
  title: string;
  state: string;
  labels: string[];
  assignees: string[];
  weight: number | null;
  confidential: boolean;
};

export async function renderIssues(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  connect(projectId);
  const host = el('div');
  ctx.main.append(host);
  const title = el('input', { type: 'text', 'aria-label': 'Title' });
  const description = el('textarea', { 'aria-label': 'Description', rows: '3' });
  const confidential = el('input', { type: 'checkbox', 'aria-label': 'Confidential' });
  const create = el('button', { type: 'button', 'aria-label': 'Create issue' }, ['Create issue']);
  create.addEventListener('click', () => {
    void (async () => {
      const result = await guard(() =>
        api.post<{ iid: number }>(
          `/api/projects/${projectId}/issues`,
          { title: title.value, description: description.value, confidential: confidential.checked },
          create as HTMLButtonElement,
        ),
      );
      if (result === null) return;
      navigate(`/projects/${projectId}/-/issues/${result.iid}`);
    })();
  });
  const list = el('ul', { role: 'list', class: 'rows' });
  const reload = async (): Promise<void> => {
    const result = await guard(() => api.get<{ issues: Issue[] }>(`/api/projects/${projectId}/issues`));
    clear(list);
    if ((result?.issues ?? []).length === 0) {
      list.append(el('li', {}, [emptyState('// ISSUES', 'No issues yet', 'New issue', `/projects/${projectId}/-/issues`)]));
      return;
    }
    for (const issue of result?.issues ?? []) {
      list.append(
        el('li', {}, [
          el('a', { href: `/projects/${projectId}/-/issues/${issue.iid}`, text: `#${issue.iid} ${issue.title}` }),
          el('span', { class: 'chips' }, issue.labels.map((label) => labelChip(label))),
          el('span', { class: 'muted', text: issue.state }),
        ]),
      );
    }
  };
  host.append(
    el('h1', { text: 'Issues' }),
    el('div', { class: 'card form light' }, [
      el('label', { text: 'Title' }),
      title,
      el('label', { text: 'Description' }),
      description,
      el('label', { text: 'Confidential' }),
      confidential,
      create,
    ]),
    list,
  );
  await reload();
  onLive((message) => {
    if (message.type === 'issue') void reload();
  });
}

function labelChip(name: string): HTMLElement {
  const index = name.lastIndexOf('::');
  if (index === -1) return el('span', { class: 'chip', text: name });
  return el('span', { class: 'chip scoped' }, [
    el('span', { class: 'key', text: name.slice(0, index) }),
    el('span', { class: 'value', text: name.slice(index + 2) }),
  ]);
}

export async function renderIssue(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const iid = Number(ctx.params.iid);
  connect(projectId);
  const host = el('div');
  ctx.main.append(host);
  const reload = async (): Promise<void> => {
    const issue = await guard(() =>
      api.get<Issue & { description: string; notes: { id: number; author: string; body: string; system: boolean }[] }>(
        `/api/projects/${projectId}/issues/${iid}`,
      ),
    );
    if (issue === null) return;
    clear(host);
    const heading = el('h1', { text: issue.title, tabindex: '-1' });
    host.append(
      heading,
      el('p', { class: 'mono', text: `#${issue.iid} · ${issue.state}` }),
      el('p', { text: issue.description }),
      el('div', { class: 'chips' }, issue.labels.map((label) => labelChip(label))),
    );
    const notes = el('div', { class: 'activity-list' });
    for (const note of issue.notes) {
      notes.append(
        el('p', { class: note.system ? 'system-note' : 'note' }, [el('strong', { text: `${note.author}: ` }), note.body]),
      );
    }
    const comment = el('textarea', { 'aria-label': 'Comment', rows: '3' });
    const commentButton = el('button', { type: 'button', 'aria-label': 'Comment' }, ['Comment']);
    commentButton.addEventListener('click', () => {
      void (async () => {
        const result = await guard(() =>
          api.post<{ results: string[] }>(
            `/api/projects/${projectId}/issues/${iid}/notes`,
            { body: comment.value },
            commentButton as HTMLButtonElement,
          ),
        );
        if (result !== null) {
          for (const text of result.results) announce(text);
        }
        comment.value = '';
        await reload();
      })();
    });
    const toggle = el('button', {
      type: 'button',
      'aria-label': issue.state === 'closed' ? 'Reopen issue' : 'Close issue',
    }, [issue.state === 'closed' ? 'Reopen issue' : 'Close issue']);
    toggle.addEventListener('click', () => {
      void (async () => {
        await guard(() =>
          api.patch(
            `/api/projects/${projectId}/issues/${iid}`,
            { state_event: issue.state === 'closed' ? 'reopen' : 'close' },
            toggle as HTMLButtonElement,
          ),
        );
        await reload();
      })();
    });
    host.append(notes, comment, commentButton, toggle);
    heading.focus();
  };
  await reload();
  onLive((message) => {
    const data = message.data as { announcement?: string };
    if (typeof data.announcement === 'string') announce(data.announcement);
    if (message.type === 'issue') void reload();
  });
}

export async function renderMilestone(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const milestoneId = Number(ctx.params.milestone);
  const result = await guard(() =>
    api.get<{ title: string; points: { day: string; remaining: number; future: boolean }[] }>(
      `/api/projects/${projectId}/milestones/${milestoneId}/burndown`,
    ),
  );
  if (result === null) return;
  ctx.main.append(el('h1', { text: result.title }));
  const chart = el('div', { role: 'img', 'aria-label': 'Burndown', class: 'burndown' });
  for (const point of result.points) {
    chart.append(
      el('span', {
        class: 'point',
        'data-day': point.day,
        'data-remaining': String(point.remaining),
        'data-future': point.future ? 'true' : 'false',
        style: `height:${Math.min(100, point.remaining * 10)}px`,
      }),
    );
  }
  const table = el('table', { 'aria-label': 'Burndown data' }, [
    el('thead', {}, [el('tr', {}, [el('th', { text: 'Day' }), el('th', { text: 'Remaining' })])]),
    el(
      'tbody',
      {},
      result.points.map((point) => el('tr', {}, [el('td', { text: point.day }), el('td', { text: String(point.remaining) })])),
    ),
  ]);
  ctx.main.append(chart, table);
}

type Board = {
  id: number;
  name: string;
  kind: string;
  lists: { id: number; title: string; count: number; cards: { issue: number; iid: number; title: string; weight: number | null; labels: string[]; version: number }[] }[];
};

export async function renderBoard(ctx: ViewContext): Promise<void> {
  const boardId = Number(ctx.params.board);
  const projectId = ctx.params.id === undefined ? null : Number(ctx.params.id);
  if (projectId !== null) connect(projectId);
  const host = el('div', { class: 'board-host light' });
  ctx.main.append(host);
  const filters = {
    label: ctx.query.get('label') ?? '',
    assignee: ctx.query.get('assignee') ?? '',
    milestone: ctx.query.get('milestone') ?? '',
    search: ctx.query.get('search') ?? '',
  };
  let lifted: HTMLElement | null = null;

  const pushFilters = (): void => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== '') params.set(key, value);
    }
    const base = projectId === null ? `/groups/${ctx.params.path}/-/boards/${boardId}` : `/projects/${projectId}/-/boards/${boardId}`;
    navigate(`${base}?${params.toString()}`);
  };

  const query = (): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== '') params.set(key, value);
    }
    return params.toString();
  };

  const move = async (issueId: number, toList: number, afterId: number | null, version: number): Promise<void> => {
    const result = await guard(() =>
      api.post<{ notes: string[] }>(`/api/boards/${boardId}/moves`, {
        issue: issueId,
        to_list: toList,
        after_id: afterId,
        version,
      }),
    );
    if (result !== null) {
      for (const note of result.notes) announce(note);
    }
    await reload();
  };

  const reload = async (): Promise<void> => {
    const board = await guard(() => api.get<Board>(`/api/boards/${boardId}?${query()}`));
    if (board === null) return;
    clear(host);
    const region = el('section', { role: 'region', 'aria-label': `Board ${board.name}`, class: 'board' });
    const labelFilter = el('select', { 'aria-label': 'Filter by label' }, [
      el('option', { value: '', text: 'All labels' }),
      ...[...new Set(board.lists.flatMap((list) => list.cards.flatMap((card) => card.labels)))].map((label) =>
        el('option', { value: label, text: label, selected: filters.label === label }),
      ),
    ]);
    labelFilter.addEventListener('change', () => {
      filters.label = labelFilter.value;
      pushFilters();
    });
    const assigneeFilter = el('select', { 'aria-label': 'Filter by assignee' }, [
      el('option', { value: '', text: 'Anyone' }),
    ]);
    const milestoneFilter = el('select', { 'aria-label': 'Filter by milestone' }, [
      el('option', { value: '', text: 'Any milestone' }),
    ]);
    const search = el('input', { type: 'search', role: 'searchbox', 'aria-label': 'Filter cards' });
    search.value = filters.search;
    search.addEventListener('change', () => {
      filters.search = search.value;
      pushFilters();
    });
    host.append(labelFilter, assigneeFilter, milestoneFilter, search, region);
    for (const list of board.lists) {
      const column = el('ul', { role: 'list', 'aria-label': list.title, class: 'board-list', 'data-list': String(list.id) });
      column.append(el('li', { class: 'count', text: `${list.count} ${list.count === 1 ? 'issue' : 'issues'}` }));
      for (const card of list.cards) {
        const item = el('li', {
          role: 'listitem',
          'aria-label': `Issue #${card.iid}, ${card.title}, ${card.weight === null ? 'no weight' : `weight ${card.weight}`}, ${card.labels.length} labels, in ${list.title}`,
          class: 'card-item',
          tabindex: '0',
          draggable: 'true',
          'data-issue': String(card.issue),
          'data-iid': String(card.iid),
          'data-version': String(card.version),
          'data-lifted': 'false',
        }, [el('p', { text: card.title }), el('div', { class: 'chips' }, card.labels.map((label) => labelChip(label)))]);
        item.addEventListener('keydown', (event) => {
          const cards = [...column.querySelectorAll<HTMLElement>('.card-item')];
          const index = cards.indexOf(item);
          if (event.key === ' ') {
            event.preventDefault();
            if (lifted === item) {
              lifted = null;
              item.dataset.lifted = 'false';
              const target = Number(item.dataset.targetList ?? list.id);
              const siblings = [...(region.querySelector(`[data-list="${target}"]`)?.querySelectorAll<HTMLElement>('.card-item') ?? [])];
              const position = siblings.indexOf(item);
              const after = position > 0 ? Number(siblings[position - 1].dataset.issue) : null;
              announce(`Dropped in ${list.title}, position ${position + 1}.`);
              play(item, 'card-settle');
              void move(card.issue, target, after, card.version);
              return;
            }
            lifted = item;
            item.dataset.lifted = 'true';
            announce(`Lifted Issue #${card.iid}.`);
            return;
          }
          if (event.key === 'Escape' && lifted === item) {
            event.preventDefault();
            lifted = null;
            item.dataset.lifted = 'false';
            announce('Move canceled.');
            item.focus();
            return;
          }
          if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          if (lifted === item) {
            const lists = board.lists.map((item2) => item2.id);
            const listIndex = lists.indexOf(Number(item.dataset.targetList ?? list.id));
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              const nextList = lists[listIndex + (event.key === 'ArrowRight' ? 1 : -1)];
              if (nextList === undefined) return;
              item.dataset.targetList = String(nextList);
              const target = region.querySelector(`[data-list="${nextList}"]`);
              if (target !== null) target.append(item);
              item.focus();
              const title = board.lists.find((entry) => entry.id === nextList)?.title ?? '';
              announce(`Over ${title}, position ${[...(target?.querySelectorAll('.card-item') ?? [])].indexOf(item) + 1}.`);
              return;
            }
            const sibling = event.key === 'ArrowDown' ? item.nextElementSibling : item.previousElementSibling;
            if (sibling === null || !sibling.classList.contains('card-item')) return;
            if (event.key === 'ArrowDown') sibling.after(item);
            else sibling.before(item);
            item.focus();
            announce(`Over ${list.title}, position ${[...column.querySelectorAll('.card-item')].indexOf(item) + 1}.`);
            return;
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const next = cards[index + (event.key === 'ArrowDown' ? 1 : -1)];
            if (next !== undefined) next.focus();
            return;
          }
          const lists = [...region.querySelectorAll<HTMLElement>('.board-list')];
          const columnIndex = lists.indexOf(column);
          const nextColumn = lists[columnIndex + (event.key === 'ArrowRight' ? 1 : -1)];
          if (nextColumn === undefined) return;
          const targetCards = [...nextColumn.querySelectorAll<HTMLElement>('.card-item')];
          const target = targetCards[Math.min(index, targetCards.length - 1)];
          if (target !== undefined) target.focus();
        });
        item.addEventListener('dragstart', (event) => {
          event.dataTransfer?.setData('text/plain', String(card.issue));
        });
        let holdTimer = 0;
        item.addEventListener(
          'touchstart',
          () => {
            holdTimer = window.setTimeout(() => {
              item.dataset.lifted = 'true';
            }, 200);
          },
          { passive: true },
        );
        item.addEventListener(
          'touchend',
          (event) => {
            window.clearTimeout(holdTimer);
            if (item.dataset.lifted !== 'true') return;
            item.dataset.lifted = 'false';
            const touch = event.changedTouches[0];
            const under = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetList = under?.closest('.board-list');
            if (targetList === null || targetList === undefined) return;
            play(item, 'card-settle');
            void move(card.issue, Number((targetList as HTMLElement).dataset.list ?? list.id), null, card.version);
          },
          { passive: true },
        );
        column.append(item);
      }
      column.addEventListener('dragover', (event) => event.preventDefault());
      column.addEventListener('drop', (event) => {
        event.preventDefault();
        const issueId = Number(event.dataTransfer?.getData('text/plain') ?? '0');
        const card = board.lists.flatMap((entry) => entry.cards).find((entry) => entry.issue === issueId);
        if (card === undefined) return;
        void move(issueId, list.id, null, card.version);
      });
      region.append(column);
    }
  };
  await reload();
  onLive((message) => {
    const data = message.data as { announcement?: string };
    if (typeof data.announcement === 'string') announce(data.announcement);
    if (['board', 'issue'].includes(message.type)) void reload();
  });
}

export async function renderEpic(ctx: ViewContext): Promise<void> {
  const path = ctx.params.path;
  const iid = Number(ctx.params.iid);
  const group = await guard(() => api.get<{ id: number }>(`/api/groups/by_path?path=${encodeURIComponent(path)}`));
  if (group === null) return;
  const epic = await guard(() =>
    api.get<{
      iid: number;
      title: string;
      parent: number | null;
      children: { iid: number; title: string }[];
      issues: { project: string; iid: number; title: string }[];
      start_date: string | null;
      due_date: string | null;
      notes: { author: string; body: string; system: boolean }[];
    }>(`/api/groups/${group.id}/epics/${iid}`),
  );
  if (epic === null) return;
  ctx.main.append(
    el('p', { class: 'mono kicker', text: `&${epic.iid}` }),
    el('h1', { text: epic.title }),
    el('section', { role: 'region', 'aria-label': 'Epic dates', class: 'card' }, [
      el('p', { text: epic.start_date === null ? 'Start not set' : `Start ${epic.start_date}` }),
      el('p', { text: epic.due_date === null ? 'Due not set' : `Due ${epic.due_date}` }),
    ]),
  );
  if (epic.parent !== null) {
    ctx.main.append(
      el('a', { href: `/groups/${path}/-/epics/${epic.parent}`, 'aria-label': `Parent epic &${epic.parent}` }, [
        `Parent epic &${epic.parent}`,
      ]),
    );
  }
  ctx.main.append(
    el('ul', { role: 'list', 'aria-label': 'Child epics' }, epic.children.map((child) =>
      el('li', {}, [el('a', { href: `/groups/${path}/-/epics/${child.iid}`, text: `&${child.iid} ${child.title}` })]),
    )),
    el('ul', { role: 'list', 'aria-label': 'Epic issues' }, epic.issues.map((issue) =>
      el('li', { text: `${issue.project}#${issue.iid} ${issue.title}` }),
    )),
    el('ul', { role: 'list', 'aria-label': 'Epic activity' }, epic.notes.map((note) =>
      el('li', { text: `${note.author}: ${note.body}` }),
    )),
  );
}
