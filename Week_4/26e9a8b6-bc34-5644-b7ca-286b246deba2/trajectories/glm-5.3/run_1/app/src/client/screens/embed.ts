// Embed `/embed/<slug>`: read-only, session-free, one step at a time.

import { el } from '../dom';
import { api } from '../api';
import { COPY } from '../../shared/copy';
import type { GuideReadingJson } from './reader';
import { scrollMapping, settledScroll } from './reader';
import { Stage } from '../stage';
import { reducedMotion } from '../clock';
import { toggleSound } from './reader';

export function renderEmbed(main: HTMLElement, slug: string): void {
  main.textContent = '';
  api<GuideReadingJson>(`/api/guides/${slug}`).then((guide) => {
    buildEmbed(main, guide);
  }).catch((error) => {
    const err = error as { status?: number };
    const band = el('div', { class: 'error-band' });
    if (err.status === 410) {
      band.append(el('h1', { class: 'display' }, COPY.fixed.withdrawn));
    } else {
      band.append(el('h1', { class: 'display' }, COPY.fixed.notFound));
    }
    band.append(el('a', { class: 'pw-btn', href: '/' }, 'Pennywasher'));
    main.append(band);
  });
}

function buildEmbed(main: HTMLElement, guide: GuideReadingJson): void {
  const total = guide.steps.length;
  const params = new URLSearchParams(window.location.search);
  const deepStep = Number.parseInt(params.get('step') ?? '1', 10) || 1;
  const startStep = Math.min(Math.max(1, deepStep), total);
  const reduce = reducedMotion();

  const stageRoot = el('div', { class: 'stage-root', role: 'application', 'aria-label': 'Model stage', tabindex: '0' });
  const stageStatus = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'stage' }, COPY.stage.loading);
  const stepCounter = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'step-counter' }, COPY.stepCounter(startStep, total));
  const readingProgress = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'reading-progress' });
  const partsCost = el('div', { 'data-figure': 'parts-cost', 'aria-hidden': 'true' }, guide.steps[startStep - 1].parts_cost_text);

  const stage = new Stage(stageRoot);
  const hasWebGL = Stage.hasWebGL();
  if (hasWebGL) {
    stage.attach();
    if (guide.model_id) {
      void stage.loadModelUrl(`/api/models/${guide.model_id}.glb`).then((result) => {
        stageStatus.textContent = result.ok ? COPY.stage.ready : COPY.stage.storageOutReader;
        if (!result.ok) stage.setState('error');
        stage.setParts(guide.parts, 1);
      });
    }
  } else {
    stageRoot.setAttribute('data-state', 'still');
    const img = el('img', { alt: `${guide.title}, step ${startStep} still`, src: `/api/guides/${guide.id}/stills/${startStep}` });
    stageRoot.append(img);
    stageStatus.textContent = COPY.stage.stillFallback;
  }
  stage.setParts(guide.parts, 1);

  const wrap = el('div', { class: 'embed-wrap' });
  const stageColumn = el('div', { class: 'reader__stage-column' });
  stageColumn.append(stageRoot, stageStatus, stepCounter, partsCost);
  const panel = el('div', { class: 'reader__panel' });
  const panelHeading = el('h2', {});
  const panelText = el('p', {});
  panel.append(panelHeading, panelText);

  const open = el('a', { class: 'pw-btn', href: `/g/${guide.slug}?step=${startStep}` }, 'Open on Pennywasher');
  const sound = el('button', { class: 'pw-btn', 'aria-pressed': 'false' }, 'Workshop sound');
  if (params.get('sound') !== 'off') {
    sound.addEventListener('click', () => toggleSound(sound));
  } else {
    sound.remove();
  }
  const previous = el('button', { class: 'pw-btn' }, 'Previous step');
  const next = el('button', { class: 'pw-btn' }, 'Next step');

  const bar = el('div', { class: 'reader-bar' });
  bar.append(previous, next, open);
  if (params.get('sound') !== 'off') bar.append(sound);
  wrap.append(stageColumn, panel, bar);
  main.append(wrap);
  main.append(readingProgress);

  let currentStep = startStep;
  const applyStep = (stepNumber: number): void => {
    const step = guide.steps[stepNumber - 1];
    if (!step) return;
    currentStep = stepNumber;
    stage.setStep(stepNumber);
    stage.setFocusParts(step.focus_parts);
    if (hasWebGL) stage.setPose(step.camera);
    stage.setExplode(step.explode);
    panelHeading.textContent = step.title;
    panelText.textContent = step.text;
    stepCounter.textContent = COPY.stepCounter(stepNumber, total);
    readingProgress.textContent = COPY.readingProgress(stepNumber, total, step.title, step.parts_cost_text);
    partsCost.textContent = step.parts_cost_text;
    open.setAttribute('href', `/g/${guide.slug}?step=${stepNumber}`);
    window.history.replaceState(null, '', `?step=${stepNumber}`);
  };
  applyStep(startStep);

  previous.addEventListener('click', () => {
    if (currentStep === 1) return;
    window.history.pushState(null, '', `?step=${currentStep - 1}`);
    applyStep(currentStep - 1);
  });
  next.addEventListener('click', () => {
    if (currentStep === total) return;
    window.history.pushState(null, '', `?step=${currentStep + 1}`);
    applyStep(currentStep + 1);
  });
  void reduce;
  void scrollMapping;
  void settledScroll;
}
