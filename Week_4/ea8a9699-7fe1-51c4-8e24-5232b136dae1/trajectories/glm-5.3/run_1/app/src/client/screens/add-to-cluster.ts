// The add-to-cluster picker.

import type { ClusterSummary, Reference } from '../../shared/types.js';
import { api, announce, el } from '../lib.js';
import type { WallState } from './wall.js';

export class AddToClusterDialog {
  private state: WallState;
  private reference: Reference;
  private opener: HTMLElement;
  private dialog: HTMLDialogElement;
  private input: HTMLInputElement;
  private listbox: HTMLUListElement;
  private options: ClusterSummary[] = [];
  private highlighted = -1;
  private seq = 0;

  constructor(state: WallState, reference: Reference, opener: HTMLElement) {
    this.state = state;
    this.reference = reference;
    this.opener = opener;
    this.dialog = el('dialog', { class: 'dialog', 'aria-label': 'Add to cluster' }) as HTMLDialogElement;
    this.dialog.append(el('h2', {}, 'Add to cluster'));
    this.input = el('input', { type: 'text', id: 'picker-input' }) as HTMLInputElement;
    this.input.setAttribute('aria-label', 'Find a cluster');
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-expanded', 'true');
    this.input.setAttribute('aria-controls', 'picker-list');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.listbox = el('ul', { id: 'picker-list', role: 'listbox', 'aria-label': 'Clusters', class: 'stack' }) as HTMLUListElement;
    this.dialog.append(
      el('div', { class: 'field' }, el('label', { for: 'picker-input' }, 'Find a cluster'), this.input),
      this.listbox,
    );
    this.input.addEventListener('input', () => {
      void this.filter(this.input.value);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.moveHighlight(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.moveHighlight(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.highlighted >= 0 && this.options[this.highlighted]) {
          void this.add(this.options[this.highlighted]!);
        } else if (this.options.length === 1) {
          void this.add(this.options[0]!);
        }
      }
    });
    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.close();
    });
  }

  open(): void {
    document.body.append(this.dialog);
    this.dialog.showModal();
    void this.filter('');
    this.input.focus();
  }

  close(): void {
    this.dialog.close();
    this.dialog.remove();
    this.opener.focus();
  }

  private async filter(q: string): Promise<void> {
    const seq = ++this.seq;
    const r = await api<{ total: number; clusters: ClusterSummary[] }>(
      'GET',
      `/api/workspaces/${this.state.slug}/clusters${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    );
    if (seq !== this.seq) return;
    if (this.input.value !== q) return;
    if (!r.ok) return;
    this.options = r.data!.clusters;
    this.highlighted = this.options.length === 1 ? 0 : -1;
    this.render();
  }

  private render(): void {
    this.listbox.replaceChildren();
    this.options.forEach((c, i) => {
      const li = el('li', { role: 'option', id: `picker-option-${i}`, 'aria-selected': i === this.highlighted ? 'true' : 'false', class: 'tray-item' });
      li.append(el('span', { class: 'tray-item-title' }, c.title), el('span', { class: 'muted small mono' }, `${c.itemCount} items`));
      li.addEventListener('click', () => void this.add(c));
      this.listbox.append(li);
    });
    if (this.highlighted >= 0) {
      this.listbox.children[this.highlighted]?.scrollIntoView({ block: 'nearest' });
    }
  }

  private moveHighlight(delta: number): void {
    if (this.options.length === 0) return;
    this.highlighted = (this.highlighted + delta + this.options.length) % this.options.length;
    this.render();
  }

  private async add(cluster: ClusterSummary): Promise<void> {
    const r = await api<{ entry: { id: string; position: number }; itemCount: number; version: number }>(
      'POST',
      `/api/clusters/${cluster.id}/entries`,
      { referenceId: this.reference.id, isPrivate: false },
    );
    if (r.ok && r.data) {
      announce('tray-announcements', `Added ${this.reference.title}. ${r.data.itemCount} items in ${cluster.title}.`);
      this.close();
      // Reload the tray if it shows this cluster, else open its settings? The tray
      // switches to the chosen cluster per the interaction rules.
      window.dispatchEvent(new CustomEvent('rushes:cluster-chosen', { detail: { clusterId: cluster.id } }));
      return;
    }
    const err = r.error;
    if (err?.error === 'already_in_cluster') {
      announce('tray-announcements', `${this.reference.title} is already in ${cluster.title}.`);
    } else if (err?.error === 'cluster_locked') {
      announce('tray-announcements', `${cluster.title} is locked and cannot take new items.`);
    } else if (err?.error === 'seat_required') {
      announce('wall-announcements', 'You need a pro seat to make changes. Ask your design ops lead.');
      this.close();
      return;
    }
    this.close();
  }
}
