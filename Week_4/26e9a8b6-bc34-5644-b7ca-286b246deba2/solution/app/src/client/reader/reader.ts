import { forkCount, likeCount, pageText, questionAlert, stageStatus } from '../../shared/copy';
import { partLabels } from '../../shared/part-label';
import { BAND_END, BAND_START, fieldColours, fieldIndexAt, focusStepAt, poseAt, settledY, stepAt, zoomAt, type StepPose } from '../../shared/pose';
import type { GuideReading, LiveEvent, Phase, Question, User } from '../../shared/types';
import { get } from '../api';
import { h, reducedMotion, scrollsByKeyboard } from '../dom';
import { easeOut, register, wake } from '../frame-loop';
import { Figure, costFormat, countFormat } from '../figures';
import { icon } from '../icons';
import { Live } from '../live';
import { soundButton } from '../sound';
import { Status } from '../status';
import { CalloutLayer } from '../stage/callouts';
import { loadGuideModel } from '../stage/guide-model';
import { Stage } from '../stage/stage';
import { askDialog, collectionDialog, forkDialog, resendConfirmation, toggleLike, type ActionContext } from './actions';
import { Panel } from './panel';

export type ReadingGuide = GuideReading & { fork_source_slug: string | null };

const TWEEN_MS = 320;
const COUNT_MS = 640;
const HEADER_COUNT_MS = 800;
const PHASES = fieldColours;

export class Reader {
  readonly root: HTMLElement;
  private readonly steps;
  private readonly total: number;
  private readonly poses: StepPose[];
  private readonly zooms;
  private readonly embed: boolean;
  private readonly labels: Map<string, string>;
  private readonly stage = new Stage((state) => this.onStageState(state));
  private readonly callouts = new CalloutLayer(this.stage);
  private readonly panel: Panel;
  private readonly stageStatus = new Status('Stage status', 'stage-status');
  private readonly guideStatus = new Status('Guide status', 'guide-status');
  private readonly collectionStatus = new Status('Collection status', 'sr-only');
  private readonly alerts = new Status('Question alerts', 'guide-status');
  private readonly likeCountStatus = new Status('Like count');
  private readonly forkCountStatus = new Status('Fork count');
  private readonly edge = h('div', { class: 'field-edge', 'aria-hidden': 'true' });
  private readonly likeButton = h('button', { type: 'button', class: 'bar-button', 'aria-label': 'Like', 'aria-pressed': 'false' }, icon('heart'));
  private readonly prev = h('button', { type: 'button', class: 'bar-button', 'aria-label': 'Previous step' }, icon('arrow_left'));
  private readonly next = h('button', { type: 'button', class: 'bar-button', 'aria-label': 'Next step' }, icon('arrow_right'));
  private readonly resend = h('button', { type: 'button', class: 'button', hidden: true }, 'Resend confirmation');
  private readonly freeLook = h('button', { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Free look', class: 'free-look' }, 'Free look');
  private readonly stillImage = h('img', { class: 'still', alt: '' });
  private readonly spacer = h('div', { class: 'scroll-space', 'aria-hidden': 'true' });
  private readonly bar = h('nav', { class: 'bar' });
  private header!: HTMLElement;
  private closing!: HTMLElement;
  private totalFigures: Figure[] = [];
  private current = 1;
  private focusStep = 1;
  private shownCalloutStep = 0;
  private y = 0;
  private height = innerHeight;
  private tween: { from: StepPose; fromZoom: number; start: number } | null = null;
  private programmaticY: number | null = null;
  private questions: Question[] = [];
  private modelRequested = false;

  constructor(private readonly guide: ReadingGuide, private user: User | null, mode: 'reader' | 'embed') {
    this.embed = mode === 'embed';
    this.steps = guide.steps;
    this.total = guide.steps.length;
    this.poses = this.steps.map((s) => ({ explode: s.explode, yaw: s.camera.yaw, pitch: s.camera.pitch }));
    this.zooms = this.steps.map((s) => s.camera);
    this.labels = partLabels(guide.parts);
    this.panel = new Panel(this.steps, guide.currency, (n) => this.goToStep(n, true), (n) => `?step=${n}`);
    this.root = h('div', { class: `reader ${this.embed ? 'is-embed' : ''}`.trim() });
    this.build();
  }

  /** Attaches the reader to the page, then starts it: layout must exist before the window can jump to a step. */
  mount(parent: HTMLElement): void {
    parent.append(this.root);
    const asked = new URLSearchParams(location.search).get('step');
    this.start(asked === null ? null : Number(asked));
    this.bind();
  }

  private context(): ActionContext {
    return {
      guide: this.guide, user: this.user, currentStep: () => this.current, guideStatus: this.guideStatus, collectionStatus: this.collectionStatus,
      resend: this.resend, onAsked: (q) => this.addQuestion(q), setLiked: (liked) => this.likeButton.setAttribute('aria-pressed', String(liked)),
    };
  }

  private build(): void {
    const slug = this.guide.slug;
    const bar = this.bar;
    bar.setAttribute('aria-label', this.embed ? 'Guide controls' : 'Reader bar');
    if (this.embed) {
      bar.append(h('a', { class: 'open-link', href: `/g/${slug}`, id: 'open-link' }, 'Open on Pennywasher'));
    } else {
      bar.append(
        h('a', { class: 'wordmark bar-wordmark', href: '/' }, 'Pennywasher'), this.likeButton,
        h('button', { type: 'button', class: 'bar-button', 'aria-label': 'Fork guide', onclick: () => forkDialog(this.context()) }, icon('git_fork')),
        h('button', { type: 'button', class: 'bar-button', 'aria-label': 'Add to collection', onclick: () => void collectionDialog(this.context()) }, icon('folder_plus')),
        h('button', { type: 'button', class: 'bar-button', 'aria-label': 'Ask the author', onclick: () => void askDialog(this.context()) }, icon('message_circle')),
      );
      this.likeButton.addEventListener('click', () => void toggleLike(this.context(), this.likeButton));
      this.likeButton.setAttribute('aria-pressed', String(this.guide.liked));
    }
    if (new URLSearchParams(location.search).get('sound') !== 'off') bar.append(soundButton());
    bar.append(this.prev, this.next);
    this.prev.addEventListener('click', () => this.stepBy(-1));
    this.next.addEventListener('click', () => this.stepBy(1));

    const stageWrap = h('div', { class: 'stage-wrap' }, this.stage.element, this.callouts.element, this.freeLook);
    this.stage.element.append(this.stillImage);
    this.stillImage.hidden = true;
    this.freeLook.addEventListener('click', () => {
      const on = this.freeLook.getAttribute('aria-checked') !== 'true';
      this.freeLook.setAttribute('aria-checked', String(on));
      this.stage.freeLook = on;
      this.stage.element.classList.toggle('free-look-on', on);
    });
    const panelWrap = h('div', { class: 'panel-wrap' },
      this.stageStatus.element, this.panel.parts,
      h('div', { class: 'status-strip' }, this.guideStatus.element, this.alerts.element, this.collectionStatus.element, this.resend),
      this.panel.element);
    this.resend.addEventListener('click', () => void resendConfirmation(this.context()));
    this.root.append(this.edge, bar, stageWrap, panelWrap);
    if (!this.embed) {
      this.header = this.buildHeader();
      this.closing = this.buildClosing();
      this.closing.style.top = `calc(var(--H) * ${this.total + 1})`;
      this.root.append(this.spacer, this.header, this.closing);
    }
  }

  private buildHeader(): HTMLElement {
    const guide = this.guide;
    const figure = (label: string, name: string, format: (v: number) => string, value: number) => {
      const span = h('span', { class: 'figure-value' });
      const fig = new Figure(span, format, name);
      this.totalFigures.push(fig);
      fig.set(0);
      span.dataset.final = format(value);
      return h('div', { class: 'figure' }, h('span', { class: 'figure-label' }, label), span);
    };
    const credit = guide.forked_from
      ? h('p', { class: 'credit' },
          ...(guide.fork_source_slug
            ? ['Forked from ', h('a', { href: `/g/${guide.fork_source_slug}` }, guide.forked_from.title), ` by ${guide.forked_from.author_name}, version ${guide.forked_from.version}.`]
            : [pageText.forkCredit(guide.forked_from.title, guide.forked_from.author_name, guide.forked_from.version)]))
      : null;
    this.likeCountStatus.set(likeCount(guide.like_count));
    this.forkCountStatus.set(forkCount(guide.fork_count));
    return h('section', { class: 'guide-header', 'data-phase': this.steps[0]!.phase },
      scrollsByKeyboard(h('div', { class: 'header-block' },
        h('h1', { class: 'guide-title' }, guide.title),
        h('p', { class: 'author' }, `By ${guide.author.name}`),
        h('ul', { class: 'tags' }, ...guide.tags.map((tag) => h('li', {}, tag))),
        h('div', { class: 'counts' }, this.likeCountStatus.element, this.forkCountStatus.element),
        credit,
        h('div', { class: 'figures' },
          figure('Total', 'total-cost', costFormat(guide.currency), guide.total_cost),
          figure('Parts', 'part-count', countFormat, guide.part_count),
          figure('Steps', 'step-count', countFormat, guide.step_count)))));
  }

  private buildClosing(): HTMLElement {
    const span = h('span', { class: 'closing-value' });
    new Figure(span, costFormat(this.guide.currency), 'closing-total', this.guide.total_cost);
    return h('section', { class: 'guide-closing' },
      h('div', { class: 'closing-block' }, h('h2', { class: 'closing-heading' }, 'Closing total'), span, h('p', { class: 'closing-note' }, `${this.guide.title}`)));
  }

  private start(requested: number | null): void {
    this.height = innerHeight;
    this.root.style.setProperty('--H', `${this.height}px`);
    this.spacer.style.height = `${this.height * (this.total + 2)}px`;
    let step = 1;
    if (requested !== null && Number.isInteger(requested) && requested >= 1) {
      step = Math.min(this.total, requested);
      if (requested > this.total) this.panel.notice.textContent = pageText.pastTheEnd(this.total);
    }
    history.scrollRestoration = 'manual';
    new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${this.bar.offsetHeight}px`)).observe(this.bar);
    this.current = step;
    this.focusStep = step;
    this.panel.show(step, this.partLabelsOf(step));
    this.panel.cost.set(this.steps[step - 1]!.parts_cost);
    this.stage.setStep(step);
    this.applySettledPose(step);
    if (requested !== null) {
      this.scrollTo(settledY(step, this.height));
      if (requested > this.total) history.replaceState(null, '', `?step=${step}`);
    }
    this.syncChrome();
    const animateHeader = requested === null && !reducedMotion() && !this.embed;
    for (const fig of this.totalFigures) {
      const final = fig.element.dataset.figure === 'total-cost' ? this.guide.total_cost : fig.element.dataset.figure === 'part-count' ? this.guide.part_count : this.guide.step_count;
      if (animateHeader) fig.countTo(final, HEADER_COUNT_MS);
      else fig.set(final);
    }
    this.showCallouts(true);
    this.loadQuestions();
    register((now) => this.frame(now));
    if (!this.stage.webgl) this.showStill(step);
    else void this.loadModel();
  }

  private bind(): void {
    addEventListener('scroll', () => this.onScroll(), { passive: true });
    addEventListener('resize', () => {
      this.height = innerHeight;
      this.root.style.setProperty('--H', `${this.height}px`);
      this.spacer.style.height = `${this.height * (this.total + 2)}px`;
      this.syncChrome();
      wake();
    });
    addEventListener('popstate', () => {
      const asked = Number(new URLSearchParams(location.search).get('step'));
      if (Number.isInteger(asked) && asked >= 1) this.goToStep(Math.min(this.total, asked), false);
    });
    this.stage.onViewChange = () => wake();
    if (!this.embed)
      new Live({
        guideId: this.guide.id,
        catchUp: () => void this.refresh(),
        onEvent: (event) => this.onLive(event),
      });
  }

  private partLabelsOf(step: number): string[] {
    return this.steps[step - 1]!.focus_parts.map((id) => this.labels.get(id) ?? '');
  }

  private applySettledPose(step: number): void {
    const pose = this.poses[step - 1]!;
    this.stage.setPose({ ...pose, zoom: this.zooms[step - 1]!.zoom });
    this.stage.setFocus(this.steps[step - 1]!.focus_parts);
  }

  private scrollTo(y: number): void {
    this.programmaticY = y;
    scrollTo({ top: y, behavior: 'instant' });
  }

  private onScroll(): void {
    if (reducedMotion()) return;
    const y = scrollY;
    if (this.programmaticY !== null && Math.abs(y - this.programmaticY) <= 1) {
      this.programmaticY = null;
      this.y = y;
      return;
    }
    this.programmaticY = null;
    this.tween = null;
    this.y = y;
    const step = stepAt(y, this.height, this.total);
    if (step !== this.current) {
      this.stage.clearManual();
      this.enterStep(step, 'scroll');
    } else if (this.stage.hasManual() && y / this.height - step > BAND_START + 1e-6 && y / this.height - step < BAND_END - 1e-6) this.stage.clearManual();
    wake();
  }

  private stepBy(delta: number): void {
    const target = this.current + delta;
    if (target < 1 || target > this.total) return;
    this.goToStep(target, true);
  }

  /** Buttons, links, keys and Back jump the window to the step's settled position and play the step-change tween. */
  goToStep(n: number, push: boolean): void {
    if (n === this.current && !push) return;
    const from = this.displayedPose();
    if (push && n !== this.current) history.pushState(null, '', `?step=${n}`);
    this.stage.clearManual();
    const animated = !reducedMotion();
    this.enterStep(n, 'jump');
    this.y = settledY(n, this.height);
    this.scrollTo(this.y);
    if (animated) this.tween = { from: from.pose, fromZoom: from.zoom, start: performance.now() };
    this.syncChrome();
    wake();
  }

  private displayedPose(): { pose: StepPose; zoom: number } {
    if (reducedMotion()) return { pose: this.poses[this.current - 1]!, zoom: this.zooms[this.current - 1]!.zoom };
    return { pose: poseAt(this.y, this.height, this.poses), zoom: zoomAt(this.y, this.height, this.zooms) };
  }

  private enterStep(n: number, via: 'scroll' | 'jump'): void {
    const step = this.steps[n - 1]!;
    this.current = n;
    this.stage.setStep(n);
    this.panel.notice.textContent = '';
    this.panel.show(n, this.partLabelsOf(n));
    this.panel.cost.countTo(step.parts_cost, COUNT_MS);
    this.callouts.show([], reducedMotion());
    if (via === 'scroll') history.replaceState(null, '', `?step=${n}`);
    this.syncChrome();
    if (this.stage.state() === 'still') this.showStill(n);
  }

  private syncChrome(): void {
    this.prev.setAttribute('aria-disabled', String(this.current === 1));
    this.next.setAttribute('aria-disabled', String(this.current === this.total));
    const open = document.getElementById('open-link');
    if (open) open.setAttribute('href', `/g/${this.guide.slug}?step=${this.current}`);
  }

  private onStageState(state: string): void {
    this.root.dataset.stage = state;
  }

  /** Per-frame work: pose from scroll or tween, focus swap, callouts, field edge and ink. */
  private frame(now: number): boolean {
    this.y = reducedMotion() ? this.y : scrollY;
    let busy = false;
    let pose: StepPose;
    let zoom: number;
    let focus: number;
    if (this.tween && !reducedMotion()) {
      const t = Math.min(1, (now - this.tween.start) / TWEEN_MS);
      const target = this.poses[this.current - 1]!;
      const e = easeOut(t);
      const from = this.tween.from;
      pose = { explode: from.explode + (target.explode - from.explode) * e, yaw: from.yaw + (target.yaw - from.yaw) * e, pitch: from.pitch + (target.pitch - from.pitch) * e };
      zoom = this.tween.fromZoom + (this.zooms[this.current - 1]!.zoom - this.tween.fromZoom) * e;
      focus = t >= 1 ? this.current : this.focusStep;
      if (t >= 1) this.tween = null;
      else busy = true;
    } else if (reducedMotion() || this.embed) {
      pose = this.poses[this.current - 1]!;
      zoom = this.zooms[this.current - 1]!.zoom;
      focus = this.current;
    } else {
      pose = poseAt(this.y, this.height, this.poses);
      zoom = zoomAt(this.y, this.height, this.zooms);
      focus = focusStepAt(this.y, this.height, this.total);
    }
    this.stage.setPose({ ...pose, zoom });
    if (focus !== this.focusStep) {
      this.focusStep = focus;
      this.stage.setFocus(this.steps[focus - 1]!.focus_parts);
    }
    this.showCallouts(false);
    this.paintFields();
    return busy;
  }

  private showCallouts(initial: boolean): void {
    const settled = this.focusStep === this.current && !this.tween;
    const phone = matchMedia('(max-width: 767px)').matches;
    const want = settled && !phone && this.stage.state() !== 'still' ? this.current : 0;
    if (want === this.shownCalloutStep) return;
    this.shownCalloutStep = want;
    if (want === 0) return void this.callouts.show([], reducedMotion() || initial);
    const step = this.steps[want - 1]!;
    this.callouts.show(step.callouts.filter((c) => step.focus_parts.includes(c.part_id) && c.text !== '').map((c) => ({ partId: c.part_id, label: this.labels.get(c.part_id) ?? c.text, text: c.text })), reducedMotion() || initial);
  }

  /** The flat fields: the field at the top of the window, the next one entering from below with a hard edge, and the ink to match. */
  private paintFields(): void {
    let top: Phase | 'closing';
    let bottom: Phase | 'closing' | null = null;
    let edge = -1;
    if (reducedMotion() || this.embed) {
      top = this.steps[this.current - 1]!.phase;
    } else {
      const k = fieldIndexAt(this.y, this.height, this.total);
      top = this.steps[k - 1]!.phase;
      const change = this.steps.findIndex((s, i) => i >= k && s.phase !== top);
      if (change >= 0 && settledY(change + 1, this.height) - this.y < this.height) {
        bottom = this.steps[change]!.phase;
        edge = settledY(change + 1, this.height) - this.y;
      }
      const lastSettled = settledY(this.total, this.height);
      const closeStart = (this.total + 1) * this.height;
      if (change < 0 && this.y > lastSettled) {
        const progress = Math.min(1, (this.y - lastSettled) / (closeStart - lastSettled));
        bottom = 'closing';
        edge = this.height * (1 - progress);
      }
    }
    document.body.style.backgroundColor = PHASES[top].field;
    document.documentElement.style.backgroundColor = PHASES[top].field;
    this.edge.hidden = bottom === null;
    if (bottom !== null) {
      this.edge.style.top = `${edge}px`;
      this.edge.style.backgroundColor = PHASES[bottom].field;
    }
    this.root.dataset.phase = top;
    this.stage.setInk({ above: PHASES[top].text, below: PHASES[bottom ?? top].text, edge: bottom === null ? -1 : edge });
  }

  private showStill(n: number): void {
    this.stage.setState('still');
    this.stageStatus.set(stageStatus.still);
    this.stillImage.hidden = false;
    this.stillImage.alt = `${this.guide.title}, step ${n} still`;
    this.stillImage.src = `/api/guides/${this.guide.id}/stills/${n}`;
  }

  private async loadModel(): Promise<void> {
    if (this.modelRequested || !this.guide.model_id) return;
    this.modelRequested = true;
    this.stage.setState('loading');
    this.stageStatus.set(stageStatus.loading);
    try {
      await loadGuideModel(this.stage, this.guide);
      this.stage.setState('ready');
      this.stageStatus.set(stageStatus.ready);
      this.root.classList.remove('storage-out');
      this.shownCalloutStep = 0;
      this.showCallouts(false);
      wake();
    } catch {
      this.modelRequested = false;
      this.stage.setState('error');
      this.stageStatus.set(stageStatus.storageOutReader, 'error');
      this.root.classList.add('storage-out');
      window.setTimeout(() => void this.loadModel(), 5000);
    }
  }

  private async loadQuestions(): Promise<void> {
    if (this.embed) return;
    const found = await get<{ items: Question[] }>(`/api/guides/${this.guide.id}/questions?limit=100`).catch(() => ({ items: [] as Question[] }));
    this.questions = found.items;
    this.panel.setQuestions(this.questions);
  }

  private addQuestion(question: Question): void {
    if (this.questions.some((q) => q.id === question.id)) return;
    this.questions = [question, ...this.questions];
    this.panel.setQuestions(this.questions);
  }

  private async refresh(): Promise<void> {
    await this.loadQuestions();
    const guide = await get<GuideReading>(`/api/guides/${this.guide.id}`).catch(() => null);
    if (!guide) return;
    this.likeCountStatus.set(likeCount(guide.like_count));
    this.forkCountStatus.set(forkCount(guide.fork_count));
  }

  private onLive(event: LiveEvent): void {
    if (event.type === 'counts') {
      this.likeCountStatus.set(likeCount(event.like_count));
      this.forkCountStatus.set(forkCount(event.fork_count));
    } else if (event.type === 'question') this.addQuestion(event.question);
    else if (event.type === 'answer') {
      this.questions = this.questions.map((q) => (q.id === event.question.id ? event.question : q));
      this.panel.setQuestions(this.questions);
    } else if (event.type === 'alert_question') this.alerts.set(questionAlert.toAuthor(event.guide_title, event.step));
    else if (event.type === 'alert_answer') this.alerts.set(questionAlert.toAsker(event.author_name, event.step));
  }
}

