import { api, ApiCallError } from './api.js';
import { app, notice, setNavigator, type ChangeEvent, type Screen } from './app.js';
import { createBuilderScreen } from './builder.js';
import {
  createCoachDashboard,
  createCoachesScreen,
  createHomeRedirect,
  createInboxScreen,
  createPlansScreen,
} from './coach.js';
import { createWorkoutScreen } from './detail.js';
import { el, prefersReducedMotion } from './dom.js';
import { renderHeader } from './header.js';
import { createHomeScreen } from './home.js';
import { notFoundView } from './notFound.js';

const root = document.getElementById('app') as HTMLElement;
app.chartAnimationMs = Number(root.dataset.chartAnimationMs ?? '450');

const screenHolder = el('div', { class: 'screen' });

function signInScreen(): Screen {
  const email = el('input', {
    class: 'field',
    attrs: { type: 'email', 'aria-label': 'Email', id: 'sign-in-email' },
  });
  const password = el('input', {
    class: 'field',
    attrs: { type: 'password', 'aria-label': 'Password', id: 'sign-in-password' },
  });
  const alert = el('div', { class: 'alert', attrs: { role: 'alert', tabindex: '-1' } });
  const status = el('p', { class: 'status-line', attrs: { role: 'status', 'aria-live': 'polite' } });
  const submit = el('button', {
    class: 'pill pill-accent',
    text: 'Sign in',
    attrs: { type: 'submit' },
  });
  const form = el('form', {
    class: 'card sign-in-card',
    children: [
      el('h1', { class: 'display-line', text: 'Tempoline' }),
      el('label', { class: 'field-row', children: [el('span', { text: 'Email' }), email] }),
      el('label', { class: 'field-row', children: [el('span', { text: 'Password' }), password] }),
      submit,
      alert,
      status,
    ],
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alert.replaceChildren();
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    status.textContent = 'Signing in…';
    try {
      await api.signIn(email.value.trim(), password.value);
      window.location.assign('/');
    } catch (error) {
      status.textContent = '';
      if (error instanceof ApiCallError) {
        alert.replaceChildren(
          el('p', { text: error.failure.message ?? 'Email or password is incorrect.' }),
        );
        alert.focus();
      }
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  });
  return { element: el('main', { class: 'sign-in', children: [form] }) };
}

async function screenFor(path: string): Promise<Screen> {
  const role = app.me?.role;
  const athleteHome = /^\/athletes\/([^/]+)$/.exec(path);
  if (athleteHome) return createHomeScreen(athleteHome[1] as string);
  const builder = /^\/athletes\/([^/]+)\/builder$/.exec(path);
  if (builder) return createBuilderScreen(builder[1] as string);
  const workout = /^\/workouts\/([^/]+)$/.exec(path);
  if (workout) return createWorkoutScreen(workout[1] as string);
  if (path === '/') return createHomeRedirect();
  if (path === '/coach' && role === 'coach') return createCoachDashboard();
  if (path === '/plans' && role === 'coach') return createPlansScreen();
  if (path === '/inbox' && role === 'coach') return createInboxScreen();
  if (path === '/coaches' && role === 'athlete') return createCoachesScreen();
  return { element: notFoundView() };
}

async function render(): Promise<void> {
  app.screen?.stop?.();
  app.screen = null;
  try {
    const screen = await screenFor(window.location.pathname);
    app.screen = screen;
    screenHolder.replaceChildren(screen.element);
  } catch (error) {
    if (error instanceof ApiCallError && error.failure.status === 404) {
      screenHolder.replaceChildren(notFoundView());
      return;
    }
    if (error instanceof ApiCallError && error.failure.status === 401) {
      window.location.assign('/sign-in');
      return;
    }
    throw error;
  }
}

setNavigator((path, options) => {
  if (options?.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  void render();
});

window.addEventListener('popstate', () => void render());

document.addEventListener('click', (event) => {
  const mouse = event as MouseEvent;
  if (mouse.defaultPrevented || mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey) return;
  const link = (mouse.target as HTMLElement | null)?.closest('a');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href || !href.startsWith('/') || href.startsWith('/api/') || link.hasAttribute('download')) {
    return;
  }
  mouse.preventDefault();
  window.history.pushState(null, '', href);
  void render();
});

/** Section headings and ring rows fade up once, when a fifth of them is in view. */
function watchSectionEntrances(): void {
  if (prefersReducedMotion()) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.2 },
  );
  const watch = (): void => {
    for (const node of document.querySelectorAll('.section-heading, .ring-row')) {
      if (!node.classList.contains('in-view')) observer.observe(node);
    }
  };
  watch();
  new MutationObserver(watch).observe(screenHolder, { childList: true, subtree: true });
}

/** The two drift rows move in opposite directions as the wall crosses the viewport. */
function watchDriftWall(): void {
  if (prefersReducedMotion()) return;
  const update = (): void => {
    for (const wall of document.querySelectorAll<HTMLElement>('.drift-wall')) {
      const box = wall.getBoundingClientRect();
      const progress = Math.min(
        1,
        Math.max(0, (window.innerHeight - box.top) / (window.innerHeight + box.height)),
      );
      const shift = (progress - 0.5) * 120;
      const rows = wall.querySelectorAll<HTMLElement>('.drift-row');
      rows.forEach((row, index) => {
        row.style.transform = `translateX(${index === 0 ? shift : -shift}px)`;
      });
    }
  };
  update();
  window.addEventListener('scroll', update, { passive: true });
}

function startLive(): void {
  const stream = new EventSource('/api/live');
  stream.addEventListener('change', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as ChangeEvent;
    app.screen?.onChange?.(data);
  });
  stream.addEventListener('notice', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as { text: string };
    notice(data.text);
  });
}

async function boot(): Promise<void> {
  if (window.location.pathname === '/sign-in') {
    root.replaceChildren(signInScreen().element);
    return;
  }
  try {
    app.me = await api.me();
  } catch {
    window.location.assign('/sign-in');
    return;
  }
  root.replaceChildren(await renderHeader(app.me), screenHolder);
  if (root.dataset.route === 'not-found') screenHolder.replaceChildren(notFoundView());
  else await render();
  startLive();
  watchSectionEntrances();
  watchDriftWall();
}

void boot();
