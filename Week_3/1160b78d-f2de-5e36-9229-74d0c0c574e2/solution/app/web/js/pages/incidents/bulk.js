// Bulk decisions: the Resolve dialog, the phone action bar and the per-row results.
import { html } from '../../lib/html.js';
import { Button } from '../../lib/ui.js';

// The dialog stays in the page, closed, so that opening it is one synchronous step of the key press or tap.
export function ResolveDialog({ dialogRef, rows, onConfirm, onCancel }) {
  return html`<dialog ref=${dialogRef} aria-label="Resolve incidents" class="sheet">
    <h2>Resolve incidents</h2>
    <p>${rows.length === 1 ? 'This incident closes' : 'These incidents close'} for everyone on call.</p>
    <ul class="resolve-list">${rows.map((r) => html`<li key=${r.id}>#${r.number} ${r.title}</li>`)}</ul>
    <div class="toolbar">
      <${Button} onClick=${onConfirm}>Resolve</${Button}>
      <button type="button" class="secondary" onClick=${onCancel}>Cancel</button>
    </div>
  </dialog>`;
}

export function BulkResults({ lines }) {
  return html`<div role="region" aria-label="Bulk results" aria-live="polite" class=${'bulk-results' + (lines.length ? ' has-lines' : '')}>
    ${lines.map((line, i) => html`<p key=${i}>${line}</p>`)}
  </div>`;
}

export function ActionBar({ canAct, onAcknowledge, onResolve, onFirst, onLast }) {
  return html`<div role="toolbar" aria-label="List actions" class="list-bar">
    <${Button} onClick=${onAcknowledge} ...${canAct ? {} : { disabled: true }}>Acknowledge selected</${Button}>
    <button type="button" onClick=${onResolve} disabled=${!canAct}>Resolve selected</button>
    <button type="button" class="secondary" onClick=${onFirst}>First incident</button>
    <button type="button" class="secondary" onClick=${onLast}>Last incident</button>
  </div>`;
}
