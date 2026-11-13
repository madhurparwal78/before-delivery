import type { ApiErrorBody, ErrorCode } from './errors.js';

export interface OpBase {
  op_id: string;
  type: string;
}

export interface OpResult {
  op_id: string;
  status: 'applied' | 'rebased' | 'dropped' | 'redirected';
  handles: string[];
  message: string | null;
}

export interface OpGroupRequest {
  base_revision: number;
  group_id: string;
  command: string;
  ops: Array<OpBase & Record<string, unknown>>;
}

export interface OpGroupResult {
  revision: number;
  results: OpResult[];
}

export const OP_COMMANDS = new Set([
  'GRIP',
  'NUDGE',
  'LAYER',
  'PROPERTIES',
  'PARAM',
  'XRELOAD',
  'XCLIP',
  'LAYERSTATE',
  'RESTORE',
  'IMPORT',
]);

export interface LiveMessage {
  seq: number;
  type: string;
  data: unknown;
}

export type LiveMessageType =
  | 'ops'
  | 'presence'
  | 'xref_version'
  | 'version'
  | 'markup'
  | 'issue'
  | 'rfi'
  | 'review'
  | 'role'
  | 'export'
  | 'notice'
  | 'link';

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string';
}

export function parseErrorBody(body: unknown): ApiErrorBody | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.error !== 'string' || typeof record.message !== 'string') return null;
  return body as ApiErrorBody;
}
