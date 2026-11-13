import { api, ApiCallError } from './api.ts';
import { clear, h } from './dom.ts';
import { buildFrame, type Frame } from './frame.ts';
import { safeReturnPath, setRouteHandler, startRouter } from './router.ts';
import { auditScreen } from './screens/audit.ts';
import { documentPageScreen } from './screens/documentPage.ts';
import { documentsScreen, type Screen } from './screens/documents.ts';
import { signInScreen } from './screens/signIn.ts';
import { signerScreen } from './screens/signer.ts';
import { teamScreen } from './screens/team.ts';
import { templatesScreen } from './screens/templates.ts';
import { NOT_FOUND_BODY, NOT_FOUND_HEADING } from '../shared/copy.ts';
import type { Role, SessionJson } from '../shared/types.ts';

const mount = document.getElementById('app');

const notFoundScreen = (): Screen => ({
  root: h(
    'div',
    { class: 'not-found' },
    h('h1', { class: 'page-heading' }, NOT_FOUND_HEADING),
    h('p', {}, NOT_FOUND_BODY),
  ),
  destroy: () => undefined,
});

let active: Screen | null = null;
let frame: Frame | null = null;
let frameRole: Role | null = null;

const show = (screen: Screen, withFrame: Frame | null): void => {
  if (mount === null) return;
  active?.destroy();
  active = screen;
  if (withFrame === null) {
    clear(mount);
    mount.appendChild(screen.root);
    return;
  }
  clear(withFrame.main);
  withFrame.main.appendChild(screen.root);
};

const session = async (): Promise<SessionJson | null> => {
  try {
    return await api.session();
  } catch {
    return null;
  }
};

const render = async (): Promise<void> => {
  const path = window.location.pathname;

  const signerMatch = /^\/sign\/([^/]+)$/.exec(path);
  if (signerMatch) {
    frame = null;
    frameRole = null;
    show(signerScreen(signerMatch[1] ?? ''), null);
    return;
  }

  if (path === '/sign-in') {
    const existing = await session();
    if (existing !== null) {
      const next = safeReturnPath(new URLSearchParams(window.location.search).get('next'));
      window.history.replaceState(null, '', next);
      await render();
      return;
    }
    frame = null;
    frameRole = null;
    show({ root: signInScreen(), destroy: () => undefined }, null);
    return;
  }

  const current = await session();
  if (current === null) {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/sign-in?next=${encodeURIComponent(next)}`);
    return;
  }

  if (frame === null || frameRole !== current.role || mount?.firstChild !== frame.root) {
    frame = buildFrame(path, current.role);
    frameRole = current.role;
    if (mount !== null) {
      clear(mount);
      mount.appendChild(frame.root);
    }
  }
  for (const link of frame.root.querySelectorAll('a.nav-link')) {
    const href = link.getAttribute('href') ?? '';
    if (path === href || path.startsWith(`${href}/`)) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  const auditMatch = /^\/documents\/([^/]+)\/audit$/.exec(path);
  if (auditMatch) {
    const id = auditMatch[1] ?? '';
    try {
      await api.document(id);
    } catch {
      show(notFoundScreen(), frame);
      return;
    }
    show(auditScreen(id), frame);
    return;
  }
  const documentMatch = /^\/documents\/([^/]+)$/.exec(path);
  if (documentMatch) {
    const id = documentMatch[1] ?? '';
    try {
      await api.document(id);
    } catch (failure) {
      if (failure instanceof ApiCallError && failure.failure.status === 401) {
        window.location.replace('/sign-in');
        return;
      }
      show(notFoundScreen(), frame);
      return;
    }
    show(documentPageScreen(frame, id, current.role, current.user.id), frame);
    return;
  }
  if (path === '/documents' || path === '/') {
    show(documentsScreen(frame, current.role), frame);
    return;
  }
  if (path === '/templates') {
    show(templatesScreen(frame, current.role), frame);
    return;
  }
  if (path === '/team') {
    show(teamScreen(frame, current.role), frame);
    return;
  }
  show(notFoundScreen(), frame);
};

setRouteHandler(() => {
  void render();
});
startRouter();
