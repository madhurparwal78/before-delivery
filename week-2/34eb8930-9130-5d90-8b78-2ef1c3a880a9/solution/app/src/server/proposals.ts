import { newId, one, pool, rows, transaction } from "./db.js";
import { check, conflict, forbidden, notFound, storageUnavailable } from "./errors.js";
import { listsChanged, send, socketsOf, toPerson } from "./hub.js";
import {
  type Access, type PersonRow, activeShare, peopleWithAccess, personById, personByEmail, personObject, personOn, requireAccess, rolesOn, storedMode,
} from "./people.js";
import { broadcast, commentCards, forget, getRoom, iso, openRoom, presenceFrame, resumeSaving, roomIfLoaded, saveStateOf, serial, stopSaving, suggestionCard } from "./rooms.js";
import { StorageError, deleteObject, objectKey } from "./storage.js";
import { blocksOf } from "../shared/model.js";
import {
  ROLE_LABEL, SHARE_ROLES, canComment, isOwner,
  type Comment, type ProposalSummary, type EndReason, type Mode, type Notice, type NoticeKind, type OwnerShare, type Role,
  type ShareEntry, type ShareRole, type ShareStatus, type Snapshot,
} from "../shared/types.js";

type Body = Record<string, unknown>;

const DAY_MS = 86400000;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

// ---- Documents

interface ProposalRow { id: string; title: string; client: string; owner_id: string; updated_at: Date; role: Role }

async function summary(r: ProposalRow): Promise<ProposalSummary> {
  return { id: r.id, title: r.title, client: r.client, role: r.role, updatedAt: iso(r.updated_at), owner: personObject(await personById(r.owner_id), "owner") };
}

export type ListView = "recent" | "mine" | "shared" | "all";

export async function listProposals(personId: string, view: ListView, q: string): Promise<ProposalSummary[]> {
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const filters = { all: "", mine: "AND v.role = 'owner'", shared: "AND v.role <> 'owner'", recent: "AND r.joined_at IS NOT NULL" }[view];
  const order = view === "recent" ? "r.joined_at DESC LIMIT 10" : "v.updated_at DESC, v.id";
  const list = await rows<ProposalRow>(
    `WITH v AS (
       SELECT d.id, d.title, d.client, d.owner_id, d.updated_at, 'owner' AS role FROM proposals d WHERE d.owner_id = $1
       UNION ALL
       SELECT d.id, d.title, d.client, d.owner_id, d.updated_at, s.role FROM proposals d
         JOIN shares s ON s.proposal_id = d.id AND s.person_id = $1 AND ${activeShare(2)})
     SELECT v.* FROM v LEFT JOIN recent r ON r.proposal_id = v.id AND r.person_id = $1
      WHERE (v.title ILIKE $3 OR v.client ILIKE $3) ${filters}
      ORDER BY ${order}`, [personId, new Date(), like]);
  return Promise.all(list.map(summary));
}

function proposalFields(body: Body, partial: boolean): { title?: string; client?: string } {
  const fields: Record<string, string> = {};
  const out: { title?: string; client?: string } = {};
  if (!partial || "title" in body) {
    const t = str(body.title)?.trim() ?? "";
    if (t.length < 1 || t.length > 120) fields.title = "Enter a title of 1 to 120 characters.";
    else out.title = t;
  }
  if (!partial || "client" in body) {
    const c = str(body.client)?.trim() ?? "";
    if (c.length < 1 || c.length > 80) fields.client = "Enter a client name of 1 to 80 characters.";
    else out.client = c;
  }
  check(fields);
  return out;
}

export async function createProposal(person: PersonRow, body: Body): Promise<ProposalSummary> {
  if (!person.is_consultant) throw forbidden();
  const { title, client } = proposalFields(body, false);
  const id = newId();
  const row = await one<ProposalRow>(
    "INSERT INTO proposals (id, title, client, owner_id, revision, saved_revision) VALUES ($1,$2,$3,$4,0,0) RETURNING id, title, client, owner_id, updated_at, 'owner' AS role",
    [id, title, client, person.id]);
  listsChanged([person.id]);
  return summary(row as ProposalRow);
}

async function ownerOnly(personId: string, proposalId: string): Promise<Access> {
  const access = await requireAccess(personId, proposalId);
  if (!isOwner(access.role)) throw forbidden();
  return access;
}

async function audience(proposalId: string): Promise<string[]> {
  return (await peopleWithAccess(proposalId)).map((p) => p.personId);
}

export async function renameProposal(personId: string, proposalId: string, body: Body): Promise<ProposalSummary> {
  await ownerOnly(personId, proposalId);
  const patch = proposalFields(body, true);
  const row = await one<ProposalRow>(
    `UPDATE proposals SET title = COALESCE($2, title), client = COALESCE($3, client), updated_at = now() WHERE id = $1
     RETURNING id, title, client, owner_id, updated_at, 'owner' AS role`, [proposalId, patch.title ?? null, patch.client ?? null]);
  const loaded = roomIfLoaded(proposalId);
  const room = loaded ? await loaded.catch(() => null) : null;
  if (room && row) broadcast(room, { type: "title_changed", title: row.title, client: row.client });
  listsChanged(await audience(proposalId));
  return summary(row as ProposalRow);
}

/** Access ends at once (Removal and deletion): the person's open tabs get `access_ended`, then close. */
function endAccess(proposalId: string, personId: string, reason: EndReason): void {
  for (const c of socketsOf(personId)) {
    if (c.documentId !== proposalId || c.ended) continue;
    c.ended = true;
    send(c, { type: "access_ended", reason });
    c.ws.close(1000);
  }
}

export async function deleteProposal(personId: string, proposalId: string): Promise<void> {
  await ownerOnly(personId, proposalId);
  const people = await audience(proposalId);
  const loaded = roomIfLoaded(proposalId);
  const room = loaded ? await loaded.catch(() => null) : null;
  const remove = async (): Promise<void> => {
    if (room) await stopSaving(room);
    try {
      await deleteObject(objectKey(proposalId));
    } catch (e) {
      if (room) resumeSaving(room);
      if (e instanceof StorageError) throw storageUnavailable();
      throw e;
    }
    await pool.query("DELETE FROM proposals WHERE id = $1", [proposalId]);
    if (room) forget(room);
    for (const id of people) endAccess(proposalId, id, "deleted");
    listsChanged(people);
  };
  await (room ? serial(room, remove) : remove());
}

// ---- Snapshot

export async function snapshot(personId: string, proposalId: string): Promise<Snapshot> {
  const access = await requireAccess(personId, proposalId);
  const room = await openRoom(proposalId);
  const proposal = await one<{ title: string; client: string }>("SELECT title, client FROM proposals WHERE id = $1", [proposalId]);
  if (!proposal) throw notFound();
  const roles = await rolesOn(proposalId);
  return {
    id: proposalId, title: proposal.title, client: proposal.client, revision: room.revision, savedRevision: room.savedRevision, saveState: saveStateOf(room),
    myAccess: { role: access.role, mode: await storedMode(proposalId, personId, access.role), accessEndsAt: access.accessEndsAt && iso(access.accessEndsAt) },
    text: room.proposal.text, blocks: blocksOf(room.proposal), marks: room.proposal.marks,
    suggestions: await Promise.all(room.proposal.spans.map((s) => suggestionCard(s, roles))),
    comments: await commentCards(room, roles),
    people: await peopleWithAccess(proposalId),
  };
}

// ---- Shares (Business rules, Shares; Role changes take effect at once)

interface ShareRow { id: string; person_id: string; role: ShareRole; ends_at: Date | null; status: ShareStatus }

/** Share columns over alias `s`; `status` reads the expiry rule at the server's time in parameter `$n`. */
const shareColumns = (n: number): string => `s.id, s.person_id, s.role, s.ends_at, CASE WHEN ${activeShare(n)} THEN 'active' ELSE 'expired' END AS status`;

async function ownerShare(s: ShareRow): Promise<OwnerShare> {
  const p = await personById(s.person_id);
  return { shareId: s.id, person: personObject(p, s.role), email: p.email, role: s.role, endsAt: s.ends_at && iso(s.ends_at), status: s.status };
}

export async function listShares(personId: string, proposalId: string): Promise<ShareEntry[]> {
  const access = await requireAccess(personId, proposalId);
  const proposal = await one<{ owner_id: string }>("SELECT owner_id FROM proposals WHERE id = $1", [proposalId]);
  const owner = { person: personObject(await personById(proposal?.owner_id ?? ""), "owner") };
  const list = await rows<ShareRow>(`SELECT ${shareColumns(2)} FROM shares s WHERE s.proposal_id = $1 ORDER BY s.created_at, s.id`, [proposalId, new Date()]);
  if (isOwner(access.role)) return [owner, ...(await Promise.all(list.map(ownerShare)))];
  return [owner, ...(await Promise.all(list.filter((s) => s.status === "active").map(async (s) => ({ person: personObject(await personById(s.person_id), s.role) }))))];
}

function endsAtField(v: unknown, fields: Record<string, string>): Date | null | undefined {
  if (v === null) return null;
  const when = typeof v === "string" ? new Date(v) : null;
  if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) { fields.endsAt = "Pick an end time in the future."; return undefined; }
  if (when.getTime() > Date.now() + 365 * DAY_MS) { fields.endsAt = "Pick an end time within a year."; return undefined; }
  return when;
}

function roleField(v: unknown, fields: Record<string, string>): ShareRole | undefined {
  if (SHARE_ROLES.includes(v as ShareRole)) return v as ShareRole;
  fields.role = "Choose Editor, Commenter or Viewer.";
  return undefined;
}

async function noticeObject(r: NoticeRow): Promise<Notice> {
  const roles = await rolesOn(r.proposal_id);
  const n: Notice = {
    id: r.id, kind: r.kind, documentId: r.proposal_id, documentTitle: r.title, actor: await personOn(r.actor_id, roles),
    text: r.text, read: r.read, createdAt: iso(r.created_at),
  };
  if (r.role) n.role = r.role;
  if (r.comment_id) n.commentId = r.comment_id;
  return n;
}

interface NoticeRow { id: string; kind: NoticeKind; proposal_id: string; title: string; actor_id: string; role: Role | null; comment_id: string | null; text: string; read: boolean; created_at: Date }

/** In-app notices (Business rules, Mentions and notices); they reach the person's open sockets at once. */
async function addNotice(personId: string, proposalId: string, kind: NoticeKind, actorId: string, text: string, extra: { role?: Role; commentId?: string }): Promise<void> {
  const id = newId();
  await pool.query("INSERT INTO notices (id, person_id, proposal_id, kind, actor_id, role, comment_id, text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [id, personId, proposalId, kind, actorId, extra.role ?? null, extra.commentId ?? null, text]);
  const row = await one<NoticeRow>(NOTICE_SELECT + " AND n.id = $3", [personId, new Date(), id]);
  if (row) toPerson(personId, { type: "notice", notice: await noticeObject(row) });
}

const NOTICE_SELECT = `SELECT n.id, n.kind, n.proposal_id, d.title, n.actor_id, n.role, n.comment_id, n.text, n.read, n.created_at
  FROM notices n JOIN proposals d ON d.id = n.proposal_id
  LEFT JOIN shares s ON s.proposal_id = d.id AND s.person_id = n.person_id
 WHERE n.person_id = $1 AND (d.owner_id = $1 OR (${activeShare(2)}))`;

export async function listNotices(personId: string): Promise<{ unread: number; notices: Notice[] }> {
  const list = await rows<NoticeRow>(NOTICE_SELECT + " ORDER BY n.created_at DESC, n.id LIMIT 50", [personId, new Date()]);
  const unread = await one<{ n: number }>(`SELECT count(*)::int AS n FROM (${NOTICE_SELECT} AND NOT n.read) q`, [personId, new Date()]);
  return { unread: unread?.n ?? 0, notices: await Promise.all(list.map(noticeObject)) };
}

export async function readNotice(personId: string, noticeId: string): Promise<Notice> {
  const row = await one<NoticeRow>(NOTICE_SELECT + " AND n.id = $3", [personId, new Date(), noticeId]);
  if (!row) throw notFound();
  await pool.query("UPDATE notices SET read = true WHERE id = $1", [noticeId]);
  return noticeObject({ ...row, read: true });
}

export async function createShare(ownerId: string, proposalId: string, body: Body): Promise<OwnerShare> {
  await ownerOnly(ownerId, proposalId);
  const fields: Record<string, string> = {};
  const grantee = await personByEmail(str(body.email)?.trim() ?? "");
  if (grantee && grantee.id !== ownerId) {
    const existing = await one<ShareRow>(`SELECT ${shareColumns(3)} FROM shares s WHERE s.proposal_id = $1 AND s.person_id = $2`, [proposalId, grantee.id, new Date()]);
    if (existing?.status === "active") throw conflict("already_shared");
  }
  if (!grantee) fields.email = "No Quillmere account uses this email.";
  else if (grantee.id === ownerId) fields.email = "You already own this proposal.";
  const role = roleField(body.role, fields);
  const endsAt = endsAtField(body.endsAt ?? null, fields);
  check(fields);
  const person = grantee as PersonRow;
  const share = await transaction(async (c) => {
    const cleared = await c.query(`DELETE FROM shares s WHERE s.proposal_id = $1 AND s.person_id = $2 AND NOT (${activeShare(3)})`, [proposalId, person.id, new Date()]);
    if (cleared.rowCount) await c.query("DELETE FROM modes WHERE proposal_id = $1 AND person_id = $2", [proposalId, person.id]);
    return one<ShareRow>(`INSERT INTO shares AS s (id, proposal_id, person_id, role, ends_at, status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING ${shareColumns(6)}`,
      [newId(), proposalId, person.id, role, endsAt ?? null, new Date()], c);
  }).catch((e: unknown) => {
    if ((e as { code?: string }).code === "23505") throw conflict("already_shared");
    throw e;
  });
  const actor = await personById(ownerId);
  const title = (await one<{ title: string }>("SELECT title FROM proposals WHERE id = $1", [proposalId]))?.title ?? "";
  await addNotice(person.id, proposalId, "shared", ownerId, `${actor.display_name} shared ${title} with you as ${ROLE_LABEL[role as ShareRole]}`, { role });
  listsChanged([person.id]);
  return ownerShare(share as ShareRow);
}

/** Stored mode after a role change: downgrades move the mode, upgrades keep it. */
function modeAfter(mode: Mode, role: ShareRole): Mode {
  if (role === "viewer") return "viewing";
  if (role === "commenter" && mode === "editing") return "suggesting";
  return mode;
}

export async function updateShare(callerId: string, proposalId: string, shareId: string, body: Body): Promise<OwnerShare> {
  await requireAccess(callerId, proposalId);
  const share = await one<ShareRow>(`SELECT ${shareColumns(3)} FROM shares s WHERE s.id = $1 AND s.proposal_id = $2`, [shareId, proposalId, new Date()]);
  if (!share) throw notFound();
  await ownerOnly(callerId, proposalId);
  if (share.status === "expired") throw conflict("share_ended");
  const fields: Record<string, string> = {};
  const role = "role" in body ? roleField(body.role, fields) : share.role;
  const endsAt = "endsAt" in body ? endsAtField(body.endsAt, fields) : share.ends_at;
  check(fields);
  const nextRole = role as ShareRole;
  const roleChanged = nextRole !== share.role;
  let mode: Mode | null = null;
  if (roleChanged) {
    mode = modeAfter(await storedMode(proposalId, share.person_id, share.role), nextRole);
  }
  const updated = await transaction(async (c) => {
    if (mode) {
      await c.query("INSERT INTO modes (proposal_id, person_id, mode) VALUES ($1,$2,$3) ON CONFLICT (proposal_id, person_id) DO UPDATE SET mode = $3",
        [proposalId, share.person_id, mode]);
    }
    const row = await one<ShareRow>(`UPDATE shares s SET role = $2, ends_at = $3 WHERE s.id = $1 AND ${activeShare(4)} RETURNING ${shareColumns(4)}`,
      [shareId, nextRole, endsAt ?? null, new Date()], c);
    if (!row) throw conflict("share_ended");
    return row;
  });
  if (roleChanged && mode) {
    for (const c of socketsOf(share.person_id)) if (c.documentId === proposalId) send(c, { type: "role_changed", role: nextRole, mode });
    const loaded = roomIfLoaded(proposalId);
    const room = loaded ? await loaded.catch(() => null) : null;
    if (room?.presence.has(share.person_id)) {
      broadcast(room, await presenceFrame(room, share.person_id, room.presence.get(share.person_id)?.state ?? "active"));
    }
    const title = (await one<{ title: string }>("SELECT title FROM proposals WHERE id = $1", [proposalId]))?.title ?? "";
    await addNotice(share.person_id, proposalId, "role_changed", callerId, `Your access to ${title} changed to ${ROLE_LABEL[nextRole]}`, { role: nextRole });
    listsChanged([share.person_id]);
  }
  return ownerShare(updated);
}

export async function removeShare(callerId: string, proposalId: string, shareId: string): Promise<void> {
  await requireAccess(callerId, proposalId);
  const share = await one<{ person_id: string }>("SELECT person_id FROM shares WHERE id = $1 AND proposal_id = $2", [shareId, proposalId]);
  if (!share) throw notFound();
  await ownerOnly(callerId, proposalId);
  await pool.query("DELETE FROM shares WHERE id = $1", [shareId]);
  endAccess(proposalId, share.person_id, "removed");
  listsChanged([share.person_id]);
}

/** Share expiry (Time rules): at the end time on the server's clock the share becomes expired. */
export async function expirySweep(): Promise<void> {
  const list = await rows<{ proposal_id: string; person_id: string }>(
    `UPDATE shares s SET status = 'expired' WHERE s.status = 'active' AND NOT (${activeShare(1)}) RETURNING s.proposal_id, s.person_id`, [new Date()]);
  for (const s of list) {
    endAccess(s.proposal_id, s.person_id, "expired");
    listsChanged([s.person_id]);
  }
}

// ---- People picker

export async function pickPeople(personId: string, proposalId: string, q: string): Promise<ReturnType<typeof peopleWithAccess>> {
  await requireAccess(personId, proposalId);
  const needle = q.toLowerCase();
  return (await peopleWithAccess(proposalId)).filter((p) => p.displayName.toLowerCase().includes(needle));
}

// ---- Comments (Business rules, Comments; API, Comment validation)

export async function createComment(personId: string, proposalId: string, body: Body): Promise<Comment> {
  const access = await requireAccess(personId, proposalId);
  const parentId = body.parentId === undefined || body.parentId === null ? null : str(body.parentId) ?? "";
  if (parentId !== null) {
    const parent = await one<{ id: string }>("SELECT id FROM comments WHERE id = $1 AND proposal_id = $2 AND parent_id IS NULL", [parentId, proposalId]);
    if (!parent) throw notFound();
  }
  if (!canComment(access.role)) throw forbidden();
  const room = await getRoom(proposalId);
  return serial(room, async () => {
    const fields: Record<string, string> = {};
    const text = str(body.body)?.trim() ?? "";
    if (text.length < 1 || text.length > 2000) fields.body = "Write a comment of 1 to 2,000 characters.";
    const anchor = body.anchor as { at?: unknown; length?: unknown } | undefined;
    const at = anchor && typeof anchor === "object" ? anchor.at : undefined;
    const length = anchor && typeof anchor === "object" ? anchor.length : undefined;
    if (parentId === null && !(Number.isInteger(at) && Number.isInteger(length) && (length as number) >= 1 && (at as number) >= 0
      && (at as number) + (length as number) <= room.proposal.text.length)) fields.anchor = "Select the text this comment is about.";
    const allowed = new Set(await audience(proposalId));
    const mentions = Array.isArray(body.mentions) ? body.mentions : body.mentions === undefined ? [] : null;
    if (!mentions || !mentions.every((m) => typeof m === "string" && allowed.has(m))) fields.mentions = "Only people with access to this proposal can be mentioned.";
    check(fields);
    const mentioned = [...new Set(mentions as string[])];
    const id = newId();
    await pool.query("INSERT INTO comments (id, proposal_id, parent_id, author_id, body, mentions, anchor, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'open')",
      [id, proposalId, parentId, personId, text, JSON.stringify(mentioned), parentId ? null : JSON.stringify({ at, length })]);
    if (!parentId) room.proposal.anchors.push({ id, range: { at: at as number, length: length as number } });
    const roles = await rolesOn(proposalId);
    const [card] = await commentCards(room, roles, parentId ?? id);
    broadcast(room, { type: parentId ? "card_changed" : "card_added", card });
    const actor = await personById(personId);
    const title = (await one<{ title: string }>("SELECT title FROM proposals WHERE id = $1", [proposalId]))?.title ?? "";
    for (const m of mentioned) {
      if (m !== personId) await addNotice(m, proposalId, "mention", personId, `${actor.display_name} mentioned you in ${title}`, { commentId: parentId ?? id });
    }
    return card;
  });
}

export async function setCommentStatus(personId: string, proposalId: string, commentId: string, to: "resolved" | "reopened"): Promise<Comment> {
  const access = await requireAccess(personId, proposalId);
  const exists = await one<{ id: string }>("SELECT id FROM comments WHERE id = $1 AND proposal_id = $2 AND parent_id IS NULL", [commentId, proposalId]);
  if (!exists) throw notFound();
  if (!canComment(access.role)) throw forbidden();
  const from = to === "resolved" ? ["open", "reopened"] : ["resolved"];
  const moved = await one<{ id: string }>("UPDATE comments SET status = $2 WHERE id = $1 AND status = ANY($3) RETURNING id", [commentId, to, from]);
  if (!moved) throw conflict(to === "resolved" ? "not_open" : "not_resolved");
  const room = await getRoom(proposalId);
  const [card] = await commentCards(room, await rolesOn(proposalId), commentId);
  broadcast(room, { type: "card_changed", card });
  return card;
}
