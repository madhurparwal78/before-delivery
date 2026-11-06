// Password hashing: memory-hard Argon2id, each password with its own salt.

import argon2 from 'argon2';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// A real hash of an unguessable value, computed once at start. Verifying
// against it does the same work as verifying a real account's password, so
// response times do not reveal whether an email exists.
let dummyHash: string | null = null;

export async function dummyVerify(): Promise<void> {
  if (dummyHash === null) {
    dummyHash = await argon2.hash('scopewright-timing-dummy-9f1c2d3e', { type: argon2.argon2id });
  }
  await argon2.verify(dummyHash, 'not-the-password');
}
