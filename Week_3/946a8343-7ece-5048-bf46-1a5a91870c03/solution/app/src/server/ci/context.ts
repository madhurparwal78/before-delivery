// What every CI state change in one transaction shares: who caused it, whether it is a quiet seed, and the live output.
import type { ProjectRow } from "../access.ts";
import type { Say, Tx } from "../db.ts";
import { audit } from "../audit.ts";
import { dispatchWebhook, type WebhookEvent } from "../admin/index.ts";

export class CiContext {
  readonly tx: Tx;
  readonly project: ProjectRow;
  /** Username for audit rows, or `system` for the scheduler and server deadlines. */
  readonly actor: string;
  readonly actorId: number | null;
  /** Seeding writes no live messages, audit events, webhooks or hooks. */
  readonly quiet: boolean;
  /** Set by anything that changed state; a round that leaves it false "changed nothing". */
  changed = false;
  /** Jobs whose status or log changed, last status wins. */
  readonly touched = new Map<number, { id: number; name: string; status: string }>();
  readonly sealTried = new Set<number>();
  /** Pipelines that must not get automatic retries (train timeouts). */
  readonly noRetry = new Set<number>();
  /** Pipelines that skip the merge train hook when they finish (the train removes the car itself). */
  readonly skipTrain = new Set<number>();

  constructor(tx: Tx, project: ProjectRow, actor: string, actorId: number | null = null, quiet = false) {
    this.tx = tx;
    this.project = project;
    this.actor = actor;
    this.actorId = actorId;
    this.quiet = quiet;
  }

  async emit(type: string, data: Record<string, unknown>, say?: readonly Say[]): Promise<void> {
    this.changed = true;
    if (this.quiet) return;
    await this.tx.emit(this.project.id, type, data, say === undefined || say.length === 0 ? {} : { say });
  }

  async audit(action: string, target: string, before: object | null, after: object | null, actor: string = this.actor): Promise<void> {
    if (this.quiet) return;
    await audit(this.tx, { projectId: this.project.id, actor, action, target, before, after });
  }

  async webhook(event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
    if (this.quiet) return;
    await dispatchWebhook(this.tx, this.project, event, payload);
  }

  afterCommit(hook: () => void | Promise<void>): void {
    if (!this.quiet) this.tx.afterCommit(hook);
  }
}
