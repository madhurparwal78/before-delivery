import { zoneFor } from '../../shared/countries.js';
import { FIELD_COPY } from '../../shared/copy.js';
import { config } from '../config.js';
import { campaignTotals, findCampaign, type CampaignRow } from '../data/campaigns.js';
import { pool, transaction } from '../data/db.js';
import {
  findPersonByEmail,
  findPersonById,
  insertPerson,
  setKillbillAccount,
  type PersonRow,
} from '../data/people.js';
import {
  deletePledge,
  findActivePledge,
  findPledge,
  insertPledge,
  movePledge,
  setPledgePayment,
  type PledgeRow,
} from '../data/pledges.js';
import { claimedCount, findTier, type TierRow } from '../data/tiers.js';
import { readCard, type TestCard } from '../domain/cards.js';
import { newId } from '../domain/ids.js';
import { breakdownFor } from '../domain/pledgeAmount.js';
import {
  rejectUnlessPledgeActive,
  rejectUnlessPledgingOpen,
} from '../domain/transitions.js';
import { FieldErrors, readString, validateAddOn, validateCountry } from '../domain/validation.js';
import {
  cardDeclined,
  conflict,
  forbidden,
  notFound,
  type ApiError,
} from '../http/errors.js';
import * as killbill from '../services/killbill.js';
import { pastDeadline } from '../views.js';
import { withCampaignLock } from './locks.js';
import { queuePledgeCancelled, queuePledgeReceipt } from './notices.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A campaign anyone may see, or a draft seen by its own creator. */
export async function loadVisibleCampaign(
  id: string,
  viewer: PersonRow | null,
): Promise<CampaignRow> {
  const campaign = await findCampaign(pool, id);
  if (campaign === null) throw notFound();
  if (campaign.status === 'draft' && campaign.creator_id !== viewer?.id) throw notFound();
  return campaign;
}

/** A tier id in a request body that names another campaign's tier is not found. */
export async function loadTierOfCampaign(campaign: CampaignRow, tierId: unknown): Promise<TierRow> {
  if (typeof tierId !== 'string' || tierId === '') throw notFound();
  const tier = await findTier(pool, tierId);
  if (tier === null || tier.campaign_id !== campaign.id) throw notFound();
  return tier;
}

/** A claim beyond a limited tier's quantity is refused before Kill Bill sees anything. */
async function assertCopyAvailable(tier: TierRow, keepsOwnCopy: boolean): Promise<void> {
  if (tier.quantity === null) return;
  const claimed = await claimedCount(pool, tier.id);
  const wanted = keepsOwnCopy ? claimed : claimed + 1;
  if (wanted > tier.quantity) throw conflict('tier_sold_out');
}

/**
 * In a campaign's final window a reduction or cancellation that would take a funded
 * campaign below its goal is refused.
 */
async function assertNotUnfunding(
  campaign: CampaignRow,
  oldAmount: number,
  newAmount: number,
  now: Date,
): Promise<void> {
  if (newAmount >= oldAmount) return;
  const secondsLeft = (campaign.deadline_utc.getTime() - now.getTime()) / 1000;
  if (secondsLeft > config.finalWindowSeconds) return;
  const { total } = await campaignTotals(pool, campaign.id);
  if (total < campaign.goal) return;
  if (total - oldAmount + newAmount < campaign.goal) throw conflict('would_unfund');
}

function requireCard(body: Readonly<Record<string, unknown>>, errors: FieldErrors): TestCard | null {
  const raw = readString(body, 'card_number');
  const card = raw === null ? null : readCard(raw);
  if (card === null) errors.add('card_number', FIELD_COPY.card_number);
  return card;
}

async function accountFor(person: PersonRow): Promise<string> {
  if (person.killbill_account_id !== null) return person.killbill_account_id;
  const accountId = await killbill.ensureAccount({
    id: person.id,
    name: person.name,
    email: person.email,
  });
  await setKillbillAccount(pool, person.id, accountId);
  return accountId;
}

/**
 * Places one hold. A card the network declines never reaches Kill Bill, so a declined
 * attempt leaves no successful AUTHORIZE on the account.
 */
async function placeHold(
  person: PersonRow,
  paymentExternalKey: string,
  amount: number,
  card: TestCard | null,
): Promise<string> {
  if (card !== null && card.behaviour === 'declines_authorisation') throw cardDeclined();
  const accountId = await accountFor(person);
  if (card !== null) await killbill.addPaymentMethod(accountId);
  return killbill.authorize(accountId, paymentExternalKey, `${paymentExternalKey}-auth`, amount);
}

export interface PledgeOutcome {
  readonly pledge: PledgeRow;
  readonly campaign: CampaignRow;
  readonly backer: PersonRow;
  readonly createdKey: string | null;
}

export interface CreatePledgeInput {
  readonly campaignId: string;
  readonly viewer: PersonRow | null;
  readonly body: Readonly<Record<string, unknown>>;
}

/** Reads the name and email that stand in for a key, so the call can create its person. */
export function readGuestDetails(body: Readonly<Record<string, unknown>>): {
  name: string;
  email: string;
  error: ApiError | null;
} {
  const errors = new FieldErrors();
  const name = readString(body, 'name') ?? '';
  const email = readString(body, 'email') ?? '';
  if (name.length < 1 || name.length > 80) errors.add('name', FIELD_COPY.name);
  if (email.length < 1 || email.length > 254 || !EMAIL.test(email)) {
    errors.add('email', FIELD_COPY.email);
  }
  let error: ApiError | null = null;
  try {
    errors.throwIfAny();
  } catch (thrown) {
    error = thrown as ApiError;
  }
  return { name, email, error };
}

export async function createPledge(input: CreatePledgeInput): Promise<PledgeOutcome> {
  const { campaignId, viewer, body } = input;
  return withCampaignLock(campaignId, async () => {
    const now = new Date();
    const campaign = await loadVisibleCampaign(campaignId, viewer);
    const tier = await loadTierOfCampaign(campaign, body['tier_id']);

    let backer = viewer;
    let createdKey: string | null = null;
    let guestName = '';
    let guestEmail = '';
    if (backer === null) {
      const guest = readGuestDetails(body);
      if (guest.error !== null) throw guest.error;
      guestName = guest.name;
      guestEmail = guest.email;
      backer = await findPersonByEmail(pool, guestEmail);
    }

    if (backer !== null && campaign.creator_id === backer.id) throw forbidden('own_campaign');

    const closed = rejectUnlessPledgingOpen(campaign.status, pastDeadline(campaign, now));
    if (closed !== null) throw conflict(closed);

    if (backer !== null && (await findActivePledge(pool, campaign.id, backer.id)) !== null) {
      throw conflict('already_pledged');
    }

    await assertCopyAvailable(tier, false);

    const errors = new FieldErrors();
    const country = validateCountry(body, errors);
    const addOn = validateAddOn(body, errors);
    const card = requireCard(body, errors);
    errors.throwIfAny();

    if (backer === null) {
      const created = await insertPerson(pool, guestName, guestEmail);
      backer = created.person;
      createdKey = created.key;
    }

    const zone = zoneFor(campaign.ships_from, country);
    const breakdown = breakdownFor(
      {
        price: tier.price,
        shipping: {
          domestic: tier.ship_domestic,
          europe: tier.ship_europe,
          rest_of_world: tier.ship_rest_of_world,
        },
      },
      zone,
      addOn,
    );

    const pledgeId = newId('plg');
    const claimed = await insertPledge(pool, {
      id: pledgeId,
      campaign_id: campaign.id,
      backer_id: backer.id,
      tier_id: tier.id,
      country,
      zone,
      reward: breakdown.reward,
      shipping: breakdown.shipping,
      add_on: breakdown.add_on,
      amount: breakdown.amount,
      card_last4: (card as TestCard).last4,
      card_captures: (card as TestCard).behaviour === 'captures',
      replaces: null,
    });

    let paymentId: string;
    try {
      paymentId = await placeHold(backer, pledgeId, breakdown.amount, card);
    } catch (error) {
      await deletePledge(pool, claimed.id);
      throw error;
    }

    const authorised = await transaction(async (client) => {
      await setPledgePayment(client, pledgeId, paymentId);
      const moved = await movePledge(client, pledgeId, 'authorised', {
        killbill_payment_id: paymentId,
      });
      await queuePledgeReceipt(client, campaign, moved, backer as PersonRow);
      return moved;
    });

    return { pledge: authorised, campaign, backer, createdKey };
  });
}

export interface ChangePledgeInput {
  readonly pledgeId: string;
  readonly viewer: PersonRow;
  readonly body: Readonly<Record<string, unknown>>;
}

export async function changePledge(input: ChangePledgeInput): Promise<PledgeOutcome> {
  const existing = await findPledge(pool, input.pledgeId);
  if (existing === null || existing.backer_id !== input.viewer.id) throw notFound();

  return withCampaignLock(existing.campaign_id, async () => {
    const now = new Date();
    const pledge = await findPledge(pool, input.pledgeId);
    if (pledge === null) throw notFound();
    const campaign = await loadVisibleCampaign(pledge.campaign_id, input.viewer);
    const wantsTier = Object.hasOwn(input.body, 'tier_id')
      ? await loadTierOfCampaign(campaign, input.body['tier_id'])
      : ((await findTier(pool, pledge.tier_id)) as TierRow);

    const closed = rejectUnlessPledgingOpen(campaign.status, pastDeadline(campaign, now));
    if (closed !== null) throw conflict(closed);

    const inactive = rejectUnlessPledgeActive(pledge.state);
    if (inactive !== null) throw conflict(inactive);

    await assertCopyAvailable(wantsTier, wantsTier.id === pledge.tier_id);

    const errors = new FieldErrors();
    const country = Object.hasOwn(input.body, 'country')
      ? validateCountry(input.body, errors)
      : pledge.country;
    const addOn = Object.hasOwn(input.body, 'add_on')
      ? validateAddOn(input.body, errors)
      : pledge.add_on;

    const zone = zoneFor(campaign.ships_from, country);
    const breakdown = breakdownFor(
      {
        price: wantsTier.price,
        shipping: {
          domestic: wantsTier.ship_domestic,
          europe: wantsTier.ship_europe,
          rest_of_world: wantsTier.ship_rest_of_world,
        },
      },
      zone,
      addOn,
    );

    if (!errors.any) {
      await assertNotUnfunding(campaign, pledge.amount, breakdown.amount, now);
      if (
        wantsTier.id === pledge.tier_id &&
        country === pledge.country &&
        addOn === pledge.add_on
      ) {
        errors.add('pledge', 'Change the tier, the country or the add-on.');
      }
    }
    errors.throwIfAny();

    const replacementId = newId('plg');
    await insertPledge(pool, {
      id: replacementId,
      campaign_id: campaign.id,
      backer_id: pledge.backer_id,
      tier_id: wantsTier.id,
      country,
      zone,
      reward: breakdown.reward,
      shipping: breakdown.shipping,
      add_on: breakdown.add_on,
      amount: breakdown.amount,
      card_last4: pledge.card_last4 ?? '',
      card_captures: pledge.card_captures,
      replaces: pledge.id,
    });

    let paymentId: string;
    try {
      paymentId = await placeHold(input.viewer, replacementId, breakdown.amount, null);
    } catch (error) {
      await deletePledge(pool, replacementId);
      throw error;
    }

    try {
      await killbill.voidHold(pledge.killbill_payment_id as string, `${pledge.id}-void`);
    } catch (error) {
      // The new hold stands but the old one could not be released, so nothing changes.
      await releaseQuietly(paymentId, `${replacementId}-void`);
      await deletePledge(pool, replacementId);
      throw error;
    }

    // The old hold is released before the replacement is confirmed, so the two never
    // stand as one backer's confirmed pledge on the same campaign at once.
    const replacement = await transaction(async (client) => {
      await movePledge(client, pledge.id, 'voided');
      const moved = await movePledge(client, replacementId, 'authorised', {
        killbill_payment_id: paymentId,
      });
      await queuePledgeReceipt(client, campaign, moved, input.viewer);
      return moved;
    });

    return { pledge: replacement, campaign, backer: input.viewer, createdKey: null };
  });
}

async function releaseQuietly(paymentId: string, transactionKey: string): Promise<void> {
  try {
    await killbill.voidHold(paymentId, transactionKey);
  } catch {
    // Kill Bill is unreachable; the hold is released by the operator's retry.
  }
}

export async function cancelPledge(pledgeId: string, viewer: PersonRow): Promise<PledgeOutcome> {
  const existing = await findPledge(pool, pledgeId);
  if (existing === null || existing.backer_id !== viewer.id) throw notFound();

  return withCampaignLock(existing.campaign_id, async () => {
    const now = new Date();
    const pledge = await findPledge(pool, pledgeId);
    if (pledge === null) throw notFound();
    const campaign = await loadVisibleCampaign(pledge.campaign_id, viewer);

    const closed = rejectUnlessPledgingOpen(campaign.status, pastDeadline(campaign, now));
    if (closed !== null) throw conflict(closed);

    const inactive = rejectUnlessPledgeActive(pledge.state);
    if (inactive !== null) throw conflict(inactive);

    await assertNotUnfunding(campaign, pledge.amount, 0, now);

    await killbill.voidHold(pledge.killbill_payment_id as string, `${pledge.id}-void`);

    const voided = await transaction(async (client) => {
      const moved = await movePledge(client, pledge.id, 'voided');
      await queuePledgeCancelled(client, campaign, moved, viewer);
      return moved;
    });

    return { pledge: voided, campaign, backer: viewer, createdKey: null };
  });
}

/** Loads the backer of a pledge for notice and view building. */
export async function backerOf(pledge: PledgeRow): Promise<PersonRow> {
  return (await findPersonById(pool, pledge.backer_id)) as PersonRow;
}
