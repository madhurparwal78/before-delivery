import { api } from "./api";
import { LiveSocket, type WsMessage } from "./live";
import {
  type FriendsView,
  type InvitesView,
  type LobbyView,
  type MatchView,
  type Me,
  type MessageView,
  type Party,
  type Presence,
  type RoundView
} from "./types";

export type NoticeKind = "info" | "success" | "error";

export type Notice = { id: number; text: string; kind: NoticeKind };

export type VoiceMember = { userId: number; inVoice: boolean; muted: boolean; speaking: boolean };

export type BeanLive = { userId: number; x: number; y: number; z: number; state: string; rank: number; finishTick: number | null };

type Listener = () => void;

let nextNoticeId = 1;

export class Store {
  me: Me | null = null;
  party: Party | null = null;
  invites: InvitesView = { incoming: [], outgoing: [] };
  friends: FriendsView = { friends: [], incoming: [], outgoing: [], blocked: [] };
  presences = new Map<number, Presence>();
  lobby: LobbyView["lobby"] | null = null;
  match: MatchView | null = null;
  round: RoundView | null = null;
  tick = 0;
  slotsLeft: number | null = null;
  beans: BeanLive[] = [];
  buttons = 0;
  outcome: "qualified" | "eliminated" | "winner" | null = null;
  matchOver: { matchId: number; winnerId: number | null } | null = null;
  partyMessages: MessageView[] = [];
  dmThreads = new Map<number, MessageView[]>();
  conversations: number[] = [];
  unreadParty = 0;
  unreadDm = new Map<number, number>();
  voiceMembers = new Map<number, VoiceMember>();
  voiceJoined = false;
  notices: Notice[] = [];
  online = true;
  live: LiveSocket;
  dockTab: "party" | "messages" = "party";
  dockExpanded = true;
  openDm: number | null = null;

  private listeners = new Set<Listener>();

  constructor() {
    this.live = new LiveSocket();
    this.live.on((msg) => void this.onWs(msg));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }

  notify(text: string, kind: NoticeKind = "info"): void {
    this.notices = [...this.notices.slice(-2), { id: nextNoticeId++, text, kind }];
    this.emit();
    const id = nextNoticeId - 1;
    setTimeout(() => {
      this.notices = this.notices.filter((n) => n.id !== id);
      this.emit();
    }, 6000);
  }

  async bootstrap(): Promise<void> {
    try {
      const me = await api.get<{ user: Me }>("/api/me");
      this.me = me.user;
    } catch {
      this.me = null;
    }
    if (this.me) {
      this.live.connect();
      await this.refreshParty();
      await Promise.all([this.refreshFriends(), this.refreshMessages()]);
      this.pollTimer = setInterval(() => {
        void this.refreshParty();
        void this.refreshFriends();
      }, 5000) as unknown as number;
    }
    this.emit();
  }

  private pollTimer: number | null = null;

  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  async signIn(): Promise<void> {
    await this.bootstrap();
  }

  async signOut(): Promise<void> {
    this.live.close();
    await api.post("/api/auth/logout").catch(() => undefined);
    this.me = null;
    this.party = null;
    this.friends = { friends: [], incoming: [], outgoing: [], blocked: [] };
    this.lobby = null;
    this.match = null;
    this.partyMessages = [];
    this.dmThreads.clear();
    this.emit();
  }

  async refreshFriends(): Promise<void> {
    try {
      const view = await api.get<FriendsView>("/api/friends");
      this.friends = view;
      for (const friend of view.friends) {
        if (friend.presence) this.presences.set(friend.user.id, friend.presence);
        else if (!this.presences.has(friend.user.id)) this.presences.set(friend.user.id, "offline");
      }
      this.emit();
    } catch {
      // unverified accounts may not read the friend list
    }
  }

  async refreshParty(): Promise<void> {
    try {
      const view = await api.get<{ party: Party; invites: InvitesView }>("/api/party");
      this.party = view.party;
      this.invites = view.invites;
      if (view.party.lobbyId) await this.refreshLobby(view.party.lobbyId);
      if (view.party.matchId) await this.refreshMatch(view.party.matchId);
      this.emit();
    } catch {
      // unverified accounts may not read their party
    }
  }

  async refreshLobby(lobbyId: number): Promise<void> {
    try {
      const view = await api.get<LobbyView>(`/api/lobbies/${lobbyId}`);
      this.lobby = view.lobby;
      this.emit();
    } catch {
      // lobby may already be running
    }
  }

  async refreshMatch(matchId: number): Promise<void> {
    try {
      const view = await api.get<{ match: MatchView }>(`/api/matches/${matchId}`);
      this.match = view.match;
      const running = view.match.rounds.find((r) => r.state !== "resolved") ?? null;
      this.round = running ?? view.match.rounds[view.match.rounds.length - 1] ?? null;
      this.emit();
    } catch {
      // match may be missing
    }
  }

  async refreshMessages(): Promise<void> {
    try {
      const party = await api.get<{ messages: MessageView[] }>("/api/party/messages");
      this.partyMessages = party.messages;
      const convs = await api.get<{ conversations: number[] }>("/api/conversations");
      this.conversations = convs.conversations;
      for (const other of convs.conversations) {
        const dm = await api.get<{ messages: MessageView[] }>(`/api/dms/${other}/messages`);
        this.dmThreads.set(other, dm.messages);
      }
      this.emit();
    } catch {
      // unverified accounts may not read messages
    }
  }

  presenceOf(userId: number): Presence {
    return this.presences.get(userId) ?? "offline";
  }

  unreadCount(tab: "party" | "messages"): number {
    if (tab === "party") return this.unreadParty;
    let total = 0;
    for (const count of this.unreadDm.values()) total += count;
    return total;
  }

  private async onWs(msg: WsMessage): Promise<void> {
    switch (msg.type) {
      case "presence": {
        this.presences.set(msg.userId, msg.presence);
        this.emit();
        break;
      }
      case "friends": {
        await this.refreshFriends();
        break;
      }
      case "party": {
        this.party = msg.party as Party;
        if (this.party.lobbyId) await this.refreshLobby(this.party.lobbyId);
        if (this.party.matchId) await this.refreshMatch(this.party.matchId);
        await this.refreshFriends();
        this.emit();
        break;
      }
      case "lobby": {
        const lobby = msg.lobby as LobbyView["lobby"];
        const wasCounting = this.lobby?.state === "countdown";
        this.lobby = lobby;
        if (wasCounting && lobby.state === "filling") {
          this.notify("A player left. Countdown cancelled — waiting for players.", "error");
        }
        this.emit();
        break;
      }
      case "round": {
        this.round = msg.round as RoundView;
        this.outcome = null;
        this.emit();
        break;
      }
      case "tick": {
        this.tick = msg.tick;
        this.round = this.round && this.round.n === msg.round ? this.round : this.round;
        if (typeof (msg as { slotsLeft?: number }).slotsLeft === "number") {
          this.slotsLeft = (msg as { slotsLeft: number }).slotsLeft;
        }
        this.beans = msg.beans as BeanLive[];
        const me = this.beans.find((bean) => bean.userId === this.me?.id);
        if (me && this.outcome === null && me.userId === this.me?.id) {
          if (me.state === "qualified") {
            this.outcome = this.round?.kind === "final" ? "winner" : "qualified";
          } else if (me.state === "eliminated") {
            this.outcome = "eliminated";
          }
        }
        this.emit();
        break;
      }
      case "input_rejected": {
        this.notify("That can't be done right now.", "error");
        break;
      }
      case "chat": {
        const message = msg.message as MessageView;
        if (message.channel === "party") {
          if (this.chatVisible("party", null)) {
            this.partyMessages = [...this.partyMessages, message];
            this.unreadParty = 0;
          } else {
            this.unreadParty += 1;
          }
        } else if (message.channel === "dm" && message.toUserId === this.me?.id) {
          const from = message.fromUserId;
          if (this.chatVisible("dm", from)) {
            const thread = this.dmThreads.get(from) ?? [];
            this.dmThreads.set(from, [...thread, message]);
            this.unreadDm.set(from, 0);
          } else {
            this.unreadDm.set(from, (this.unreadDm.get(from) ?? 0) + 1);
            if (!this.conversations.includes(from)) this.conversations = [from, ...this.conversations];
          }
        }
        this.emit();
        break;
      }
      case "voice_state": {
        this.voiceMembers.set(msg.userId, { userId: msg.userId, inVoice: msg.inVoice, muted: msg.muted, speaking: msg.speaking });
        this.emit();
        break;
      }
      case "match_finished": {
        this.matchOver = { matchId: msg.matchId, winnerId: msg.winnerId };
        await this.refreshMatch(msg.matchId);
        await this.refreshParty();
        this.notify(`Cup #${msg.matchId} is over. You're back with your party.`, "success");
        break;
      }
      case "error": {
        if (msg.code === "not_in_voice") {
          this.notify("That can't be done right now.", "error");
        }
        break;
      }
    }
  }

  /** A message is unread only when its log is not on screen. */
  private chatVisible(channel: "party" | "dm", fromUserId: number | null): boolean {
    if (!this.dockExpanded) return false;
    if (channel === "party") return this.dockTab === "party";
    return this.dockTab === "messages" && this.openDm !== null && this.openDm === fromUserId;
  }
}

export const store = new Store();
