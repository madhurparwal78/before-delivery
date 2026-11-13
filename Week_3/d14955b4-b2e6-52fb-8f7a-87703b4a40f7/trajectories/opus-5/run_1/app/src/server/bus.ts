import { EventEmitter } from 'node:events';
import type { ForensicsBody, ThreadStatus, Topic } from '../shared/types';

/** The one shared source live updates fan out from. */

export interface ThreadLiveEvent {
  kind: 'thread';
  gameId: string;
  threadId: string;
  topic: Topic;
  status: ThreadStatus;
  playerName: string;
  reason: 'player_message' | 'reply' | 'close' | 'event' | 'attachment';
  /** Purchase and refund data is held back from moderators without `receipts`. */
  receiptRelated: boolean;
}

export interface RefusedEventLiveEvent {
  kind: 'refused_event';
  gameId: string;
  threadId: string;
  topic: Topic;
  playerName: string;
  reasonWords: string;
  receiptRelated: boolean;
}

export interface RulesLiveEvent {
  kind: 'rules';
  gameId: string;
  moderatorId: string;
}

export interface ForensicsLiveEvent {
  kind: 'forensics';
  messageId: string;
  body: ForensicsBody;
}

export type LiveEvent = ThreadLiveEvent | RefusedEventLiveEvent | RulesLiveEvent | ForensicsLiveEvent;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publish(event: LiveEvent): void {
  emitter.emit('live', event);
}

export function subscribe(listener: (event: LiveEvent) => void): () => void {
  emitter.on('live', listener);
  return () => emitter.off('live', listener);
}
