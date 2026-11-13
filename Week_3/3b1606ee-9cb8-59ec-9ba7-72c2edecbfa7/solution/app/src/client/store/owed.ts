import { db } from './session';

/**
 * Whether this browser still owes a contact its profile key. The flag is stored before the control letter is
 * written, so a reload between accepting and posting never loses it.
 */
export const owes = async (peerId: string): Promise<boolean> => (await db().getValue<boolean>(`owes:${peerId}`)) === true;

export const sentTo = async (peerId: string): Promise<boolean> => (await db().getValue<boolean>(`profileKeySent:${peerId}`)) === true;

export async function owe(peerId: string): Promise<void> {
  await db().setValue(`owes:${peerId}`, true);
}

/** The control letter was posted: the debt is paid and the contact has been sent the key. */
export async function profileKeyDelivered(peerId: string): Promise<void> {
  await db().setValue(`owes:${peerId}`, false);
  await db().setValue(`profileKeySent:${peerId}`, true);
}

export async function forgetSent(peerId: string): Promise<void> {
  await db().setValue(`profileKeySent:${peerId}`, false);
}
