import { stageAnnouncement } from '../shared/messages';
import {
  clampProgress,
  formatProgress,
  progressForStage,
  stageFromProgress,
} from '../shared/progress';
import {
  all,
  announce,
  documentTop,
  isHeldLayout,
  need,
  onLayoutChange,
  scrollPageTo,
} from './dom';
import { TabList } from './tablist';

/**
 * The five oxygen stages. Held in view the chapter is scroll-led; below the
 * wide layout, or with reduced motion, the stage changes only through the tabs.
 */
export class OxygenStages {
  private readonly region = need<HTMLElement>('[data-chapter="oxygen"]');
  private readonly path = need<SVGPathElement>(
    '[data-oxygen-path]',
    this.region,
  );
  private readonly dot = need<SVGElement>('[data-dot]', this.region);
  private readonly titles = all<HTMLElement>(
    '.stage-panel__title',
    this.region,
  ).map((title) => title.textContent ?? '');
  private readonly tabs: TabList;
  private stage = 1;

  constructor() {
    this.tabs = new TabList(
      need<HTMLElement>('[role="tablist"]', this.region),
      (index) => {
        this.chooseStage(index + 1);
      },
    );
    window.addEventListener('scroll', () => {
      this.follow();
    });
    onLayoutChange(() => {
      this.follow();
    });
  }

  private progress(): number {
    const travel = this.region.offsetHeight - window.innerHeight;
    return clampProgress(
      (window.scrollY - documentTop(this.region)) / Math.max(1, travel),
    );
  }

  private moveDot(fraction: number): void {
    const point = this.path.getPointAtLength(
      this.path.getTotalLength() * fraction,
    );
    this.dot.setAttribute('cx', point.x.toFixed(2));
    this.dot.setAttribute('cy', point.y.toFixed(2));
    this.dot.dataset['dot'] = fraction.toFixed(2);
  }

  private applyStage(stage: number): void {
    this.stage = stage;
    this.region.dataset['stage'] = String(stage);
    this.tabs.select(stage - 1);
    if (!isHeldLayout()) {
      this.moveDot(progressForStage(stage));
    }
  }

  /** A tab jumps the page to the stage's position and keeps focus on the tab. */
  private chooseStage(stage: number): void {
    if (isHeldLayout()) {
      const travel = this.region.offsetHeight - window.innerHeight;
      scrollPageTo(
        documentTop(this.region) + progressForStage(stage) * travel,
        false,
      );
      this.follow();
    } else {
      this.applyStage(stage);
    }
    announce(stageAnnouncement(stage, this.titles[stage - 1] ?? ''));
  }

  follow(): void {
    if (!isHeldLayout()) {
      this.region.classList.remove('is-held');
      delete this.region.dataset['progress'];
      this.moveDot(progressForStage(this.stage));
      return;
    }
    this.region.classList.add('is-held');
    const progress = this.progress();
    this.region.dataset['progress'] = formatProgress(progress);
    this.moveDot(progress);
    this.applyStage(stageFromProgress(progress));
  }
}
