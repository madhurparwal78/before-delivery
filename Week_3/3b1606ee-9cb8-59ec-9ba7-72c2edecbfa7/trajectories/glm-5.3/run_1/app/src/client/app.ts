// The app's state controller: sessions, live updates, the outbox, collection and unread counts.
import type { Account, AppConfig, Attachment, Conversation, Letter, LetterBody, PreviewSetting } from '../shared/types.js';
import { api, ApiError } from './api.js';
import {
  backupKeyFor,
  conversationKeyFor,
  currentIdentity,
  digestOf,
  openAttachmentBytes,
  openLetterBody,
  openProfilePayload,
  profileKeyB64,
  profileKeyFromB64,
  sealAttachmentBytes,
  sealLetterBody,
  sealProfilePayload,
  storeIdentityFromPair,
  createIdentityKeyPair,
  makeRecoveryMaterial,
  sealKeyBackup,
  verifierFor,
  type Identity,
} from './identity.js';
import { preparePhoto } from './photos.js';
import {
  addDeletedForMe,
  allDeletedForMe,
  allKeyBackups,
  clearIdentity,
  getLetterBody,
  kvGet,
  kvSet,
  outboxAdd,
  outboxAll,
  outboxGet,
  outboxRemove,
  putKeyBackup,
  putLetterBody,
  putPeerKey,
  putProfileCache,
  removeDeletedForMe,
  type OutboxLetter,
} from './store.js';
import { b64urlDecode, b64urlEncode } from '../shared/b64.js';

export type ConnectionState = 'online' | 'connecting' | 'updating';

export interface Toast {
  id: number;
  text: string;
  conversationId: string | null;
}

export interface AvailabilityChip {
  username: string;
  state: 'idle' | 'checking' | 'available' | 'reason';
  reason: string | null;
}

export interface LookupState {
  username: string;
  status: 'idle' | 'searching' | 'found' | 'notfound';
  found: { id: string; username: string; key_id: string; public_key: string } | null;
}

export interface ComposedAttachment {
  kind: 'image' | 'file';
  name: string;
  type: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
  thumb?: string;
}

export interface AppSnapshot {
  booted: boolean;
  route: string;
  account: Account | null;
  signedOut: boolean;
  conversations: Conversation[];
  requests: Conversation[];
  openConversationId: string | null;
  openConversation: Conversation | null;
  openConversationMissing: boolean;
  letters: Map<string, Letter>;
  letterBodies: Map<string, LetterBody>;
  localStates: Map<string, 'outbox' | 'uploading' | 'failedUpload'>;
  config: AppConfig | null;
  connection: ConnectionState;
  updatingCount: number;
  outage: boolean;
  toasts: Toast[];
  lookup: LookupState | null;
  availability: AvailabilityChip | null;
  profileCaches: Map<string, { displayName: string | null; photoBlobId: string | null }>;
  keyChanges: Set<string>;
  busy: Set<string>;
  fieldErrors: Map<string, string>;
  recoveryCode: string | null;
  signupStep: number;
  signupUsername: string;
  signupDisplayName: string;
  signupPhoto: File | null;
  undoLetterId: string | null;
  hiddenCount: number;
  sealDialog: { conversation: Conversation; number: string } | null;
  photoViewer: { src: string; alt: string } | null;
  attachmentError: Map<string, string>;
}

export function firstLineOf(body: LetterBody | undefined): string {
  if (!body) return '';
  if (body.kind === 'text') return (body.text.split('\n')[0] ?? '').slice(0, 80);
  if (body.kind === 'image') return body.text ? (body.text.split('\n')[0] ?? '').slice(0, 80) : 'Photo';
  return 'File';
}

type Listener = () => void;

export class App {
  identity: Identity | null = null;
  private listeners = new Set<Listener>();
  private quietListeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private connectingTimer: number | null = null;
  private retryTimers = new Map<string, number>();
  private toastTimers = new Map<number, number>();
  private availabilityTimer: number | null = null;
  private collecting = false;
  private readMarked = new Set<string>();
  private toasted = new Set<string>();
  private requestLettersLoaded = new Set<string>();
  private pendingRecovery: { grouped: string; canonical: string; verifier: string; backupKey: Uint8Array } | null = null;
  private updatesEl: HTMLElement | null = null;

  state: AppSnapshot = {
    booted: false,
    route: '/',
    account: null,
    signedOut: false,
    conversations: [],
    requests: [],
    openConversationId: null,
    openConversation: null,
    openConversationMissing: false,
    letters: new Map(),
    letterBodies: new Map(),
    localStates: new Map(),
    config: null,
    connection: 'online',
    updatingCount: 0,
    outage: false,
    toasts: [],
    lookup: null,
    availability: null,
    profileCaches: new Map(),
    keyChanges: new Set(),
    busy: new Set(),
    fieldErrors: new Map(),
    recoveryCode: null,
    signupStep: 1,
    signupUsername: '',
    signupDisplayName: '',
    signupPhoto: null,
    undoLetterId: null,
    hiddenCount: 0,
    sealDialog: null,
    photoViewer: null,
    attachmentError: new Map(),
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** For screens that update a single element in place (chips) rather than re-rendering. */
  subscribeQuiet(listener: () => void): void {
    this.quietListeners.add(listener);
  }

  setUpdatesRegion(el: HTMLElement | null): void {
    this.updatesEl = el;
  }

  private emit(): void {
    for (const listener of this.quietListeners) listener();
    for (const listener of this.listeners) listener();
  }

  timers(): AppConfig['timers'] {
    return this.state.config?.timers ?? {
      undo_ms: 5000,
      connecting_delay_ms: 2000,
      availability_debounce_ms: 300,
      retry_base_ms: 1000,
      retry_cap_ms: 60_000,
      toast_ms: 4000,
    };
  }

  attachmentMaxBytes(): number {
    return this.state.config?.attachment_max_bytes ?? 26_214_400;
  }

  /** The size cap for the person, formatted as the brief states. */
  limitLabel(): string {
    const max = this.attachmentMaxBytes();
    const mb = Math.floor(max / 1_048_576);
    const decimal = Math.floor((max % 1_048_576) / 104_857.6) / 10;
    return `${(mb + decimal).toFixed(1)} MB`;
  }

  peerName(conversation: Conversation): string {
    const cached = this.state.profileCaches.get(conversation.peer.id);
    return cached?.displayName ?? conversation.peer.username;
  }

  unreadTotal(): number {
    return this.state.conversations.reduce((sum, c) => sum + c.unread, 0);
  }

  announce(text: string): void {
    const el = this.updatesEl;
    if (!el) return;
    const holder = el.querySelector('[data-live]') as HTMLElement | null;
    const target = holder ?? el;
    const previous = target.dataset.queued === '1' ? target.dataset.text ?? '' : '';
    target.dataset.queued = '1';
    target.dataset.text = `${previous}${previous ? ' ' : ''}${text}`;
    target.textContent = target.dataset.text;
    window.setTimeout(() => {
      if (target.dataset.text === text || target.dataset.text === `${previous}${previous ? ' ' : ''}${text}`) {
        target.dataset.queued = '0';
        target.dataset.text = '';
        target.textContent = '';
      }
    }, 1500);
  }

  // --- boot ---

  async boot(): Promise<void> {
    this.state.config = await api.config().catch(() => null);
    this.identity = await currentIdentity();
    const health = await api.health().catch(() => ({ status: 'unavailable' as const }));
    this.state.outage = health.status === 'unavailable';
    try {
      this.state.account = await api.me();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.state.account = null;
        const signedOutFlag = await kvGet<boolean>('signed_out_notice');
        this.state.signedOut = signedOutFlag === true;
      } else {
        throw error;
      }
    }
    if (this.state.account) {
      this.state.route = '/letters';
      await this.loadLists();
      await this.collectInbox(true);
      this.connectSocket();
    }
    this.state.booted = true;
    this.emit();
  }

  /** Advances the sign-up steps. */
  signupStepTo(step: number): void {
    this.state.signupStep = step;
    this.emit();
  }

  /** Makes the recovery code before it is shown once. */
  async prepareRecoveryCode(): Promise<void> {
    if (this.state.recoveryCode) return;
    const material = await makeRecoveryMaterial();
    this.state.recoveryCode = material.grouped;
    this.pendingRecovery = material;
    this.emit();
  }

  openConversationId: string | null = null;

  navigate(route: string): void {
    this.state.route = route;
    if (route.startsWith('/letters/') && route.length > '/letters/'.length) {
      void this.openConversation(route.slice('/letters/'.length));
    } else if (route === '/letters') {
      this.state.openConversationId = null;
      this.state.openConversation = null;
      this.state.openConversationMissing = false;
    }
    this.emit();
  }

  // --- lists ---

  async loadLists(): Promise<void> {
    const [accepted, requests] = await Promise.all([
      api.conversations('accepted').catch(() => ({ conversations: [] })),
      api.conversations('request').catch(() => ({ conversations: [] })),
    ]);
    this.state.conversations = accepted.conversations;
    this.state.requests = requests.conversations;
    for (const conversation of [...this.state.conversations, ...this.state.requests]) {
      await this.decryptPeerProfile(conversation);
    }
    this.refreshTitle();
    this.emit();
  }

  private refreshTitle(): void {
    const total = this.unreadTotal();
    const title = total > 0 ? `(${total}) Airfold` : 'Airfold';
    document.title = title;
    this.emit();
  }

  private async decryptPeerProfile(conversation: Conversation): Promise<void> {
    const peerId = conversation.peer.id;
    const keyRow = await getLetterBody(`profile:${peerId}`);
    if (conversation.peer.profile && keyRow) {
      try {
        const keyBytes = b64urlDecode(keyRow.body);
        const payload = await openProfilePayload(keyBytes, conversation.peer.profile.iv, conversation.peer.profile.ciphertext);
        this.state.profileCaches.set(peerId, { displayName: payload.display_name, photoBlobId: payload.photo?.blob_id ?? null });
        return;
      } catch {
        /* a profile for an older key */
      }
    }
    if (!this.state.profileCaches.has(peerId)) {
      this.state.profileCaches.set(peerId, { displayName: null, photoBlobId: null });
    }
  }

  // --- conversation ---

  /** Loads the letters of a request conversation without marking it accepted. */
  async loadRequestLetters(conversationId: string): Promise<void> {
    if (this.requestLettersLoaded.has(conversationId)) return;
    this.requestLettersLoaded.add(conversationId);
    try {
      const page = await api.letters(conversationId);
      for (const letter of page.letters) {
        this.state.letters.set(letter.id, letter);
        await this.cacheLetterBody(letter);
      }
      this.emit();
    } catch {
      this.requestLettersLoaded.delete(conversationId);
    }
  }

  async openConversation(id: string): Promise<void> {
    this.state.openConversationId = id;
    this.state.openConversation = null;
    this.state.openConversationMissing = false;
    this.emit();
    try {
      const conversation = await api.conversation(id);
      this.state.openConversation = conversation;
      await this.decryptPeerProfile(conversation);
      const page = await api.letters(id);
      const deleted = new Set((await allDeletedForMe()).map((row) => row.letterId));
      for (const letter of page.letters) {
        this.state.letters.set(letter.id, letter);
        if (deleted.has(letter.id)) continue;
        await this.cacheLetterBody(letter);
      }
      this.emit();
      await this.markReadUpTo(conversation);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        this.state.openConversationId = id;
        this.state.openConversation = null;
        this.state.openConversationMissing = true;
        this.emit();
      }
    }
  }

  async markReadUpTo(conversation: Conversation): Promise<void> {
    if (document.visibilityState !== 'visible') return;
    const letters = [...this.state.letters.values()]
      .filter((l) => l.conversation_id === conversation.id && l.recipient_id === this.state.account?.id && l.class === 'letter')
      .filter((l) => (l.state === 'delivered' || l.state === 'read') && !this.readMarked.has(l.id))
      .sort((a, b) => a.seq - b.seq);
    if (letters.length === 0) return;
    const through = letters[letters.length - 1].seq;
    try {
      const updated = await api.markRead(conversation.id, through);
      for (const l of letters) this.readMarked.add(l.id);
      this.state.openConversation = updated;
      const index = this.state.conversations.findIndex((c) => c.id === conversation.id);
      if (index >= 0) this.state.conversations[index] = updated;
      await this.loadLists();
    } catch {
      /* retried on the next open or push */
    }
  }

  private async cacheLetterBody(letter: Letter): Promise<void> {
    if (letter.class !== 'letter') return;
    if (this.state.letterBodies.has(letter.id)) return;
    if (letter.iv && letter.ciphertext) {
      await this.decryptHeldLetter(letter);
      return;
    }
    const cached = await getLetterBody(letter.id);
    if (cached) {
      try {
        this.state.letterBodies.set(letter.id, JSON.parse(cached.body) as LetterBody);
      } catch {
        /* unreadable cache */
      }
    }
  }

  private async decryptHeldLetter(letter: Letter): Promise<void> {
    if (!letter.iv || !letter.ciphertext) return;
    const conversation = this.conversationOf(letter.conversation_id);
    if (!conversation || !this.identity) return;
    try {
      const key = await conversationKeyFor(this.identity.privateKey, conversation.peer.public_key, this.identity.accountId, conversation.peer.id);
      const body = await openLetterBody(key, letter.iv, letter.ciphertext);
      this.state.letterBodies.set(letter.id, body);
      await putLetterBody({ kind: 'letterBody', letterId: letter.id, conversationId: letter.conversation_id, body: JSON.stringify(body) });
    } catch {
      /* a letter sealed for an earlier key */
    }
  }

  private conversationOf(conversationId: string): Conversation | null {
    return this.state.openConversation?.id === conversationId ? this.state.openConversation
      : this.state.conversations.find((c) => c.id === conversationId)
        ?? this.state.requests.find((c) => c.id === conversationId)
        ?? null;
  }

  // --- inbox collection (DP-15, DP-17) ---

  async collectInbox(showBar: boolean): Promise<void> {
    if (this.collecting) return;
    this.collecting = true;
    try {
      const inbox = await api.inbox();
      if (inbox.letters.length === 0) {
        if (showBar) this.finishUpdating();
        return;
      }
      if (showBar) {
        this.state.updatingCount = inbox.letters.length;
        this.state.connection = 'updating';
        this.emit();
      }
      for (const letter of inbox.letters) {
        this.state.letters.set(letter.id, letter);
        await this.cacheLetterBody(letter);
        if (letter.class === 'control') await this.applyControlLetter(letter);
      }
      const through = Math.max(...inbox.letters.map((l) => l.seq));
      await api.ackInbox(through);
      await this.loadLists();
      this.emit();
      if (showBar) this.finishUpdating();
    } catch {
      /* offline; retried on reconnect */
      this.collecting = false;
    } finally {
      this.collecting = false;
    }
  }

  private finishUpdating(): void {
    // The Updating bar stays for at least one second.
    window.setTimeout(() => {
      if (this.state.connection === 'updating') {
        this.state.updatingCount = 0;
        this.state.connection = 'online';
        this.emit();
      }
    }, 1000);
  }

  // --- socket (DP-12, DP-15) ---

  private connectSocket(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    this.socket = socket;
    socket.onopen = () => {
      this.clearConnecting();
      if (this.state.connection === 'connecting') this.state.connection = 'online';
      this.emit();
      void this.collectInbox(true);
      void this.flushOutbox();
    };
    socket.onclose = () => {
      this.socket = null;
      this.startConnecting();
      window.setTimeout(() => {
        if (this.state.account) this.connectSocket();
      }, 1000);
    };
    socket.onmessage = (event) => {
      void this.handleFrame(JSON.parse(event.data as string));
    };
  }

  private async handleFrame(frame: { type: string; letter?: Letter; conversation?: Conversation; account_id?: string }): Promise<void> {
    if (frame.type === 'signed_out') {
      await kvSet('signed_out_notice', true);
      await clearIdentity();
      this.identity = null;
      this.state.account = null;
      this.state.signedOut = true;
      this.state.route = '/';
      this.emit();
      return;
    }
    if (frame.type === 'keys' && frame.account_id) {
      await this.loadLists();
      const conversation = this.state.conversations.find((c) => c.peer.id === frame.account_id);
      if (conversation && conversation.peer.seal === 'changed') this.state.keyChanges.add(frame.account_id);
      this.emit();
      return;
    }
    if (frame.type === 'letter' && frame.letter) {
      const letter = frame.letter;
      this.state.letters.set(letter.id, letter);
      if (letter.class === 'control') {
        await this.cacheLetterBody(letter);
        await this.applyControlLetter(letter);
        return;
      }
      if (letter.recipient_id === this.state.account?.id) {
        if (letter.iv && letter.ciphertext) {
          await this.decryptHeldLetter(letter);
          void this.collectInbox(false);
        } else {
          await this.cacheLetterBody(letter);
        }
      }
      const conversation = this.conversationOf(letter.conversation_id);
      const isOpen = this.state.openConversationId === letter.conversation_id && document.visibilityState === 'visible';
      if (isOpen && conversation) {
        this.announce(`New letter from ${this.peerName(conversation)}.`);
        this.emit();
        await this.markReadUpTo(conversation);
      } else if (conversation) {
        this.raiseToast(letter, conversation);
      }
      await this.loadLists();
      return;
    }
    if (frame.type === 'conversation' && frame.conversation) {
      await this.applyConversation(frame.conversation);
    }
  }

  private async applyConversation(conversation: Conversation): Promise<void> {
    if (conversation.status === 'accepted') {
      const index = this.state.conversations.findIndex((c) => c.id === conversation.id);
      if (index >= 0) this.state.conversations[index] = conversation;
      else this.state.conversations.unshift(conversation);
      this.state.requests = this.state.requests.filter((c) => c.id !== conversation.id);
      if (this.state.openConversationId === conversation.id) this.state.openConversation = conversation;
    } else {
      const index = this.state.requests.findIndex((c) => c.id === conversation.id);
      if (conversation.last_letter !== null) {
        if (index >= 0) this.state.requests[index] = conversation;
        else this.state.requests.unshift(conversation);
      } else {
        this.state.requests = this.state.requests.filter((c) => c.id !== conversation.id);
      }
    }
    await this.decryptPeerProfile(conversation);
    this.refreshTitle();
    this.emit();
  }

  private raiseToast(letter: Letter, conversation: Conversation): void {
    if (this.toasted.has(letter.id)) return;
    this.toasted.add(letter.id);
    if (conversation.muted_until !== null) return;
    const preview = this.state.account?.settings.preview ?? 'name_and_letter';
    const name = this.peerName(conversation);
    const body = this.state.letterBodies.get(letter.id);
    let text: string;
    if (preview === 'none') text = 'New letter';
    else if (preview === 'name_only') text = name;
    else text = `${name}: ${firstLineOf(body)}`;
    const toast: Toast = { id: Date.now() + Math.random(), text, conversationId: letter.conversation_id };
    this.state.toasts = [...this.state.toasts, toast];
    this.emit();
    const timer = window.setTimeout(() => {
      this.state.toasts = this.state.toasts.filter((t) => t.id !== toast.id);
      this.emit();
    }, this.timers()?.toast_ms ?? 4000);
    this.toastTimers.set(toast.id, timer);
  }

  dismissToast(id: number): void {
    const timer = this.toastTimers.get(id);
    if (timer) window.clearTimeout(timer);
    this.state.toasts = this.state.toasts.filter((t) => t.id !== id);
    this.emit();
  }

  // --- connecting bar (DP-13, DP-14) ---

  startConnecting(): void {
    if (this.connectingTimer !== null) return;
    this.connectingTimer = window.setTimeout(() => {
      this.connectingTimer = null;
      if (this.state.connection === 'online') {
        this.state.connection = 'connecting';
        this.emit();
      }
    }, this.timers()?.connecting_delay_ms ?? 2000);
  }

  clearConnecting(): void {
    if (this.connectingTimer !== null) {
      window.clearTimeout(this.connectingTimer);
      this.connectingTimer = null;
    }
    if (this.state.connection === 'connecting') {
      this.state.connection = 'online';
      this.emit();
    }
  }

  onBrowserOnline(): void {
    this.clearConnecting();
    void this.flushOutbox();
    void this.collectInbox(true);
  }

  onBrowserOffline(): void {
    this.startConnecting();
  }

  // --- availability (DP-01, DP-03) ---

  queueAvailability(username: string): void {
    if (this.availabilityTimer !== null) window.clearTimeout(this.availabilityTimer);
    if (username.trim().length === 0) {
      this.state.availability = null;
      for (const listener of this.quietListeners) listener();
      return;
    }
    this.state.availability = { username, state: 'checking', reason: null };
    for (const listener of this.quietListeners) listener();
    const delay = this.timers()?.availability_debounce_ms ?? 300;
    this.availabilityTimer = window.setTimeout(async () => {
      try {
        const result = await api.availability(username);
        if (result.available) {
          this.state.availability = { username: result.username, state: 'available', reason: null };
        } else {
          this.state.availability = { username: result.username, state: 'reason', reason: result.reason };
        }
      } catch {
        this.state.availability = null;
      }
      for (const listener of this.quietListeners) listener();
    }, delay);
  }

  // --- lookup (DP-04, DP-05) ---

  async runLookup(username: string): Promise<void> {
    const clean = username.trim().toLowerCase();
    if (!clean) return;
    this.state.lookup = { username: clean, status: 'searching', found: null };
    this.emit();
    try {
      const found = await api.lookup(clean);
      this.state.lookup = { username: clean, status: 'found', found };
      this.announce(`Found ${found.username}.`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        this.state.lookup = { username: clean, status: 'notfound', found: null };
        this.announce('No one with that username.');
      } else {
        this.state.lookup = { username: clean, status: 'idle', found: null };
      }
    }
    this.emit();
  }

  async startConversation(peerId: string): Promise<Conversation | null> {
    try {
      const conversation = await api.createConversation(peerId);
      await this.loadLists();
      this.state.openConversationId = conversation.id;
      history.pushState(null, '', `/letters/${conversation.id}`);
      this.navigate(`/letters/${conversation.id}`);
      return conversation;
    } catch {
      return null;
    }
  }

  // --- composing and the outbox (DP-09, DP-13, DP-19) ---

  async compose(conversation: Conversation, text: string, attachment: ComposedAttachment | null): Promise<string | null> {
    if (!text && !attachment) return null;
    const id = crypto.randomUUID();
    const outbox: OutboxLetter = {
      kind: 'outbox',
      id,
      conversationId: conversation.id,
      class: 'letter',
      recipientKeyId: conversation.peer.key_id,
      iv: null,
      ciphertext: null,
      attachmentId: null,
      body: '',
      composedAt: Date.now(),
      attempts: 0,
      uploadFailed: false,
      attachmentSealed: null,
      attachmentDeclaredSize: 0,
      attachmentKind: undefined,
    };
    if (attachment) {
      console.log('DEBUG compose attachment kind:', attachment.kind, 'bytes:', attachment.bytes.length, 'text:', JSON.stringify(text));
      const sealed = await sealAttachmentBytes(attachment.bytes);
      const attachmentId = crypto.randomUUID();
      outbox.attachmentId = attachmentId;
      outbox.attachmentSealed = sealed.sealed;
      outbox.attachmentDeclaredSize = sealed.sealed.length;
      outbox.attachmentKind = attachment.kind;
      const shared = {
        blob_id: attachmentId,
        key: b64urlEncode(sealed.key),
        iv: b64urlEncode(sealed.iv),
        digest: sealed.digest,
        size: attachment.bytes.length,
        name: attachment.name,
        type: attachment.type,
      } satisfies Attachment;
      const full: LetterBody = attachment.kind === 'image'
        ? { v: 1, kind: 'image', text, attachment: { ...shared, width: attachment.width, height: attachment.height, thumb: attachment.thumb } }
        : { v: 1, kind: 'file', text: '', attachment: shared };
      outbox.body = JSON.stringify(full);
    } else {
      outbox.body = JSON.stringify({ v: 1, kind: 'text', text } satisfies LetterBody);
    }
    await outboxAdd(outbox);
    this.state.localStates.set(id, outbox.attachmentId ? 'uploading' : 'outbox');
    this.state.letterBodies.set(id, JSON.parse(outbox.body) as LetterBody);
    this.emit();
    void this.flushOutbox();
    return id;
  }

  async composeControl(conversation: Conversation, body: LetterBody): Promise<void> {
    const id = crypto.randomUUID();
    const outbox: OutboxLetter = {
      kind: 'outbox',
      id,
      conversationId: conversation.id,
      class: 'control',
      recipientKeyId: conversation.peer.key_id,
      iv: null,
      ciphertext: null,
      attachmentId: null,
      body: JSON.stringify(body),
      composedAt: Date.now(),
      attempts: 0,
      uploadFailed: false,
      attachmentSealed: null,
      attachmentDeclaredSize: 0,
      attachmentKind: undefined,
    };
    await outboxAdd(outbox);
    void this.flushOutbox();
  }

  async restoreOutbox(): Promise<void> {
    const letters = await outboxAll();
    for (const letter of letters) {
      if (letter.class === 'letter') {
        this.state.localStates.set(letter.id, letter.uploadFailed ? 'failedUpload' : letter.attachmentId ? 'uploading' : 'outbox');
        if (!this.state.letterBodies.has(letter.id)) {
          this.state.letterBodies.set(letter.id, JSON.parse(letter.body) as LetterBody);
        }
      }
    }
    this.emit();
  }

  async flushOutbox(): Promise<void> {
    const letters = await outboxAll();
    const next = letters.find((l) => !this.retryTimers.has(l.id));
    if (next) void this.postLetter(next);
  }

  private async postLetter(letter: OutboxLetter): Promise<void> {
    const conversation = this.conversationOf(letter.conversationId);
    if (!conversation || !this.identity) {
      this.scheduleRetry(letter);
      return;
    }
    try {
      if (letter.attachmentId && !letter.uploadFailed) {
        const ok = await this.uploadAttachment(letter);
        if (!ok) return;
      }
      const key = await conversationKeyFor(this.identity.privateKey, conversation.peer.public_key, this.identity.accountId, conversation.peer.id);
      const sealed = await sealLetterBody(key, JSON.parse(letter.body) as LetterBody);
      const posted = await api.postLetter({
        id: letter.id,
        conversation_id: letter.conversationId,
        class: letter.class,
        recipient_key_id: letter.recipientKeyId,
        iv: sealed.iv,
        ciphertext: sealed.ciphertext,
        attachment_id: letter.attachmentId,
      });
      await outboxRemove(letter.id);
      this.state.localStates.delete(letter.id);
      this.state.letters.set(posted.id, posted);
      this.state.letterBodies.set(posted.id, JSON.parse(sealed.bodyJson) as LetterBody);
      await putLetterBody({ kind: 'letterBody', letterId: posted.id, conversationId: posted.conversation_id, body: sealed.bodyJson });
      if (letter.class === 'letter') {
        this.announce(`Sent. Held for ${this.peerName(conversation)} until they collect it.`);
      }
      await this.loadLists();
      this.emit();
      await this.flushOutbox();
    } catch (error) {
      await this.handlePostError(letter, error);
    }
  }

  private async uploadAttachment(letter: OutboxLetter): Promise<boolean> {
    if (!letter.attachmentId || !letter.attachmentSealed) return false;
    try {
      const declared = await api.declareBlob({ id: letter.attachmentId, kind: letter.attachmentKind ?? 'file', size: letter.attachmentDeclaredSize ?? 0 });
      if (declared.state !== 'stored') {
        await api.uploadBlob(letter.attachmentId, letter.attachmentSealed);
      }
      this.announce('Upload finished.');
      this.state.outage = false;
      return true;
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'storage_unavailable') {
          this.state.outage = true;
          letter.uploadFailed = true;
          await outboxAdd(letter);
          this.state.localStates.set(letter.id, 'failedUpload');
          this.announce("Couldn't upload. Your letter wasn't sent.");
          this.emit();
          return false;
        }
        if (error.code === 'too_large') {
          await outboxRemove(letter.id);
          this.state.localStates.set(letter.id, 'failedUpload');
          this.emit();
          return false;
        }
        if (error.status >= 500) {
          this.scheduleRetry(letter);
          return false;
        }
        this.state.localStates.set(letter.id, 'failedUpload');
        this.emit();
        return false;
      }
      this.scheduleRetry(letter);
      return false;
    }
  }

  private scheduleRetry(letter: OutboxLetter): void {
    if (this.retryTimers.has(letter.id)) return;
    letter.attempts += 1;
    void outboxAdd(letter);
    const base = this.timers()?.retry_base_ms ?? 1000;
    const cap = this.timers()?.retry_cap_ms ?? 60_000;
    const delay = Math.min(base * 2 ** (letter.attempts - 1), cap);
    const timer = window.setTimeout(() => {
      this.retryTimers.delete(letter.id);
      void this.flushOutbox();
    }, delay);
    this.retryTimers.set(letter.id, timer);
  }

  private async handlePostError(letter: OutboxLetter, error: unknown): Promise<void> {
    if (error instanceof ApiError) {
      if (error.code === 'storage_unavailable') {
        this.state.outage = true;
        this.scheduleRetry(letter);
        return;
      }
      if (error.status === 0 || error.status >= 500) {
        this.scheduleRetry(letter);
        return;
      }
      if (error.code === 'seal_change_unaccepted' || error.code === 'recipient_key_changed') {
        const conversation = this.conversationOf(letter.conversationId);
        if (conversation) this.state.keyChanges.add(conversation.peer.id);
        this.emit();
        return;
      }
      // Other refusals leave the letter showing the refused copy.
      await outboxRemove(letter.id);
      this.state.localStates.set(letter.id, 'failedUpload');
      this.emit();
      return;
    }
    this.scheduleRetry(letter);
  }

  async retryUpload(letterId: string): Promise<void> {
    const letter = await outboxGet(letterId);
    if (!letter) return;
    letter.uploadFailed = false;
    letter.attempts = 0;
    await outboxAdd(letter);
    this.state.localStates.set(letterId, 'uploading');
    this.emit();
    void this.postLetter(letter);
  }

  // --- profile key control letters (DP-06, DP-31) ---

  private async applyControlLetter(letter: Letter): Promise<void> {
    if (letter.recipient_id !== this.state.account?.id) return;
    if (!letter.iv || !letter.ciphertext) {
      const cached = await getLetterBody(letter.id);
      if (!cached) return;
      try {
        await this.applyProfileKey(letter, JSON.parse(cached.body) as LetterBody);
      } catch {
        /* unreadable */
      }
      return;
    }
    const conversation = this.conversationOf(letter.conversation_id);
    if (!conversation || !this.identity) return;
    try {
      const key = await conversationKeyFor(this.identity.privateKey, conversation.peer.public_key, this.identity.accountId, conversation.peer.id);
      const body = await openLetterBody(key, letter.iv, letter.ciphertext);
      await putLetterBody({ kind: 'letterBody', letterId: letter.id, conversationId: letter.conversation_id, body: JSON.stringify(body) });
      await this.applyProfileKey(letter, body);
    } catch {
      /* a control letter for an earlier key */
    }
  }

  private async applyProfileKey(letter: Letter, body: LetterBody): Promise<void> {
    if (body.kind !== 'profile') return;
    const peerId = letter.sender_id;
    const keyBytes = profileKeyFromB64((body as { profile_key: string }).profile_key);
    await putLetterBody({ kind: 'letterBody', letterId: `profile:${peerId}`, conversationId: letter.conversation_id, body: b64urlEncode(keyBytes) });
    const conversation = this.conversationOf(letter.conversation_id);
    if (conversation) {
      await this.decryptPeerProfile(conversation);
      // Reply with my own profile key if I have not sent one yet.
      const mine = await getLetterBody(`profile-sent:${this.state.account?.id}`);
      if (!mine) await this.sendProfileKey(conversation);
    }
    this.emit();
  }

  async sendProfileKey(conversation: Conversation): Promise<void> {
    if (!this.identity?.profileKey || !this.state.account) return;
    const body: LetterBody = { v: 1, kind: 'profile', profile_key: profileKeyB64(this.identity.profileKey) } as unknown as LetterBody;
    await this.composeControl(conversation, body);
    await putLetterBody({ kind: 'letterBody', letterId: `profile-sent:${this.state.account.id}`, conversationId: conversation.id, body: '' });
  }

  // --- attachments on the reading side (DP-23) ---

  async fetchAttachment(letter: Letter): Promise<{ url: string; name: string; type: string } | 'corrupted' | 'unavailable'> {
    const body = this.state.letterBodies.get(letter.id);
    if (!body || body.kind === 'text' || body.kind === 'profile') return 'unavailable';
    const attachment = body.attachment;
    try {
      const sealed = await api.downloadBlob(attachment.blob_id);
      if (await digestOf(sealed) !== attachment.digest) return 'corrupted';
      const key = b64urlDecode(attachment.key);
      const iv = b64urlDecode(attachment.iv);
      const bytes = await openAttachmentBytes(key, iv, sealed);
      const blob = new Blob([bytes as unknown as BlobPart], { type: attachment.type });
      this.state.outage = false;
      return { url: URL.createObjectURL(blob), name: attachment.name, type: attachment.type };
    } catch (error) {
      if (error instanceof ApiError && (error.status === 503 || error.code === 'storage_unavailable')) {
        this.state.outage = true;
        this.emit();
      }
      return 'unavailable';
    }
  }

  // --- sign-up and restore (DP-02, DP-03, DP-31) ---

  async signUp(username: string, displayName: string, photo: File | null): Promise<{ ok: boolean; error?: string; field?: string }> {
    const pair = await createIdentityKeyPair();
    const material = this.pendingRecovery ?? await makeRecoveryMaterial();
    const backup = await sealKeyBackup(pair.privateKey, material.backupKey);
    const profileKey = crypto.getRandomValues(new Uint8Array(32));
    let account: Account;
    try {
      account = await api.signUp({
        username,
        public_key: b64urlEncode(pair.publicKey),
        recovery_verifier: material.verifier,
        key_backup: backup,
      });
    } catch (error) {
      if (error instanceof ApiError && error.extra.fields) {
        const fields = error.extra.fields as Record<string, string>;
        return { ok: false, error: fields.username ?? 'invalid', field: 'username' };
      }
      if (error instanceof ApiError && error.code === 'username_taken') return { ok: false, error: 'taken', field: 'username' };
      return { ok: false, error: 'unknown', field: 'username' };
    }
    await storeIdentityFromPair(pair, account.id, account.username, profileKey);
    this.identity = await currentIdentity();
    this.state.account = account;
    this.state.recoveryCode = material.grouped;
    await kvSet('recovery_code', material.grouped);

    // Seal the profile: display name and optional photo, both sealed here in the browser.
    let photoPayload: { blob_id: string; key: string; iv: string; digest: string; type: string } | null = null;
    let photoWarning = false;
    if (photo) {
      try {
        photoPayload = await this.storeProfilePhoto(photo, profileKey);
      } catch {
        photoWarning = true;
      }
    }
    const sealed = await sealProfilePayload(profileKey, { display_name: displayName, photo: photoPayload });
    try {
      this.state.account = await api.putProfile({ iv: sealed.iv, ciphertext: sealed.ciphertext, photo_blob_id: photoPayload?.blob_id ?? null });
    } catch {
      // The photo blob wasn't stored: save the name-only profile.
      const fallback = await sealProfilePayload(profileKey, { display_name: displayName, photo: null });
      this.state.account = await api.putProfile({ iv: fallback.iv, ciphertext: fallback.ciphertext, photo_blob_id: null });
      photoWarning = photoPayload !== null;
    }
    if (photoWarning) {
      this.announce("Your photo couldn't be saved. You can add it in Settings later.");
    }
    await putProfileCache({ kind: 'profile', accountId: account.id, displayName, photoBlobId: photoPayload?.blob_id ?? null });
    this.state.signupPhoto = null;
    history.pushState(null, '', '/letters');
    this.state.route = '/letters';
    await this.loadLists();
    this.connectSocket();
    this.emit();
    return { ok: true };
  }

  private async storeProfilePhoto(photo: File, profileKey: Uint8Array): Promise<{ blob_id: string; key: string; iv: string; digest: string; type: string } | null> {
    const prepared = await preparePhoto(photo);
    const sealed = await sealAttachmentBytes(prepared.bytes);
    const id = crypto.randomUUID();
    await api.declareBlob({ id, kind: 'photo', size: sealed.sealed.length });
    await api.uploadBlob(id, sealed.sealed);
    return { blob_id: id, key: b64urlEncode(sealed.key), iv: b64urlEncode(sealed.iv), digest: sealed.digest, type: 'image/jpeg' };
  }

  async signIn(username: string, recoveryCode: string): Promise<{ ok: boolean; error?: string }> {
    const canonical = recoveryCode.toUpperCase().replace(/[-\s]/g, '').replace(/I/g, '1').replace(/L/g, '1').replace(/O/g, '0');
    const verifier = await verifierFor(canonical);
    const backupKey = await backupKeyFor(canonical);
    const pair = await createIdentityKeyPair();
    const backup = await sealKeyBackup(pair.privateKey, backupKey);
    let result;
    try {
      result = await api.recover({
        username,
        recovery_verifier: verifier,
        public_key: b64urlEncode(pair.publicKey),
        key_backup: backup,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) return { ok: false, error: 'too_many' };
      return { ok: false, error: 'mismatch' };
    }
    const oldProfileKey = this.identity?.profileKey ?? null;
    await storeIdentityFromPair(pair, result.account.id, result.account.username, oldProfileKey);
    this.identity = await currentIdentity();
    for (const row of result.key_backups) {
      await putKeyBackup({ kind: 'keyBackup', keyId: row.key_id, iv: row.iv, ciphertext: row.ciphertext });
    }
    this.state.account = result.account;
    this.state.signedOut = false;
    await kvSet('signed_out_notice', false);
    history.pushState(null, '', '/letters');
    this.state.route = '/letters';
    await this.loadLists();
    await this.collectInbox(true);
    this.connectSocket();
    // Send the new profile key to every accepted contact.
    for (const conversation of this.state.conversations) {
      await putLetterBody({ kind: 'letterBody', letterId: `profile-sent:${this.state.account.id}`, conversationId: conversation.id, body: '' });
    }
    if (this.identity?.profileKey) {
      for (const conversation of this.state.conversations) {
        await this.composeControl(conversation, { v: 1, kind: 'profile', profile_key: profileKeyB64(this.identity.profileKey) } as unknown as LetterBody);
      }
    }
    this.emit();
    return { ok: true };
  }

  // --- requests (DP-06, DP-07) ---

  async acceptRequest(conversation: Conversation): Promise<void> {
    const updated = await api.accept(conversation.id);
    history.pushState(null, '', `/letters/${conversation.id}`);
    this.state.openConversationId = conversation.id;
    this.state.requests = this.state.requests.filter((c) => c.id !== conversation.id);
    const index = this.state.conversations.findIndex((c) => c.id === conversation.id);
    if (index >= 0) this.state.conversations[index] = updated;
    else this.state.conversations.unshift(updated);
    await this.decryptPeerProfile(updated);
    await this.sendProfileKey(updated);
    this.emit();
  }

  async deleteRequest(conversation: Conversation): Promise<void> {
    await api.deleteRequest(conversation.id);
    this.state.requests = this.state.requests.filter((c) => c.id !== conversation.id);
    this.emit();
  }

  // --- seal numbers (DP-30, DP-32, DP-33) ---

  async openSealDialog(conversation: Conversation): Promise<void> {
    if (!this.identity) return;
    const { sealNumberFor } = await import('./identity.js');
    const number = await sealNumberFor(this.identity, conversation.peer.public_key);
    this.state.sealDialog = { conversation, number };
    this.emit();
  }

  closeSealDialog(): void {
    this.state.sealDialog = null;
    this.emit();
  }

  /** Used by the dialog's own close so the state clears without a re-open. */
  clearSealDialog(): void {
    if (this.state.sealDialog) {
      this.state.sealDialog = null;
      this.emit();
    }
  }

  async markSealVerified(conversation: Conversation, verified: boolean): Promise<void> {
    const fresh = await api.conversation(conversation.id);
    await api.setSeal(fresh.peer.id, fresh.peer.key_id, verified);
    this.state.sealDialog = null;
    this.state.openConversation = fresh;
    if (!verified) this.state.keyChanges.delete(fresh.peer.id);
    await this.loadLists();
    this.emit();
  }

  async acceptNewSeal(conversation: Conversation): Promise<void> {
    // The peer's current key may have changed since this view was built; read it fresh.
    const fresh = await api.conversation(conversation.id);
    await api.setSeal(fresh.peer.id, fresh.peer.key_id, false);
    this.state.keyChanges.delete(fresh.peer.id);
    this.state.openConversation = fresh;
    await this.sendProfileKey(fresh);
    // Reseal the letters kept in Sending behind the key-change stub, under their same ids.
    const outbox = await outboxAll();
    for (const letter of outbox) {
      if (letter.conversationId === fresh.id && letter.recipientKeyId !== fresh.peer.key_id) {
        letter.recipientKeyId = fresh.peer.key_id;
        letter.attempts = 0;
        await outboxAdd(letter);
      }
    }
    await this.loadLists();
    await this.flushOutbox();
    this.emit();
  }

  // --- mute and block (DP-28, DP-29, DP-36) ---

  async setMute(conversation: Conversation, duration: '1h' | '8h' | '1w' | 'always' | 'off'): Promise<void> {
    const updated = await api.mute(conversation.id, duration);
    const index = this.state.conversations.findIndex((c) => c.id === conversation.id);
    if (index >= 0) this.state.conversations[index] = updated;
    if (this.state.openConversation?.id === conversation.id) this.state.openConversation = updated;
    this.emit();
  }

  async blockPeer(conversation: Conversation): Promise<void> {
    await api.block(conversation.peer.id);
    if (this.state.openConversationId === conversation.id) {
      this.state.openConversation = await api.conversation(conversation.id);
    }
    await this.loadLists();
    this.emit();
  }

  async unblockPeer(conversation: Conversation): Promise<void> {
    await api.unblock(conversation.peer.id);
    if (this.state.openConversationId === conversation.id) {
      this.state.openConversation = await api.conversation(conversation.id);
    }
    await this.loadLists();
    this.emit();
  }

  // --- deleting (DP-26, DP-27) ---

  async deleteForMe(letterId: string): Promise<void> {
    const conversationId = this.state.openConversationId ?? '';
    await addDeletedForMe({ kind: 'deletedForMe', letterId, conversationId, deletedAt: Date.now() });
    this.state.undoLetterId = letterId;
    this.state.hiddenCount += 1;
    this.announce('Letter deleted.');
    this.emit();
  }

  async undoDeleteForMe(letterId: string): Promise<void> {
    await removeDeletedForMe(letterId);
    this.state.undoLetterId = null;
    this.state.hiddenCount += 1;
    this.announce('Letter restored.');
    this.emit();
  }

  async deleteForEveryone(letterId: string): Promise<void> {
    const letter = await api.retract(letterId);
    this.state.letters.set(letter.id, letter);
    const conversation = this.conversationOf(letter.conversation_id);
    if (conversation) await this.loadLists();
    this.emit();
  }

  async refreshLetter(letterId: string): Promise<void> {
    const letter = await api.letter(letterId);
    this.state.letters.set(letter.id, letter);
    this.emit();
  }

  async hiddenLetterIds(): Promise<Set<string>> {
    const rows = await allDeletedForMe();
    return new Set(rows.map((r) => r.letterId));
  }

  // --- settings (DP-34, DP-35, DP-36) ---

  async changeUsername(username: string): Promise<{ ok: boolean; error?: string; retryAt?: string }> {
    try {
      const account = await api.patchUsername({ username });
      this.state.account = account;
      this.announce(`Your username is now ${account.username}.`);
      this.emit();
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'username_cooldown') {
        return { ok: false, error: 'cooldown', retryAt: String(error.extra.retry_at ?? '') };
      }
      if (error instanceof ApiError && error.code === 'username_taken') {
        return { ok: false, error: 'taken' };
      }
      if (error instanceof ApiError && error.extra.fields) {
        const fields = error.extra.fields as Record<string, string>;
        const reason = fields.username ?? 'invalid';
        return { ok: false, error: reason === 'same' ? 'same' : reason };
      }
      return { ok: false, error: 'unknown' };
    }
  }

  async saveSettings(patch: { read_receipts?: boolean; preview?: PreviewSetting }): Promise<void> {
    this.state.account = await api.patchSettings(patch);
    this.emit();
  }

  async saveProfile(displayName: string, photo: File | null): Promise<{ ok: boolean }> {
    if (!this.identity || !this.state.account) return { ok: false };
    const profileKey = this.identity.profileKey ?? crypto.getRandomValues(new Uint8Array(32));
    let photoPayload: { blob_id: string; key: string; iv: string; digest: string; type: string } | null = null;
    try {
      if (photo) photoPayload = await this.storeProfilePhoto(photo, profileKey);
    } catch {
      photoPayload = null;
    }
    const sealed = await sealProfilePayload(profileKey, { display_name: displayName, photo: photoPayload });
    try {
      this.state.account = await api.putProfile({ iv: sealed.iv, ciphertext: sealed.ciphertext, photo_blob_id: photoPayload?.blob_id ?? null });
    } catch {
      const fallback = await sealProfilePayload(profileKey, { display_name: displayName, photo: null });
      this.state.account = await api.putProfile({ iv: fallback.iv, ciphertext: fallback.ciphertext, photo_blob_id: null });
    }
    if (!this.identity.profileKey) {
      await (await import('./identity.js')).updateProfileKey(this.identity, profileKey);
      this.identity = await currentIdentity();
      // The profile key changed: tell accepted contacts so they can open the new profile.
      for (const conversation of this.state.conversations) {
        await this.sendProfileKey(conversation);
      }
    }
    await putProfileCache({ kind: 'profile', accountId: this.state.account.id, displayName, photoBlobId: photoPayload?.blob_id ?? null });
    this.emit();
    return { ok: true };
  }
}
