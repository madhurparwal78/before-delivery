import { Router } from 'express';
import { pool, withTransaction } from '../db/pool.js';
import { ApiError, conflict, notFound } from '../lib/errors.js';
import { newId } from '../lib/codes.js';
import { requireRole } from '../http/middleware.js';
import { createSignedLink } from '../http/signed.js';
import { asString, asTrimmed, expectObject, fail } from '../http/validate.js';
import {
  admissionsReport,
  loadPass,
  scan,
  type ScanOutcome,
} from '../domain/admission.js';
import { writeAudit } from '../domain/audit.js';
import { loadOrder, serialiseOrder } from '../domain/orders.js';
import {
  approveProof,
  listProofs,
  loadProof,
  rejectProof,
  serialiseProof,
} from '../domain/proofs.js';
import { festivalDays, loadEdition, loadSession } from '../domain/programme.js';

export const boxOfficeRouter = Router();

boxOfficeRouter.get('/box-office/proofs', async (req, res) => {
  requireRole(req, 'box_office');
  const status = typeof req.query['status'] === 'string' ? req.query['status'] : null;
  const rows = await listProofs(pool, status);
  res.status(200).json({
    proofs: rows.map((row) => ({ ...serialiseProof(row), buyer_name: row.buyer_name })),
  });
});

boxOfficeRouter.post('/box-office/proofs/:id/read', async (req, res) => {
  requireRole(req, 'box_office');
  const proof = await loadProof(pool, req.params.id);
  if (proof === null) throw notFound();
  res.status(200).json(await createSignedLink(proof.object_key));
});

boxOfficeRouter.post('/box-office/proofs/:id/decision', async (req, res) => {
  const caller = requireRole(req, 'box_office');
  const body = expectObject(req.body);
  const decision = asString(body['decision']);
  const reason = asTrimmed(body['reason']);

  const outcome = await withTransaction(async (tx) => {
    const proof = await loadProof(tx, req.params.id);
    if (proof === null) throw notFound();
    if (proof.status !== 'pending') throw conflict('already_decided');
    if (proof.deadline.getTime() <= Date.now()) throw conflict('proof_hold_expired');
    if (decision !== 'approve' && decision !== 'reject') fail('decision', 'unknown');
    if (decision === 'reject' && reason === null) fail('reason', 'required');

    if (decision === 'approve') {
      await approveProof(tx, proof, caller.email);
    } else {
      await rejectProof(tx, proof, reason as string, caller.email);
    }
    await writeAudit(tx, {
      actor: caller.email,
      actorRole: caller.role,
      action: `proof.${decision === 'approve' ? 'approved' : 'rejected'}`,
      targetType: 'proof',
      targetId: proof.id,
      detail: { order_ref: proof.order_ref },
    });
    const updated = await loadProof(tx, proof.id);
    const order = await loadOrder(tx, proof.order_id);
    if (updated === null || order === null) throw new Error('proof decision lost its order');
    return { proof: serialiseProof(updated), order: await serialiseOrder(tx, order) };
  });

  res.status(200).json(outcome);
});

boxOfficeRouter.post('/box-office/scans', async (req, res) => {
  const caller = requireRole(req, 'box_office');
  const body = expectObject(req.body);
  const passCode = asTrimmed(body['pass_code']);
  const sessionId = asTrimmed(body['session_id']);

  const outcome = await withTransaction<ScanOutcome | { result: 'unknown' }>(async (tx) => {
    if (sessionId === null) throw notFound();
    const session = await loadSession(tx, sessionId);
    if (session === null) throw notFound();
    if (passCode === null) throw new ApiError(404, 'unknown_pass');
    const pass = await loadPass(tx, passCode);
    if (pass === null) {
      await tx.query(
        `INSERT INTO scans (id, pass_code, session_id, result, reason, at, actor)
         VALUES ($1, $2, $3, 'refused', 'unknown_pass', now(), $4)`,
        [newId(), passCode, sessionId, caller.email],
      );
      return { result: 'unknown' };
    }
    return scan(tx, pass, sessionId, caller.email);
  });

  if (outcome.result === 'unknown') throw new ApiError(404, 'unknown_pass');
  if (outcome.result === 'refused') {
    throw conflict('admission_refused', {
      reason: outcome.reason,
      first_admitted_at: outcome.first_admitted_at,
    });
  }
  res.status(200).json(outcome);
});

boxOfficeRouter.get('/box-office/admissions', async (req, res) => {
  requireRole(req, 'box_office');
  const day = typeof req.query['festival_day'] === 'string' ? req.query['festival_day'] : null;
  const edition = await loadEdition(pool);
  const days = festivalDays(edition);
  if (day === null || !days.some((candidate) => candidate.date === day)) {
    fail('festival_day', 'unknown_festival_day');
  }
  res.status(200).json(await admissionsReport(pool, day as string));
});
