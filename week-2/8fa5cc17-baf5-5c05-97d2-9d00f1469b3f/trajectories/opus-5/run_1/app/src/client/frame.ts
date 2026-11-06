import { clear, el, focusable, prefersReducedMotion, setHidden, setOutsideInert, trapFocus, viewportLayout } from './dom';
import { Spring } from './anim';
import { COPY } from '../shared/copy';
import { libraryOrder, workspace } from './state';
import { dateHeading } from '../shared/homeclock';
import { navigate } from './router';
import { api } from './api';
import { setSyncStatusNode } from './live';

export type Layout = 'laptop' | 'tablet' | 'phone';

type Panel = {
  node: HTMLElement;
  backdrop: HTMLElement;
  spring: Spring;
  open: boolean;
  opener: HTMLElement | null;
  axis: 'x' | 'y';
};

export class Frame {
  readonly root: HTMLElement;
  readonly main: HTMLElement;
  readonly margin: HTMLElement;
  readonly rail: HTMLElement;
  readonly saveStatus: HTMLElement;
  readonly syncStatus: HTMLElement;
  readonly announcements: HTMLElement;
  readonly alertRegion: HTMLElement;
  readonly storageStatus: HTMLElement;
  readonly progressRule: HTMLElement;
  readonly tetherLayer: SVGElement;
  readonly topTitle: HTMLElement;

  private readonly asideHost: HTMLElement;
  private readonly railHost: HTMLElement;
  private readonly libraryButton: HTMLButtonElement;
  private readonly marginButton: HTMLButtonElement;
  private readonly topbar: HTMLElement;
  private readonly drawer: Panel;
  private readonly sheet: Panel;
  private layout: Layout = 'laptop';
  private storageTimer = 0;

  constructor(host: HTMLElement) {
    this.root = el('div', { className: 'frame' });
    this.libraryButton = el('button', { className: 'topbar-button', text: 'Open library', attrs: { type: 'button' } });
    this.marginButton = el('button', { className: 'topbar-button', text: 'Open margin', attrs: { type: 'button' } });
    this.topTitle = el('span', { className: 'topbar-title' });
    this.topbar = el('div', {
      className: 'topbar',
      children: [this.libraryButton, this.topTitle, this.marginButton],
    });

    this.rail = el('nav', { className: 'rail', attrs: { 'aria-label': 'Library' } });
    this.railHost = el('div', { className: 'rail-host' });
    this.railHost.append(this.rail);

    this.progressRule = el('div', { className: 'reading-progress', attrs: { 'data-reading-progress': '' } });
    this.main = el('main', { className: 'column' });
    this.margin = el('div', { className: 'margin-content' });
    this.asideHost = el('aside', {
      className: 'margin',
      attrs: { role: 'complementary', 'aria-label': 'Margin' },
    });
    this.asideHost.append(this.margin);
    this.tetherLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.tetherLayer.setAttribute('class', 'tether-layer');
    this.tetherLayer.setAttribute('aria-hidden', 'true');

    const drawerNode = el('div', {
      className: 'drawer',
      attrs: { role: 'dialog', 'aria-label': 'Library', 'aria-modal': 'true' },
    });
    const drawerBackdrop = el('div', { className: 'backdrop' });
    const sheetNode = el('div', {
      className: 'sheet',
      attrs: { role: 'dialog', 'aria-label': 'Margin', 'aria-modal': 'true' },
    });
    const sheetBackdrop = el('div', { className: 'backdrop' });

    this.saveStatus = el('div', { className: 'status', attrs: { role: 'status', 'aria-label': 'Save status' } });
    this.syncStatus = el('div', { className: 'status', attrs: { role: 'status', 'aria-label': 'Sync status' } });
    this.announcements = el('div', {
      className: 'status',
      attrs: { role: 'status', 'aria-label': 'Announcements', 'aria-live': 'polite' },
    });
    this.alertRegion = el('div', { className: 'alert', attrs: { role: 'alert' } });
    this.storageStatus = el('div', {
      className: 'storage-banner',
      attrs: { role: 'alert', 'aria-label': 'Storage status' },
    });
    setHidden(this.storageStatus, true);

    this.root.append(
      this.topbar,
      this.railHost,
      drawerBackdrop,
      drawerNode,
      el('div', {
        className: 'column-wrap',
        children: [this.progressRule, this.main],
      }),
      this.asideHost,
      this.tetherLayer,
      sheetBackdrop,
      sheetNode,
      el('div', {
        className: 'live-regions',
        children: [this.storageStatus, this.saveStatus, this.syncStatus, this.announcements, this.alertRegion],
      }),
    );
    host.append(this.root);

    this.drawer = {
      node: drawerNode,
      backdrop: drawerBackdrop,
      open: false,
      opener: null,
      axis: 'x',
      spring: new Spring(
        -320,
        (offset, progress) => {
          drawerNode.style.transform = `translateX(${offset}px)`;
          drawerBackdrop.style.opacity = String(progress);
        },
        (target) => this.panelSettled(this.drawer, target),
      ),
    };
    this.sheet = {
      node: sheetNode,
      backdrop: sheetBackdrop,
      open: false,
      opener: null,
      axis: 'y',
      spring: new Spring(
        600,
        (offset, progress) => {
          sheetNode.style.transform = `translateY(${offset}px)`;
          sheetBackdrop.style.opacity = String(progress);
        },
        (target) => this.panelSettled(this.sheet, target),
      ),
    };
    setHidden(drawerNode, true);
    setHidden(drawerBackdrop, true);
    setHidden(sheetNode, true);
    setHidden(sheetBackdrop, true);
    trapFocus(drawerNode);
    trapFocus(sheetNode);

    this.libraryButton.addEventListener('click', () => this.openDrawer(this.libraryButton));
    this.marginButton.addEventListener('click', () => this.openSheet(this.marginButton));
    drawerBackdrop.addEventListener('click', () => this.closeDrawer());
    sheetBackdrop.addEventListener('click', () => this.closeSheet());
    drawerNode.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') this.closeDrawer();
    });
    sheetNode.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') this.closeSheet();
    });
    this.installSheetDrag(sheetNode);

    window.addEventListener('resize', () => this.applyLayout());
    window.addEventListener('scroll', () => this.updateReadingProgress(), { passive: true });
    setSyncStatusNode(this.syncStatus);
    this.applyLayout();
    this.startStorageWatch();
  }

  currentLayout(): Layout {
    return this.layout;
  }

  /** One column with a drawer and a bottom sheet on a phone, two panes on a tablet, three on a laptop. */
  applyLayout(): void {
    const next = viewportLayout();
    const changed = next !== this.layout;
    this.layout = next;
    this.root.setAttribute('data-layout', next);
    setHidden(this.topbar, next !== 'phone');
    this.libraryButton.hidden = next === 'laptop';
    if (next === 'laptop') {
      if (this.rail.parentElement !== this.railHost) this.railHost.append(this.rail);
      if (this.margin.parentElement !== this.asideHost) this.asideHost.append(this.margin);
      setHidden(this.railHost, false);
      setHidden(this.asideHost, false);
      if (changed) {
        this.closeDrawerNow();
        this.closeSheetNow();
      }
    } else if (next === 'tablet') {
      if (this.rail.parentElement !== this.drawer.node) this.drawer.node.append(this.rail);
      if (this.margin.parentElement !== this.asideHost) this.asideHost.append(this.margin);
      setHidden(this.railHost, true);
      setHidden(this.asideHost, false);
      if (changed) this.closeSheetNow();
    } else {
      if (this.rail.parentElement !== this.drawer.node) this.drawer.node.append(this.rail);
      if (this.margin.parentElement !== this.sheet.node) this.sheet.node.append(this.margin);
      setHidden(this.railHost, true);
      setHidden(this.asideHost, true);
    }
    this.updateReadingProgress();
  }

  /** `p` = page scroll offset ÷ (document scroll height − viewport height), clamped to 0..1. */
  updateReadingProgress(): void {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const p = scrollable <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / scrollable));
    this.progressRule.style.transform = `scaleX(${p})`;
  }

  setTopTitle(title: string): void {
    this.topTitle.textContent = title;
  }

  announce(text: string): void {
    this.announcements.textContent = '';
    window.setTimeout(() => {
      this.announcements.textContent = text;
    }, 10);
  }

  setSaveStatus(text: string): void {
    this.saveStatus.textContent = text;
  }

  showAlert(text: string): void {
    this.alertRegion.textContent = text;
  }

  clearAlert(): void {
    this.alertRegion.textContent = '';
  }

  /* ------------------------------------------------- drawer and sheet */

  private panelSettled(panel: Panel, target: number): void {
    const openTarget = 0;
    if (target !== openTarget) {
      setHidden(panel.node, true);
      setHidden(panel.backdrop, true);
    }
  }

  private drawerWidth(): number {
    return this.drawer.node.offsetWidth || 320;
  }

  private sheetHeight(): number {
    return this.sheet.node.offsetHeight || Math.round(window.innerHeight * 0.66);
  }

  openDrawer(opener: HTMLElement | null): void {
    this.drawer.opener = opener;
    this.drawer.open = true;
    setOutsideInert(true, [this.drawer.node, this.drawer.backdrop]);
    setHidden(this.drawer.node, false);
    setHidden(this.drawer.backdrop, false);
    const width = this.drawerWidth();
    if (this.drawer.spring.target !== 0 && this.drawer.spring.offset <= -width) {
      this.drawer.spring.setOffset(-width, 0, -width);
    }
    this.drawer.spring.retarget(0, 0, -width);
    const first = focusable(this.drawer.node)[0];
    if (first !== undefined) first.focus();
  }

  closeDrawer(): void {
    if (!this.drawer.open) return;
    this.drawer.open = false;
    setOutsideInert(false, []);
    this.drawer.node.setAttribute('aria-hidden', 'true');
    this.drawer.spring.retarget(-this.drawerWidth(), 0, -this.drawerWidth());
    const opener = this.drawer.opener;
    if (opener !== null && document.contains(opener)) opener.focus();
  }

  private closeDrawerNow(): void {
    this.drawer.open = false;
    setOutsideInert(false, []);
    this.drawer.spring.setOffset(-this.drawerWidth(), 0, -this.drawerWidth());
    setHidden(this.drawer.node, true);
    setHidden(this.drawer.backdrop, true);
  }

  openSheet(opener: HTMLElement | null): void {
    this.sheet.opener = opener;
    this.sheet.open = true;
    setOutsideInert(true, [this.sheet.node, this.sheet.backdrop]);
    setHidden(this.sheet.node, false);
    setHidden(this.sheet.backdrop, false);
    const height = this.sheetHeight();
    if (this.sheet.spring.target !== 0 && this.sheet.spring.offset >= height) {
      this.sheet.spring.setOffset(height, 0, height);
    }
    this.sheet.spring.retarget(0, 0, height);
    const first = focusable(this.sheet.node)[0];
    if (first !== undefined) first.focus();
  }

  closeSheet(): void {
    if (!this.sheet.open) return;
    this.sheet.open = false;
    setOutsideInert(false, []);
    this.sheet.node.setAttribute('aria-hidden', 'true');
    this.sheet.spring.retarget(this.sheetHeight(), 0, this.sheetHeight());
    const opener = this.sheet.opener;
    if (opener !== null && document.contains(opener)) opener.focus();
  }

  private closeSheetNow(): void {
    this.sheet.open = false;
    setOutsideInert(false, []);
    this.sheet.spring.setOffset(this.sheetHeight(), 0, this.sheetHeight());
    setHidden(this.sheet.node, true);
    setHidden(this.sheet.backdrop, true);
  }

  isSheetOpen(): boolean {
    return this.sheet.open;
  }

  private installSheetDrag(node: HTMLElement): void {
    let startY = 0;
    let startOffset = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let dragging = false;
    node.addEventListener(
      'pointerdown',
      (event) => {
        if (this.layout !== 'phone' || !this.sheet.open) return;
        const target = event.target as HTMLElement;
        if (target.closest('button, a, input, textarea, select') !== null) return;
        dragging = true;
        startY = event.clientY;
        lastY = event.clientY;
        lastTime = event.timeStamp;
        startOffset = this.sheet.spring.offset;
        node.setPointerCapture(event.pointerId);
      },
      { passive: true },
    );
    node.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const offset = Math.max(0, startOffset + (event.clientY - startY));
      this.sheet.spring.setOffset(offset, 0, this.sheetHeight());
      const dt = event.timeStamp - lastTime;
      if (dt > 0) velocity = ((event.clientY - lastY) / dt) * 1000;
      lastY = event.clientY;
      lastTime = event.timeStamp;
    });
    const release = (): void => {
      if (!dragging) return;
      dragging = false;
      const height = this.sheetHeight();
      const closed = this.sheet.spring.offset > height / 3;
      this.sheet.spring.velocity = velocity;
      if (closed) this.closeSheet();
      else this.sheet.spring.retarget(0, 0, height);
    };
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
  }

  /* ----------------------------------------------------- storage watch */

  private startStorageWatch(): void {
    const check = async (): Promise<void> => {
      const result = await api.get<{ storage: string }>('/api/storage');
      const unavailable = result.ok && result.data.storage === 'unavailable';
      this.setStorageOutage(unavailable);
    };
    void check();
    this.storageTimer = window.setInterval(() => void check(), 10_000);
  }

  setStorageOutage(outage: boolean): void {
    const showing = !this.storageStatus.hasAttribute('hidden');
    if (outage === showing) return;
    if (outage) {
      this.storageStatus.textContent = COPY.storageBanner;
      setHidden(this.storageStatus, false);
    } else {
      this.storageStatus.textContent = '';
      setHidden(this.storageStatus, true);
      document.dispatchEvent(new CustomEvent('quire:storage-available'));
    }
  }

  storageOutage(): boolean {
    return !this.storageStatus.hasAttribute('hidden');
  }

  stopStorageWatch(): void {
    if (this.storageTimer !== 0) window.clearInterval(this.storageTimer);
  }

  /* ------------------------------------------------------------- rail */

  renderRail(): void {
    const state = workspace();
    clear(this.rail);
    const todayButton = el('button', { className: 'rail-today', text: 'Today', attrs: { type: 'button' } });
    todayButton.addEventListener('click', () => {
      this.closeDrawer();
      navigate('/today', { reveal: true });
    });
    this.rail.append(todayButton);

    const typesSection = el('div', { className: 'rail-section' });
    typesSection.append(el('h2', { text: 'Types' }));
    for (const type of libraryOrder(state.types)) {
      typesSection.append(this.railLink(type.name, `/types/${type.id}`));
    }
    const newType = el('button', { className: 'rail-new-type', text: 'New type', attrs: { type: 'button' } });
    newType.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('quire:new-type', { detail: { opener: newType } }));
    });
    typesSection.append(newType);
    this.rail.append(typesSection);

    const collections = el('div', { className: 'rail-section' });
    collections.append(el('h2', { text: 'Collections' }));
    for (const collection of state.collections) {
      collections.append(this.railLink(collection.name, `/collections/${collection.id}`));
    }
    this.rail.append(collections);

    const daily = el('div', { className: 'rail-section' });
    daily.append(el('h2', { text: 'Daily notes' }));
    for (const note of state.dailyRecent) {
      daily.append(this.railLink(dateHeading(note.date), `/o/${note.object_id}`, true));
    }
    this.rail.append(daily);

    const links = el('div', { className: 'rail-section' });
    for (const [label, path] of [
      ['Timeline', '/timeline'],
      ['Queries', '/queries'],
      ['Graph', '/graph'],
      ['Settings', '/settings'],
    ] as [string, string][]) {
      links.append(this.railLink(label, path));
    }
    this.rail.append(links);
  }

  private railLink(label: string, path: string, reveal = false): HTMLAnchorElement {
    const link = el('a', { className: 'rail-link', text: label, attrs: { href: path } });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      this.closeDrawer();
      navigate(path, { reveal });
    });
    return link;
  }

  reducedMotion(): boolean {
    return prefersReducedMotion();
  }
}

let frameInstance: Frame | null = null;

export function mountFrame(host: HTMLElement): Frame {
  frameInstance = new Frame(host);
  return frameInstance;
}

export function frame(): Frame {
  if (frameInstance === null) throw new Error('the frame is not mounted');
  return frameInstance;
}
