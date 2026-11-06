import type { SessionUser } from '../shared/api-types';
import {
  ApiFailure,
  announceProblem,
  el,
  genericFailureCopy,
  mountLiveRegions,
  request,
} from './core';
import { renderDesk } from './desk';
import { renderDrop } from './drop';
import { renderInspection } from './inspect';
import { renderSignIn } from './signin';

async function currentUser(): Promise<SessionUser | null> {
  try {
    const answer = await request<{ user: SessionUser }>('GET', '/api/me');
    return answer.user;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 401) return null;
    throw error;
  }
}

async function start(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) return;
  mountLiveRegions(document.body);
  const path = window.location.pathname;

  const inspectMatch = /^\/inspect\/([^/]+)$/.exec(path);
  if (inspectMatch !== null) {
    await renderInspection(root, decodeURIComponent(inspectMatch[1] as string));
    return;
  }

  if (path === '/') {
    renderSignIn(root);
    return;
  }

  const user = await currentUser();
  if (user === null) {
    window.location.replace('/');
    return;
  }

  const dropMatch = /^\/desk\/drops\/([^/]+)$/.exec(path);
  if (dropMatch !== null) {
    await renderDrop(root, user, decodeURIComponent(dropMatch[1] as string));
    return;
  }
  await renderDesk(root, user);
}

void start().catch((error: unknown) => {
  const failure = error instanceof ApiFailure ? error : new ApiFailure(0, null, true);
  const copy = genericFailureCopy(failure);
  announceProblem(copy);
  document.getElementById('app')?.append(el('p', { class: 'empty', text: copy }));
  if (failure.status === 401) window.location.replace('/');
});
