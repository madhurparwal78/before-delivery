import type { Conversation, SealedProfile } from '../../shared/types';
import { aesKey, openBody, sealBody } from '../crypto/sealing';
import { fromBase64url } from '../lib/base64';
import type { PeerProfile, ProfileBody } from '../types';
import { api } from './api';
import { onConversations } from './conversations';
import { writeProfileKey } from './outbox';
import { forgetSent, owe, owes, sentTo } from './owed';
import { db } from './session';
import { getState, setState } from './state';

const decrypted = new Map<string, { ciphertext: string; profile: PeerProfile | null }>();
const keyCache = new Map<string, CryptoKey>();

const peerKeyName = (accountId: string): string => `profileKey:${accountId}`;

async function profileCryptoKey(rawKey: string): Promise<CryptoKey> {
  const cached = keyCache.get(rawKey);
  if (cached) return cached;
  const made = await aesKey(fromBase64url(rawKey));
  keyCache.set(rawKey, made);
  return made;
}

/** Opens each peer's sealed profile with the profile key they sent in a control letter. */
async function refreshProfiles(conversations: Conversation[]): Promise<void> {
  const opened: Record<string, PeerProfile> = {};
  for (const conversation of conversations) {
    const { id, profile } = conversation.peer;
    if (!profile) continue;
    const seen = decrypted.get(id);
    if (seen && seen.ciphertext === profile.ciphertext) continue;
    const rawKey = await db().getValue<string>(peerKeyName(id));
    if (!rawKey) continue;
    try {
      const body = await openBody<ProfileBody>(await profileCryptoKey(rawKey), profile);
      const view: PeerProfile = { displayName: body.display_name, photo: body.photo };
      decrypted.set(id, { ciphertext: profile.ciphertext, profile: view });
      opened[id] = view;
    } catch {
      decrypted.set(id, { ciphertext: profile.ciphertext, profile: null });
    }
  }
  if (Object.keys(opened).length > 0) setState((current) => ({ profiles: { ...current.profiles, ...opened } }));
}

/** A peer's control letter arrived: keep their profile key, open their profile, and answer with mine once. */
export async function receiveProfileKey(peerId: string, profileKey: string): Promise<void> {
  await db().setValue(peerKeyName(peerId), profileKey);
  decrypted.delete(peerId);
  const conversation = Object.values(getState().conversations).find((candidate) => candidate.peer.id === peerId);
  if (!conversation) return;
  await refreshProfiles([conversation]);
  if (conversation.status === 'accepted' && !(await sentTo(peerId))) await sendProfileKey(conversation);
}

/** Owes the contact this account's profile key, and queues the control letter that carries it. */
export async function sendProfileKey(conversation: Conversation): Promise<void> {
  await owe(conversation.peer.id);
  await payOwed(conversation);
}

async function payOwed(conversation: Conversation): Promise<void> {
  const mine = await db().getValue<string>('profileKey');
  if (mine) await writeProfileKey(conversation.id, mine);
}

/** After a reload or a reconnect: queue the profile keys this browser still owes. */
export async function payOwedKeys(): Promise<void> {
  for (const conversation of Object.values(getState().conversations)) {
    if (conversation.status === 'accepted' && (await owes(conversation.peer.id))) await payOwed(conversation);
  }
}

export async function sendProfileKeyToAll(): Promise<void> {
  for (const conversation of Object.values(getState().conversations)) {
    if (conversation.status === 'accepted') await sendProfileKey(conversation);
  }
}

export async function forgetSentKeys(): Promise<void> {
  for (const conversation of Object.values(getState().conversations)) await forgetSent(conversation.peer.id);
}

/** Seals the profile with the account's profile key and saves it; a photo is already stored under `photo`. */
export async function sealAndSaveProfile(profileKey: string, body: ProfileBody): Promise<void> {
  const sealed = await sealBody(await profileCryptoKey(profileKey), body);
  await api('PUT', '/api/me/profile', { ...sealed, photo_blob_id: body.photo?.blob_id ?? null } satisfies SealedProfile);
  await db().setValue('profileKey', profileKey);
  await db().setValue('myProfile', { displayName: body.display_name, photo: body.photo });
  setState({ myProfile: { displayName: body.display_name, photo: body.photo } });
}

onConversations((records) => void refreshProfiles(records));
