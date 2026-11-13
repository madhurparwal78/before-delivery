import type { ShellState } from '../shell.js';

export function renderNotFoundPage(_state: ShellState): string {
  return `<div class="not-found">
    <h1>Not on this rack</h1>
    <p>Check the link, or go back to the rack.</p>
    <p><a href="/" id="back-to-rack">Back to the rack</a></p>
  </div>`;
}

export function mountNotFoundPage(): void {
  document.getElementById('back-to-rack')?.focus();
}
