import { pool } from '../data/db.js';
import { findSettlement, findStatement } from '../data/documents.js';
import { findPledge } from '../data/pledges.js';
import { notFound, notReady } from '../http/errors.js';
import { binary, json, requirePerson, type Router } from '../http/router.js';
import { conflict } from '../http/errors.js';
import { computeSettlement } from '../operations/settlement.js';
import { getObject } from '../services/storage.js';
import { loadOwnCampaign } from './helpers.js';

export function registerDocumentRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/pledges/{id}/statement.pdf',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const pledge = await findPledge(pool, ctx.params['id'] as string);
      if (pledge === null || pledge.backer_id !== person.id) throw notFound();
      const statement = await findStatement(pool, pledge.id);
      if (statement === null || statement.status !== 'ready') throw notReady();
      const bytes = await getObject(statement.object_key);
      if (bytes === null) throw notReady();
      return binary('application/pdf', bytes, `dotgain-statement-${pledge.id}.pdf`);
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/campaigns/{id}/settlement',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const campaign = await loadOwnCampaign(ctx.params['id'] as string, person);
      if (!['funded', 'collecting', 'settled'].includes(campaign.status)) {
        throw conflict('not_funded');
      }
      return json(200, await computeSettlement(pool, campaign));
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/campaigns/{id}/settlement.pdf',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const campaign = await loadOwnCampaign(ctx.params['id'] as string, person);
      const settlement = await findSettlement(pool, campaign.id);
      if (settlement === null || settlement.status !== 'ready') throw notReady();
      const bytes = await getObject(settlement.object_key);
      if (bytes === null) throw notReady();
      return binary('application/pdf', bytes, `dotgain-settlement-${campaign.id}.pdf`);
    },
  });
}
