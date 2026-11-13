import { clear } from './dom';
import { loadMe } from './shell';
import { renderLanding } from './landing';
import { renderEditor } from './editor';
import { renderEmbed } from './embed';
import { renderInvite, renderProjects, renderSignIn } from './projects';

const root = document.getElementById('root');

async function route(): Promise<void> {
  if (!root) return;
  clear(root);
  const path = window.location.pathname;
  if (path === '/signin') {
    renderSignIn(root);
    return;
  }
  if (path === '/projects') {
    await renderProjects(root);
    return;
  }
  if (path.startsWith('/projects/')) {
    await renderEditor(root, decodeURIComponent(path.slice('/projects/'.length)));
    return;
  }
  if (path.startsWith('/invite/')) {
    await renderInvite(root, decodeURIComponent(path.slice('/invite/'.length)));
    return;
  }
  renderLanding(root);
}

async function start(): Promise<void> {
  if (!root) return;
  if (window.__HALATION_MODE__ === 'embed' && window.__HALATION_PROJECT__) {
    await renderEmbed(root, window.__HALATION_PROJECT__);
    return;
  }
  loadMe();
  await route();
  window.addEventListener('halation:route', () => void route());
  window.addEventListener('popstate', () => void route());
}

void start();
