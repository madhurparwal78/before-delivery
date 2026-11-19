import { cursorAddress, pageInfo, reapplyOutdated, restoreCursor, syncBatchLabels } from './change.js';
import { applyLayout, reducedMotion } from './layout.js';

interface LiveEvent {
  kind: string;
  text: string;
  change?: number;
  walkFrom?: number;
}

interface LiveMessage {
  events: LiveEvent[];
  fragments: Record<string, string>;
}

let outdatedOn = false;
let walking = false;
const pendingWalks: number[] = [];

function updatesRegion(): HTMLElement | null {
  return document.getElementById('review-updates');
}

function appendEvent(text: string): void {
  const region = updatesRegion();
  if (!region) return;
  const line = document.createElement('div');
  line.className = 'updateline';
  line.textContent = text;
  region.append(line);
}

function railRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.railrow')];
}

function resultWord(row: HTMLElement): string {
  return row.querySelector<HTMLElement>('.railresult')?.textContent?.trim() ?? '';
}

function settle(rows: HTMLElement[]): void {
  const needsAction = rows.filter(
    (row) => row.dataset.restack === 'dismissed' || row.dataset.restack === 'conflicting',
  );
  const keep = needsAction[0] ?? null;
  for (const row of rows) {
    row.dataset.anim = 'none';
    row.classList.toggle('expanded', row === keep);
  }
}

function step(rows: HTMLElement[], index: number): void {
  if (index >= rows.length) {
    walking = false;
    settle(railRows());
    const next = pendingWalks.shift();
    if (next !== undefined) startWalk(next);
    return;
  }
  const row = rows[index];
  rows.forEach((other, position) => {
    if (position < index) other.classList.remove('expanded');
  });
  row.dataset.anim = 'walking';
  const done = (event: AnimationEvent) => {
    if (event.target !== row) return;
    row.removeEventListener('animationend', done);
    row.dataset.anim = 'none';
    row.classList.add('expanded');
    step(rows, index + 1);
  };
  row.addEventListener('animationend', done);
}

export function startWalk(fromChange: number): void {
  const rows = railRows();
  if (rows.length === 0) return;
  if (walking) {
    pendingWalks.push(fromChange);
    return;
  }
  const fromIndex = rows.findIndex((row) => Number(row.dataset.changeNumber) === fromChange);
  if (fromIndex === -1) return;
  const walkRows = rows.slice(fromIndex + 1, fromIndex + 9);
  if (reducedMotion()) {
    settle(rows);
    for (const row of rows) {
      const word = resultWord(row);
      if (word !== '') appendEvent(`#${row.dataset.changeNumber}: ${word}`);
    }
    return;
  }
  if (walkRows.length === 0) {
    settle(rows);
    return;
  }
  walking = true;
  step(walkRows, 0);
}

export function stopWalk(): void {
  walking = false;
  pendingWalks.length = 0;
  settle(railRows());
}

function threadIds(): Set<string> {
  return new Set([...document.querySelectorAll<HTMLElement>('article.thread')].map((thread) => thread.dataset.threadId ?? ''));
}

function queuePositions(): Map<string, string> {
  const positions = new Map<string, string>();
  document.querySelectorAll<HTMLElement>('.queueentry').forEach((entry) => {
    positions.set(entry.dataset.queueEntryId ?? '', entry.dataset.position ?? '');
  });
  return positions;
}

function markEntering(before: Set<string>): void {
  if (reducedMotion()) return;
  document.querySelectorAll<HTMLElement>('article.thread').forEach((thread) => {
    const id = thread.dataset.threadId ?? '';
    if (before.has(id)) return;
    thread.dataset.anim = 'entering';
    const done = (event: AnimationEvent) => {
      if (event.target !== thread) return;
      thread.removeEventListener('animationend', done);
      thread.dataset.anim = 'none';
    };
    thread.addEventListener('animationend', done);
  });
}

function markMoving(before: Map<string, string>): void {
  if (reducedMotion()) return;
  document.querySelectorAll<HTMLElement>('.queueentry').forEach((entry) => {
    const id = entry.dataset.queueEntryId ?? '';
    const previous = before.get(id);
    if (previous === undefined || previous === entry.dataset.position) return;
    entry.dataset.anim = 'moving';
    const done = (event: AnimationEvent) => {
      if (event.target !== entry) return;
      entry.removeEventListener('animationend', done);
      entry.dataset.anim = 'none';
    };
    entry.addEventListener('animationend', done);
  });
}

function applyFragments(fragments: Record<string, string>): void {
  const address = cursorAddress();
  const beforeThreads = threadIds();
  const beforePositions = queuePositions();
  const switchState = document.querySelector<HTMLInputElement>('[data-outdated-switch]');
  if (switchState) outdatedOn = switchState.checked;
  const focusedEntry = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.queueentry');
  const focusedEntryId = focusedEntry?.dataset.queueEntryId ?? null;

  for (const [name, markup] of Object.entries(fragments)) {
    const target =
      name === 'stage'
        ? document.getElementById('stage')
        : name === 'rail'
          ? document.getElementById('rail')
          : document.getElementById('queue-stage');
    if (target) target.innerHTML = markup;
  }

  applyLayout();
  const restored = document.querySelector<HTMLInputElement>('[data-outdated-switch]');
  if (restored) restored.checked = outdatedOn;
  reapplyOutdated();
  syncBatchLabels();
  restoreCursor(address.path, address.line, address.side);
  markEntering(beforeThreads);
  markMoving(beforePositions);
  if (focusedEntryId !== null) {
    document.querySelector<HTMLElement>(`.queueentry[data-queue-entry-id="${focusedEntryId}"]`)?.focus();
  }
}

export function initLive(): void {
  const root = document.querySelector<HTMLElement>('[data-page="change"], [data-page="queue"]');
  if (!root) return;
  const repo = root.dataset.repo ?? '';
  const info = pageInfo();
  const query = info ? `page=change&change=${info.changeNumber}` : 'page=queue';
  const source = new EventSource(`/api/live/${repo}?${query}`);

  source.addEventListener('message', (event) => {
    const message = JSON.parse((event as MessageEvent<string>).data) as LiveMessage;
    for (const item of message.events) {
      if (item.text !== '') appendEvent(item.text);
    }
    applyFragments(message.fragments ?? {});
    const walk = message.events.find((item) => item.walkFrom !== undefined);
    if (walk && walk.walkFrom !== undefined) startWalk(walk.walkFrom);
  });

  document.addEventListener('click', (clickEvent) => {
    if ((clickEvent.target as HTMLElement).closest('.railrow a')) stopWalk();
  });

  document.addEventListener('keydown', (keyEvent) => {
    const link = (keyEvent.target as HTMLElement).closest<HTMLElement>('.railrow a');
    if (!link) return;
    if (keyEvent.key === 'Enter') {
      stopWalk();
      return;
    }
    if (keyEvent.key !== 'ArrowDown' && keyEvent.key !== 'ArrowUp') return;
    keyEvent.preventDefault();
    const links = [...document.querySelectorAll<HTMLElement>('.railrow a')];
    const index = links.indexOf(link);
    const next = index + (keyEvent.key === 'ArrowDown' ? 1 : -1);
    if (next >= 0 && next < links.length) links[next].focus();
  });
}
