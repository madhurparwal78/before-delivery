import { append, clear, h, prefersReducedMotion, svg } from './dom.js';
import { api, ApiCallError } from './api.js';
import { state } from './state.js';
import { openNewProjectDialog } from './dialogs.js';
import { ALERTS } from '../shared/copy.js';
import type { ProjectListEntry } from '../shared/types.js';

const DAY = 32;
const ROW = 44;

function mark(): HTMLElement {
  return h('div', { class: 'mark', 'aria-hidden': 'true' }, [
    h('span', { class: 'mark-bar' }),
    h('span', { class: 'mark-tail' }),
  ]);
}

function demoPanel(): HTMLElement {
  const rows = [
    { name: 'Order tiles', left: 2 * DAY, width: 3 * DAY },
    { name: 'Lay floor', left: 5 * DAY, width: 2 * DAY },
  ];
  const bars = rows.map((row, index) =>
    h('div', {
      class: 'demo-bar',
      'data-demo-bar': String(index),
      style: `left:${row.left}px;width:${row.width}px;top:${index * ROW + 10}px`,
    }),
  );
  const labels = rows.map((row, index) =>
    h('div', { class: 'demo-name', style: `top:${index * ROW + 10}px`, text: row.name }),
  );
  const connector = svg('svg', { class: 'demo-links', 'aria-hidden': 'true', width: '420', height: '100' }, [
    svg('path', {
      d: `M ${rows[0].left + rows[0].width} ${ROW / 2 + 10} H ${rows[0].left + rows[0].width + 10} V ${ROW + ROW / 2 + 10} H ${rows[1].left}`,
      fill: 'none',
      class: 'demo-link',
    }),
  ]);
  const pointer = h('div', {
    class: 'demo-pointer',
    'aria-hidden': 'true',
    style: `left:${rows[0].left + 28}px;top:${ROW / 2 + 6}px`,
  });

  const panel = h('section', { role: 'region', 'aria-label': 'Demo plan', class: 'demo', id: 'demo-plan' }, [
    h('div', { class: 'demo-track' }, [...labels, ...bars, connector as unknown as HTMLElement, pointer]),
  ]);

  const play = (): void => {
    const offsets = [-DAY, -DAY];
    bars.forEach((bar, index) => {
      bar.style.left = `${rows[index].left + DAY}px`;
      if (prefersReducedMotion()) return;
      bar.style.transform = `translateX(${offsets[index]}px)`;
    });
    pointer.style.left = `${rows[0].left + 28 + DAY}px`;
    if (prefersReducedMotion()) return;
    const started = performance.now();
    const ease = (p: number): number => 1 - Math.pow(1 - p, 3);
    const step = (): void => {
      const elapsed = performance.now() - started;
      let playing = false;
      bars.forEach((bar, index) => {
        const delay = index * 45;
        const progress = elapsed < delay ? 0 : Math.min(1, (elapsed - delay) / 220);
        if (progress < 1) playing = true;
        bar.style.transform = progress >= 1 ? '' : `translateX(${offsets[index] * (1 - ease(progress))}px)`;
      });
      if (playing) requestAnimationFrame(step);
    };
    step();
  };

  let played = false;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && !played) {
        played = true;
        play();
        observer.disconnect();
      }
    }
  });
  observer.observe(panel);
  return panel;
}

export function renderLanding(root: HTMLElement): void {
  clear(root);
  const signIn = h('a', { href: '/signin', text: 'Sign in', class: 'top-signin' });
  const headline = h('h1', { class: 'hero-headline' }, [
    h('span', { class: 'line-one', text: 'Move one task.' }),
    h('span', { class: 'line-two', text: 'The rest of the plan follows.' }),
  ]);
  const sentence = h('p', {
    class: 'hero-sentence',
    text:
      'Slackwater Plan counts working days, skips weekends and your holidays, and shows the critical path the moment a date moves.',
  });
  const start = h('a', { href: '/signup', text: 'Start a plan', class: 'button-link' });
  const see = h('a', { href: '#demo-plan', text: 'See a plan move \u2192', class: 'text-link' });
  see.addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('demo-plan')?.scrollIntoView({ behavior: 'smooth' });
  });

  append(root, [
    h('main', { class: 'landing' }, [
      signIn,
      mark(),
      h('div', { class: 'hero' }, [headline, sentence, h('p', { class: 'hero-links' }, [start, see])]),
      demoPanel(),
    ]),
  ]);
}

function authForm(
  root: HTMLElement,
  title: string,
  fields: { label: string; type: string }[],
  submitLabel: string,
  submit: (values: Record<string, string>, fail: (text: string) => void) => Promise<void>,
): void {
  clear(root);
  const alert = h('div', { role: 'alert', class: 'page-alert' });
  const inputs = new Map<string, HTMLInputElement>();
  const form = h('form', { class: 'auth-form' });
  for (const entry of fields) {
    const id = `a-${entry.label.toLowerCase()}`;
    const input = h('input', { type: entry.type, id, autocomplete: 'off' }) as HTMLInputElement;
    inputs.set(entry.label, input);
    form.appendChild(h('div', { class: 'field' }, [h('label', { for: id, text: entry.label }), input]));
  }
  const button = h('button', { type: 'submit', class: 'primary', text: submitLabel });
  form.appendChild(button);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    button.disabled = true;
    alert.textContent = '';
    const values: Record<string, string> = {};
    for (const [label, input] of inputs) values[label] = input.value;
    void submit(values, (text) => {
      alert.textContent = text;
      button.disabled = false;
    });
  });

  append(root, [h('main', { class: 'auth' }, [mark(), h('h1', { text: title }), alert, form])]);
  inputs.values().next().value?.focus();
}

function nextPath(): string {
  const next = new URL(location.href).searchParams.get('next');
  return next && next.startsWith('/') ? next : '/';
}

export function renderSignIn(root: HTMLElement): void {
  authForm(
    root,
    'Sign in',
    [
      { label: 'Email', type: 'text' },
      { label: 'Password', type: 'password' },
    ],
    'Sign in',
    async (values, fail) => {
      try {
        await api.post('/api/session', { email: values.Email, password: values.Password });
        location.href = nextPath();
      } catch {
        fail(ALERTS.signIn);
      }
    },
  );
}

export function renderSignUp(root: HTMLElement): void {
  authForm(
    root,
    'Create account',
    [
      { label: 'Name', type: 'text' },
      { label: 'Email', type: 'text' },
      { label: 'Password', type: 'password' },
    ],
    'Create account',
    async (values, fail) => {
      try {
        await api.post('/api/signup', {
          name: values.Name,
          email: values.Email,
          password: values.Password,
        });
        location.href = '/';
      } catch (error) {
        const failure = error instanceof ApiCallError ? error.failure : null;
        const code = String(failure?.body.error ?? '');
        const field = String(failure?.body.field ?? '');
        if (code === 'email_taken') fail(ALERTS.signUpTaken);
        else if (field === 'name') fail(ALERTS.signUpName);
        else if (field === 'email') fail(ALERTS.signUpEmail);
        else fail(ALERTS.signUpPassword);
      }
    },
  );
}

export async function renderProjectsIndex(root: HTMLElement): Promise<void> {
  const answer = await api.get<{ projects: ProjectListEntry[] }>('/api/projects');
  state.projects = answer.projects;
  clear(root);
  const list = h(
    'ul',
    { role: 'list', 'aria-label': 'Projects', class: 'plain-list project-list' },
    answer.projects.map((project) =>
      h('li', { role: 'listitem' }, [h('a', { href: `/projects/${project.id}`, text: project.name })]),
    ),
  );
  const create = h('button', { type: 'button', class: 'primary', text: 'New project' });
  create.addEventListener('click', () => openNewProjectDialog(create));
  append(root, [h('main', { class: 'home' }, [mark(), h('h1', { text: 'Projects' }), list, create])]);
}
