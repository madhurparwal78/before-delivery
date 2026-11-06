import { newId } from './util.js';

export type OutboxKind =
  | 'kb_charge'
  | 'kb_credit'
  | 'kb_account_name'
  | 'kb_account_create'
  | 'mail'
  | 'storage_object'
  | 'sanitation_pdf';

export interface OutboxPayload {
  [key: string]: unknown;
}

export interface OutboxJob {
  id: string;
  kind: OutboxKind;
  payload: OutboxPayload;
}

export function enqueue(kind: OutboxKind, payload: OutboxPayload): OutboxJob {
  return { id: newId('out'), kind, payload };
}
