import { compareText, editorStatus } from '../../shared/copy';
import { wordDiff } from '../../shared/compare';
import { formatCost } from '../../shared/cost';
import type { Compare, Step, VersionBody, VersionSummary } from '../../shared/types';
import { get, post } from '../api';
import { dialogButtons, openDialog } from '../dialog';
import { h, replace } from '../dom';
import type { Editor } from './editor';

const fieldWords: Record<string, string> = {
  title: 'title', text: 'text', phase: 'phase', explode: 'apart amount', focus_parts: 'parts', camera: 'view', callouts: 'callouts',
  name: 'name', quantity: 'quantity', unit_price: 'unit price', fitted_at: 'fitted at',
};

/** The non-modal Versions region: pick two, compare, restore through a dialog. */
export class VersionsPanel {
  private element: HTMLElement | null = null;
  private items: VersionSummary[] = [];
  private picked: number[] = [];
  private cursor: string | null = null;
  private readonly list = h('ul', { class: 'version-list' });
  private readonly compareHost = h('div', { class: 'compare-host' });
  private compareButton!: HTMLButtonElement;
  private more!: HTMLButtonElement;

  constructor(private readonly editor: Editor, private readonly toggle: HTMLButtonElement, private readonly host: HTMLElement) {}

  get isOpen(): boolean {
    return this.element !== null;
  }

  async open(): Promise<void> {
    if (this.element) return;
    this.compareButton = h('button', { type: 'button', class: 'button', 'aria-disabled': 'true' }, 'Compare');
    this.more = h('button', { type: 'button', class: 'button quiet', hidden: true }, 'Load more versions');
    this.compareButton.addEventListener('click', () => void this.compare());
    this.more.addEventListener('click', () => void this.load(true));
    this.element = h('section', { role: 'region', 'aria-label': 'Versions', class: 'versions' },
      h('h2', {}, 'Versions'), this.list, this.more, this.compareButton, this.compareHost);
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        this.close();
      }
    });
    this.host.append(this.element);
    this.toggle.setAttribute('aria-expanded', 'true');
    this.picked = [];
    await this.load(false);
  }

  close(): void {
    this.element?.remove();
    this.element = null;
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.focus();
  }

  private async load(append: boolean): Promise<void> {
    const page = await get<{ items: VersionSummary[]; next_cursor: string | null }>(
      `/api/guides/${this.editor.guideId}/versions?limit=24${append && this.cursor ? `&cursor=${encodeURIComponent(this.cursor)}` : ''}`);
    this.items = append ? [...this.items, ...page.items] : page.items;
    this.cursor = page.next_cursor;
    this.render();
  }

  /** A version saved elsewhere appears at once. */
  async arrived(): Promise<void> {
    if (this.element) await this.load(false);
  }

  private render(): void {
    const currency = this.editor.state.work.currency;
    replace(this.list, ...this.items.map((v) => {
      const box = h('input', { type: 'checkbox' });
      box.checked = this.picked.includes(v.number);
      box.addEventListener('change', () => {
        this.picked = box.checked ? [...this.picked, v.number].slice(-2) : this.picked.filter((n) => n !== v.number);
        this.render();
      });
      const restore = h('button', { type: 'button', class: 'button quiet' }, `Restore version ${v.number}`);
      restore.addEventListener('click', () => this.restoreDialog(v.number));
      return h('li', { class: 'version-row' },
        h('label', { class: 'check' }, box, h('span', {}, `Version ${v.number}`)),
        h('span', { class: 'version-meta' }, `${v.saved_by}, ${v.step_count} steps, ${formatCost(v.parts_cost, currency)}${v.restored_from ? `, restored from ${v.restored_from}` : ''}`),
        restore);
    }));
    this.compareButton.setAttribute('aria-disabled', String(this.picked.length !== 2));
    this.more.hidden = this.cursor === null;
  }

  private restoreDialog(number: number): void {
    const confirm = h('button', { type: 'button', class: 'button' }, 'Restore');
    const cancel = h('button', { type: 'button', class: 'button quiet' }, 'Cancel');
    const dialog = openDialog(`Restore version ${number}`, [
      h('h2', {}, `Restore version ${number}`),
      h('p', {}, 'Restoring adds a new version equal to this one. History stays as it is.'),
      dialogButtons(confirm, cancel),
    ]);
    cancel.addEventListener('click', dialog.close);
    confirm.addEventListener('click', async () => {
      dialog.close();
      await this.editor.committer.flushAll();
      const made = await post<{ number: number; restored_from: number }>(`/api/guides/${this.editor.guideId}/versions/${number}/restore`);
      this.editor.status.flash(editorStatus.restored(made.restored_from, made.number));
      await this.editor.reloadWorking();
      this.editor.setLatest(made.number);
    });
  }

  async compare(older?: number, newer?: number): Promise<void> {
    if (!older || !newer) {
      if (this.picked.length !== 2) return;
      [older, newer] = [...this.picked].sort((a, b) => a - b) as [number, number];
    }
    const id = this.editor.guideId;
    const [diff, before, after] = await Promise.all([
      get<Compare>(`/api/guides/${id}/versions/compare?older=${older}&newer=${newer}`),
      get<VersionBody>(`/api/guides/${id}/versions/${older}`),
      get<VersionBody>(`/api/guides/${id}/versions/${newer}`),
    ]);
    replace(this.compareHost, this.renderCompare(diff, before, after));
  }

  private renderCompare(diff: Compare, before: VersionBody, after: VersionBody): HTMLElement {
    const row = (older: Node[], newer: Node[]) => h('div', { class: 'compare-row' }, h('div', { class: 'compare-old' }, ...older), h('div', { class: 'compare-new' }, ...newer));
    const line = (kind: string, text: string) => h('p', { class: 'diff-line', 'data-kind': kind }, text);
    const heading = (label: string, text: string) => h('p', { class: 'diff-heading' }, h('strong', {}, label), ' ', text);
    const rows: HTMLElement[] = [];
    const movedTitles = new Set(diff.moved.map((m) => m.title));
    const changedAt = new Map(diff.changed.map((c) => [c.position, c]));
    const addedAt = new Set(diff.added.map((a) => a.position));
    for (const step of after.steps as Step[]) {
      const changed = changedAt.get(step.number);
      const added = addedAt.has(step.number) && !before.steps.some((s) => s.id === step.id);
      const moved = movedTitles.has(step.title) && before.steps.some((s) => s.id === step.id);
      if (!changed && !added && !moved) continue;
      const label = added ? 'Added' : changed ? 'Changed' : 'Moved';
      const olderLines: Node[] = [];
      const newerLines: Node[] = [heading(label, compareText.step(step.number, step.title))];
      const old = before.steps.find((s) => s.id === step.id);
      if (changed && old) {
        for (const field of changed.fields) {
          if (field === 'title' || field === 'text') {
            const words = wordDiff(String(old[field]), String(step[field]));
            if (words.removed) olderLines.push(line('removed', compareText.removed(words.removed)));
            if (words.added) newerLines.push(line('added', compareText.added(words.added)));
          } else newerLines.push(line('changed', `Changed: ${fieldWords[field] ?? field}`));
        }
      }
      rows.push(row(olderLines, newerLines));
    }
    for (const step of diff.removed) rows.push(row([heading('Removed', compareText.wasStep(step.position, step.title))], []));
    const currency = diff.currency;
    const parts = diff.part_changes.map((c) => {
      const show = (v: string | number | null) => (c.field === 'unit_price' && typeof v === 'number' ? formatCost(v, currency) : v === null ? 'none' : String(v));
      return line('changed', `${c.part}: ${fieldWords[c.field]} ${show(c.from)} to ${show(c.to)}`);
    });
    return h('div', { role: 'region', 'aria-label': 'Version compare', class: 'compare' },
      h('h2', {}, `Version ${diff.older} and version ${diff.newer}`),
      h('div', { class: 'compare-head' }, h('p', {}, `Version ${diff.older}: ${before.parts_cost_text}`), h('p', {}, `Version ${diff.newer}: ${after.parts_cost_text}`)),
      ...rows,
      row([], [...parts, h('p', { class: 'diff-total' }, compareText.difference(diff.cost_difference_text))]));
  }
}
