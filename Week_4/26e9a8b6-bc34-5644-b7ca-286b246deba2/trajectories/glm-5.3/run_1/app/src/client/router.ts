// Route table: one screen module per page route.

import { renderHome } from './screens/home';
import { renderReader } from './screens/reader';
import { renderEmbed } from './screens/embed';
import { renderEditor } from './screens/editor';
import { renderDashboard } from './screens/dashboard';
import { renderSearch } from './screens/search';
import { renderCollection } from './screens/collection';
import { renderSignIn, renderSignUp, renderConfirm } from './screens/auth';
import { renderNotFound } from './screens/notfound';

export function startRoute(): void {
  const path = document.body.dataset.route ?? '/';
  const embed = document.body.dataset.embed === 'true';
  const main = document.getElementById('app')!;
  const slug = path.split('/')[2] ?? '';

  if (embed && path.startsWith('/embed/')) {
    renderEmbed(main, decodeURIComponent(slug));
    return;
  }
  if (path === '/') {
    renderHome(main);
    return;
  }
  if (path.startsWith('/g/')) {
    renderReader(main, decodeURIComponent(slug), false);
    return;
  }
  if (path.startsWith('/edit/')) {
    renderEditor(main, decodeURIComponent(slug));
    return;
  }
  if (path === '/dashboard') {
    renderDashboard(main);
    return;
  }
  if (path === '/search') {
    renderSearch(main);
    return;
  }
  if (path.startsWith('/c/')) {
    renderCollection(main, decodeURIComponent(slug));
    return;
  }
  if (path === '/signin') {
    renderSignIn(main);
    return;
  }
  if (path === '/signup') {
    renderSignUp(main);
    return;
  }
  if (path === '/confirm') {
    renderConfirm(main);
    return;
  }
  renderNotFound(main);
}
