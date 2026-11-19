import { ApiRequestError, api } from './api.js';
import {
  diagramListScreen,
  notFoundScreen,
  signInPath,
  signInScreen,
  signUpScreen,
} from './screens.js';
import { Workspace } from './workspace/controller.js';
import { wireCanvasInput, wireWorkspaceInput } from './workspace/input.js';
import { type WorkspaceState, loadQueue, recomputeRoutes } from './workspace/store.js';

declare global {
  interface Window {
    __linewellNotFound?: boolean;
  }
}

const host = document.getElementById('app');

function navigate(path: string): void {
  window.history.pushState({}, '', path);
  void route();
}

/** Builds the workspace for a diagram the person belongs to. */
async function openWorkspace(host: HTMLElement, diagramId: string, url: URL): Promise<void> {
  const me = (await api.me()).user;
  const document = await api.document(diagramId);
  const pages = [...document.pages].sort((a, b) => a.order - b.order);
  const requested = url.searchParams.get('page');
  const pageId =
    requested !== null && pages.some((page) => page.id === requested)
      ? requested
      : pages[0]?.id ?? '';
  const state: WorkspaceState = {
    diagramId,
    me,
    role: 'viewer',
    ownerName: '',
    document,
    pageId,
    preview: null,
    selection: [],
    focusedShape: null,
    snapToGrid: true,
    zoom: 100,
    view: { x: 0, y: 0 },
    drag: null,
    connect: null,
    comments: [],
    versions: [],
    exports: [],
    presence: [],
    cursors: new Map(),
    connection: 'live',
    queue: loadQueue(diagramId, me.id),
    pending: new Map(),
    savedBanner: false,
    routes: new Map(),
    leftRailOpen: window.matchMedia('(min-width: 1280px)').matches,
    inspectorOpen: true,
    openSheet: null,
    inspectorTab: 'inspector',
    outlineOpen: false,
    commentTarget: null,
    exportPaused: false,
  };
  recomputeRoutes(state);
  const workspace = new Workspace(host, state, () => notFoundScreen(host));
  workspace.wireInput = wireCanvasInput;
  wireWorkspaceInput(workspace);
  workspace.start();
  workspace.syncAddress('replace');
  const version = url.searchParams.get('version');
  if (version !== null) workspace.previewVersion(version);
}

async function route(): Promise<void> {
  if (!host) return;
  const url = new URL(window.location.href);
  if (window.__linewellNotFound === true) {
    notFoundScreen(host);
    return;
  }
  if (url.pathname === '/signin') {
    signInScreen(host, navigate);
    return;
  }
  if (url.pathname === '/signup') {
    signUpScreen(host, navigate);
    return;
  }

  const toSignIn = (): void => {
    window.location.replace(signInPath(`${url.pathname}${url.search}`));
  };

  if (url.pathname === '/') {
    diagramListScreen(host, navigate, toSignIn);
    return;
  }

  const diagramId = /^\/d\/([^/]+)$/.exec(url.pathname)?.[1];
  if (diagramId === undefined) {
    notFoundScreen(host);
    return;
  }
  try {
    await openWorkspace(host, diagramId, url);
  } catch (error) {
    if (error instanceof ApiRequestError && error.failure.status === 401) {
      toSignIn();
      return;
    }
    notFoundScreen(host);
  }
}

void route();
