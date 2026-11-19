import { pool, withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { AppError, FIELD_MESSAGES } from '../errors.js';
import { newId, randomToken } from '../ids.js';
import { entitlementsFor } from '../domain/plans.js';
import { TERMINAL_STATUSES } from '../domain/states.js';
import { readMirror } from '../billing/mirror.js';
import { assertWorkspaceWritable } from '../billing/mirror.js';
import {
  createParticipantSession,
  participantCookieName,
  type ParticipantSessionState,
} from '../auth/sessions.js';
import { json, type RouteDefinition } from '../http/pipeline.js';
import { countActiveParticipants, findWorkshop, joinLinkExpiresAtMs } from '../board/repository.js';
import { bumpVersion } from '../board/repository.js';

interface LinkRow {
  workshop_id: string;
  join_link_id: string;
  revoked_at: Date | null;
}

/** Resolves a join token, applying the revoked and expired rules in order. */
async function resolveToken(token: string, nowMs: number): Promise<LinkRow> {
  const result = await pool.query<LinkRow>(
    `SELECT jl.workshop_id, jl.id AS join_link_id, jl.revoked_at
       FROM join_links jl WHERE jl.token = $1`,
    [token],
  );
  const link = result.rows[0];
  if (!link) throw new AppError('not_found');
  if (link.revoked_at !== null) throw new AppError('link_revoked');
  const workshop = await findWorkshop(pool, link.workshop_id);
  if (workshop === null) throw new AppError('not_found');
  // From the expiry instant, inclusive, the link answers link_expired.
  if (nowMs >= joinLinkExpiresAtMs(workshop)) throw new AppError('link_expired');
  return link;
}

function existingSessionFor(
  sessions: readonly ParticipantSessionState[],
  workshopId: string,
): ParticipantSessionState | undefined {
  return sessions.find((session) => session.actor.workshopId === workshopId && !session.ended);
}

export const joinRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/join/:token',
    auth: 'none',
    handle: async ({ context, nowMs }) => {
      const link = await resolveToken(context.params.token as string, nowMs);
      const workshop = await findWorkshop(pool, link.workshop_id);
      if (workshop === null) throw new AppError('not_found');
      return json(200, {
        workshop: {
          title: workshop.title,
          status: workshop.status,
          scheduledStart: workshop.scheduledStart,
          scheduledEnd: workshop.scheduledEnd,
          timeZone: workshop.timeZone,
        },
      });
    },
  },
  {
    method: 'POST',
    path: '/api/join/:token',
    auth: 'none',
    body: 'json',
    rateLimit: { limitClass: 'join', key: 'ip' },
    handle: async ({ context, body, lookup, nowMs }) => {
      const link = await resolveToken(context.params.token as string, nowMs);
      const workshop = await findWorkshop(pool, link.workshop_id);
      if (workshop === null) throw new AppError('not_found');

      // A repeat join from a browser already holding a valid session keeps one participant.
      const existing = existingSessionFor(lookup.participantSessions, workshop.id);
      if (existing) {
        return json(200, {
          participant: { id: existing.actor.participantId, displayName: existing.actor.displayName },
          workshopId: workshop.id,
        });
      }

      if (workshop.status === 'draft') throw new AppError('workshop_not_open');
      if (TERMINAL_STATUSES.has(workshop.status)) throw new AppError('workshop_closed');

      const raw = body.displayName;
      const displayName = typeof raw === 'string' ? raw.trim() : '';
      if (displayName.length < 1 || displayName.length > 40) {
        throw new AppError('validation', { fields: { displayName: FIELD_MESSAGES.generic } });
      }

      // Joining counts as a write, so a read-only workspace refuses it.
      await assertWorkspaceWritable(workshop.facilitatorId, nowMs);

      const participantId = await withTransaction(async (client) => {
        // Locking the workshop makes concurrent joins for the last places admit exactly the cap.
        await client.query('SELECT id FROM workshops WHERE id = $1 FOR UPDATE', [workshop.id]);
        const mirror = await readMirror(client, workshop.facilitatorId);
        const cap = entitlementsFor(mirror.plan).participantsPerWorkshop;
        const active = await countActiveParticipants(client, workshop, nowMs);
        if (cap !== null && active >= cap) throw new AppError('room_full');

        const id = newId('pt');
        await client.query(
          `INSERT INTO participants (id, workshop_id, join_link_id, display_name, cursor_id, hue)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, workshop.id, link.join_link_id, displayName, randomToken(16), Math.floor(Math.random() * 360)],
        );
        await bumpVersion(client, workshop.id);
        return id;
      });

      await createParticipantSession(context, participantId, workshop.id);
      return json(201, {
        participant: { id: participantId, displayName },
        workshopId: workshop.id,
      });
    },
  },
];
