/**
 * The live stream hub. Each connection holds a member id (or none) plus optional
 * ride and thread subscriptions; events are pushed to everyone allowed to see
 * the record. `hello` is the first event on every connection.
 */

export interface LiveEvent {
  type: string;
  data: Record<string, unknown>;
  audience: Audience;
}

export interface Audience {
  /** member ids who may see it; empty means anyone */
  memberIds: string[] | null;
  rideId: string | null;
  bookingId: string | null;
  isPublic: boolean;
}

type Sink = (event: string, data: string) => void;

interface Connection {
  memberId: string | null;
  rideId: string | null;
  bookingId: string | null;
  send: Sink;
}

export class LiveHub {
  #conns = new Set<Connection>();

  add(conn: Connection): () => void {
    this.#conns.add(conn);
    return () => this.#conns.delete(conn);
  }

  push(event: LiveEvent): void {
    for (const conn of this.#conns) {
      if (!this.allowed(event.audience, conn)) continue;
      conn.send(event.type, JSON.stringify(event.data));
    }
  }

  private allowed(a: Audience, c: Connection): boolean {
    if (a.isPublic) return true;
    if (a.memberIds !== null) {
      if (c.memberId === null || !a.memberIds.includes(c.memberId)) return false;
    }
    if (a.rideId !== null && c.rideId !== a.rideId) return false;
    if (a.bookingId !== null && c.bookingId !== a.bookingId) return false;
    return true;
  }

  connectionCount(): number {
    return this.#conns.size;
  }
}

export function audienceFor(opts: { memberIds?: string[] | null; rideId?: string | null; bookingId?: string | null; isPublic?: boolean }): Audience {
  return {
    memberIds: opts.memberIds ?? null,
    rideId: opts.rideId ?? null,
    bookingId: opts.bookingId ?? null,
    isPublic: opts.isPublic ?? false,
  };
}
