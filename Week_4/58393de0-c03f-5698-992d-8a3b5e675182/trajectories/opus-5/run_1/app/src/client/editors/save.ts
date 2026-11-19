import type { Project, ProjectKind, Snapshot } from '../../shared/types.js';
import { ERROR_COPY, UI_COPY } from '../../shared/copy.js';
import { api } from '../api.js';
import { say } from '../status.js';
import { addNotice, removeNotice } from '../notice.js';
import { timers } from '../runtime.js';
import { onLive } from '../live.js';
import { reload } from '../router.js';

export interface SaveEngineOptions {
  kind: ProjectKind;
  project: Project | null;
  name: () => string;
  snapshot: () => Snapshot;
  onRevision: (revision: number) => void;
  onReadOnly: () => void;
  onExternalSnapshot: (snapshot: Snapshot, revision: number) => void;
  indicator: HTMLElement;
}

const keptEditsKey = (projectId: string | null, kind: ProjectKind): string =>
  `qy-edits:${projectId ?? `new-${kind}`}`;

/** One place decides how a revision is stored, and what the editor says about it. */
export class SaveEngine {
  private project: Project | null;
  private dirty = false;
  private timer = 0;
  private readOnly = false;
  private saving = false;
  private readonly stops: (() => void)[] = [];

  constructor(private readonly options: SaveEngineOptions) {
    this.project = options.project;
    this.setIndicator(
      this.project ? UI_COPY.savedLabel(this.project.revision) : UI_COPY.unsavedLabel,
    );
    this.stops.push(
      onLive('project-saved', (data) => {
        if (!this.project || data.projectId !== this.project.id) return;
        if (data.revision <= this.project.revision) return;
        if (this.dirty) return;
        void this.loadNewer(data.revision);
      }),
    );
    this.stops.push(
      onLive('project-handed-in', (data) => {
        if (!this.project || data.projectId !== this.project.id) return;
        this.freeze('project_handed_in');
      }),
    );
    this.stops.push(
      onLive('classroom-state', (data) => {
        if (!this.project || this.project.classroomId !== data.classroomId) return;
        if (data.state === 'handed_in' || data.state === 'archived') this.freeze('classroom_handed_in');
      }),
    );
  }

  get current(): Project | null {
    return this.project;
  }

  get isReadOnly(): boolean {
    return this.readOnly;
  }

  stop(): void {
    window.clearTimeout(this.timer);
    for (const stop of this.stops) stop();
  }

  private setIndicator(text: string): void {
    this.options.indicator.textContent = text;
  }

  private keep(): void {
    try {
      window.localStorage.setItem(
        keptEditsKey(this.project?.id ?? null, this.options.kind),
        JSON.stringify({ snapshot: this.options.snapshot(), name: this.options.name() }),
      );
    } catch {
      // A full or blocked local store never stops the editor.
    }
  }

  private forgetKept(): void {
    try {
      window.localStorage.removeItem(keptEditsKey(this.project?.id ?? null, this.options.kind));
    } catch {
      // nothing to do
    }
  }

  static keptEdits(projectId: string | null, kind: ProjectKind): { snapshot: Snapshot; name: string } | null {
    try {
      const raw = window.localStorage.getItem(keptEditsKey(projectId, kind));
      return raw === null ? null : (JSON.parse(raw) as { snapshot: Snapshot; name: string });
    } catch {
      return null;
    }
  }

  static discardKept(projectId: string | null, kind: ProjectKind): void {
    try {
      window.localStorage.removeItem(keptEditsKey(projectId, kind));
    } catch {
      // nothing to do
    }
  }

  /** Every edit marks the project unsaved and restarts the autosave timer. */
  markEdited(): void {
    if (this.readOnly) return;
    this.dirty = true;
    this.setIndicator(UI_COPY.unsavedLabel);
    this.keep();
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      void this.save(false);
    }, timers().autosaveMs);
  }

  private freeze(code: 'project_handed_in' | 'classroom_handed_in'): void {
    if (this.readOnly) return;
    this.readOnly = true;
    const text = ERROR_COPY[code];
    addNotice({ id: code, text });
    this.options.onReadOnly();
  }

  private async loadNewer(revision: number): Promise<void> {
    if (!this.project) return;
    const result = await api.project(this.project.id);
    if (!result.ok) return;
    this.project = result.value.project;
    this.options.onExternalSnapshot(result.value.snapshot, result.value.project.revision);
    this.options.onRevision(result.value.project.revision);
    this.setIndicator(UI_COPY.savedLabel(revision));
  }

  async save(explicit: boolean): Promise<void> {
    if (this.readOnly || this.saving) return;
    window.clearTimeout(this.timer);
    this.saving = true;
    this.setIndicator(UI_COPY.savingLabel);
    try {
      const snapshot = this.options.snapshot();
      const name = this.options.name();
      if (!this.project) {
        const created = await api.createProject({ kind: this.options.kind, name, snapshot });
        if (!created.ok) {
          this.failed(created.code, created.message);
          return;
        }
        this.project = created.value.project;
        window.history.replaceState({}, '', `/editor/${this.project.id}`);
      } else {
        const saved = await api.saveProject(this.project.id, {
          baseRevision: this.project.revision,
          snapshot,
          name,
        });
        if (!saved.ok) {
          this.failed(saved.code, saved.message);
          return;
        }
        this.project = saved.value.project;
      }
      this.dirty = false;
      this.forgetKept();
      removeNotice('save-failed');
      removeNotice('storage-down');
      this.setIndicator(UI_COPY.savedLabel(this.project.revision));
      this.options.onRevision(this.project.revision);
      if (explicit) say(UI_COPY.savedRevision(this.project.revision));
    } finally {
      this.saving = false;
    }
  }

  private failed(code: string, message: string): void {
    this.setIndicator(UI_COPY.unsavedLabel);
    if (code === 'storage_unavailable') {
      say(UI_COPY.saveStorageDown);
      addNotice({ id: 'save-failed', text: UI_COPY.saveStorageDown });
      addNotice({ id: 'storage-down', text: UI_COPY.storageStanding });
      return;
    }
    if (code === 'stale_revision') {
      addNotice({
        id: 'stale',
        text: message,
        actions: [{ label: 'Reload', run: () => reload() }],
      });
      return;
    }
    if (code === 'classroom_handed_in') {
      this.readOnly = true;
      addNotice({ id: 'classroom_handed_in', text: message });
      this.options.onReadOnly();
      return;
    }
    if (code === 'project_handed_in') {
      this.readOnly = true;
      addNotice({ id: 'project_handed_in', text: message });
      this.options.onReadOnly();
      return;
    }
    if (code === 'email_unverified') {
      say(message);
      addNotice({ id: 'email_unverified', text: message });
      return;
    }
    say(message);
  }

  async handIn(): Promise<void> {
    if (!this.project) return;
    const result = await api.handInProject(this.project.id);
    if (!result.ok) {
      say(result.message);
      return;
    }
    this.project = result.value.project;
    this.readOnly = true;
    this.options.onReadOnly();
    say(UI_COPY.handedInProject(this.project.name));
  }

  restoreKept(): { snapshot: Snapshot; name: string } | null {
    return SaveEngine.keptEdits(this.project?.id ?? null, this.options.kind);
  }
}
