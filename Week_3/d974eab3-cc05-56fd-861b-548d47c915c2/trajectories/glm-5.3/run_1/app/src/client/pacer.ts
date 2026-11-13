import { announceStatus, reducedMotion } from './core.js';
import { oxygenDiagram } from './art.js';
import {
  chapterProgress,
  panelProgress,
  panelTitle,
  progressToPanel,
  progressToStage,
  roundProgress,
  stageProgress,
  stageTitle,
} from './story.js';

let innerPacePanel = 1;
let oxygenStage = 1;

export function initInnerPace(onPanelShown: (panel: number, announce: boolean) => void): void {
  const region = document.querySelector<HTMLElement>('[data-innerpace]');
  if (!region) return;
  const track = region.querySelector<HTMLElement>('[data-track]');
  const panels = Array.from(region.querySelectorAll<HTMLElement>('.pace-panel'));
  const counter = region.querySelector<HTMLElement>('[data-panel-counter]');
  const prev = region.querySelector<HTMLButtonElement>('[data-panel-prev]');
  const next = region.querySelector<HTMLButtonElement>('[data-panel-next]');

  if (!track || !prev || !next || panels.length !== 3) return;

  const heldMode = () => window.matchMedia('(min-width: 768px)').matches && !reducedMotion();

  const paintPanel = (panel: number) => {
    innerPacePanel = panel;
    region.setAttribute('data-panel', String(panel));
    if (counter) counter.textContent = `${panel} / 3`;
    prev.disabled = panel === 1;
    next.disabled = panel === 3;
  };

  paintPanel(1);

  const showPanel = (panel: number, announce: boolean, scrollTo = false) => {
    paintPanel(panel);
    if (heldMode() && scrollTo) {
      const target = region.offsetTop + panelProgress(panel) * (region.offsetHeight - window.innerHeight);
      window.scrollTo({ top: target, behavior: 'instant' });
    }
    if (!heldMode()) {
      const panelBox = panels[panel - 1];
      if (panelBox) {
        const left = panelBox.offsetLeft - track.offsetLeft;
        track.scrollTo({ left, behavior: reducedMotion() ? 'instant' : 'smooth' });
      }
    }
    onPanelShown(panel, announce);
  };

  prev.addEventListener('click', () => {
    if (prev.disabled) return;
    showPanel(Math.max(1, innerPacePanel - 1), true, true);
    if (prev.disabled) next.focus();
  });
  next.addEventListener('click', () => {
    if (next.disabled) return;
    showPanel(Math.min(3, innerPacePanel + 1), true, true);
    if (next.disabled) prev.focus();
  });

  let swipeStart: number | null = null;
  track.addEventListener('touchstart', (event) => {
    if (heldMode()) return;
    swipeStart = event.touches[0]?.clientX ?? null;
  }, { passive: true });
  track.addEventListener('touchend', (event) => {
    if (swipeStart === null) return;
    const end = event.changedTouches[0]?.clientX ?? swipeStart;
    const delta = end - swipeStart;
    swipeStart = null;
    if (Math.abs(delta) < 40) return;
    const direction = delta < 0 ? 1 : -1;
    const target = innerPacePanel + direction;
    if (target < 1 || target > 3) return;
    showPanel(target, true);
  });

  track.addEventListener('scroll', () => {
    if (heldMode()) return;
    const centre = track.scrollLeft + track.clientWidth / 2;
    let nearest = 1;
    let best = Number.POSITIVE_INFINITY;
    panels.forEach((panel, index) => {
      const panelCentre = panel.offsetLeft + panel.offsetWidth / 2;
      const distance = Math.abs(panelCentre - centre);
      if (distance < best) {
        best = distance;
        nearest = index + 1;
      }
    });
    if (nearest !== innerPacePanel) {
      paintPanel(nearest);
    }
  }, { passive: true });

  const updateFromScroll = () => {
    if (!heldMode()) {
      region.removeAttribute('data-progress');
      return;
    }
    const progress = chapterProgress(region);
    region.setAttribute('data-progress', roundProgress(progress));
    const panel = progressToPanel(progress);
    const offset = progress * panels[0]!.offsetWidth * 2;
    track.style.transform = `translateX(-${offset}px)`;
    if (panel !== innerPacePanel) {
      paintPanel(panel);
    }
  };

  window.addEventListener('scroll', () => window.requestAnimationFrame(updateFromScroll), { passive: true });
  window.addEventListener('resize', updateFromScroll);
  updateFromScroll();
}

export function announcePanel(panel: number): void {
  announceStatus(`Panel ${panel} of 3: ${panelTitle(panel)}.`);
}

export function initOxygen(onStageShown: (stage: number, announce: boolean) => void): void {
  const region = document.querySelector<HTMLElement>('[data-oxygen]');
  if (!region) return;
  const tabs = Array.from(region.querySelectorAll<HTMLElement>('[data-stage-tab]'));
  const tabPanels = Array.from(region.querySelectorAll<HTMLElement>('[data-stage-panel]'));
  const holder = region.querySelector<HTMLElement>('[data-dot-holder]');
  if (tabs.length !== 5 || tabPanels.length !== 5 || !holder) return;

  holder.innerHTML = oxygenDiagram(520, 160);
  const dot = holder.querySelector<HTMLElement>('[data-dot]');

  const heldMode = () => window.matchMedia('(min-width: 768px)').matches && !reducedMotion();

  const moveDot = (progress: number) => {
    if (!dot) return;
    const x = 24 + progress * (520 - 64);
    const y = 80 + Math.sin(progress * Math.PI * 2) * 46;
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
  };

  const selectStage = (stage: number, announce: boolean, scrollTo = false) => {
    paintStage(stage);
    if (scrollTo) {
      if (heldMode()) {
        const target = region.offsetTop + stageProgress(stage) * (region.offsetHeight - window.innerHeight);
        window.scrollTo({ top: target, behavior: 'instant' });
      } else {
        moveDot(stageProgress(stage));
      }
    }
    onStageShown(stage, announce);
  };

  const paintStage = (stage: number) => {
    oxygenStage = stage;
    region.setAttribute('data-stage', String(stage));
    tabs.forEach((tab, index) => {
      const selected = index + 1 === stage;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    tabPanels.forEach((panel, index) => {
      panel.hidden = index + 1 !== stage;
    });
  };

  const tablist = region.querySelector<HTMLElement>('[data-stage-tablist]');
  tablist?.addEventListener('keydown', (event) => {
    const focused = tabs.findIndex((tab) => tab === document.activeElement);
    const from = focused === -1 ? oxygenStage - 1 : focused;
    const keys: Record<string, number> = {
      ArrowRight: (from + 1) % 5,
      ArrowLeft: (from + 4) % 5,
      Home: 0,
      End: 4,
    };
    const target = keys[event.key];
    if (target === undefined) return;
    event.preventDefault();
    selectStage(target + 1, true, true);
    tabs[target]?.focus();
  });

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const stage = Number(tab.getAttribute('data-stage-tab'));
      selectStage(stage, true, true);
    });
  });

  const updateFromScroll = () => {
    if (!heldMode()) {
      region.removeAttribute('data-progress');
      moveDot(stageProgress(oxygenStage));
      return;
    }
    const progress = chapterProgress(region);
    region.setAttribute('data-progress', roundProgress(progress));
    moveDot(progress);
    const stage = progressToStage(progress);
    if (stage !== oxygenStage) {
      paintStage(stage);
    }
  };

  window.addEventListener('scroll', () => window.requestAnimationFrame(updateFromScroll), { passive: true });
  window.addEventListener('resize', updateFromScroll);
  selectStage(1, false);
  updateFromScroll();
}

export function announceStage(stage: number): void {
  announceStatus(`Stage ${stage} of 5: ${stageTitle(stage)}.`);
}
