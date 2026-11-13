import { api, type Me } from './api.js';
import { h, clear } from './dom.js';
import { header, parseRoute, type AppCtx, type Route } from './shell.js';
import { renderHome } from './home.js';
import { renderBuilder } from './builder.js';
import { renderWorkout } from './workout-detail.js';
import { renderCoach } from './coach.js';
import { renderPlans } from './plans.js';
import { renderInbox } from './inbox.js';
import { renderCoaches } from './coaches.js';
import { renderSignIn } from './sign-in.js';
import { renderNotFound } from './not-found.js';

interface LiveMessage {
  athlete_id: string;
  what: string;
  workout_id?: string;
}

type RefreshHandler = (msg: LiveMessage) => void;

const liveHandlers = new Set<RefreshHandler>();

export function onLiveChange(handler: RefreshHandler): () => void {
  liveHandlers.add(handler);
  return () => {
    liveHandlers.delete(handler);
  };
}

function connectLive(): void {
  const source = new EventSource('/api/live');
  source.addEventListener('change', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as LiveMessage;
    for (const handler of liveHandlers) handler(data);
  });
  source.addEventListener('notice', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as { text: string };
    const notices = document.getElementById('notices');
    if (notices) notices.textContent = data.text;
  });
}

interface NotFoundSignal {
  notFound: true;
}

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  let me: Me | null = null;
  try {
    me = (await api.get<Me>('/me')) as Me;
  } catch {
    me = null;
  }

  const athletes: { id: string; name: string }[] = [];
  if (me !== null && me.role === 'coach') {
    const res = await api.get<{ athletes: { id: string; name: string }[] }>('/athletes');
    athletes.push(...res.athletes);
  }

  const noticesNode = h('div', { id: 'notices', role: 'status', 'aria-live': 'polite' });
  const ctx: AppCtx = {
    me,
    athletes,
    notices: noticesNode,
    reloadHeader: async () => {
      try {
        const fresh = (await api.get<Me>('/me')) as Me;
        ctx.me = fresh;
      } catch {
        ctx.me = null;
      }
    },
    navigate: (to: string) => {
      window.history.pushState({}, '', to);
      void render();
    },
  };

  const bar = header(ctx);
  const main = h('main', { id: 'view', class: 'view' });

  clear(app);
  app.append(bar, main);

  async function render(): Promise<void> {
    const route = parseRoute(window.location.pathname + window.location.search);
    clear(main);
    try {
      await renderRoute(route, main, ctx);
    } catch (err) {
      if (isNotFoundSignal(err)) {
        main.append(renderNotFound());
      } else if (err instanceof Error && err.message.includes('404')) {
        main.append(renderNotFound());
      } else {
        main.append(renderNotFound());
      }
    }
  }

  window.addEventListener('popstate', () => void render());
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (anchor === null) return;
    const href = anchor.getAttribute('href') ?? '';
    if (!href.startsWith('/') || href.startsWith('//')) return;
    event.preventDefault();
    window.history.pushState({}, '', href);
    void render();
  });

  await render();
  connectLive();
}

function isNotFoundSignal(value: unknown): value is NotFoundSignal {
  return typeof value === 'object' && value !== null && (value as { notFound?: unknown }).notFound === true;
}

async function renderRoute(route: Route, main: HTMLElement, ctx: AppCtx): Promise<void> {
  switch (route.name) {
    case 'sign-in':
      main.append(renderSignIn());
      return;
    case 'home':
      await renderHome(main, ctx, route.athleteId, route.week);
      return;
    case 'builder':
      main.append(renderBuilder(ctx, route.athleteId, route.date, route.workout));
      return;
    case 'workout':
      await renderWorkout(main, ctx, route.workoutId);
      return;
    case 'coach':
      await renderCoach(main, ctx);
      return;
    case 'plans':
      await renderPlans(main, ctx);
      return;
    case 'inbox':
      await renderInbox(main, ctx);
      return;
    case 'coaches':
      await renderCoaches(main, ctx);
      return;
    default:
      main.append(renderNotFound());
  }
}

void boot();
