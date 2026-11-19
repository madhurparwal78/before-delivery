/**
 * The desk's top bar and the five-second refresh every signed-in screen runs.
 */
import { F } from '../../shared/feedback.ts';
import { api, ApiError, isSessionEnded } from '../ui/api.ts';
import { DESK_LINKS } from '../../shared/deskLinks.ts';
import { all, el, find, need, setHidden, setText } from '../ui/dom.ts';
import {
  announce,
  clearProblems,
  clearRefreshFailed,
  showProblems,
  showRefreshFailed,
  withPending,
} from '../ui/shell.ts';
import { openModal, field } from '../ui/dialog.ts';
import { navigate } from '../router.ts';

export const REFRESH_MS = 5000;
const SEARCH_PAUSE_MS = 300;

type Refresher = () => Promise<void>;

let refresher: Refresher | null = null;
let timer: number | null = null;
let lastAnswerId: string | null = null;
let answersKnown = false;

/** The screen on show registers how it re-reads itself. */
export function setRefresher(next: Refresher | null): void {
  refresher = next;
}

async function tick(): Promise<void> {
  if (isSessionEnded()) return;
  try {
    await readSession();
    if (refresher) await refresher();
    clearRefreshFailed();
  } catch (error) {
    if (error instanceof ApiError && error.failure.status === 401) return;
    // One failed refresh leaves everything where it is and shows one line.
    showRefreshFailed();
  }
}

/** A new answer reaches the open screen in place and is announced there. */
async function readSession(): Promise<void> {
  const answer = (await api.get('/api/session')) as {
    session: { today: string; latestAnswer: { id: string; message: string } | null };
  };
  const latest = answer.session.latestAnswer;
  if (!answersKnown) {
    answersKnown = true;
    lastAnswerId = latest?.id ?? null;
    return;
  }
  if (latest && latest.id !== lastAnswerId) {
    lastAnswerId = latest.id;
    announce(latest.message);
  }
}

export function startRefreshLoop(): void {
  if (timer !== null) return;
  timer = window.setInterval(() => {
    void tick();
  }, REFRESH_MS);
}

export function stopRefreshLoop(): void {
  if (timer === null) return;
  window.clearInterval(timer);
  timer = null;
}

// --------------------------------------------------------------- search box

export function wireSearch(): void {
  const input = find<HTMLInputElement>('#desk-search-input');
  const results = find<HTMLElement>('#search-results');
  if (!input || !results) return;

  let pause: number | null = null;
  let newest = 0;

  const close = (): void => {
    setHidden(results, true);
    results.textContent = '';
  };

  const show = (items: { label: string; href: string }[], text: string, down: boolean): void => {
    results.textContent = '';
    if (down) {
      results.append(el('li', { class: 'search-note', text: F.searchDown }));
    } else if (items.length === 0) {
      results.append(el('li', { class: 'search-note', text: F.nothingFound(text) }));
    } else {
      for (const item of items) {
        results.append(el('li', {}, [el('a', { href: item.href, text: item.label })]));
      }
    }
    setHidden(results, false);
  };

  input.addEventListener('input', () => {
    if (pause !== null) window.clearTimeout(pause);
    const text = input.value;
    if (text.trim().length === 0) {
      close();
      return;
    }
    pause = window.setTimeout(() => {
      const token = ++newest;
      void (async () => {
        try {
          const answer = (await api.get(`/api/search?q=${encodeURIComponent(text)}`)) as {
            results: { label: string; href: string }[];
          };
          // The box always shows the latest input, even on a late answer.
          if (token !== newest) return;
          show(answer.results, text, false);
        } catch (error) {
          if (token !== newest) return;
          if (error instanceof ApiError && error.failure.status === 503) show([], text, true);
        }
      })();
    }, SEARCH_PAUSE_MS);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (results.hidden) return;
    const target = event.target as Node;
    if (!results.contains(target) && target !== input) close();
  });
}

// ---------------------------------------------------------- password and out

export function wirePasswordAndSignOut(): void {
  const change = find<HTMLButtonElement>('#change-password');
  if (change) {
    change.addEventListener('click', () => {
      openModal({
        name: 'Change password',
        opener: change,
        build(body, handle) {
          const current = el('input', { type: 'password', autocomplete: 'current-password', name: 'currentPassword' });
          const next = el('input', { type: 'password', autocomplete: 'new-password', name: 'newPassword' });
          const save = el('button', { type: 'button', class: 'button-primary', text: 'Change password' });
          const close = el('button', { type: 'button', text: 'Close' });
          body.append(
            field('current-password', 'Current password', current),
            field('new-password', 'New password', next),
            el('p', { class: 'dialog-actions' }, [save, close]),
          );
          close.addEventListener('click', () => handle.close());
          save.addEventListener('click', () => {
            void withPending(save, async () => {
              clearProblems(handle.problems, [current, next]);
              try {
                await api.post('/api/password', {
                  currentPassword: current.value,
                  newPassword: next.value,
                });
                handle.close();
                announce(F.passwordChanged);
              } catch (error) {
                if (!(error instanceof ApiError)) throw error;
                const problems = Object.entries(error.failure.fields).map(([name, message]) => ({
                  field: name,
                  message,
                }));
                showProblems(
                  handle.problems,
                  problems.length > 0 ? problems : [{ field: 'currentPassword', message: error.failure.message }],
                  (name) => (name === 'newPassword' ? next : current),
                  'Problems',
                );
              }
            });
          });
        },
      });
    });
  }

  const out = find<HTMLButtonElement>('#sign-out');
  out?.addEventListener('click', () => {
    void withPending(out, async () => {
      await api.remove('/api/session');
      window.location.assign('/sign-in');
    });
  });
}

/** At 375 the links, Change password and Sign out sit in a Menu sheet. */
export function wireMenu(): void {
  const button = find<HTMLButtonElement>('#menu-button');
  if (!button) return;
  button.addEventListener('click', () => {
    openModal({
      name: 'Menu',
      opener: button,
      build(body, handle) {
        const list = el('ul', { class: 'menu-list' });
        for (const link of DESK_LINKS) {
          const anchor = el('a', { href: link.href, text: link.label });
          anchor.addEventListener('click', (event) => {
            event.preventDefault();
            handle.close();
            void navigate(link.href);
          });
          list.append(el('li', {}, [anchor]));
        }
        const change = el('button', { type: 'button', text: 'Change password' });
        const out = el('button', { type: 'button', text: 'Sign out' });
        const close = el('button', { type: 'button', text: 'Close' });
        change.addEventListener('click', () => {
          handle.close();
          find<HTMLButtonElement>('#change-password')?.click();
        });
        out.addEventListener('click', () => {
          void withPending(out, async () => {
            await api.remove('/api/session');
            window.location.assign('/sign-in');
          });
        });
        close.addEventListener('click', () => handle.close());
        body.append(list, el('p', { class: 'dialog-actions' }, [change, out, close]));
      },
    });
  });
}

/** The screen's bottom bar button at 375, which mirrors the main action. */
export function wireMainAction(run: (button: HTMLButtonElement) => void): void {
  for (const button of all<HTMLButtonElement>('[data-main-action]')) {
    button.addEventListener('click', () => run(button));
  }
}

export function body(): HTMLElement {
  return need<HTMLElement>('#screen-body');
}

export function pieceId(): string {
  return need<HTMLElement>('.bento').dataset.piece ?? '';
}

export { setText, el, find, need, all, setHidden };
