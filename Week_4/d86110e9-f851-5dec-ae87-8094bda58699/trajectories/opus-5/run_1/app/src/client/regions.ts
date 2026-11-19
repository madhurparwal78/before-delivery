import { h, replace } from './dom';

const MAX_RUN_LINES = 20;

export const runUpdates = h('div', {
  role: 'status',
  'aria-label': 'Run updates',
  'aria-live': 'polite',
  class: 'region region-run-updates',
});

export const noticesRegion = h('div', {
  role: 'status',
  'aria-label': 'Notices',
  'aria-live': 'polite',
  class: 'region region-notices',
});

export const alertHolder = h('div', { class: 'alert-holder' });

export function announceRun(line: string): void {
  runUpdates.append(h('p', { class: 'region-line', text: line }));
  while (runUpdates.children.length > MAX_RUN_LINES) runUpdates.firstElementChild?.remove();
}

export function notice(text: string): void {
  const lines = [...noticesRegion.children].map((child) => child.textContent ?? '');
  if (lines[lines.length - 1] === text) return;
  noticesRegion.append(h('p', { class: 'region-line', text }));
  while (noticesRegion.children.length > 4) noticesRegion.firstElementChild?.remove();
}

export function showAlert(text: string): void {
  const panel = h(
    'div',
    { role: 'alert', class: 'panel panel-dark alert-panel' },
    h('p', { class: 'alert-text', text }),
    h('button', {
      type: 'button',
      class: 'link-action',
      text: 'Dismiss',
      onclick: () => panel.remove(),
    }),
  );
  replace(alertHolder, panel);
}

export function clearAlert(): void {
  replace(alertHolder);
}

type DraftCategory = 'presence' | 'edge' | 'saved' | 'refusal';

const draftLines = new Map<DraftCategory, string>();
let draftRegion: HTMLElement | null = null;

export function makeDraftRegion(): HTMLElement {
  draftLines.clear();
  draftRegion = h('div', {
    role: 'status',
    'aria-label': 'Draft notices',
    'aria-live': 'polite',
    class: 'region region-draft',
  });
  return draftRegion;
}

export function draftNotice(category: DraftCategory, text: string | null): void {
  if (text === null) draftLines.delete(category);
  else draftLines.set(category, text);
  if (draftRegion === null) return;
  replace(
    draftRegion,
    ...[...draftLines.values()].map((line) => h('p', { class: 'region-line', text: line })),
  );
}

export function forgetDraftRegion(): void {
  draftRegion = null;
  draftLines.clear();
}

let resultsRegion: HTMLElement | null = null;

export function makeResultsRegion(): HTMLElement {
  resultsRegion = h('div', {
    role: 'status',
    'aria-label': 'Run list results',
    'aria-live': 'polite',
    class: 'region region-results',
  });
  return resultsRegion;
}

export function runListResults(count: number): void {
  if (resultsRegion === null) return;
  replace(resultsRegion, h('p', { class: 'region-line', text: `Runs shown: ${count}` }));
}
