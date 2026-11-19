// Editor `/edit/<slug>`: the authoring surface with keyboard-first control.

import { el, announce, announceExpiring, codePoints } from '../dom';
import { api, LiveConnection, ApiError } from '../api';
import { COPY } from '../../shared/copy';
import { PHASES, PHASE_NAMES, PHASE_FIELDS, type Phase } from '../../shared/phase';
import { CURRENCIES, formatCost, type CurrencyCode } from '../../shared/cost';
import type { WorkingJson, WorkingPart, WorkingStep, Camera } from '../../shared/working';
import { Stage } from '../stage';
import { pageTimeout, pageInterval, reducedMotion } from '../clock';
import { checkGlb } from '../../shared/glb';

interface Limits {
  guide_title_max: number;
  step_title_max: number;
  step_text_max: number;
  callout_text_max: number;
  part_name_max: number;
  tag_text_max: number;
  guide_tag_max: number;
  guide_step_max: number;
  step_callout_max: number;
  model_max_bytes: number;
  model_max_parts: number;
  presence_grace_seconds: number;
}

interface UndoEntry {
  field: string;
  before: unknown;
  after: unknown;
  label: string;
}

export async function renderEditor(main: HTMLElement, slug: string): Promise<void> {
  let working: WorkingJson;
  let limits: Limits;
  try {
    [working, limits] = await Promise.all([
      api<WorkingJson>(`/api/guides/${slug}/working`),
      api<Limits>('/api/limits'),
    ]);
  } catch {
    const band = el('div', { class: 'error-band' });
    band.append(el('h1', { class: 'display' }, COPY.fixed.notFound));
    band.append(el('a', { class: 'pw-btn', href: '/' }, 'Pennywasher'));
    main.append(band);
    return;
  }
  new EditorScreen(main, slug, working, limits).start();
}

class EditorScreen {
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private selectedStepId: string | null = null;
  private limits: Limits;
  private working: WorkingJson;
  private fieldRevision: Record<string, number>;
  private commitTimers = new Map<string, () => void>();
  private uncommitted = new Set<string>();
  private stage: Stage;
  private nodePaths: string[] = [];
  private presenceTimer: (() => void) | null = null;
  private live: LiveConnection | null = null;
  private versionsRegion: HTMLElement | null = null;
  private compareRegion: HTMLElement | null = null;
  private pickedVersions: number[] = [];
  private pendingFile: File | null = null;

  constructor(
    private main: HTMLElement,
    private slug: string,
    working: WorkingJson,
    limits: Limits,
  ) {
    this.working = working;
    this.limits = limits;
    this.fieldRevision = { ...working.field_revisions };
    this.stage = new Stage(document.createElement('div'));
    this.main = main;
  }

  start(): void {
    void api<{ user: { id: string; name: string } }>('/api/session').then((session) => {
      this.viewerId = session.user.id;
      this.viewerName = session.user.name;
    }).catch(() => {});
    this.build();
    const reduce = reducedMotion();
    void reduce;
    this.live = new LiveConnection(this.working.id, {
      onEvent: (event) => this.onLiveEvent(event),
    });
    this.live.start();
    this.sendPresence();
    this.presenceTimer = pageInterval(() => this.sendPresence(), 1000);
    window.addEventListener('pagehide', () => {
      this.live?.stop();
      this.presenceTimer?.();
    });
  }

  private sendPresence(): void {
    const stepNumber = this.selectedStepId
      ? this.working.steps.findIndex((step) => step.id === this.selectedStepId) + 1
      : null;
    void api('/api/presence', { body: { guide_id: this.working.id, step: stepNumber === 0 ? null : stepNumber } }).catch(() => {});
  }

  // ---- layout -----------------------------------------------------------

  private build(): void {
    this.main.textContent = '';
    const header = el('header', { class: 'editor-header' });
    header.append(el('h1', { class: 'display' }, this.working.title));
    this.latestVersionStatus = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'latest-version' },
      this.working.latest_version === null ? COPY.noVersions : COPY.latestVersion(this.working.latest_version));
    this.peopleEditing = el('ul', { 'aria-label': 'People editing', role: 'list', 'data-list': 'people-editing' });
    this.totalCostFigure = el('div', { 'data-figure': 'total-cost' }, this.working.guide_total_text);
    this.editorStatus = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'editor' });
    this.questionAlerts = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'question-alerts' });
    if (this.working.forked_from) {
      header.append(el('p', { class: 'fork-credit' }, COPY.fixed.forkCredit(
        this.working.forked_from.title,
        this.working.forked_from.author_name,
        this.working.forked_from.version,
      )));
    }
    header.append(this.latestVersionStatus, this.totalCostFigure, this.peopleEditing, this.editorStatus, this.questionAlerts);
    this.main.append(header);

    // The toolbar in its published Tab order.
    const toolbar = el('div', { role: 'toolbar', 'aria-label': 'Editor tools', class: 'editor-toolbar' });
    this.toolbarButtons = {
      add: this.toolbarButton('Add step', () => this.addStep()),
      undo: this.toolbarButton('Undo', () => this.undo()),
      redo: this.toolbarButton('Redo', () => this.redo()),
      save: this.toolbarButton('Save version', () => this.saveVersion()),
      versions: this.toolbarButton('Versions', () => this.toggleVersions()),
      chooseFile: this.toolbarButton('Choose a model file', () => this.chooseModelFile()),
      upload: this.toolbarButton('Upload model', () => this.uploadModel()),
      coauthors: this.toolbarButton('Co-authors', () => this.openCoauthorsDialog()),
      publish: this.toolbarButton('Publish', () => this.publish()),
      withdraw: this.toolbarButton('Withdraw', () => this.withdraw()),
      remove: this.toolbarButton('Delete guide', () => this.openDeleteDialog()),
    };
    this.undoButton = this.toolbarButtons.undo;
    this.redoButton = this.toolbarButtons.redo;
    this.versionsButton = this.toolbarButtons.versions;
    this.chooseFileButton = this.toolbarButtons.chooseFile;
    this.uploadButton = this.toolbarButtons.upload;
    this.publishButton = this.toolbarButtons.publish;
    toolbar.append(
      this.toolbarButtons.add,
      this.toolbarButtons.undo,
      this.toolbarButtons.redo,
      this.toolbarButtons.save,
      this.toolbarButtons.versions,
      this.toolbarButtons.chooseFile,
      this.toolbarButtons.upload,
      this.toolbarButtons.coauthors,
      this.toolbarButtons.publish,
      this.toolbarButtons.withdraw,
      this.toolbarButtons.remove,
    );
    this.main.append(toolbar);

    // Stage pane.
    const stagePane = el('section', { class: 'editor-stage-pane', 'aria-label': 'Stage' });
    this.stageRoot = el('div', { class: 'stage-root', role: 'application', 'aria-label': 'Model stage', tabindex: '0' });
    this.stage = new Stage(this.stageRoot);
    const hasWebGL = Stage.hasWebGL();
    if (hasWebGL) this.stage.attach();
    this.stageStatus = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'stage' },
      this.working.model ? COPY.stage.loading : COPY.stage.noModel);
    if (hasWebGL && this.working.model) {
      void this.stage.loadModelUrl(`/api/models/${this.working.model.id}.glb`).then((result) => {
        // A preview replaces the stored model; its state wins.
        if (this.pendingFile) return;
        this.stageStatus.textContent = result.ok ? COPY.stage.ready : COPY.stage.storageOutAuthor;
        if (!result.ok) {
          this.stage.setState('error');
          this.stageStatus.classList.add('pw-band');
          return;
        }
        this.stage.setParts(this.working.parts, this.working.model?.scale ?? 1);
        this.nodePaths = this.stage.nodePaths();
        this.applySelectedStep();
      }).catch(() => {
        if (this.pendingFile) return;
        this.stageStatus.textContent = COPY.stage.storageOutAuthor;
        this.stageStatus.classList.add('pw-band');
      });
    } else if (!this.working.model) {
      this.stageRoot.setAttribute('data-state', 'ready');
    }
    const apartSlider = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0', 'aria-label': 'Apart amount' }) as HTMLInputElement;
    apartSlider.addEventListener('input', () => {
      this.delayCommit(`step/${this.selectedStepId}/explode`, () => {
        if (!this.selectedStepId) return;
        const value = Number(apartSlider.value);
        this.commit(`step/${this.selectedStepId}/explode`, value, COPY.undoLabels.stepApart(this.stepNumber(this.selectedStepId)));
        this.stage.setExplode(value);
      });
    });
    const useView = el('button', { class: 'pw-btn' }, 'Use this view');
    useView.addEventListener('click', () => {
      if (!this.selectedStepId) return;
      const pose: Camera = { yaw: this.stage.yaw, pitch: this.stage.pitch, zoom: this.stage.zoom };
      this.commit(`step/${this.selectedStepId}/camera`, pose, COPY.undoLabels.stepView(this.stepNumber(this.selectedStepId)));
    });
    const scaleInput = el('input', { type: 'number', step: '0.01', min: '0.01', value: String(this.working.model?.scale ?? 1), 'aria-label': 'Model scale' }) as HTMLInputElement;
    const confirmScale = el('button', { class: 'pw-btn' }, 'Confirm scale');
    confirmScale.addEventListener('click', () => {
      const value = Number(scaleInput.value);
      if (!Number.isFinite(value) || value <= 0) return;
      void this.commit('model_scale', value, COPY.undoLabels.guideTitle);
      void this.commit('model_scale_confirmed', true, COPY.undoLabels.guideTitle);
    });
    const bbox = el('p', {}, `Bounding box: ${this.working.model ? this.working.model.bbox_mm.map((v) => Math.round(v)).join(' x ') : '-'} mm`);
    stagePane.append(this.stageRoot, this.stageStatus, apartSlider, useView, scaleInput, confirmScale, bbox);
    // Drop a file to preview; nothing leaves the browser.
    this.stageRoot.addEventListener('dragover', (event) => event.preventDefault());
    this.stageRoot.addEventListener('drop', (event) => {
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (file) void this.previewFile(file);
    });
    this.stageRoot.addEventListener('keydown', (event) => this.stageKeys(event));

    // Steps pane.
    const stepsPane = el('section', { class: 'editor-steps-pane', 'aria-label': 'Steps' });
    const guideDetails = el('div', { class: 'pw-form', 'aria-label': 'Guide details' });
    this.titleInput = el('input', { type: 'text', 'aria-label': 'Guide title', value: this.working.title }) as HTMLInputElement;
    this.currencySelect = el('select', { 'aria-label': 'Currency' }) as HTMLSelectElement;
    for (const code of CURRENCIES) this.currencySelect.append(el('option', { value: code }, code));
    this.currencySelect.value = this.working.currency;
    this.tagsInput = el('input', { type: 'text', 'aria-label': 'Tags', value: this.working.tags.join(', ') }) as HTMLInputElement;
    this.visibilitySelect = el('select', { 'aria-label': 'Visibility' }) as HTMLSelectElement;
    this.visibilitySelect.append(el('option', { value: 'public' }, 'Public'), el('option', { value: 'private' }, 'Private'));
    this.visibilitySelect.value = this.working.visibility;
    this.appendField(guideDetails, 'Guide title', this.titleInput);
    this.appendField(guideDetails, 'Currency', this.currencySelect);
    this.appendField(guideDetails, 'Tags', this.tagsInput);
    this.appendField(guideDetails, 'Visibility', this.visibilitySelect);
    this.wireGuideFields();

    this.stepsList = el('div', { class: 'editor-steps-list', role: 'list', 'aria-label': 'Guide steps' });
    this.partsGroup = el('div', { role: 'group', 'aria-label': 'Parts in this step' });

    this.partsTree = el('div', { role: 'tree', 'aria-label': 'Model parts' });
    this.partFields = el('div', { class: 'pw-form', 'aria-label': 'Selected part' });
    this.unboundList = el('ul', { 'aria-label': 'Unbound parts', role: 'list' });

    stepsPane.append(guideDetails, this.stepsList, this.partsGroup);

    const partsPane = el('section', { class: 'editor-parts-pane', 'aria-label': 'Parts' });
    partsPane.append(this.partsTree, this.partFields, this.unboundList);

    this.stagePaneRef = stagePane;
    this.stepsPaneRef = stepsPane;
    this.partsPaneRef = partsPane;

    const panes = el('div', { class: 'editor-panes' });
    this.separator = el('div', { role: 'separator', 'aria-label': 'Resize stage and steps', 'aria-valuenow': '50', 'aria-valuemin': '30', 'aria-valuemax': '70', tabindex: '0', class: 'editor-separator' });
    this.separator.addEventListener('keydown', (event) => {
      const value = Number(this.separator.getAttribute('aria-valuenow'));
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const next = Math.max(30, Math.min(70, value + (event.key === 'ArrowLeft' ? -5 : 5)));
        this.separator.setAttribute('aria-valuenow', String(next));
        this.applySeparator();
      }
      if (event.key === 'Home') {
        this.separator.setAttribute('aria-valuenow', '30');
        this.applySeparator();
      }
      if (event.key === 'End') {
        this.separator.setAttribute('aria-valuenow', '70');
        this.applySeparator();
      }
    });
    panes.append(stagePane, this.separator, stepsPane, partsPane);
    this.main.append(panes);

    // Phone tablist.
    const tablist = el('div', { role: 'tablist', 'aria-label': 'Editor panes', class: 'editor-tablist' });
    const tabs = ['Stage', 'Steps', 'Parts'].map((name, index) => {
      const tab = el('button', { role: 'tab', 'aria-selected': index === 0 ? 'true' : 'false', id: `tab-${name}` }, name);
      tab.addEventListener('click', () => this.showTab(name));
      tab.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          const order = ['Stage', 'Steps', 'Parts'];
          const next = order[(order.indexOf(name) + (event.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
          this.showTab(next);
        }
      });
      tablist.append(tab);
      return tab;
    });
    this.tablist = tablist;
    const tablistWrap = el('div', { class: 'editor-tablist-wrap' });
    tablistWrap.append(tablist);
    this.main.insertBefore(tablistWrap, panes);
    void tabs;

    this.renderSteps();
    this.renderPartsGroup();
    this.renderPartsTree();
    this.applySelectedStep();
    this.applySeparator();
    this.lastStepSignature = JSON.stringify(this.working.steps.map((step) => [step.id, step.title, step.text, step.phase, step.explode]));

    // Editor shortcuts work whichever control has focus.
    document.addEventListener('keydown', (event) => this.editorKeys(event));
  }

  private latestVersionStatus!: HTMLElement;
  private peopleEditing!: HTMLElement;
  private totalCostFigure!: HTMLElement;
  private editorStatus!: HTMLElement;
  private questionAlerts!: HTMLElement;
  private undoButton!: HTMLElement;
  private redoButton!: HTMLElement;
  private versionsButton!: HTMLElement;
  private chooseFileButton!: HTMLElement;
  private uploadButton!: HTMLElement;
  private publishButton!: HTMLElement;
  private stageRoot!: HTMLElement;
  private stageStatus!: HTMLElement;
  private titleInput!: HTMLInputElement;
  private currencySelect!: HTMLSelectElement;
  private tagsInput!: HTMLInputElement;
  private visibilitySelect!: HTMLSelectElement;
  private stepsList!: HTMLElement;
  private partsGroup!: HTMLElement;
  private partsTree!: HTMLElement;
  private partFields!: HTMLElement;
  private unboundList!: HTMLElement;
  private stagePaneRef!: HTMLElement;
  private stepsPaneRef!: HTMLElement;
  private partsPaneRef!: HTMLElement;
  private separator!: HTMLElement;
  private tablist!: HTMLElement;
  private toolbarButtons!: Record<string, HTMLElement>;

  private showTab(name: string): void {
    const panes: Record<string, HTMLElement> = {
      Stage: this.stagePaneRef,
      Steps: this.stepsPaneRef,
      Parts: this.partsPaneRef,
    };
    for (const [paneName, pane] of Object.entries(panes)) {
      const active = paneName === name;
      pane.classList.toggle('pane-hidden', !active);
      pane.setAttribute('aria-hidden', active ? 'false' : 'true');
      pane.querySelectorAll('input, button, select, textarea, [tabindex]').forEach((node) => {
        (node as HTMLElement).tabIndex = active ? 0 : -1;
      });
    }
    [...this.tablist.querySelectorAll('[role="tab"]')].forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.textContent === name));
    });
  }

  private applySeparator(): void {
    const value = Number(this.separator.getAttribute('aria-valuenow'));
    this.stagePaneRef.style.width = `${value}%`;
  }

  private appendField(form: HTMLElement, label: string, input: HTMLElement): void {
    const wrap = el('div', { class: 'pw-field' });
    const id = `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
    input.id = id;
    wrap.append(el('label', { for: id }, label), input);
    form.append(wrap);
  }

  private toolbarButton(label: string, onClick: () => void): HTMLElement {
    const button = el('button', { class: 'pw-btn' }, label);
    button.addEventListener('click', onClick);
    return button;
  }

  private stepNumber(stepId: string): number {
    return this.working.steps.findIndex((step) => step.id === stepId) + 1;
  }

  // ---- guide fields -----------------------------------------------------

  private wireGuideFields(): void {
    const commitText = (field: string, value: string, label: string, limit: number): void => {
      if (codePoints(value) > limit) {
        announceExpiring('editor', COPY.editor.textOverLimit(label, limit));
        return;
      }
      this.commit(field, value, label, label);
    };
    this.titleInput.addEventListener('input', () => {
      this.delayCommit('title', () => commitText('title', this.titleInput.value, 'Guide title', this.limits.guide_title_max));
    });
    this.currencySelect.addEventListener('change', () => {
      this.delayCommit('currency', () => this.commit('currency', this.currencySelect.value, COPY.undoLabels.guideTitle));
    });
    this.tagsInput.addEventListener('input', () => {
      this.delayCommit('tags', () => {
        const tags = this.tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean);
        if (tags.length > this.limits.guide_tag_max) {
          announceExpiring('editor', COPY.editor.tagsOverLimit(this.limits.guide_tag_max));
          return;
        }
        this.commit('tags', tags, COPY.undoLabels.guideTitle);
      });
    });
    this.visibilitySelect.addEventListener('change', () => {
      this.delayCommit('visibility', () => this.commit('visibility', this.visibilitySelect.value, COPY.undoLabels.guideTitle, 'Visibility'));
    });
  }

  /** Commits 250 ms after the last change; the field holds uncommitted text until then. */
  private delayCommit(fieldPath: string, run: () => void): void {
    this.commitTimers.get(fieldPath)?.();
    this.uncommitted.add(fieldPath);
    this.commitTimers.set(fieldPath, pageTimeout(() => {
      this.uncommitted.delete(fieldPath);
      run();
    }, 250));
  }

  // ---- steps ------------------------------------------------------------

  private renderSteps(): void {
    this.stepsList.textContent = '';
    for (const step of this.working.steps) {
      const row = el('div', { role: 'listitem', class: 'editor-step-row' });
      const group = el('div', { role: 'group', 'aria-label': `Step ${step.number}`, 'data-step-id': step.id });
      const title = el('input', { type: 'text', 'aria-label': `Step ${step.number} title`, value: step.title }) as HTMLInputElement;
      const text = el('textarea', { 'aria-label': `Step ${step.number} text` }, step.text) as HTMLTextAreaElement;
      const phase = el('select', { 'aria-label': `Step ${step.number} phase` }) as HTMLSelectElement;
      for (const phaseValue of PHASES) phase.append(el('option', { value: phaseValue }, PHASE_NAMES[phaseValue]));
      phase.value = step.phase;
      const deleteButton = el('button', { class: 'pw-btn', 'aria-label': `Delete step ${step.number}` }, 'Delete');

      title.addEventListener('focus', () => this.selectStep(step.id));
      text.addEventListener('focus', () => this.selectStep(step.id));
      title.addEventListener('input', () => {
        this.selectStep(step.id);
        this.delayCommit(`step/${step.id}/title`, () => {
          if (codePoints(title.value) > this.limits.step_title_max) {
            announceExpiring('editor', COPY.editor.textOverLimit(`Step ${step.number} title`, this.limits.step_title_max));
            return;
          }
          this.commit(`step/${step.id}/title`, title.value, COPY.undoLabels.stepTitle(step.number), `Step ${step.number} title`);
        });
      });
      text.addEventListener('input', () => {
        this.delayCommit(`step/${step.id}/text`, () => {
          if (codePoints(text.value) > this.limits.step_text_max) {
            announceExpiring('editor', COPY.editor.textOverLimit(`Step ${step.number} text`, this.limits.step_text_max));
            return;
          }
          this.commit(`step/${step.id}/text`, text.value, COPY.undoLabels.stepText(step.number), `Step ${step.number} text`);
        });
      });
      phase.addEventListener('change', () => {
        this.delayCommit(`step/${step.id}/phase`, () => this.commit(`step/${step.id}/phase`, phase.value, COPY.undoLabels.stepPhase(step.number), `Step ${step.number} phase`));
      });
      deleteButton.addEventListener('click', () => this.deleteStep(step.id));
      row.addEventListener('keydown', (event) => {
        if (!event.altKey) return;
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          void this.moveStep(step.id, -1);
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          void this.moveStep(step.id, 1);
        }
      });

      group.append(title, text, phase, deleteButton);
      row.append(group);
      this.stepsList.append(row);
    }
  }

  private async addStep(): Promise<void> {
    if (this.working.steps.length >= this.limits.guide_step_max) {
      announceExpiring('editor', COPY.editor.stepsOverLimit(this.limits.guide_step_max));
      return;
    }
    const title = 'New step';
    try {
      const result = await api<{ id: string; number: number }>(`/api/guides/${this.working.id}/steps`, { body: { title } });
      this.working.steps.push({
        id: result.id,
        number: result.number,
        title,
        text: '',
        phase: 'open_up',
        explode: 0,
        focus_parts: [],
        camera: { yaw: 30, pitch: 15, zoom: 1 },
        callouts: [],
      });
      for (const field of ['title', 'text', 'phase', 'explode', 'focus_parts', 'camera', 'callouts']) {
        this.fieldRevision[`step/${result.id}/${field}`] = 0;
      }
      this.undoStack.push({ field: `add:${result.id}`, before: null, after: result.id, label: COPY.undoLabels.addStep(result.number) });
      this.redoStack = [];
      announceExpiring('editor', COPY.editor.stepAdded(result.number));
      this.renderSteps();
      this.lastStepSignature = JSON.stringify(this.working.steps.map((step) => [step.id, step.title, step.text, step.phase, step.explode]));
      this.selectStep(result.id);
      const firstInput = this.stepsList.querySelector(`[data-step-id="${result.id}"] input`);
      (firstInput as HTMLElement | null)?.focus();
    } catch (error) {
      this.handleCommitError(error, 'Add step');
    }
  }

  private async deleteStep(stepId: string): Promise<void> {
    const number = this.stepNumber(stepId);
    try {
      await api(`/api/guides/${this.working.id}/steps/${stepId}`, { method: 'DELETE' });
      const removed = this.working.steps.find((step) => step.id === stepId)!;
      this.working.steps = this.working.steps.filter((step) => step.id !== stepId);
      this.undoStack.push({ field: `delete:${stepId}`, before: removed, after: null, label: COPY.undoLabels.deleteStep(number) });
      this.redoStack = [];
      announceExpiring('editor', COPY.editor.stepDeleted(number));
      this.renderSteps();
      this.lastStepSignature = JSON.stringify(this.working.steps.map((step) => [step.id, step.title, step.text, step.phase, step.explode]));
      this.selectStep(this.working.steps[0]?.id ?? null);
    } catch (error) {
      this.handleCommitError(error, 'Delete step');
    }
  }

  private async moveStep(stepId: string, delta: number): Promise<void> {
    const index = this.working.steps.findIndex((step) => step.id === stepId);
    const target = index + delta;
    if (target < 0 || target >= this.working.steps.length) {
      const label = COPY.editor.stepFirst(index + 1);
      announceExpiring('editor', delta < 0 ? COPY.editor.stepFirst(index + 1) : COPY.editor.stepLast(index + 1));
      void label;
      return;
    }
    const from = index + 1;
    const to = target + 1;
    try {
      await api(`/api/guides/${this.working.id}/steps/${stepId}/move`, { body: { position: target } });
      const [step] = this.working.steps.splice(index, 1);
      this.working.steps.splice(target, 0, step);
      this.undoStack.push({ field: `move:${stepId}`, before: from, after: to, label: COPY.undoLabels.moveStep(from, to) });
      this.redoStack = [];
      announceExpiring('editor', COPY.editor.stepMoved(from, to));
      this.renderSteps();
      this.lastStepSignature = JSON.stringify(this.working.steps.map((step) => [step.id, step.title, step.text, step.phase, step.explode]));
      this.selectStep(stepId);
    } catch (error) {
      this.handleCommitError(error, 'Move step');
    }
  }

  private selectStep(stepId: string | null): void {
    if (this.selectedStepId === stepId) return;
    this.selectedStepId = stepId;
    this.applySelectedStep();
    this.renderPartsGroup();
    this.sendPresence();
  }

  private applySelectedStep(): void {
    const step = this.working.steps.find((entry) => entry.id === this.selectedStepId);
    this.stage.setStep(step ? step.number : 0);
    if (step) {
      this.stage.setFocusParts(step.focus_parts);
      this.stage.setStyle(PHASE_FIELDS[step.phase].field, PHASE_FIELDS[step.phase].text === '#ffffff' ? 'var(--bone)' : '#ffffff');
      this.stage.setExplode(step.explode);
      this.stage.setPose(step.camera);
    }
  }

  // ---- parts ------------------------------------------------------------

  /** The part label: name alone when unique, else name plus full node path. */
  private partLabel(part: WorkingPart): string {
    const sameName = this.working.parts.filter((other) => other.name === part.name);
    return sameName.length === 1 ? part.name : `${part.name} (${part.node_path})`;
  }

  private renderPartsGroup(): void {
    this.partsGroup.textContent = '';
    const step = this.working.steps.find((entry) => entry.id === this.selectedStepId);
    if (!step) return;
    const legend = el('p', {}, `Parts in step ${step.number}`);
    this.partsGroup.append(legend);
    for (const part of this.working.parts) {
      const label = this.partLabel(part);
      const id = `focus-${part.id}`;
      const wrap = el('div', { class: 'pw-check' });
      const checkbox = el('input', { type: 'checkbox', id, 'aria-label': label }) as HTMLInputElement;
      checkbox.checked = step.focus_parts.includes(part.id);
      checkbox.addEventListener('change', () => {
        if (!this.selectedStepId) return;
        const focus = new Set(step.focus_parts);
        if (checkbox.checked) focus.add(part.id);
        else focus.delete(part.id);
        this.delayCommit(`step/${this.selectedStepId}/focus_parts`, () => {
          this.commit(`step/${this.selectedStepId}/focus_parts`, [...focus], COPY.undoLabels.stepParts(step.number), `Step ${step.number} parts`);
        });
      });
      wrap.append(checkbox, el('label', { for: id }, label));
      this.partsGroup.append(wrap);
      if (checkbox.checked) {
        const callout = el('input', { type: 'text', 'aria-label': `Callout for ${label}`, value: step.callouts.find((entry) => entry.part_id === part.id)?.text ?? part.name }) as HTMLInputElement;
        callout.addEventListener('input', () => {
          this.delayCommit(`step/${this.selectedStepId}/callouts`, () => {
            const callouts = step.callouts.filter((entry) => entry.part_id !== part.id);
            callouts.push({ part_id: part.id, text: callout.value });
            if (callouts.length > this.limits.step_callout_max) {
              announceExpiring('editor', COPY.editor.calloutsOverLimit(step.number, this.limits.step_callout_max));
              return;
            }
            if (this.selectedStepId) {
              this.commit(`step/${this.selectedStepId}/callouts`, callouts, COPY.undoLabels.callout(step.number));
            }
          });
        });
        this.partsGroup.append(callout);
      }
    }
  }

  private renderPartsTree(): void {
    this.partsTree.textContent = '';
    let selectedPartId: string | null = null;
    for (const part of this.working.parts) {
      const item = el('div', { role: 'treeitem', 'aria-label': this.partLabel(part), 'data-part-id': part.id, tabindex: '0', 'aria-selected': 'false' }, this.partLabel(part));
      item.addEventListener('click', () => {
        selectedPartId = part.id;
        [...this.partsTree.children].forEach((child) => child.setAttribute('aria-selected', String(child === item)));
        this.renderPartFields(part);
      });
      this.partsTree.append(item);
    }
    const unbound = this.working.parts.filter((part) => part.unbound);
    this.unboundList.textContent = '';
    for (const part of unbound) {
      this.unboundList.append(el('li', { role: 'listitem' }, part.name));
    }
  }

  private renderPartFields(part: WorkingPart): void {
    this.partFields.textContent = '';
    const name = el('input', { type: 'text', 'aria-label': 'Part name', value: part.name }) as HTMLInputElement;
    const axis = el('select', { 'aria-label': 'Apart axis' }) as HTMLSelectElement;
    for (const value of ['x', 'y', 'z']) axis.append(el('option', { value }, value.toUpperCase()));
    axis.value = part.axis;
    const apart = el('input', { type: 'number', 'aria-label': 'Apart distance in millimetres', value: String(part.apart_mm) }) as HTMLInputElement;
    const quantity = el('input', { type: 'number', 'aria-label': 'Quantity', min: '1', max: '999', value: String(part.quantity) }) as HTMLInputElement;
    const price = el('input', { type: 'text', 'aria-label': 'Unit price', value: majorUnits(part.unit_price, this.working.currency) }) as HTMLInputElement;
    const fitted = el('select', { 'aria-label': 'Fitted at step' }) as HTMLSelectElement;
    fitted.append(el('option', { value: '' }, 'Not fitted new'));
    for (const step of this.working.steps) fitted.append(el('option', { value: step.id }, `Step ${step.number}`));
    fitted.value = part.fitted_at ?? '';
    const remove = el('button', { class: 'pw-btn' }, 'Remove part');
    const bind = el('select', { 'aria-label': 'Bind to node' }) as HTMLSelectElement;
    bind.append(el('option', { value: part.node_path }, part.node_path || 'Not bound'));
    for (const path of this.nodePaths) bind.append(el('option', { value: path }, path));

    this.appendField(this.partFields, 'Part name', name);
    this.appendField(this.partFields, 'Apart axis', axis);
    this.appendField(this.partFields, 'Apart distance in millimetres', apart);
    this.appendField(this.partFields, 'Quantity', quantity);
    this.appendField(this.partFields, 'Unit price', price);
    this.appendField(this.partFields, 'Fitted at step', fitted);
    this.appendField(this.partFields, 'Bind to node', bind);
    this.partFields.append(remove);

    name.addEventListener('input', () => {
      this.delayCommit(`part/${part.id}/name`, () => {
        if (codePoints(name.value) > this.limits.part_name_max) {
          announceExpiring('editor', COPY.editor.textOverLimit('Part name', this.limits.part_name_max));
          return;
        }
        this.commit(`part/${part.id}/name`, name.value, COPY.undoLabels.part(part.name));
      });
    });
    axis.addEventListener('change', () => this.delayCommit(`part/${part.id}/axis`, () => this.commit(`part/${part.id}/axis`, axis.value, COPY.undoLabels.part(part.name))));
    apart.addEventListener('input', () => this.delayCommit(`part/${part.id}/apart_mm`, () => this.commit(`part/${part.id}/apart_mm`, Number(apart.value), COPY.undoLabels.part(part.name))));
    quantity.addEventListener('input', () => this.delayCommit(`part/${part.id}/quantity`, () => this.commit(`part/${part.id}/quantity`, Number(quantity.value), COPY.undoLabels.part(part.name))));
    price.addEventListener('input', () => {
      this.delayCommit(`part/${part.id}/unit_price`, () => {
        const value = Math.round(Number(price.value) * (this.working.currency === 'JPY' ? 1 : 100));
        this.commit(`part/${part.id}/unit_price`, value, COPY.undoLabels.part(part.name));
      });
    });
    fitted.addEventListener('change', () => this.delayCommit(`part/${part.id}/fitted_at`, () => {
      const stepId = fitted.value.length === 0 ? null : fitted.value;
      this.commit(`part/${part.id}/fitted_at`, stepId, COPY.undoLabels.part(part.name));
    }));
    bind.addEventListener('change', () => this.delayCommit(`part/${part.id}/node_path`, () => this.commit(`part/${part.id}/node_path`, bind.value, COPY.undoLabels.part(part.name))));
    remove.addEventListener('click', async () => {
      try {
        await api(`/api/guides/${this.working.id}/parts/${part.id}`, { method: 'DELETE' });
        this.working.parts = this.working.parts.filter((entry) => entry.id !== part.id);
        this.renderPartsTree();
        this.renderPartsGroup();
      } catch (error) {
        this.handleCommitError(error, 'Remove part');
      }
    });
  }

  // ---- commits, undo and redo ---------------------------------------------

  private async commit(field: string, value: unknown, label: string, controlLabel?: string): Promise<void> {
    if (controlLabel) this.lastControlLabel = controlLabel;
    this.uncommitted.delete(field);
    const basedOn = this.fieldRevision[field] ?? 0;
    try {
      const result = await api<{ revision: number; field_revision: number; guide_total: number; guide_total_text: string }>(
        `/api/guides/${this.working.id}/working`,
        { method: 'PATCH', body: { field, value, based_on: basedOn } },
      );
      this.fieldRevision[field] = result.field_revision;
      this.working.revision = result.revision;
      const before = this.readLocal(field);
      this.writeLocal(field, value);
      this.undoStack.push({ field, before, after: value, label });
      this.redoStack = [];
      if (result.guide_total !== this.working.guide_total) {
        this.working.guide_total = result.guide_total;
        this.totalCostFigure.textContent = result.guide_total_text;
        announceExpiring('editor', COPY.editor.totalChanged(result.guide_total_text));
      }
    } catch (error) {
      this.handleCommitError(error, label, field, value);
    }
  }

  /** The value this page holds for a field, before a commit applies. */
  private readLocal(field: string): unknown {
    const [kind, id, name] = field.split('/');
    if (kind === 'step') {
      const step = this.working.steps.find((entry) => entry.id === id);
      if (!step) return undefined;
      return (step as unknown as Record<string, unknown>)[name];
    }
    if (kind === 'part') {
      const part = this.working.parts.find((entry) => entry.id === id);
      if (!part) return undefined;
      return (part as unknown as Record<string, unknown>)[name];
    }
    return (this.working as unknown as Record<string, unknown>)[field];
  }

  private writeLocal(field: string, value: unknown): void {
    const [kind, id, name] = field.split('/');
    if (kind === 'step') {
      const step = this.working.steps.find((entry) => entry.id === id);
      if (step) (step as unknown as Record<string, unknown>)[name] = value;
      return;
    }
    if (kind === 'part') {
      const part = this.working.parts.find((entry) => entry.id === id);
      if (part) (part as unknown as Record<string, unknown>)[name] = value;
      return;
    }
    (this.working as unknown as Record<string, unknown>)[field] = value;
    if (field === 'title') this.main.querySelector('h1')!.textContent = String(value);
  }

  /** The accessible name of the control that last committed, for conflict copy. */
  private lastControlLabel = '';

  private handleCommitError(error: unknown, label: string, field?: string, value?: unknown): void {
    const err = error as ApiError;
    if (err.code === 'edit_conflict' && field) {
      this.openConflictDialog(err.body, field ?? '', value, this.lastControlLabel || label);
      return;
    }
    if (err.code === 'too_long') {
      announceExpiring('editor', COPY.editor.textOverLimit(label, Number(err.body.limit ?? 0)));
      return;
    }
    if (err.code === 'too_many') {
      announceExpiring('editor', COPY.editor.tagsOverLimit(Number(err.body.limit ?? 0)));
      return;
    }
    announceExpiring('editor', COPY.editor.commitFailed);
  }

  private undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) {
      announceExpiring('editor', COPY.editor.nothingToUndo);
      return;
    }
    if (entry.field.startsWith('add:')) {
      const stepId = entry.after as string;
      void api(`/api/guides/${this.working.id}/steps/${stepId}`, { method: 'DELETE' }).then(() => {
        this.working.steps = this.working.steps.filter((step) => step.id !== stepId);
        this.renderSteps();
      });
      this.redoStack.push(entry);
      announceExpiring('editor', COPY.editor.undo(entry.label));
      return;
    }
    if (entry.field.startsWith('delete:')) {
      announceExpiring('editor', COPY.editor.cannotUndo(''));
      return;
    }
    if (entry.field.startsWith('move:')) {
      const stepId = entry.field.slice('move:'.length);
      const from = entry.before as number;
      void api(`/api/guides/${this.working.id}/steps/${stepId}/move`, { body: { position: from - 1 } }).then(() => {
        const index = this.working.steps.findIndex((step) => step.id === stepId);
        if (index !== -1) {
          const [step] = this.working.steps.splice(index, 1);
          this.working.steps.splice(from - 1, 0, step);
        }
        this.renderSteps();
      });
      this.redoStack.push(entry);
      announceExpiring('editor', COPY.editor.undo(entry.label));
      return;
    }
    const basedOn = this.fieldRevision[entry.field] ?? 0;
    void api(`/api/guides/${this.working.id}/working`, {
      method: 'PATCH',
      body: { field: entry.field, value: entry.before, based_on: basedOn },
    }).then((result) => {
      const typed = result as { field_revision: number };
      this.fieldRevision[entry.field] = typed.field_revision;
      this.writeLocal(entry.field, entry.before);
      this.undoStack.pop();
      this.renderSteps();
    }).catch((error) => {
      const err = error as ApiError;
      if (err.code === 'edit_conflict') {
        this.undoStack.push(entry);
        const winner = (err.body.theirs as { by?: string } | undefined)?.by ?? '';
        announceExpiring('editor', COPY.editor.cannotUndo(winner));
      }
    });
    this.redoStack.push(entry);
    announceExpiring('editor', COPY.editor.undo(entry.label));
  }

  private redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) {
      announceExpiring('editor', COPY.editor.nothingToRedo);
      return;
    }
    this.undoStack.push(entry);
    void this.commit(entry.field, entry.after, entry.label);
  }

  // ---- keyboard ------------------------------------------------------------

  private editorKeys(event: KeyboardEvent): void {
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.saveVersion();
      return;
    }
    if (meta && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.undo();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.redo();
    }
  }

  private stageKeys(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.stage.yaw -= 15;
      this.stage.renderOnce();
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.stage.yaw += 15;
      this.stage.renderOnce();
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.stage.pitch = Math.min(60, this.stage.pitch + 15);
      this.stage.renderOnce();
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.stage.pitch = Math.max(-60, this.stage.pitch - 15);
      this.stage.renderOnce();
    }
    if (event.key === '+') {
      event.preventDefault();
      this.stage.zoom = Math.min(3, this.stage.zoom * 1.25);
      this.stage.renderOnce();
    }
    if (event.key === '-') {
      event.preventDefault();
      this.stage.zoom = Math.max(0.5, this.stage.zoom * 0.8);
      this.stage.renderOnce();
    }
    if (event.key === 'Home') {
      event.preventDefault();
      const step = this.working.steps.find((entry) => entry.id === this.selectedStepId);
      if (step) this.stage.setPose(step.camera);
    }
  }

  // ---- versions -------------------------------------------------------------

  private async saveVersion(): Promise<void> {
    announceExpiring('editor', COPY.editor.saving);
    try {
      const result = await api<{ number: number }>(`/api/guides/${this.working.id}/versions`, {
        body: { base_version: this.working.latest_version },
      });
      this.working.latest_version = result.number;
      this.latestVersionStatus.textContent = COPY.latestVersion(result.number);
      announceExpiring('editor', COPY.editor.saved(result.number));
    } catch (error) {
      const err = error as ApiError;
      if (err.code === 'version_conflict') {
        this.working.latest_version = Number(err.body.current ?? 0);
        this.latestVersionStatus.textContent = COPY.latestVersion(this.working.latest_version ?? 0);
        announceExpiring('editor', COPY.editor.staleSave(this.working.latest_version ?? 0));
        return;
      }
      announceExpiring('editor', COPY.editor.commitFailed);
    }
  }

  private async toggleVersions(): Promise<void> {
    if (this.versionsRegion) {
      this.versionsRegion.remove();
      this.versionsRegion = null;
      this.versionsButton.setAttribute('aria-expanded', 'false');
      return;
    }
    this.versionsButton.setAttribute('aria-expanded', 'true');
    const region = el('div', { role: 'region', 'aria-label': 'Versions', class: 'versions-region' });
    const list = el('div', { class: 'versions-list' });
    const compareButton = el('button', { class: 'pw-btn', 'aria-disabled': 'true' }, 'Compare');
    const loadMore = el('button', { class: 'pw-btn' }, 'Load more versions');
    region.append(list, compareButton, loadMore);
    this.main.append(region);
    this.versionsRegion = region;
    await this.loadVersions(list, loadMore, compareButton);
    compareButton.addEventListener('click', () => {
      if (this.pickedVersions.length === 2) void this.openCompare(compareButton);
    });
  }

  private async loadVersions(list: HTMLElement, loadMore: HTMLElement, compareButton: HTMLElement): Promise<void> {
    try {
      const data = await api<{ items: { number: number; saved_at: string; saved_by: string; restored_from: number | null; step_count: number; parts_cost_text: string }[]; next_cursor: string | null }>(
        `/api/guides/${this.working.id}/versions?limit=24`,
      );
      list.textContent = '';
      this.pickedVersions = [];
      for (const version of data.items) {
        const row = el('div', { class: 'version-row' });
        const checkbox = el('input', { type: 'checkbox', 'aria-label': `Version ${version.number}` }) as HTMLInputElement;
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) this.pickedVersions.push(version.number);
          else this.pickedVersions = this.pickedVersions.filter((n) => n !== version.number);
          // Picking a third drops the earliest picked.
          if (this.pickedVersions.length > 2) this.pickedVersions.shift();
          list.querySelectorAll('input[type="checkbox"]').forEach((input) => {
            const n = Number((input as HTMLInputElement).getAttribute('aria-label')?.replace('Version ', ''));
            (input as HTMLInputElement).checked = this.pickedVersions.includes(n);
          });
          compareButton.setAttribute('aria-disabled', String(this.pickedVersions.length !== 2));
        });
        const versionText = el('span', {}, `Version ${version.number}`);
        const restore = el('button', { class: 'pw-btn', 'aria-label': `Restore version ${version.number}` }, `Restore ${version.number}`);
        restore.addEventListener('click', () => this.openRestoreDialog(version.number, restore));
        row.append(checkbox, versionText, el('span', {}, `${version.parts_cost_text} - ${version.step_count} steps`), restore);
        list.append(row);
      }
      if (data.next_cursor === null) loadMore.setAttribute('aria-disabled', 'true');
    } catch {
      // The list stays empty; the region remains open.
    }
  }

  private openRestoreDialog(versionNumber: number, opener: HTMLElement): void {
    const dialog = el('dialog', { 'aria-label': `Restore version ${versionNumber}` });
    const body = el('div', { class: 'dialog__body' });
    body.append(el('p', {}, `Restore version ${versionNumber}?`));
    const restore = el('button', { class: 'pw-btn' }, 'Restore');
    const cancel = el('button', { class: 'pw-btn' }, 'Cancel');
    body.append(restore, cancel);
    dialog.append(body);
    document.body.append(dialog);
    dialog.showModal();
    restore.focus();
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      dialog.remove();
      opener.focus();
    });
    restore.addEventListener('click', async () => {
      try {
        const result = await api<{ number: number; restored_from: number }>(`/api/guides/${this.working.id}/versions/${versionNumber}/restore`, { body: {} });
        this.working.latest_version = result.number;
        this.latestVersionStatus.textContent = COPY.latestVersion(result.number);
        announceExpiring('editor', COPY.editor.restored(versionNumber, result.number));
        const refreshed = await api<WorkingJson>(`/api/guides/${this.working.id}/working`);
        this.working = refreshed;
        this.fieldRevision = { ...refreshed.field_revisions };
        this.renderSteps();
        this.renderPartsTree();
        dialog.close();
      } catch {
        announceExpiring('editor', COPY.editor.commitFailed);
      }
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dialog.close();
      }
    });
  }

  private async openCompare(compareButton: HTMLElement): Promise<void> {
    const [older, newer] = [...this.pickedVersions].sort((a, b) => a - b);
    try {
      const data = await api<{
        older: number; newer: number;
        added: { position: number; title: string }[];
        removed: { position: number; title: string }[];
        changed: { position: number; title: string; fields: string[] }[];
        moved: { title: string; from: number; to: number }[];
        part_changes: { part: string; field: string; from: unknown; to: unknown }[];
        cost_difference_text: string;
      }>(`/api/guides/${this.working.id}/versions/compare?older=${older}&newer=${newer}`);
      this.compareRegion?.remove();
      const region = el('div', { role: 'region', 'aria-label': 'Version compare', class: 'compare-region' });
      const heading = el('h2', {}, `Version ${older} to version ${newer}`);
      const olderVersion = await api<{ steps: WorkingStep[]; parts: WorkingPart[]; parts_cost_text: string }>(`/api/guides/${this.working.id}/versions/${older}`);
      const newerVersion = await api<{ steps: WorkingStep[]; parts: WorkingPart[]; parts_cost_text: string }>(`/api/guides/${this.working.id}/versions/${newer}`);
      const sideBySide = el('div', { class: 'compare-fields' });
      sideBySide.append(buildCompareField(`Version ${older}`, olderVersion), buildCompareField(`Version ${newer}`, newerVersion));
      region.append(heading, sideBySide);
      // Diff rows.
      const rows = el('div', { class: 'compare-rows' });
      const changedTextRows: Record<number, { removed: string; added: string }> = {};
      for (const change of data.changed) {
        const oldStep = olderVersion.steps.find((step) => step.number === change.position);
        const newStep = newerVersion.steps.find((step) => step.number === change.position);
        if (oldStep && newStep && change.fields.includes('text')) {
          const words = diffWords(oldStep.text, newStep.text);
          changedTextRows[change.position] = words;
        }
      }
      for (const step of newerVersion.steps) {
        const isAdded = data.added.some((entry) => entry.position === step.number);
        const isChanged = data.changed.some((entry) => entry.position === step.number);
        const isMoved = data.moved.some((entry) => entry.title === step.title);
        const label = isAdded ? COPY.compare.added : isChanged ? COPY.compare.changed : isMoved ? COPY.compare.moved : null;
        if (label === null) continue;
        const row = el('div', { class: 'compare-row' });
        row.append(el('span', { class: 'compare-label' }, label));
        row.append(el('span', {}, `Step ${step.number}: ${step.title}`));
        if (isChanged && changedTextRows[step.number]) {
          if (changedTextRows[step.number].removed) row.append(el('div', {}, COPY.compare.removedWords(changedTextRows[step.number].removed)));
          if (changedTextRows[step.number].added) row.append(el('div', {}, COPY.compare.addedWords(changedTextRows[step.number].added)));
        }
        rows.append(row);
      }
      for (const removed of data.removed) {
        const row = el('div', { class: 'compare-row' });
        row.append(el('span', { class: 'compare-label' }, COPY.compare.removed));
        row.append(el('span', {}, `Was step ${removed.position}: ${removed.title}`));
        rows.append(row);
      }
      region.append(rows);
      for (const change of data.part_changes) {
        const row = el('div', { class: 'compare-row' });
        row.append(el('span', {}, `${change.part}: ${change.field} ${String(change.from)} to ${String(change.to)}`));
        region.append(row);
      }
      region.append(el('p', { class: 'compare-cost' }, COPY.compare.costDifference(data.cost_difference_text)));
      this.compareRegion = region;
      this.main.append(region);
    } catch (error) {
      void error;
      void compareButton;
    }
  }

  // ---- model files --------------------------------------------------------

  private chooseModelFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void this.previewFile(file);
    });
    input.click();
  }

  private async previewFile(file: File): Promise<void> {
    const data = new Uint8Array(await file.arrayBuffer());
    const check = checkGlb(data, { model_max_bytes: this.limits.model_max_bytes, model_max_parts: this.limits.model_max_parts });
    if (!check.ok) {
      const refusal = check.refusal;
      if (refusal.code === 'model_too_large') this.stageStatus.textContent = COPY.stage.refusedBytes(refusal.limit);
      else if (refusal.code === 'not_glb') this.stageStatus.textContent = COPY.stage.refusedNotGlb(file.name);
      else if (refusal.code === 'external_uri') this.stageStatus.textContent = COPY.stage.refusedOutside(file.name);
      else this.stageStatus.textContent = COPY.stage.refusedParts(file.name, refusal.count, refusal.limit);
      this.pendingFile = null;
      return;
    }
    this.pendingFile = file;
    this.uploadButton.removeAttribute('aria-disabled');
    await this.stage.loadModelBytes(data.buffer);
    this.stageStatus.textContent = COPY.stage.previewing(file.name);
    // The preview's node paths feed Bind to node.
    this.nodePaths = this.stage.nodePaths();
  }

  private async uploadModel(): Promise<void> {
    const file = this.pendingFile;
    if (!file) return;
    this.stageStatus.textContent = COPY.stage.uploading(file.name, 0);
    try {
      const data = await file.arrayBuffer();
      const response = await fetch(`/api/guides/${this.working.id}/model`, {
        method: 'POST',
        headers: { 'content-type': 'model/gltf-binary' },
        body: data,
      });
      const json = (await response.json()) as { model?: { bytes: number }; error?: string; limit?: number; count?: number; parts?: number; unbound?: string[] };
      if (!response.ok) {
        if (json.error === 'model_too_large') this.stageStatus.textContent = COPY.stage.refusedBytes(Number(json.limit ?? 0));
        else if (json.error === 'not_glb') this.stageStatus.textContent = COPY.stage.refusedNotGlb(file.name);
        else if (json.error === 'external_uri') this.stageStatus.textContent = COPY.stage.refusedOutside(file.name);
        else if (json.error === 'too_many_parts') this.stageStatus.textContent = COPY.stage.refusedParts(file.name, Number(json.count ?? 0), Number(json.limit ?? 0));
        else if (json.error === 'storage_unavailable') {
          this.stageStatus.textContent = COPY.stage.storageOutAuthor;
          this.stageStatus.classList.add('pw-band');
        }
        return;
      }
      this.stageStatus.textContent = COPY.stage.stored(file.name, Number(json.model?.bytes ?? 0));
      this.pendingFile = null;
      const refreshed = await api<WorkingJson>(`/api/guides/${this.working.id}/working`);
      this.working = refreshed;
      this.renderPartsTree();
    } catch {
      this.stageStatus.textContent = COPY.stage.storageOutAuthor;
    }
  }

  // ---- publish, co-authors, delete -------------------------------------------

  private async publish(): Promise<void> {
    announceExpiring('editor', COPY.editor.publishing);
    try {
      const result = await api<{ state: string; published_version: number }>(`/api/guides/${this.working.id}/publish`, { body: {} });
      announceExpiring('editor', COPY.editor.published(result.published_version));
    } catch (error) {
      const err = error as ApiError;
      const code = err.code;
      const map: Record<string, () => string> = {
        no_version: () => COPY.editor.publishNoVersion,
        model_not_stored: () => COPY.editor.publishNoModel,
        storage_unavailable: () => COPY.editor.publishStorage,
        scale_unconfirmed: () => COPY.editor.publishScale,
        unbound_parts: () => COPY.editor.publishUnbound((err.body.parts as string[] | undefined)?.join(', ') ?? ''),
      };
      announceExpiring('editor', (map[code] ?? (() => COPY.editor.commitFailed))());
    }
  }

  private async withdraw(): Promise<void> {
    try {
      await api(`/api/guides/${this.working.id}/withdraw`, { body: {} });
      announceExpiring('editor', COPY.editor.withdrawn);
    } catch (error) {
      const err = error as ApiError;
      announceExpiring('editor', err.code === 'illegal_transition' ? COPY.editor.commitFailed : COPY.editor.commitFailed);
    }
  }

  private openCoauthorsDialog(): void {
    const dialog = el('dialog', { 'aria-label': 'Co-authors' });
    const body = el('div', { class: 'dialog__body' });
    const email = el('input', { type: 'email', 'aria-label': 'Co-author email' }) as HTMLInputElement;
    const add = el('button', { class: 'pw-btn' }, 'Add co-author');
    const close = el('button', { class: 'pw-btn' }, 'Close');
    body.append(email, add, close);
    dialog.append(body);
    document.body.append(dialog);
    dialog.showModal();
    email.focus();
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    add.addEventListener('click', async () => {
      try {
        await api(`/api/guides/${this.working.id}/coauthors`, { body: { email: email.value } });
        email.value = '';
      } catch (error) {
        const err = error as ApiError;
        announceExpiring('editor', err.code === 'not_found' ? COPY.editor.commitFailed : COPY.editor.commitFailed);
      }
    });
  }

  private openDeleteDialog(): void {
    const dialog = el('dialog', { 'aria-label': 'Delete guide' });
    const body = el('div', { class: 'dialog__body' });
    body.append(el('p', {}, 'Delete this guide?'));
    const remove = el('button', { class: 'pw-btn' }, 'Delete');
    const cancel = el('button', { class: 'pw-btn' }, 'Cancel');
    body.append(remove, cancel);
    dialog.append(body);
    document.body.append(dialog);
    dialog.showModal();
    remove.focus();
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    remove.addEventListener('click', async () => {
      try {
        await api(`/api/guides/${this.working.id}`, { method: 'DELETE' });
        window.location.href = '/dashboard';
      } catch {
        announceExpiring('editor', COPY.editor.commitFailed);
      }
    });
  }

  // ---- conflicts and live ----------------------------------------------------

  private openConflictDialog(body: Record<string, unknown>, field: string, value: unknown, fieldLabelText?: string): void {
    // One conflict dialog at a time: a second arrival updates nothing while one is open.
    const existing = document.querySelector('dialog[role="alertdialog"][open]');
    if (existing) return;
    const theirs = body.theirs as { value?: unknown; by?: string; revision?: number } | undefined;
    const dialog = el('dialog', { role: 'alertdialog', 'aria-label': 'Edit conflict' });
    const dialogBody = el('div', { class: 'dialog__body' });
    dialogBody.append(el('p', {}, COPY.conflictDialog(theirs?.by ?? '', fieldLabelText ?? field)));
    const yoursBlock = el('div', { class: 'compare-field' });
    yoursBlock.append(el('h3', {}, 'Yours'));
    yoursBlock.append(el('p', {}, String(value ?? '')));
    const theirsBlock = el('div', { class: 'compare-field' });
    theirsBlock.append(el('h3', {}, 'Theirs'));
    theirsBlock.append(el('p', {}, String(theirs?.value ?? '')));
    const keepMine = el('button', { class: 'pw-btn' }, 'Keep mine');
    const takeTheirs = el('button', { class: 'pw-btn' }, 'Take theirs');
    dialogBody.append(yoursBlock, theirsBlock, keepMine, takeTheirs);
    dialog.append(dialogBody);
    document.body.append(dialog);
    dialog.showModal();
    keepMine.focus();
    const closeDialog = (): void => {
      dialog.close();
      dialog.remove();
    };
    keepMine.addEventListener('click', async () => {
      const basedOn = this.fieldRevision[field] ?? 0;
      try {
        const result = await api<{ field_revision: number }>(`/api/guides/${this.working.id}/working`, {
          method: 'PATCH',
          body: { field, value, based_on: basedOn },
        });
        this.fieldRevision[field] = result.field_revision;
        this.writeLocal(field, value);
        announceExpiring('editor', COPY.editor.conflictKept(fieldLabelText ?? field));
        closeDialog();
      } catch (retry) {
        const err = retry as ApiError;
        if (err.code === 'edit_conflict') {
          this.fieldRevision[field] = Number((err.body.theirs as { revision: number } | undefined)?.revision ?? 0);
          keepMine.click();
        }
      }
    });
    takeTheirs.addEventListener('click', () => {
      this.writeLocal(field, theirs?.value ?? null);
      this.fieldRevision[field] = Number((theirs as unknown as { revision?: number })?.revision ?? this.fieldRevision[field] ?? 0);
      announceExpiring('editor', COPY.editor.conflictTook(theirs?.by ?? '', fieldLabelText ?? field));
      closeDialog();
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
      }
    });
  }

  private onLiveEvent(event: { type: string; [key: string]: unknown }): void {
    if (event.type === 'presence') {
      this.renderPeople(event.people as { id: string; name: string; step: number | null }[]);
    }
    if (event.type === 'edit') {
      const field = String(event.field);
      const value = event.value;
      const revision = Number(event.field_revision ?? 0);
      if (revision > 0) this.fieldRevision[field] = revision;
      if (this.uncommitted.has(field)) {
        // An incoming change to a field with uncommitted text opens the conflict.
        try {
          this.openConflictDialog({ theirs: { value, by: String(event.by ?? ''), revision } }, field, this.readLocal(field), this.controlLabelFor(field));
        } catch {
          // A second conflict on the same field keeps the open dialog.
        }
        return;
      }
      this.writeLocal(field, value);
      if (field === 'title') this.titleInput.value = String(value);
      if (field === 'visibility') this.visibilitySelect.value = String(value);
      if (field === 'currency') this.currencySelect.value = String(value);
      if (field === 'tags') this.tagsInput.value = (value as string[]).join(', ');
      this.renderSteps();
    }
    if (event.type === 'steps') {
      void this.refreshWorking();
    }
    if (event.type === 'version') {
      this.working.latest_version = Number(event.number);
      this.latestVersionStatus.textContent = COPY.latestVersion(Number(event.number));
    }
    if (event.type === 'question') {
      announceExpiring('question-alerts', COPY.questionAlerts.toAuthor(this.working.title, Number(event.step ?? 0)));
    }
    if (event.type === 'state') {
      void this.refreshWorking();
    }
  }

  private renderPeople(people: { id: string; name: string; step: number | null }[]): void {
    const others = people.filter((person) => person.id !== this.viewerId);
    const signature = others.map((person) => COPY.peopleEditing(person.name, person.step)).join('|');
    if (signature === this.peopleSignature) return;
    this.peopleSignature = signature;
    this.peopleEditing.textContent = '';
    for (const person of others) {
      this.peopleEditing.append(el('li', { role: 'listitem' }, COPY.peopleEditing(person.name, person.step)));
    }
  }

  private peopleSignature = '';

  /** The accessible name of the control behind a field path. */
  private controlLabelFor(field: string): string {
    const [kind, id, name] = field.split('/');
    if (kind === 'step') {
      const step = this.working.steps.find((entry) => entry.id === id);
      const n = step ? step.number : 0;
      const labels: Record<string, string> = { title: 'title', text: 'text', phase: 'phase', explode: 'apart amount', focus_parts: 'parts', camera: 'view', callouts: 'callouts' };
      return `Step ${n} ${labels[name] ?? name}`;
    }
    if (kind === 'part') {
      const part = this.working.parts.find((entry) => entry.id === id);
      const labels: Record<string, string> = { name: 'name', axis: 'axis', apart_mm: 'apart distance', quantity: 'quantity', unit_price: 'unit price', fitted_at: 'fitted at step', node_path: 'node' };
      return `Part ${part?.name ?? id} ${labels[name] ?? name}`;
    }
    if (field === 'title') return 'Guide title';
    if (field === 'currency') return 'Currency';
    if (field === 'tags') return 'Tags';
    if (field === 'visibility') return 'Visibility';
    if (field === 'model_scale') return 'Model scale';
    if (field === 'model_scale_confirmed') return 'Confirm scale';
    return field;
  }

  private async refreshWorking(): Promise<void> {
    try {
      const refreshed = await api<WorkingJson>(`/api/guides/${this.working.id}/working`);
      this.working = refreshed;
      this.fieldRevision = { ...refreshed.field_revisions };
      // Preserve focus and any uncommitted text across the re-render.
      const active = document.activeElement as HTMLElement | null;
      const activeLabel = active?.getAttribute('aria-label') ?? null;
      const activeStart = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active.selectionStart : null;
      const activeValue = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active.value : null;
      const stepSignature = JSON.stringify(this.working.steps.map((step) => [step.id, step.title, step.text, step.phase, step.explode]));
      if (stepSignature !== this.lastStepSignature) {
        this.renderSteps();
        this.lastStepSignature = stepSignature;
      }
      this.renderPartsGroup();
      this.renderPartsTree();
      this.applySelectedStep();
      if (activeLabel) {
        const next = this.main.querySelector(`[aria-label="${activeLabel}"]`) as HTMLElement | null;
        if (next) {
          next.focus();
          if ((next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) && activeValue !== null && next.value === activeValue && activeStart !== null) {
            next.setSelectionRange(activeStart, activeStart);
          }
        }
      }
    } catch {
      // A dropped connection retries; the working copy stays.
    }
  }

  private lastStepSignature = '';
  private viewerId: string | null = null;
  private viewerName = '';
}

function fieldLabel(field: string): string {
  const [kind, id, name] = field.split('/');
  if (kind === 'step') {
    const labels: Record<string, string> = { title: 'title', text: 'text', phase: 'phase', explode: 'apart amount', focus_parts: 'parts', camera: 'view', callouts: 'callouts' };
    return `Step ${id} ${labels[name] ?? name}`;
  }
  if (kind === 'part') {
    const labels: Record<string, string> = { name: 'name', axis: 'axis', apart_mm: 'apart distance', quantity: 'quantity', unit_price: 'unit price', fitted_at: 'fitted at step', node_path: 'node' };
    return `Part ${id} ${labels[name] ?? name}`;
  }
  if (field === 'title') return 'Guide title';
  if (field === 'currency') return 'Currency';
  if (field === 'tags') return 'Tags';
  if (field === 'visibility') return 'Visibility';
  if (field === 'model_scale') return 'Model scale';
  if (field === 'model_scale_confirmed') return 'Confirm scale';
  return field;
}

function majorUnits(minor: number, currency: CurrencyCode): string {
  if (currency === 'JPY') return String(minor);
  return (minor / 100).toFixed(2);
}

function buildCompareField(label: string, version: { steps: WorkingStep[]; parts: WorkingPart[]; parts_cost_text: string }): HTMLElement {
  const field = el('div', { class: 'compare-field' });
  field.append(el('h3', {}, label));
  field.append(el('p', {}, version.parts_cost_text));
  for (const step of version.steps) {
    field.append(el('p', {}, `Step ${step.number}: ${step.title}`));
    field.append(el('p', { class: 'compare-text' }, step.text));
  }
  for (const part of version.parts) {
    if (part.fitted_at === null) continue;
    field.append(el('p', {}, `${part.name}`));
  }
  return field;
}

/** Word-by-word text diff, split on white space. */
function diffWords(olderText: string, newerText: string): { removed: string; added: string } {
  const a = olderText.split(/\s+/).filter(Boolean);
  const b = newerText.split(/\s+/).filter(Boolean);
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    let synced = false;
    for (let lookahead = 1; lookahead <= 8 && !synced; lookahead++) {
      for (let di = 0; di <= lookahead && !synced; di++) {
        const dj = lookahead - di;
        if (a[i + di] !== undefined && b[j + dj] !== undefined && a[i + di] === b[j + dj]) {
          for (let k = i; k < i + di; k++) removed.push(a[k]);
          for (let k = j; k < j + dj; k++) added.push(b[k]);
          i += di;
          j += dj;
          synced = true;
        }
      }
    }
    if (!synced) {
      for (; i < a.length; i++) removed.push(a[i]);
      for (; j < b.length; j++) added.push(b[j]);
    }
  }
  return { removed: removed.join(' '), added: added.join(' ') };
}
