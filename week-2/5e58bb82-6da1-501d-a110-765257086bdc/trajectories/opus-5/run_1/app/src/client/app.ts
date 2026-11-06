import { NOT_FOUND_HEADING, NOT_FOUND_TEXT } from '../shared/copy.js';
import type { User } from '../shared/types.js';
import { isCurrent, request } from './api.js';
import { clear, el } from './dom.js';
import { parseScreen, roleMayOpen, ROLE_HOME, type Screen } from './routes.js';
import { createShell, type Shell } from './shell.js';
import { fleetScreen } from './screens/fleet.js';
import { flagsScreen } from './screens/flags.js';
import { historyScreen } from './screens/history.js';
import { launchScreen } from './screens/launch.js';
import { linePlanScreen } from './screens/linePlan.js';
import { missionConsoleScreen } from './screens/missionConsole.js';
import { missionsScreen } from './screens/missions.js';
import { newMissionScreen } from './screens/newMission.js';
import { signInScreen } from './screens/signIn.js';
import { surveyScreen } from './screens/survey.js';
import { surveysScreen } from './screens/surveys.js';

export interface Mounted {
  node: HTMLElement;
  dispose?: () => void;
}

export type ScreenFactory = (
  shell: Shell,
  context: { screen: Screen; query: URLSearchParams; path: string },
) => Mounted;

export function startApp(root: HTMLElement): void {
  let mounted: Mounted | null = null;
  let signInReason: string | null = null;

  const shell = createShell(root, {
    render: (path) => {
      void render(path);
    },
    signInReason: (reason) => {
      signInReason = reason;
    },
    notFound: () => showNotFound(),
  });

  function show(factory: ScreenFactory, screen: Screen, query: URLSearchParams, path: string): void {
    mounted?.dispose?.();
    clear(shell.screen);
    mounted = factory(shell, { screen, query, path });
    shell.screen.append(mounted.node);
  }

  function showNotFound(): void {
    mounted?.dispose?.();
    clear(shell.screen);
    mounted = {
      node: el('section', { class: 'notfound' }, [
        el('h1', {}, [NOT_FOUND_HEADING]),
        el('p', {}, [NOT_FOUND_TEXT]),
      ]),
    };
    shell.screen.append(mounted.node);
  }

  function showSignIn(path: string, query: URLSearchParams): void {
    mounted?.dispose?.();
    clear(shell.screen);
    const reason = signInReason;
    signInReason = null;
    mounted = signInScreen(shell, {
      next: query.get('next'),
      reason,
      onSignedIn: (user, home) => {
        shell.user = user;
        shell.navigate(home, { replace: true });
      },
    });
    shell.screen.append(mounted.node);
    void path;
  }

  const FACTORIES: Partial<Record<Screen['kind'], ScreenFactory>> = {
    fleet: fleetScreen,
    fleetVessel: fleetScreen,
    missions: missionsScreen,
    missionNew: newMissionScreen,
    mission: missionConsoleScreen,
    missionPlan: linePlanScreen,
    missionHistory: historyScreen,
    launch: launchScreen,
    flags: flagsScreen,
    surveys: surveysScreen,
    survey: surveyScreen,
  };

  async function render(rawPath: string): Promise<void> {
    const url = new URL(rawPath, window.location.origin);
    const pathname = url.pathname;
    const query = url.searchParams;

    if (!shell.user) {
      const at = shell.generation;
      try {
        const user = await request<User>('/api/me');
        if (!isCurrent(at)) return;
        shell.user = user;
      } catch {
        if (pathname !== '/sign-in') {
          const next = `${pathname}${url.search}`;
          window.history.replaceState(null, '', `/sign-in?next=${encodeURIComponent(next)}`);
          showSignIn('/sign-in', new URLSearchParams({ next }));
          return;
        }
        showSignIn(pathname, query);
        return;
      }
    }

    const user = shell.user;
    if (!user) return;

    if (pathname === '/sign-in') {
      const next = query.get('next');
      const target = next && isSafeForRole(next, user) ? next : ROLE_HOME[user.role];
      shell.navigate(target, { replace: true });
      return;
    }

    if (pathname === '/') {
      shell.navigate(ROLE_HOME[user.role], { replace: true });
      return;
    }

    const screen = parseScreen(pathname);
    if (!screen || !roleMayOpen(user.role, screen)) {
      showNotFound();
      return;
    }
    const factory = FACTORIES[screen.kind];
    if (!factory) {
      showNotFound();
      return;
    }

    show(factory, screen, query, `${pathname}${url.search}`);
    void request('/api/me/last-screen', {
      method: 'PUT',
      body: { path: `${pathname}${url.search}` },
    }).catch(() => undefined);
  }

  function isSafeForRole(next: string, user: User): boolean {
    if (!next.startsWith('/') || next[1] === '/' || next[1] === '\\') return false;
    const screen = parseScreen(new URL(next, window.location.origin).pathname);
    return screen !== null && roleMayOpen(user.role, screen);
  }

  window.addEventListener('popstate', () => {
    void render(`${window.location.pathname}${window.location.search}`);
  });

  void render(`${window.location.pathname}${window.location.search}`);
}
