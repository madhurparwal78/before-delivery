import { ApiFailure, NoAnswer, request } from './api.js';
import { copy } from '../shared/copy.js';
import type { Placement } from '../shared/types.js';

export interface PatchChange {
  id: string;
  kind: 'patch';
  placementId: string;
  body: Record<string, unknown>;
}

export interface DeleteChange {
  id: string;
  kind: 'delete';
  placementId: string;
}

export interface MoveChange {
  id: string;
  kind: 'move';
  placementId: string;
  direction: 'up' | 'down';
}

export type QueuedChange = PatchChange | DeleteChange | MoveChange;

export interface QueueHooks {
  onPlacement(placement: Placement): void;
  onSceneOrder(order: string[]): void;
  onDropped(message: string | null): void;
  onConnection(text: string): void;
  onRedraw(): void;
}

function changeId(): string {
  return `op-${crypto.randomUUID().replace(/-/g, '')}`.slice(0, 40);
}

/** The editor's save queue: one change at a time, oldest first, kept in the browser. */
export class SaveQueue {
  private items: QueuedChange[] = [];
  private versions = new Map<string, number>();
  private sending = false;
  private offline = false;
  private timer: number | null = null;

  constructor(
    private readonly roomId: string,
    private readonly hooks: QueueHooks,
  ) {
    const stored = window.localStorage.getItem(this.storageKey);
    if (stored !== null) {
      try {
        this.items = JSON.parse(stored) as QueuedChange[];
      } catch {
        this.items = [];
      }
    }
    window.addEventListener('online', () => void this.pump());
  }

  private get storageKey(): string {
    return `kb-queue-${this.roomId}`;
  }

  get waiting(): QueuedChange[] {
    return [...this.items];
  }

  knowVersion(placementId: string, version: number): void {
    this.versions.set(placementId, version);
  }

  newId(): string {
    return changeId();
  }

  add(change: QueuedChange): void {
    this.items.push(change);
    this.persist();
    this.report();
    void this.pump();
  }

  private persist(): void {
    window.localStorage.setItem(this.storageKey, JSON.stringify(this.items));
  }

  private report(): void {
    if (this.items.length === 0) {
      this.hooks.onConnection(copy.connectionSaved);
      return;
    }
    this.hooks.onConnection(
      this.offline ? copy.connectionOffline(this.items.length) : copy.connectionSaving,
    );
  }

  private retryLater(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.pump();
    }, 5000);
  }

  async pump(): Promise<void> {
    if (this.sending) return;
    const change = this.items[0];
    if (!change) {
      this.offline = false;
      this.report();
      return;
    }
    this.sending = true;
    try {
      await this.send(change);
      this.offline = false;
      this.items.shift();
      this.persist();
    } catch (error) {
      if (error instanceof NoAnswer) {
        this.offline = true;
        this.report();
        this.retryLater();
        this.sending = false;
        return;
      }
      this.items.shift();
      this.persist();
      this.offline = false;
      this.explain(error);
    }
    this.sending = false;
    this.report();
    void this.pump();
  }

  private explain(error: unknown): void {
    if (!(error instanceof ApiFailure)) {
      this.hooks.onDropped(null);
      this.hooks.onRedraw();
      return;
    }
    const body = error.body;
    if (error.status === 412) {
      this.hooks.onDropped(copy.staleVersion);
      if (body.current) this.hooks.onPlacement(body.current as Placement);
      return;
    }
    if (error.status === 410 && body.label !== undefined && body.deletedBy !== undefined) {
      this.hooks.onDropped(copy.placementDeleted(body.label, body.deletedBy.displayName));
      this.hooks.onRedraw();
      return;
    }
    if (error.status === 409 && body.error === 'locked' && body.holder !== undefined) {
      this.hooks.onDropped(copy.propHeld(body.holder.displayName));
      this.hooks.onRedraw();
      return;
    }
    if (error.status === 409 && body.error === 'playtest_running') {
      this.hooks.onDropped(copy.playtestRunning);
      this.hooks.onRedraw();
      return;
    }
    this.hooks.onDropped(null);
    this.hooks.onRedraw();
  }

  private async send(change: QueuedChange): Promise<void> {
    const headers = { 'Op-Id': change.id };
    if (change.kind === 'patch') {
      const version = this.versions.get(change.placementId);
      const body = { ...change.body, version: version ?? change.body.version };
      const answer = await request<{ placement: Placement }>(
        'PATCH',
        `/api/rooms/${this.roomId}/placements/${change.placementId}`,
        { body, headers },
      );
      this.versions.set(change.placementId, answer.placement.version);
      this.hooks.onPlacement(answer.placement);
      return;
    }
    if (change.kind === 'delete') {
      await request<void>(
        'DELETE',
        `/api/rooms/${this.roomId}/placements/${change.placementId}`,
        { headers },
      );
      this.versions.delete(change.placementId);
      return;
    }
    const answer = await request<{ sceneOrder: string[]; revision: number }>(
      'POST',
      `/api/rooms/${this.roomId}/placements/${change.placementId}/scene-move`,
      { body: { direction: change.direction }, headers },
    );
    this.hooks.onSceneOrder(answer.sceneOrder);
  }
}
