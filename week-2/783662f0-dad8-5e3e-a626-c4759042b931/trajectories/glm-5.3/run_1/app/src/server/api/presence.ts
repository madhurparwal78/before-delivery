/** Presence: a user is online on a server while they hold an open server stream. */

const online = new Map<string, number>();

function key(serverId: string, handle: string): string {
  return `${serverId}:${handle}`;
}

export const presence = {
  open(serverId: string, handle: string): void {
    online.set(key(serverId, handle), Date.now());
  },
  heartbeat(serverId: string, handle: string): void {
    online.set(key(serverId, handle), Date.now());
  },
  close(serverId: string, handle: string): void {
    online.delete(key(serverId, handle));
  },
  isOnline(serverId: string, handle: string): boolean {
    return online.has(key(serverId, handle));
  },
  /** The set of handles online on a server. */
  onlineOn(serverId: string): string[] {
    const prefix = `${serverId}:`;
    return [...online.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  },
};

export type Presence = typeof presence;
