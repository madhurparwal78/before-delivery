import { ApiFailure, del, get, post, readLimits } from '../api';
import { editorStatus, latestVersion, pageText, questionAlert, undoLabel } from '../../shared/copy';
import type { Limits, LiveEvent, User, Working } from '../../shared/types';
import { dialogButtons, openDialog } from '../dialog';
import { h, replace } from '../dom';
import { icon, type IconName } from '../icons';
import { Live } from '../live';
import { Status } from '../status';
import { Committer, type CommitHost } from './commits';
import { PartsPane } from './parts-pane';
import { StagePane } from './stage-pane';
import { EditorState, same } from './state';
import { StepsPane } from './steps-pane';
import { UndoStack, type UndoEntry } from './undo';
import { VersionsPanel } from './versions';

const toolbarOrder: { name: string; icon: IconName }[] = [
  { name: 'Add step', icon: 'plus' }, { name: 'Undo', icon: 'undo_2' }, { name: 'Redo', icon: 'redo_2' }, { name: 'Save version', icon: 'save' },
  { name: 'Versions', icon: 'history' }, { name: 'Choose a model file', icon: 'file_box' }, { name: 'Upload model', icon: 'upload' },
  { name: 'Co-authors', icon: 'users' }, { name: 'Publish', icon: 'send' }, { name: 'Withdraw', icon: 'eye_off' }, { name: 'Delete guide', icon: 'trash_2' },
];

export class Editor implements CommitHost {
  readonly guideId: string;
  readonly state: EditorState;
  readonly status = new Status('Editor status', 'editor-status');
  readonly undo = new UndoStack();
  readonly committer: Committer;
  readonly panes: { steps: StepsPane; parts: PartsPane; stage: StagePane };
  nodePaths: string[] = [];
  private readonly latest = new Status('Latest version', 'latest-version');
  private readonly alerts = new Status('Question alerts', 'guide-status');
  private readonly people = h('ul', { 'aria-label': 'People editing', class: 'people' });
  private readonly total = h('span', { class: 'figure-value', 'data-figure': 'total-cost' });
  private readonly title = h('h1', { class: 'editor-title' });
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly versionsHost = h('div', { class: 'versions-host' });
  private readonly versions: VersionsPanel;
  private readonly workspace = h('div', { class: 'workspace' });
  private readonly tabs = h('div', { role: 'tablist', 'aria-label': 'Editor panes', class: 'tabs' });
  private readonly header = h('header', { class: 'editor-header' });
  private readonly separator = h('div', { role: 'separator', tabindex: 0, 'aria-label': 'Resize stage and steps', 'aria-orientation': 'vertical', 'aria-valuemin': 30, 'aria-valuemax': 70, 'aria-valuenow': 50, class: 'separator' });
  private pct = 50;
  private tab: 'stage' | 'steps' | 'parts' = 'stage';
  private live!: Live;

  constructor(work: Working, readonly user: User, private readonly role: 'owner' | 'coauthor', readonly limits: Limits) {
    this.guideId = work.id;
    this.state = new EditorState(work);
    this.committer = new Committer(this);
    this.panes = { steps: new StepsPane(this), parts: new PartsPane(this), stage: new StagePane(this) };
    this.versions = new VersionsPanel(this, this.buttonFor('Versions'), this.versionsHost);
  }

  private buttonFor(name: string): HTMLButtonElement {
    let button = this.buttons.get(name);
    if (!button) {
      const spec = toolbarOrder.find((t) => t.name === name)!;
      button = h('button', { type: 'button', class: 'button tool' }, icon(spec.icon), h('span', {}, name));
      this.buttons.set(name, button);
    }
    return button;
  }

  mount(root: HTMLElement): void {
    const toolbar = h('div', { role: 'toolbar', 'aria-label': 'Editor tools', class: 'toolbar' }, ...toolbarOrder.map((t) => this.buttonFor(t.name)));
    this.wireToolbar();
    const credit = this.state.work.forked_from;
    this.header.append(
      this.title, this.latest.element,
      h('p', { class: 'header-total' }, h('span', { class: 'figure-label' }, 'Guide total '), this.total),
      this.people, this.alerts.element);
    if (credit) this.header.append(h('p', { class: 'credit' }, pageText.forkCredit(credit.title, credit.author_name, credit.version)));
    this.workspace.append(this.panes.stage.element, this.separator, this.panes.steps.element, this.panes.parts.element);
    for (const [key, label] of [['stage', 'Stage'], ['steps', 'Steps'], ['parts', 'Parts']] as const) {
      const tab = h('button', { type: 'button', role: 'tab', class: 'tab', 'data-tab': key, 'aria-selected': 'false' }, label);
      tab.addEventListener('click', () => this.chooseTab(key));
      tab.addEventListener('keydown', (event) => {
        const order = ['stage', 'steps', 'parts'] as const;
        const at = order.indexOf(this.tab);
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const next = order[(at + (event.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length]!;
        this.chooseTab(next);
        this.tabs.querySelector<HTMLElement>(`[data-tab=${next}]`)?.focus();
      });
      this.tabs.append(tab);
    }
    root.append(h('main', { class: 'editor' }, this.header, toolbar, this.status.element, this.versionsHost, this.tabs, this.workspace));
    this.panes.parts.bindTree();
    this.bindSeparator();
    this.refreshHeader();
    this.panes.steps.sync();
    this.panes.parts.sync();
    this.panes.parts.syncFields();
    this.setLatest(this.state.work.latest_version);
    this.syncToolbar();
    const query = matchMedia('(max-width: 767px)');
    query.addEventListener('change', () => this.layout());
    addEventListener('resize', () => this.layout());
    this.layout();
    document.addEventListener('keydown', (event) => this.shortcuts(event));
    this.live = new Live({ guideId: this.guideId, editor: true, catchUp: () => void this.catchUp(), onEvent: (event) => this.onLive(event) });
    this.live.selectStep(this.state.selectedStep ? this.state.stepNumber(this.state.selectedStep) : 0);
  }

  private layout(): void {
    const phone = matchMedia('(max-width: 767px)').matches;
    const wide = matchMedia('(min-width: 1200px)').matches;
    this.tabs.hidden = !phone;
    this.separator.hidden = !wide;
    const panes = { stage: this.panes.stage.element, steps: this.panes.steps.element, parts: this.panes.parts.element };
    for (const [key, element] of Object.entries(panes)) element.hidden = phone && key !== this.tab;
    for (const tab of this.tabs.querySelectorAll<HTMLElement>('[role=tab]')) {
      const selected = tab.dataset.tab === this.tab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    this.workspace.style.setProperty('--stage-pct', `${this.pct}%`);
    if (phone) this.tabs.before(this.people);
    else this.header.append(this.people, this.alerts.element);
  }

  private chooseTab(tab: 'stage' | 'steps' | 'parts'): void {
    this.tab = tab;
    this.layout();
  }

  private bindSeparator(): void {
    this.separator.addEventListener('keydown', (event) => {
      const next = event.key === 'ArrowLeft' ? this.pct - 5 : event.key === 'ArrowRight' ? this.pct + 5 : event.key === 'Home' ? 30 : event.key === 'End' ? 70 : null;
      if (next === null) return;
      event.preventDefault();
      this.pct = Math.min(70, Math.max(30, next));
      this.separator.setAttribute('aria-valuenow', String(this.pct));
      this.workspace.style.setProperty('--stage-pct', `${this.pct}%`);
    });
  }

  private wireToolbar(): void {
    const on = (name: string, action: () => void | Promise<void>) =>
      this.buttonFor(name).addEventListener('click', () => {
        if (this.buttonFor(name).getAttribute('aria-disabled') === 'true') return;
        void action();
      });
    on('Add step', () => this.addStep());
    on('Undo', () => this.undoAction());
    on('Redo', () => this.redoAction());
    on('Save version', () => this.save());
    on('Versions', () => (this.versions.isOpen ? this.versions.close() : this.versions.open()));
    on('Choose a model file', () => this.panes.stage.chooseFile());
    on('Upload model', () => this.panes.stage.upload());
    on('Co-authors', () => this.coauthorsDialog());
    on('Publish', () => this.publish());
    on('Withdraw', () => this.withdraw());
    on('Delete guide', () => this.deleteDialog());
    this.buttonFor('Versions').setAttribute('aria-expanded', 'false');
  }

  syncToolbar(): void {
    const owner = this.role === 'owner';
    const disabled: Record<string, boolean> = {
      Undo: !this.undo.canUndo, Redo: !this.undo.canRedo, 'Upload model': !this.panes.stage.hasPreview,
      'Co-authors': !owner, Publish: !owner || this.state.work.state === 'published', Withdraw: !owner || this.state.work.state !== 'published', 'Delete guide': !owner,
    };
    for (const [name, button] of this.buttons) button.setAttribute('aria-disabled', String(disabled[name] === true));
  }

  private shortcuts(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      void this.save();
    } else if (key === 'z') {
      event.preventDefault();
      void (event.shiftKey ? this.redoAction() : this.undoAction());
    }
  }

  // ---- CommitHost ----
  onApplied(path: string, remote = false): void {
    const [kind, id, name] = path.split('/');
    if (kind === 'title') this.refreshHeader();
    if (kind === 'step' && id === this.state.selectedStep) this.panes.stage.sync();
    if (kind === 'step' && remote && (name === 'focus_parts' || name === 'callouts')) this.panes.steps.syncParts();
    if (kind === 'part' || kind === 'currency') this.panes.parts.sync();
    if (kind === 'part' && (name === 'axis' || name === 'apart_mm')) this.panes.stage.refreshParts();
    if (kind === 'part' && name === 'name') this.panes.steps.syncParts();
    if (kind === 'currency' || kind === 'model_scale' || kind === 'model_scale_confirmed') this.panes.stage.sync();
  }

  onTotal(_total: number, text: string): void {
    this.total.textContent = text;
  }

  private refreshHeader(): void {
    this.title.textContent = this.state.work.title;
    this.total.textContent = this.state.work.guide_total_text;
  }

  /** Version numbers only grow, so a working copy fetched before a newer version arrived over the live connection never lowers it. */
  setLatest(n: number | null): void {
    const newest = Math.max(n ?? 0, this.state.work.latest_version ?? 0) || null;
    this.state.work.latest_version = newest;
    this.latest.set(latestVersion(newest));
  }

  // ---- selection ----
  selectStep(id: string): void {
    if (this.state.selectedStep === id) return;
    this.state.selectedStep = id;
    this.panes.stage.sync();
    this.panes.steps.syncParts();
    this.live.selectStep(this.state.stepNumber(id));
  }

  selectPart(id: string): void {
    this.state.selectedPart = id;
    this.panes.parts.sync();
    this.panes.parts.syncFields();
  }

  // ---- working copy ----
  async reloadWorking(): Promise<void> {
    let work: Working;
    let before: { started: number; active: number };
    do {
      before = this.committer.activity;
      work = await get<Working>(`/api/guides/${this.guideId}/working`);
    } while (before.active > 0 || this.committer.activity.started !== before.started);
    const known = this.state.work.latest_version;
    this.state.work = work;
    work.latest_version = Math.max(work.latest_version ?? 0, known ?? 0) || null;
    if (!this.state.selectedStep || !this.state.step(this.state.selectedStep)) this.state.selectedStep = work.steps[0]?.id ?? null;
    if (this.state.selectedPart && !this.state.part(this.state.selectedPart)) this.state.selectedPart = null;
    this.refreshHeader();
    this.panes.steps.sync();
    this.panes.parts.sync();
    this.panes.parts.syncFields();
    if (this.panes.stage.stage.state() === 'ready' || this.panes.stage.stage.state() === 'loading') await this.panes.stage.loadModel(true);
    else this.panes.stage.sync();
    this.setLatest(work.latest_version);
    this.syncToolbar();
    this.live?.selectStep(this.state.selectedStep ? this.state.stepNumber(this.state.selectedStep) : 0);
  }

  private async catchUp(): Promise<void> {
    await this.reloadWorking();
    await this.versions.arrived();
  }

  private onLive(event: LiveEvent): void {
    if (event.type === 'field') this.committer.applyRemote(event);
    else if (event.type === 'working') void this.reloadWorking();
    else if (event.type === 'version') {
      this.setLatest(event.latest_version);
      void this.versions.arrived();
    } else if (event.type === 'state') {
      this.state.work.state = event.state;
      this.syncToolbar();
    } else if (event.type === 'presence') {
      replace(this.people, ...event.people.map((p) => h('li', {}, p.step ? `${p.name}, step ${p.step}` : `${p.name}, no step`)));
    } else if (event.type === 'alert_question') this.alerts.set(questionAlert.toAuthor(event.guide_title, event.step));
  }

  // ---- steps ----
  async addStep(): Promise<void> {
    await this.committer.flushAll();
    try {
      const made = await post<{ id: string; number: number }>(`/api/guides/${this.guideId}/steps`, { title: '' });
      this.undo.record({ kind: 'add', stepId: made.id, step: null, position: made.number, label: undoLabel.addStep(made.number) });
      this.syncToolbar();
      await this.reloadWorking();
      this.state.selectedStep = made.id;
      this.panes.steps.sync();
      this.panes.stage.sync();
      this.panes.steps.focusTitle(made.id);
      this.status.flash(editorStatus.stepAdded(made.number));
    } catch (error) {
      this.status.flash(error instanceof ApiFailure && error.code === 'too_many' ? editorStatus.tooManySteps(this.limits.guide_step_max) : editorStatus.commitFailed, 'error');
    }
  }

  async deleteStep(id: string): Promise<void> {
    await this.committer.flushAll();
    const step = structuredClone(this.state.step(id)!);
    const position = step.number;
    const fitted = this.state.work.parts.filter((p) => p.fitted_at === id).map((p) => p.id);
    await del(`/api/guides/${this.guideId}/steps/${id}`);
    if (this.state.selectedStep === id) this.state.selectedStep = null;
    await this.reloadWorking();
    this.status.flash(editorStatus.stepDeleted(position));
    this.undo.record({ kind: 'delete', step, position, fitted, label: undoLabel.deleteStep(position) });
    this.syncToolbar();
  }

  async moveStep(id: string, delta: -1 | 1, record = true): Promise<void> {
    const from = this.state.stepNumber(id);
    const to = from + delta;
    if (to < 1) return this.status.flash(editorStatus.stepFirst(from));
    if (to > this.state.work.steps.length) return this.status.flash(editorStatus.stepLast(from));
    await this.moveTo(id, to);
    this.status.flash(editorStatus.stepMoved(from, to));
    if (record) this.undo.record({ kind: 'move', stepId: id, from, to, label: undoLabel.moveStep(from, to) });
    this.syncToolbar();
  }

  private async moveTo(id: string, position: number): Promise<void> {
    const steps = this.state.work.steps;
    const [moved] = steps.splice(steps.findIndex((s) => s.id === id), 1);
    steps.splice(position - 1, 0, moved!);
    steps.forEach((s, i) => { s.number = i + 1; });
    this.panes.steps.sync();
    this.panes.stage.sync();
    await post(`/api/guides/${this.guideId}/steps/${id}/move`, { position });
  }

  // ---- undo and redo ----
  async undoAction(): Promise<void> {
    await this.committer.flushAll();
    const entry = this.undo.popUndo();
    if (!entry) return this.status.flash(editorStatus.nothingToUndo);
    if (await this.reverse(entry, 'undo')) {
      this.undo.pushRedo(entry);
      this.status.flash(editorStatus.undid(entry.label));
    }
    this.syncToolbar();
  }

  async redoAction(): Promise<void> {
    await this.committer.flushAll();
    const entry = this.undo.popRedo();
    if (!entry) return this.status.flash(editorStatus.nothingToRedo);
    if (await this.reverse(entry, 'redo')) {
      this.undo.pushUndo(entry);
      this.status.flash(editorStatus.redid(entry.label));
    }
    this.syncToolbar();
  }

  private async reverse(entry: UndoEntry, direction: 'undo' | 'redo'): Promise<boolean> {
    const undoing = direction === 'undo';
    if (entry.kind === 'field') {
      const expected = undoing ? entry.after : entry.before;
      if (!same(this.state.read(entry.path), expected)) {
        this.status.flash(editorStatus.undoBlocked(this.state.lastBy.get(entry.path) ?? ''), 'error');
        return false;
      }
      const value = undoing ? entry.before : entry.after;
      const done = await this.committer.commit(entry.path, value, {});
      if (done) this.committer.bindingFor(entry.path)?.show(value);
      return done;
    }
    if (entry.kind === 'move') {
      await this.moveTo(entry.stepId, undoing ? entry.from : entry.to);
      return true;
    }
    const stepId = entry.kind === 'add' ? entry.stepId : entry.step.id;
    const remove = (entry.kind === 'add') === undoing;
    if (remove) {
      if (entry.kind === 'add') entry.step = structuredClone(this.state.step(stepId) ?? null);
      await del(`/api/guides/${this.guideId}/steps/${stepId}`);
      if (this.state.selectedStep === stepId) this.state.selectedStep = null;
      await this.reloadWorking();
      return true;
    }
    if (!entry.step) return false;
    const { id, title, text, phase, explode, focus_parts, camera, callouts } = entry.step;
    await post(`/api/guides/${this.guideId}/steps`, { id, title, text, phase, explode, focus_parts, camera, callouts, position: entry.position });
    await this.reloadWorking();
    if (entry.kind === 'delete') for (const part of entry.fitted) await this.committer.commit(`part/${part}/fitted_at`, id, {});
    return true;
  }

  // ---- versions, publish ----
  async save(): Promise<void> {
    await this.committer.flushAll();
    this.status.set(editorStatus.saving);
    try {
      const made = await post<{ number: number }>(`/api/guides/${this.guideId}/versions`, { base_version: this.state.work.latest_version });
      this.setLatest(made.number);
      await this.versions.arrived();
      this.status.flash(editorStatus.saved(made.number));
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'version_conflict') {
        const base = this.state.work.latest_version;
        const current = Number(error.body.current);
        this.status.flash(editorStatus.stale(current), 'error');
        await this.versions.open();
        if (base !== null) await this.versions.compare(base, current);
        this.setLatest(current);
      } else this.status.flash(editorStatus.commitFailed, 'error');
    }
  }

  async publish(): Promise<void> {
    this.status.set(editorStatus.publishing);
    try {
      const done = await post<{ published_version: number }>(`/api/guides/${this.guideId}/publish`, {});
      this.state.work.state = 'published';
      this.status.flash(editorStatus.published(done.published_version));
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : '';
      const copy = code === 'no_version' ? editorStatus.needVersion
        : code === 'model_not_stored' ? editorStatus.needModel
        : code === 'storage_unavailable' ? editorStatus.publishStorageOut
        : code === 'unbound_parts' ? editorStatus.unboundParts((error as ApiFailure).body.parts as string[])
        : code === 'scale_unconfirmed' ? editorStatus.needScale : editorStatus.commitFailed;
      this.status.flash(copy, 'error');
    }
    this.syncToolbar();
  }

  async withdraw(): Promise<void> {
    try {
      await post(`/api/guides/${this.guideId}/withdraw`, {});
      this.state.work.state = 'withdrawn';
      this.status.flash(editorStatus.withdrawn);
    } catch {
      this.status.flash(editorStatus.commitFailed, 'error');
    }
    this.syncToolbar();
  }

  // ---- dialogs ----
  private coauthorsDialog(): void {
    const email = h('input', { id: 'coauthor-email', type: 'email', class: 'field-input', autocomplete: 'off' });
    const list = h('ul', { class: 'rows' });
    const notice = h('p', { class: 'status', role: 'status', 'aria-label': 'Co-author status', 'data-tone': 'error' });
    const add = h('button', { type: 'button', class: 'button' }, 'Add co-author');
    const close = h('button', { type: 'button', class: 'button quiet' }, 'Close');
    const paint = () => replace(list, ...this.state.work.coauthors.map((c) => {
      const remove = h('button', { type: 'button', class: 'button quiet', 'aria-label': `Remove ${c.name}` }, `Remove ${c.name}`);
      remove.addEventListener('click', async () => {
        await del(`/api/guides/${this.guideId}/coauthors/${c.id}`);
        this.state.work.coauthors = this.state.work.coauthors.filter((x) => x.id !== c.id);
        paint();
      });
      return h('li', { class: 'row' }, remove);
    }));
    paint();
    const dialog = openDialog('Co-authors', [
      h('h2', {}, 'Co-authors'),
      h('label', { class: 'cell', for: 'coauthor-email' }, h('span', { class: 'cell-label' }, 'Co-author email'), email),
      notice, list, dialogButtons(add, close)]);
    close.addEventListener('click', dialog.close);
    add.addEventListener('click', async () => {
      try {
        const person = await post<{ id: string; name: string }>(`/api/guides/${this.guideId}/coauthors`, { email: email.value });
        if (!this.state.work.coauthors.some((c) => c.id === person.id)) this.state.work.coauthors.push(person);
        email.value = '';
        notice.textContent = '';
        paint();
      } catch {
        notice.textContent = editorStatus.commitFailed;
      }
    });
  }

  private deleteDialog(): void {
    const confirm = h('button', { type: 'button', class: 'button' }, 'Delete');
    const cancel = h('button', { type: 'button', class: 'button quiet' }, 'Cancel');
    const dialog = openDialog('Delete guide', [
      h('h2', {}, 'Delete guide'),
      h('p', {}, 'This removes the guide, its versions and its questions. Forks of it keep working.'),
      dialogButtons(confirm, cancel)]);
    cancel.addEventListener('click', dialog.close);
    confirm.addEventListener('click', async () => {
      await del(`/api/guides/${this.guideId}`);
      location.assign('/dashboard');
    });
  }
}

export async function mountEditor(root: HTMLElement, work: Working, user: User, role: 'owner' | 'coauthor'): Promise<void> {
  const editor = new Editor(work, user, role, await readLimits());
  editor.mount(root);
}

