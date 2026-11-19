import { compareRow, editorStatus } from '../shared/copy.js';
import { diffWords } from '../shared/worddiff.js';
import type { Step } from '../shared/types.js';
import { call } from './api.js';
import { Dialog, need, setDisabled, type Status } from './dom.js';

interface VersionItem {
  number: number;
  saved_at: string;
  saved_by: string;
  restored_from: number | null;
  step_count: number;
  parts_cost_text: string;
}

interface CompareJson {
  older: number;
  newer: number;
  added: { position: number; title: string }[];
  removed: { position: number; title: string }[];
  changed: { position: number; title: string; fields: string[] }[];
  moved: { title: string; from: number; to: number }[];
  part_changes: { part: string; field: string; from: unknown; to: unknown }[];
  cost_difference_text: string;
}

interface VersionDetail {
  steps: Step[];
}

/**
 * The non-modal Versions region: Space picks a version, a third pick drops the
 * earliest, and Compare opens the compare of the two picked versions.
 */
export class VersionsPanel {
  private readonly region: HTMLElement;
  private readonly compareRegion: HTMLElement;
  private readonly list: HTMLElement;
  private readonly compareButton: HTMLElement;
  private readonly restoreDialog: Dialog;
  private picked: number[] = [];
  private items: VersionItem[] = [];
  private cursor: string | null = null;
  private restoring: number | null = null;
  private opener: HTMLElement | null = null;

  constructor(
    private readonly guideId: string,
    private readonly status: Status,
    private readonly onRestored: (created: number) => Promise<void>,
  ) {
    this.region = need<HTMLElement>('.versions');
    this.compareRegion = need<HTMLElement>('.version-compare');
    this.list = need<HTMLElement>('.version-list', this.region);
    this.compareButton = need<HTMLElement>('[aria-label="Compare"]', this.region);
    this.restoreDialog = new Dialog(need<HTMLElement>('.restore-dialog'));

    this.compareButton.addEventListener('click', () => void this.compare());
    need<HTMLElement>('[aria-label="Load more versions"]', this.region).addEventListener(
      'click',
      () => void this.loadPage(),
    );
    need<HTMLElement>('[data-action="confirm-restore"]', this.restoreDialog.element).addEventListener(
      'click',
      () => void this.restore(),
    );
    this.region.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.region.hidden;
  }

  async toggle(opener: HTMLElement): Promise<void> {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.opener = opener;
    this.region.hidden = false;
    opener.setAttribute('aria-expanded', 'true');
    this.items = [];
    this.cursor = null;
    await this.loadPage();
  }

  close(): void {
    this.region.hidden = true;
    this.compareRegion.hidden = true;
    this.opener?.setAttribute('aria-expanded', 'false');
    this.opener?.focus();
  }

  /** Adds a newly saved version to the list without a reload. */
  addVersion(item: VersionItem): void {
    if (this.items.some((existing) => existing.number === item.number)) return;
    this.items = [item, ...this.items].sort((a, b) => b.number - a.number);
    this.render();
  }

  private async loadPage(): Promise<void> {
    const query = this.cursor === null ? '' : `?cursor=${encodeURIComponent(this.cursor)}`;
    const reply = await call<{ items: VersionItem[]; next_cursor: string | null }>(
      'GET',
      `/api/guides/${this.guideId}/versions${query}`,
    );
    if (reply.status !== 200) return;
    this.items = [...this.items, ...reply.body.items];
    this.cursor = reply.body.next_cursor;
    this.render();
  }

  private render(): void {
    this.list.replaceChildren(
      ...this.items.map((item) => {
        const row = document.createElement('div');
        row.className = 'version-row';
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.setAttribute('aria-label', `Version ${item.number}`);
        box.checked = this.picked.includes(item.number);
        box.addEventListener('change', () => this.pick(item.number, box.checked));
        label.append(box, document.createTextNode(` Version ${item.number}`));
        const detail = document.createElement('span');
        detail.className = 'row-note';
        detail.textContent = `${item.saved_by} · ${item.step_count} steps · ${item.parts_cost_text}`;
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.setAttribute('aria-label', `Restore version ${item.number}`);
        restore.textContent = `Restore version ${item.number}`;
        restore.addEventListener('click', () => {
          this.restoring = item.number;
          this.restoreDialog.element.setAttribute('aria-label', `Restore version ${item.number}`);
          this.restoreDialog.open(restore);
        });
        row.append(label, detail, restore);
        return row;
      }),
    );
    setDisabled(this.compareButton, this.picked.length !== 2);
  }

  private pick(number: number, on: boolean): void {
    if (on) {
      this.picked = [...this.picked.filter((value) => value !== number), number];
      if (this.picked.length > 2) this.picked = this.picked.slice(-2);
    } else {
      this.picked = this.picked.filter((value) => value !== number);
    }
    this.render();
  }

  private async compare(): Promise<void> {
    if (this.picked.length !== 2) return;
    const [a, b] = this.picked;
    if (a === undefined || b === undefined) return;
    const older = Math.min(a, b);
    const newer = Math.max(a, b);
    const [compareReply, olderReply, newerReply] = await Promise.all([
      call<CompareJson>('GET', `/api/guides/${this.guideId}/versions/compare?older=${older}&newer=${newer}`),
      call<VersionDetail>('GET', `/api/guides/${this.guideId}/versions/${older}`),
      call<VersionDetail>('GET', `/api/guides/${this.guideId}/versions/${newer}`),
    ]);
    if (compareReply.status !== 200) return;
    this.compareRegion.hidden = false;
    this.compareRegion.replaceChildren(
      renderCompare(compareReply.body, olderReply.body.steps ?? [], newerReply.body.steps ?? []),
    );
  }

  private async restore(): Promise<void> {
    const number = this.restoring;
    if (number === null) return;
    const reply = await call<{ number: number; restored_from: number }>(
      'POST',
      `/api/guides/${this.guideId}/versions/${number}/restore`,
      {},
    );
    this.restoreDialog.close();
    if (reply.status !== 201) {
      this.status.sayAndClear(editorStatus.commitFailed);
      return;
    }
    await this.onRestored(reply.body.number);
    this.status.sayAndClear(editorStatus.restored(reply.body.restored_from, reply.body.number));
  }
}

/** Steps run in the newer version's order, then removed steps, each labelled. */
export function renderCompare(
  compare: CompareJson,
  olderSteps: readonly Step[],
  newerSteps: readonly Step[],
): HTMLElement {
  const fields = document.createElement('div');
  fields.className = 'compare-fields';
  const olderColumn = document.createElement('div');
  olderColumn.className = 'compare-older';
  const newerColumn = document.createElement('div');
  newerColumn.className = 'compare-newer';
  olderColumn.append(heading(`Version ${compare.older}`));
  newerColumn.append(heading(`Version ${compare.newer}`));

  const addedAt = new Map(compare.added.map((entry) => [entry.position, entry]));
  const changedAt = new Map(compare.changed.map((entry) => [entry.position, entry]));
  const movedTitles = new Set(compare.moved.map((entry) => entry.title));
  const olderByTitle = new Map(olderSteps.map((step) => [step.id, step]));

  for (const step of newerSteps) {
    const label = changedAt.has(step.number)
      ? compareRow.labelChanged
      : addedAt.has(step.number)
        ? compareRow.labelAdded
        : movedTitles.has(step.title)
          ? compareRow.labelMoved
          : null;
    if (label === null) continue;
    const row = document.createElement('div');
    row.className = 'compare-row';
    row.setAttribute('data-change', label);
    row.append(labelSpan(label), document.createTextNode(compareRow.step(step.number, step.title)));
    const before = olderByTitle.get(step.id);
    if (label === compareRow.labelChanged && before !== undefined) {
      const diff = diffWords(before.text, step.text);
      if (diff.removed.length > 0) row.append(line(compareRow.removedWords(diff.removed.join(' '))));
      if (diff.added.length > 0) row.append(line(compareRow.addedWords(diff.added.join(' '))));
    }
    newerColumn.append(row);
  }

  for (const entry of compare.removed) {
    const row = document.createElement('div');
    row.className = 'compare-row';
    row.setAttribute('data-change', compareRow.labelRemoved);
    row.append(
      labelSpan(compareRow.labelRemoved),
      document.createTextNode(compareRow.removedStep(entry.position, entry.title)),
    );
    olderColumn.append(row);
  }

  for (const change of compare.part_changes) {
    newerColumn.append(
      line(
        compareRow.part(change.part, change.field, String(change.from ?? 'null'), String(change.to ?? 'null')),
      ),
    );
  }

  const difference = document.createElement('p');
  difference.className = 'compare-difference';
  difference.textContent = compareRow.difference(compare.cost_difference_text);

  fields.append(olderColumn, newerColumn);
  const wrapper = document.createElement('div');
  wrapper.append(fields, difference);
  return wrapper;
}

function heading(text: string): HTMLElement {
  const element = document.createElement('h3');
  element.textContent = text;
  return element;
}

function labelSpan(text: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'compare-label';
  element.textContent = text;
  return element;
}

function line(text: string): HTMLElement {
  const element = document.createElement('p');
  element.textContent = text;
  return element;
}
