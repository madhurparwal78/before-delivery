import type { Account, Config, KeyBackup } from '../../shared/types';
import { newIdentity, openKeyBackup, recoveryKeys, newProfileKey, type NewIdentity, type RecoveryKeys } from '../crypto/identity';
import { api, ApiFailure, hooks } from './api';
import { forgetSentKeys, sealAndSaveProfile, sendProfileKeyToAll } from './profiles';
import { refreshConversations } from './conversations';
import { loadBlocks } from './actions';
import { MARKER, db, openStorage, privateKeyFor, rememberKey } from './session';
import { setState } from './state';
import { startSync, stopSync, loadLetters } from './sync';
import type { PeerProfile } from '../types';
import { getState } from './state';

hooks.onStorage = (available) => setState({ outage: !available });
hooks.onUnauthenticated = () => {
  if (getState().auth !== 'signed_in') return;
  stopSync();
  setState({ auth: 'revoked', me: null });
};

export async function enterApp(account: Account): Promise<void> {
  const myProfile = (await db().getValue<PeerProfile>('myProfile')) ?? null;
  setState({ me: account, auth: 'signed_in', myProfile, conversations: {}, conversationsLoaded: false });
  startSync();
  void loadBlocks();
}

export async function bootApp(): Promise<void> {
  const config = await api<Config>('GET', '/api/config');
  setState({ config });
  api<{ status: string }>('GET', '/api/health').then(
    (health) => setState({ outage: health.status === 'unavailable' }),
    () => undefined,
  );
  if (!localStorage.getItem(MARKER)) {
    setState({ auth: 'anonymous' });
    return;
  }
  try {
    const me = await api<Account>('GET', '/api/me');
    await openStorage(me.id);
    if (!privateKeyFor(me.key_id)) {
      setState({ auth: 'revoked' });
      return;
    }
    await enterApp(me);
  } catch (error) {
    if (!(error instanceof ApiFailure && error.status === 401)) throw error;
    setState({ auth: 'revoked' });
  }
}

/**
 * Creates the account from keys made in this browser and opens this browser's storage for it. The person stays on
 * the sign-up screens until they call `enterApp`.
 */
export async function createAccount(username: string, keys: RecoveryKeys, identity: NewIdentity): Promise<Account> {
  const account = await api<Account>('POST', '/api/accounts', {
    username,
    public_key: identity.publicKey,
    recovery_verifier: keys.verifier,
    key_backup: identity.keyBackup,
  });
  await openStorage(account.id);
  await rememberKey(identity.keyId, identity.privateKey);
  return account;
}

/**
 * Restores an account with its recovery code: a new identity key becomes current, every earlier key's backup is
 * opened so held letters still open, and a fresh profile key goes to every accepted contact.
 */
export async function restoreAccount(username: string, code: string): Promise<void> {
  const keys = await recoveryKeys(code);
  const identity = await newIdentity(keys.backupKey);
  const result = await api<{ account: Account; key_backups: KeyBackup[] }>('POST', '/api/recover', {
    username,
    recovery_verifier: keys.verifier,
    public_key: identity.publicKey,
    key_backup: identity.keyBackup,
  });
  await openStorage(result.account.id);
  await rememberKey(identity.keyId, identity.privateKey);
  for (const backup of result.key_backups) await rememberKey(backup.key_id, await openKeyBackup(keys.backupKey, backup));
  await enterApp(result.account);
  const previous = getState().myProfile;
  await sealAndSaveProfile(newProfileKey(), { v: 1, display_name: previous?.displayName ?? result.account.username, photo: previous?.photo ?? null });
  await refreshConversations();
  await forgetSentKeys();
  await sendProfileKeyToAll();
  await Promise.all(Object.values(getState().conversations).map((conversation) => loadLetters(conversation.id)));
}
