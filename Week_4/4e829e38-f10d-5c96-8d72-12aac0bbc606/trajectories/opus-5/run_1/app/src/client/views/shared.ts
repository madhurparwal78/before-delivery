import type { Field, Project, Section, Task } from '../api.js';

export interface ProjectContext {
  project: Project;
  tasks: Task[];
  byId: Map<string, Task>;
  openTask: (taskId: string, opener: HTMLElement | null) => void;
}

export interface View {
  node: HTMLElement;
  upsert: (task: Task) => void;
  remove: (taskId: string) => void;
  rebuild: () => void;
  trace: (taskIds: string[]) => void;
}

/**
 * The control a deletion should leave focus on. It survives the rebuild the
 * deletion causes, so focus never falls to the page body.
 */
export const pendingFocus: { selector: string | null } = { selector: null };

export function takePendingFocus(host: HTMLElement): void {
  const { selector } = pendingFocus;
  if (!selector) return;
  pendingFocus.selector = null;
  const target = host.querySelector<HTMLElement>(selector);
  if (target) target.focus();
}

export function sortTasks(tasks: Task[], sections: Section[]): Task[] {
  const order = new Map(sections.map((section, index) => [section.id, index]));
  const tops = tasks
    .filter((task) => task.parentId === null)
    .sort(
      (a, b) =>
        (order.get(a.section) ?? 0) - (order.get(b.section) ?? 0) || a.position - b.position,
    );
  const children = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.parentId === null) continue;
    const list = children.get(task.parentId) ?? [];
    list.push(task);
    children.set(task.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.position - b.position);
  const out: Task[] = [];
  for (const top of tops) {
    out.push(top);
    for (const child of children.get(top.id) ?? []) out.push(child);
  }
  return out;
}

export function formatNumber(value: number): string {
  const rounded = Math.round(value * 1e10) / 1e10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

export function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function cellName(field: Field, value: unknown): string {
  const shown = valueText(value);
  return `${field.name}, ${shown === '' ? 'blank' : shown}`;
}

export function topLevelOf(context: ProjectContext, sectionId: string): Task[] {
  return context.tasks
    .filter((task) => task.parentId === null && task.section === sectionId)
    .sort((a, b) => a.position - b.position);
}

export function memberName(project: Project, personId: string | null): string {
  if (!personId) return '';
  const member = project.members.find((person) => person.id === personId);
  return member ? member.name : '';
}

/** A thin pink-to-coral line drawn through the tasks the last rule run changed. */
export function traceLine(points: { x: number; y: number }[]): SVGSVGElement | null {
  if (points.length === 0) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Rule trace');
  svg.setAttribute('class', 'trace');
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  svg.setAttribute('viewBox', `${minX} ${minY} ${Math.max(1, maxX - minX)} ${Math.max(1, maxY - minY)}`);
  svg.style.setProperty('left', `${minX}px`);
  svg.style.setProperty('top', `${minY}px`);
  svg.style.setProperty('width', `${Math.max(1, maxX - minX)}px`);
  svg.style.setProperty('height', `${Math.max(1, maxY - minY)}px`);

  const gradientId = `trace-gradient-${Math.random().toString(36).slice(2, 8)}`;
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  gradient.setAttribute('id', gradientId);
  for (const [offset, colour] of [
    ['0%', '#f7c9d9'],
    ['100%', '#e2543a'],
  ]) {
    const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', colour);
    gradient.appendChild(stop);
  }
  defs.appendChild(gradient);
  svg.appendChild(defs);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  path.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', `url(#${gradientId})`);
  path.setAttribute('stroke-width', '2');
  svg.appendChild(path);
  for (const end of [points[0], points[points.length - 1]]) {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', String(end.x));
    dot.setAttribute('cy', String(end.y));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', '#111111');
    svg.appendChild(dot);
  }
  return svg;
}
