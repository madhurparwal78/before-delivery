import { api, ApiCallError, type Goal } from '../api.js';
import { clear, el, on } from '../dom.js';
import { openDialog } from '../dialog.js';
import { labelledField } from '../forms.js';
import { onLive } from '../live.js';
import { progressBar, type ProgressBar } from '../progress.js';
import { currentTeam } from '../state.js';
import { statusRegion, announce } from '../status.js';

interface Node {
  goal: Goal;
  children: Node[];
}

function buildTree(goals: Goal[]): Node[] {
  const byId = new Map(goals.map((goal) => [goal.id, { goal, children: [] as Node[] }]));
  const roots: Node[] = [];
  for (const node of byId.values()) {
    if (node.goal.parentId && byId.has(node.goal.parentId)) {
      byId.get(node.goal.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (nodes: Node[]) => {
    nodes.sort((a, b) => a.goal.name.localeCompare(b.goal.name));
    for (const node of nodes) sort(node.children);
  };
  sort(roots);
  return roots;
}

export async function renderGoals(main: HTMLElement): Promise<void> {
  main.className = 'page page--goals';
  const team = currentTeam();
  const status = statusRegion('Goals status');
  const cards = el('div', { class: 'panel panel--grey link-stack-panel' });
  const tree = el('div', { role: 'tree', 'aria-label': 'Goals', class: 'goal-tree' });
  const newGoal = el('button', { type: 'button', class: 'pill pill--dark' }, 'New goal');

  main.append(
    el('h1', { class: 'page__title' }, 'Goals'),
    status,
    newGoal,
    cards,
    tree,
  );
  if (!team) return;

  const bars = new Map<string, ProgressBar>();
  const labels = new Map<string, HTMLElement>();
  let goals: Goal[] = [];
  let focusedId: string | null = null;
  const collapsed = new Set<string>();

  const openGoalDialog = (goal: Goal, opener: HTMLElement | null) => {
    openDialog({
      name: `Goal: ${goal.name}`,
      opener,
      build: (handle) => {
        const weight = labelledField({ name: 'Weight', kind: 'number', value: String(goal.weight) });
        weight.input.setAttribute('role', 'spinbutton');
        weight.input.setAttribute('aria-valuenow', String(goal.weight));
        const manual = labelledField({
          name: 'Manual value',
          kind: 'number',
          value: String(goal.manualValue),
        });
        manual.input.setAttribute('role', 'spinbutton');
        manual.input.setAttribute('aria-valuenow', String(goal.manualValue));
        const save = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Save goal');
        const close = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Close goal');
        on(close, 'click', handle.close);
        const form = el('form', { class: 'dialog-body stack' }, [
          el('h2', { class: 'dialog-title' }, `Goal: ${goal.name}`),
          weight.wrap,
          manual.wrap,
          el('div', { class: 'dialog-actions' }, [save, close]),
        ]) as HTMLFormElement;
        on(form, 'submit', (event) => {
          event.preventDefault();
          if (save.getAttribute('aria-busy') === 'true') return;
          save.setAttribute('aria-busy', 'true');
          void api
            .patch<Goal>(`/api/goals/${goal.id}`, {
              weight: Number((weight.input as HTMLInputElement).value),
              manualValue: Number((manual.input as HTMLInputElement).value),
            })
            .then(() => handle.close())
            .catch((err) => {
              if (err instanceof ApiCallError) {
                weight.setError(err.failure.errors?.weight ?? null);
                manual.setError(err.failure.errors?.manualValue ?? null);
              }
              save.removeAttribute('aria-busy');
            });
        });
        return form;
      },
    });
  };

  const drawCards = () => {
    clear(cards);
    cards.appendChild(el('h2', { class: 'panel__title' }, 'Top-level goals'));
    const stack = el('ul', { class: 'link-stack' });
    for (const goal of goals.filter((g) => g.parentId === null)) {
      const link = el('a', { href: '#', class: 'link-card__link', 'aria-label': `Open ${goal.name}` }, goal.name);
      on(link, 'click', (event) => {
        event.preventDefault();
        openGoalDialog(goal, link);
      });
      stack.appendChild(
        el('li', { class: 'link-card' }, [
          el('div', {}, [
            link,
            el('p', { class: 'link-card__subtitle' }, `${goal.percent}% complete`),
          ]),
          el('span', { class: 'round-arrow', 'aria-hidden': 'true' }, '\u2192'),
        ]),
      );
    }
    cards.appendChild(stack);
  };

  const drawTree = () => {
    clear(tree);
    bars.clear();
    labels.clear();
    const roots = buildTree(goals);
    const renderNodes = (nodes: Node[], level: number, host: HTMLElement) => {
      for (const node of nodes) {
        const hasChildren = node.children.length > 0;
        const label = `${node.goal.name}, ${node.goal.percent}% complete`;
        const item = el('div', {
          role: 'treeitem',
          'aria-label': label,
          'aria-level': String(level),
          'aria-expanded': hasChildren ? (collapsed.has(node.goal.id) ? 'false' : 'true') : null,
          'data-goal': node.goal.id,
          tabindex: '-1',
          class: 'goal-node',
        });
        const bar = progressBar(node.goal.name, node.goal.progress);
        bars.set(node.goal.id, bar);
        const nameNode = el('span', { class: 'goal-node__name' }, label);
        labels.set(node.goal.id, nameNode);
        item.append(nameNode, bar.node);
        host.appendChild(item);
        if (hasChildren) {
          const group = el('div', { role: 'group', class: 'goal-group' });
          renderNodes(node.children, level + 1, group);
          group.hidden = collapsed.has(node.goal.id);
          host.appendChild(group);
        }
      }
    };
    renderNodes(roots, 1, tree);
    const nodes = visibleNodes();
    if (nodes.length > 0) {
      const chosen = nodes.find((n) => n.dataset.goal === focusedId) ?? nodes[0];
      chosen.tabIndex = 0;
      focusedId = chosen.dataset.goal as string;
    }
  };

  const visibleNodes = (): HTMLElement[] =>
    Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]')).filter((node) => {
      let parent = node.parentElement;
      while (parent && parent !== tree) {
        if (parent instanceof HTMLElement && parent.hidden) return false;
        parent = parent.parentElement;
      }
      return true;
    });

  const setTabbable = (node: HTMLElement) => {
    for (const other of tree.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
      other.tabIndex = -1;
    }
    node.tabIndex = 0;
    focusedId = node.dataset.goal as string;
    node.focus();
  };

  on(tree, 'keydown', (event) => {
    const current = (event.target as HTMLElement).closest('[role="treeitem"]') as HTMLElement | null;
    if (!current) return;
    const id = current.dataset.goal as string;
    const nodes = visibleNodes();
    const index = nodes.indexOf(current);
    const group = current.nextElementSibling;
    const hasChildren = group instanceof HTMLElement && group.getAttribute('role') === 'group';

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = nodes[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) setTabbable(next);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (hasChildren && collapsed.has(id)) {
        collapsed.delete(id);
        current.setAttribute('aria-expanded', 'true');
        (group as HTMLElement).hidden = false;
        return;
      }
      if (hasChildren) {
        const child = (group as HTMLElement).querySelector<HTMLElement>('[role="treeitem"]');
        if (child) setTabbable(child);
      }
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (hasChildren && !collapsed.has(id)) {
        collapsed.add(id);
        current.setAttribute('aria-expanded', 'false');
        (group as HTMLElement).hidden = true;
        return;
      }
      const parentGroup = current.closest('[role="group"]');
      const parentItem = parentGroup?.previousElementSibling;
      if (parentItem instanceof HTMLElement) setTabbable(parentItem);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const goal = goals.find((g) => g.id === id);
      if (goal) openGoalDialog(goal, current);
    }
  });

  const refresh = async (animateBars: boolean) => {
    const data = await api.get<{ goals: Goal[] }>(`/api/teams/${team.id}/goals`);
    const previous = new Map(goals.map((g) => [g.id, g]));
    goals = data.goals;
    if (!animateBars || bars.size === 0) {
      drawCards();
      drawTree();
      return;
    }
    drawCards();
    for (const goal of goals) {
      const bar = bars.get(goal.id);
      const label = labels.get(goal.id);
      const before = previous.get(goal.id);
      if (!bar || !label) {
        drawTree();
        return;
      }
      const text = `${goal.name}, ${goal.percent}% complete`;
      label.textContent = text;
      const item = tree.querySelector<HTMLElement>(`[data-goal="${goal.id}"]`);
      if (item) item.setAttribute('aria-label', text);
      if (!before || before.progress !== goal.progress) bar.set(goal.progress);
    }
  };

  on(newGoal, 'click', () => {
    openDialog({
      name: 'New goal',
      opener: newGoal,
      build: (handle) => {
        const goalName = labelledField({ name: 'Goal name' });
        const parent = labelledField({
          name: 'Parent goal',
          kind: 'select',
          options: ['', ...goals.map((g) => g.name)],
        });
        const weight = labelledField({ name: 'Weight', kind: 'number', value: '1' });
        weight.input.setAttribute('role', 'spinbutton');
        const create = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Create goal');
        const cancel = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Cancel');
        on(cancel, 'click', handle.close);
        const form = el('form', { class: 'dialog-body stack' }, [
          el('h2', { class: 'dialog-title' }, 'New goal'),
          goalName.wrap,
          parent.wrap,
          weight.wrap,
          el('div', { class: 'dialog-actions' }, [create, cancel]),
        ]) as HTMLFormElement;
        on(form, 'submit', (event) => {
          event.preventDefault();
          if (create.getAttribute('aria-busy') === 'true') return;
          create.setAttribute('aria-busy', 'true');
          const parentName = (parent.input as HTMLSelectElement).value;
          const parentGoal = goals.find((g) => g.name === parentName);
          void api
            .post(`/api/teams/${team.id}/goals`, {
              name: (goalName.input as HTMLInputElement).value,
              parentId: parentGoal ? parentGoal.id : null,
              weight: Number((weight.input as HTMLInputElement).value),
            })
            .then(() => {
              handle.close();
              announce('Goals status', 'Goal created');
            })
            .catch((err) => {
              if (err instanceof ApiCallError) {
                goalName.setError(err.failure.errors?.name ?? null);
                weight.setError(err.failure.errors?.weight ?? null);
              }
              create.removeAttribute('aria-busy');
            });
        });
        return form;
      },
    });
  });

  await refresh(false);

  const stop = onLive((event) => {
    if (event.type === 'goals_changed' && event.teamId === team.id) void refresh(true);
  });
  main.addEventListener('page:teardown', stop, { once: true });
}
