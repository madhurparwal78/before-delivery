import { applyEntry, applyPrimitives, type DocState } from '../../shared/doc.js';
import { entryTextEdits, rebaseEntries } from '../../shared/ot.js';
import type {
  AccessEndedReason,
  Card,
  Decision,
  EditMode,
  Mode,
  OpEntry,
  Person,
  PresenceState,
  Role,
  SaveState,
  ServerFrame,
  Snapshot,
  Suggestion,
  TextEdit,
} from '../../shared/types.js';
import type { SessionPerson } from '../api.js';
import type { Connection } from '../socket.js';

export type SessionEvent = 'doc' | 'cards' | 'presence' | 'save' | 'role' | 'title' | 'access' | 'connection';

interface OutboxFrame {
  ref: string;
  entries: readonly OpEntry[];
  mode: EditMode;
  edits: TextEdit[];
  sent: boolean;
}

export interface CaretState {
  person: Person;
  at: number;
  length: number;
  state: 'active' | 'idle';
}

export interface SettleEffect {
  card: Suggestion;
  status: string;
  decidedBy: Person;
}

function stateOfSnapshot(snapshot: Snapshot): DocState {
  return {
    text: snapshot.text,
    blockStyles: snapshot.blocks.map((block) => block.style),
    marks: snapshot.marks.map((mark) => ({ ...mark })),
    suggestions: snapshot.suggestions.map((suggestion) => ({ ...suggestion })),
    comments: snapshot.comments.map((comment) => ({ ...comment })),
  };
}

/** The editor's copy of a proposal: text, cards, presence and the live socket. */
export class EditorSession {
  readonly documentId: string;
  readonly me: SessionPerson;
  readonly connection: Connection;
  state: DocState;
  revision: number;
  savedRevision: number;
  saveFailed = false;
  role: Role;
  mode: Mode;
  accessEndsAt: string | null;
  title: string;
  client: string;
  people: Person[];
  readonly carets = new Map<string, CaretState>();
  readonly presence = new Map<string, { person: Person; state: PresenceState }>();
  accessEnded: AccessEndedReason | null = null;
  connected = true;
  lastSettled: SettleEffect | null = null;

  private readonly outbox: OutboxFrame[] = [];
  private refCounter = 0;
  private readonly listeners = new Map<SessionEvent, (() => void)[]>();
  private readonly remoteEditListeners: ((edits: TextEdit[]) => void)[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(snapshot: Snapshot, me: SessionPerson, connection: Connection) {
    this.documentId = snapshot.id;
    this.me = me;
    this.connection = connection;
    this.state = stateOfSnapshot(snapshot);
    this.revision = snapshot.revision;
    this.savedRevision = snapshot.savedRevision;
    this.saveFailed = snapshot.saveState === 'failed';
    this.role = snapshot.myAccess.role;
    this.mode = snapshot.myAccess.mode;
    this.accessEndsAt = snapshot.myAccess.accessEndsAt;
    this.title = snapshot.title;
    this.client = snapshot.client;
    this.people = snapshot.people;
    connection.onFrame((frame) => this.onFrame(frame));
    connection.onConnectionChange((connected) => {
      this.connected = connected;
      this.emit('connection');
    });
    connection.setRejoin(() => void this.join());
    void this.join();
  }

  on(event: SessionEvent, handler: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  /** Local carets and selections follow the text changes other people make. */
  onRemoteEdits(handler: (edits: TextEdit[]) => void): void {
    this.remoteEditListeners.push(handler);
  }

  private emit(event: SessionEvent): void {
    for (const handler of this.listeners.get(event) ?? []) handler();
  }

  private async join(): Promise<void> {
    try {
      const frame = await this.connection.send({ type: 'join', documentId: this.documentId, revision: this.revision });
      if (frame.type !== 'joined') return;
      this.role = frame.role;
      this.mode = frame.mode;
      this.accessEndsAt = frame.accessEndsAt;
      this.presence.clear();
      for (const entry of frame.people) this.presence.set(entry.person.personId, { person: entry.person, state: entry.state });
      this.emit('presence');
      this.emit('role');
      if (this.heartbeat === null) {
        this.heartbeat = setInterval(() => {
          void this.connection.send({ type: 'heartbeat' }).catch(() => undefined);
        }, 15_000);
      }
    } catch {
      this.accessEnded = 'removed';
      this.emit('access');
    }
  }

  get saveState(): SaveState {
    if (this.saveFailed) return 'failed';
    if (this.savedRevision >= this.revision && this.outbox.length === 0) return 'saved';
    return 'saving';
  }

  get canEdit(): boolean {
    return this.role === 'owner' || this.role === 'editor';
  }

  get canComment(): boolean {
    return this.role !== 'viewer';
  }

  get editMode(): EditMode {
    return this.mode === 'editing' ? 'editing' : 'suggesting';
  }

  get editable(): boolean {
    return this.connected && this.accessEnded === null && this.mode !== 'viewing';
  }

  personColour(personId: string): string {
    if (personId === this.me.personId) return this.me.colour;
    const known = this.people.find((person) => person.personId === personId);
    if (known) return known.colour;
    return this.presence.get(personId)?.person.colour ?? '#1f4d3f';
  }

  /** Applies the person's own edit at once, then sends it for the server to order. */
  applyLocal(entries: OpEntry[], mode: EditMode): void {
    const edits: TextEdit[] = [];
    for (const entry of entries) {
      const outcome = applyEntry(this.state, entry, mode, this.me.personId);
      edits.push(...outcome.textEdits);
    }
    this.refCounter += 1;
    this.outbox.push({ ref: `op${this.refCounter}`, entries, mode, edits, sent: false });
    this.emit('doc');
    this.emit('save');
    this.pump();
  }

  private pump(): void {
    const frame = this.outbox[0];
    if (!frame || frame.sent) return;
    frame.sent = true;
    void this.connection
      .send({ type: 'op', ref: frame.ref, baseRevision: this.revision, mode: frame.mode, ops: [...frame.entries] })
      .then((reply) => {
        if (reply.type === 'ack' && typeof reply.revision === 'number') this.revision = Math.max(this.revision, reply.revision);
        this.outbox.shift();
        this.emit('save');
        this.pump();
      })
      .catch(() => {
        this.outbox.length = 0;
        void this.resync();
      });
  }

  /** After a refused frame the screen goes back to the server's text. */
  async resync(): Promise<void> {
    const response = await fetch(`/api/documents/${encodeURIComponent(this.documentId)}`);
    if (!response.ok) return;
    const snapshot = (await response.json()) as Snapshot;
    this.state = stateOfSnapshot(snapshot);
    this.revision = snapshot.revision;
    this.savedRevision = snapshot.savedRevision;
    this.saveFailed = snapshot.saveState === 'failed';
    this.role = snapshot.myAccess.role;
    this.mode = snapshot.myAccess.mode;
    this.emit('doc');
    this.emit('cards');
    this.emit('save');
    this.emit('role');
  }

  sendCaret(at: number, length: number): void {
    if (this.accessEnded !== null || !this.connected) return;
    void this.connection.send({ type: 'caret', at, length }).catch(() => undefined);
  }

  async setMode(mode: Mode): Promise<void> {
    this.mode = mode;
    this.emit('role');
    await this.connection.send({ type: 'mode', mode }).catch(() => undefined);
  }

  async decide(suggestionId: string, decision: Decision): Promise<boolean> {
    const reply = await this.connection.send({ type: 'decide', suggestionId, decision });
    return reply.type === 'ack' && reply.applied === true;
  }

  async decideAll(decision: Decision): Promise<number> {
    const reply = await this.connection.send({ type: 'decide_all', decision });
    return reply.type === 'ack' ? reply.count ?? 0 : 0;
  }

  async replaceAll(find: string, replace: string, matchCase: boolean): Promise<number> {
    const reply = await this.connection.send({
      type: 'replace_all',
      baseRevision: this.revision,
      mode: this.editMode,
      find,
      replace,
      matchCase,
    });
    return reply.type === 'ack' ? reply.count ?? 0 : 0;
  }

  private onFrame(frame: ServerFrame): void {
    switch (frame.type) {
      case 'op':
        this.applyRemote(frame.ops, frame.revision);
        return;
      case 'card_added':
      case 'card_changed':
        this.upsertCard(frame.card);
        this.emit('cards');
        this.emit('doc');
        return;
      case 'card_closed': {
        const suggestion = this.state.suggestions.find((candidate) => candidate.id === frame.cardId);
        if (suggestion) {
          this.lastSettled = { card: suggestion, status: frame.status, decidedBy: frame.decidedBy };
          this.state.suggestions = this.state.suggestions.filter((candidate) => candidate.id !== frame.cardId);
        }
        this.emit('cards');
        this.emit('doc');
        return;
      }
      case 'caret':
        this.carets.set(frame.person.personId, { person: frame.person, at: frame.at, length: frame.length, state: 'active' });
        this.presence.set(frame.person.personId, { person: frame.person, state: 'active' });
        this.emit('presence');
        return;
      case 'presence': {
        if (frame.state === 'left') {
          this.presence.delete(frame.person.personId);
          this.carets.delete(frame.person.personId);
        } else {
          this.presence.set(frame.person.personId, { person: frame.person, state: frame.state });
          const caret = this.carets.get(frame.person.personId);
          if (caret) caret.state = frame.state;
        }
        this.emit('presence');
        return;
      }
      case 'saved':
        this.savedRevision = Math.max(this.savedRevision, frame.revision);
        this.saveFailed = false;
        this.emit('save');
        return;
      case 'save_failed':
        this.saveFailed = true;
        this.emit('save');
        return;
      case 'role_changed':
        this.role = frame.role;
        this.mode = frame.mode;
        this.emit('role');
        return;
      case 'title_changed':
        this.title = frame.title;
        this.client = frame.client;
        this.emit('title');
        return;
      case 'access_ended':
        this.accessEnded = frame.reason;
        this.emit('access');
        return;
      default:
        return;
    }
  }

  private upsertCard(card: Card): void {
    if ('kind' in card) {
      const index = this.state.suggestions.findIndex((candidate) => candidate.id === card.id);
      if (index === -1) this.state.suggestions.push(card);
      else this.state.suggestions[index] = card;
      return;
    }
    const index = this.state.comments.findIndex((candidate) => candidate.id === card.id);
    if (index === -1) this.state.comments.push(card);
    else this.state.comments[index] = card;
  }

  /** Server changes arrive as text primitives and are moved past this screen's unsent edits. */
  private applyRemote(ops: OpEntry[], revision: number): void {
    let moved = ops;
    for (const frame of this.outbox) {
      // A frame already in flight is transformed by the server from its own baseRevision;
      // one still waiting is sent from this screen's new revision, so it moves here.
      if (!frame.sent) {
        const remoteEdits = moved.flatMap((entry) => entryTextEdits(entry, 'editing'));
        frame.entries = rebaseEntries(frame.entries, frame.mode, remoteEdits, false).entries;
      }
      const result = rebaseEntries(moved, 'editing', frame.edits, true);
      moved = result.entries;
      frame.edits = result.against;
    }
    const edits = moved.flatMap((entry) => entryTextEdits(entry, 'editing'));
    applyPrimitives(this.state, moved);
    this.revision = Math.max(this.revision, revision);
    for (const handler of this.remoteEditListeners) handler(edits);
    this.emit('doc');
    this.emit('cards');
    this.emit('save');
  }
}
