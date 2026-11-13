// Entry point: the router.
import { loadIcons } from './dom';
import { renderLanding } from './landing';
import { renderSignIn, renderProjects } from './screens';
import { renderEditor } from './editor';
import { renderInvite } from './invite';
import { runEmbed } from './embed';
import type { Person } from './types';

async function currentPerson(): Promise<Person | null> {
  const res = await fetch('/api/me', { credentials: 'same-origin' });
  if (!res.ok) return null;
  const data = (await res.json()) as { user: Person };
  return data.user;
}

async function main(): Promise<void> {
  await loadIcons();
  const path = window.location.pathname;
  const root = document.getElementById('app')!;

  if (path.startsWith('/embed/')) {
    await runEmbed(path.slice('/embed/'.length));
    return;
  }

  if (path.startsWith('/invite/')) {
    await renderInvite(path.slice('/invite/'.length));
    return;
  }

  if (path === '/signin') {
    renderSignIn(root);
    return;
  }

  if (path === '/projects') {
    const person = await currentPerson();
    if (!person) {
      window.location.href = '/signin';
      return;
    }
    await renderProjects(root, person);
    return;
  }

  if (path.startsWith('/projects/')) {
    const person = await currentPerson();
    if (!person) {
      window.location.href = '/signin';
      return;
    }
    await renderEditor(root, person, path.slice('/projects/'.length));
    return;
  }

  // The landing page, signed in or out.
  const person = await currentPerson();
  renderLanding(root, person);
}

void main();
