import { Router } from 'express';
import { query } from '../db.js';
import { businessMs } from '../clock.js';
import { errors, newId } from '../errors.js';
import { wrap, requireSession } from '../http.js';
import { pushTo } from '../live.js';
import { connectionStateFor, getMemberById } from '../domain/profile-shared.js';
import { skillsFor } from '../profile.js';

const endorse = async (viewerId: string, ownerId: string, skillName: string, on: boolean): Promise<void> => {
  const skill = await query<{ id: string; name: string }>(
    `SELECT id, name FROM skills WHERE member_id = $1 AND lower(name) = lower($2)`, [ownerId, skillName]);
  if (skill.rows.length === 0) throw errors.notFound();
  const skillId = skill.rows[0].id;
  if (on) {
    await query(
      `INSERT INTO endorsements (owner_id, skill_id, endorser_id, at) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`, [ownerId, skillId, viewerId, new Date(businessMs())]);
    const notification = await query(`SELECT id FROM notifications WHERE member_id = $1 AND kind = 'endorsement' AND skill_id = $2 AND actor_id = $3`,
      [ownerId, skillId, viewerId]);
    if (notification.rows.length === 0) {
      await query(
        `INSERT INTO notifications (id, member_id, kind, skill_id, actor_id, count, created_at, updated_at)
         VALUES ($1, $2, 'endorsement', $3, $4, 1, $5, $5)`,
        [newId(), ownerId, skillId, viewerId, new Date(businessMs())]);
      pushTo(ownerId, 'notification', { kind: 'endorsement' });
    }
  } else {
    await query(`DELETE FROM endorsements WHERE owner_id = $1 AND skill_id = $2 AND endorser_id = $3`,
      [ownerId, skillId, viewerId]);
  }
  pushTo(ownerId, 'profile_update', { member_id: viewerId });
};

export const endorsementsRouter = (): Router => {
  const router = Router();
  router.use('/members', requireSession);

  const requireFirstDegree = async (viewerId: string, ownerId: string): Promise<void> => {
    if (viewerId === ownerId) throw errors.ownProfile();
    const other = await getMemberById(ownerId);
    if (!other) throw errors.notFound();
    const state = await connectionStateFor(viewerId, ownerId);
    if (state !== 'connected') throw errors.notConnected();
  };

  router.put('/members/:member_id/skills/:skill/endorsement', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const ownerId = req.params.member_id;
    await requireFirstDegree(viewerId, ownerId);
    await endorse(viewerId, ownerId, decodeURIComponent(req.params.skill), true);
    const list = await skillsFor(ownerId, viewerId);
    const row = list.find((s) => s.name.toLowerCase() === decodeURIComponent(req.params.skill).toLowerCase());
    res.json({ skill: row?.name, endorsements: row?.endorsements ?? 0, endorsed_by_me: true });
  }));

  router.delete('/members/:member_id/skills/:skill/endorsement', wrap(async (req, res) => {
    const viewerId = req.auth!.memberId;
    const ownerId = req.params.member_id;
    await requireFirstDegree(viewerId, ownerId);
    await endorse(viewerId, ownerId, decodeURIComponent(req.params.skill), false);
    const list = await skillsFor(ownerId, viewerId);
    const row = list.find((s) => s.name.toLowerCase() === decodeURIComponent(req.params.skill).toLowerCase());
    res.json({ skill: row?.name, endorsements: row?.endorsements ?? 0, endorsed_by_me: false });
  }));

  return router;
};
