import { formatDollars } from '../shared/money.ts';

export const copy = {
  signInError: "That code doesn't match anyone in this club.",
  emptyCycle: "There's no open cycle right now. The next case list appears here when the coordinator opens it.",
  paymentsPaused: "Payments are paused. We can't take top-ups right now; your credit and pledges are safe.",
  mailQueued: 'Receipts are queued and will send when mail is back.',
  noBreakdown: 'No cycle is in breakdown yet.',
  cutoffBanner: (cycleName: string): string => `Cutoff has passed. Pledges for ${cycleName} are closed.`,
  shortNotice: (shortUnits: number, units: number): string =>
    `Short shipment: ${shortUnits} of your ${units} units didn't arrive. You won't be charged for them.`,

  pledged: (units: number, caseName: string, unitsToGo: number): string =>
    `Pledged ${units} of ${caseName}. ${unitsToGo} to go.`,
  pledgedSealed: (units: number, caseName: string): string => `Pledged ${units} of ${caseName}. Case sealed.`,
  withdrew: (caseName: string, unitsToGo: number): string => `Withdrew from ${caseName}. ${unitsToGo} to go.`,
  pledgeCutoff: (caseName: string): string => `Cutoff has passed. ${caseName} was not changed.`,
  pledgeTooFew: (unitsToGo: number, caseName: string): string =>
    `Only ${unitsToGo} left on ${caseName}. Your pledge was not changed.`,
  pledgeNoCredit: (caseName: string): string => `Not enough credit for ${caseName}. Top up to pledge more.`,
  pledgeNoResponse: (caseName: string): string =>
    `Couldn't confirm your pledge on ${caseName}. Check your connection and try again.`,

  topupConfirmed: (amountCents: number, spendableCents: number): string =>
    `Top-up of $${formatDollars(amountCents)} confirmed. Spendable credit is now $${formatDollars(spendableCents)}.`,
  topupAmountError: 'Enter an amount from $5.00 to $500.00.',
  topupNoResponse: "Couldn't confirm your top-up. Check your connection and try again.",
  topupKeyReused: 'This top-up was already sent with a different amount. Close and start again.',
  topupNotTaken: 'Top-up not taken. Your credit has not changed.',

  showingMovements: (shown: number, total: number): string => `Showing ${shown} of ${total} movements.`,
  movementsError: "Couldn't load older movements. Try again.",

  savedDraft: (cycleName: string): string => `Saved draft ${cycleName}.`,
  savedTimes: (cycleName: string): string => `Saved times for ${cycleName}.`,
  staleTimes: (cycleName: string): string =>
    `Someone else changed ${cycleName}. The latest times are shown; check them and save again.`,
  problemsPlural: (count: number, action: 'opening' | 'saving'): string =>
    `${count} problems stop this cycle from ${action}.`,
  problemsSingular: (action: 'opening' | 'saving'): string => `1 problem stops this cycle from ${action}.`,

  dropped: (caseName: string): string => `Dropped ${caseName}. Holds released.`,
  takenUp: (units: number, caseName: string): string => `The club took up ${units} of ${caseName}.`,
  alreadyResolved: (caseName: string, resolution: string): string =>
    `${caseName} was already ${resolution}. Nothing changed.`,

  uploadSaved: (kind: string, bytes: number): string => `Saved ${kind} (${bytes} bytes).`,
  uploadStorageDown: 'File storage is unavailable. Your upload was not saved.',
  uploadTooLarge: 'That file is over 10 MB. Your upload was not saved.',
  uploadNotPdf: "That file isn't a PDF.",
  uploadNotPhoto: "That file isn't a JPEG or PNG photo.",
  uploadInProgress: 'Another upload of this file is still running. Your upload was not saved.',

  shortRecorded: (units: number, caseName: string, count: number): string =>
    `Recorded ${units} short on ${caseName}. Notices queued for ${count} households.`,
  shortRangeError: (remaining: number): string => `Enter 1 to ${remaining} units.`,
  shortNoResponse: (caseName: string): string =>
    `Couldn't confirm the short on ${caseName}. Check your connection and try again.`,

  transitioned: (cycleName: string, status: string): string => `${cycleName} is now ${status}.`,
  unresolved: 'Drop or take up every unfilled case first.',

  closed: (cycleName: string, count: number): string =>
    `${cycleName} is closed. ${count} receipts are queued for sending.`,
  closePaymentsDown: (cycleName: string): string =>
    `Close did not finish. ${cycleName} stays in closing and can be closed again.`,
  closeInvoiceMissing: 'Upload the distributor invoice before closing.',
  closeChargeMismatch: (cycleName: string): string =>
    `A charge for ${cycleName} in billing doesn't match. ${cycleName} stays in closing.`,
  closeStorageDown: (cycleName: string): string =>
    `File storage is unavailable. ${cycleName} was not closed.`,

  packed: (units: number, caseName: string, householdName: string): string =>
    `Packed ${units} of ${caseName} for ${householdName}.`,
  unpacked: (units: number, caseName: string, householdName: string): string =>
    `Unpacked ${units} of ${caseName} for ${householdName}.`,
  bagPacked: (householdName: string): string => `${householdName} bag is packed.`,
  outsideWindow: (pickupDisplay: string): string => `Outside the pickup window. Pickup is ${pickupDisplay}.`,
  flagged: (units: number, caseName: string): string =>
    `Flagged ${units} missing of ${caseName} for the coordinator.`,
  flagRangeError: (units: number): string => `Enter 1 to ${units} units.`,
} as const;

export const fieldLabels: Record<string, string> = {
  name: 'Cycle name',
  cutoff_local: 'Cutoff (club time)',
  pickup_start_local: 'Pickup starts (club time)',
  pickup_end_local: 'Pickup ends (club time)',
  product_ids: 'Cases',
};

export const fieldOrder = ['name', 'cutoff_local', 'pickup_start_local', 'pickup_end_local', 'product_ids'];
