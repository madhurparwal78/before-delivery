import { api, type Task } from '../api.js';
import { el, on } from '../dom.js';
import { animate, fixed4 } from '../motion.js';
import { patchTask } from '../save.js';
import { announce } from '../status.js';
import { settings } from '../state.js';
import { traceLine, type ProjectContext, type View } from './shared.js';

const STATUS = 'Timeline status';
const DAY_WIDTH = 32;

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function diffDays(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) /
      86400000,
  );
}

interface Scheduled {
  task: Task;
  start: string;
  due: string;
}

export function createTimelineView(context: ProjectContext): View {
  const node = el('div', { class: 'timeline' });
  const scroller = el('div', { class: 'timeline__scroll' });
  const grid = el('div', { class: 'timeline__grid' });
  const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  lines.setAttribute('class', 'timeline__lines');
  lines.setAttribute('aria-hidden', 'true');
  const traceHost = el('div', { class: 'trace-host' });
  const unscheduled = el('div', { class: 'timeline__unscheduled' });
  scroller.append(grid);
  node.append(traceHost, scroller, unscheduled);

  let dependencyFrom: string | null = null;
  let dependencyTarget: string | null = null;
  const tokens = new WeakMap<HTMLElement, number>();
  let nextToken = 1;

  const scheduledOf = (task: Task): Scheduled | null => {
    if (task.parentId !== null) return null;
    if (task.due === null) return null;
    return { task, start: task.start ?? task.due, due: task.due };
  };

  const scheduled = (): Scheduled[] =>
    context.tasks
      .map(scheduledOf)
      .filter((item): item is Scheduled => item !== null)
      .sort((a, b) => a.start.localeCompare(b.start) || a.task.name.localeCompare(b.task.name));

  const barNode = (taskId: string): HTMLElement | null =>
    grid.querySelector<HTMLElement>(`[data-task="${taskId}"]`);

  const origin = (): string => {
    const items = scheduled();
    if (items.length === 0) return new Date(Date.now()).toISOString().slice(0, 10);
    return items.reduce((min, item) => (item.start < min ? item.start : min), items[0].start);
  };

  const warningFor = (task: Task): string | null => {
    const blocker = context.project.dependencies?.find((link) => link.to === task.id);
    if (!blocker) return null;
    const from = context.byId.get(blocker.from);
    const start = task.start ?? task.due;
    if (!from || !from.due || !start) return null;
    return from.due >= start ? `Starts before ${from.name} is due` : null;
  };

  const animateMove = (bar: HTMLElement, before: DOMRect) => {
    const after = bar.getBoundingClientRect();
    const dx = before.left - after.left;
    const token = nextToken;
    nextToken += 1;
    tokens.set(bar, token);
    bar.setAttribute('data-motion', 'moving');
    animate(
      settings.moveMs,
      (eased) => {
        if (tokens.get(bar) !== token) return;
        bar.setAttribute('data-move-progress', fixed4(eased));
        bar.style.setProperty('transform', `translateX(${dx * (1 - eased)}px)`);
      },
      () => {
        if (tokens.get(bar) !== token) return;
        bar.setAttribute('data-move-progress', '1.0000');
        bar.setAttribute('data-motion', 'settled');
        bar.style.removeProperty('transform');
      },
    );
  };

  const placeBar = (bar: HTMLElement, item: Scheduled) => {
    const left = diffDays(origin(), item.start) * DAY_WIDTH;
    const width = Math.max(1, diffDays(item.start, item.due) + 1) * DAY_WIDTH;
    bar.style.setProperty('left', `${left}px`);
    bar.style.setProperty('width', `${width}px`);
    bar.setAttribute('data-start', item.start);
    bar.setAttribute('data-due', item.due);
    bar.setAttribute('aria-label', `${item.task.name}, ${item.start} to ${item.due}`);
    const label = bar.querySelector('.timeline__bar-name');
    if (label) label.textContent = item.task.name;
    const warning = warningFor(item.task);
    let warn = bar.querySelector<HTMLElement>('.timeline__warning');
    if (warning) {
      if (!warn) {
        warn = el('span', { class: 'timeline__warning' });
        bar.appendChild(warn);
      }
      warn.textContent = warning;
    } else if (warn) {
      warn.remove();
    }
  };

  const moveBoth = async (taskId: string, days: number) => {
    const task = context.byId.get(taskId);
    const item = task ? scheduledOf(task) : null;
    if (!task || !item) return;
    const start = addDays(item.start, days);
    const due = addDays(item.due, days);
    const bar = barNode(taskId);
    const before = bar?.getBoundingClientRect();
    const outcome = await patchTask(taskId, { version: task.version, start, due });
    if (!outcome.task) return;
    announce(STATUS, `${task.name} moved to ${start} to ${due}`);
    if (bar && before) {
      placeBar(bar, { task: outcome.task, start, due });
      animateMove(bar, before);
    }
  };

  const moveDue = async (taskId: string, days: number) => {
    const task = context.byId.get(taskId);
    const item = task ? scheduledOf(task) : null;
    if (!task || !item) return;
    const due = addDays(item.due, days);
    if (due < item.start) {
      announce(STATUS, "Due date can't be before the start date");
      return;
    }
    const outcome = await patchTask(taskId, { version: task.version, due });
    if (!outcome.task) return;
    announce(STATUS, `${task.name} now due ${due}`);
    const bar = barNode(taskId);
    if (bar) placeBar(bar, { task: outcome.task, start: item.start, due });
  };

  const setDependency = async (fromId: string, toId: string) => {
    const from = context.byId.get(fromId);
    const to = context.byId.get(toId);
    if (!from || !to) return;
    try {
      await api.post(`/api/tasks/${fromId}/dependencies`, { blocks: toId });
      announce(STATUS, `${from.name} now blocks ${to.name}`);
    } catch {
      announce(STATUS, `${from.name} can't block ${to.name}`);
    }
  };

  const highlightTarget = () => {
    for (const bar of grid.querySelectorAll<HTMLElement>('[data-task]')) {
      bar.classList.toggle('is-link-target', bar.dataset.task === dependencyTarget);
    }
  };

  on(node, 'keydown', (event) => {
    const bar = (event.target as HTMLElement).closest('[data-task]') as HTMLElement | null;
    if (!bar) return;
    const taskId = bar.dataset.task as string;

    if (dependencyFrom !== null) {
      const others = scheduled()
        .map((item) => item.task.id)
        .filter((id) => id !== dependencyFrom);
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        const index = others.indexOf(dependencyTarget ?? '');
        dependencyTarget = others[(index + 1) % others.length] ?? null;
        highlightTarget();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        const index = others.indexOf(dependencyTarget ?? '');
        dependencyTarget = others[(index - 1 + others.length) % others.length] ?? null;
        highlightTarget();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const target = dependencyTarget;
        const from = dependencyFrom;
        dependencyFrom = null;
        dependencyTarget = null;
        highlightTarget();
        if (from && target) void setDependency(from, target);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        dependencyFrom = null;
        dependencyTarget = null;
        highlightTarget();
        announce(STATUS, 'Dependency cancelled');
        return;
      }
      return;
    }

    if (event.key === 'd' || event.key === 'D') {
      event.preventDefault();
      const task = context.byId.get(taskId);
      if (!task) return;
      dependencyFrom = taskId;
      const others = scheduled()
        .map((item) => item.task.id)
        .filter((id) => id !== taskId);
      dependencyTarget = others[0] ?? null;
      highlightTarget();
      announce(STATUS, `Choose the task that waits for ${task.name}`);
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const days = event.key === 'ArrowRight' ? 1 : -1;
      if (event.shiftKey) void moveDue(taskId, days);
      else void moveBoth(taskId, days);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      context.openTask(taskId, bar);
    }
  });

  const drawLines = () => {
    lines.replaceChildren();
    const host = grid.getBoundingClientRect();
    lines.setAttribute('width', String(grid.scrollWidth));
    lines.setAttribute('height', String(grid.scrollHeight));
    for (const link of context.project.dependencies ?? []) {
      const from = barNode(link.from);
      const to = barNode(link.to);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      path.setAttribute('x1', String(a.right - host.left));
      path.setAttribute('y1', String(a.top - host.top + a.height / 2));
      path.setAttribute('x2', String(b.left - host.left));
      path.setAttribute('y2', String(b.top - host.top + b.height / 2));
      path.setAttribute('stroke', '#111111');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('data-from', link.from);
      path.setAttribute('data-to', link.to);
      lines.appendChild(path);
    }
  };

  const rebuild = () => {
    const focused = (document.activeElement as HTMLElement | null)?.closest('[data-task]');
    const focusedTask = focused instanceof HTMLElement ? focused.dataset.task : null;
    grid.replaceChildren();
    const items = scheduled();
    const base = origin();
    const last = items.reduce((max, item) => (item.due > max ? item.due : max), base);
    const days = Math.max(10, diffDays(base, last) + 2);
    grid.style.setProperty('width', `${days * DAY_WIDTH}px`);
    const scale = el('div', { class: 'timeline__scale', 'aria-hidden': 'true' });
    for (let index = 0; index < days; index += 1) {
      scale.appendChild(
        el('span', { class: 'timeline__day', style: `left:${index * DAY_WIDTH}px` }),
      );
    }
    grid.appendChild(scale);
    grid.appendChild(lines);
    items.forEach((item, row) => {
      const bar = el('button', {
        type: 'button',
        class: 'timeline__bar',
        'data-task': item.task.id,
        'data-move-progress': '1.0000',
        'data-motion': 'settled',
        style: `top:${row * 44 + 28}px`,
      });
      bar.appendChild(el('span', { class: 'timeline__bar-name' }, item.task.name));
      placeBar(bar, item);
      grid.appendChild(bar);
    });
    grid.style.setProperty('height', `${items.length * 44 + 56}px`);

    unscheduled.replaceChildren();
    const loose = context.tasks.filter(
      (task) => task.parentId === null && task.due === null,
    );
    unscheduled.appendChild(el('h3', { class: 'timeline__unscheduled-title' }, 'Unscheduled'));
    unscheduled.appendChild(
      el(
        'ul',
        { class: 'timeline__unscheduled-list' },
        loose.map((task) => el('li', { 'data-task': task.id }, task.name)),
      ),
    );
    drawLines();
    if (focusedTask) barNode(focusedTask)?.focus();
  };

  const upsert = (task: Task) => {
    const bar = barNode(task.id);
    const item = scheduledOf(task);
    if (!bar || !item) {
      rebuild();
      return;
    }
    const before = bar.getBoundingClientRect();
    placeBar(bar, item);
    const after = bar.getBoundingClientRect();
    if (before.left !== after.left) animateMove(bar, before);
    drawLines();
  };

  const remove = (taskId: string) => {
    barNode(taskId)?.remove();
    drawLines();
  };

  const trace = (taskIds: string[]) => {
    traceHost.replaceChildren();
    const host = traceHost.getBoundingClientRect();
    const points = taskIds
      .map((id) => barNode(id))
      .filter((bar): bar is HTMLElement => bar !== null)
      .map((bar) => {
        const box = bar.getBoundingClientRect();
        return {
          x: box.left - host.left + box.width / 2,
          y: box.top - host.top + box.height / 2,
        };
      });
    const line = traceLine(points);
    if (line) traceHost.appendChild(line);
  };

  rebuild();
  return { node, upsert, remove, rebuild, trace };
}
