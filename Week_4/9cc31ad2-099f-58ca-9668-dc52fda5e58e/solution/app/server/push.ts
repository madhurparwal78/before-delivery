import type pg from "pg";
import type { WebSocket } from "ws";
import type { BoardRow } from "./boards.js";
import type { Championship } from "./championship.js";
import type { Transaction } from "./db.js";

type Push =
  | { type: "balance"; balance: number; movementId: string; purchaseId: string | null }
  | { type: "run"; runId: string; status: string }
  | ({ type: "championship" } & Championship)
  | { type: "board"; layoutId: string; mode: string; class: string; row: BoardRow };

// Board rows go to every connection; every other push to one player's connections.
type Envelope =
  | { readonly to: null; readonly push: Extract<Push, { type: "board" }> }
  | { readonly to: string; readonly push: Exclude<Push, { type: "board" }> };

const CHANNEL = "kerb_push";

// Live pushes. Writers queue a NOTIFY inside their transaction, so a push leaves only after its
// commit and in commit order; every instance sharing the database LISTENs and delivers to its own
// WebSocket connections, addressed by player.
export class Hub {
  private readonly sockets = new Map<string, Set<WebSocket>>();

  constructor(private readonly pool: pg.Pool) {}

  async listen(): Promise<void> {
    for (;;) {
      try {
        const client = await this.pool.connect();
        client.on("notification", (note) => {
          if (note.channel === CHANNEL && note.payload) this.deliver(JSON.parse(note.payload) as Envelope);
        });
        client.on("error", () => {
          client.release(true);
          setTimeout(() => void this.listen(), 1000);
        });
        await client.query(`LISTEN ${CHANNEL}`);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  static async queue(tx: Transaction, envelope: Envelope): Promise<void> {
    await tx.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(envelope)]);
  }

  attach(playerId: string, socket: WebSocket): void {
    const set = this.sockets.get(playerId) ?? new Set<WebSocket>();
    set.add(socket);
    this.sockets.set(playerId, set);
    socket.on("close", () => {
      set.delete(socket);
      if (set.size === 0) this.sockets.delete(playerId);
    });
  }

  // Sends straight to this instance's connections of the given players (lobby messages).
  sendLocal(playerIds: Iterable<string>, message: unknown): void {
    const text = JSON.stringify(message);
    for (const id of playerIds) for (const socket of this.sockets.get(id) ?? []) send(socket, text);
  }

  private deliver(envelope: Envelope): void {
    if (envelope.to !== null) {
      this.sendLocal([envelope.to], envelope.push);
      return;
    }
    const { push } = envelope;
    for (const [playerId, set] of this.sockets) {
      const text = JSON.stringify({ ...push, row: { ...push.row, mine: push.row.playerId === playerId } });
      for (const socket of set) send(socket, text);
    }
  }
}

function send(socket: WebSocket, text: string): void {
  if (socket.readyState === socket.OPEN) socket.send(text);
}
