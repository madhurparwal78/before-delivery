import type { FastifyInstance } from 'fastify';
import { memberOf } from '../auth.js';
import { endorse, withdrawEndorsement } from '../domain/endorsements.js';
import { transaction } from '../db.js';

interface EndorsementParams {
  member_id: string;
  skill: string;
}

export async function skillRoutes(app: FastifyInstance): Promise<void> {
  const path = '/api/members/:member_id/skills/:skill/endorsement';

  app.put<{ Params: EndorsementParams }>(path, async (request) => {
    const { member_id, skill } = request.params;
    return transaction((tx) => endorse(tx, memberOf(request).id, member_id, skill));
  });

  app.delete<{ Params: EndorsementParams }>(path, async (request) => {
    const { member_id, skill } = request.params;
    return transaction((tx) => withdrawEndorsement(tx, memberOf(request).id, member_id, skill));
  });
}
