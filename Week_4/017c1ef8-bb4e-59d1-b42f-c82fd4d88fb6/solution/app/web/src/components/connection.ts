import { api, ApiError } from '../api';
import { formatCount, formatDate, formatTime } from '../format';
import type { ConnectionState } from '../types';

export type ConnectionAction = 'connect' | 'withdraw' | 'accept' | 'ignore' | 'remove';

interface ConnectionButton {
  id: 'primary' | 'secondary' | 'message';
  label: string;
  /** Absent for Message, which is a link. */
  action?: ConnectionAction;
}

/** The connection buttons per state, exactly as the brief publishes them. Message is left out until `messageReady`. */
export function connectionButtons(state: ConnectionState, options: { remove: boolean; messageReady: boolean }): ConnectionButton[] {
  switch (state) {
    case 'pending_sent':
      return [{ id: 'primary', label: 'Withdraw', action: 'withdraw' }];
    case 'pending_received':
      return [
        { id: 'primary', label: 'Accept', action: 'accept' },
        { id: 'secondary', label: 'Ignore', action: 'ignore' },
      ];
    case 'connected':
      return [
        ...(options.messageReady ? [{ id: 'message' as const, label: 'Message' }] : []),
        ...(options.remove ? [{ id: 'secondary' as const, label: 'Remove connection', action: 'remove' as const }] : []),
      ];
    case 'none':
    case 'withdrawn':
    case 'ignored':
      return [{ id: 'primary', label: 'Connect', action: 'connect' }];
  }
}

const REQUESTS: Record<ConnectionAction, (memberId: string) => Promise<{ state: ConnectionState }>> = {
  connect: (memberId) => api.post('/api/connections', { member_id: memberId }),
  withdraw: (memberId) => api.post(`/api/connections/${memberId}/withdraw`),
  accept: (memberId) => api.post(`/api/connections/${memberId}/accept`),
  ignore: (memberId) => api.post(`/api/connections/${memberId}/ignore`),
  remove: (memberId) => api.delete(`/api/connections/${memberId}`),
};

/** Sends the action and returns the connection state the server answers with. */
export async function sendConnectionAction(action: ConnectionAction, memberId: string): Promise<ConnectionState> {
  return (await REQUESTS[action](memberId)).state;
}

/** The polite Network announcement for a succeeded action; `firstDegree` is set on that member's own profile. */
export function connectionAnnouncement(action: ConnectionAction, name: string, state: ConnectionState, firstDegree: boolean): string {
  const connected = `You are now connected with ${name}.${firstDegree ? ' 1st degree.' : ''}`;
  switch (action) {
    case 'connect':
      return state === 'connected' ? connected : `Invitation sent to ${name}.`;
    case 'accept':
      return connected;
    case 'withdraw':
      return 'Invitation withdrawn.';
    case 'ignore':
      return 'Invitation ignored.';
    case 'remove':
      return 'Connection removed.';
  }
}

/** The alert beside a failed connection action: the cooldown with the server's retry instant, the weekly limit, or the generic text. */
export function connectionFailure(error: unknown, name: string, timeZone: string): string {
  if (error instanceof ApiError && error.status === 409 && error.body.error === 'invite_cooldown') {
    const retry = String(error.body.retry_at);
    return `You withdrew an invitation to ${name}. You can invite them again on ${formatDate(retry, timeZone)} at ${formatTime(retry, timeZone)}.`;
  }
  if (error instanceof ApiError && error.status === 429) return `You've reached the weekly invitation limit of ${formatCount(Number(error.body.limit))}.`;
  return 'Something went wrong. Try again.';
}
