import { Router } from 'express';
import { query } from '../db.js';
import { errors } from '../errors.js';
import { businessMs } from '../clock.js';
import { wrap, requireSession } from '../http.js';
import { getMemberById, personCard as buildCard } from '../profile.js';
import { connect, withdraw, accept, ignore, removeConnection, block, unblock } from '../connections.js';
import { sendMail } from '../mail.js';

export const connectionsApiRouter = (): Router => {
  const router = Router();
  router.use(['/network', '/connections', '/blocks', '/follows'], requireSession);

  router.get('/network', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const received = await query<{ id: string; requested_at: Date }>(
      `SELECT requester_id AS id, requested_at FROM connections
       WHERE addressee_id = $1 AND state = 'pending' ORDER BY requested_at DESC`, [viewerId]);
    const sent = await query<{ id: string; requested_at: Date }>(
      `SELECT addressee_id AS id, requested_at FROM connections
       WHERE requester_id = $1 AND state = 'pending' ORDER BY requested_at DESC`, [viewerId]);
    const connections = await query<{ id: string; connected_at: Date }>(
      `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS id, connected_at
       FROM connections WHERE state = 'connected' AND ($1 = requester_id OR $1 = addressee_id)
       ORDER BY connected_at DESC NULLS LAST`, [viewerId]);
    const receivedCards = [];
    for (const row of received.rows) {
      const member = await getMemberById(row.id);
      if (member) receivedCards.push(await buildCard(viewerId, member, { requested_at: row.requested_at.toISOString() } as never));
    }
    const sentCards = [];
    for (const row of sent.rows) {
      const member = await getMemberById(row.id);
      if (member) sentCards.push(await buildCard(viewerId, member, { requested_at: row.requested_at.toISOString() } as never));
    }
    const connCards = [];
    for (const row of connections.rows) {
      const member = await getMemberById(row.id);
      if (member) connCards.push(await buildCard(viewerId, member, { connected_at: row.connected_at?.toISOString() ?? null } as never));
    }
    res.json({ received: receivedCards, sent: sentCards, connections: connCards });
  }));

  router.post('/connections', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const { member_id } = (req.body ?? {}) as { member_id?: string };
    if (!member_id) throw errors.validation({ member_id: 'Choose a member.' });
    const other = await getMemberById(member_id);
    if (!other) throw errors.notFound();
    const result = await connect(viewerId, member_id);
    if (result.state === 'pending_sent' && result.status === 201) {
      sendMail(other.email, `${(await currentName(viewerId))} wants to connect on Plainwork`, 'wants to connect');
    }
    if (result.state === 'connected') {
      // Connecting on a received request: the original sender gets the acceptance email.
      const row = await query<{ email: string }>(`SELECT email FROM members WHERE id = $1`, [member_id]);
      const requester = await findOriginalRequester(viewerId, member_id);
      if (row.rows[0] && requester === member_id) {
        sendMail(row.rows[0].email, `${other.name} accepted your invitation`, 'accepted');
      }
    }
    res.status(result.status).json({ state: result.state });
  }));

  router.post('/connections/:member_id/withdraw', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const { retryAt } = await withdraw(viewerId, req.params.member_id);
    res.json({ state: 'withdrawn', retry_at: retryAt.toISOString() });
  }));

  router.post('/connections/:member_id/accept', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    await accept(viewerId, req.params.member_id);
    // Email the original requester that their invitation was accepted.
    const requester = await findOriginalRequester(viewerId, req.params.member_id);
    if (requester) {
      const requesterMember = await getMemberById(requester);
      const accepter = await getMemberById(viewerId);
      if (requesterMember && accepter) {
        sendMail(requesterMember.email, `${accepter.name} accepted your invitation`, 'accepted');
      }
    }
    res.json({ state: 'connected' });
  }));

  router.post('/connections/:member_id/ignore', wrap(async (req, res) => {
    await ignore(req.auth!.memberId, req.params.member_id);
    res.json({ state: 'ignored' });
  }));

  router.delete('/connections/:member_id', wrap(async (req, res) => {
    await removeConnection(req.auth!.memberId, req.params.member_id);
    res.json({ state: 'none' });
  }));

  router.get('/blocks', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const result = await query<{ id: string; name: string; handle: string; at: Date }>(
      `SELECT m.id, m.name, m.handle, b.at FROM blocks b JOIN members m ON m.id = b.blocked_id
       WHERE b.blocker_id = $1 ORDER BY b.at DESC`, [viewerId]);
    res.json({ blocked: result.rows.map((r) => ({ id: r.id, name: r.name, handle: r.handle, blocked_at: r.at.toISOString() })) });
  }));

  router.post('/blocks', wrap(async (req, res) => {
    const { member_id } = (req.body ?? {}) as { member_id?: string };
    if (!member_id) throw errors.validation({ member_id: 'Choose a member.' });
    const existing = await query(`SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`,
      [req.auth!.memberId, member_id]);
    await block(req.auth!.memberId, member_id);
    res.status(existing.rows.length > 0 ? 200 : 201).json({ blocked: true });
  }));

  router.delete('/blocks/:member_id', wrap(async (req, res) => {
    await unblock(req.auth!.memberId, req.params.member_id);
    res.json({ blocked: false });
  }));

  router.post('/follows', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const { target_id } = (req.body ?? {}) as { target_id?: string };
    if (!target_id) throw errors.validation({ target_id: 'Choose a target.' });
    if (target_id === viewerId) throw errors.validation({ target_id: "You can't follow yourself." });
    const isMember = await query(`SELECT 1 FROM members WHERE id = $1`, [target_id]);
    const isCompany = await query(`SELECT 1 FROM companies WHERE id = $1`, [target_id]);
    if (isMember.rows.length === 0 && isCompany.rows.length === 0) throw errors.notFound();
    if (isMember.rows.length > 0) {
      const target = await getMemberById(target_id);
      if (!target || !(await visibleMember(viewerId, target))) throw errors.notFound();
    }
    const existing = await query(`SELECT 1 FROM follows WHERE follower_id = $1 AND target_id = $2`, [viewerId, target_id]);
    await query(
      `INSERT INTO follows (follower_id, target_id, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [viewerId, target_id, new Date(businessMs())]);
    res.status(existing.rows.length > 0 ? 200 : 201).json({ following: true });
  }));

  router.delete('/follows/:target_id', wrap(async (req, res) => {
    await query(`DELETE FROM follows WHERE follower_id = $1 AND target_id = $2`,
      [req.auth!.memberId, req.params.target_id]);
    res.json({ following: false });
  }));

  return router;
};

const visibleMember = async (viewerId: string, member: NonNullable<Awaited<ReturnType<typeof getMemberById>>>): Promise<boolean> => {
  if (member.visibility === 'private') {
    const { findPair, stateBetween } = await import('../connections.js');
    const row = await findPair(viewerId, member.id);
    return stateBetween(viewerId, row, false) === 'connected';
  }
  const { blockedWith } = await import('../graph.js');
  const blocked = await blockedWith(viewerId);
  return !blocked.has(member.id);
};

const currentName = async (memberId: string): Promise<string> => {
  const result = await query<{ name: string }>(`SELECT name FROM members WHERE id = $1`, [memberId]);
  return result.rows[0]?.name ?? '';
};

const findOriginalRequester = async (accepterId: string, requesterId: string): Promise<string | null> => {
  const result = await query(
    `SELECT requester_id FROM connections WHERE requester_id = $1 AND addressee_id = $2 AND state = 'connected'`,
    [requesterId, accepterId]);
  return result.rows.length > 0 ? requesterId : null;
};
