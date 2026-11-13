import { openAccountDatabase, type AccountDatabase } from './idb';
import { setState } from './state';
import type { LocalLetter } from '../types';

export const MARKER = 'airfold.account';

let database: AccountDatabase | null = null;
const privateKeys = new Map<string, CryptoKey>();

export function db(): AccountDatabase {
  if (!database) throw new Error('no account is open in this browser');
  return database;
}

/** Opens this account's browser storage and loads its keys and opened letters. */
export async function openStorage(accountId: string): Promise<void> {
  database = await openAccountDatabase(accountId);
  privateKeys.clear();
  for (const stored of database.keys) privateKeys.set(stored.keyId, stored.privateKey);
  const letters: Record<string, LocalLetter> = {};
  for (const letter of database.letters) letters[letter.id] = letter;
  setState({ letters });
  localStorage.setItem(MARKER, accountId);
}

export async function rememberKey(keyId: string, privateKey: CryptoKey): Promise<void> {
  privateKeys.set(keyId, privateKey);
  await db().putKey({ keyId, privateKey });
}

export const privateKeyFor = (keyId: string): CryptoKey | undefined => privateKeys.get(keyId);

/** Saves a letter in memory and in this browser's storage; the promise settles when it is safely stored. */
export function persist(letter: LocalLetter): Promise<void> {
  setState((current) => ({ letters: { ...current.letters, [letter.id]: letter } }));
  return db().putLetter(letter);
}

export function forget(id: string): void {
  setState((current) => {
    const { [id]: _gone, ...rest } = current.letters;
    return { letters: rest };
  });
  void db().removeLetter(id);
  void db().removeFile(id);
}

