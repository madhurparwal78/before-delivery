/** The client entry point: route the current address and follow history. */
import { route } from './app.js';

window.addEventListener('popstate', () => {
  // no document data is ever shown from history without a fresh session check
  document.getElementById('app')?.replaceChildren();
  void route();
});

void route();
