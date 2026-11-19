import type { JsonObject } from './json.js';
import type { StepKind, TriggerKind } from './kinds.js';

export interface Edge {
  id: string;
  from: string;
  port: string;
  to: string;
  order: number;
}

export interface StepNode {
  id: string;
  kind: StepKind;
  name: string;
  col: number;
  row: number;
  fields: JsonObject;
}

export interface TriggerNode {
  id: 'trigger';
  kind: TriggerKind;
  name: string;
  col: number;
  row: number;
  fields: JsonObject;
  sample: JsonObject;
}

/** What a version, a test-run snapshot and the draft all hold. */
export interface Content {
  trigger: TriggerNode;
  steps: StepNode[];
  edges: Edge[];
}

/** The draft adds the counters that keep ids and default names from repeating. */
export interface Draft extends Content {
  stepSeq: number;
  edgeSeq: number;
  kindSeq: Record<string, number>;
  graveyard: Record<string, StepNode>;
}

export type AnyNode = StepNode | TriggerNode;

export type RunStatus = 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'waiting' | 'retrying' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
export type Role = 'owner' | 'editor' | 'viewer';
