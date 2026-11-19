import { getJson, sendJson } from './api.js';
import { clear, el } from './dom.js';
import { closeLive, connectLive } from './live.js';
import { emptyGlyph } from './marks.js';
import { currentSession, loadSession, pageStatusRegion, readEmbeddedConfig, setPrincipal, topBar } from './shell.js';
import { renderHome } from './pages/home.js';
import { renderChapter } from './pages/chapter.js';
import { renderRuleIndex } from './pages/rules.js';
import { renderSignIn, renderActivate } from './pages/signin.js';
import { renderLibrary } from './pages/library.js';
import { renderMyRequests, renderRequest } from './pages/requests.js';
import { renderQueue } from './pages/queue.js';
import { renderEditor } from './pages/editor.js';
import { renderAdmin } from './pages/admin.js';

export interface PageContext {
  main: HTMLElement;
  params: Record<string, string>;
  navigate: (path: string) => void;
}

const cleanups: (() => void)[] = [];

export function registerCleanup(cleanup: () => void): void {
  cleanups.push(cleanup);
}

function runCleanups(): void {
  while (cleanups.length > 0) cleanups.pop()?.();
}

export function notFoundPage(main: HTMLElement): void {
  main.appendChild(el('div', { class: 'cell field field-ember empty-state' }, emptyGlyph(), el('h1', {}, 'Not found')));
}

function signedInShell(root: HTMLElement): HTMLElement {
  const main = el('main', { class: 'page signed-in' });
  root.appendChild(topBar(navigate, () => void signOut()));
  root.appendChild(pageStatusRegion());
  root.appendChild(main);
  return main;
}

async function signOut(): Promise<void> {
  await sendJson('DELETE', '/api/session');
  setPrincipal(null);
  closeLive();
  navigate('/signin');
}

export function navigate(path: string): void {
  if (path !== `${window.location.pathname}${window.location.search}`) {
    window.history.pushState({}, '', path);
  }
  void render();
}

async function render(): Promise<void> {
  runCleanups();
  const root = document.getElementById('app');
  if (!root) return;
  clear(root);
  document.body.classList.remove('home-body');

  const segments = window.location.pathname.split('/').filter((part) => part !== '');
  const session = await loadSession();

  const publicMain = (): HTMLElement => {
    const main = el('main', { class: 'page public' });
    root.appendChild(main);
    return main;
  };

  if (segments.length === 0) {
    document.body.classList.add('home-body');
    await renderHome(publicMain(), navigate);
    return;
  }

  if (segments[0] === 'chapters' && segments.length === 2) {
    await renderChapter(publicMain(), { slug: segments[1]!, focusIdentifier: null }, navigate);
    return;
  }

  if (segments[0] === 'rules') {
    if (segments.length === 1) {
      await renderRuleIndex(publicMain(), navigate);
      return;
    }
    await renderRuleRoute(publicMain(), segments[1]!, navigate);
    return;
  }

  if (segments[0] === 'signin') {
    renderSignIn(publicMain(), navigate);
    return;
  }

  if (segments[0] === 'activate' && segments.length === 2) {
    await renderActivate(publicMain(), segments[1]!, navigate);
    return;
  }

  if (!session.principal) {
    window.history.replaceState({}, '', '/signin');
    renderSignIn(publicMain(), navigate);
    return;
  }

  connectLive();
  const main = signedInShell(root);
  const context: PageContext = { main, params: {}, navigate };

  if (segments[0] === 'library' && segments.length === 1) {
    await renderLibrary(context);
    return;
  }
  if (segments[0] === 'requests') {
    if (segments.length === 1) {
      await renderMyRequests(context);
      return;
    }
    if (segments.length === 2) {
      context.params = { id: segments[1]! };
      await renderRequest(context);
      return;
    }
  }
  if (segments[0] === 'queue' && segments.length === 1) {
    await renderQueue(context);
    return;
  }
  if (segments[0] === 'editor' && segments.length === 2) {
    context.params = { slug: segments[1]! };
    await renderEditor(context);
    return;
  }
  if (segments[0] === 'admin' && segments.length === 2) {
    context.params = { area: segments[1]! };
    await renderAdmin(context);
    return;
  }

  notFoundPage(main);
}

interface RuleResponse {
  identifier: string;
  status: 'live' | 'withdrawn';
  chapter?: string;
  withdrawnInVersion?: number;
  replacedBy?: string;
}

async function renderRuleRoute(main: HTMLElement, identifier: string, go: (path: string) => void): Promise<void> {
  try {
    const rule = await getJson<RuleResponse>(`/api/rules/${encodeURIComponent(identifier)}`);
    if (rule.status === 'live' && rule.chapter) {
      await renderChapter(main, { slug: rule.chapter, focusIdentifier: identifier }, go);
      return;
    }
    main.appendChild(
      el(
        'div',
        { class: 'cell' },
        el('h1', {}, identifier),
        el(
          'p',
          {},
          `This rule was withdrawn in version ${rule.withdrawnInVersion}. It is replaced by `,
          el(
            'a',
            {
              href: `/rules/${rule.replacedBy}`,
              onclick: (event: Event) => {
                event.preventDefault();
                go(`/rules/${rule.replacedBy}`);
              },
            },
            rule.replacedBy ?? '',
          ),
          '.',
        ),
      ),
    );
  } catch {
    notFoundPage(main);
  }
}

window.addEventListener('popstate', () => {
  void render();
});

readEmbeddedConfig();
void (async () => {
  await render();
  if (currentSession().principal) connectLive();
})();
