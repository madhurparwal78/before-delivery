import type { BlobKind, BlobState } from '../../shared/types.js';
import type { Db } from '../db.js';
import { notFound } from '../http.js';
import { LETTER_COLUMNS, type LetterRow } from './letters.js';

/** The one place participant access is decided. */

export interface ConversationRow {
  id: string;
  peer_a: string;
  peer_b: string;
  starter_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface SideRow {
  conversation_id: string;
  account_id: string;
  accepted: boolean;
  visible: boolean;
  read_seq: string;
  hide_seq: string;
  muted_until: Date | null;
  muted_always: boolean;
}

export interface BlobRow {
  id: string;
  owner_id: string;
  kind: BlobKind;
  size: string;
  state: BlobState;
}

export interface ConversationAccess {
  conversation: ConversationRow;
  side: SideRow;
  peerSide: SideRow;
  peerId: string;
}

export function peerOf(conversation: ConversationRow, accountId: string): string {
  return conversation.peer_a === accountId ? conversation.peer_b : conversation.peer_a;
}

async function loadSides(db: Db, conversationId: string): Promise<SideRow[]> {
  const result = await db.query<SideRow>(
    'select * from conversation_sides where conversation_id = $1',
    [conversationId],
  );
  return result.rows;
}

/** A conversation is visible only to its two participants, and only once it shows for them. */
export async function findConversation(
  db: Db,
  conversationId: string,
  callerId: string,
): Promise<ConversationAccess | null> {
  const result = await db.query<ConversationRow>('select * from conversations where id = $1', [
    conversationId,
  ]);
  const conversation = result.rows[0];
  if (conversation === undefined) return null;
  if (conversation.peer_a !== callerId && conversation.peer_b !== callerId) return null;

  const sides = await loadSides(db, conversationId);
  const peerId = peerOf(conversation, callerId);
  const side = sides.find((row) => row.account_id === callerId);
  const peerSide = sides.find((row) => row.account_id === peerId);
  if (side === undefined || peerSide === undefined || !side.visible) return null;
  return { conversation, side, peerSide, peerId };
}

export async function loadConversation(
  db: Db,
  conversationId: string,
  callerId: string,
): Promise<ConversationAccess> {
  const access = await findConversation(db, conversationId, callerId);
  if (access === null) throw notFound();
  return access;
}

export async function loadLetter(
  db: Db,
  letterId: string,
  callerId: string,
): Promise<LetterRow> {
  const result = await db.query<LetterRow>(
    `select ${LETTER_COLUMNS} from letters where id = $1`,
    [letterId],
  );
  const letter = result.rows[0];
  if (letter === undefined) throw notFound();
  if (letter.sender_id !== callerId && letter.recipient_id !== callerId) throw notFound();
  if (letter.recipient_id === callerId) {
    const { side } = await loadConversation(db, letter.conversation_id, callerId);
    if (letter.dropped || Number(letter.seq) <= Number(side.hide_seq)) throw notFound();
  }
  return letter;
}

export async function loadBlob(db: Db, blobId: string): Promise<BlobRow> {
  const result = await db.query<BlobRow>('select * from blobs where id = $1', [blobId]);
  const blob = result.rows[0];
  if (blob === undefined) throw notFound();
  return blob;
}

/** A blob the caller may download: their own, on a shared letter, or a contact's photo. */
export async function loadReadableBlob(
  db: Db,
  blobId: string,
  callerId: string,
): Promise<BlobRow> {
  const blob = await loadBlob(db, blobId);
  if (blob.owner_id === callerId) return blob;

  if (blob.kind === 'photo') {
    const shared = await db.query(
      `select 1
         from conversation_sides mine
         join conversation_sides theirs on theirs.conversation_id = mine.conversation_id
        where mine.account_id = $1 and theirs.account_id = $2
          and mine.accepted and theirs.accepted`,
      [callerId, blob.owner_id],
    );
    if (shared.rows.length > 0) return blob;
    throw notFound();
  }

  const onLetter = await db.query(
    `select 1 from letters where attachment_id = $1 and (sender_id = $2 or recipient_id = $2)`,
    [blobId, callerId],
  );
  if (onLetter.rows.length > 0) return blob;
  throw notFound();
}
