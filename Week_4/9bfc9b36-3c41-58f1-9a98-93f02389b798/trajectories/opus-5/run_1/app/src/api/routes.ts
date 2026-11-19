import { Router } from '../http/router';
import { probeDatabase } from '../db/pool';
import { probeIdentity } from '../services/keycloak';
import { reply, type Ctx, type Reply } from './types';
import { createSession, endSession, refreshSession } from './session';
import { createAccount, deleteAccount, listAccounts, patchAccount, roleTable } from './accounts';
import {
  createBoat, createSubmission, getBoat, getPhoto, listBoats, patchBoat, putPhoto, recordMeasurement,
} from './boats';
import { bulkDecide, decideSubmission, listSubmissions, reverseSubmission } from './submissions';
import {
  assignDrawing, createDrawing, drawSail, fetchCutSheet, getDrawing, getSailAccount, issueDrawing,
  listDrawings, previewCutSheet, recordCreditNote, recordPayment, reviseDrawing,
} from './drawings';
import {
  getStock, listCloths, listClosures, listStock, patchStock, receiveRoll, recordCount, stockSummary,
} from './stock';
import {
  confirmCut, createAuthority, getClaim, layPanel, listAuthorities, releaseClaim, takeClaim,
  unlayPanel, withdrawAuthority,
} from './claims';
import { exportLedger, listLedger, reconciliation } from './ledgerapi';
import {
  createGrant, fetchGrantCutSheet, getGrant, listGrantsOfDrawing, listMyCutSheets, withdrawGrant,
} from './grants';
import { createRuleSet, listAudit, listRuleSets, patchRuleSet, standing } from './admin';

/** The endpoint table. A request outside it is simply not there. */

async function health(_ctx: Ctx): Promise<Reply> {
  await probeDatabase();
  await probeIdentity();
  return reply(200, { status: 'ok' });
}

export function buildRouter(): Router {
  const router = new Router();
  const open = (method: string, pattern: string, handler: (ctx: Ctx) => Promise<Reply>, body: 'none' | 'json' = 'none') =>
    router.add({ method, pattern, handler, body, needsCaller: false });
  const route = (
    method: string,
    pattern: string,
    handler: (ctx: Ctx) => Promise<Reply>,
    body: 'none' | 'json' | 'photo' = method === 'GET' || method === 'DELETE' ? 'none' : 'json',
  ) => router.add({ method, pattern, handler, body, needsCaller: true });

  open('GET', '/api/health', health);
  open('POST', '/api/session', createSession, 'json');
  open('GET', '/api/session', refreshSession);
  route('DELETE', '/api/session', endSession);

  route('GET', '/api/accounts', listAccounts);
  route('POST', '/api/accounts', createAccount);
  route('PATCH', '/api/accounts/:id', patchAccount);
  route('DELETE', '/api/accounts/:id', deleteAccount);
  route('GET', '/api/admin/roles', roleTable);

  route('GET', '/api/rulesets', listRuleSets);
  route('POST', '/api/rulesets', createRuleSet);
  route('PATCH', '/api/rulesets/:version', patchRuleSet);

  route('GET', '/api/cloths', listCloths);
  route('GET', '/api/closures', listClosures);

  route('GET', '/api/boats', listBoats);
  route('GET', '/api/boats/:code', getBoat);
  route('POST', '/api/boats', createBoat);
  route('PATCH', '/api/boats/:code', patchBoat);
  route('POST', '/api/boats/:code/measurements', recordMeasurement);
  route('PUT', '/api/measurements/:id/photo', putPhoto, 'photo');
  route('GET', '/api/measurements/:id/photo', getPhoto);
  route('POST', '/api/boats/:code/submissions', createSubmission);

  route('GET', '/api/submissions', listSubmissions);
  route('POST', '/api/submissions/:id/decision', decideSubmission);
  route('POST', '/api/submissions/:id/reverse', reverseSubmission);
  route('POST', '/api/admin/submissions/decisions', bulkDecide);

  route('GET', '/api/drawings', listDrawings);
  route('GET', '/api/drawings/:code', getDrawing);
  route('POST', '/api/drawings', createDrawing);
  route('POST', '/api/drawings/:code/draw', drawSail);
  route('POST', '/api/drawings/:code/assign', assignDrawing);
  route('POST', '/api/drawings/:code/issue', issueDrawing);
  route('GET', '/api/drawings/:code/cut-sheet/preview', previewCutSheet);
  route('POST', '/api/drawings/:code/revise', reviseDrawing);
  route('GET', '/api/cut-sheets/:sha256', fetchCutSheet);
  route('GET', '/api/drawings/:code/account', getSailAccount);
  route('POST', '/api/drawings/:code/payments', recordPayment);
  route('POST', '/api/drawings/:code/credit-notes', recordCreditNote);

  route('POST', '/api/drawings/:code/grants', createGrant);
  route('GET', '/api/drawings/:code/grants', listGrantsOfDrawing);
  route('POST', '/api/grants/:id/withdraw', withdrawGrant);
  route('GET', '/api/grants/:id', getGrant);
  route('GET', '/api/my/cut-sheets', listMyCutSheets);
  route('GET', '/api/grants/:id/cut-sheet', fetchGrantCutSheet);

  route('GET', '/api/stock', listStock);
  route('GET', '/api/stock/summary', stockSummary);
  route('GET', '/api/stock/:code', getStock);
  route('POST', '/api/rolls', receiveRoll);
  route('PATCH', '/api/stock/:code', patchStock);
  route('POST', '/api/stock/:code/counts', recordCount);

  route('POST', '/api/claims', takeClaim);
  route('GET', '/api/claims/:id', getClaim);
  route('POST', '/api/claims/:id/lays', layPanel);
  route('DELETE', '/api/claims/:id/lays/:panel', unlayPanel);
  route('POST', '/api/claims/:id/release', releaseClaim);
  route('POST', '/api/claims/:id/cut', confirmCut, 'json');

  route('GET', '/api/authorities', listAuthorities);
  route('POST', '/api/authorities', createAuthority);
  route('POST', '/api/authorities/:id/withdraw', withdrawAuthority);

  route('GET', '/api/ledger', listLedger);
  route('GET', '/api/ledger/reconciliation', reconciliation);
  route('GET', '/api/exports/ledger.csv', exportLedger);

  route('GET', '/api/admin/audit', listAudit);
  route('GET', '/api/admin/standing', standing);

  return router;
}
