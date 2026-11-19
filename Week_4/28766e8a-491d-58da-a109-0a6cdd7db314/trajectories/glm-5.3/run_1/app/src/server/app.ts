import type { Document, DocumentOp, Role } from '../shared/model.js';
import type { Db } from './db.js';
import { deepCloneDoc, applyOperation, rerouteDocument, newDocument } from './documents.js';
import { makeId, type IdPrefix } from '../shared/ids.js';
import { notFound, forbiddenRole, unauthenticated } from '../shared/errors.js';
import type { AppConfig } from './config.js';

export interface DiagramState {
  doc: Document;
  saveOutages: Map<string, number>; // diagramId -> until timestamp
}

export interface BroadcastEvent {
  kind: 'operation' | 'presence' | 'cursor' | 'role' | 'comment' | 'version' | 'export' | 'restore' | 'members';
  payload: unknown;
}

type Listener = (event: BroadcastEvent) => void;

export interface OperationAck {
  opId: string;
  seq: number;
  ids: Record<string, string>;
  rerouted: string[];
}

export class App {
  private listeners = new Map<string, Set<Listener>>();
  private saveOutages = new Map<string, number>();

  constructor(
    public config: AppConfig,
    public db: Db,
  ) {}

  newId(prefix: IdPrefix): string {
    return makeId(prefix, Math.random);
  }

  on(diagramId: string, listener: Listener): () => void {
    let set = this.listeners.get(diagramId);
    if (!set) {
      set = new Set();
      this.listeners.set(diagramId, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  broadcast(diagramId: string, event: BroadcastEvent): void {
    const set = this.listeners.get(diagramId);
    if (!set) return;
    for (const listener of set) listener(event);
  }

  outageUntil(diagramId: string): number {
    return this.saveOutages.get(diagramId) ?? 0;
  }

  setOutage(diagramId: string, until: number): void {
    this.saveOutages.set(diagramId, until);
  }

  async saveDocument(doc: Document): Promise<void> {
    await this.db.query(
      `INSERT INTO documents (diagram_id, content) VALUES ($1, $2)
       ON CONFLICT (diagram_id) DO UPDATE SET content = $2`,
      [doc.id, JSON.stringify(doc)]);
    await this.db.query('UPDATE diagrams SET seq = $2, updated_at = now() WHERE id = $1', [doc.id, doc.seq]);
  }

  async loadDocument(diagramId: string): Promise<Document | null> {
    const result = await this.db.query('SELECT content FROM documents WHERE diagram_id = $1', [diagramId]);
    const row = result.rows[0] as { content: Document } | undefined;
    return row ? row.content : null;
  }

  async loadDocumentChecked(
    diagramId: string,
    userId: string | null,
  ): Promise<{ doc: Document; role: Role }> {
    if (!userId) throw unauthenticated();
    const member = await this.db.query(
      'SELECT role FROM members WHERE diagram_id = $1 AND user_id = $2',
      [diagramId, userId]);
    const roleRow = member.rows[0] as { role: Role } | undefined;
    if (!roleRow) throw notFound();
    const doc = await this.loadDocument(diagramId);
    if (!doc) throw notFound();
    return { doc, role: roleRow.role };
  }

  /** Accept an operation, deduplicating by opId; the whole decision is atomic. */
  async acceptOperation(
    diagramId: string,
    userId: string,
    role: Role,
    opId: string,
    op: DocumentOp,
  ): Promise<OperationAck> {
    const existing = await this.db.query(
      `SELECT response FROM operations WHERE diagram_id = $1 AND user_id = $2 AND op_id = $3`,
      [diagramId, userId, opId]);
    const prior = existing.rows[0] as { response: OperationAck } | undefined;
    if (prior) return prior.response;

    const doc = await this.loadDocument(diagramId);
    if (!doc) throw notFound();

    const result = applyOperation(doc, op, { userId, role, now: new Date() }, (prefix) => this.newId(prefix));
    if ('error' in result) {
      const { ApiError } = await import('../shared/errors.js');
      throw new ApiError(409, result.error as never, 'Conflict.');
    }
    doc.seq += 1;
    const ack: OperationAck = {
      opId,
      seq: doc.seq,
      ids: result.ids,
      rerouted: result.rerouted,
    };
    await this.saveDocument(doc);
    await this.db.query(
      `INSERT INTO operations (diagram_id, seq, user_id, op_id, op, response)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [diagramId, doc.seq, userId, opId, JSON.stringify(op), JSON.stringify(ack)]);
    await this.maybeVersionInterval(diagramId, doc.seq, userId);
    this.broadcast(diagramId, { kind: 'operation', payload: { ack, op, userId } });
    return ack;
  }

  async maybeVersionInterval(diagramId: string, seq: number, userId: string): Promise<void> {
    const interval = this.config.versionIntervalMs;
    await this.db.query(
      `INSERT INTO version_timers (diagram_id, author_id, due_at)
       VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)
       ON CONFLICT (diagram_id) DO NOTHING`,
      [diagramId, userId, String(interval)]);
    void seq;
  }

  async applyRestore(doc: Document): Promise<void> {
    const clone = deepCloneDoc(doc);
    rerouteDocument(clone);
    await this.saveDocument(clone);
    void this;
  }

  documentTemplate(id: string, title: string): Document {
    return newDocument(id, title);
  }

  assertCanEdit(role: Role): void {
    if (role === 'viewer') throw forbiddenRole();
  }
}

export function docRoutes(): void {
  // Routes are registered in main.ts; this module holds the App state only.
}
