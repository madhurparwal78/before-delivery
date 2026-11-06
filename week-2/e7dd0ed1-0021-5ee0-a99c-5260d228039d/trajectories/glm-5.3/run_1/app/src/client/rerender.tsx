import { render } from './jsx/render.js';
import { App } from './app.js';
import { captureFocus, restoreFocus } from './store.js';

/** Re-renders the whole view from the store, preserving focus and the caret. */
export function rerender(): void {
  const saved = captureFocus();
  const root = document.getElementById('app');
  if (root) render(root, App({}));
  restoreFocus(saved);
}
