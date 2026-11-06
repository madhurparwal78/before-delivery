import { render } from './jsx/render.js';
import { App, loadMe, loadRegions, loadPlans } from './app.js';
import { rerender } from './rerender.js';

const root = document.getElementById('app');
if (root) render(root, App({}));

// Patch history so pushes and replaces re-render.
const originalPush = history.pushState.bind(history);
const originalReplace = history.replaceState.bind(history);
history.pushState = (...args: Parameters<typeof originalPush>) => {
  originalPush(...args);
  rerender();
};
history.replaceState = (...args: Parameters<typeof originalReplace>) => {
  originalReplace(...args);
  rerender();
};
window.addEventListener('popstate', () => rerender());

void loadMe;
void loadRegions;
void loadPlans;
