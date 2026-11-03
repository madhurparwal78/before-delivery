import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Pool } from "pg";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { COOKIE_NAME, type Party } from "../../shared/domain.js";

const OFFLINE_MS = 15000;

export type WsMessage = Record<string, unknown>;

export type Client = {
  ws: WebSocket;
  userId: number;
  lastHeartbeat: number;
  partyId: number | null;
  inVoice: boolean;
  muted: boolean;
  speaking: boolean;
};

export type HubEvents = {
  onInput: (userId: number, matchId: number, round: number, tick: number, buttons: number) => void;
  onVoiceSignal: (from: Client, to: number, data: unknown) => void;
};

export class Hub {
  private clients = new Map<WebSocket, Client>();
  private byUser = new Map<number, Client>();
  private wss: WebSocketServer;
  private sweeper: NodeJS.Timeout | null = null;
  private sessions: (token: string) => Promise<number | null>;
  private parties: (userId: number) => Promise<{ id: number; state: string; memberIds: number[] } | null>;

  constructor(
    private pool: Pool,
    sessions: (token: string) => Promise<number | null>,
    parties: (userId: number) => Promise<{ id: number; state: string; memberIds: number[] } | null>,
    private events: HubEvents
  ) {
    this.sessions = sessions;
    this.parties = parties;
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (ws, request) => {
      const userId = Number((request as IncomingMessage & { pcUserId?: number }).pcUserId);
      this.onConnection(ws, userId);
    });
    this.sweeper = setInterval(() => this.sweep(), 1000);
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, origin: string | null, ownOrigin: string): void {
    if (origin && origin !== ownOrigin) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const cookie = parseCookies(String(request.headers["cookie"] ?? ""));
    const token = cookie[COOKIE_NAME] ?? "";
    void this.sessions(token).then((userId) => {
      if (!userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        (request as IncomingMessage & { pcUserId?: number }).pcUserId = userId;
        this.wss.emit("connection", ws, request);
      });
    });
  }

  private onConnection(ws: WebSocket, userId: number): void {
    void this.initClient(ws, userId);
  }

  private async initClient(ws: WebSocket, userId: number): Promise<void> {
    const party = await this.parties(userId);
    const client: Client = {
      ws,
      userId,
      lastHeartbeat: Date.now(),
      partyId: party?.id ?? null,
      inVoice: false,
      muted: false,
      speaking: false
    };
    this.clients.set(ws, client);
    this.byUser.set(userId, client);
    ws.on("message", (raw: RawData) => void this.onMessage(client, raw.toString()));
    ws.on("close", () => this.onClose(client));
    ws.on("error", () => this.onClose(client));
    await this.announcePresence(userId);
  }

  private onClose(client: Client): void {
    if (!this.clients.has(client.ws)) return;
    this.clients.delete(client.ws);
    if (this.byUser.get(client.userId) === client) this.byUser.delete(client.userId);
    client.inVoice = false;
    void this.announcePresence(client.userId);
    void this.announceVoiceToParty(client);
  }

  private async onMessage(client: Client, raw: string): Promise<void> {
    let parsed: WsMessage;
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value !== "object" || value === null) return;
      parsed = value as WsMessage;
    } catch {
      return;
    }
    const type = parsed["type"];
    if (type === "heartbeat") {
      client.lastHeartbeat = Date.now();
      return;
    }
    if (type === "input") {
      const matchId = Number(parsed["matchId"]);
      const round = Number(parsed["round"]);
      const tick = Number(parsed["tick"]);
      const buttons = Number(parsed["buttons"]);
      this.events.onInput(client.userId, matchId, round, tick, buttons);
      return;
    }
    if (type === "voice_signal") {
      const to = Number(parsed["to"]);
      if (!client.inVoice) {
        this.send(client.ws, { type: "error", code: "not_in_voice" });
        return;
      }
      this.events.onVoiceSignal(client, to, parsed["data"]);
      return;
    }
    if (type === "voice_state") {
      const inVoice = Boolean(parsed["inVoice"]);
      const muted = Boolean(parsed["muted"]);
      const speaking = Boolean(parsed["speaking"]);
      const changed = client.inVoice !== inVoice || client.muted !== muted || client.speaking !== speaking;
      client.inVoice = inVoice;
      client.muted = muted;
      client.speaking = speaking;
      if (changed) void this.announceVoiceToParty(client);
      return;
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const client of this.clients.values()) {
      if (now - client.lastHeartbeat >= OFFLINE_MS) {
        client.ws.close(1000, "timeout");
        this.onClose(client);
      }
    }
  }

  isOnline(userId: number): boolean {
    const client = this.byUser.get(userId);
    return Boolean(client && Date.now() - client.lastHeartbeat < OFFLINE_MS);
  }

  clientsInParty(partyId: number): Client[] {
    return [...this.clients.values()].filter((c) => c.partyId === partyId);
  }

  updatePartyId(userId: number, partyId: number): void {
    const client = this.byUser.get(userId);
    if (client) client.partyId = partyId;
  }

  sendToUser(userId: number, message: WsMessage): void {
    const client = this.byUser.get(userId);
    if (client) this.send(client.ws, message);
  }

  sendToUsers(userIds: number[], message: WsMessage): void {
    for (const userId of userIds) this.sendToUser(userId, message);
  }

  send(ws: WebSocket, message: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  /** Announces a player's presence to their accepted friends who are connected. */
  async announcePresence(userId: number): Promise<void> {
    const friends = await this.pool.query<{ user_a: number; user_b: number }>(
      "SELECT user_a, user_b FROM friendships WHERE user_a = $1 OR user_b = $1",
      [userId]
    );
    const friendIds = friends.rows.map((row) => (row.user_a === userId ? row.user_b : row.user_a));
    const presence = await this.presenceOf(userId);
    for (const friendId of friendIds) {
      const blocked = await this.pool.query("SELECT 1 FROM blocks WHERE (blocker = $1 AND blocked = $2) OR (blocker = $2 AND blocked = $1)", [
        userId,
        friendId
      ]);
      if (blocked.rows[0]) continue;
      this.sendToUser(friendId, { type: "presence", userId, presence });
    }
  }

  async announceFriendsChanged(...userIds: number[]): Promise<void> {
    for (const userId of userIds) this.sendToUser(userId, { type: "friends" });
  }

  async announceParty(party: Party): Promise<void> {
    for (const member of party.members) {
      this.updatePartyId(member.user.id, party.id);
      this.sendToUser(member.user.id, { type: "party", party });
      await this.announcePresence(member.user.id);
    }
  }

  async announcePartyTo(userId: number, party: Party): Promise<void> {
    this.updatePartyId(userId, party.id);
    this.sendToUser(userId, { type: "party", party });
    await this.announcePresence(userId);
  }

  async announceLobby(lobbyId: number, lobby: unknown): Promise<void> {
    const seats = await this.pool.query<{ user_id: number }>("SELECT user_id FROM lobby_seats WHERE lobby_id = $1", [lobbyId]);
    for (const row of seats.rows) this.sendToUser(row.user_id, { type: "lobby", lobby });
  }

  announceRound(matchId: number, round: unknown): void {
    const participants = this.participantsOf(matchId);
    for (const userId of participants) this.sendToUser(userId, { type: "round", matchId, round });
  }

  announceTick(matchId: number, round: number, tick: number, beans: unknown[], slotsLeft: number): void {
    for (const userId of this.participantsOf(matchId)) {
      this.sendToUser(userId, { type: "tick", matchId, round, tick, beans, slotsLeft });
    }
  }

  announceMatchFinished(matchId: number, participants: number[], winnerId: number | null): void {
    for (const userId of participants) {
      this.sendToUser(userId, { type: "match_finished", matchId, winnerId });
    }
  }

  registerParticipants(matchId: number, participants: number[]): void {
    this.matchParticipants.set(matchId, participants);
  }

  private matchParticipants = new Map<number, number[]>();

  private participantsOf(matchId: number): number[] {
    return this.matchParticipants.get(matchId) ?? [];
  }

  async announceChat(message: { channel: string; partyId: number | null; fromUserId: number; toUserId: number | null }): Promise<void> {
    if (message.channel === "party" && message.partyId) {
      for (const client of this.clientsInParty(message.partyId)) {
        if (client.userId !== message.fromUserId) {
          this.send(client.ws, { type: "chat", message });
        }
      }
      return;
    }
    if (message.channel === "dm" && message.toUserId) {
      this.sendToUser(message.toUserId, { type: "chat", message });
    }
  }

  private async announceVoiceToParty(client: Client): Promise<void> {
    if (!client.partyId) return;
    const members = await this.pool.query<{ user_id: number }>("SELECT user_id FROM party_members WHERE party_id = $1", [client.partyId]);
    for (const row of members.rows) {
      this.sendToUser(row.user_id, {
        type: "voice_state",
        userId: client.userId,
        inVoice: client.inVoice,
        muted: client.muted,
        speaking: client.speaking
      });
    }
  }

  voiceStateOf(userId: number): { inVoice: boolean; muted: boolean; speaking: boolean } {
    const client = this.byUser.get(userId);
    if (client) return { inVoice: client.inVoice, muted: client.muted, speaking: client.speaking };
    return { inVoice: false, muted: false, speaking: false };
  }

  /** Presence as defined by heartbeats and party state. */
  async presenceOf(userId: number): Promise<"offline" | "online" | "in_party" | "in_match"> {
    const client = this.byUser.get(userId);
    if (!client || Date.now() - client.lastHeartbeat >= OFFLINE_MS) return "offline";
    const party = await this.parties(userId);
    if (!party) return "online";
    if (party.state === "in_match") return "in_match";
    if (party.memberIds.length >= 2 || party.state === "queued" || party.state === "in_lobby") return "in_party";
    return "online";
  }

  close(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.wss.close();
  }
}

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

