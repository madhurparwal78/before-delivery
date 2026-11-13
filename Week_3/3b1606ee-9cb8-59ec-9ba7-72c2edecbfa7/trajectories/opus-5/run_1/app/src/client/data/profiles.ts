import type { ConversationRecord, ProfileBody, SealedProfile } from '../../shared/types.js';
import { importAesKey, openProfile, sealProfile } from '../crypto/seal.js';
import { api } from './api.js';
import { idbGet, idbPut, STORES } from './idb.js';
import { peerProfileKey, requireIdentity } from './keys.js';
import { emit, state } from './store.js';

const CACHE_KEY = 'peer_profiles';

type ProfileCache = Record<string, ProfileBody>;

async function cache(): Promise<ProfileCache> {
  return (await idbGet<ProfileCache>(STORES.prefs, CACHE_KEY)) ?? {};
}

/** Names opened once on this device stay known, even after the contact's key changes. */
export async function loadCachedProfiles(): Promise<void> {
  for (const [accountId, profile] of Object.entries(await cache())) {
    state.peerProfiles.set(accountId, profile);
  }
}

/** Opens a contact's sealed profile once their profile key has arrived. */
export async function openPeerProfile(record: ConversationRecord): Promise<void> {
  const sealed = record.peer.profile;
  if (sealed === null) return;
  const keyBytes = await peerProfileKey(record.peer.id);
  if (keyBytes === null) return;
  try {
    const profile = await openProfile(await importAesKey(keyBytes), sealed);
    state.peerProfiles.set(record.peer.id, profile);
    await idbPut(STORES.prefs, { ...(await cache()), [record.peer.id]: profile }, CACHE_KEY);
    emit('conversations');
  } catch {
    // The profile was sealed with a key this browser has not been sent yet.
  }
}

export async function openMyProfile(sealed: SealedProfile | null): Promise<void> {
  if (sealed === null) {
    state.profile = null;
    return;
  }
  const me = requireIdentity();
  try {
    state.profile = await openProfile(await importAesKey(me.profileKey), sealed);
  } catch {
    state.profile = null;
  }
}

export async function saveMyProfile(profile: ProfileBody): Promise<void> {
  const me = requireIdentity();
  const sealed = await sealProfile(await importAesKey(me.profileKey), profile);
  const account = await api.saveProfile({
    iv: sealed.iv,
    ciphertext: sealed.ciphertext,
    photo_blob_id: profile.photo === null ? null : profile.photo.blob_id,
  });
  state.me = account;
  state.profile = profile;
  emit('me');
}
