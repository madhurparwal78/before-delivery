import type { ApiFailure } from './api.js';
import { localDateTime } from './format.js';

type Resolver = string | ((failure: ApiFailure) => string);

const GENERIC: Record<string, Resolver> = {
  validation_failed: 'Check the highlighted fields.',
  rate_limited: (failure) => `Too many tries. Try again in ${failure.retryAfter ?? 1} s.`,
  not_found: "We couldn't find that. It may have moved, or it isn't yours to see.",
  csrf_failed: 'This page is out of date. Reload and try again.',
  email_not_verified: 'Confirm your email to raid and join clans.',
  database_unavailable:
    'The tide records are out of reach. Nothing was changed — try again in a moment.',
  not_in_clan: "You're no longer in this clan."
};

const FALLBACK = 'Lost contact with the server. Check your connection and try again.';

export const OUTAGE_COPY =
  'The tide records are out of reach. Nothing was changed — try again in a moment.';

const PLACE_ERRORS: Record<string, Resolver> = {
  cell_occupied: 'That spot is taken.',
  building_limit_reached: 'Your island already holds the most of these.',
  insufficient_resources: 'Not enough resources for that.',
  no_free_builder: 'All builders are busy.'
};

const RAID_ABANDONED = 'The finalize window closed. The raid was abandoned and nothing moved.';

const ACTION_ERRORS: Record<string, Record<string, Resolver>> = {
  signup: {},
  confirm: {
    invalid_token:
      'This link has expired or was already used. Request a new one from the sign-in screen.'
  },
  resend: {},
  signin: { invalid_credentials: "That email and password don't match an account." },
  forgot: {},
  reset: { invalid_token: 'This reset link has expired or was already used.' },
  place: PLACE_ERRORS,
  move: PLACE_ERRORS,
  upgrade: {
    ...PLACE_ERRORS,
    saltmark_too_low: "Raise your island's saltmark first — finish more building levels.",
    max_level: 'Already at the highest level.',
    upgrade_in_progress: 'A builder is already on it.'
  },
  cancelJob: { job_already_finished: 'That job already finished. Nothing was refunded.' },
  collect: { not_a_producer: 'Only producers can be collected.' },
  train: {
    insufficient_resources: 'Not enough resources for that.',
    housing_full: 'Your camps are full.',
    barracks_required: 'Build a Tide Barracks first.',
    barracks_level_too_low: 'Upgrade your Tide Barracks first.'
  },
  cancelTraining: {
    batch_already_finished: 'That training already finished. Nothing was refunded.'
  },
  nextIsland: {},
  startRaid: {
    already_under_attack: 'Another raider got there first.',
    village_shielded: 'That island is shielded.',
    target_cooldown: 'You raided this island recently.',
    cannot_raid_self: "That's your own island.",
    raid_in_progress: 'Finish your current raid first.',
    no_army: 'Train some units first.'
  },
  deploy: {
    units_unavailable: 'You have no more of that unit in this raid.',
    raid_abandoned: RAID_ABANDONED
  },
  endRaid: {
    raid_abandoned: RAID_ABANDONED,
    nothing_deployed: 'Deploy at least one unit first.',
    raid_not_active: 'This raid is already over.'
  },
  raidLog: {},
  replay: { raid_not_resolved: 'This raid has no replay yet.' },
  daily: {
    already_claimed: (failure) =>
      `Next chest at ${failure.nextClaimAt ? localDateTime(failure.nextClaimAt) : ''}.`
  },
  weekly: {
    already_claimed: (failure) =>
      `Next league bonus at ${failure.nextClaimAt ? localDateTime(failure.nextClaimAt) : ''}.`
  },
  profile: {},
  foundClan: {
    clan_name_taken: 'That clan name is taken.',
    already_in_clan: 'Leave your current clan first.'
  },
  invite: { forbidden: 'Only wardens can do that.' },
  accept: {
    clan_full: 'That clan is full.',
    already_in_clan: 'Leave your current clan first.',
    not_found: 'That invitation is no longer open.'
  },
  role: {
    forbidden: 'Only wardens can do that.',
    invalid_role_change: "That role change isn't allowed."
  },
  removeMember: {
    forbidden: 'Only wardens can do that.',
    invalid_role_change: "That role change isn't allowed."
  },
  message: {},
  deleteMessage: { forbidden: 'Only wardens can do that.' },
  requestUnits: { request_open: 'You already have an open request.' },
  cancelRequest: { request_closed: 'That request is already filled or closed.' },
  donate: {
    request_closed: 'That request is already filled or closed.',
    exceeds_request: 'That request needs fewer units now.',
    donor_limit: "You've already given 3 units to this request.",
    donation_cap_reached: (failure) =>
      `You've given 8 units today. Donate again at ${
        failure.nextDonationAt ? localDateTime(failure.nextDonationAt) : ''
      }.`,
    units_unavailable: "You don't have those units.",
    recipient_housing_full: 'Their camps are full.',
    raid_in_progress: 'Finish your current raid first.'
  },
  rerun: {
    not_found: 'No raid has that ID.',
    raid_not_resolved: 'That raid has no result to re-run.'
  },
  ledgerCheck: {}
};

export type ActionKey = keyof typeof ACTION_ERRORS;

function resolve(resolver: Resolver, failure: ApiFailure): string {
  return typeof resolver === 'string' ? resolver : resolver(failure);
}

export function errorCopy(action: ActionKey, failure: ApiFailure): string {
  const own = ACTION_ERRORS[action]?.[failure.code];
  if (own !== undefined) return resolve(own, failure);
  const generic = GENERIC[failure.code];
  if (generic !== undefined) return resolve(generic, failure);
  return FALLBACK;
}

export const pendingCopy = {
  signup: 'Creating your island…',
  confirm: 'Confirming…',
  resend: 'Sending…',
  signin: 'Signing in…',
  forgot: 'Sending…',
  reset: 'Saving…',
  signout: 'Signing out…',
  place: (building: string) => `Placing ${building}…`,
  move: (building: string) => `Moving ${building}…`,
  upgrade: 'Starting upgrade…',
  cancelJob: 'Cancelling…',
  collect: 'Collecting…',
  train: 'Queuing training…',
  cancelTraining: 'Cancelling training…',
  nextIsland: 'Searching the tide for an island…',
  startRaid: 'Locking the island…',
  endRaid: 'Resolving the raid on the server…',
  raidLog: 'Loading raids…',
  replay: 'Loading replay…',
  daily: 'Opening…',
  weekly: 'Claiming…',
  profile: 'Saving…',
  foundClan: 'Founding…',
  invite: 'Inviting…',
  accept: 'Joining…',
  role: 'Updating…',
  removeMember: 'Removing…',
  leaveClan: 'Leaving…',
  message: 'Sending…',
  deleteMessage: 'Removing…',
  requestUnits: 'Posting…',
  cancelRequest: 'Cancelling…',
  donate: 'Donating…',
  rerun: 'Re-running seed…',
  ledgerCheck: 'Checking…'
} as const;

export const noticeCopy = {
  signupSuccess: (email: string) =>
    `Check your inbox at ${email}. Your confirmation link may take a few minutes to arrive.`,
  confirmSuccess: 'Email confirmed. Your island is ready.',
  resendSuccess: (email: string) =>
    `A fresh confirmation link is on its way to ${email}. It may take a few minutes.`,
  forgotSuccess: (email: string) =>
    `A reset link is on its way to ${email}. It works once and expires soon.`,
  resetSuccess: 'Password changed. Sign in with your new password.',
  signedOut: 'You signed out.',
  sessionEnded: 'Your session ended. Sign in again.',
  placeSuccess: (building: string, time: string) => `${building} placed. Done at ${time}.`,
  moveSuccess: (building: string) => `${building} moved.`,
  upgradeSuccess: (building: string, level: number, time: string) =>
    `${building} upgrading to level ${level}. Done at ${time}.`,
  jobComplete: (building: string, level: number) => `${building} reached level ${level}.`,
  cancelJobSuccess: (building: string, refunded: string) =>
    `${building} job cancelled. Refunded ${refunded}.`,
  collectSuccess: (collected: string) => `Collected ${collected}.`,
  collectWithLoss: (collected: string, lost: string) =>
    `Collected ${collected}. Storage full — ${lost} lost.`,
  collectNothing: 'Nothing to collect yet.',
  trainSuccess: (count: number, unit: string, time: string) =>
    `Training ${count} ${unit}. Ready at ${time}.`,
  cancelTrainingSuccess: (count: number, unit: string, refunded: string) =>
    `Training of ${count} ${unit} cancelled. Refunded ${refunded}.`,
  noMatch: 'No island is in reach right now. Try again in a minute.',
  startRaidSuccess: 'Island locked. Deploy before the finalize countdown runs out.',
  deployRetry: "Deploys didn't reach the tide. Retrying…",
  endRaidSuccess: (stars: number, destruction: number) =>
    `Raid resolved: ${stars} stars, ${destruction}% destroyed.`,
  underAttack: 'Your island is under attack.',
  raidedResolved: (stars: number, destruction: number) =>
    `Your island was raided: ${stars} stars, ${destruction}% destroyed.`,
  raidedAbandoned: 'The raid on your island was abandoned. Nothing moved.',
  replayReady: (finalTick: number) => `Replay ready: ${finalTick} ticks.`,
  dailySuccess: (streak: number, credited: string) =>
    `Daily chest opened (day ${streak} of 7): ${credited}.`,
  weeklySuccess: (league: string, credited: string) =>
    `${league} league bonus claimed: ${credited}.`,
  profileSuccess: 'Profile saved.',
  foundClanSuccess: (clan: string) => `${clan} founded. You lead it.`,
  inviteSuccess: (email: string) =>
    `Invitation recorded for ${email}. The mail may take a few minutes.`,
  acceptSuccess: (clan: string) => `You joined ${clan}.`,
  roleSuccess: (name: string, role: string) => `${name} is now ${role}.`,
  removeSuccess: (name: string) => `${name} was removed from the clan.`,
  leaveSuccess: (clan: string) => `You left ${clan}.`,
  leaveSuccessHandover: (clan: string, name: string) =>
    `You left ${clan}. ${name} now leads it.`,
  leaveSuccessDisbanded: (clan: string) => `You left ${clan}. The clan was disbanded.`,
  removedFromClan: (clan: string) => `You are no longer in ${clan}.`,
  messageRemoved: 'Message removed by a warden',
  requestSuccess: (count: number, unit: string) => `Request posted for ${count} ${unit}.`,
  cancelRequestSuccess: 'Request cancelled.',
  donateSuccess: (count: number, unit: string, name: string) =>
    `You donated ${count} ${unit} to ${name}.`,
  rerunMatch: (seed: number, finalTick: number) =>
    `Seed ${seed} re-run matches every tick (0–${finalTick}).`,
  rerunMismatch: (seed: number, tick: number) => `Seed ${seed} re-run differs from tick ${tick}.`,
  ledgerBalanced: (pairs: number) => `Ledger balanced: ${pairs} pairs.`,
  ledgerUnbalanced: (unbalanced: number, overCap: number) =>
    `Ledger unbalanced: ${unbalanced} pairs, ${overCap} balances over cap.`,
  cursorBuilding: (x: number, y: number, building: string, level: number) =>
    `Cell ${x}, ${y} — ${building} level ${level}`,
  cursorEmpty: (x: number, y: number) => `Cell ${x}, ${y} — open salt`,
  invalidGhost: 'That spot is taken or off the build area.',
  flatPlan: '3D view unavailable — showing the flat plan.'
} as const;

export const ROLE_LABELS: Record<string, string> = {
  skipper: 'Skipper',
  mate: 'Mate',
  deckhand: 'Deckhand'
};
