import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { env } from '../env.js';
import { query, withTransaction } from '../db/pool.js';
import { ApiError, ValidationError, notFound } from '../http/errors.js';
import { bodyObject, pathParam, route } from '../http/handler.js';
import { requireCaller, requireRole } from '../http/session.js';
import { commissionFor, funderFor, shareFor } from '../domain/access.js';
import {
  computeQuoteFor,
  currentQuote,
  findCommission,
  installDayOf,
  listFunders,
  listMilestones,
  quoteAmountsOf,
  shapeFunder,
  venueOf,
  writeShares,
  type CommissionRow,
  type FunderRow,
} from '../domain/commissions.js';
import { invoiceFunderShare } from '../domain/billing.js';
import { queueEmail } from '../domain/notifications.js';
import { ensureSponsorRole } from '../services/keycloak.js';
import { formatAmount, formatSharePercent } from '../../shared/money.js';
import * as copy from '../../shared/copy.js';
import { INSTALLATION_LABELS, STUDIO_NAME } from '../../shared/seed.js';
import { isoUtc, isoWithVenueOffset } from '../../shared/venue-time.js';

export const fundersRouter = Router();

const MAX_SPONSORS = 3;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function inviteLink(token: string): string {
  return `${env.publicUrl}/i/${token}`;
}

/** Funders are locked once a sponsor accepts or the deposit is paid. */
async function assertFundersEditable(commission: CommissionRow): Promise<void> {
  const milestones = await listMilestones(commission.id);
  if (milestones.some((m) => m.milestone_key === 'deposit' && m.state === 'paid')) {
    throw new ApiError(409, 'funders_locked');
  }
  const funders = await listFunders(commission.id);
  if (funders.some((f) => f.kind === 'sponsor' && (f.state === 'accepted' || f.state === 'paid'))) {
    throw new ApiError(409, 'funders_locked');
  }
}

interface FunderInput {
  kind: 'client' | 'sponsor';
  name?: string;
  email?: string;
  bp: number;
}

function readFunderInputs(body: Record<string, unknown>): FunderInput[] {
  const raw = body['funders'];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError({ funders: copy.FUNDERS_SHARE_SUM });
  }
  const inputs: FunderInput[] = [];
  const errors: Record<string, string> = {};
  raw.forEach((entry, index) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const kind = item['kind'] === 'client' ? 'client' : 'sponsor';
    const bp = Number(item['bp']);
    if (!Number.isInteger(bp) || bp < 1 || bp > 10000) {
      errors[`funders[${index}].bp`] = copy.FUNDER_SHARE_MINIMUM;
    }
    const email = typeof item['email'] === 'string' ? item['email'].trim() : '';
    if (kind === 'sponsor' && !EMAIL_PATTERN.test(email)) {
      errors[`funders[${index}].email`] = copy.FUNDER_EMAIL_INVALID;
    }
    inputs.push({
      kind,
      name: typeof item['name'] === 'string' ? item['name'].trim() : '',
      email,
      bp,
    });
  });
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  if (inputs.filter((f) => f.kind === 'sponsor').length > MAX_SPONSORS) {
    throw new ValidationError({ funders: copy.FUNDERS_TOO_MANY });
  }
  if (inputs[0]?.kind !== 'client') {
    throw new ValidationError({ funders: copy.FUNDERS_SHARE_SUM });
  }
  if (inputs.reduce((sum, f) => sum + f.bp, 0) !== 10000) {
    throw new ValidationError({ funders: copy.FUNDERS_SHARE_SUM });
  }
  return inputs;
}

fundersRouter.get(
  '/api/commissions/:commissionId/funders',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    requireRole(caller, 'producer');
    const commission = await commissionFor(pathParam(req, 'commissionId'), caller);
    const venue = venueOf(commission);
    const funders = await listFunders(commission.id);
    res.json({ funders: funders.map((f) => shapeFunder(f, venue)) });
  }),
);

fundersRouter.put(
  '/api/commissions/:commissionId/funders',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    requireRole(caller, 'producer');
    const commission = await commissionFor(pathParam(req, 'commissionId'), caller);
    await assertFundersEditable(commission);
    const inputs = readFunderInputs(bodyObject(req));

    const existing = await listFunders(commission.id);
    const clientRow = existing.find((f) => f.kind === 'client');
    const quote = await currentQuote(commission.id);
    const amounts = quote
      ? quoteAmountsOf(quote)
      : computeQuoteFor(commission, venueOf(commission));

    const invites: { funder: FunderRow; token: string }[] = [];

    await withTransaction(async (tx) => {
      // Replacing the list keeps a sponsor's link when their email is unchanged.
      await tx.query('DELETE FROM funders WHERE commission_id = $1', [commission.id]);
      for (const [position, input] of inputs.entries()) {
        const id = randomUUID();
        if (input.kind === 'client') {
          await tx.query(
            `INSERT INTO funders (id, commission_id, position, kind, name, email, bp, state)
             VALUES ($1, $2, $3, 'client', $4, NULL, $5, 'lead')`,
            [
              clientRow?.id ?? id,
              commission.id,
              position,
              input.name && input.name !== '' ? input.name : (clientRow?.name ?? caller.user.name),
              input.bp,
            ],
          );
          continue;
        }
        const previous = existing.find(
          (f) =>
            f.kind === 'sponsor' &&
            (f.email ?? '').toLowerCase() === (input.email ?? '').toLowerCase(),
        );
        if (previous) {
          const kept = await tx.query<FunderRow>(
            `INSERT INTO funders
               (id, commission_id, position, kind, name, email, bp, state,
                invite_token_hash, invite_expires_at)
             VALUES ($1, $2, $3, 'sponsor', $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [
              previous.id,
              commission.id,
              position,
              input.name && input.name !== '' ? input.name : previous.name,
              input.email ?? '',
              input.bp,
              previous.state,
              previous.invite_token_hash,
              previous.invite_expires_at,
            ],
          );
          void kept;
          continue;
        }
        const token = newToken();
        const created = await tx.query<FunderRow>(
          `INSERT INTO funders
             (id, commission_id, position, kind, name, email, bp, state,
              invite_token_hash, invite_expires_at)
           VALUES ($1, $2, $3, 'sponsor', $4, $5, $6, 'invited', $7,
                   now() + ($8 || ' seconds')::interval)
           RETURNING *`,
          [
            id,
            commission.id,
            position,
            input.name && input.name !== '' ? input.name : (input.email ?? ''),
            input.email ?? '',
            input.bp,
            hashToken(token),
            String(env.inviteTtlSeconds),
          ],
        );
        const row = created.rows[0];
        if (row) invites.push({ funder: row, token });
      }
      await writeShares(tx, commission.id, amounts);
    });

    const venue = venueOf(commission);
    const refreshed = await listFunders(commission.id);
    for (const invite of invites) {
      const funder = refreshed.find((f) => f.id === invite.funder.id);
      if (!funder?.email) continue;
      await withTransaction((tx) =>
        queueEmail(tx, commission.id, `invite:${funder.id}:${hashToken(invite.token).slice(0, 16)}`, {
          to: funder.email ?? '',
          subject: copy.sponsorInviteSubject(commission.title),
          body: copy.sponsorInviteBody(
            inviteLink(invite.token),
            formatAmount(funder.amount_cents),
            formatSharePercent(funder.bp),
            funder.invite_expires_at ? isoUtc(funder.invite_expires_at) : '',
          ),
        }),
      );
    }

    res.json({ funders: refreshed.map((f) => shapeFunder(f, venue)) });
  }),
);

fundersRouter.post(
  '/api/funders/:funderId/invite',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    requireRole(caller, 'producer');
    const { funder, commission } = await funderFor(pathParam(req, 'funderId'), caller);
    if (funder.kind !== 'sponsor') throw notFound();
    if (funder.state === 'accepted' || funder.state === 'paid') {
      throw new ApiError(409, 'invite_used');
    }

    const token = newToken();
    const updated = await query<FunderRow>(
      `UPDATE funders
          SET invite_token_hash = $2,
              invite_expires_at = now() + ($3 || ' seconds')::interval,
              state = 'invited'
        WHERE id = $1
        RETURNING *`,
      [funder.id, hashToken(token), String(env.inviteTtlSeconds)],
    );
    const row = updated.rows[0];
    if (!row) throw notFound();

    await withTransaction((tx) =>
      queueEmail(tx, commission.id, `invite:${funder.id}:${hashToken(token).slice(0, 16)}`, {
        to: row.email ?? '',
        subject: copy.sponsorInviteSubject(commission.title),
        body: copy.sponsorInviteBody(
          inviteLink(token),
          formatAmount(row.amount_cents),
          formatSharePercent(row.bp),
          row.invite_expires_at ? isoUtc(row.invite_expires_at) : '',
        ),
      }),
    );
    res.json({ inviteExpiresAt: row.invite_expires_at ? isoUtc(row.invite_expires_at) : null });
  }),
);

fundersRouter.delete(
  '/api/funders/:funderId/invite',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    requireRole(caller, 'producer');
    const { funder } = await funderFor(pathParam(req, 'funderId'), caller);
    if (funder.state === 'paid') throw new ApiError(409, 'already_paid');
    await query(
      `UPDATE funders SET state = 'revoked', invite_token_hash = NULL WHERE id = $1`,
      [funder.id],
    );
    res.status(204).end();
  }),
);

interface InviteLookup {
  funder: FunderRow;
  commission: CommissionRow;
}

async function lookupInvite(token: string): Promise<InviteLookup> {
  const result = await query<FunderRow>(
    `SELECT * FROM funders WHERE invite_token_hash = $1 AND kind = 'sponsor'`,
    [hashToken(token)],
  );
  const funder = result.rows[0];
  if (!funder || funder.state === 'revoked') throw new ApiError(404, 'invite_invalid');
  // A link is valid while server time is strictly before its expiry.
  if (
    funder.invite_expires_at !== null &&
    Date.now() >= funder.invite_expires_at.getTime() &&
    funder.state !== 'accepted' &&
    funder.state !== 'paid'
  ) {
    throw new ApiError(410, 'invite_expired');
  }
  const commission = await findCommission(funder.commission_id);
  if (!commission) throw new ApiError(404, 'invite_invalid');
  return { funder, commission };
}

/** The public summary a sponsor may see: never other funders or the total. */
async function publicSummary(commission: CommissionRow): Promise<Record<string, unknown>> {
  const day = await installDayOf(commission.id);
  return {
    title: commission.title,
    venueName: venueOf(commission).name,
    installationType: INSTALLATION_LABELS[commission.installation_type],
    installDate: day?.install_date ?? null,
    studioName: STUDIO_NAME,
  };
}

fundersRouter.get(
  '/api/invites/:token',
  route(async (req, res) => {
    const { funder, commission } = await lookupInvite(pathParam(req, 'token'));
    res.json({
      commission: await publicSummary(commission),
      share: {
        sponsorName: funder.name,
        bp: funder.bp,
        subtotalCents: funder.subtotal_cents,
        taxCents: funder.tax_cents,
        amountCents: funder.amount_cents,
      },
      expiresAt: funder.invite_expires_at ? isoUtc(funder.invite_expires_at) : null,
    });
  }),
);

fundersRouter.post(
  '/api/invites/:token/accept',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const { funder, commission } = await lookupInvite(pathParam(req, 'token'));

    if (funder.accepted_user_id !== null) {
      if (funder.accepted_user_id === caller.user.id) {
        res.json({ commissionId: commission.id, funderId: funder.id });
        return;
      }
      throw new ApiError(409, 'invite_used');
    }

    // Acceptance binds the sponsor to this account and gives it the sponsor role.
    await grantSponsorRole(caller.user.id, caller.user.keycloakSub);
    await invoiceFunderShare(commission, funder, caller.user.id, new Date());
    res.json({ commissionId: commission.id, funderId: funder.id });
  }),
);

async function grantSponsorRole(userId: string, keycloakSub: string): Promise<void> {
  await query(
    `UPDATE app_users
        SET roles = (
          SELECT array_agg(DISTINCT role) FROM unnest(roles || ARRAY['sponsor']) AS role
        )
      WHERE id = $1`,
    [userId],
  );
  await ensureSponsorRole(keycloakSub).catch(() => undefined);
}

fundersRouter.get(
  '/api/commissions/:commissionId/share',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const { funder, commission } = await shareFor(pathParam(req, 'commissionId'), caller);
    const venue = venueOf(commission);
    res.json({
      commission: await publicSummary(commission),
      share: {
        id: funder.id,
        sponsorName: funder.name,
        bp: funder.bp,
        subtotalCents: funder.subtotal_cents,
        taxCents: funder.tax_cents,
        amountCents: funder.amount_cents,
        state: funder.state,
        dueAt: funder.due_at ? isoWithVenueOffset(funder.due_at, venue.timeZone) : null,
        killbillInvoiceId: funder.killbill_invoice_id,
        documentId: funder.document_id,
      },
    });
  }),
);

/** Every method other than GET and accept on an invite path answers 405. */
fundersRouter.all('/api/invites/:token', (req, res) => {
  if (req.method === 'GET') {
    res.status(404).json({ error: { code: 'invite_invalid' } });
    return;
  }
  res.status(405).json({ error: { code: 'method_not_allowed' } });
});
