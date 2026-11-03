// What the signed-in shell knows: the player, friends, party, lobby, results and chat, kept current by the socket.
import { ApiFailure, get } from "./api.js";
import { COPY } from "./copy.js";
import { announce } from "./notices.js";
import { Store } from "./store.js";
import type { FriendsView, Invites, Lobby, Me, Message, Party } from "../shared/api.js";
import { COUNTDOWN_SECONDS, type Presence } from "../shared/rules.js";

export const me = new Store<Me | null | undefined>(undefined);
export const friends = new Store<FriendsView | null>(null);
export const party = new Store<Party | null>(null);
export const invites = new Store<Invites>({ incoming: [], outgoing: [] });
export const results = new Store<number | null>(null);
export const partyChat = new Store<Message[]>([]);
export const directMessages = new Store<ReadonlyMap<number, Message[]>>(new Map());

// Which chat logs are on screen right now, and the messages from other players that arrived while theirs was not.
export interface LogsOnScreen {
  party: boolean;
  dmWith: number | null;
}

export interface Unread {
  party: number;
  direct: ReadonlyMap<number, number>;
}

const logsOnScreen = new Store<LogsOnScreen>({ party: false, dmWith: null });
export const unread = new Store<Unread>({ party: 0, direct: new Map() });

export function showLogs(next: LogsOnScreen): void {
  logsOnScreen.set(next);
  unread.update((counts) => {
    const direct = new Map(counts.direct);
    if (next.dmWith !== null) direct.delete(next.dmWith);
    return { party: next.party ? 0 : counts.party, direct };
  });
}

function countUnread(message: Message): void {
  if (message.fromUserId === me.get()?.id) return;
  const screen = logsOnScreen.get();
  if (message.channel === "party") {
    if (!screen.party) unread.update((counts) => ({ ...counts, party: counts.party + 1 }));
    return;
  }
  if (screen.dmWith === message.fromUserId) return;
  unread.update((counts) => ({
    ...counts, direct: new Map(counts.direct).set(message.fromUserId, (counts.direct.get(message.fromUserId) ?? 0) + 1),
  }));
}

export interface LobbyView {
  lobby: Lobby;
  deadline: number | null;
}

export const lobby = new Store<LobbyView | null>(null);

export async function loadMe(): Promise<Me | null> {
  try {
    const { user } = await get<{ user: Me }>("/api/me");
    me.set(user);
    return user;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 401) {
      me.set(null);
      return null;
    }
    throw error;
  }
}

export async function refreshFriends(): Promise<void> {
  friends.set(await get<FriendsView>("/api/friends"));
}

export function setPresence(userId: number, presence: Presence): void {
  friends.update((view) => view === null ? view : {
    ...view,
    friends: view.friends.map((entry) => entry.user.id === userId ? { ...entry, presence } : entry),
  });
}

export async function refreshParty(): Promise<void> {
  const view = await get<{ party: Party; invites: Invites }>("/api/party");
  invites.set(view.invites);
  applyParty(view.party);
}

async function refreshChat(partyId: number): Promise<void> {
  const { messages } = await get<{ messages: Message[] }>("/api/party/messages");
  if (party.get()?.id === partyId) partyChat.set(messages);
}

async function loadLobby(lobbyId: number): Promise<void> {
  const response = await fetch(`/api/lobbies/${lobbyId}`, { credentials: "same-origin" });
  if (!response.ok) return;
  const { lobby: next } = (await response.json()) as { lobby: Lobby };
  const serverNow = Date.parse(response.headers.get("Date") ?? "");
  applyLobby(next, Number.isNaN(serverNow) ? null : serverNow);
}

// Applies a lobby; a countdown seen as it starts runs the full ten seconds, one read mid-way uses the server's clock.
export function applyLobby(next: Lobby, serverNow: number | null): void {
  if (party.get()?.lobbyId !== next.id) return;
  const previous = lobby.get();
  const counting = next.state === "countdown" && next.countdownEndsAt !== null;
  let deadline: number | null = null;
  if (counting) {
    const same = previous?.lobby.state === "countdown" && previous.lobby.countdownEndsAt === next.countdownEndsAt;
    const remaining = serverNow === null
      ? COUNTDOWN_SECONDS * 1000
      : Math.min(COUNTDOWN_SECONDS * 1000, Math.max(0, Date.parse(next.countdownEndsAt ?? "") - serverNow));
    deadline = same && previous.deadline !== null ? previous.deadline : performance.now() + remaining;
  }
  if (previous?.lobby.id === next.id && previous.lobby.state === "countdown" && next.state === "filling") {
    announce(COPY.countdownCancelled);
  }
  lobby.set({ lobby: next, deadline });
}

// Applies a party and announces what changed for everyone in it.
export function applyParty(next: Party): void {
  const previous = party.get();
  party.set(next);
  const same = previous?.id === next.id;
  if (same && previous.leaderId !== next.leaderId) {
    const heir = next.members.find((member) => member.user.id === next.leaderId);
    if (heir !== undefined) announce(COPY.newLeader(heir.user.handle));
  }
  if (same && previous.state === "queued" && next.state === "idle") announce(COPY.searchCancelled);
  if (same && previous.state === "queued" && next.state === "in_lobby") announce(COPY.seated);
  if (same && previous.state === "in_match" && next.state === "idle" && previous.matchId !== null) {
    results.set(previous.matchId);
    announce(COPY.matchOver(previous.matchId));
  }
  if (!same) {
    unread.update((counts) => ({ ...counts, party: 0 }));
    void refreshChat(next.id).catch(() => undefined);
  }
  if (next.lobbyId === null) lobby.set(null);
  else if (lobby.get()?.lobby.id !== next.lobbyId) void loadLobby(next.lobbyId).catch(() => undefined);
}

export function addMessage(message: Message): void {
  const self = me.get();
  if (message.channel === "party") {
    if (message.partyId !== party.get()?.id || partyChat.get().some((entry) => entry.id === message.id)) return;
    partyChat.update((list) => [...list, message].slice(-50));
    countUnread(message);
    return;
  }
  const other = message.fromUserId === self?.id ? message.toUserId : message.fromUserId;
  if (other === null) return;
  const list = directMessages.get().get(other) ?? [];
  if (list.some((entry) => entry.id === message.id)) return;
  directMessages.update((map) => new Map(map).set(other, [...list, message].slice(-50)));
  countUnread(message);
}

export async function loadConversation(userId: number): Promise<void> {
  const { messages } = await get<{ messages: Message[] }>(`/api/dms/${userId}/messages`);
  directMessages.update((map) => new Map(map).set(userId, messages));
}
