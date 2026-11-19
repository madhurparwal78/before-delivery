import {
  editConflictText,
  editLabel,
  editorStatus,
  latestVersion as latestVersionCopy,
  peopleEditingItem,
  questionAlerts,
  stageStatus,
} from '../shared/copy.js';
import { PHASE_FIELD } from '../shared/palette.js';
import { MOTION } from '../shared/scrollmap.js';
import type { Limits } from '../shared/limits.js';
import { codePointLength } from '../shared/limits.js';
import type { GuideWorking, Part, SessionUser, Step } from '../shared/types.js';
import { call } from './api.js';
import {
  Dialog,
  byLabel,
  isDisabled,
  need,
  requireDialog,
  setDisabled,
  Status,
  trackViewportHeight,
} from './dom.js';
import { EditorState, type Conflict } from './editor-state.js';
import { ModelPanel } from './editor-model.js';
import { VersionsPanel } from './editor-versions.js';
import { Delay, prefersReducedMotion } from './motion.js';
import { LiveConnection, newClientId } from './live.js';
import { Stage, attachStageInput, webglAvailable } from './stage.js';

export interface EditorBootstrap {
  working: GuideWorking;
  viewer: SessionUser;
  owner: boolean;
  storageOut: boolean;
  limits: Limits;
}

const SEPARATOR_STEP = 5;
const SEPARATOR_MIN = 30;
const SEPARATOR_MAX = 70;

export function startEditor(data: EditorBootstrap): void {
  trackViewportHeight();
  const working = data.working;
  const state = new EditorState(working.id, working, data.viewer);
  const status = new Status('Editor status');
  const stageStatusRegion = new Status('Stage status');
  const latestRegion = byLabel<HTMLElement>('Latest version');
  const totalFigure = document.querySelector<HTMLElement>('[data-figure="total-cost"]');
  const alerts = new Status('Question alerts');
  const peopleList = byLabel<HTMLElement>('People editing');

  let steps: Step[] = working.steps.map((step) => ({ ...step }));
  let parts: Part[] = working.parts.map((part) => ({ ...part }));
  let selectedStep = steps[0]?.id ?? null;
  let selectedPart: string | null = null;
  let freeLook = false;

  const stageElement = need<HTMLElement>('.stage');
  const stage = webglAvailable()
    ? new Stage({ element: stageElement, canvas: need<HTMLCanvasElement>('.stage-canvas', stageElement) })
    : null;

  /* ---- Stage ---- */
  if (stage !== null) {
    attachStageInput(stage, {
      onManualMove: () => undefined,
      savedPose: () => poseOf(selectedStep),
      freeLookOn: () => freeLook,
    });
    if (data.storageOut) {
      stage.setState('error');
      byLabel<HTMLElement>('Stage status')?.setAttribute('data-outage', 'true');
      stageStatusRegion.say(stageStatus.storageOutAuthor);
    } else if (working.model === null) {
      stage.setState('ready');
      stageStatusRegion.say(stageStatus.noModel);
    } else {
      stageStatusRegion.say(stageStatus.loading);
      void loadModel();
    }
  }

  async function loadModel(): Promise<void> {
    if (stage === null || working.model === null) return;
    try {
      await stage.load(`/api/models/${working.model.id}.glb`, parts, working.model.scale);
      stage.setState('ready');
      stageStatusRegion.say(stageStatus.ready);
      byLabel<HTMLElement>('Stage status')?.setAttribute('data-outage', 'false');
      applySelectedStepToStage();
    } catch {
      stage.setState('error');
      byLabel<HTMLElement>('Stage status')?.setAttribute('data-outage', 'true');
      stageStatusRegion.say(stageStatus.storageOutAuthor);
      window.setTimeout(() => void loadModel(), MOTION.modelRetry);
    }
  }

  function stepById(id: string | null): Step | undefined {
    return steps.find((step) => step.id === id);
  }

  function poseOf(id: string | null) {
    const step = stepById(id);
    return {
      explode: step?.explode ?? 0,
      yaw: step?.camera.yaw ?? 30,
      pitch: step?.camera.pitch ?? 15,
      zoom: 1,
    };
  }

  function applySelectedStepToStage(): void {
    const step = stepById(selectedStep);
    stageElement.setAttribute('data-step', String(step?.number ?? 0));
    if (stage === null) return;
    stage.applyPose(poseOf(selectedStep));
    stage.setFocus(step?.focus_parts ?? []);
    if (step !== undefined) {
      stage.setColours(PHASE_FIELD[step.phase], null, null);
    }
  }

  /* ---- Commits ---- */
  const delays = new Map<string, Delay>();
  const pendingBefore = new Map<string, unknown>();

  function delayFor(field: string): Delay {
    const existing = delays.get(field);
    if (existing !== undefined) return existing;
    const created = new Delay();
    delays.set(field, created);
    return created;
  }

  function limitFor(field: string): { limit: number; label: string } | null {
    const parts = field.split('/');
    if (field === 'title') return { limit: data.limits.guide_title_max, label: 'Guide title' };
    if (parts[0] === 'step' && parts[2] === 'title') {
      const step = stepById(parts[1] ?? '');
      return { limit: data.limits.step_title_max, label: `Step ${step?.number ?? 0} title` };
    }
    if (parts[0] === 'step' && parts[2] === 'text') {
      const step = stepById(parts[1] ?? '');
      return { limit: data.limits.step_text_max, label: `Step ${step?.number ?? 0} text` };
    }
    if (parts[0] === 'part' && parts[2] === 'name') return { limit: data.limits.part_name_max, label: 'Part name' };
    return null;
  }

  /** Text and number fields commit after the published delay; one commit is one undo entry. */
  function scheduleCommit(
    field: string,
    value: () => unknown,
    label: () => string,
    before: unknown,
    delay = MOTION.commitDelay,
  ): void {
    if (!pendingBefore.has(field)) pendingBefore.set(field, before);
    delayFor(field).schedule(delay, () => void runCommit(field, value(), label()));
  }

  async function runCommit(field: string, value: unknown, label: string): Promise<void> {
    const limit = limitFor(field);
    if (limit !== null && typeof value === 'string' && codePointLength(value) > limit.limit) {
      status.sayAndClear(editorStatus.textOverLimit(limit.label, limit.limit));
      return;
    }
    const before = pendingBefore.get(field);
    pendingBefore.delete(field);
    const outcome = await state.commit({ field, label, before, after: value }, true);
    if (outcome.ok) {
      applyLocalField(field, value);
      refreshTotal();
      return;
    }
    if (outcome.conflict !== undefined) {
      openConflict(outcome.conflict, value);
      return;
    }
    status.sayAndClear(editorStatus.commitFailed);
  }

  function refreshTotal(): void {
    if (totalFigure !== null && totalFigure.textContent !== state.guideTotalText) {
      totalFigure.textContent = state.guideTotalText;
      status.sayAndClear(editorStatus.totalChanged(state.guideTotalText));
    }
  }

  /* ---- Local model of the working copy ---- */
  function applyLocalField(field: string, value: unknown): void {
    const segments = field.split('/');
    if (segments.length === 1) {
      if (field === 'model_scale' && typeof value === 'number') stage?.setModelScale(value);
      return;
    }
    const [kind, id, name] = segments;
    if (kind === 'step') {
      const step = steps.find((candidate) => candidate.id === id);
      if (step === undefined || name === undefined) return;
      if (name === 'title' && typeof value === 'string') step.title = value;
      if (name === 'text' && typeof value === 'string') step.text = value;
      if (name === 'phase' && typeof value === 'string') step.phase = value as Step['phase'];
      if (name === 'explode' && typeof value === 'number') step.explode = value;
      if (name === 'focus_parts' && Array.isArray(value)) step.focus_parts = value as string[];
      if (name === 'camera' && typeof value === 'object' && value !== null) {
        step.camera = value as Step['camera'];
      }
      if (name === 'callouts' && Array.isArray(value)) step.callouts = value as Step['callouts'];
      if (step.id === selectedStep) applySelectedStepToStage();
      return;
    }
    const part = parts.find((candidate) => candidate.id === id);
    if (part === undefined || name === undefined) return;
    if (name === 'name' && typeof value === 'string') part.name = value;
    if (name === 'axis' && typeof value === 'string') part.axis = value as Part['axis'];
    if (name === 'apart_mm' && typeof value === 'number') part.apart_mm = value;
    if (name === 'quantity' && typeof value === 'number') part.quantity = value;
    if (name === 'unit_price' && typeof value === 'number') part.unit_price = value;
    if (name === 'fitted_at') part.fitted_at = value === null ? null : String(value);
    if (name === 'node_path') part.node_path = value === null ? null : String(value);
    applySelectedStepToStage();
  }

  /* ---- Field wiring ---- */
  function wireText(input: HTMLInputElement | HTMLTextAreaElement, field: string, label: () => string): void {
    let before = input.value;
    input.addEventListener('input', () => {
      scheduleCommit(field, () => input.value, label, before);
    });
    input.addEventListener('blur', () => {
      const delay = delays.get(field);
      if (delay?.pending === true) {
        delay.cancel();
        void runCommit(field, input.value, label());
      }
      before = input.value;
    });
    input.addEventListener('focus', () => {
      before = input.value;
    });
  }

  function wireSelect(select: HTMLSelectElement, field: string, label: () => string): void {
    let before = select.value;
    select.addEventListener('change', () => {
      const previous = before;
      before = select.value;
      scheduleCommit(field, () => select.value, label, previous);
    });
  }

  function wireGuideDetails(): void {
    const title = byLabel<HTMLInputElement>('Guide title');
    if (title !== null) wireText(title, 'title', () => editLabel.guideTitle);
    const currency = byLabel<HTMLSelectElement>('Currency');
    if (currency !== null) wireSelect(currency, 'currency', () => editLabel.guideTitle);
    const visibility = byLabel<HTMLSelectElement>('Visibility');
    if (visibility !== null) wireSelect(visibility, 'visibility', () => editLabel.guideTitle);
    const tags = byLabel<HTMLInputElement>('Tags');
    tags?.addEventListener('input', () => {
      scheduleCommit(
        'tags',
        () => tags.value.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0),
        () => editLabel.guideTitle,
        working.tags,
      );
    });
  }

  function wireStepRows(): void {
    for (const row of document.querySelectorAll<HTMLElement>('.step-row')) {
      const stepId = row.getAttribute('data-step-id') ?? '';
      const step = stepById(stepId);
      if (step === undefined) continue;
      const number = () => stepById(stepId)?.number ?? step.number;

      const title = row.querySelector<HTMLInputElement>(`[data-field="step/${stepId}/title"]`);
      if (title !== null) wireText(title, `step/${stepId}/title`, () => editLabel.stepTitle(number()));
      const text = row.querySelector<HTMLTextAreaElement>(`[data-field="step/${stepId}/text"]`);
      if (text !== null) wireText(text, `step/${stepId}/text`, () => editLabel.stepText(number()));
      const phase = row.querySelector<HTMLSelectElement>(`[data-field="step/${stepId}/phase"]`);
      if (phase !== null) wireSelect(phase, `step/${stepId}/phase`, () => editLabel.stepPhase(number()));

      row.addEventListener('focusin', () => {
        selectedStep = stepId;
        applySelectedStepToStage();
        live.reportStep(number());
      });

      row.querySelector<HTMLElement>(`[data-delete-step="${stepId}"]`)?.addEventListener('click', () => {
        void deleteStep(stepId);
      });

      for (const box of row.querySelectorAll<HTMLInputElement>('.focus-parts input[type="checkbox"]')) {
        box.addEventListener('change', () => {
          const chosen = [...row.querySelectorAll<HTMLInputElement>('.focus-parts input[type="checkbox"]')]
            .filter((candidate) => candidate.checked)
            .map((candidate) => candidate.getAttribute('data-part') ?? '');
          scheduleCommit(
            `step/${stepId}/focus_parts`,
            () => chosen,
            () => editLabel.stepFocusParts(number()),
            stepById(stepId)?.focus_parts ?? [],
          );
        });
      }

      for (const callout of row.querySelectorAll<HTMLInputElement>('[data-callout-part]')) {
        callout.addEventListener('input', () => {
          const entries = [...row.querySelectorAll<HTMLInputElement>('[data-callout-part]')].map(
            (field) => ({
              part_id: field.getAttribute('data-callout-part') ?? '',
              text: field.value,
            }),
          );
          scheduleCommit(
            `step/${stepId}/callouts`,
            () => entries,
            () => editLabel.stepCallout(number()),
            stepById(stepId)?.callouts ?? [],
          );
        });
      }
    }
  }

  /* ---- Apart amount, pose and scale ---- */
  const apart = byLabel<HTMLInputElement>('Apart amount');
  apart?.addEventListener('input', () => {
    const value = Number(apart.value);
    const stepId = selectedStep;
    if (stepId === null) return;
    const number = stepById(stepId)?.number ?? 1;
    scheduleCommit(
      `step/${stepId}/explode`,
      () => value,
      () => editLabel.stepExplode(number),
      stepById(stepId)?.explode ?? 0,
    );
  });

  byLabel<HTMLElement>('Use this view')?.addEventListener('click', () => {
    const stepId = selectedStep;
    if (stepId === null || stage === null) return;
    const pose = stage.currentPose;
    const camera = {
      yaw: Math.round(pose.yaw),
      pitch: Math.round(pose.pitch),
      zoom: Number(pose.zoom.toFixed(2)),
    };
    const number = stepById(stepId)?.number ?? 1;
    scheduleCommit(
      `step/${stepId}/camera`,
      () => camera,
      () => editLabel.stepCamera(number),
      stepById(stepId)?.camera,
    );
  });

  const scaleField = byLabel<HTMLInputElement>('Model scale');
  byLabel<HTMLElement>('Confirm scale')?.addEventListener('click', () => {
    void (async () => {
      const scale = Number(scaleField?.value ?? '1');
      await state.commit(
        { field: 'model_scale', label: editLabel.guideTitle, before: working.model?.scale, after: scale },
        false,
      );
      await state.commit(
        {
          field: 'model_scale_confirmed',
          label: editLabel.guideTitle,
          before: false,
          after: true,
        },
        false,
      );
      stage?.setModelScale(scale);
    })();
  });

  /* ---- Part fields ---- */
  function wirePartTree(): void {
    const items = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    items.forEach((item, index) => {
      item.addEventListener('click', () => selectPart(item.getAttribute('data-part') ?? ''));
      item.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          items[Math.min(items.length - 1, index + 1)]?.focus();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          items[Math.max(0, index - 1)]?.focus();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          selectPart(item.getAttribute('data-part') ?? '');
        }
      });
    });
    if (items[0] !== undefined) items[0].tabIndex = 0;
  }

  function selectPart(partId: string): void {
    selectedPart = partId;
    const part = parts.find((candidate) => candidate.id === partId);
    for (const item of document.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
      item.setAttribute('aria-selected', item.getAttribute('data-part') === partId ? 'true' : 'false');
    }
    if (part === undefined) return;
    const name = byLabel<HTMLInputElement>('Part name');
    if (name !== null) name.value = part.name;
    const axis = byLabel<HTMLSelectElement>('Apart axis');
    if (axis !== null) axis.value = part.axis;
    const distance = byLabel<HTMLInputElement>('Apart distance in millimetres');
    if (distance !== null) distance.value = String(part.apart_mm);
    const quantity = byLabel<HTMLInputElement>('Quantity');
    if (quantity !== null) quantity.value = String(part.quantity);
    const price = byLabel<HTMLInputElement>('Unit price');
    if (price !== null) price.value = majorUnits(part.unit_price);
    const fitted = byLabel<HTMLSelectElement>('Fitted at step');
    if (fitted !== null) fitted.value = part.fitted_at ?? '';
    const bind = byLabel<HTMLSelectElement>('Bind to node');
    if (bind !== null) bind.value = part.node_path ?? '';
  }

  function majorUnits(minor: number): string {
    return working.currency === 'JPY' ? String(minor) : (minor / 100).toFixed(2);
  }

  function toMinorUnits(text: string): number {
    const value = Number(text.replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(value)) return 0;
    return working.currency === 'JPY' ? Math.round(value) : Math.round(value * 100);
  }

  function wirePartFields(): void {
    const name = byLabel<HTMLInputElement>('Part name');
    name?.addEventListener('input', () => {
      if (selectedPart === null) return;
      const partId = selectedPart;
      const current = parts.find((candidate) => candidate.id === partId);
      scheduleCommit(
        `part/${partId}/name`,
        () => name.value,
        () => editLabel.part(current?.name ?? ''),
        current?.name,
      );
    });

    const numberFields: { label: string; field: string; read: (value: string) => number }[] = [
      { label: 'Apart distance in millimetres', field: 'apart_mm', read: (value) => Number(value) },
      { label: 'Quantity', field: 'quantity', read: (value) => Math.round(Number(value)) },
      { label: 'Unit price', field: 'unit_price', read: toMinorUnits },
    ];
    for (const entry of numberFields) {
      const input = byLabel<HTMLInputElement>(entry.label);
      input?.addEventListener('input', () => {
        if (selectedPart === null) return;
        const partId = selectedPart;
        const current = parts.find((candidate) => candidate.id === partId);
        scheduleCommit(
          `part/${partId}/${entry.field}`,
          () => entry.read(input.value),
          () => editLabel.part(current?.name ?? ''),
          current === undefined ? undefined : (current as unknown as Record<string, unknown>)[entry.field],
        );
      });
    }

    const axis = byLabel<HTMLSelectElement>('Apart axis');
    axis?.addEventListener('change', () => {
      if (selectedPart === null) return;
      const partId = selectedPart;
      const current = parts.find((candidate) => candidate.id === partId);
      scheduleCommit(
        `part/${partId}/axis`,
        () => axis.value,
        () => editLabel.part(current?.name ?? ''),
        current?.axis,
      );
    });

    const fitted = byLabel<HTMLSelectElement>('Fitted at step');
    fitted?.addEventListener('change', () => {
      if (selectedPart === null) return;
      const partId = selectedPart;
      const current = parts.find((candidate) => candidate.id === partId);
      scheduleCommit(
        `part/${partId}/fitted_at`,
        () => (fitted.value.length === 0 ? null : fitted.value),
        () => editLabel.part(current?.name ?? ''),
        current?.fitted_at,
      );
    });

    const bind = byLabel<HTMLSelectElement>('Bind to node');
    bind?.addEventListener('change', () => {
      if (selectedPart === null) return;
      const partId = selectedPart;
      const current = parts.find((candidate) => candidate.id === partId);
      scheduleCommit(
        `part/${partId}/node_path`,
        () => bind.value,
        () => editLabel.part(current?.name ?? ''),
        current?.node_path,
      );
    });

    byLabel<HTMLElement>('Remove part')?.addEventListener('click', () => {
      if (selectedPart === null) return;
      void call('DELETE', `/api/guides/${working.id}/parts/${selectedPart}`);
    });
  }

  /* ---- Steps: add, delete, move ---- */
  async function sendMove(stepId: string, position: number): Promise<boolean> {
    const reply = await call('POST', `/api/guides/${working.id}/steps/${stepId}/move`, { position });
    return reply.status === 200;
  }

  async function sendDelete(stepId: string): Promise<boolean> {
    const reply = await call('DELETE', `/api/guides/${working.id}/steps/${stepId}`);
    return reply.status === 200;
  }

  /** Undoing an add deletes the step; undoing a delete brings it back with its id. */
  async function addStep(): Promise<void> {
    const reply = await call<{ id: string; number: number }>(
      'POST',
      `/api/guides/${working.id}/steps`,
      { title: '' },
    );
    if (reply.status === 422) {
      status.sayAndClear(editorStatus.tooManySteps(data.limits.guide_step_max));
      return;
    }
    if (reply.status !== 201) {
      status.sayAndClear(editorStatus.commitFailed);
      return;
    }
    const added = reply.body;
    state.record({
      label: editLabel.addStep(added.number),
      guard: null,
      run: async (direction) => {
        if (direction === 'undo') {
          return { ok: await sendDelete(added.id), structural: true, focusStepId: null };
        }
        const again = await call<{ id: string }>('POST', `/api/guides/${working.id}/steps`, {
          title: '',
          restore: { id: added.id, number: added.number, title: '', text: '', phase: 'open_up', explode: 0, focus_parts: [], camera: { yaw: 30, pitch: 15, zoom: 1 }, callouts: [] },
        });
        return { ok: again.status === 201, structural: true, focusStepId: added.id };
      },
    });
    status.sayAndClear(editorStatus.stepAdded(added.number));
    await reloadRows(added.id);
  }

  async function deleteStep(stepId: string): Promise<void> {
    const step = stepById(stepId);
    if (step === undefined) return;
    const snapshot = { ...step };
    if (!(await sendDelete(stepId))) {
      status.sayAndClear(editorStatus.commitFailed);
      return;
    }
    state.record({
      label: editLabel.deleteStep(snapshot.number),
      guard: null,
      run: async (direction) => {
        if (direction === 'undo') {
          const back = await call<{ id: string }>('POST', `/api/guides/${working.id}/steps`, {
            title: snapshot.title,
            restore: snapshot,
          });
          return { ok: back.status === 201, structural: true, focusStepId: snapshot.id };
        }
        return { ok: await sendDelete(snapshot.id), structural: true, focusStepId: null };
      },
    });
    status.sayAndClear(editorStatus.stepDeleted(snapshot.number));
    await reloadRows(null);
  }

  /** Undoing a move moves the step back. */
  async function moveStep(stepId: string, direction: number): Promise<void> {
    const step = stepById(stepId);
    if (step === undefined) return;
    const from = step.number;
    const target = from + direction;
    if (target < 1) {
      status.sayAndClear(editorStatus.stepAlreadyFirst(from));
      return;
    }
    if (target > steps.length) {
      status.sayAndClear(editorStatus.stepAlreadyLast(from));
      return;
    }
    if (!(await sendMove(stepId, target))) {
      status.sayAndClear(editorStatus.commitFailed);
      return;
    }
    state.record({
      label: editLabel.moveStep(from, target),
      guard: null,
      run: async (way) => ({
        ok: await sendMove(stepId, way === 'undo' ? from : target),
        structural: true,
        focusStepId: stepId,
      }),
    });
    status.sayAndClear(editorStatus.stepMoved(from, target));
    await reloadRows(stepId);
  }

  /** Re-reads the working copy and rebuilds the step rows in place. */
  async function reloadRows(focusStepId: string | null): Promise<void> {
    const reply = await call<GuideWorking>('GET', `/api/guides/${working.id}/working`);
    if (reply.status !== 200) return;
    steps = reply.body.steps;
    parts = reply.body.parts;
    state.revision = reply.body.revision;
    state.guideTotalText = reply.body.guide_total_text;
    for (const [field, revision] of Object.entries(reply.body.field_revisions)) {
      state.noteRemoteChange({ field, revision, byId: '', byName: '' });
    }
    const container = need<HTMLElement>('.step-rows');
    const fresh = await fetch(`/edit/${reply.body.slug}`);
    const markup = await fresh.text();
    const parsed = new DOMParser().parseFromString(markup, 'text/html');
    const replacement = parsed.querySelector('.step-rows');
    if (replacement !== null) container.replaceChildren(...replacement.childNodes);
    const treeHost = document.querySelector('.part-tree');
    const freshTree = parsed.querySelector('.part-tree');
    if (treeHost !== null && freshTree !== null) treeHost.replaceChildren(...freshTree.childNodes);
    const unboundHost = document.querySelector('.unbound-parts');
    const freshUnbound = parsed.querySelector('.unbound-parts');
    if (unboundHost !== null && freshUnbound !== null) {
      unboundHost.replaceChildren(...freshUnbound.childNodes);
    }
    wireStepRows();
    wirePartTree();
    if (focusStepId !== null) {
      selectedStep = focusStepId;
      const number = stepById(focusStepId)?.number ?? 1;
      byLabel<HTMLElement>(`Step ${number} title`)?.focus();
    }
    refreshTotal();
    applySelectedStepToStage();
  }

  /* ---- Versions ---- */
  const versions = new VersionsPanel(working.id, status, async (created) => {
    state.latestVersion = created;
    if (latestRegion !== null) latestRegion.textContent = latestVersionCopy(created);
    await reloadRows(selectedStep);
  });

  async function saveVersion(): Promise<void> {
    status.say(editorStatus.saving);
    const reply = await call<{ number: number; error?: string; current?: number }>(
      'POST',
      `/api/guides/${working.id}/versions`,
      { base_version: state.latestVersion },
    );
    if (reply.status === 201) {
      state.latestVersion = reply.body.number;
      if (latestRegion !== null) latestRegion.textContent = latestVersionCopy(reply.body.number);
      status.sayAndClear(editorStatus.saved(reply.body.number));
      return;
    }
    if (reply.status === 409) {
      status.sayAndClear(editorStatus.staleSave(reply.body.current ?? 0));
      return;
    }
    status.sayAndClear(editorStatus.commitFailed);
  }

  /* ---- Model panel ---- */
  const modelPanel = new ModelPanel({
    guideId: working.id,
    limits: data.limits,
    stage,
    stageStatus: stageStatusRegion,
    editorStatusRegion: status,
    uploadButton: document.querySelector<HTMLElement>('[data-tool="Upload model"]'),
    fileInput: need<HTMLInputElement>('.model-file'),
    onStored: (storedParts, _unbound, scale) => {
      parts = storedParts;
      stage?.setModelScale(scale);
      void reloadRows(selectedStep);
    },
  });

  /* ---- Conflict dialog ---- */
  const conflictDialog = new Dialog(need<HTMLElement>('[role="alertdialog"]'));
  let pendingConflict: { conflict: Conflict; mine: unknown } | null = null;

  const GUIDE_FIELD_LABELS: Record<string, string> = {
    title: 'Guide title',
    currency: 'Currency',
    tags: 'Tags',
    visibility: 'Visibility',
    model_scale: 'Model scale',
  };

  const PART_FIELD_LABELS: Record<string, string> = {
    name: 'Part name',
    axis: 'Apart axis',
    apart_mm: 'Apart distance in millimetres',
    quantity: 'Quantity',
    unit_price: 'Unit price',
    fitted_at: 'Fitted at step',
    node_path: 'Bind to node',
  };

  const STEP_FIELD_LABELS: Record<string, string> = {
    title: 'title',
    text: 'text',
    phase: 'phase',
  };

  /** The accessible name of the control that carries a field path. */
  function fieldLabelOf(field: string): string {
    const segments = field.split('/');
    if (segments.length === 1) return GUIDE_FIELD_LABELS[field] ?? field;
    const [kind, id, name] = segments;
    if (kind === 'step' && name !== undefined) {
      const suffix = STEP_FIELD_LABELS[name];
      const number = stepById(id ?? '')?.number ?? 0;
      return suffix === undefined ? field : `Step ${number} ${suffix}`;
    }
    if (kind === 'part' && name !== undefined) return PART_FIELD_LABELS[name] ?? field;
    return field;
  }

  function controlFor(field: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
    const byField = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[data-field="${CSS.escape(field)}"]`,
    );
    if (byField !== null) return byField;
    const segments = field.split('/');
    if (segments[0] === 'part' && segments[1] !== selectedPart) return null;
    return byLabel<HTMLInputElement>(fieldLabelOf(field));
  }

  /** Reads a control back in the shape the field takes. */
  function readControl(
    field: string,
    control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  ): unknown {
    if (field === 'tags') {
      return control.value.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0);
    }
    if (field.endsWith('/unit_price')) return toMinorUnits(control.value);
    if (field.endsWith('/quantity')) return Math.round(Number(control.value));
    if (field.endsWith('/apart_mm') || field === 'model_scale') return Number(control.value);
    if (field.endsWith('/fitted_at') || field.endsWith('/node_path')) {
      return control.value.length === 0 ? null : control.value;
    }
    return control.value;
  }

  function openConflict(conflict: Conflict, mine: unknown): void {
    pendingConflict = { conflict, mine };
    const label = fieldLabelOf(conflict.field);
    need<HTMLElement>('.conflict-message', conflictDialog.element).textContent = editConflictText(
      conflict.theirs.by,
      label,
    );
    need<HTMLElement>('.conflict-yours', conflictDialog.element).textContent = String(mine ?? '');
    need<HTMLElement>('.conflict-theirs', conflictDialog.element).textContent = String(
      conflict.theirs.value ?? '',
    );
    conflictDialog.open(document.activeElement as HTMLElement | null);
  }

  need<HTMLElement>('[data-action="keep-mine"]', conflictDialog.element).addEventListener(
    'click',
    () => {
      const pending = pendingConflict;
      if (pending === null) return;
      void (async () => {
        await state.overwrite(pending.conflict.field, pending.mine, fieldLabelOf(pending.conflict.field));
        applyLocalField(pending.conflict.field, pending.mine);
        conflictDialog.close();
        status.sayAndClear(editorStatus.keptMine(fieldLabelOf(pending.conflict.field)));
        pendingConflict = null;
      })();
    },
  );

  need<HTMLElement>('[data-action="take-theirs"]', conflictDialog.element).addEventListener(
    'click',
    () => {
      const pending = pendingConflict;
      if (pending === null) return;
      applyLocalField(pending.conflict.field, pending.conflict.theirs.value);
      writeFieldControl(pending.conflict.field, pending.conflict.theirs.value);
      conflictDialog.close();
      status.sayAndClear(
        editorStatus.tookTheirs(pending.conflict.theirs.by, fieldLabelOf(pending.conflict.field)),
      );
      pendingConflict = null;
    },
  );

  function writeFieldControl(field: string, value: unknown): void {
    const control = controlFor(field);
    if (control === null) return;
    /* Leave a field the person is typing in alone. */
    if (control === document.activeElement && delays.get(field)?.pending === true) return;
    if (field.endsWith('/unit_price') && typeof value === 'number') {
      control.value = majorUnits(value);
      return;
    }
    if (Array.isArray(value)) {
      control.value = value.join(', ');
      return;
    }
    if (typeof value === 'string' || typeof value === 'number') control.value = String(value);
    else if (value === null) control.value = '';
  }

  /* ---- Other dialogs ---- */
  const coauthorsDialog = requireDialog('Co-authors');
  const deleteDialog = requireDialog('Delete guide');

  byLabel<HTMLElement>('Add co-author')?.addEventListener('click', () => {
    const field = byLabel<HTMLInputElement>('Co-author email');
    if (field === null) return;
    void (async () => {
      const reply = await call('POST', `/api/guides/${working.id}/coauthors`, { email: field.value });
      if (reply.status !== 201) status.sayAndClear(editorStatus.commitFailed);
      else field.value = '';
    })();
  });

  document
    .querySelector<HTMLElement>('[data-action="confirm-delete"]')
    ?.addEventListener('click', () => {
      void (async () => {
        const reply = await call('DELETE', `/api/guides/${working.id}`);
        if (reply.status === 204) window.location.href = '/dashboard';
        else status.sayAndClear(editorStatus.commitFailed);
      })();
    });

  /* ---- Toolbar ---- */
  const toolActions: Record<string, (button: HTMLElement) => void> = {
    'Add step': () => void addStep(),
    Undo: () => void runUndo(),
    Redo: () => void runRedo(),
    'Save version': () => void saveVersion(),
    Versions: (button) => void versions.toggle(button),
    'Choose a model file': () => modelPanel.openPicker(),
    'Upload model': (button) => {
      if (!isDisabled(button)) void modelPanel.upload();
    },
    'Co-authors': (button) => coauthorsDialog.open(button),
    Publish: () => void publish(),
    Withdraw: () => void withdraw(),
    'Delete guide': (button) => deleteDialog.open(button),
  };

  for (const button of document.querySelectorAll<HTMLElement>('[data-tool]')) {
    const name = button.getAttribute('data-tool') ?? '';
    button.addEventListener('click', () => toolActions[name]?.(button));
  }

  async function publish(): Promise<void> {
    status.say(editorStatus.publishing);
    const reply = await call<{ published_version: number; error?: string; parts?: string[] }>(
      'POST',
      `/api/guides/${working.id}/publish`,
      {},
    );
    if (reply.status === 200) {
      status.sayAndClear(editorStatus.published(reply.body.published_version));
      return;
    }
    if (reply.status === 422 || reply.status === 503) {
      status.sayAndClear(modelPanel.reportPublishRefusal(reply.body));
      return;
    }
    status.sayAndClear(editorStatus.commitFailed);
  }

  async function withdraw(): Promise<void> {
    const reply = await call('POST', `/api/guides/${working.id}/withdraw`, {});
    if (reply.status === 200) status.sayAndClear(editorStatus.withdrawn);
    else status.sayAndClear(editorStatus.commitFailed);
  }

  /** An undo pressed with text not yet committed commits it first. */
  async function flushPendingCommits(): Promise<void> {
    for (const [field, delay] of delays) {
      if (!delay.pending) continue;
      delay.cancel();
      const control = controlFor(field);
      if (control !== null) await runCommit(field, readControl(field, control), fieldLabelOf(field));
    }
  }

  async function applyHistory(outcome: Awaited<ReturnType<typeof state.undo>>): Promise<void> {
    const result = outcome.result;
    if (result !== undefined && result.field !== undefined) {
      applyLocalField(result.field, result.value);
      writeFieldControl(result.field, result.value);
      refreshTotal();
    }
    if (result !== undefined && result.structural === true) {
      await reloadRows(result.focusStepId ?? selectedStep);
    }
    status.sayAndClear(outcome.message);
  }

  async function runUndo(): Promise<void> {
    await flushPendingCommits();
    await applyHistory(await state.undo());
  }

  async function runRedo(): Promise<void> {
    await applyHistory(await state.redo());
  }

  /* ---- Keyboard ---- */
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    const combo = event.ctrlKey || event.metaKey;
    if (combo && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void saveVersion();
      return;
    }
    if (combo && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) void runRedo();
      else void runUndo();
      return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('.step-row');
      if (row === null || row === undefined) return;
      event.preventDefault();
      void moveStep(row.getAttribute('data-step-id') ?? '', event.key === 'ArrowUp' ? -1 : 1);
    }
  });

  /* ---- Pane separator ---- */
  const separator = byLabel<HTMLElement>('Resize stage and steps');
  function setSeparator(value: number): void {
    const clamped = Math.min(SEPARATOR_MAX, Math.max(SEPARATOR_MIN, value));
    separator?.setAttribute('aria-valuenow', String(clamped));
    document.querySelector<HTMLElement>('.panes')?.style.setProperty('--stage-width', `${clamped}%`);
  }
  separator?.addEventListener('keydown', (event: KeyboardEvent) => {
    const now = Number(separator.getAttribute('aria-valuenow') ?? '50');
    if (event.key === 'ArrowLeft') setSeparator(now - SEPARATOR_STEP);
    else if (event.key === 'ArrowRight') setSeparator(now + SEPARATOR_STEP);
    else if (event.key === 'Home') setSeparator(SEPARATOR_MIN);
    else if (event.key === 'End') setSeparator(SEPARATOR_MAX);
    else return;
    event.preventDefault();
  });
  setSeparator(50);

  /* ---- Editor panes on a phone ---- */
  const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
  function showPane(name: string): void {
    for (const tab of tabs) {
      const selected = tab.getAttribute('data-pane') === name;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const pane of document.querySelectorAll<HTMLElement>('.pane')) {
      pane.hidden = pane.id !== `pane-${name}`;
    }
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => showPane(tab.getAttribute('data-pane') ?? 'stage'));
    tab.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      if (next === undefined) return;
      next.focus();
      showPane(next.getAttribute('data-pane') ?? 'stage');
    });
  });
  if (window.matchMedia('(max-width: 767px)').matches) showPane('stage');

  /* ---- Free look on a phone ---- */
  const freeLookSwitch = byLabel<HTMLElement>('Free look');
  freeLookSwitch?.addEventListener('click', () => {
    freeLook = !freeLook;
    freeLookSwitch.setAttribute('aria-checked', freeLook ? 'true' : 'false');
    stageElement.setAttribute('data-free-look', freeLook ? 'true' : 'false');
  });

  /* ---- Live ---- */
  const live = new LiveConnection(working.id, newClientId());
  live.on((event) => {
    if (event['guide'] !== working.id) return;
    if (event.kind === 'presence') {
      renderPeople(event['people'] as { user_id: string; name: string; step: number | null }[]);
      return;
    }
    if (event.kind === 'field') {
      const field = String(event['field']);
      const byId = String(event['by_id']);
      const byName = String(event['by']);
      state.noteRemoteChange({
        field,
        revision: Number(event['field_revision']),
        byId,
        byName,
      });
      state.guideTotalText = String(event['guide_total_text']);
      refreshTotal();
      /*
       * An incoming change to a field you have no uncommitted text in is
       * applied at once, even if the field has focus; with uncommitted text in
       * that field the conflict dialog opens instead. An edit made by the same
       * person in another tab arrives here like any other.
       */
      const pending = delays.get(field);
      if (pending?.pending === true && byId !== data.viewer.id) {
        pending.cancel();
        const control = controlFor(field);
        openConflict(
          {
            field,
            yours: control?.value ?? undefined,
            theirs: { value: event['value'], revision: Number(event['field_revision']), by: byName },
          },
          control?.value,
        );
        return;
      }
      applyLocalField(field, event['value']);
      writeFieldControl(field, event['value']);
      return;
    }
    if (event.kind === 'version') {
      const number = Number(event['number']);
      state.latestVersion = number;
      if (latestRegion !== null) latestRegion.textContent = latestVersionCopy(number);
      versions.addVersion({
        number,
        saved_at: new Date().toISOString(),
        saved_by: String(event['saved_by']),
        restored_from: (event['restored_from'] as number | null) ?? null,
        step_count: steps.length,
        parts_cost_text: state.guideTotalText,
      });
      return;
    }
    if (event.kind === 'question') {
      alerts.say(
        questionAlerts.toAuthor(String(event['guide_title']), Number((event['question'] as Step).number ?? 0)),
      );
      return;
    }
    if (event.kind === 'step_added' || event.kind === 'step_deleted' || event.kind === 'step_moved') {
      if (String(event['by_id']) !== data.viewer.id) void reloadRows(selectedStep);
    }
  });
  live.start();
  live.reportStep(steps[0]?.number ?? null);

  function renderPeople(people: { user_id: string; name: string; step: number | null }[]): void {
    if (peopleList === null) return;
    peopleList.replaceChildren(
      ...people
        .filter((person) => person.user_id !== data.viewer.id)
        .map((person) => {
          const item = document.createElement('li');
          item.textContent = peopleEditingItem(person.name, person.step);
          return item;
        }),
    );
  }

  /* ---- First paint ---- */
  wireGuideDetails();
  wireStepRows();
  wirePartTree();
  wirePartFields();
  applySelectedStepToStage();
  if (prefersReducedMotion()) document.documentElement.setAttribute('data-reduced', 'true');
  for (const button of document.querySelectorAll<HTMLElement>('[data-tool]')) {
    setDisabled(button, false);
  }
  const uploadButton = document.querySelector<HTMLElement>('[data-tool="Upload model"]');
  if (uploadButton !== null) setDisabled(uploadButton, true);
  if (!data.owner) {
    for (const name of ['Publish', 'Withdraw', 'Delete guide', 'Co-authors']) {
      const button = document.querySelector<HTMLElement>(`[data-tool="${name}"]`);
      if (button !== null) setDisabled(button, true);
    }
  }
}
