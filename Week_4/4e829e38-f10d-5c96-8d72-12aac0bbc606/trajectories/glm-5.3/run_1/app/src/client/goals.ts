import { h, clear, api, announce, openDialog } from './dom';
import { me } from './live';
import { renderTopbar } from './topbar';
import { animateProgress } from './motion';
import { GoalRecord } from './types';

interface GoalNodeUI {
  goal: GoalRecord;
  children: GoalNodeUI[];
  level: number;
}

export async function renderGoals(root: HTMLElement): Promise<void> {
  const who = await me();
  if (!who) { window.location.href = '/account'; return; }
  const team = who.teams[0];
  const res = await api<{ goals: GoalRecord[] }>('GET', `/api/teams/${team.id}/goals`);
  const goals = res.data.goals ?? [];

  clear(root);
  renderTopbar(root, { personName: who.name, unread: 0, active: 'goals' });
  const main = h('main', { class: 'viewbody', style: 'max-width:1100px;margin:0 auto' });
  main.append(h('h1', {}, 'Goals'));

  /* link cards for top-level goals */
  const cards = h('div', { class: 'panel', style: 'margin-bottom:24px' });
  const cardsInner = h('div', { class: 'goalcards' });
  const tops = goals.filter(g => !g.parentId).sort((a, b) => a.name.localeCompare(b.name));
  for (const g of tops) {
    cardsInner.append(h('a', {
      class: 'goallink', href: '#', 'aria-label': `Open ${g.name}`,
      onclick: (e: Event) => { e.preventDefault(); openGoalDialog(g); },
    }, h('span', {}, h('span', { class: 't' }, g.name), h('div', { class: 's' }, `${g.percent}% complete`)), h('span', { class: 'roundbtn', 'aria-hidden': 'true' }, '→')));
  }
  cards.append(cardsInner);
  main.append(cards);

  /* tree */
  const byId = new Map(goals.map(g => [g.id, g]));
  const nodes: GoalNodeUI[] = [];
  const buildNode = (g: GoalRecord, level: number): GoalNodeUI => {
    const node: GoalNodeUI = { goal: g, children: [], level };
    for (const child of goals.filter(x => x.parentId === g.id).sort((a, b) => a.name.localeCompare(b.name))) {
      node.children.push(buildNode(child, level + 1));
    }
    return node;
  };
  for (const t of tops) nodes.push(buildNode(t, 0));

  const treeEl = h('div', { class: 'tree', role: 'tree', 'aria-label': 'Goals' });
  const addNode = (node: GoalNodeUI, container: HTMLElement): void => {
    const g = node.goal;
    const row = h('div', {
      class: `node indent-${node.level}`, role: 'treeitem', tabindex: '-1',
      'aria-expanded': 'true',
      'aria-label': `${g.name}, ${g.percent}% complete`,
      'aria-level': String(node.level + 1),
    },
      h('span', { class: 'name' }, g.name),
      h('span', { class: 'pct' }, `${g.percent}% complete`),
      h('span', { class: 'progress', role: 'progressbar', 'aria-label': `${g.name} progress`, 'aria-valuenow': String(g.percent), 'aria-valuetext': `${g.percent}% complete`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'data-shown-percent': String(g.percent), style: 'flex:1;max-width:220px' }, h('span', { class: 'bar', style: `width:${g.percent}%` })));
    row.addEventListener('click', () => openGoalDialog(g));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); openGoalDialog(g); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = Array.from(treeEl.querySelectorAll<HTMLElement>('[role="treeitem"]'));
        const i = items.indexOf(row);
        (items[i + (e.key === 'ArrowDown' ? 1 : -1)] ?? row).focus();
        return;
      }
      if (e.key === 'ArrowRight' && node.children.length > 0) { e.preventDefault(); (row.parentElement!.querySelector('[role="treeitem"]') as HTMLElement)?.focus(); }
    });
    container.append(row);
    if (node.children.length > 0) {
      const group = h('div', { role: 'group' });
      container.append(group);
      for (const c of node.children) addNode(c, group);
    }
  };
  for (const n of nodes) addNode(n, treeEl);
  const first = treeEl.querySelector<HTMLElement>('[role="treeitem"]');
  if (first) first.tabIndex = 0;
  main.append(treeEl);
  main.append(h('button', { class: 'pill primary', onclick: () => openNewGoal() }, 'New goal'));
  root.append(main);

  async function refreshTree(): Promise<void> {
    const r = await api<{ goals: GoalRecord[] }>('GET', `/api/teams/${team.id}/goals`);
    const fresh = r.data.goals ?? [];
    const map = new Map(fresh.map(g => [g.id, g]));
    Array.from(treeEl.querySelectorAll<HTMLElement>('[role="treeitem"]')).forEach(row => {
      const id = row.dataset.goalId;
      const g = id ? map.get(id) : undefined;
      if (!g) return;
      const bar = row.querySelector<HTMLElement>('[role="progressbar"]');
      if (!bar) return;
      const before = Number(bar.getAttribute('data-shown-percent') ?? '0');
      bar.setAttribute('aria-valuenow', String(g.percent));
      bar.setAttribute('aria-valuetext', `${g.percent}% complete`);
      const inner = bar.querySelector<HTMLElement>('.bar')!;
      animateProgress(bar, before, g.percent);
      void inner;
    });
  }

  function openGoalDialog(g: GoalRecord): void {
    openDialog((container, close) => {
      const weight = h('input', { type: 'number', min: '1', max: '10', value: String(g.weight), 'aria-label': 'Weight' }) as HTMLInputElement;
      const manual = h('input', { type: 'number', min: '0', max: '100', value: String(g.manualValue), 'aria-label': 'Manual value' }) as HTMLInputElement;
      const save = h('button', {
        class: 'pill primary', 'aria-label': 'Save goal', onclick: async () => {
          await api('PATCH', `/api/goals/${g.id}`, { weight: Number(weight.value), manualValue: Number(manual.value) });
          await refreshTree();
          close();
        },
      }, 'Save goal');
      container.append(h('h2', {}, `Goal: ${g.name}`),
        h('div', { class: 'field' }, h('label', {}, 'Weight'), weight),
        h('div', { class: 'field' }, h('label', {}, 'Manual value'), manual),
        h('div', { class: 'actions' }, h('button', { class: 'pill quiet', 'aria-label': 'Close goal', onclick: close }, 'Close goal'), save));
    });
  }

  function openNewGoal(): void {
    openDialog((container, close) => {
      const name = h('input', { 'aria-label': 'Goal name' }) as HTMLInputElement;
      const parent = h('select', { 'aria-label': 'Parent goal' }) as HTMLSelectElement;
      parent.append(h('option', { value: '' }, 'None'));
      for (const g of goals) parent.append(h('option', { value: g.id }, g.name));
      const weight = h('input', { type: 'number', min: '1', max: '10', value: '1', 'aria-label': 'Weight' }) as HTMLInputElement;
      const create = h('button', {
        class: 'pill primary', onclick: async () => {
          const body: Record<string, unknown> = { name: name.value.trim() };
          if (parent.value) body.parentId = parent.value;
          if (weight.value) body.weight = Number(weight.value);
          await api('POST', `/api/teams/${team.id}/goals`, body);
          close();
          window.location.reload();
        },
      }, 'Create goal');
      container.append(h('h2', {}, 'New goal'),
        h('div', { class: 'field' }, h('label', {}, 'Goal name'), name),
        h('div', { class: 'field' }, h('label', {}, 'Parent goal'), parent),
        h('div', { class: 'field' }, h('label', {}, 'Weight'), weight),
        h('div', { class: 'actions' }, h('button', { class: 'pill quiet', onclick: close }, 'Cancel'), create));
    });
  }

  void byId;
  void announce;
}
