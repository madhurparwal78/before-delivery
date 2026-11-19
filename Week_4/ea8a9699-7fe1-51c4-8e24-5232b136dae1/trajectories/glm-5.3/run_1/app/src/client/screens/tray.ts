// The cluster tray: the cut order down the right edge, with keyboard and drag
// reorder.

import type { Cluster, ClusterSummary, Entry } from '../../shared/types.js';
import { api, announce, el } from '../lib.js';
import type { WallState } from './wall.js';
import { NewClusterDialog } from './new-cluster.js';
import { recalledTrayCluster, rememberTrayCluster } from './wall.js';

export class Tray {
  private state: WallState;
  readonly node: HTMLElement;
  private switcher: HTMLSelectElement;
  private newBtn: HTMLButtonElement;
  private list: HTMLUListElement;
  private countEl: HTMLElement;
  private trayPanel: HTMLElement;
  private toggleBtn: HTMLButtonElement | null = null;
  private trayPanelEscape: (e: KeyboardEvent) => void = () => {};
  private cluster: Cluster | null = null;
  private lifted: string | null = null;
  private items: Entry[] = [];

  constructor(state: WallState) {
    this.state = state;
    this.node = el('aside', { class: 'tray', role: 'complementary', 'aria-label': 'Cluster tray' });

    // Below 720 the tray collapses behind a button; from 720 up it shows inline.
    this.trayPanel = el('div', { class: 'tray-panel', id: 'tray-panel', hidden: true });
    this.toggleBtn = el('button', { class: 'btn tray-toggle', 'aria-expanded': 'false', 'aria-controls': 'tray-panel' }, '');
    this.trayPanelEscape = (e: KeyboardEvent): void => {
      // Escape collapses the tray unless a reorder handle is lifted: then Escape
      // only cancels that move (handled by the grip's own keydown).
      if (e.key !== 'Escape' || this.lifted !== null) return;
      if (this.trayPanel.hidden) return;
      this.trayPanel.hidden = true;
      this.toggleBtn!.setAttribute('aria-expanded', 'false');
      this.toggleBtn!.focus();
    };
    this.toggleBtn.addEventListener('click', () => {
      const open = this.trayPanel.hidden;
      this.trayPanel.hidden = !open;
      this.toggleBtn!.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        this.trayPanel.querySelector('select')?.focus();
      }
    });
    this.node.append(this.toggleBtn);

    const head = el('div', { class: 'tray-head' });
    this.switcher = el('select', { id: 'tray-cluster', 'aria-label': 'Tray cluster' }) as HTMLSelectElement;
    this.switcher.addEventListener('change', () => {
      rememberTrayCluster(this.switcher.value);
      void this.loadCluster(this.switcher.value);
    });
    this.newBtn = el('button', { class: 'btn small', id: 'new-cluster-btn' }, 'New cluster');
    this.newBtn.setAttribute('aria-label', 'New cluster');
    this.newBtn.addEventListener('click', () => {
      const dialog = new NewClusterDialog(this.state, this.newBtn);
      dialog.open();
    });
    this.countEl = el('span', { class: 'tray-count', id: 'tray-count' }, '0 items');
    this.countEl.id = 'tray-count';
    this.countEl.setAttribute('aria-label', 'Item count');
    head.append(this.switcher, this.newBtn, this.countEl);
    this.trayPanel.append(head);

    this.list = el('ul', { class: 'tray-list', id: 'tray-list', 'aria-label': 'Cluster order' }) as HTMLUListElement;
    this.trayPanel.append(this.list);
    this.trayPanel.addEventListener('keydown', (e) => this.trayPanelEscape(e));
    this.node.append(this.trayPanel);

    const announcements = el('div', { id: 'tray-announcements', role: 'status', class: 'visually-hidden' });
    announcements.setAttribute('aria-live', 'polite');
    document.body.append(announcements);

    window.addEventListener('rushes:cluster-chosen', (e) => {
      const { clusterId } = (e as CustomEvent).detail;
      rememberTrayCluster(clusterId);
      void this.loadClusters(clusterId);
    });
    window.addEventListener('rushes:cluster-updated', (e) => {
      const { clusterId } = (e as CustomEvent).detail;
      if (this.cluster?.id === clusterId) void this.loadCluster(clusterId);
    });
    // The collapsed/expanded state follows the viewport width: from 720 up the
    // tray shows inline and the toggle button is not rendered.
    const applyViewport = (): void => {
      const toggle = this.toggleBtn;
      if (!toggle) return;
      const wide = window.innerWidth >= 720;
      toggle.hidden = wide;
      if (wide) {
        this.trayPanel.hidden = false;
      } else {
        this.trayPanel.hidden = toggle.getAttribute('aria-expanded') !== 'true';
      }
    };
    window.addEventListener('resize', applyViewport);
    applyViewport();

    void this.loadClusters(recalledTrayCluster());
  }

  async loadClusters(preferred: string | null): Promise<void> {
    const r = await api<{ total: number; clusters: ClusterSummary[] }>('GET', `/api/workspaces/${this.state.slug}/clusters`);
    if (!r.ok) return;
    const clusters = r.data!.clusters;
    this.switcher.replaceChildren();
    for (const c of clusters) {
      const opt = el('option', { value: c.id }, c.title);
      this.switcher.append(opt);
    }
    let target = preferred && clusters.some((c) => c.id === preferred) ? preferred : clusters[0]?.id ?? null;
    if (target) {
      this.switcher.value = target;
      rememberTrayCluster(target);
      await this.loadCluster(target);
    }
  }

  async loadCluster(clusterId: string): Promise<void> {
    const r = await api<Cluster>('GET', `/api/clusters/${clusterId}`);
    if (!r.ok) {
      this.cluster = null;
      return;
    }
    this.cluster = r.data!;
    this.items = [...r.data!.entries];
    this.switcher.value = clusterId;
    this.renderItems();
  }

  private updateCount(): void {
    const n = this.items.length;
    this.countEl.textContent = `${n} items`;
    if (this.toggleBtn) {
      // The accessible name is "Cluster tray: <title> · <n> items"; the prefix may
      // be visually hidden while the visible text carries the rest.
      this.toggleBtn.replaceChildren();
      const prefix = el('span', { class: 'visually-hidden' }, 'Cluster tray: ');
      const label = el('span', {}, `${this.cluster?.title ?? ''} · ${n} items`);
      this.toggleBtn.append(prefix, label);
    }
  }

  private renderItems(): void {
    this.list.replaceChildren();
    this.updateCount();
    this.items.forEach((entry, i) => {
      this.list.append(this.itemRow(entry, i + 1));
    });
  }

  private itemRow(entry: Entry, slot: number): HTMLLIElement {
    const li = el('li', {
      class: `tray-item${this.lifted === entry.id ? ' lifted' : ''}${this.lifted === entry.id ? ' active-slot' : ''}`,
      'data-entry-id': entry.id,
    });
    const slotEl = el('span', { class: 'tray-slot mono' }, String(slot));
    const grip = el('button', { class: 'grip', 'aria-label': `Reorder ${entry.reference.title}`, type: 'button' }, '⠿');
    grip.setAttribute('tabindex', '0');
    const thumbSrc = entry.reference.kind === 'clip' ? '' : entry.reference.mediaUrl;
    const thumb = thumbSrc
      ? el('img', { class: 'tray-thumb', src: thumbSrc, alt: '' }) as HTMLImageElement
      : el('span', { class: 'tray-thumb' }, '▶');
    const titleWrap = el('div', { class: 'tray-item-title' });
    titleWrap.append(el('div', {}, entry.reference.title));
    if (entry.reference.kind === 'still' && entry.reference.sourceClipTitle && entry.reference.timecode) {
      titleWrap.append(el('div', { class: 'tray-item-sub' }, `${entry.reference.sourceClipTitle} · ${entry.reference.timecode}`));
    }
    li.append(slotEl, grip, thumb, titleWrap);
    if (entry.isPrivate) li.append(el('span', { class: 'private-tag' }, 'Private'));

    // Keyboard reorder on the grip.
    grip.addEventListener('keydown', (e) => this.handleKey(e, entry, grip));
    grip.addEventListener('pointerdown', (e) => this.startDrag(e, entry, li, grip));

    return li;
  }

  private handleKey(e: KeyboardEvent, entry: Entry, grip: HTMLButtonElement): void {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (this.lifted === null) {
        this.lift(entry, grip);
      } else {
        void this.drop(entry, grip);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.lifted !== null) {
        this.cancelMove(grip);
      }
      return;
    }
    if (this.lifted !== null && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      this.step(entry, dir);
    }
  }

  private lift(entry: Entry, grip: HTMLButtonElement): void {
    this.lifted = entry.id;
    const pos = this.items.findIndex((x) => x.id === entry.id) + 1;
    announce('tray-announcements', `Lifted ${entry.reference.title}, position ${pos} of ${this.items.length}. Use arrow keys to move, Space to drop, Escape to cancel.`);
    this.renderItems();
    const g = this.gripFor(entry.id);
    (g ?? grip).focus();
  }

  private step(entry: Entry, dir: number): void {
    const idx = this.items.findIndex((x) => x.id === entry.id);
    const next = idx + dir;
    if (next < 0 || next >= this.items.length) return;
    const copy = [...this.items];
    const [item] = copy.splice(idx, 1);
    copy.splice(next, 0, item!);
    this.items = copy;
    announce('tray-announcements', `${entry.reference.title}, position ${next + 1} of ${this.items.length}.`);
    this.renderItems();
    const g = this.gripFor(entry.id);
    g?.focus();
  }

  private cancelMove(grip: HTMLElement | null): void {
    const id = this.lifted;
    this.lifted = null;
    if (this.cluster && id) {
      // Restore the server order.
      void this.loadCluster(this.cluster.id).then(() => {
        const entry = this.cluster?.entries.find((e) => e.id === id);
        const pos = this.cluster?.entries.findIndex((e) => e.id === id) ?? 0;
        if (entry) {
          announce('tray-announcements', `Move cancelled. ${entry.reference.title} is back at position ${pos + 1} of ${this.cluster?.entries.length}.`);
        }
        const g = this.gripFor(id!);
        g?.focus();
      });
    } else {
      this.renderItems();
      grip?.focus();
    }
  }

  private async drop(entry: Entry, grip: HTMLButtonElement): Promise<void> {
    const target = this.items.findIndex((x) => x.id === entry.id) + 1;
    const clusterId = this.cluster?.id;
    const version = this.cluster?.version;
    this.lifted = null;
    if (!clusterId || version === undefined) return;
    // Optimistic order is already on screen.
    const r = await api<{ version: number; entryIds: string[] }>(
      'POST',
      `/api/clusters/${clusterId}/entries/${entry.id}/move`,
      { toPosition: target, version },
    );
    if (r.ok && r.data) {
      announce('tray-announcements', `Moved ${entry.reference.title} to position ${target} of ${this.items.length}. Order saved.`);
      await this.loadCluster(clusterId);
      const g = this.gripFor(entry.id);
      g?.focus();
      return;
    }
    const err = r.error;
    if (err?.error === 'stale_order') {
      const version2 = err.version;
      const ids = err.entryIds ?? [];
      announce('tray-announcements', 'The order changed elsewhere. Showing the latest order.');
      // Show the server's order exactly.
      if (this.cluster) {
        const byId = new Map(this.items.map((x) => [x.id, x]));
        this.items = ids.map((id) => byId.get(id)).filter((x): x is Entry => Boolean(x));
        this.cluster.version = version2 ?? this.cluster.version;
        this.renderItems();
      }
      const g = this.gripFor(entry.id);
      g?.focus();
      return;
    }
    if (err?.error === 'cluster_locked') {
      announce('tray-announcements', `${this.cluster?.title} is locked while ${this.cluster?.status}. The order is unchanged.`);
      void this.loadCluster(clusterId);
      const g = this.gripFor(entry.id);
      g?.focus();
      return;
    }
    announce('tray-announcements', 'The order could not be saved. Try again.');
    void this.loadCluster(clusterId);
    const g = this.gripFor(entry.id);
    g?.focus();
  }

  private gripFor(entryId: string): HTMLButtonElement | null {
    return this.list.querySelector<HTMLButtonElement>(`li[data-entry-id="${entryId}"] .grip`);
  }

  // --- Drag reorder ------------------------------------------------------

  private dragging: { entryId: string; from: number; placeholder: HTMLElement } | null = null;

  private startDrag(e: PointerEvent, entry: Entry, li: HTMLElement, grip: HTMLButtonElement): void {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const from = this.items.findIndex((x) => x.id === entry.id);
    this.dragging = { entryId: entry.id, from, placeholder: el('li', { class: 'tray-item', 'data-placeholder': 'true' }, '…') };
    li.classList.add('lifted');
    grip.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => this.dragMove(ev);
    const up = (ev: PointerEvent) => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', cancel);
      this.dragEnd(ev, entry, grip);
    };
    const cancel = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', cancel);
      this.cancelDrag(entry, grip);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', cancel);
    e.preventDefault();
  }

  private dragMove(e: PointerEvent): void {
    const y = e.clientY;
    const rows = Array.from(this.list.querySelectorAll('li[data-entry-id]')) as HTMLElement[];
    let insertBefore: HTMLElement | null = null;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        insertBefore = row;
        break;
      }
    }
    const ph = this.dragging?.placeholder;
    if (!ph) return;
    if (insertBefore) this.list.insertBefore(ph, insertBefore);
    else this.list.append(ph);
  }

  private dragEnd(_e: PointerEvent, entry: Entry, grip: HTMLButtonElement): void {
    const ph = this.dragging?.placeholder;
    const dropIndex = ph ? Array.from(this.list.children).indexOf(ph) : -1;
    ph?.remove();
    this.dragging = null;
    const copy = [...this.items];
    const from = copy.findIndex((x) => x.id === entry.id);
    if (dropIndex === from) {
      // A press without movement: not a drag.
      this.renderItems();
      grip.focus();
      return;
    }
    if (from === -1 || dropIndex === -1) {
      this.renderItems();
      return;
    }
    const to = dropIndex > from ? dropIndex : dropIndex;
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item!);
    this.items = copy;
    this.renderItems();
    void this.sendMove(entry, to + 1, grip);
  }

  private cancelDrag(entry: Entry, grip: HTMLButtonElement): void {
    this.dragging?.placeholder.remove();
    this.dragging = null;
    this.renderItems();
    grip.focus();
    void entry;
  }

  private async sendMove(entry: Entry, toPosition: number, grip: HTMLButtonElement): Promise<void> {
    const clusterId = this.cluster?.id;
    const version = this.cluster?.version;
    if (!clusterId || version === undefined) return;
    const r = await api<{ version: number; entryIds: string[] }>(
      'POST',
      `/api/clusters/${clusterId}/entries/${entry.id}/move`,
      { toPosition, version },
    );
    if (r.ok && r.data) {
      announce('tray-announcements', `Moved ${entry.reference.title} to position ${toPosition} of ${this.items.length}. Order saved.`);
      await this.loadCluster(clusterId);
      grip.focus();
      return;
    }
    const err = r.error;
    if (err?.error === 'stale_order') {
      announce('tray-announcements', 'The order changed elsewhere. Showing the latest order.');
      const byId = new Map(this.items.map((x) => [x.id, x]));
      this.items = (err.entryIds ?? []).map((id) => byId.get(id)).filter((x): x is Entry => Boolean(x));
      if (this.cluster) this.cluster.version = err.version ?? this.cluster.version;
      this.renderItems();
    } else if (err?.error === 'cluster_locked') {
      announce('tray-announcements', `${this.cluster?.title} is locked while ${this.cluster?.status}. The order is unchanged.`);
      await this.loadCluster(clusterId);
    } else {
      announce('tray-announcements', 'The order could not be saved. Try again.');
      await this.loadCluster(clusterId);
    }
    grip.focus();
  }
}
