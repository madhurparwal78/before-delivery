import { now } from '../clock.js';
import { maybeRow, oneRow, type Db, type Tx, publishAfterCommit } from '../db.js';
import { forbidden, notFound } from '../errors.js';
import { notify } from './notify.js';
import { listedSkill } from './skills.js';
import { connectedWith, memberVisibleTo, notBlockedWith } from './visibility.js';

interface EndorsementState {
  skill: string;
  endorsements: number;
  endorsed_by_me: boolean;
}

/** Checks, in the published order: the member is visible (404), lists the skill (404), is not the endorser (403), is a connection (403). */
async function endorsableSkill(db: Db, endorserId: string, ownerId: string, skillName: string): Promise<{ name: string; skill_key: string }> {
  const owner = await maybeRow(db, `SELECT 1 FROM members m WHERE m.id = $2 AND m.confirmed AND ${memberVisibleTo('$1', 'm')}`, [endorserId, ownerId]);
  if (!owner) throw notFound();
  const skill = await listedSkill(db, ownerId, skillName);
  if (endorserId === ownerId) throw forbidden('own_profile');
  const { connected } = await oneRow<{ connected: boolean }>(db, `SELECT ${connectedWith('$1', '$2')} AS connected`, [endorserId, ownerId]);
  if (!connected) throw forbidden('not_connected');
  return skill;
}

async function stateOf(db: Db, viewerId: string, ownerId: string, skill: { name: string; skill_key: string }): Promise<EndorsementState> {
  const counts = await oneRow<{ endorsements: number; mine: boolean }>(
    db,
    `SELECT count(*) AS endorsements, coalesce(bool_or(e.endorser_id = $1), false) AS mine
       FROM endorsements e WHERE e.owner_id = $2 AND e.skill_key = $3 AND ${notBlockedWith('$1', 'e.endorser_id')}`,
    [viewerId, ownerId, skill.skill_key],
  );
  return { skill: skill.name, endorsements: counts.endorsements, endorsed_by_me: counts.mine };
}

export async function endorse(tx: Tx, endorserId: string, ownerId: string, skillName: string): Promise<EndorsementState> {
  const skill = await endorsableSkill(tx, endorserId, ownerId, skillName);
  const added = await tx.query(
    'INSERT INTO endorsements (owner_id, skill_key, endorser_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [ownerId, skill.skill_key, endorserId, now()],
  );
  if (added.rowCount) {
    await notify(tx, { memberId: ownerId, kind: 'endorsement', actorId: endorserId, detail: skill.name });
    publishAfterCommit(tx, 'all', { type: 'skills', member_id: ownerId });
  }
  return stateOf(tx, endorserId, ownerId, skill);
}

export async function withdrawEndorsement(tx: Tx, endorserId: string, ownerId: string, skillName: string): Promise<EndorsementState> {
  const skill = await endorsableSkill(tx, endorserId, ownerId, skillName);
  const removed = await tx.query('DELETE FROM endorsements WHERE owner_id = $1 AND skill_key = $2 AND endorser_id = $3', [ownerId, skill.skill_key, endorserId]);
  if (removed.rowCount) {
    await tx.query(`DELETE FROM notifications WHERE member_id = $1 AND kind = 'endorsement' AND actor_id = $2 AND detail = $3`, [ownerId, endorserId, skill.name]);
    publishAfterCommit(tx, [ownerId], { type: 'notification' });
    publishAfterCommit(tx, 'all', { type: 'skills', member_id: ownerId });
  }
  return stateOf(tx, endorserId, ownerId, skill);
}
