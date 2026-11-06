// Async feedback copy, live regions and the Problems summary: what an action
// announced stays until the user's next action on the same screen.
import { h, clear, focusElement } from './dom.js';

export interface Feedback {
  message: string;
  kind: 'pending' | 'success' | 'error';
}

export class Desk {
  statusEl: HTMLElement;
  noteEl: HTMLElement | null = null;
  problems: Record<string, string> = {};
  keepForNextPoll: Feedback | null = null;

  constructor(statusEl: HTMLElement) {
    this.statusEl = statusEl;
  }

  announce(message: string, kind: Feedback['kind'] = 'pending'): void {
    this.statusEl.textContent = message;
    this.statusEl.dataset.kind = kind;
    this.keepForNextPoll = { message, kind };
  }

  repaint(): void {
    if (this.keepForNextPoll !== null) {
      this.statusEl.textContent = this.keepForNextPoll.message;
      this.statusEl.dataset.kind = this.keepForNextPoll.kind;
    }
  }

  clearAll(): void {
    this.keepForNextPoll = null;
    this.statusEl.textContent = '';
    this.problems = {};
  }

  showProblems(container: HTMLElement, fields: Record<string, string>): void {
    this.problems = fields;
    renderProblems(container, fields);
  }

  inlineErrors(container: HTMLElement, fields: Record<string, string>): void {
    for (const [field, message] of Object.entries(fields)) {
      const target = container.querySelector(`[data-error-for="${field}"]`);
      if (target !== null) {
        (target as HTMLElement).textContent = message;
        const input = container.querySelector(`#${field}`);
        if (input !== null) input.setAttribute('aria-invalid', 'true');
      }
    }
    renderProblems(container, fields);
    const summary = container.querySelector('[data-role="problems"] h3, [data-role="problems"] .problems-heading');
    if (summary !== null) focusElement(summary as HTMLElement);
  }
}

export function problemsRegion(): HTMLElement {
  return h('div', { role: 'region', 'aria-label': 'Problems', 'data-role': 'problems', class: 'problems' });
}

function renderProblems(container: HTMLElement, fields: Record<string, string>): void {
  const region = container.querySelector('[data-role="problems"]');
  if (region === null) return;
  clear(region as HTMLElement);
  const hasProblems = Object.keys(fields).length > 0;
  (region as HTMLElement).hidden = !hasProblems;
  if (!hasProblems) return;
  const heading = h('h3', { class: 'problems-heading' }, 'Problems');
  heading.setAttribute('tabindex', '-1');
  region.append(heading);
  const list = h('ul', { class: 'problems-list' });
  for (const [field, message] of Object.entries(fields)) {
    const label = fieldLabel(container, field);
    list.append(h('li', {}, h('a', {
      href: `#${field}`,
      class: 'problem-link',
      onclick: (e: Event) => {
        e.preventDefault();
        const input = container.querySelector(`#${field}`);
        if (input !== null) {
          (input as HTMLElement).scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
          (input as HTMLElement).focus();
        }
      },
    }, `${label}: ${message}`)));
  }
  region.append(list);
}

function fieldLabel(container: HTMLElement, field: string): string {
  const label = container.querySelector(`label[for="${field}"]`);
  if (label !== null) return label.textContent ?? field;
  const input = container.querySelector(`#${field}`);
  if (input !== null) return (input as HTMLElement).getAttribute('aria-label') ?? field;
  return field;
}

export function liveRegion(name: string): HTMLElement {
  const el = h('div', { role: 'status', 'aria-live': 'polite', 'aria-label': name, class: 'live-region' });
  el.id = `live-${name.replace(/[^a-z]/gi, '-')}`;
  return el;
}

export function fieldErrorsClear(container: HTMLElement): void {
  container.querySelectorAll('[data-error-for]').forEach((el) => {
    (el as HTMLElement).textContent = '';
  });
  container.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const region = container.querySelector('[data-role="problems"]');
  if (region !== null) {
    clear(region as HTMLElement);
    (region as HTMLElement).hidden = true;
  }
}
