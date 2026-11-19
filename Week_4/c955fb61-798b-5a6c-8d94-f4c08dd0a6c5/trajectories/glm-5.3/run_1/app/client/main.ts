// Client entry point: routes by path between the landing, forms and the project page.

import { api } from './api.ts';
import { renderLanding } from './landing.ts';

async function main(): Promise<void> {
  const root = document.getElementById('app') as HTMLElement;
  const path = window.location.pathname;
  if (path === '/' || path === '') {
    // The landing page for a signed-out visitor; the Projects list for a member.
    try {
      const me = await api.me();
      const { renderProjects } = await import('./auth-pages.ts');
      await renderProjects(root, me);
      return;
    } catch {
      renderLanding(root);
      return;
    }
  }
  await import('./project-page.ts');
}

void main();
