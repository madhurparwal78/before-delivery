import { editorStatus, stageStatus, undoLabel } from '../../shared/copy';
import { checkGlb, type Bounds } from '../../shared/glb';
import { fieldColours } from '../../shared/pose';
import type { Model, Part } from '../../shared/types';
import { readLimits } from '../api';
import { h } from '../dom';
import { Status } from '../status';
import { Stage } from '../stage/stage';
import type { Binding } from './commits';
import { cell } from './fields';
import type { Editor } from './editor';

interface Preview { name: string; bytes: ArrayBuffer }

/** The stage, its status line, the apart amount, the saved view, the model scale, drop preview and upload. */
export class StagePane {
  readonly element: HTMLElement;
  readonly stage = new Stage();
  readonly status = new Status('Stage status', 'stage-status');
  readonly slider = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: 0 });
  private readonly freeLook = h('button', { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Free look', class: 'free-look' }, 'Free look');
  private readonly scale = h('input', { type: 'number', step: 'any', min: 0 });
  private readonly bbox = h('p', { class: 'bbox' });
  private readonly picker = h('input', { type: 'file', accept: '.glb,model/gltf-binary', hidden: true, tabindex: -1 });
  private preview: Preview | null = null;
  private uploading = false;
  private retry = 0;
  private sliderBinding: Binding | null = null;
  private sliderTimer = 0;
  bounds: Bounds | null = null;
  private baseBbox: [number, number, number] | null = null;

  constructor(private readonly editor: Editor) {
    this.slider.setAttribute('aria-label', 'Apart amount');
    const queue = () => {
      clearTimeout(this.sliderTimer);
      this.sliderTimer = window.setTimeout(() => {
        this.sliderTimer = 0;
        void this.sliderBinding?.flush();
      }, 250);
    };
    this.slider.addEventListener('input', queue);
    this.slider.addEventListener('change', queue);
    this.scale.setAttribute('aria-label', 'Model scale');
    const useView = h('button', { type: 'button', class: 'button' }, 'Use this view');
    const confirm = h('button', { type: 'button', class: 'button' }, 'Confirm scale');
    useView.addEventListener('click', () => void this.saveView());
    confirm.addEventListener('click', () => void this.confirmScale());
    this.scale.addEventListener('input', () => this.showBbox(Number(this.scale.value)));
    this.freeLook.addEventListener('click', () => {
      const on = this.freeLook.getAttribute('aria-checked') !== 'true';
      this.freeLook.setAttribute('aria-checked', String(on));
      this.stage.freeLook = on;
      this.stage.element.classList.toggle('free-look-on', on);
    });
    this.picker.addEventListener('change', () => {
      const file = this.picker.files?.[0];
      this.picker.value = '';
      if (file) void this.take(file);
    });
    const wrap = h('div', { class: 'stage-wrap-editor' }, this.stage.element, this.freeLook);
    this.element = h('div', { class: 'pane stage-pane' }, wrap, this.status.element,
      h('div', { class: 'form stage-controls' }, cell('apart-amount', 'Apart amount', this.slider), cell('model-scale', 'Model scale', this.scale, this.bbox)),
      h('div', { class: 'dialog-actions' }, useView, confirm), this.picker);
    for (const type of ['dragenter', 'dragover']) wrap.addEventListener(type, (event) => event.preventDefault());
    wrap.addEventListener('drop', (event) => {
      event.preventDefault();
      const file = (event as DragEvent).dataTransfer?.files[0];
      if (file) void this.take(file);
    });
    void this.loadModel();
  }

  get hasPreview(): boolean {
    return this.preview !== null && !this.uploading;
  }

  chooseFile(): void {
    this.picker.click();
  }

  /** Browser checks, then a preview that sends nothing. */
  private async take(file: File): Promise<void> {
    const limits = await readLimits();
    const bytes = await file.arrayBuffer();
    const checked = checkGlb(new Uint8Array(bytes), { modelMaxBytes: limits.model_max_bytes, modelMaxParts: limits.model_max_parts });
    this.preview = null;
    if (!checked.ok) {
      const refusal = checked.refusal;
      const copy = refusal.error === 'model_too_large' ? stageStatus.overBytes(refusal.limit)
        : refusal.error === 'too_many_parts' ? stageStatus.overParts(file.name, refusal.count, refusal.limit)
        : refusal.error === 'external_uri' ? stageStatus.outsideFiles(file.name) : stageStatus.notGlb(file.name);
      this.status.set(copy, 'error');
      this.editor.syncToolbar();
      return;
    }
    const scene = await Stage.parse(bytes.slice(0));
    this.stage.setModel(scene, [], 1, checked.model.bounds, 0, true);
    this.stage.setInk({ above: '#1F150C', below: '#1F150C', edge: -1 });
    this.stage.setState('preview');
    this.preview = { name: file.name, bytes };
    this.status.set(stageStatus.previewing(file.name));
    this.editor.syncToolbar();
  }

  async upload(): Promise<void> {
    const preview = this.preview;
    if (!preview || this.uploading) return;
    this.uploading = true;
    this.editor.syncToolbar();
    this.status.set(stageStatus.uploading(preview.name, 0));
    const reply = await new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => {
      const xhr = new XMLHttpRequest();
      let shown = 0;
      xhr.open('POST', `/api/guides/${this.editor.guideId}/model`);
      xhr.setRequestHeader('Content-Type', 'model/gltf-binary');
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(preview.name));
      xhr.upload.addEventListener('progress', (event) => {
        if (!event.lengthComputable) return;
        shown = Math.max(shown, Math.min(100, Math.floor((event.loaded / event.total) * 100)));
        this.status.set(stageStatus.uploading(preview.name, shown));
      });
      xhr.addEventListener('loadend', () => resolve({ status: xhr.status, body: xhr.responseText ? (JSON.parse(xhr.responseText) as Record<string, unknown>) : {} }));
      xhr.send(preview.bytes);
    });
    this.uploading = false;
    if (reply.status === 201) {
      const model = reply.body.model as Model;
      this.preview = null;
      await this.editor.reloadWorking();
      await this.loadModel(true);
      this.status.set(stageStatus.stored(preview.name, model.bytes));
    } else if (reply.status === 503) this.status.set(stageStatus.storageOutAuthor, 'error');
    else if (reply.body.error === 'model_too_large') this.status.set(stageStatus.overBytes(Number(reply.body.limit)), 'error');
    else if (reply.body.error === 'too_many_parts') this.status.set(stageStatus.overParts(preview.name, Number(reply.body.count), Number(reply.body.limit)), 'error');
    else if (reply.body.error === 'external_uri') this.status.set(stageStatus.outsideFiles(preview.name), 'error');
    else if (reply.body.error === 'not_glb') this.status.set(stageStatus.notGlb(preview.name), 'error');
    else this.status.set(editorStatus.commitFailed, 'error');
    this.editor.syncToolbar();
  }

  /** The stored model on the stage; a storage outage shows the author copy and retries every 5 seconds. */
  async loadModel(quiet = false): Promise<void> {
    clearTimeout(this.retry);
    const { work } = this.editor.state;
    if (!work.model) {
      this.stage.setState('ready');
      if (!this.preview) this.status.set(stageStatus.noModel);
      this.sync();
      return;
    }
    if (this.preview) return;
    this.stage.setState('loading');
    if (!quiet) this.status.set(stageStatus.loading);
    try {
      const response = await fetch(`/api/models/${work.model.id}.glb`);
      if (!response.ok) throw new Error(String(response.status));
      const bytes = await response.arrayBuffer();
      const checked = checkGlb(new Uint8Array(bytes), { modelMaxBytes: Infinity, modelMaxParts: Infinity });
      if (!checked.ok) throw new Error('model');
      this.bounds = checked.model.bounds;
      this.editor.nodePaths = checked.model.parts.map((p) => p.nodePath);
      this.baseBbox = work.model.bbox_mm.map((v) => v / work.model!.scale) as [number, number, number];
      const scene = await Stage.parse(bytes);
      this.stage.setModel(scene, this.stageParts(work.parts), work.model.scale, checked.model.bounds, Math.max(0, ...work.steps.map((s) => s.explode)), false);
      this.stage.setState('ready');
      if (!quiet) this.status.set(stageStatus.ready);
      this.sync();
    } catch {
      this.stage.setState('error');
      this.status.set(stageStatus.storageOutAuthor, 'error');
      this.retry = window.setTimeout(() => void this.loadModel(), 5000);
    }
    this.editor.panes.parts.sync();
  }

  private stageParts(parts: Part[]) {
    return parts.map((p) => ({ id: p.id, nodePath: p.node_path, axis: p.axis, apart_mm: p.apart_mm }));
  }

  private showBbox(scale: number): void {
    const model = this.editor.state.work.model;
    if (!model || !this.baseBbox || !Number.isFinite(scale)) return void (this.bbox.textContent = '');
    const [x, y, z] = this.baseBbox.map((v) => Math.round(v * scale * 100) / 100);
    this.bbox.textContent = `Bounding box ${x} × ${y} × ${z} mm`;
  }

  /** The selected step's pose, apart amount, focus parts and field colours on the stage, applied with no tween. */
  sync(): void {
    const { state } = this.editor;
    const step = state.selected();
    this.stage.setStep(step ? state.stepNumber(step.id) : 0);
    if (state.work.model && document.activeElement !== this.scale) this.scale.value = String(state.work.model.scale);
    this.showBbox(Number(this.scale.value));
    if (!this.preview) {
      const colours = step ? fieldColours[step.phase] : fieldColours.take_out;
      this.stage.element.style.backgroundColor = colours.field;
      this.stage.setInk({ above: colours.text, below: colours.text, edge: -1 });
    } else this.stage.element.style.backgroundColor = fieldColours.take_out.field;
    if (step && !this.preview) {
      this.stage.clearManual();
      this.stage.setPose({ explode: step.explode, yaw: step.camera.yaw, pitch: step.camera.pitch, zoom: step.camera.zoom });
      this.stage.setFocus(step.focus_parts);
    }
    this.bindSlider();
  }

  /** Re-places the parts' offsets after a part's axis or distance changed. */
  refreshParts(): void {
    if (this.stage.state() !== 'ready') return;
    void this.loadModel(true);
  }

  private bindSlider(): void {
    const { state, committer } = this.editor;
    const step = state.selected();
    if (this.sliderBinding) committer.unregister(this.sliderBinding.path);
    this.sliderBinding = null;
    if (!step) return;
    const binding: Binding = {
      path: `step/${step.id}/explode`,
      label: 'Apart amount',
      show: (value) => { this.slider.value = String(value ?? 0); },
      pending: () => this.sliderTimer !== 0,
      current: () => Number(this.slider.value),
      flush: async () => {
        clearTimeout(this.sliderTimer);
        this.sliderTimer = 0;
        await committer.commit(binding.path, Number(this.slider.value), { undoLabel: undoLabel.stepExplode(state.stepNumber(step.id)), binding });
      },
    };
    this.sliderBinding = binding;
    committer.register(binding);
    if (this.sliderTimer === 0) binding.show(step.explode);
  }

  private async saveView(): Promise<void> {
    const { state, committer } = this.editor;
    const step = state.selected();
    if (!step) return;
    const view = this.stage.view();
    const camera = { yaw: Math.round(((view.yaw + 180) % 360 + 360) % 360 - 180), pitch: Math.round(view.pitch), zoom: Math.round(step.camera.zoom * view.userZoom * 100) / 100 };
    if (await committer.commit(`step/${step.id}/camera`, camera, { undoLabel: undoLabel.stepView(state.stepNumber(step.id)) })) {
      this.stage.clearManual();
      this.sync();
    }
  }

  private async confirmScale(): Promise<void> {
    const { committer, state } = this.editor;
    if (!state.work.model) return;
    const scale = Number(this.scale.value);
    if (!Number.isFinite(scale) || scale <= 0) return;
    if (await committer.commit('model_scale', scale, {})) await committer.commit('model_scale_confirmed', true, {});
    await this.loadModel(true);
  }
}
