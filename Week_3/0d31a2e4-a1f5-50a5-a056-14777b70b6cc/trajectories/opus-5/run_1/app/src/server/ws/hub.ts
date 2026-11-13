import type { WebSocket } from 'ws';
import type { ServerMessage } from '../../shared/types.js';

export const HEARTBEAT_TIMEOUT_MS = 15_000;

export interface VoiceState {
  inVoice: boolean;
  muted: boolean;
  speaking: boolean;
}

const SILENT: VoiceState = { inVoice: false, muted: false, speaking: false };

/** The live connection register: who is connected, when they were last seen, and their voice state. */
class Hub {
  private readonly sockets = new Map<number, Set<WebSocket>>();
  private readonly owners = new Map<WebSocket, number>();
  private readonly lastSeen = new Map<number, number>();
  private readonly voice = new Map<number, VoiceState>();

  add(socket: WebSocket, userId: number): void {
    const set = this.sockets.get(userId) ?? new Set<WebSocket>();
    set.add(socket);
    this.sockets.set(userId, set);
    this.owners.set(socket, userId);
    this.lastSeen.set(userId, Date.now());
  }

  remove(socket: WebSocket): number | null {
    const userId = this.owners.get(socket);
    if (userId === undefined) return null;
    this.owners.delete(socket);
    const set = this.sockets.get(userId);
    if (set) {
      set.delete(socket);
      if (set.size === 0) this.sockets.delete(userId);
    }
    if (!this.sockets.has(userId)) this.voice.delete(userId);
    return userId;
  }

  userOf(socket: WebSocket): number | null {
    return this.owners.get(socket) ?? null;
  }

  heartbeat(userId: number): void {
    this.lastSeen.set(userId, Date.now());
  }

  /** A player counts as connected while their heartbeats are fresh. */
  isConnected(userId: number): boolean {
    const seen = this.lastSeen.get(userId);
    return seen !== undefined && Date.now() - seen < HEARTBEAT_TIMEOUT_MS;
  }

  knownUsers(): number[] {
    return [...this.lastSeen.keys()];
  }

  forget(userId: number): void {
    this.lastSeen.delete(userId);
  }

  setVoice(userId: number, state: VoiceState): void {
    if (state.inVoice) this.voice.set(userId, state);
    else this.voice.delete(userId);
  }

  voiceOf(userId: number): VoiceState {
    return this.voice.get(userId) ?? SILENT;
  }

  inVoice(userId: number): boolean {
    return this.voice.get(userId)?.inVoice === true;
  }

  send(userId: number, message: ServerMessage): void {
    const set = this.sockets.get(userId);
    if (!set) return;
    const payload = JSON.stringify(message);
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  sendToSocket(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  broadcast(userIds: Iterable<number>, message: ServerMessage): void {
    for (const userId of userIds) this.send(userId, message);
  }
}

export const hub = new Hub();
