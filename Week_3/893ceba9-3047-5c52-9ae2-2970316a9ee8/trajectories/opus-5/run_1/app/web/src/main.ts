// The browser app: one router, one shell, one screen at a time.

import { DeskError, Project, User, api } from './api';
import { openNewProject } from './dashboard';
import { renderDashboard } from './dashboard';
import { clear, el } from './dom';
import { renderEditor } from './editor';
import { clearProblem, flushCarried } from './feedback';
import { landingHeader, renderLanding } from './landing';
import { renderMerge } from './merge';
import { renderProject } from './project';
import { renderReview } from './review';
import { navigate, pathParts, startRouter } from './router';
import { renderAudit, renderSettings } from './settings';
import {
  buildFeedbackRegions,
  buildHeader,
  buildServiceStatus,
  cookieNotice,
  desk,
  paintServiceStatus,
  refreshIntegrations,
  setNewProjectDialog,
  startIntegrationPolling,
  watchScroll,
} from './shell';
import { renderSignIn } from './signin';
import { renderTM } from './tm';

const root = document.getElementById('app') as HTMLElement;
let pendingPath: string | null = null;

async function loadUser(): Promise<void> {
  try {
    desk.user = await api.get<User>('/api/me');
  } catch {
    desk.user = null;
  }
}

async function loadProjects(): Promise<void> {
  if (!desk.user) {
    desk.projects = [];
    return;
  }
  try {
    desk.projects = (await api.get<{ projects: Project[] }>('/api/projects')).projects;
  } catch {
    desk.projects = [];
  }
}

async function render(path: string, search: URLSearchParams): Promise<void> {
  clearProblem();
  await loadUser();
  await loadProjects();

  const parts = pathParts(path);
  desk.currentSlug = parts[0] === 'projects' ? parts[1] ?? null : null;
  desk.currentLanguage =
    search.get('lang') ??
    (desk.currentSlug
      ? desk.projects.find((project) => project.slug === desk.currentSlug)?.target_languages[0] ?? null
      : null);

  clear(root);

  if (path === '/') {
    root.append(landingHeader(), shellMain(renderLanding));
    appendNotice();
    return;
  }

  if (path === '/sign-in') {
    root.append(landingHeader());
    const screen = el('div', { class: 'screen' });
    root.append(el('main', {}, [buildFeedbackRegions(), screen]));
    renderSignIn(screen, pendingPath);
    pendingPath = null;
    appendNotice();
    return;
  }

  if (!knownPath(parts)) {
    root.append(desk.user ? buildHeader() : landingHeader());
    const screen = el('div', { class: 'screen' });
    root.append(el('main', {}, [buildFeedbackRegions(), screen]));
    notFound(screen, 'page');
    appendNotice();
    return;
  }

  if (!desk.user) {
    pendingPath = path + (search.toString() ? `?${search}` : '');
    navigate('/sign-in', true);
    return;
  }

  root.append(buildHeader());
  const screen = el('div', { class: 'screen' });
  root.append(el('main', {}, [buildServiceStatus(), buildFeedbackRegions(), screen]));
  paintServiceStatus();
  flushCarried();
  void refreshIntegrations();
  setNewProjectDialog(openNewProject);
  appendNotice();

  try {
    await paintScreen(path, parts, search, screen);
  } catch (error) {
    if (error instanceof DeskError && error.info.code === 'not_found') {
      notFound(screen, 'project');
      return;
    }
    throw error;
  }
}

async function paintScreen(
  path: string,
  parts: string[],
  search: URLSearchParams,
  screen: HTMLElement,
): Promise<void> {
  if (path === '/desk') {
    if (desk.user?.role !== 'owner') {
      navigate('/review', true);
      return;
    }
    await renderDashboard(screen);
    return;
  }
  if (path === '/review') {
    await renderReview(screen, search);
    return;
  }
  if (path === '/audit') {
    await renderAudit(screen);
    return;
  }
  if (parts[0] === 'projects' && parts[1]) {
    // An unknown or out-of-scope project answers 404, which shows the
    // not-found card; a reviewer in scope is sent to their queue instead,
    // because the engineer's screens are not theirs to work.
    const project = await api.get<Project>(`/api/projects/${parts[1]}`);
    if (desk.user?.role === 'reviewer') {
      navigate('/review', true);
      return;
    }
    const stored = desk.projects.findIndex((item) => item.slug === project.slug);
    if (stored >= 0) desk.projects[stored] = project;
    switch (parts[2]) {
      case undefined:
        await renderProject(screen, project, search);
        return;
      case 'tm':
        await renderTM(screen, project);
        return;
      case 'editor':
        await renderEditor(screen, project, search);
        return;
      case 'merge':
        await renderMerge(screen, project, search);
        return;
      case 'settings':
        await renderSettings(screen, project);
        return;
      default:
        notFound(screen, 'page');
        return;
    }
  }
  notFound(screen, 'page');
}

// knownPath reports whether a path is one of the app's screens.
function knownPath(parts: string[]): boolean {
  if (parts.length === 0) return true;
  if (parts.length === 1) return ['desk', 'review', 'audit', 'sign-in'].includes(parts[0]);
  if (parts[0] !== 'projects') return false;
  if (parts.length === 2) return true;
  if (parts.length === 3) return ['tm', 'editor', 'merge', 'settings'].includes(parts[2]);
  return false;
}

function notFound(screen: HTMLElement, kind: 'project' | 'page'): void {
  clear(screen);
  const reviewer = desk.user?.role === 'reviewer';
  screen.append(
    el('div', { class: 'content-column centred-screen' }, [
      el('div', { class: 'card not-found' }, [
        el('h1', { text: kind === 'project' ? "We couldn't find that project" : "We couldn't find that page" }),
        kind === 'project'
          ? el('p', { text: 'It may have been erased, or the link is wrong.' })
          : el('p', { text: 'It may have been erased, or the link is wrong.' }),
        el('a', {
          href: reviewer ? '/review' : '/desk',
          text: reviewer ? 'Back to your review queue' : 'Back to your desk',
        }),
      ]),
    ]),
  );
}

function shellMain(paint: (screen: HTMLElement) => void): HTMLElement {
  const screen = el('div', { class: 'screen' });
  paint(screen);
  return el('main', {}, [buildFeedbackRegions(), screen]);
}

function appendNotice(): void {
  const notice = cookieNotice();
  if (notice) root.append(notice);
}

watchScroll();
startIntegrationPolling();
startRouter(render);
