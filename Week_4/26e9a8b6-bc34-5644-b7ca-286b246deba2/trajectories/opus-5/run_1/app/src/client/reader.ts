import {
  forkCount as forkCountCopy,
  guideStatus,
  likeCount as likeCountCopy,
  questionAlerts,
  readingProgress,
  stageStatus,
  stepCounter,
  askStatus,
} from '../shared/copy.js';
import { CLOSING_TOTAL_FIELD, PHASE_FIELD } from '../shared/palette.js';
import {
  currentStepFromScroll,
  MOTION,
  poseFromScroll,
  settledScrollY,
  type Pose,
} from '../shared/scrollmap.js';
import type { GuideReading, Question, SessionUser } from '../shared/types.js';
import { call } from './api.js';
import { Callouts } from './callouts.js';
import {
  byLabel,
  dialogNamed,
  isDisabled,
  need,
  setDisabled,
  Status,
  trackBarHeights,
  trackViewportHeight,
} from './dom.js';
import { costFigure, wholeFigure } from './figures.js';
import { addFrameTask, cancelTween, prefersReducedMotion, tween, tweenRunning } from './motion.js';
import { LiveConnection, newClientId } from './live.js';
import { Stage, attachStageInput, webglAvailable, type StagePose } from './stage.js';
import { WorkshopSound } from './sound.js';

export interface ReaderBootstrap {
  guide: GuideReading;
  questions: Question[];
  step: number;
  settled: boolean;
  liked: boolean;
  soundHidden: boolean;
  viewer: SessionUser | null;
  storageOut: boolean;
}

const STEP_TWEEN = 'reader-step';

export function startReader(data: ReaderBootstrap, mode: 'reader' | 'embed'): void {
  trackViewportHeight();
  trackBarHeights();
  const reduced = prefersReducedMotion();
  if (reduced) document.documentElement.setAttribute('data-reduced', 'true');

  const guide = data.guide;
  const total = guide.step_count;
  const poses: Pose[] = guide.steps.map((step) => ({
    explode: step.explode,
    yaw: step.camera.yaw,
    pitch: step.camera.pitch,
  }));

  const stageElement = need<HTMLElement>('.stage');
  const stageStatusRegion = new Status('Stage status');
  const progress = new Status('Reading progress');
  const counter = new Status('Step counter');
  const guideStatusRegion = new Status('Guide status');
  const questionAlertsRegion = new Status('Question alerts');
  const likeCountRegion = new Status('Like count');
  const forkCountRegion = new Status('Fork count');

  const partsCost = costFigure(
    document.querySelector<HTMLElement>('[data-figure="parts-cost"]'),
    guide.currency,
    guide.steps[data.step - 1]?.parts_cost ?? 0,
  );
  const totalCost = costFigure(
    document.querySelector<HTMLElement>('[data-figure="total-cost"]'),
    guide.currency,
    data.settled ? guide.total_cost : 0,
  );
  const partCount = wholeFigure(
    document.querySelector<HTMLElement>('[data-figure="part-count"]'),
    data.settled ? guide.part_count : 0,
  );
  const stepCount = wholeFigure(
    document.querySelector<HTMLElement>('[data-figure="step-count"]'),
    data.settled ? guide.step_count : 0,
  );

  let currentStep = data.step;
  let manualOrbit = false;
  let freeLook = false;

  const stepOf = (n: number) => guide.steps[n - 1];

  /* ---- Stage ---- */
  const webgl = webglAvailable();
  let stage: Stage | null = null;
  let callouts: Callouts | null = null;

  if (!webgl) {
    showStill(currentStep);
  } else {
    const canvas = need<HTMLCanvasElement>('.stage-canvas', stageElement);
    stage = new Stage({ element: stageElement, canvas });
    callouts = new Callouts(need<HTMLElement>('.callout-layer', stageElement), stage, guide.parts);
    if (data.storageOut) {
      stage.setState('error');
      markOutage(true);
    } else {
      stageStatusRegion.say(stageStatus.loading);
      void loadModel(stage);
    }
    attachStageInput(stage, {
      onManualMove: () => {
        manualOrbit = true;
      },
      savedPose: () => savedPoseOf(currentStep),
      freeLookOn: () => freeLook,
    });
  }

  function markOutage(on: boolean): void {
    const element = byLabel<HTMLElement>('Stage status');
    if (element === null) return;
    element.setAttribute('data-outage', on ? 'true' : 'false');
    if (on) stageStatusRegion.say(stageStatus.storageOutReader);
  }

  async function loadModel(target: Stage): Promise<void> {
    if (guide.model_id === null) {
      stageStatusRegion.say(stageStatus.noModel);
      target.setState('ready');
      return;
    }
    try {
      await target.load(`/api/models/${guide.model_id}.glb`, guide.parts, 1);
      target.setState('ready');
      stageStatusRegion.say(stageStatus.ready);
      markOutage(false);
      applyStep(currentStep, true);
    } catch {
      target.setState('error');
      markOutage(true);
      window.setTimeout(() => void loadModel(target), MOTION.modelRetry);
    }
  }

  function savedPoseOf(n: number): StagePose {
    const step = stepOf(n);
    return {
      explode: step?.explode ?? 0,
      yaw: step?.camera.yaw ?? 0,
      pitch: step?.camera.pitch ?? 0,
      zoom: 1,
    };
  }

  /* ---- Still fallback ---- */
  function showStill(n: number): void {
    stageElement.setAttribute('data-state', 'still');
    stageElement.setAttribute('data-step', String(n));
    const existing = stageElement.querySelector<HTMLImageElement>('.stage-still');
    const image = existing ?? document.createElement('img');
    image.className = 'stage-still';
    image.src = `/api/guides/${guide.id}/stills/${n}`;
    image.alt = `${guide.title}, step ${n} still`;
    image.setAttribute('role', 'img');
    image.setAttribute('aria-label', `${guide.title}, step ${n} still`);
    if (existing === null) {
      stageElement.querySelector('.stage-canvas')?.remove();
      stageElement.prepend(image);
    }
    stageStatusRegion.say(stageStatus.stillFallback);
  }

  /* ---- Field colours around the stage ---- */
  function fieldFor(n: number) {
    const step = stepOf(n);
    return step === undefined ? CLOSING_TOTAL_FIELD : PHASE_FIELD[step.phase];
  }

  function updateFieldColours(): void {
    if (stage === null) return;
    const height = window.innerHeight;
    const nextStep = currentStep + 1;
    const edgeDocumentY = (nextStep + 0.65) * height;
    const edgeViewportY = edgeDocumentY - window.scrollY;
    const inView = edgeViewportY > 0 && edgeViewportY < height;
    const next = nextStep <= total ? fieldFor(nextStep) : CLOSING_TOTAL_FIELD;
    stage.setColours(fieldFor(currentStep), inView ? next : null, inView ? edgeViewportY : null);
  }

  /* ---- Step changes ---- */
  function panelFor(n: number): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-step-panel="${n}"]`);
  }

  function announceStep(n: number): void {
    const step = stepOf(n);
    if (step === undefined) return;
    counter.say(stepCounter(n, total));
    progress.say(readingProgress(n, total, step.title, step.parts_cost_text));
  }

  function updateStepButtons(n: number): void {
    const previous = byLabel<HTMLElement>('Previous step');
    const next = byLabel<HTMLElement>('Next step');
    if (previous !== null) setDisabled(previous, n <= 1);
    if (next !== null) setDisabled(next, n >= total);
  }

  function swapPanel(n: number): void {
    for (const panel of document.querySelectorAll<HTMLElement>('[data-step-panel]')) {
      panel.hidden = panel.getAttribute('data-step-panel') !== String(n);
    }
    const dialogAbout = document.querySelector<HTMLElement>('.asking-about');
    if (dialogAbout !== null) dialogAbout.textContent = `Asking about step ${n}`;
  }

  function updatePartsList(n: number): void {
    const list = document.querySelector<HTMLOListElement>('.parts-list');
    if (list === null) return;
    const byId = new Map(guide.parts.map((part) => [part.id, part]));
    list.replaceChildren(
      ...(stepOf(n)?.focus_parts ?? []).map((id) => {
        const item = document.createElement('li');
        item.textContent = byId.get(id)?.name ?? '';
        return item;
      }),
    );
  }

  /** On each change of current step the counter, announcement and cost change. */
  function setCurrentStep(n: number, immediate: boolean): void {
    const changed = n !== currentStep;
    currentStep = n;
    stageElement.setAttribute('data-step', String(n));
    announceStep(n);
    swapPanel(n);
    updatePartsList(n);
    updateStepButtons(n);
    live.reportStep(n);
    const cost = stepOf(n)?.parts_cost ?? 0;
    if (immediate || reduced) partsCost.setAtOnce(cost);
    else partsCost.countTo(cost, MOTION.partsCost);
    if (!webgl) {
      showStill(n);
      return;
    }
    if (changed) {
      callouts?.hide(immediate || reduced);
      callouts?.show(stepOf(n) ?? guide.steps[0]!, immediate || reduced);
    }
    stage?.setFocus(stepOf(n)?.focus_parts ?? []);
    updateFieldColours();
  }

  function applyStep(n: number, immediate: boolean): void {
    setCurrentStep(n, immediate);
    stage?.applyPose(savedPoseOf(n));
    stage?.setFocus(stepOf(n)?.focus_parts ?? []);
    if (callouts !== null) callouts.show(stepOf(n) ?? guide.steps[0]!, true);
  }

  /* ---- Scroll mapping ---- */
  function readScroll(): void {
    const height = window.innerHeight;
    const y = window.scrollY;
    const n = currentStepFromScroll(y, height, total);
    if (n !== currentStep) {
      manualOrbit = false;
      setCurrentStep(n, false);
      replaceAddress(n);
    }
    if (!manualOrbit && stage !== null) {
      const pose = poseFromScroll(y, height, poses);
      stage.applyPose({ ...pose, zoom: 1 });
    }
    updateFieldColours();
  }

  if (!reduced && mode === 'reader') {
    window.addEventListener(
      'scroll',
      () => {
        if (tweenRunning(STEP_TWEEN)) cancelTween(STEP_TWEEN);
        readScroll();
      },
      { passive: true },
    );
  }

  /* ---- Address ---- */
  function replaceAddress(n: number): void {
    if (mode === 'embed') return;
    const url = new URL(window.location.href);
    url.searchParams.set('step', String(n));
    window.history.replaceState({ step: n }, '', url.toString());
  }

  function pushAddress(n: number): void {
    if (mode === 'embed') return;
    const url = new URL(window.location.href);
    url.searchParams.set('step', String(n));
    window.history.pushState({ step: n }, '', url.toString());
  }

  window.addEventListener('popstate', (event: PopStateEvent) => {
    const state = event.state as { step?: number } | null;
    const asked = state?.step ?? Number(new URL(window.location.href).searchParams.get('step') ?? '1');
    goToStep(Number.isFinite(asked) ? asked : 1, false, false);
  });

  /** Jumps the window straight to the step's settled position. */
  function goToStep(n: number, pushHistory: boolean, playTween: boolean): void {
    const target = Math.min(Math.max(n, 1), total);
    if (pushHistory) pushAddress(target);
    else replaceAddress(target);
    if (reduced || mode === 'embed') {
      setCurrentStep(target, true);
      stage?.applyPose(savedPoseOf(target));
      return;
    }
    const from = stage?.currentPose ?? savedPoseOf(currentStep);
    window.scrollTo({ top: settledScrollY(target, window.innerHeight), behavior: 'instant' });
    setCurrentStep(target, !playTween);
    if (!playTween) {
      stage?.applyPose(savedPoseOf(target));
      return;
    }
    const to = savedPoseOf(target);
    tween(STEP_TWEEN, {
      duration: MOTION.stepChange,
      apply: (fraction) => {
        stage?.applyPose({
          explode: from.explode + (to.explode - from.explode) * fraction,
          yaw: from.yaw + (to.yaw - from.yaw) * fraction,
          pitch: from.pitch + (to.pitch - from.pitch) * fraction,
          zoom: 1,
        });
      },
    });
  }

  for (const button of document.querySelectorAll<HTMLElement>('[data-move]')) {
    button.addEventListener('click', () => {
      if (isDisabled(button)) return;
      goToStep(currentStep + Number(button.getAttribute('data-move')), true, true);
    });
  }

  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-step-link]')) {
    link.addEventListener('click', (event: MouseEvent) => {
      event.preventDefault();
      goToStep(Number(link.getAttribute('data-step-link')), true, true);
    });
  }

  /* ---- Free look ---- */
  const freeLookSwitch = byLabel<HTMLElement>('Free look');
  freeLookSwitch?.addEventListener('click', () => {
    freeLook = !freeLook;
    freeLookSwitch.setAttribute('aria-checked', freeLook ? 'true' : 'false');
    stageElement.setAttribute('data-free-look', freeLook ? 'true' : 'false');
  });

  /* ---- Sound ---- */
  const sound = new WorkshopSound();
  const soundButton = byLabel<HTMLElement>('Workshop sound');
  soundButton?.addEventListener('click', () => {
    soundButton.setAttribute('aria-pressed', sound.press() ? 'true' : 'false');
  });

  /* ---- Reader bar actions ---- */
  const signedIn = data.viewer !== null;
  const confirmed = data.viewer?.confirmed === true;

  function requireSession(): boolean {
    if (signedIn) return true;
    const here = `${window.location.pathname}?step=${currentStep}`;
    window.location.href = `/signin?next=${encodeURIComponent(here)}`;
    return false;
  }

  function refuseUnconfirmed(): boolean {
    if (confirmed) return false;
    guideStatusRegion.sayAndClear(guideStatus.unconfirmed);
    return true;
  }

  let liked = data.liked;
  const likeButton = byLabel<HTMLElement>('Like');
  likeButton?.addEventListener('click', () => {
    if (!requireSession() || refuseUnconfirmed()) return;
    void (async () => {
      const reply = await call<{ liked: boolean; like_count: number }>(
        liked ? 'DELETE' : 'PUT',
        `/api/guides/${guide.id}/like`,
        liked ? undefined : {},
      );
      if (reply.status !== 200) {
        guideStatusRegion.sayAndClear(guideStatus.failure);
        return;
      }
      liked = reply.body.liked;
      likeButton.setAttribute('aria-pressed', liked ? 'true' : 'false');
      likeCountRegion.say(likeCountCopy(reply.body.like_count));
      guideStatusRegion.sayAndClear(liked ? guideStatus.liked : guideStatus.likeRemoved);
    })();
  });

  const forkDialog = dialogNamed('Fork guide');
  const forkDialogElement = forkDialog?.element ?? null;
  const forkButton = document.querySelector<HTMLElement>('.reader-bar [aria-label="Fork guide"]');
  forkButton?.addEventListener('click', () => {
    if (!requireSession() || refuseUnconfirmed()) return;
    forkDialog?.open(forkButton);
  });
  forkDialogElement?.querySelector<HTMLElement>('[data-action="confirm-fork"]')?.addEventListener(
    'click',
    () => {
      guideStatusRegion.say(guideStatus.forking);
      void (async () => {
        const reply = await call<{ slug: string }>('POST', `/api/guides/${guide.id}/forks`, {});
        if (reply.status !== 201) {
          guideStatusRegion.sayAndClear(guideStatus.failure);
          return;
        }
        window.location.href = `/edit/${reply.body.slug}`;
      })();
    },
  );

  const askDialog = dialogNamed('Ask the author');
  const askDialogElement = askDialog?.element ?? null;
  const askButton = document.querySelector<HTMLElement>('.reader-bar [aria-label="Ask the author"]');
  const askStatusRegion = new Status('Ask status');
  askButton?.addEventListener('click', () => {
    if (!requireSession() || refuseUnconfirmed()) return;
    askDialog?.open(askButton);
  });
  askDialogElement?.querySelector<HTMLElement>('[data-action="send-question"]')?.addEventListener(
    'click',
    () => {
      const field = byLabel<HTMLTextAreaElement>('Your question', askDialogElement);
      const text = field?.value ?? '';
      if (text.trim().length === 0) {
        askStatusRegion.say(askStatus.empty);
        return;
      }
      askStatusRegion.say(askStatus.sending);
      void (async () => {
        const reply = await call<{ error?: string; limit?: number }>(
          'POST',
          `/api/guides/${guide.id}/questions`,
          { step: currentStep, text },
        );
        if (reply.status === 201) {
          askDialog?.close();
          if (field !== null) field.value = '';
          askStatusRegion.clear();
          guideStatusRegion.sayAndClear(guideStatus.questionSent);
          return;
        }
        if (reply.status === 429) askStatusRegion.say(askStatus.rateLimited(reply.retryAfter));
        else if (reply.body.error === 'too_long') {
          askStatusRegion.say(askStatus.overLimit(reply.body.limit ?? 0));
        } else askStatusRegion.say(askStatus.empty);
      })();
    },
  );

  const collectionDialog = dialogNamed('Add to collection');
  const collectionButton = document.querySelector<HTMLElement>(
    '.reader-bar [aria-label="Add to collection"]',
  );
  collectionButton?.addEventListener('click', () => {
    if (!requireSession() || refuseUnconfirmed()) return;
    collectionDialog?.open(collectionButton);
  });

  document.querySelector<HTMLElement>('.resend-confirmation')?.addEventListener('click', () => {
    void (async () => {
      const reply = await call<{ error?: string }>('POST', '/api/account/resend', {});
      if (reply.status === 200) {
        guideStatusRegion.sayAndClear(guideStatus.resendSent(data.viewer?.email ?? ''));
      } else if (reply.status === 429) {
        guideStatusRegion.sayAndClear(guideStatus.resendLimited(reply.retryAfter));
      } else {
        guideStatusRegion.sayAndClear(guideStatus.failure);
      }
    })();
  });

  /* ---- Live changes ---- */
  const live = new LiveConnection(guide.id, newClientId());
  live.on((event) => {
    if (event['guide'] !== guide.id) return;
    if (event.kind === 'like') {
      likeCountRegion.say(likeCountCopy(Number(event['like_count'])));
    } else if (event.kind === 'fork') {
      forkCountRegion.say(forkCountCopy(Number(event['fork_count'])));
    } else if (event.kind === 'question') {
      const question = event['question'] as Question;
      addQuestionRow(question);
    } else if (event.kind === 'answer') {
      const question = event['question'] as Question;
      addQuestionRow(question);
      questionAlertsRegion.say(
        questionAlerts.toAsker(String(event['author_name']), Number(event['step'])),
      );
    }
  });
  live.start();
  live.reportStep(currentStep);

  function addQuestionRow(question: Question): void {
    const panel = panelFor(question.step);
    const list = panel?.querySelector<HTMLUListElement>('.questions');
    if (list === null || list === undefined) return;
    const existing = list.querySelector<HTMLLIElement>(`[data-question="${question.id}"]`);
    const item = existing ?? document.createElement('li');
    item.setAttribute('data-question', question.id);
    const text = document.createElement('p');
    text.className = 'question-text';
    text.textContent = question.text;
    item.replaceChildren(text);
    if (question.answer !== null) {
      const answer = document.createElement('p');
      answer.className = 'answer-text';
      answer.textContent = question.answer.text;
      item.append(answer);
    }
    if (existing === null) list.append(item);
  }

  /* ---- First paint ---- */
  updateStepButtons(currentStep);
  swapPanel(currentStep);
  updatePartsList(currentStep);
  announceStep(currentStep);

  if (data.settled || reduced || mode === 'embed') {
    totalCost.setAtOnce(guide.total_cost);
    partCount.setAtOnce(guide.part_count);
    stepCount.setAtOnce(guide.step_count);
    partsCost.setAtOnce(stepOf(currentStep)?.parts_cost ?? 0);
  } else {
    totalCost.countTo(guide.total_cost, MOTION.headerFigures);
    partCount.countTo(guide.part_count, MOTION.headerFigures);
    stepCount.countTo(guide.step_count, MOTION.headerFigures);
  }

  if (!reduced && mode === 'reader') {
    window.scrollTo({
      top: data.settled ? settledScrollY(currentStep, window.innerHeight) : 0,
      behavior: 'instant',
    });
    addFrameTask(() => {
      readScroll();
      return false;
    });
  }
  updateFieldColours();
}
