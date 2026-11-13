import { useSyncExternalStore } from 'react';
import type {
  ClientMessage,
  FriendsPayload,
  IncomingInvite,
  Lobby,
  Match,
  Me,
  Message,
  OutgoingInvite,
  Party,
  PartyPayload,
  Presence,
  Round,
  ServerMessage,
  TickBean,
  User,
} from '../../shared/types.js';
import { api, ApiError } from './api.js';
import { copy, errorCopy } from './copy.js';

export type Layout = 'narrow' | 'medium' | 'wide';
export type DockTab = 'party' | 'messages';

export interface VoiceTile {
  userId: number;
  connected: boolean;
  muted: boolean;
  speaking: boolean;
}

export interface LiveTick {
  tick: number;
  beans: TickBean[];
}

export interface RoundBanner {
  id: number;
  text: string;
}

export interface AppState {
  me: Me | null;
  loaded: boolean;
  friends: FriendsPayload;
  party: Party | null;
  incomingInvites: IncomingInvite[];
  outgoingInvites: OutgoingInvite[];
  lobby: Lobby | null;
  round: Round | null;
  matchId: number | null;
  participants: User[];
  resultsMatch: Match | null;
  notice: string;
  noticeId: number;
  pending: Record<string, boolean>;
  fieldErrors: Record<string, string>;
  partyMessages: Message[];
  dmThreads: Record<number, Message[]>;
  conversations: number[];
  openDm: number | null;
  dockTab: DockTab;
  unreadParty: number;
  unreadDm: number;
  dockExpanded: boolean;
  friendsPanelOpen: boolean;
  dockPanelOpen: boolean;
  layout: Layout;
  voiceJoined: boolean;
  voiceMuted: boolean;
  pushToTalk: boolean;
  voiceTiles: Record<number, VoiceTile>;
  banner: RoundBanner | null;
}

const EMPTY_FRIENDS: FriendsPayload = { friends: [], incoming: [], outgoing: [], blocked: [] };

function layoutFor(width: number): Layout {
  if (width < 768) return 'narrow';
  return width < 1280 ? 'medium' : 'wide';
}

const DOCK_KEY = 'pratfall-dock-expanded';

function storedDockExpanded(): boolean {
  try {
    return window.localStorage.getItem(DOCK_KEY) !== 'false';
  } catch {
    return true;
  }
}

class Store {
  private state: AppState = {
    me: null,
    loaded: false,
    friends: EMPTY_FRIENDS,
    party: null,
    incomingInvites: [],
    outgoingInvites: [],
    lobby: null,
    round: null,
    matchId: null,
    participants: [],
    resultsMatch: null,
    notice: '',
    noticeId: 0,
    pending: {},
    fieldErrors: {},
    partyMessages: [],
    dmThreads: {},
    conversations: [],
    openDm: null,
    dockTab: 'party',
    unreadParty: 0,
    unreadDm: 0,
    dockExpanded: true,
    friendsPanelOpen: false,
    dockPanelOpen: false,
    layout: 'wide',
    voiceJoined: false,
    voiceMuted: false,
    pushToTalk: false,
    voiceTiles: {},
    banner: null,
  };

  private readonly listeners = new Set<() => void>();
  private readonly tickListeners = new Set<() => void>();
  private live: LiveTick = { tick: 0, beans: [] };
  private socket: WebSocket | null = null;
  private heartbeat: number | null = null;
  private signalHandler: ((from: number, data: unknown) => void) | null = null;
  private memberHandler: ((userId: number, inVoice: boolean) => void) | null = null;
  private wasConnected = false;

  getState = (): AppState => this.state;
  getLive = (): LiveTick => this.live;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeTicks = (listener: () => void): (() => void) => {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  };

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private setLive(live: LiveTick): void {
    this.live = live;
    for (const listener of this.tickListeners) listener();
  }

  notice(text: string): void {
    this.set({ notice: text, noticeId: this.state.noticeId + 1 });
  }

  private startPending(key: string): void {
    this.set({ pending: { ...this.state.pending, [key]: true } });
  }

  private endPending(key: string): void {
    const pending = { ...this.state.pending };
    delete pending[key];
    this.set({ pending });
  }

  setLayout(width: number): void {
    const layout = layoutFor(width);
    if (layout !== this.state.layout) {
      this.set({
        layout,
        friendsPanelOpen: layout === 'narrow' ? this.state.friendsPanelOpen : false,
        dockPanelOpen: layout === 'wide' ? false : this.state.dockPanelOpen,
      });
    }
  }

  async load(): Promise<void> {
    this.set({ dockExpanded: storedDockExpanded(), layout: layoutFor(window.innerWidth) });
    try {
      const me = await api.get<{ user: Me }>('/api/me');
      this.set({ me: me.user, loaded: true });
    } catch {
      this.set({ me: null, loaded: true });
      return;
    }
    await this.refreshAll();
    this.connect();
  }

  private async refreshAll(): Promise<void> {
    if (this.state.me === null) return;
    if (this.state.me.emailVerified) {
      await Promise.all([this.refreshFriends(), this.refreshParty()]);
      await this.refreshPartyMessages();
    }
  }

  async refreshFriends(): Promise<void> {
    try {
      this.set({ friends: await api.get<FriendsPayload>('/api/friends') });
    } catch {
      /* the rail keeps what it has until the next hint */
    }
  }

  async refreshParty(): Promise<void> {
    let payload: PartyPayload;
    try {
      payload = await api.get<PartyPayload>('/api/party');
    } catch {
      return;
    }
    const previous = this.state.party;
    const party = payload.party;
    this.set({
      party,
      incomingInvites: payload.invites.incoming,
      outgoingInvites: payload.invites.outgoing,
    });
    if (party.state === 'in_match' && party.matchId !== null) {
      this.set({ matchId: party.matchId, resultsMatch: null });
    }
    if (previous?.state === 'queued' && party.state === 'in_lobby') this.notice(copy.seated);
    if (previous?.state === 'queued' && party.id === previous.id && party.state === 'idle') {
      this.notice(copy.searchCancelled);
    }
    if (previous !== null && previous.id === party.id && previous.leaderId !== party.leaderId) {
      const leader = party.members.find((member) => member.user.id === party.leaderId);
      if (leader !== undefined) this.notice(copy.newLeader(leader.user.handle));
    }
    if (party.lobbyId !== null) await this.refreshLobby(party.lobbyId);
    else if (this.state.lobby !== null) this.set({ lobby: null });
    if (previous?.state === 'in_match' && party.state !== 'in_match') {
      const finishedId = previous.matchId;
      this.set({ matchId: null, round: null });
      if (finishedId !== null) await this.showResults(finishedId);
    }
    if (previous !== null && previous.id !== party.id) await this.refreshPartyMessages();
  }

  private async loadParticipants(matchId: number): Promise<void> {
    try {
      const payload = await api.get<{ match: Match }>(`/api/matches/${matchId}`);
      this.set({ participants: payload.match.participants });
    } catch {
      /* standings fall back to the party's own handles */
    }
  }

  private async showResults(matchId: number): Promise<void> {
    try {
      const payload = await api.get<{ match: Match }>(`/api/matches/${matchId}`);
      this.set({ resultsMatch: payload.match });
      this.notice(copy.matchOver(matchId));
    } catch {
      this.notice(copy.matchOver(matchId));
    }
  }

  private async refreshLobby(lobbyId: number): Promise<void> {
    try {
      const payload = await api.get<{ lobby: Lobby }>(`/api/lobbies/${lobbyId}`);
      this.set({ lobby: payload.lobby });
    } catch {
      /* the lobby stream fills this in */
    }
  }

  async refreshPartyMessages(): Promise<void> {
    try {
      const payload = await api.get<{ messages: Message[] }>('/api/party/messages');
      this.set({ partyMessages: payload.messages });
    } catch {
      /* chat history arrives with the next refresh */
    }
  }

  private connect(): void {
    const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.wasConnected) this.notice(copy.backOnline);
      this.wasConnected = true;
      this.send({ type: 'heartbeat' });
      this.heartbeat = window.setInterval(() => this.send({ type: 'heartbeat' }), 5000);
    });
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      const parsed: unknown = JSON.parse(event.data);
      void this.handle(parsed as ServerMessage);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
      this.socket = null;
      if (event.code === 4401) return;
      this.notice(copy.reconnecting);
      window.setTimeout(() => this.connect(), 1500);
    });
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  onVoiceSignal(handler: (from: number, data: unknown) => void): void {
    this.signalHandler = handler;
  }

  onVoiceMember(handler: (userId: number, inVoice: boolean) => void): void {
    this.memberHandler = handler;
  }

  private async handle(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case 'presence':
        this.applyPresence(message.userId, message.presence);
        return;
      case 'friends':
        await this.refreshFriends();
        return;
      case 'party':
        await this.refreshParty();
        return;
      case 'lobby': {
        const previous = this.state.lobby;
        this.set({ lobby: message.lobby });
        if (previous?.state === 'countdown' && message.lobby.state === 'filling') {
          this.notice(copy.countdownCancelled);
        }
        return;
      }
      case 'round': {
        const changed =
          this.state.round === null ||
          this.state.round.n !== message.round.n ||
          this.state.matchId !== message.matchId;
        if (changed) this.setLive({ tick: 0, beans: [] });
        this.set({ round: message.round, matchId: message.matchId, resultsMatch: null });
        if (this.state.participants.length === 0 || changed) {
          await this.loadParticipants(message.matchId);
        }
        if (message.round.state === 'resolved') this.showBanner(message.round);
        return;
      }
      case 'tick':
        this.setLive({ tick: message.tick, beans: message.beans });
        return;
      case 'chat':
        this.applyChat(message.message);
        return;
      case 'voice_state':
        this.applyVoiceState(message.userId, message.inVoice, message.muted, message.speaking);
        this.memberHandler?.(message.userId, message.inVoice);
        return;
      case 'voice_signal':
        this.signalHandler?.(message.from, message.data);
        return;
      case 'input_rejected':
      case 'error':
        return;
    }
  }

  private applyPresence(userId: number, presence: Presence): void {
    const friends = this.state.friends.friends.map((entry) =>
      entry.user.id === userId ? { ...entry, presence } : entry,
    );
    this.set({ friends: { ...this.state.friends, friends } });
  }

  private showBanner(round: Round): void {
    const me = this.state.me;
    if (me === null) return;
    const mine = round.results.find((result) => result.userId === me.id);
    if (mine === undefined) return;
    const won = mine.outcome === 'qualified' && round.kind === 'final';
    const text = won
      ? copy.wonCup
      : mine.outcome === 'qualified'
        ? copy.qualified
        : copy.eliminated;
    const id = this.state.noticeId + 1;
    this.set({ banner: { id, text }, noticeId: id });
    window.setTimeout(() => {
      if (this.state.banner?.id === id) this.set({ banner: null });
    }, 3200);
  }

  private applyChat(message: Message): void {
    const me = this.state.me;
    if (me === null) return;
    if (message.channel === 'party') {
      this.set({ partyMessages: [...this.state.partyMessages, message] });
      if (message.fromUserId !== me.id && !this.partyLogOnScreen()) {
        this.set({ unreadParty: this.state.unreadParty + 1 });
      }
      return;
    }
    const otherId = message.fromUserId === me.id ? (message.toUserId ?? 0) : message.fromUserId;
    const thread = this.state.dmThreads[otherId] ?? [];
    this.set({
      dmThreads: { ...this.state.dmThreads, [otherId]: [...thread, message] },
      conversations: this.state.conversations.includes(otherId)
        ? this.state.conversations
        : [...this.state.conversations, otherId],
    });
    if (message.fromUserId !== me.id && !this.dmLogOnScreen(otherId)) {
      this.set({ unreadDm: this.state.unreadDm + 1 });
    }
  }

  private applyVoiceState(
    userId: number,
    inVoice: boolean,
    muted: boolean,
    speaking: boolean,
  ): void {
    const tiles = { ...this.state.voiceTiles };
    if (!inVoice) delete tiles[userId];
    else tiles[userId] = { userId, connected: true, muted, speaking };
    this.set({ voiceTiles: tiles });
  }

  setVoiceTile(userId: number, patch: Partial<VoiceTile>): void {
    const current = this.state.voiceTiles[userId] ?? {
      userId,
      connected: false,
      muted: false,
      speaking: false,
    };
    this.set({ voiceTiles: { ...this.state.voiceTiles, [userId]: { ...current, ...patch } } });
  }

  dockOnScreen(): boolean {
    return this.state.layout === 'wide' ? this.state.dockExpanded : this.state.dockPanelOpen;
  }

  partyLogOnScreen(): boolean {
    return this.dockOnScreen() && this.state.dockTab === 'party';
  }

  dmLogOnScreen(userId: number): boolean {
    return this.dockOnScreen() && this.state.dockTab === 'messages' && this.state.openDm === userId;
  }

  private clearUnread(): void {
    if (this.partyLogOnScreen() && this.state.unreadParty !== 0) this.set({ unreadParty: 0 });
    if (
      this.dockOnScreen() &&
      this.state.dockTab === 'messages' &&
      this.state.openDm !== null &&
      this.state.unreadDm !== 0
    ) {
      this.set({ unreadDm: 0 });
    }
  }

  setDockTab(tab: DockTab): void {
    this.set({ dockTab: tab });
    this.clearUnread();
  }

  toggleDock(): void {
    const dockExpanded = !this.state.dockExpanded;
    this.set({ dockExpanded });
    try {
      window.localStorage.setItem(DOCK_KEY, String(dockExpanded));
    } catch {
      /* a browser without storage simply forgets the choice */
    }
    this.clearUnread();
  }

  setFriendsPanel(open: boolean): void {
    this.set({ friendsPanelOpen: open });
  }

  setDockPanel(open: boolean): void {
    this.set({ dockPanelOpen: open });
    this.clearUnread();
  }

  async openConversation(userId: number): Promise<void> {
    this.set({ openDm: userId, dockTab: 'messages' });
    if (this.state.layout !== 'wide') this.set({ dockPanelOpen: true });
    if (this.state.dmThreads[userId] === undefined) {
      try {
        const payload = await api.get<{ messages: Message[] }>(`/api/dms/${userId}/messages`);
        this.set({
          dmThreads: { ...this.state.dmThreads, [userId]: payload.messages },
          conversations: this.state.conversations.includes(userId)
            ? this.state.conversations
            : [...this.state.conversations, userId],
        });
      } catch {
        this.notice(copy.cantMessage);
        return;
      }
    } else if (!this.state.conversations.includes(userId)) {
      this.set({ conversations: [...this.state.conversations, userId] });
    }
    this.clearUnread();
  }

  closeConversation(): void {
    this.set({ openDm: null });
  }

  private async act(key: string, run: () => Promise<void>): Promise<void> {
    this.startPending(key);
    try {
      await run();
    } finally {
      this.endPending(key);
    }
  }

  setFieldErrors(fieldErrors: Record<string, string>): void {
    this.set({ fieldErrors });
    if (Object.keys(fieldErrors).length > 0) this.notice(copy.checkFields);
  }

  async sendFriendRequest(handle: string): Promise<boolean> {
    let ok = false;
    await this.act('send-request', async () => {
      try {
        const payload = await api.post<{ friendship?: { user: { handle: string } } }>(
          '/api/friends/requests',
          { handle },
        );
        this.notice(
          payload.friendship === undefined
            ? copy.requestSent(handle)
            : copy.nowFriends(payload.friendship.user.handle),
        );
        await this.refreshFriends();
        ok = true;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'validation_failed') {
          this.notice(copy.cantAddYourself);
          return;
        }
        this.notice(
          errorCopy(error, {
            user_not_found: copy.noPlayer(handle),
            already_friends: copy.alreadyFriends(handle),
            blocked: copy.cantAddPlayer,
          }),
        );
      }
    });
    return ok;
  }

  async acceptRequest(id: number, handle: string): Promise<void> {
    await this.act(`accept-${id}`, async () => {
      try {
        await api.post(`/api/friends/requests/${id}/accept`);
        this.notice(copy.nowFriends(handle));
      } catch (error) {
        this.notice(errorCopy(error, { request_not_found: copy.requestClosed }));
      }
      await this.refreshFriends();
    });
  }

  async declineRequest(id: number): Promise<void> {
    await this.act(`decline-${id}`, async () => {
      try {
        await api.post(`/api/friends/requests/${id}/decline`);
        this.notice(copy.requestDeclined);
      } catch (error) {
        this.notice(errorCopy(error, { request_not_found: copy.requestClosed }));
      }
      await this.refreshFriends();
    });
  }

  async withdrawRequest(id: number): Promise<void> {
    await this.act(`withdraw-${id}`, async () => {
      try {
        await api.delete(`/api/friends/requests/${id}`);
        this.notice(copy.requestWithdrawn);
      } catch (error) {
        this.notice(errorCopy(error, { request_not_found: copy.requestClosed }));
      }
      await this.refreshFriends();
    });
  }

  async removeFriend(userId: number, handle: string): Promise<void> {
    await this.act(`remove-${userId}`, async () => {
      try {
        await api.delete(`/api/friends/${userId}`);
        this.notice(copy.friendRemoved(handle));
      } catch (error) {
        this.notice(errorCopy(error));
      }
      await this.refreshFriends();
    });
  }

  async blockPlayer(userId: number, handle: string): Promise<void> {
    await this.act(`block-${userId}`, async () => {
      try {
        await api.post('/api/blocks', { userId });
        this.notice(copy.blocked(handle));
      } catch (error) {
        this.notice(errorCopy(error));
      }
      await this.refreshFriends();
      await this.refreshParty();
    });
  }

  async unblockPlayer(userId: number, handle: string): Promise<void> {
    await this.act(`unblock-${userId}`, async () => {
      try {
        await api.delete(`/api/blocks/${userId}`);
        this.notice(copy.unblocked(handle));
      } catch (error) {
        this.notice(errorCopy(error));
      }
      await this.refreshFriends();
    });
  }

  async invitePlayer(userId: number, handle: string): Promise<void> {
    await this.act(`invite-${userId}`, async () => {
      try {
        await api.post('/api/party/invites', { userId });
        this.notice(copy.inviteSent(handle));
      } catch (error) {
        this.notice(
          errorCopy(error, {
            party_full: copy.partyFull,
            party_busy: copy.partyBusy,
            not_leader: copy.notLeader,
            not_friends: copy.friendsOnly,
            already_in_party: copy.cantDoThat,
          }),
        );
      }
      await this.refreshParty();
    });
  }

  async acceptInvite(id: number, handle: string): Promise<void> {
    await this.act(`join-${id}`, async () => {
      try {
        await api.post(`/api/party/invites/${id}/accept`);
        this.notice(copy.joinedParty(handle));
      } catch (error) {
        this.notice(
          errorCopy(error, {
            party_full: copy.partyFull,
            party_busy: copy.partyBusy,
            invite_not_found: copy.inviteClosed,
          }),
        );
      }
      await this.refreshParty();
    });
  }

  async declineInvite(id: number): Promise<void> {
    await this.act(`decline-invite-${id}`, async () => {
      try {
        await api.post(`/api/party/invites/${id}/decline`);
        this.notice(copy.inviteDeclined);
      } catch (error) {
        this.notice(errorCopy(error, { invite_not_found: copy.inviteClosed }));
      }
      await this.refreshParty();
    });
  }

  async leaveParty(): Promise<void> {
    await this.act('leave-party', async () => {
      try {
        await api.post('/api/party/leave');
        this.notice(copy.leftParty);
      } catch (error) {
        this.notice(errorCopy(error, { party_busy: copy.partyBusy }));
      }
      await this.refreshParty();
    });
  }

  async makeLeader(userId: number, handle: string): Promise<void> {
    await this.act(`leader-${userId}`, async () => {
      try {
        await api.post('/api/party/leader', { userId });
        this.notice(copy.newLeader(handle));
      } catch (error) {
        this.notice(errorCopy(error, { not_leader: copy.notLeader }));
      }
      await this.refreshParty();
    });
  }

  async findMatch(): Promise<void> {
    this.startPending('queue');
    this.notice(copy.findingMatch);
    try {
      await api.post('/api/party/queue');
      await this.refreshParty();
    } catch (error) {
      this.notice(errorCopy(error, { invalid_transition: copy.alreadySearching }));
      this.endPending('queue');
      return;
    }
    this.endPending('queue');
  }

  async cancelSearch(): Promise<void> {
    await this.act('cancel-search', async () => {
      try {
        await api.post('/api/party/queue/cancel');
        this.notice(copy.searchCancelled);
      } catch (error) {
        this.notice(errorCopy(error, { invalid_transition: copy.notSearching }));
      }
      await this.refreshParty();
    });
  }

  async leaveLobby(): Promise<void> {
    await this.act('leave-lobby', async () => {
      try {
        await api.post('/api/lobby/leave');
        this.notice(copy.leftLobby);
      } catch (error) {
        this.notice(errorCopy(error));
      }
      await this.refreshParty();
    });
  }

  async forfeit(): Promise<void> {
    const matchId = this.state.matchId;
    if (matchId === null) return;
    await this.act('forfeit', async () => {
      try {
        await api.post(`/api/matches/${matchId}/forfeit`);
        this.notice(copy.forfeited);
      } catch (error) {
        this.notice(errorCopy(error));
      }
    });
  }

  async sendPartyMessage(body: string): Promise<boolean> {
    let ok = false;
    await this.act('send-party-message', async () => {
      try {
        await api.post('/api/party/messages', { body });
        ok = true;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'validation_failed') {
          this.setFieldErrors({ message: copy.messageField });
          return;
        }
        this.notice(errorCopy(error, { rate_limited: copy.slowDown }));
      }
    });
    return ok;
  }

  async sendDirectMessage(userId: number, body: string): Promise<boolean> {
    let ok = false;
    await this.act('send-dm', async () => {
      try {
        await api.post(`/api/dms/${userId}/messages`, { body });
        ok = true;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'validation_failed') {
          this.setFieldErrors({ message: copy.messageField });
          return;
        }
        this.notice(
          errorCopy(error, {
            rate_limited: copy.slowDown,
            blocked: copy.cantMessage,
            not_friends: copy.cantMessage,
          }),
        );
      }
    });
    return ok;
  }

  setVoiceFlags(patch: { joined?: boolean; muted?: boolean; pushToTalk?: boolean }): void {
    this.set({
      voiceJoined: patch.joined ?? this.state.voiceJoined,
      voiceMuted: patch.muted ?? this.state.voiceMuted,
      pushToTalk: patch.pushToTalk ?? this.state.pushToTalk,
    });
  }

  clearResults(): void {
    this.set({ resultsMatch: null });
  }

  async resendVerification(): Promise<void> {
    await this.act('resend', async () => {
      const email = this.state.me?.email ?? '';
      try {
        await api.post('/api/auth/verification/resend');
        this.notice(copy.verificationSent(email));
      } catch (error) {
        this.notice(
          errorCopy(error, {
            already_verified: copy.alreadyVerified,
            mail_unavailable: copy.mailDown,
          }),
        );
      }
    });
  }

  async signOut(): Promise<void> {
    await api.post('/api/auth/logout');
    window.location.assign('/signin');
  }
}

export const store = new Store();

export function useApp(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function useLive(): LiveTick {
  return useSyncExternalStore(store.subscribeTicks, store.getLive, store.getLive);
}
