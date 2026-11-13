import type { Letter } from '../../shared/types';
import { formatTime } from '../lib/format';
import type { LocalLetter } from '../types';
import { displayName } from './conversations';
import { persist } from './session';
import { announce, getState } from './state';

/** What a letter's server record changes on the local copy. */
function withServerFields(local: LocalLetter, server: Letter): LocalLetter {
  const retracted = server.retracted_at !== null;
  return {
    ...local,
    body: retracted ? null : local.body,
    draft: retracted ? null : local.draft,
    sealed: retracted ? null : local.sealed,
    phase: local.direction === 'sent' && (local.phase === 'queued' || local.phase === 'uploading') ? 'posted' : local.phase,
    seq: server.seq,
    state: server.state,
    failure: server.failure,
    heldAt: server.held_at,
    deliveredAt: server.delivered_at,
    readAt: server.read_at,
    returnedAt: server.returned_at,
    retractedAt: server.retracted_at,
    canRetract: server.can_retract,
  };
}

function announceTransition(before: LocalLetter, server: Letter): void {
  const conversation = getState().conversations[before.conversationId];
  if (!conversation || before.direction !== 'sent') return;
  const name = displayName(conversation.peer.id, conversation.peer.username);
  if (before.state === null && server.state === 'sent') announce(`Sent. Held for ${name} until they collect it.`);
  else if (before.state !== 'delivered' && before.state !== 'read' && server.state === 'delivered' && server.delivered_at) {
    announce(`Delivered to ${name} at ${formatTime(server.delivered_at)}.`);
  } else if (before.state !== 'read' && server.state === 'read' && server.read_at) announce(`Read by ${name} at ${formatTime(server.read_at)}.`);
  else if (before.state !== 'failed' && server.state === 'failed' && server.failure === 'returned') {
    announce(`Your letter to ${name} was returned: not collected in 30 days.`);
  }
}

/**
 * Folds the exchange's record of a letter into this browser's copy, announcing a live change of state. A letter this
 * browser never opened is shown only when it was deleted for everyone, as the notice that replaced it.
 */
export function applyServerLetter(server: Letter, live: boolean): void {
  if (server.class !== 'letter') return;
  const local = getState().letters[server.id];
  if (!local) {
    if (server.retracted_at === null) return;
    const me = getState().me!;
    persist({
      id: server.id,
      conversationId: server.conversation_id,
      direction: server.sender_id === me.id ? 'sent' : 'received',
      letterClass: 'letter',
      body: null,
      draft: null,
      profileKey: null,
      writtenAt: Date.parse(server.held_at),
      phase: server.sender_id === me.id ? 'posted' : 'received',
      sealed: null,
      blobId: null,
      seq: server.seq,
      state: server.state,
      failure: server.failure,
      heldAt: server.held_at,
      deliveredAt: server.delivered_at,
      readAt: server.read_at,
      returnedAt: server.returned_at,
      retractedAt: server.retracted_at,
      canRetract: false,
    });
    return;
  }
  if (live) announceTransition(local, server);
  persist(withServerFields(local, server));
}
