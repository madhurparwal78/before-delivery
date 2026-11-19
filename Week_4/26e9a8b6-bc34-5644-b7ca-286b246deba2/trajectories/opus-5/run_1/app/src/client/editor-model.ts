import { editorStatus, stageStatus } from '../shared/copy.js';
import { checkGlb, type GlbRefusal } from '../shared/glb.js';
import type { Limits } from '../shared/limits.js';
import type { Part } from '../shared/types.js';
import { uploadModel } from './api.js';
import { setDisabled, type Status } from './dom.js';
import type { Stage } from './stage.js';

export interface ModelPanelHooks {
  guideId: string;
  limits: Limits;
  stage: Stage | null;
  stageStatus: Status;
  editorStatusRegion: Status;
  uploadButton: HTMLElement | null;
  fileInput: HTMLInputElement;
  /** Replaces the editor's parts after a stored upload. */
  onStored: (parts: Part[], unbound: string[], scale: number) => void;
}

/** The browser-side refusal copy, from the same checks the server runs. */
export function refusalCopy(refusal: GlbRefusal, fileName: string): string {
  switch (refusal.error) {
    case 'model_too_large':
      return stageStatus.overBytes(refusal.limit);
    case 'too_many_parts':
      return stageStatus.overParts(fileName, refusal.count, refusal.limit);
    case 'external_uri':
      return stageStatus.externalUri(fileName);
    default:
      return stageStatus.notGlb(fileName);
  }
}

interface Preview {
  name: string;
  bytes: ArrayBuffer;
}

export class ModelPanel {
  private preview: Preview | null = null;

  constructor(private readonly hooks: ModelPanelHooks) {
    const stage = hooks.stage;
    if (stage !== null) {
      stage.element.addEventListener('dragover', (event: DragEvent) => {
        event.preventDefault();
      });
      stage.element.addEventListener('drop', (event: DragEvent) => {
        event.preventDefault();
        const file = event.dataTransfer?.files?.[0];
        if (file !== undefined) void this.take(file);
      });
    }
    hooks.fileInput.addEventListener('change', () => {
      const file = hooks.fileInput.files?.[0];
      if (file !== undefined) void this.take(file);
    });
    if (hooks.uploadButton !== null) setDisabled(hooks.uploadButton, true);
  }

  openPicker(): void {
    this.hooks.fileInput.click();
  }

  get hasPreview(): boolean {
    return this.preview !== null;
  }

  /** Runs the browser checks, then previews without sending anything. */
  private async take(file: File): Promise<void> {
    const bytes = await file.arrayBuffer();
    const checked = checkGlb(new Uint8Array(bytes), this.hooks.limits);
    if (!checked.ok) {
      this.preview = null;
      if (this.hooks.uploadButton !== null) setDisabled(this.hooks.uploadButton, true);
      this.hooks.stageStatus.say(refusalCopy(checked.refusal, file.name));
      return;
    }
    this.preview = { name: file.name, bytes };
    const parts: Part[] = checked.value.parts.map((part, index) => ({
      id: `preview-${index}`,
      name: part.name,
      node_path: part.nodePath,
      unbound: false,
      axis: 'y',
      apart_mm: 0,
      quantity: 1,
      unit_price: 0,
      fitted_at: null,
    }));
    const stage = this.hooks.stage;
    if (stage !== null) {
      await stage.loadBuffer(bytes, parts, 1);
      stage.setState('preview');
      stage.setFocus(parts.map((part) => part.id));
    }
    this.hooks.stageStatus.say(stageStatus.previewing(file.name));
    if (this.hooks.uploadButton !== null) setDisabled(this.hooks.uploadButton, false);
  }

  /**
   * Shows the uploading copy from the press until the server replies, then the
   * stored, refusal or outage copy.
   */
  async upload(): Promise<void> {
    const preview = this.preview;
    if (preview === null) return;
    this.hooks.stageStatus.say(stageStatus.uploading(preview.name, 0));
    const reply = await uploadModel(
      `/api/guides/${this.hooks.guideId}/model`,
      preview.bytes,
      (sent, total) => {
        const percent = Math.min(100, Math.floor((sent / total) * 100));
        this.hooks.stageStatus.say(stageStatus.uploading(preview.name, percent));
      },
    );
    const body = reply.body as {
      error?: string;
      limit?: number;
      count?: number;
      model?: { bytes: number; scale: number };
      parts?: Part[];
      unbound?: string[];
    };
    if (reply.status === 201 && body.model !== undefined) {
      this.preview = null;
      if (this.hooks.uploadButton !== null) setDisabled(this.hooks.uploadButton, true);
      this.hooks.stageStatus.say(stageStatus.stored(preview.name, body.model.bytes));
      this.hooks.onStored(body.parts ?? [], body.unbound ?? [], body.model.scale);
      return;
    }
    if (reply.status === 503) {
      this.hooks.stageStatus.say(stageStatus.storageOutAuthor);
      return;
    }
    this.hooks.stageStatus.say(
      refusalCopy(
        {
          error: (body.error ?? 'not_glb') as GlbRefusal['error'],
          limit: body.limit ?? 0,
          count: body.count ?? 0,
        } as GlbRefusal,
        preview.name,
      ),
    );
  }

  reportPublishRefusal(body: { error?: string; parts?: string[] }): string {
    switch (body.error) {
      case 'no_version':
        return editorStatus.publishNeedsVersion;
      case 'model_not_stored':
        return editorStatus.publishNeedsModel;
      case 'storage_unavailable':
        return editorStatus.publishStorageOut;
      case 'unbound_parts':
        return editorStatus.publishUnboundParts(body.parts ?? []);
      default:
        return editorStatus.publishScaleUnconfirmed;
    }
  }
}
