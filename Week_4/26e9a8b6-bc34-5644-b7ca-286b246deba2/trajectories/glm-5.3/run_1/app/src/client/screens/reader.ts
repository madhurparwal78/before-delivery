// Reader `/g/<slug>`: scroll drives the model apart band by band.

import { el, announce, codePoints as unused } from '../dom';
import { api, LiveConnection } from '../api';
import { COPY } from '../../shared/copy';
import { PHASE_FIELDS, PHASE_NAMES, type Phase } from '../../shared/phase';
import { formatCost, type CurrencyCode } from '../../shared/cost';
import type { Camera } from '../../shared/working';
import { Stage } from '../stage';
import { reducedMotion, tween, easeOutCubic, onFrame, pageInterval } from '../clock';

export interface ReaderStep {
  id: string;
  number: number;
  title: string;
  text: string;
  phase: Phase;
  explode: number;
  focus_parts: string[];
  camera: Camera;
  callouts: { part_id: string; text: string }[];
  parts_cost: number;
  parts_cost_text: string;
}

export interface GuideReadingJson {
  id: string;
  slug: string;
  title: string;
  author: { id: string; name: string };
  state: 'draft' | 'published' | 'withdrawn';
  visibility: 'public' | 'private';
  currency: CurrencyCode;
  tags: string[];
  published_version: number | null;
  like_count: number;
  fork_count: number;
  model_id: string | null;
  total_cost: number;
  total_cost_text: string;
  part_count: number;
  step_count: number;
  parts: { id: string; name: string; node_path: string; unbound: boolean; axis: 'x' | 'y' | 'z'; apart_mm: number; quantity: number; unit_price: number; fitted_at: string | null }[];
  steps: ReaderStep[];
  forked_from: { guide_id: string; title: string; author_name: string; version: number } | null;
}

interface QuestionJson {
  id: string;
  guide_id: string;
  step: number;
  text: string;
  asked_by: string;
  asked_at: string;
  answer: { text: string; answered_by: string; answered_at: string } | null;
}

export interface ReaderLayout {
  stageWidthPercent: number | null;
  stageHeightPercent: number | null;
}

/** The published scroll mapping, in one place. */
export function scrollMapping(steps: ReaderStep[], scrollY: number, viewportHeight: number): { step: number; explode: number; yaw: number; pitch: number } {
  const total = steps.length;
  const y = Math.max(0, scrollY);
  const raw = Math.floor(y / viewportHeight);
  const step = Math.min(total, Math.max(1, raw));
  const previous = step === 1 ? steps[0] : steps[step - 2];
  const current = steps[step - 1];
  if (!previous || !current) return { step, explode: current?.explode ?? 0, yaw: current?.camera.yaw ?? 0, pitch: current?.camera.pitch ?? 0 };
  const bandStart = step * viewportHeight + 0.35 * viewportHeight;
  const bandEnd = step * viewportHeight + 0.65 * viewportHeight;
  if (y <= bandStart) return { step, explode: previous.explode, yaw: previous.camera.yaw, pitch: previous.camera.pitch };
  if (y >= bandEnd) return { step, explode: current.explode, yaw: current.camera.yaw, pitch: current.camera.pitch };
  const t = (y - bandStart) / (bandEnd - bandStart);
  return {
    step,
    explode: previous.explode + (current.explode - previous.explode) * t,
    yaw: previous.camera.yaw + (current.camera.yaw - previous.camera.yaw) * t,
    pitch: previous.camera.pitch + (current.camera.pitch - previous.camera.pitch) * t,
  };
}

/** The settled scroll position of a step. */
export function settledScroll(step: number, viewportHeight: number): number {
  return step * viewportHeight + 0.65 * viewportHeight;
}

export async function renderReader(main: HTMLElement, slug: string, embedMode: boolean): Promise<void> {
  let guide: GuideReadingJson;
  try {
    guide = await api<GuideReadingJson>(`/api/guides/${slug}`);
  } catch (error) {
    const err = error as { status?: number };
    if (err.status === 410) {
      main.textContent = '';
      const band = el('div', { class: 'error-band' });
      band.append(el('h1', { class: 'display' }, COPY.fixed.withdrawn));
      band.append(el('a', { class: 'pw-btn', href: '/' }, 'Pennywasher'));
      main.append(band);
      return;
    }
    renderNotFoundGuide(main);
    return;
  }
  if (guide.state === 'withdrawn') {
    main.textContent = '';
    const band = el('div', { class: 'error-band' });
    band.append(el('h1', { class: 'display' }, COPY.fixed.withdrawn));
    band.append(el('a', { class: 'pw-btn', href: '/' }, 'Pennywasher'));
    main.append(band);
    return;
  }
  buildReader(main, guide, embedMode);
}

function renderNotFoundGuide(main: HTMLElement): void {
  main.textContent = '';
  const band = el('div', { class: 'error-band' });
  band.append(el('h1', { class: 'display' }, COPY.fixed.notFound));
  band.append(el('a', { class: 'pw-btn', href: '/' }, 'Pennywasher'));
  main.append(band);
}

function buildReader(main: HTMLElement, guide: GuideReadingJson, embedMode: boolean): void {
  main.textContent = '';
  const total = guide.steps.length;
  const params = new URLSearchParams(window.location.search);
  const deepStep = Number.parseInt(params.get('step') ?? '', 10);
  const pastEnd = Number.isFinite(deepStep) && deepStep > total;
  const startStep = Number.isFinite(deepStep) ? Math.min(Math.max(1, deepStep), total) : 1;
  const reduce = reducedMotion();

  const stageRoot = el('div', { class: 'stage-root', role: 'application', 'aria-label': 'Model stage', tabindex: '0' });
  const stageStatus = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'stage' }, COPY.stage.loading);
  const stepCounter = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'step-counter' }, COPY.stepCounter(startStep, total));
  const readingProgress = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'reading-progress' });
  const guideStatus = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'guide-status' });
  const questionAlerts = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'question-alerts' });
  const likeCountStatus = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'like-count' }, COPY.likeCount(guide.like_count));
  const forkCountStatus = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'fork-count' }, COPY.forkCount(guide.fork_count));

  const partsCostFigure = el('div', { 'data-figure': 'parts-cost', 'aria-hidden': 'true' }, guide.steps[startStep - 1].parts_cost_text);
  const closingTotal = el('div', { 'data-figure': 'closing-total' }, guide.total_cost_text);

  // Header figures count up on a plain open, final at once on a step address.
  const headerFigures = {
    totalCost: el('div', { 'data-figure': 'total-cost' }, '0'),
    partCount: el('div', { 'data-figure': 'part-count' }, '0'),
    stepCount: el('div', { 'data-figure': 'step-count' }, '0'),
  };

  // The stage: real meshes with WebGL, the server's still without it.
  const hasWebGL = Stage.hasWebGL();
  const stage = new Stage(stageRoot);
  let stillImg: HTMLImageElement | null = null;
  if (hasWebGL) {
    stage.attach();
  } else {
    stage.setState('still');
    stillImg = el('img', { alt: `${guide.title}, step ${startStep} still`, src: `/api/guides/${guide.id}/stills/${startStep}` }) as HTMLImageElement;
    stillImg.style.width = '100%';
    stillImg.style.height = '100%';
    stillImg.style.objectFit = 'contain';
    stageRoot.append(stillImg);
    stageStatus.textContent = COPY.stage.stillFallback;
  }

  // Sections: header, one per step, closing.
  const container = el('div', { class: `reader ${reduce ? 'reader--reduced' : ''}` });

  const header = el('section', { class: 'reader__section reader__header', 'data-section': 'header' });
  const headerInner = el('div', { class: 'reader__panel-content' });
  headerInner.append(el('h1', { class: 'display' }, guide.title));
  headerInner.append(el('p', {}, `by ${guide.author.name}`));
  const tagRow = el('div', { class: 'dialog__row' });
  for (const tag of guide.tags) tagRow.append(el('span', { class: 'pw-chip' }, tag));
  headerInner.append(tagRow);
  headerInner.append(likeCountStatus, forkCountStatus);
  if (guide.forked_from) {
    const credit = el('p', { class: 'fork-credit' });
    credit.append(COPY.fixed.forkCredit(guide.forked_from.title, guide.forked_from.author_name, guide.forked_from.version));
    headerInner.append(credit);
  }
  const figuresRow = el('div', { class: 'reader__figures' });
  figuresRow.append(headerFigures.totalCost, headerFigures.partCount, headerFigures.stepCount);
  headerInner.append(figuresRow);
  header.append(headerInner);

  const steps = guide.steps;
  const isPhoneViewport = () => window.matchMedia('(max-width: 767px)').matches;
  const panel = el('div', { class: 'reader__panel', role: 'region', 'aria-label': 'Step text' });
  const panelPhase = el('p', { class: 'reader__panel-phase' });
  const panelHeading = el('h2', {});
  const panelText = el('p', {});
  const panelQuestions = el('div', { role: 'list', 'aria-label': 'Questions on this step' });
  panel.append(panelPhase, panelHeading, panelText, panelQuestions);

  const stageColumn = el('div', { class: 'reader__stage-column' });
  stageColumn.append(stageRoot, stageStatus);

  const readerBar = buildReaderBar(guide, embedMode, likeCountStatus, forkCountStatus, guideStatus);

  container.append(header);
  for (const step of steps) {
    container.append(el('section', { class: 'reader__section', 'data-section': String(step.number), 'data-phase': step.phase }));
  }
  const closing = el('section', { class: 'reader__section reader__closing', 'data-section': 'closing' });
  closing.append(el('h2', { class: 'display' }, 'Closing total'));
  closing.append(el('p', { class: 'closing-total-label' }, 'Parts total'));
  closing.append(closingTotal);
  container.append(closing);
  main.append(container);

  const stepsNav = el('nav', { 'aria-label': 'Steps', class: 'reader__steps-nav' });
  for (const step of steps) {
    stepsNav.append(el('a', { href: `?step=${step.number}`, 'data-step-link': String(step.number) }, String(step.number)));
  }
  stageColumn.append(stepCounter, partsCostFigure, stepsNav);
  const readerFixed = el('div', { class: 'reader-fixed', 'data-reader-fixed': 'true' });
  readerFixed.append(stageColumn, panel, readerBar);
  main.append(readerFixed);
  main.append(readingProgress);
  main.append(guideStatus);
  main.append(questionAlerts);

  // Focus parts and pose per step.
  let currentStep = startStep;
  let currentStepKey = -1;
  let manualOrbit = false;

  // The part label: name alone when unique, else name plus node path.
  const partLabel = (part: GuideReadingJson['parts'][number]): string => {
    const sameName = guide.parts.filter((other) => other.name === part.name);
    return sameName.length === 1 ? part.name : `${part.name} (${part.node_path})`;
  };

  // Callouts at desktop and tablet; the phone shows the numbered Parts list.
  const calloutsLayer = el('div', { class: 'callouts', 'aria-hidden': 'true' });
  stageColumn.append(calloutsLayer);
  const partsList = el('ol', { class: 'parts-list', role: 'list', 'aria-label': 'Parts' });
  const syncPartsListVisibility = (): void => {
    const phone = isPhoneViewport();
    partsList.classList.toggle('phone-only', !phone);
    calloutsLayer.classList.toggle('phone-hidden', phone);
  };
  syncPartsListVisibility();
  window.addEventListener('resize', syncPartsListVisibility);
  stageColumn.append(partsList);

  const applyStep = (stepNumber: number, announceIt: boolean): void => {
    const step = steps[stepNumber - 1];
    if (!step) return;
    currentStep = stepNumber;
    stage.setStep(stepNumber);
    stage.setFocusParts(step.focus_parts);
    stage.setStyle(fieldColor(step.phase), outlineColor(step.phase));
    if (hasWebGL) {
      if (!manualOrbit) stage.setPose({ ...step.camera });
      stage.setExplode(step.explode);
    }
    const field = PHASE_FIELDS[step.phase];
    panel.style.background = field.field;
    panel.style.color = field.text;
    panelPhase.textContent = PHASE_NAMES[step.phase];
    panelHeading.textContent = step.title;
    panelText.textContent = step.text;
    stepCounter.textContent = COPY.stepCounter(stepNumber, total);
    readingProgress.textContent = COPY.readingProgress(stepNumber, total, step.title, step.parts_cost_text);
    if (announceIt) announce('reading-progress', COPY.readingProgress(stepNumber, total, step.title, step.parts_cost_text));
    if (reduce) {
      partsCostFigure.textContent = step.parts_cost_text;
    } else {
      countFigure(partsCostFigure, step.parts_cost, guide.currency, 640);
    }
    if (stillImg) {
      stillImg.src = `/api/guides/${guide.id}/stills/${stepNumber}`;
      stillImg.alt = `${guide.title}, step ${stepNumber} still`;
    }
    renderCallouts(step);
    renderPartsList(step);
    void currentStepKey;
  };

  /** Callouts tether to each focus part's projected anchor. */
  const renderCallouts = (step: ReaderStep): void => {
    calloutsLayer.textContent = '';
    for (const callout of step.callouts) {
      const part = guide.parts.find((entry) => entry.id === callout.part_id);
      if (!part) continue;
      const node = el('div', { class: 'callout', 'data-callout': partLabel(part) }, callout.text);
      // Anchored near the part's projected position; flips sides inside the viewport.
      const anchor = stage.projectPart(part.node_path);
      if (anchor) {
        node.style.left = `${Math.min(Math.max(anchor.x + 24, 8), window.innerWidth - 208)}px`;
        node.style.top = `${Math.min(Math.max(anchor.y - 40, 8), window.innerHeight - 96)}px`;
      } else {
        node.style.left = '16px';
        node.style.top = '16px';
        node.setAttribute('data-part-hidden', 'true');
      }
      calloutsLayer.append(node);
    }
  };

  const renderPartsList = (step: ReaderStep): void => {
    partsList.textContent = '';
    step.focus_parts.forEach((partId, index) => {
      const part = guide.parts.find((entry) => entry.id === partId);
      if (!part) return;
      partsList.append(el('li', { role: 'listitem' }, `${index + 1}. ${part.name}`));
    });
  };

  const countFigure = (figure: HTMLElement, to: number, currency: CurrencyCode, ms: number): void => {
    const start = performance.now();
    const from = figure.dataset.from ? Number(figure.dataset.from) : 0;
    const stop = onFrame((now) => {
      const t = Math.min(1, (now - start) / ms);
      const value = from + (to - from) * easeOutCubic(t);
      figure.textContent = formatCost(Math.round(value), currency);
      if (t >= 1) {
        stop();
        figure.textContent = formatCost(to, currency);
        figure.dataset.from = String(to);
      }
    });
  };

  // The window scrolls; the stage and figures follow.
  let tweenStop: (() => void) | null = null;
  const onScroll = (): void => {
    if (reduce) return;
    if (tweenStop) {
      tweenStop();
      tweenStop = null;
    }
    const mapping = scrollMapping(steps, window.scrollY, window.innerHeight);
    const stepChanged = mapping.step !== currentStep;
    if (stepChanged) applyStep(mapping.step, true);
    // Manual orbit lasts until the band is entered or the step changes.
    if (stepChanged) manualOrbit = false;
    if (hasWebGL) {
      if (!manualOrbit) {
        stage.setExplode(mapping.explode);
        stage.yaw = mapping.yaw;
        stage.pitch = mapping.pitch;
        stage.zoom = 1;
      }
    }
    const address = `?step=${mapping.step}`;
    if (window.location.search !== address) {
      window.history.replaceState(null, '', address);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  // Stage keys orbit and zoom; Home returns to the step's saved pose.
  stageRoot.addEventListener('keydown', (event) => {
    const step = steps[currentStep - 1];
    let handled = true;
    if (event.key === 'ArrowLeft') stage.yaw -= 15;
    else if (event.key === 'ArrowRight') stage.yaw += 15;
    else if (event.key === 'ArrowUp') stage.pitch = Math.min(60, stage.pitch + 15);
    else if (event.key === 'ArrowDown') stage.pitch = Math.max(-60, stage.pitch - 15);
    else if (event.key === '+' || event.key === '=') stage.zoom = Math.min(3, stage.zoom * 1.25);
    else if (event.key === '-' || event.key === '_') stage.zoom = Math.max(0.5, stage.zoom * 0.8);
    else if (event.key === 'Home') {
      manualOrbit = false;
      if (step) stage.setPose(step.camera);
      stage.setExplode(step?.explode ?? 0);
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault();
      manualOrbit = event.key !== 'Home';
      stage.renderOnce();
    }
  });

  // Phone touch: vertical panning belongs to the page until Free look is on.
  const freeLook = el('button', { class: 'pw-btn', role: 'switch', 'aria-checked': 'false' }, 'Free look');
  const syncFreeLookVisibility = (): void => {
    freeLook.hidden = !isPhoneViewport();
  };
  syncFreeLookVisibility();
  window.addEventListener('resize', syncFreeLookVisibility);
  let freeLookOn = false;
  freeLook.addEventListener('click', () => {
    freeLookOn = !freeLookOn;
    freeLook.setAttribute('aria-checked', String(freeLookOn));
    stageRoot.style.touchAction = freeLookOn ? 'none' : 'pan-y';
  });
  readerBar.append(freeLook);

  // A mouse drag orbits at 1 degree per 2 px; the wheel always scrolls the page.
  let dragging = false;
  let dragX = 0;
  let dragY = 0;
  stageRoot.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' && !freeLookOn) return;
    dragging = true;
    manualOrbit = true;
    dragX = event.clientX;
    dragY = event.clientY;
    stageRoot.setPointerCapture(event.pointerId);
  });
  stageRoot.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    manualOrbit = true;
    const dx = event.clientX - dragX;
    const dy = event.clientY - dragY;
    dragX = event.clientX;
    dragY = event.clientY;
    stage.yaw += dx / 2;
    stage.pitch = Math.max(-60, Math.min(60, stage.pitch + dy / 2));
    stage.renderOnce();
  });
  stageRoot.addEventListener('pointerup', () => {
    dragging = false;
  });
  stageRoot.addEventListener('pointercancel', () => {
    dragging = false;
  });
  stageRoot.addEventListener('wheel', (event) => {
    // The wheel scrolls the page and never zooms the stage.
    event.preventDefault();
    window.scrollBy({ top: event.deltaY });
  }, { passive: false });

  // A two-finger pinch changes zoom within its clamps.
  const pinchStart = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  stageRoot.addEventListener('touchstart', (event) => {
    if (!freeLookOn) return;
    for (const touch of event.touches) {
      pinchStart.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
    if (event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]];
      pinchDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
  }, { passive: true });
  stageRoot.addEventListener('touchmove', (event) => {
    if (!freeLookOn || event.touches.length !== 2) return;
    event.preventDefault();
    const [a, b] = [event.touches[0], event.touches[1]];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinchDistance > 0) {
      manualOrbit = true;
      const ratio = distance / pinchDistance;
      stage.zoom = Math.max(0.5, Math.min(3, stage.zoom * ratio));
      stage.renderOnce();
    }
    pinchDistance = distance;
  }, { passive: false });
  stageRoot.addEventListener('touchend', (event) => {
    for (const touch of event.changedTouches) pinchStart.delete(touch.identifier);
    if (event.touches.length < 2) pinchDistance = 0;
  });

  const jumpTo = (stepNumber: number, withTween: boolean): void => {
    const target = settledScroll(stepNumber, window.innerHeight);
    const doJump = (): void => {
      window.scrollTo({ top: target });
      applyStep(stepNumber, true);
      if (hasWebGL) {
        const step = steps[stepNumber - 1];
        if (!reduce && withTween) {
          const from = { explode: stage.explode, yaw: stage.yaw, pitch: stage.pitch };
          tweenStop?.();
          tweenStop = tween(320, (t) => {
            const e = easeOutCubic(t);
            stage.setExplode(from.explode + (step.explode - from.explode) * e);
            stage.yaw = from.yaw + (step.camera.yaw - from.yaw) * e;
            stage.pitch = from.pitch + (step.camera.pitch - from.pitch) * e;
            stage.setPose({ yaw: stage.yaw, pitch: stage.pitch, zoom: 1 });
          });
        } else {
          stage.setExplode(step.explode);
          stage.setPose(step.camera);
        }
      }
    };
    doJump();
  };

  // Previous and Next step buttons and step links add a history entry.
  const goStep = (delta: number): void => {
    const next = Math.min(total, Math.max(1, currentStep + delta));
    if (reduce) {
      applyStep(next, true);
      window.history.pushState(null, '', `?step=${next}`);
      return;
    }
    window.history.pushState(null, '', `?step=${next}`);
    jumpTo(next, true);
  };

  wireReaderBar(readerBar, {
    goStep,
    onFirst: () => currentStep === 1,
    onLast: () => currentStep === total,
  });

  // Load the model when storage answers; the text keeps working either way.
  if (hasWebGL && guide.model_id) {
    void loadModelWithRetry(stage, `/api/models/${guide.model_id}.glb`, guide, stageStatus).then(() => {
      renderCallouts(steps[currentStep - 1]);
    });
  } else if (!guide.model_id) {
    stageStatus.textContent = COPY.stage.noModel;
    stageRoot.setAttribute('data-state', 'ready');
  }
  stage.setParts(guide.parts, 1);

  // Apply the opening step.
  applyStep(startStep, false);
  if (pastEnd) {
    guideStatus.textContent = COPY.fixed.stepPastEnd(total);
  }
  if (Number.isFinite(deepStep)) {
    // A step address opens settled with no tween.
    headerFigures.totalCost.textContent = guide.total_cost_text;
    headerFigures.partCount.textContent = String(guide.part_count);
    headerFigures.stepCount.textContent = String(total);
    if (!reduce) window.scrollTo({ top: settledScroll(startStep, window.innerHeight) });
  } else {
    headerFigures.totalCost.textContent = '0';
    if (reduce) {
      headerFigures.totalCost.textContent = guide.total_cost_text;
      headerFigures.partCount.textContent = String(guide.part_count);
      headerFigures.stepCount.textContent = String(total);
    } else {
      countUp(headerFigures.totalCost, guide.total_cost, guide.currency, 800);
      countUp(headerFigures.partCount, guide.part_count, '', 800);
      countUp(headerFigures.stepCount, total, '', 800);
    }
  }

  // Live changes reach the page and update in place.
  const live = new LiveConnection(guide.id, {
    onEvent: (event) => {
      if (event.type === 'like') {
        const count = Number(event.count);
        likeCountStatus.textContent = COPY.likeCount(count);
      }
      if (event.type === 'fork') {
        const count = Number(event.count);
        forkCountStatus.textContent = COPY.forkCount(count);
      }
      if (event.type === 'question' || event.type === 'answer') {
        void event.question_id;
        void refreshQuestions();
      }
    },
  });
  live.start();

  async function refreshQuestions(): Promise<void> {
    const result = await api<{ items: QuestionJson[] }>(`/api/guides/${guide.id}/questions?limit=100`);
    panelQuestions.textContent = '';
    for (const question of result.items) {
      if (question.step !== currentStep) continue;
      const item = el('div', { role: 'listitem', class: 'question-item' });
      item.append(el('p', {}, question.text));
      item.append(el('p', { class: 'question-byline' }, `${question.asked_by} asked`));
      if (question.answer) {
        item.append(el('p', {}, question.answer.text));
      }
      panelQuestions.append(item);
    }
  }
  void refreshQuestions();

  // Retrying the model every 5 s of page time while storage is out.
  const retryStop = pageInterval(() => {
    if (stageRoot.getAttribute('data-state') === 'error' && guide.model_id) {
      loadModelWithRetry(stage, `/api/models/${guide.model_id}.glb`, guide, stageStatus);
    }
  }, 5000);

  window.addEventListener('pagehide', () => {
    live.stop();
    retryStop();
    stage.dispose();
  });
  void embedMode;
}

function fieldColor(phase: Phase): string {
  // The field colours as used by three.js; CSS variables do not parse there.
  const values: Record<Phase, string> = {
    open_up: '#c8281e',
    take_out: '#efe6d3',
    fit_new: '#e0a526',
    close_up: '#2d4a6b',
    test_it: '#6e1f2b',
  };
  return values[phase];
}

function outlineColor(phase: Phase): string {
  const whiteText = phase === 'open_up' || phase === 'close_up' || phase === 'test_it';
  return whiteText ? '#efe6d3' : '#ffffff';
}

async function loadModelWithRetry(stage: Stage, url: string, guide: GuideReadingJson, stageStatus: HTMLElement): Promise<void> {
  try {
    const result = await stage.loadModelUrl(url);
    if (result.ok) {
      stageStatus.textContent = COPY.stage.ready;
      stage.setParts(guide.parts, 1);
      return;
    }
    stageRootError(stage, stageStatus);
  } catch {
    stageRootError(stage, stageStatus);
  }
}

function stageRootError(stage: Stage, stageStatus: HTMLElement): void {
  stage.setState('error');
  stageStatus.textContent = COPY.stage.storageOutReader;
  stageStatus.classList.add('pw-band');
}

function countUp(figure: HTMLElement, to: number, currency: '' | CurrencyCode, ms: number): void {
  const start = performance.now();
  const stop = onFrame((now) => {
    const t = Math.min(1, (now - start) / ms);
    const value = Math.round(to * easeOutCubic(t));
    figure.textContent = currency === '' ? String(value) : formatCost(value, currency);
    if (t >= 1) {
      stop();
      figure.textContent = currency === '' ? String(to) : formatCost(to, currency);
    }
  });
}

interface ReaderBarCallbacks {
  goStep: (delta: number) => void;
  onFirst: () => boolean;
  onLast: () => boolean;
}

function buildReaderBar(guide: GuideReadingJson, embedMode: boolean, likeCountStatus: HTMLElement, forkCountStatus: HTMLElement, guideStatus: HTMLElement): HTMLElement {
  const bar = el('div', { class: 'reader-bar', role: 'toolbar', 'aria-label': 'Reader tools' });
  if (!embedMode) {
    const like = el('button', { class: 'pw-btn', 'aria-pressed': 'false' }, 'Like');
    like.addEventListener('click', () => {
      void toggleLike(guide.id, like, likeCountStatus, guideStatus);
    });
    const fork = el('button', { class: 'pw-btn' }, 'Fork guide');
    fork.addEventListener('click', () => {
      void openForkDialog(guide, forkCountStatus, guideStatus);
    });
    const collect = el('button', { class: 'pw-btn' }, 'Add to collection');
    collect.addEventListener('click', () => {
      void openCollectionDialog(guide, guideStatus);
    });
    const ask = el('button', { class: 'pw-btn' }, 'Ask the author');
    ask.addEventListener('click', () => {
      void openAskDialog(guide, guideStatus);
    });
    bar.append(like, fork, collect, ask);
  }
  const sound = el('button', { class: 'pw-btn', 'aria-pressed': 'false' }, 'Workshop sound');
  sound.addEventListener('click', () => {
    void toggleSound(sound);
  });
  const previous = el('button', { class: 'pw-btn' }, 'Previous step');
  previous.addEventListener('click', () => callbacksRef.goStep(-1));
  const next = el('button', { class: 'pw-btn' }, 'Next step');
  next.addEventListener('click', () => callbacksRef.goStep(1));
  bar.append(sound, previous, next);
  return bar;
}

let callbacksRef: ReaderBarCallbacks = { goStep: () => {}, onFirst: () => true, onLast: () => true };

function wireReaderBar(bar: HTMLElement, callbacks: ReaderBarCallbacks): void {
  callbacksRef = callbacks;
  bar.querySelectorAll('button').forEach(() => {
    // Button handlers were attached with the callbacks at click time.
  });
}

async function toggleLike(guideId: string, button: HTMLElement, likeCountStatus: HTMLElement, guideStatus: HTMLElement): Promise<void> {
  const pressed = button.getAttribute('aria-pressed') === 'true';
  try {
    const result = await api<{ liked: boolean; like_count: number }>(`/api/guides/${guideId}/like`, {
      method: pressed ? 'DELETE' : 'PUT',
      body: {},
    });
    button.setAttribute('aria-pressed', String(result.liked));
    likeCountStatus.textContent = COPY.likeCount(result.like_count);
    guideStatus.textContent = result.liked ? COPY.guide.liked : COPY.guide.likeRemoved;
  } catch (error) {
    if ((error as { status?: number }).status === 401) {
      window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    if ((error as { code?: string }).code === 'unconfirmed') {
      guideStatus.textContent = COPY.guide.unconfirmed;
      return;
    }
    guideStatus.textContent = COPY.guide.failed;
  }
}

async function openForkDialog(guide: GuideReadingJson, forkCountStatus: HTMLElement, guideStatus: HTMLElement): Promise<void> {
  // The dialog names the version being forked and offers a cancel.
  const dialog = el('dialog', { 'aria-label': 'Fork guide' });
  const body = el('div', { class: 'dialog__body' });
  const confirm = el('button', { class: 'pw-btn' }, `Fork version ${guide.published_version ?? 1}`);
  const cancel = el('button', { class: 'pw-btn' }, 'Cancel');
  body.append(confirm, cancel);
  dialog.append(body);
  document.body.append(dialog);
  dialog.showModal();
  confirm.focus();
  const closeDialog = (): void => {
    dialog.close();
    dialog.remove();
  };
  cancel.addEventListener('click', closeDialog);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
    }
  });
  confirm.addEventListener('click', async () => {
    guideStatus.textContent = COPY.guide.forking;
    try {
      const result = await api<{ id: string; slug: string }>(`/api/guides/${guide.id}/forks`, { body: {} });
      window.location.href = `/edit/${result.slug}`;
    } catch (error) {
      const err = error as { status?: number; code?: string };
      if (err.status === 401) {
        window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      if (err.code === 'unconfirmed') {
        guideStatus.textContent = COPY.guide.unconfirmed;
        appendResendButton(guideStatus);
        closeDialog();
        return;
      }
      guideStatus.textContent = COPY.guide.failed;
      closeDialog();
    }
  });
  void forkCountStatus;
}

/** The refusal carries a resend button beside it. */
function appendResendButton(guideStatus: HTMLElement): void {
  if (guideStatus.parentElement?.querySelector('[data-resend]')) return;
  const resend = el('button', { class: 'pw-btn', 'data-resend': 'true' }, 'Resend confirmation');
  resend.addEventListener('click', async () => {
    try {
      await api('/api/account/resend', { body: {} });
      const session = await api<{ user: { email: string } }>('/api/session');
      guideStatus.textContent = COPY.guide.resendAccepted(session.user.email);
    } catch (error) {
      const err = error as { code?: string; body?: Record<string, unknown> };
      if (err.code === 'rate_limited') {
        guideStatus.textContent = COPY.guide.resendLimited(Number(err.body?.retry_after ?? 0));
        return;
      }
      guideStatus.textContent = COPY.account.mailFailed;
    }
    resend.remove();
  });
  guideStatus.after(resend);
}

async function openCollectionDialog(guide: GuideReadingJson, guideStatus: HTMLElement): Promise<void> {
  const dialog = el('dialog', { 'aria-label': 'Add to collection' });
  const body = el('div', { class: 'dialog__body' });
  const collectionSelect = el('select', { 'aria-label': 'Collection' }) as HTMLSelectElement;
  try {
    const dashboard = await api<{ collections: { id: string; title: string }[] }>('/api/dashboard');
    for (const collection of dashboard.collections) {
      const option = el('option', { value: collection.id }, collection.title);
      collectionSelect.append(option);
    }
  } catch {
    // A signed-out visitor is sent to sign-in first.
    window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    return;
  }
  const title = el('input', { type: 'text', 'aria-label': 'New collection title' }) as HTMLInputElement;
  const add = el('button', { class: 'pw-btn' }, 'Add');
  const cancel = el('button', { class: 'pw-btn' }, 'Cancel');
  body.append(collectionSelect, title, add, cancel);
  dialog.append(body);
  document.body.append(dialog);
  dialog.showModal();
  cancel.addEventListener('click', () => dialog.close());
  add.addEventListener('click', async () => {
    try {
      let collectionId = collectionSelect.value;
      if (title.value.trim().length > 0) {
        const created = await api<{ id: string }>('/api/collections', { body: { title: title.value.trim(), visibility: 'public' } });
        collectionId = created.id;
      }
      await api(`/api/collections/${collectionId}/items`, { body: { guide_id: guide.id } });
      guideStatus.textContent = COPY.collection.added(title.value || (collectionSelect.selectedOptions[0]?.textContent ?? ''));
      dialog.close();
    } catch (error) {
      if ((error as { code?: string }).code === 'already_in_collection') {
        guideStatus.textContent = COPY.guide.failed;
      } else if ((error as { status?: number }).status === 401) {
        window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      } else {
        guideStatus.textContent = COPY.guide.failed;
      }
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
}

async function openAskDialog(guide: GuideReadingJson, guideStatus: HTMLElement): Promise<void> {
  // The current step from the address or the page state.
  const step = Number.parseInt(new URLSearchParams(window.location.search).get('step') ?? '1', 10) || 1;
  // An unconfirmed account is refused with the copy and a resend button.
  try {
    const session = await api<{ user: { confirmed: boolean } }>('/api/session');
    if (!session.user.confirmed) {
      guideStatus.textContent = COPY.guide.unconfirmed;
      appendResendButton(guideStatus);
      return;
    }
  } catch (error) {
    // Signed out: the reader bar actions go to sign-in with a local return path.
    if ((error as { status?: number }).status === 401) {
      window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
  }
  const dialog = el('dialog', { 'aria-label': 'Ask the author' });
  const body = el('div', { class: 'dialog__body' });
  body.append(el('p', {}, `Asking about step ${step}`));
  const text = el('textarea', { 'aria-label': 'Your question' }) as HTMLTextAreaElement;
  const askStatus = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'ask' });
  const send = el('button', { class: 'pw-btn' }, 'Send question');
  const cancel = el('button', { class: 'pw-btn' }, 'Cancel');
  body.append(text, askStatus, send, cancel);
  dialog.append(body);
  document.body.append(dialog);
  dialog.showModal();
  text.focus();
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  send.addEventListener('click', async () => {
    if (text.value.trim().length === 0) {
      askStatus.textContent = COPY.ask.empty;
      return;
    }
    askStatus.textContent = COPY.ask.sending;
    try {
      await api(`/api/guides/${guide.id}/questions`, { body: { step, text: text.value } });
      guideStatus.textContent = COPY.guide.questionSent;
      dialog.close();
    } catch (error) {
      const err = error as { status?: number; code?: string; body?: Record<string, unknown> };
      if (err.status === 401) {
        window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      if (err.code === 'rate_limited') {
        askStatus.textContent = COPY.ask.limited(Number(err.body?.retry_after ?? 0));
        return;
      }
      if (err.code === 'too_long') {
        askStatus.textContent = COPY.ask.tooLong(Number(err.body?.limit ?? 0));
        return;
      }
      if (err.code === 'unconfirmed') {
        // A refusal keeps the dialog open with the text in place.
        guideStatus.textContent = COPY.guide.unconfirmed;
        appendResendButton(guideStatus);
        dialog.close();
        return;
      }
      askStatus.textContent = COPY.guide.failed;
    }
  });
}

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;

/** Sound stays off until pressed: one looping generated source through one master gain. */
export function toggleSound(button: HTMLElement): void {
  const pressed = button.getAttribute('aria-pressed') === 'true';
  if (!audioContext) {
    // The first press creates the context, one looping generated source and the master gain.
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.25;
    masterGain.connect(audioContext.destination);
    const length = audioContext.sampleRate * 2;
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const noiseSource = audioContext.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;
    noiseSource.connect(masterGain);
    noiseSource.start();
    (window as unknown as { __pwMasterGain?: GainNode }).__pwMasterGain = masterGain;
    (window as unknown as { __pwAudioContext?: AudioContext }).__pwAudioContext = audioContext;
    button.setAttribute('aria-pressed', 'true');
    return;
  }
  // A further press toggles the master gain between 0 and 0.25.
  if (masterGain) {
    masterGain.gain.value = pressed ? 0 : 0.25;
  }
  button.setAttribute('aria-pressed', pressed ? 'false' : 'true');
}

