import type { Account, BlockEntry, Conversation, Letter, MuteDuration, PreviewSetting } from '../../shared/types';
import { newProfileKey } from '../crypto/identity';
import { sealFile } from '../crypto/sealing';
import { preparePhoto, PROFILE_PHOTO_EDGE } from '../lib/photo';
import type { ProfileBody } from '../types';
import { api, uploadBlob } from './api';
import { applyConversation, refreshConversation, refreshConversations } from './conversations';
import { applyServerLetter } from './letters';
import { owe } from './owed';
import { resumeOutbox } from './outbox';
import { sealAndSaveProfile, sendProfileKey } from './profiles';
import { db, forget } from './session';
import { announce, getState, setState } from './state';

export async function acceptRequest(conversationId: string): Promise<void> {
  await owe(getState().conversations[conversationId]!.peer.id);
  applyConversation(await api<Conversation>('POST', `/api/conversations/${conversationId}/accept`, {}));
  await sendProfileKey(getState().conversations[conversationId]!);
}

export async function deleteRequest(conversationId: string): Promise<void> {
  await api('DELETE', `/api/conversations/${conversationId}`);
  for (const letter of Object.values(getState().letters)) if (letter.conversationId === conversationId) forget(letter.id);
  setState((current) => {
    const { [conversationId]: _gone, ...rest } = current.conversations;
    return { conversations: rest };
  });
}

export async function loadBlocks(): Promise<void> {
  const { blocks } = await api<{ blocks: BlockEntry[] }>('GET', '/api/blocks');
  setState({ blocks, blocksLoaded: true });
}

export async function blockPeer(peerId: string): Promise<void> {
  await api('PUT', `/api/blocks/${peerId}`, {});
  await Promise.all([loadBlocks(), refreshConversations()]);
}

export async function unblockPeer(peerId: string): Promise<void> {
  await api('DELETE', `/api/blocks/${peerId}`);
  await Promise.all([loadBlocks(), refreshConversations()]);
  resumeOutbox();
}

export async function muteConversation(conversationId: string, duration: MuteDuration): Promise<void> {
  applyConversation(await api<Conversation>('PUT', `/api/conversations/${conversationId}/mute`, { duration }));
}

export async function setSeal(peer: Conversation['peer'], verified: boolean): Promise<void> {
  await api('PUT', `/api/contacts/${peer.id}/seal`, { key_id: peer.key_id, verified });
  await refreshConversationOf(peer.id);
}

async function refreshConversationOf(peerId: string): Promise<void> {
  const conversation = Object.values(getState().conversations).find((candidate) => candidate.peer.id === peerId);
  if (conversation) await refreshConversation(conversation.id);
}

/** Accepting a changed seal number releases the paused letters (resealed to the new key) and sends the profile key again. */
export async function acceptNewSeal(conversation: Conversation): Promise<void> {
  await setSeal(conversation.peer, false);
  const fresh = getState().conversations[conversation.id] ?? conversation;
  await sendProfileKey(fresh);
  resumeOutbox();
}

export async function retractLetter(letterId: string): Promise<void> {
  applyServerLetter(await api<Letter>('POST', `/api/letters/${letterId}/retract`, {}), false);
}

let undoTimer: ReturnType<typeof setTimeout> | null = null;

function finishDelete(): void {
  const pending = getState().snackbar;
  if (undoTimer !== null) clearTimeout(undoTimer);
  undoTimer = null;
  if (!pending) return;
  forget(pending.letterId);
  setState((current) => {
    const { [pending.letterId]: _gone, ...hidden } = current.hidden;
    return { hidden, snackbar: null };
  });
}

/** Hides the letter at once; it is removed from this browser for good when the undo window ends. */
export function deleteForMe(letterId: string, conversationId: string): void {
  finishDelete();
  setState((current) => ({ hidden: { ...current.hidden, [letterId]: true }, snackbar: { letterId, conversationId } }));
  announce('Letter deleted.');
  undoTimer = setTimeout(finishDelete, getState().config!.timers.undo_ms);
}

export function undoDelete(): void {
  const pending = getState().snackbar;
  if (!pending) return;
  if (undoTimer !== null) clearTimeout(undoTimer);
  undoTimer = null;
  setState((current) => {
    const { [pending.letterId]: _gone, ...hidden } = current.hidden;
    return { hidden, snackbar: null };
  });
  announce('Letter restored.');
}

export async function saveSettings(change: { read_receipts?: boolean; preview?: PreviewSetting }): Promise<void> {
  setState({ me: await api<Account>('PATCH', '/api/me/settings', change) });
}

export async function changeUsername(username: string): Promise<void> {
  const me = await api<Account>('PATCH', '/api/me/username', { username });
  setState({ me });
  announce(`Your username is now ${me.username}.`);
}

export async function openConversationWith(peerId: string): Promise<string> {
  const record = await api<Conversation>('POST', '/api/conversations', { peer_id: peerId });
  applyConversation(record);
  return record.id;
}

interface ProfileResult {
  photoSaved: boolean;
}

/** Seals and saves the display name and, when one was chosen, a photo stored first as a sealed `photo` blob. */
export async function saveProfile(displayName: string, photoFile: File | null): Promise<ProfileResult> {
  const profileKey = (await db().getValue<string>('profileKey')) ?? newProfileKey();
  let photo: ProfileBody['photo'] = getState().myProfile?.photo ?? null;
  let photoSaved = true;
  if (photoFile) {
    try {
      const prepared = await preparePhoto(photoFile, PROFILE_PHOTO_EDGE);
      const sealed = await sealFile(prepared.bytes);
      const blobId = crypto.randomUUID();
      await api('POST', '/api/blobs', { id: blobId, kind: 'photo', size: sealed.sealed.length });
      await uploadBlob(blobId, sealed.sealed);
      photo = { blob_id: blobId, key: sealed.key, iv: sealed.iv, digest: sealed.digest, type: 'image/jpeg' };
    } catch {
      photoSaved = false;
    }
  }
  await sealAndSaveProfile(profileKey, { v: 1, display_name: displayName, photo });
  return { photoSaved };
}
