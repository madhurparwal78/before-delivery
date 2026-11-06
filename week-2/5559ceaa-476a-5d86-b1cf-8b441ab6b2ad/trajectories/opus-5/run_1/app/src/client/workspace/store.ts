import type {
  Checkpoint,
  FileMeta,
  Member,
  ProjectDetail,
  ServerFrame,
  Session,
  User,
} from '../../shared/api.js';
import { api } from '../net.js';

export type Channel =
  | 'header'
  | 'rail'
  | 'baton'
  | 'tree'
  | 'tabs'
  | 'code'
  | 'cursors'
  | 'ledger'
  | 'layout'
  | 'access';

export type Band = 'narrow' | 'medium' | 'wide';

export interface Cursor {
  file_id: string;
  path: string;
  line: number;
  column: number;
}

export interface OpenFile {
  id: string;
  text: string;
  revision: number;
  dirty: boolean;
}

const TINTS = 7;

export function bandOf(width: number): Band {
  if (width >= 1280) return 'wide';
  return width >= 768 ? 'medium' : 'narrow';
}

export class WorkspaceStore {
  participants: Member[] = [];
  sessions: Session[] = [];
  files: FileMeta[] = [];
  checkpoints: Checkpoint[] = [];
  readonly open = new Map<string, OpenFile>();
  readonly cursors = new Map<string, Cursor>();
  activeFileId: string | null = null;
  selectedPath: string | null = null;
  expandedFolders = new Set<string>();
  following: string | null = null;
  lastRestore: { id: string; name: string } | null = null;
  removed = false;
  band: Band = bandOf(window.innerWidth);
  ledgerOpen = false;
  filesOverlayOpen = false;
  private socket: WebSocket | null = null;
  private readonly listeners = new Map<Channel, Set<() => void>>();

  constructor(
    readonly user: User,
    public project: ProjectDetail,
  ) {
    this.participants = project.members;
    this.sessions = project.sessions;
    this.ledgerOpen = this.band === 'wide';
  }

  on(channel: Channel, listener: () => void): void {
    const set = this.listeners.get(channel) ?? new Set();
    set.add(listener);
    this.listeners.set(channel, set);
  }

  emit(...channels: Channel[]): void {
    for (const channel of channels) {
      for (const listener of this.listeners.get(channel) ?? []) listener();
    }
  }

  get projectId(): string {
    return this.project.id;
  }

  get isMentor(): boolean {
    return this.project.owner.id === this.user.id;
  }

  /** The live or paused session, else the next scheduled, else the last ended. */
  get session(): Session | null {
    const running = this.sessions.find(
      (item) => item.state === 'live' || item.state === 'paused',
    );
    if (running !== undefined) return running;
    const scheduled = this.sessions
      .filter((item) => item.state === 'scheduled')
      .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
    if (scheduled[0] !== undefined) return scheduled[0];
    const ended = this.sessions.filter((item) => item.state === 'ended');
    return ended[ended.length - 1] ?? null;
  }

  get liveSession(): Session | null {
    return this.sessions.find((item) => item.state === 'live') ?? null;
  }

  get driverId(): string | null {
    const running = this.sessions.find(
      (item) => item.state === 'live' || item.state === 'paused',
    );
    return running?.driver_id ?? null;
  }

  get isDriving(): boolean {
    return this.driverId === this.user.id;
  }

  /** The write rule as the screen sees it, so the editor can go read-only. */
  get mayWrite(): boolean {
    if (this.removed) return false;
    const running = this.sessions.find(
      (item) => item.state === 'live' || item.state === 'paused',
    );
    if (running === undefined) return true;
    if (running.state === 'paused') return false;
    return running.driver_id === this.user.id;
  }

  nameOf(userId: string | null): string {
    if (userId === null) return '';
    return this.participants.find((member) => member.user_id === userId)?.name ?? '';
  }

  tintOf(userId: string): string {
    const index = this.participants.findIndex((member) => member.user_id === userId);
    return `var(--tint-${(index < 0 ? 0 : index % TINTS) + 1})`;
  }

  fileById(fileId: string | null): FileMeta | undefined {
    return this.files.find((file) => file.id === fileId);
  }

  pathOf(fileId: string | null): string {
    return this.fileById(fileId)?.path ?? '';
  }

  async loadFiles(): Promise<void> {
    const loaded = await api<{ files: FileMeta[] }>(`/api/projects/${this.projectId}/files`);
    this.files = loaded.files;
    this.emit('tree', 'tabs', 'code');
  }

  async loadCheckpoints(): Promise<void> {
    const loaded = await api<{ checkpoints: Checkpoint[] }>(
      `/api/projects/${this.projectId}/checkpoints`,
    );
    this.checkpoints = loaded.checkpoints;
    this.emit('ledger');
  }

  async loadProject(): Promise<void> {
    const loaded = await api<{ project: ProjectDetail }>(`/api/projects/${this.projectId}`);
    this.project = loaded.project;
    this.participants = loaded.project.members;
    this.sessions = loaded.project.sessions;
    this.emit('header', 'rail', 'baton');
  }

  async openFile(fileId: string): Promise<void> {
    if (!this.open.has(fileId)) {
      const loaded = await api<{ file: FileMeta & { content: string } }>(
        `/api/projects/${this.projectId}/files/${fileId}`,
      );
      this.open.set(fileId, {
        id: fileId,
        text: loaded.file.content,
        revision: loaded.file.revision,
        dirty: false,
      });
    }
    this.activeFileId = fileId;
    this.emit('tabs', 'code');
  }

  closeFile(fileId: string): void {
    this.open.delete(fileId);
    if (this.activeFileId === fileId) {
      this.activeFileId = [...this.open.keys()][0] ?? null;
    }
    this.emit('tabs', 'code');
  }

  async reloadOpenFiles(): Promise<void> {
    for (const id of [...this.open.keys()]) {
      if (this.fileById(id) === undefined) {
        this.open.delete(id);
        if (this.activeFileId === id) this.activeFileId = [...this.open.keys()][0] ?? null;
        continue;
      }
      const loaded = await api<{ file: FileMeta & { content: string } }>(
        `/api/projects/${this.projectId}/files/${id}`,
      );
      this.open.set(id, {
        id,
        text: loaded.file.content,
        revision: loaded.file.revision,
        dirty: false,
      });
    }
    this.emit('tabs', 'code');
  }

  connect(onFrame: (frame: ServerFrame) => void): void {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(
      `${scheme}://${location.host}/api/projects/${this.projectId}/socket`,
    );
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      onFrame(JSON.parse(String(event.data)) as ServerFrame);
    });
    socket.addEventListener('close', () => {
      this.socket = null;
      if (this.removed) return;
      window.setTimeout(() => this.connect(onFrame), 1000);
    });
  }

  send(frame: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
  }
}
