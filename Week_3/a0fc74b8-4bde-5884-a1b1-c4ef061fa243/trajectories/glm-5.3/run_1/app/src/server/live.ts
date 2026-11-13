import { WebSocket, type RawData } from "ws";

interface Hub {
  register(ws: WebSocket, teamId: string | null, docId: string | null): void;
  publishTeam(teamId: string, payload: unknown): void;
  publishDocument(documentId: string, payload: unknown): void;
  publishAll(payload: unknown): void;
}

export class LiveHubImpl implements Hub {
  clients: { ws: WebSocket; teamId: string | null; docId: string | null }[] = [];

  register(ws: WebSocket, teamId: string | null, docId: string | null): void {
    const entry = { ws, teamId, docId };
    this.clients.push(entry);
    ws.on("close", () => {
      this.clients = this.clients.filter((c) => c !== entry);
    });
    ws.on("message", (data: RawData) => {
      // minimal: client sends pings as {"type":"ping"}
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      } catch { /* ignore */ }
    });
  }

  publishTeam(teamId: string, payload: unknown): void {
    const text = JSON.stringify(payload);
    for (const c of this.clients) {
      if (c.teamId === teamId && c.ws.readyState === WebSocket.OPEN) c.ws.send(text);
    }
  }

  publishDocument(documentId: string, payload: unknown): void {
    const text = JSON.stringify(payload);
    for (const c of this.clients) {
      if (c.docId === documentId && c.ws.readyState === WebSocket.OPEN) c.ws.send(text);
    }
  }

  publishAll(payload: unknown): void {
    const text = JSON.stringify(payload);
    for (const c of this.clients) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(text);
    }
  }
}
