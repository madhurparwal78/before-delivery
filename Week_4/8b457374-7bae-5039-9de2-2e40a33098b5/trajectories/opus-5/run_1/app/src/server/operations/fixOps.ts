import { FIELD_COPY } from '../../shared/copy.js';
import { findCampaign, type CampaignRow } from '../data/campaigns.js';
import { pool } from '../data/db.js';
import { findPersonById, setKillbillAccount, type PersonRow } from '../data/people.js';
import {
  findPledgeByFixCode,
  recordFixHold,
  setFixCard,
  type PledgeRow,
} from '../data/pledges.js';
import { readCard } from '../domain/cards.js';
import { FieldErrors, readString } from '../domain/validation.js';
import { cardDeclined, conflict, invalid, notFound } from '../http/errors.js';
import * as killbill from '../services/killbill.js';

export interface FixTarget {
  readonly pledge: PledgeRow;
  readonly campaign: CampaignRow;
}

/** The fix code is the credential; it opens only its own pledge's fix page. */
export async function loadFixTarget(code: string): Promise<FixTarget> {
  const pledge = await findPledgeByFixCode(pool, code);
  if (pledge === null) throw notFound();
  const campaign = (await findCampaign(pool, pledge.campaign_id)) as CampaignRow;
  return { pledge, campaign };
}

export async function applyFix(
  code: string,
  body: Readonly<Record<string, unknown>>,
): Promise<FixTarget> {
  const { pledge, campaign } = await loadFixTarget(code);

  const closed =
    pledge.state !== 'errored' ||
    pledge.fix_deadline_utc === null ||
    pledge.fix_deadline_utc.getTime() <= Date.now();
  if (closed) throw conflict('fix_window_closed');

  const errors = new FieldErrors();
  const raw = readString(body, 'card_number');
  const card = raw === null ? null : readCard(raw);
  if (card === null) errors.add('card_number', FIELD_COPY.card_number);
  errors.throwIfAny();
  if (card === null) throw invalid({ card_number: FIELD_COPY.card_number });
  if (card.behaviour === 'declines_authorisation') throw cardDeclined();

  const backer = (await findPersonById(pool, pledge.backer_id)) as PersonRow;
  const accountId =
    backer.killbill_account_id ??
    (await killbill.ensureAccount({ id: backer.id, name: backer.name, email: backer.email }));
  if (backer.killbill_account_id === null) await setKillbillAccount(pool, backer.id, accountId);

  const attempt = pledge.fix_attempt + 1;
  const paymentExternalKey = `${pledge.id}-fix-${attempt}`;
  await killbill.addPaymentMethod(accountId);
  const paymentId = await killbill.authorize(
    accountId,
    paymentExternalKey,
    `${paymentExternalKey}-auth`,
    pledge.amount,
  );

  if (pledge.fix_payment_id !== null) {
    await killbill.voidHold(
      pledge.fix_payment_id,
      `${pledge.id}-fix-${pledge.fix_attempt}-void`,
    );
  }

  await recordFixHold(pool, pledge.id, attempt, paymentId);
  await setFixCard(pool, pledge.id, card.last4, card.behaviour === 'captures');

  const { pledge: updated } = await loadFixTarget(code);
  return { pledge: updated, campaign };
}
