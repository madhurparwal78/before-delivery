import type { HostLiveEvent, LiveEventType, PublicLiveEvent } from '../../shared/types';
import { publishEvent } from './valkey';

export interface DomainEvent {
  type: LiveEventType;
  date: string;
  time: string;
  tableIds: string[];
  partySize: number;
  reference?: string | null;
  name?: string | null;
  expiresAt?: Date | null;
}

/** Publishes one live event after its change has committed. */
export async function publishLiveEvent(event: DomainEvent): Promise<void> {
  const publicEvent: PublicLiveEvent = {
    type: event.type,
    date: event.date,
    time: event.time,
    table_ids: event.tableIds,
    party_size: event.partySize,
  };
  const hostEvent: HostLiveEvent = {
    ...publicEvent,
    reference: event.reference ?? null,
    name: event.name ?? null,
    expires_at: event.expiresAt ? event.expiresAt.toISOString() : null,
  };
  try {
    await publishEvent(publicEvent, hostEvent);
  } catch {
    // A change that commits while Valkey is unreachable publishes no live event.
  }
}
