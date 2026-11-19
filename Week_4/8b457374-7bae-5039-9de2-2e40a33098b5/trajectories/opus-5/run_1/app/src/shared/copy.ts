import { formatMoney } from './money.js';
import type { CampaignStatus, PledgeState } from './types.js';

/** Field error messages the brief prints word for word. */
export const FIELD_COPY = {
  card_number: 'Use one of the test cards.',
  name: 'Enter your name.',
  email: 'Enter an email address.',
  add_on: 'Enter an add-on from 0.00 to 500.00.',
  pounds: 'Enter an amount in pounds, for example 2400.00.',
} as const;

/** The word shown next to every pledge state mark. */
export const STATE_WORDS: Readonly<Record<PledgeState, string>> = {
  authorising: 'Holding',
  authorised: 'Held',
  captured: 'Charged',
  errored: 'Needs fixing',
  voided: 'Released',
  dropped: 'Dropped',
};

export const PLEDGE_RESULT = {
  pending: (amount: number) => `Asking the payment service to hold ${formatMoney(amount)}.`,
  authorised: (amount: number) =>
    `Pledge authorised: ${formatMoney(amount)} held on your card. You are charged only if the run is funded.`,
  changed: (amount: number) =>
    `Pledge changed: ${formatMoney(amount)} held on your card. The earlier hold was released.`,
  cancelled: 'Pledge cancelled. The hold on your card was released.',
  declined: 'Card declined. No hold was placed. Try another card.',
  soldOut: 'That tier just sold out. No hold was placed.',
  wouldUnfund:
    'This change would take a funded run below its minimum in the final 24 hours, so it cannot be made.',
  closed: 'Pledging has closed for this campaign.',
  paymentsDown: 'Payment service unavailable. No hold was placed. Try again in a few minutes.',
  paymentsDownUnchanged: 'Payment service unavailable. Your pledge is unchanged.',
} as const;

export const FIX_RESULT = {
  pending: (amount: number) => `Asking the payment service to hold ${formatMoney(amount)}.`,
  success: (amount: number) =>
    `Card updated. ${formatMoney(amount)} is held and will be collected when the fix window closes.`,
  closed: 'The fix window has closed.',
} as const;

export const STUDIO_RESULT = {
  savingDraft: 'Saving draft.',
  draftSaved: 'Draft saved.',
  tierSaved: 'Tier saved.',
  uploading: (fileName: string) => `Uploading ${fileName}.`,
  coverStored: 'Cover stored.',
  imageStored: 'Image stored.',
  launched: 'Campaign launched.',
  launchNeedsImages:
    'Launch needs every image stored. Re-upload or remove the images marked Not stored.',
  validation: 'Check the highlighted fields.',
  cancelled: 'Campaign cancelled. Every held card was released.',
  storageDown: 'Media storage is unavailable. The image was not stored.',
} as const;

export const CLOSED_HEADINGS = {
  funded: 'Funded. This run goes to press.',
  unfunded: 'Not funded. No card was charged.',
  cancelled: 'Cancelled by the creator. No card was charged.',
} as const;

export function closedHeading(status: CampaignStatus): string | null {
  switch (status) {
    case 'funded':
    case 'collecting':
    case 'settled':
      return CLOSED_HEADINGS.funded;
    case 'unfunded':
      return CLOSED_HEADINGS.unfunded;
    case 'cancelled':
      return CLOSED_HEADINGS.cancelled;
    case 'draft':
    case 'live':
      return null;
  }
}

export const SERVICE_BANNERS = {
  payments: 'Payments are unavailable. New pledges and changes are paused; held cards are safe.',
  email: 'Email is delayed. Notices are queued and will be sent when the mail service is back.',
  storage: 'Media storage is unavailable. Uploads and statements are paused.',
  documents: 'Statements are delayed. They will appear once they are rendered.',
} as const;

export const EMPTY_STATES = {
  home: 'No live campaigns right now.',
  studio: 'No campaigns yet. Start one when your printer quotes a minimum run.',
  pledges: 'No pledges yet. Back a run and it will show here.',
  backers: 'No backers yet.',
} as const;

export const NOT_FOUND_HEADING = 'This page did not go to press.';

export const HERO = {
  headlineTop: 'PRINT IT IF',
  headlineBottom: 'THEY BACK IT',
  headline: 'PRINT IT IF THEY BACK IT',
  sentence:
    'All-or-nothing pledges for comics, zines and art books. No card is charged unless the print run is funded.',
  cta: 'Start a campaign',
} as const;
