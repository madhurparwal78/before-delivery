import { must } from '../shared/dom';
import { renderCarFile } from './carfile';
import { renderGarage } from './garage';
import { renderSignIn } from './signin';

const start = async (): Promise<void> => {
  const root = must<HTMLElement>(document, '#app');
  const path = window.location.pathname;

  if (path === '/owner') {
    renderSignIn(root);
    return;
  }
  if (path === '/owner/cars') {
    await renderGarage(root);
    return;
  }
  const match = /^\/owner\/cars\/([^/]+)$/.exec(path);
  if (match !== null) {
    await renderCarFile(root, decodeURIComponent(match[1]));
    return;
  }
  renderSignIn(root);
};

void start();
