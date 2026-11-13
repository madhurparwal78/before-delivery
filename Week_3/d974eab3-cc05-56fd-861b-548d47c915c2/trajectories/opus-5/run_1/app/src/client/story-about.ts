import { panelAnnouncement } from '../shared/messages';
import {
  PANEL_COUNT,
  clampProgress,
  formatProgress,
  panelFromProgress,
  progressForPanel,
  trackOffsetInPanels,
} from '../shared/progress';
import {
  all,
  announce,
  documentTop,
  isHeldLayout,
  need,
  onLayoutChange,
  prefersReducedMotion,
  scrollPageTo,
} from './dom';

/** The row arrives within 600 ms, so its own scroll is ignored until then. */
const ROW_SETTLE_MS = 700;

/**
 * The Inner Pace story. Held in view it is scroll-led; below the wide layout,
 * or with reduced motion, the same panels sit in one snapping sideways row.
 */
export class InnerPace {
  private readonly region = need<HTMLElement>('[data-chapter="about"]');
  private readonly panes = need<HTMLElement>('[data-panes]', this.region);
  private readonly track = need<HTMLElement>('[data-track]', this.region);
  private readonly counter = need<HTMLElement>(
    '[data-panel-counter]',
    this.region,
  );
  private readonly buttons = all<HTMLButtonElement>(
    '[data-panel-step]',
    this.region,
  );
  private readonly titles = all<HTMLElement>('.pane__title', this.region).map(
    (title) => title.textContent ?? '',
  );
  private panel = 1;
  private rowSettleAt = 0;

  constructor() {
    for (const button of this.buttons) {
      button.addEventListener('click', () => {
        this.step(Number(button.dataset['panelStep']), button);
      });
    }
    this.panes.addEventListener('scroll', () => {
      if (!isHeldLayout() && performance.now() >= this.rowSettleAt) {
        this.applyPanel(this.nearestPanel(), true);
      }
    });
    window.addEventListener('scroll', () => {
      this.follow();
    });
    onLayoutChange(() => {
      this.follow();
      if (!isHeldLayout()) {
        this.scrollRowTo(this.panel, false);
      }
    });
    this.applyDisabled();
  }

  private progress(): number {
    const travel = this.region.offsetHeight - window.innerHeight;
    return clampProgress(
      (window.scrollY - documentTop(this.region)) / Math.max(1, travel),
    );
  }

  private paneElements(): HTMLElement[] {
    return all<HTMLElement>('.pane', this.track);
  }

  /** The panel whose centre is nearest the row's centre. */
  private nearestPanel(): number {
    const box = this.panes.getBoundingClientRect();
    const centre = box.left + box.width / 2;
    let best = 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    this.paneElements().forEach((pane, index) => {
      const paneBox = pane.getBoundingClientRect();
      const distance = Math.abs(paneBox.left + paneBox.width / 2 - centre);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index + 1;
      }
    });
    return best;
  }

  private applyDisabled(): void {
    for (const button of this.buttons) {
      const step = Number(button.dataset['panelStep']);
      button.disabled =
        (step < 0 && this.panel === 1) ||
        (step > 0 && this.panel === PANEL_COUNT);
    }
  }

  private applyPanel(panel: number, shouldAnnounce: boolean): void {
    if (panel === this.panel) {
      return;
    }
    this.panel = panel;
    this.region.dataset['panel'] = String(panel);
    this.counter.textContent = `${panel} / ${PANEL_COUNT}`;
    this.applyDisabled();
    if (shouldAnnounce) {
      announce(panelAnnouncement(panel, this.titles[panel - 1] ?? ''));
    }
  }

  private scrollRowTo(panel: number, smooth: boolean): void {
    const pane = this.paneElements()[panel - 1];
    if (pane === undefined) {
      return;
    }
    const left =
      this.panes.scrollLeft +
      pane.getBoundingClientRect().left -
      this.panes.getBoundingClientRect().left;
    this.panes.scrollTo({
      left,
      behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'instant',
    });
  }

  private step(step: number, pressed: HTMLButtonElement): void {
    const target = Math.min(PANEL_COUNT, Math.max(1, this.panel + step));
    if (target === this.panel) {
      return;
    }
    if (isHeldLayout()) {
      const travel = this.region.offsetHeight - window.innerHeight;
      scrollPageTo(
        documentTop(this.region) + progressForPanel(target) * travel,
        false,
      );
      this.follow();
      announce(panelAnnouncement(target, this.titles[target - 1] ?? ''));
    } else {
      this.rowSettleAt =
        performance.now() + (prefersReducedMotion() ? 0 : ROW_SETTLE_MS);
      this.scrollRowTo(target, true);
      this.applyPanel(target, true);
    }
    if (pressed.disabled) {
      this.buttons.find((button) => button !== pressed)?.focus();
    }
  }

  /** Reads the scroll position and moves the track, panel and progress. */
  follow(): void {
    if (!isHeldLayout()) {
      this.region.classList.remove('is-held');
      delete this.region.dataset['progress'];
      this.track.style.removeProperty('transform');
      // The row scrolls sideways, so it takes focus for keyboard scrolling.
      this.panes.tabIndex = 0;
      return;
    }
    this.region.classList.add('is-held');
    this.panes.removeAttribute('tabindex');
    const progress = this.progress();
    this.region.dataset['progress'] = formatProgress(progress);
    this.track.style.transform = `translateX(${-trackOffsetInPanels(progress) * this.panes.clientWidth}px)`;
    this.applyPanel(panelFromProgress(progress), false);
  }
}
