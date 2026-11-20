/**
 * The live stream hub. Each connection holds a member id (or none) plus optional
 * ride and thread subscriptions; events are pushed to everyone allowed to see
 * the record. `hello` is the first event on every connection.
 */
export class LiveHub {
    #conns = new Set();
    add(conn) {
        this.#conns.add(conn);
        return () => this.#conns.delete(conn);
    }
    push(event) {
        for (const conn of this.#conns) {
            if (!this.allowed(event.audience, conn))
                continue;
            conn.send(event.type, JSON.stringify(event.data));
        }
    }
    allowed(a, c) {
        if (a.isPublic)
            return true;
        if (a.memberIds !== null) {
            if (c.memberId === null || !a.memberIds.includes(c.memberId))
                return false;
        }
        if (a.rideId !== null && c.rideId !== a.rideId)
            return false;
        if (a.bookingId !== null && c.bookingId !== a.bookingId)
            return false;
        return true;
    }
    connectionCount() {
        return this.#conns.size;
    }
}
export function audienceFor(opts) {
    return {
        memberIds: opts.memberIds ?? null,
        rideId: opts.rideId ?? null,
        bookingId: opts.bookingId ?? null,
        isPublic: opts.isPublic ?? false,
    };
}
