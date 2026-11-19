import type { Facing } from './domain/layout.js';
import type { Rank } from './domain/ranks.js';
import { personChannel, publish, sessionChannel, valkeyUp } from './services/valkey.js';

export interface RawPerson {
  personId: string;
  displayName: string;
  x: number;
  y: number;
  facing: Facing;
  seated: boolean;
  host: boolean;
  avatarRank: Rank | null;
}

export interface ChatWire {
  id: string;
  fromId: string;
  fromName: string;
  text: string;
  sentAt: string;
}

export interface VoteWire {
  id: string;
  targetId: string;
  targetName: string;
  status: 'open' | 'passed' | 'failed';
  eligible: number;
  needed: number;
  yes: number;
  no: number;
  closesAt: string;
}

export type SessionEvent =
  | { type: 'person-arrived'; person: RawPerson }
  | { type: 'person-moved'; person: RawPerson }
  | { type: 'person-left'; personId: string; displayName: string }
  | { type: 'host-changed'; personId: string; displayName: string }
  | { type: 'chat'; message: ChatWire; recipients: string[] }
  | { type: 'vote'; vote: VoteWire }
  | { type: 'session-ended' };

export type PersonEvent =
  | { type: 'friend-presence' }
  | { type: 'safety-changed' }
  | { type: 'role-changed'; communityId: string }
  | { type: 'removed-from-community'; communityId: string }
  | { type: 'warned' }
  | { type: 'suspended' }
  | { type: 'removed-from-session'; sessionId: string; reason: 'vote' | 'moderator' | 'community' };

export async function publishSessionEvent(sessionId: string, event: SessionEvent): Promise<void> {
  if (!valkeyUp()) return;
  await publish(sessionChannel(sessionId), event).catch(() => undefined);
}

export async function publishPersonEvent(personId: string, event: PersonEvent): Promise<void> {
  if (!valkeyUp()) return;
  await publish(personChannel(personId), event).catch(() => undefined);
}
