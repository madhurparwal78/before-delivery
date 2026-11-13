// Serialisers that shape stored rows into the published API bodies.
import type { Action, Role, RuleTopic, ThreadStatus, Topic } from './domain';

export interface MessageRow {
  id: string;
  thread_id: string;
  game_id: string;
  kind: 'player' | 'reply' | 'event';
  author_role: 'player' | 'developer' | 'moderator' | 'game_server';
  author_name: string;
  body: string | null;
  created_at: Date;
  event_type: string | null;
  event_verdict: 'accepted' | 'refused' | null;
  event_receipt_id: string | null;
  event_refund_id: string | null;
  event_refund_applied: boolean | null;
  event_item: string | null;
  event_amount_minor: string | null | number;
  event_currency: string | null;
  event_match_id: string | null;
  event_mode: string | null;
  event_result: string | null;
  event_duration_seconds: string | null | number;
}

export interface AttachmentRow {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: string | number;
  status: 'uploading' | 'attached' | 'failed';
}

export function serialiseAttachment(row: AttachmentRow): Record<string, unknown> {
  return {
    id: row.id,
    message_id: row.message_id,
    filename: row.filename,
    content_type: row.content_type,
    size: Number(row.size),
    status: row.status,
  };
}

export function serialiseMessage(row: MessageRow, attachments: AttachmentRow[], unfurl: Record<string, unknown> | null, includeRefused: boolean): Record<string, unknown> {
  if (row.kind === 'event' && row.event_verdict === 'refused' && !includeRefused) return { __hidden: true, id: row.id };
  const event: Record<string, unknown> | null =
    row.kind === 'event'
      ? {
          type: row.event_type,
          verdict: row.event_verdict,
          receipt_id: row.event_receipt_id,
          refund_id: row.event_refund_id,
          refund_applied: row.event_refund_applied,
          item: row.event_item,
          amount_minor: Number(row.event_amount_minor),
          currency: row.event_currency,
          match_id: row.event_match_id,
          mode: row.event_mode,
          result: row.event_result,
          duration_seconds: Number(row.event_duration_seconds),
        }
      : null;
  return {
    id: row.id,
    kind: row.kind,
    author: { role: row.author_role, name: row.author_name },
    body: row.body,
    created_at: iso(row.created_at),
    attachments: attachments.map(serialiseAttachment),
    unfurl,
    event,
  };
}

export function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export interface ThreadRow {
  id: string;
  game_id: string;
  player_id: string;
  topic: Topic;
  status: ThreadStatus;
  waiting_since: Date | null;
  last_player_message_at: Date | null;
  created_at: Date;
}

export function serialiseThread(row: ThreadRow): Record<string, unknown> {
  return {
    id: row.id,
    status: row.status,
    topic: row.topic,
    waiting_since: iso(row.waiting_since),
    created_at: iso(row.created_at),
  };
}

export interface RuleRow {
  id: string;
  moderator_id: string;
  effect: 'grant' | 'deny';
  action: Action;
  topic: RuleTopic;
  position: string | number;
}

export function serialiseRule(row: RuleRow): Record<string, unknown> {
  return { id: row.id, effect: row.effect, action: row.action, topic: row.topic };
}
