import type { Conversation, Letter } from '../shared/types.js';
import { now } from './clock.js';
import { query, type Queryable } from './db.js';
import { iso, letterRecord } from './records.js';
import type { LetterRow } from './rows.js';
import { encodeBase64url } from './validate.js';

/** A letter its recipient never receives (posted while blocked) is invisible to that recipient. */
export const visibleTo = (alias: string, viewer: string): string =>
  `NOT (${alias}.recipient_id = ${viewer} AND ${alias}.state = 'sent' AND ${alias}.ciphertext IS NULL AND ${alias}.retracted_at IS NULL)`;

/** The one place the unread count is decided: delivered or read letters to the viewer above their read marker, not retracted. */
const UNREAD_SQL = `
  SELECT count(*) FROM letters u
  WHERE u.conversation_id = c.id AND u.recipient_id = cm.account_id AND u.class = 'letter'
    AND u.state IN ('delivered', 'read') AND u.seq > cm.read_through_seq AND u.seq >= cm.visible_from_seq
    AND u.retracted_at IS NULL`;

const RECORD_SELECT = `
  SELECT c.id, c.updated_at, cm.status, cm.muted_until, cm.muted_always, pm.status AS peer_status,
         p.id AS peer_id, p.username AS peer_username, p.key_id AS peer_key_id, p.public_key AS peer_public_key,
         p.profile_iv, p.profile_ciphertext, p.profile_photo_blob_id,
         s.accepted_key_id, s.verified,
         EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = cm.account_id AND b.blocked_id = p.id) AS blocked,
         (${UNREAD_SQL}) AS unread,
         (SELECT max(l.seq) FROM letters l WHERE l.conversation_id = c.id AND l.class = 'letter' AND l.seq >= cm.visible_from_seq AND ${visibleTo('l', 'cm.account_id')}) AS last_seq
  FROM conversation_members cm
  JOIN conversations c ON c.id = cm.conversation_id
  JOIN conversation_members pm ON pm.conversation_id = c.id AND pm.account_id <> cm.account_id
  JOIN accounts p ON p.id = pm.account_id
  LEFT JOIN seals s ON s.viewer_id = cm.account_id AND s.contact_id = p.id`;

interface RecordRow {
  id: string;
  updated_at: Date;
  status: 'accepted' | 'request';
  muted_until: Date | null;
  muted_always: boolean;
  peer_status: string;
  peer_id: string;
  peer_username: string;
  peer_key_id: string;
  peer_public_key: Buffer;
  profile_iv: Buffer | null;
  profile_ciphertext: Buffer | null;
  profile_photo_blob_id: string | null;
  accepted_key_id: string | null;
  verified: boolean | null;
  blocked: boolean;
  unread: number;
  last_seq: number | null;
}

async function records(db: Queryable, viewerId: string, where: string, values: unknown[]): Promise<Conversation[]> {
  const at = now();
  const rows = await query<RecordRow>(
    db,
    `${RECORD_SELECT} WHERE cm.account_id = $1 AND cm.status IN ('accepted', 'request') ${where} ORDER BY c.updated_at DESC, c.id`,
    [viewerId, ...values],
  );
  const lastSeqs = rows.map((row) => row.last_seq).filter((seq): seq is number => seq !== null);
  const lastLetters = new Map<number, LetterRow>();
  if (lastSeqs.length > 0) {
    for (const letter of await query<LetterRow>(db, 'SELECT * FROM letters WHERE seq = ANY($1)', [lastSeqs])) lastLetters.set(letter.seq, letter);
  }
  return rows.map((row): Conversation => {
    const shared = row.status === 'accepted' && row.peer_status === 'accepted';
    const lastRow = row.last_seq === null ? undefined : lastLetters.get(row.last_seq);
    const last: Letter | null = lastRow ? letterRecord(lastRow, viewerId, at) : null;
    const changed = row.accepted_key_id !== null && row.accepted_key_id !== row.peer_key_id;
    return {
      id: row.id,
      status: row.status,
      peer: {
        id: row.peer_id,
        username: row.peer_username,
        key_id: row.peer_key_id,
        public_key: encodeBase64url(row.peer_public_key),
        seal: changed ? 'changed' : row.verified ? 'verified' : 'unverified',
        profile:
          shared && row.profile_iv && row.profile_ciphertext
            ? { iv: encodeBase64url(row.profile_iv), ciphertext: encodeBase64url(row.profile_ciphertext), photo_blob_id: row.profile_photo_blob_id }
            : null,
      },
      unread: row.unread,
      muted_until: row.muted_always ? 'always' : row.muted_until && row.muted_until.getTime() > at.getTime() ? iso(row.muted_until) : null,
      blocked: row.blocked,
      last_letter: last,
      updated_at: iso(row.updated_at),
    };
  });
}

export const conversationsFor = (db: Queryable, viewerId: string, status: 'accepted' | 'request'): Promise<Conversation[]> =>
  records(db, viewerId, 'AND cm.status = $2', [status]);

export async function conversationRecord(db: Queryable, viewerId: string, conversationId: string): Promise<Conversation | null> {
  return (await records(db, viewerId, 'AND c.id = $2', [conversationId]))[0] ?? null;
}
