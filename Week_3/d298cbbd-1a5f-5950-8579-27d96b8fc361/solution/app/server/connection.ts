import { WebSocket } from "ws";
import type { BoardKind, BoardLength, LivePush } from "../shared/protocol";
import type { Viewer } from "./auth";

/** One open live channel: a browser tab watching a board or sitting in a room. */
export class LiveConnection {
  board: { readonly kind: BoardKind; readonly length: BoardLength } | null = null;
  roomCode: string | null = null;

  constructor(
    private readonly socket: WebSocket,
    readonly viewer: Viewer | null,
  ) {}

  send(push: LivePush): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(push));
  }

  close(): void {
    this.socket.close(1000);
  }
}
