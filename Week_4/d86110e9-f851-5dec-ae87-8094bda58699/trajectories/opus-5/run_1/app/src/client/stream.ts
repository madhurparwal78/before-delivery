import { announceRun, notice } from './regions';
import type { RunListItem, RunStatus, StepStatus } from '../shared/types';

export interface RunEvent {
  type: 'run';
  workspace_id: string;
  run: RunListItem;
  steps: { id: string; status: StepStatus; name: string }[];
}

export interface VersionEvent {
  type: 'version';
  workspace_id: string;
  automation_id: string;
  version: number;
}

export interface DrainEvent {
  type: 'drain';
  workspace_id: string;
  automation_id: string;
  count: number;
}

export interface DraftEvent {
  type: 'draft';
  workspace_id: string;
  automation_id: string;
  revision: number;
  step_id: string | null;
}

export interface PresenceEvent {
  type: 'presence';
  workspace_id: string;
  automation_id: string;
  members: { id: string; name: string }[];
}

export interface TableEvent {
  type: 'table';
  workspace_id: string;
  table_id: string;
}

type AnyEvent = RunEvent | VersionEvent | DrainEvent | DraftEvent | PresenceEvent | TableEvent;

export interface StreamHandlers {
  run?: (event: RunEvent) => void;
  version?: (event: VersionEvent) => void;
  drain?: (event: DrainEvent) => void;
  draft?: (event: DraftEvent) => void;
  presence?: (event: PresenceEvent) => void;
  table?: (event: TableEvent) => void;
  reconnect?: () => void;
}

let source: EventSource | null = null;
let current: { workspaceId: string; draftId: string | null } | null = null;
let handlers: StreamHandlers = {};
const lastStatus = new Map<string, RunStatus>();

export function setStreamHandlers(next: StreamHandlers): void {
  handlers = next;
}

function stepName(event: RunEvent, status: StepStatus): string {
  return event.steps.find((step) => step.status === status)?.name ?? '';
}

function announce(event: RunEvent): void {
  const run = event.run;
  const previous = lastStatus.get(run.id);
  if (previous === undefined) announceRun(`Run #${run.number} started`);
  if (previous === run.status) return;
  lastStatus.set(run.id, run.status);
  if (run.status === 'waiting') announceRun(`Run #${run.number} is waiting at ${stepName(event, 'waiting')}`);
  if (run.status === 'succeeded') announceRun(`Run #${run.number} succeeded`);
  if (run.status === 'failed') {
    const named =
      event.steps.find((step) => step.id === run.failed_step)?.name ?? stepName(event, 'failed');
    announceRun(`Run #${run.number} failed at ${named}`);
  }
  if (run.status === 'cancelled') announceRun(`Run #${run.number} was cancelled`);
}

function handle(event: AnyEvent): void {
  if (event.type === 'run') {
    announce(event);
    handlers.run?.(event);
    return;
  }
  if (event.type === 'version') {
    announceRun(`Version ${event.version} published`);
    handlers.version?.(event);
    return;
  }
  if (event.type === 'drain') {
    announceRun(`Runs left on older versions: ${event.count}`);
    handlers.drain?.(event);
    return;
  }
  if (event.type === 'draft') {
    handlers.draft?.(event);
    return;
  }
  if (event.type === 'presence') {
    handlers.presence?.(event);
    return;
  }
  handlers.table?.(event);
}

export function connectStream(workspaceId: string, draftId: string | null): void {
  if (current !== null && current.workspaceId === workspaceId && current.draftId === draftId) return;
  closeStream();
  current = { workspaceId, draftId };
  const query = draftId === null ? '' : `?draft=${encodeURIComponent(draftId)}`;
  const opened = new EventSource(`/api/workspaces/${workspaceId}/events${query}`);
  let dropped = false;
  opened.addEventListener('message', (message) => {
    handle(JSON.parse((message as MessageEvent<string>).data) as AnyEvent);
  });
  opened.addEventListener('open', () => {
    if (dropped) {
      dropped = false;
      handlers.reconnect?.();
    }
  });
  opened.addEventListener('error', () => {
    dropped = true;
    notice('Live updates paused. Reconnecting...');
  });
  source = opened;
}

export function closeStream(): void {
  source?.close();
  source = null;
  current = null;
}
