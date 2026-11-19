'use strict';

// Settlement dates, cutoffs, approval thresholds and the approval expiry rule.
// Each rule is defined here once and read by every check and by the preview.

const { nyDate, nyMsOfDay, nyWallToUtc, nyMidnightUtc, addDays } = require('./nytime');
const fedcal = require('./fedcal');

const APPROVAL_THRESHOLD_CENTS = 500000;
const DUAL_APPROVAL_THRESHOLD_CENTS = 5000000;
const APPROVAL_EXPIRY_BUSINESS_DAYS = 5;

const METHODS = ['ach', 'wire', 'rtp', 'check'];

// Tallwind's own customer cutoffs, in New York local time.
const CUTOFF_MS_OF_DAY = {
  ach: 16 * 3600000,
  wire: 17 * 3600000,
};

function approvalsRequiredFor(amountCents) {
  if (amountCents > DUAL_APPROVAL_THRESHOLD_CENTS) return 2;
  if (amountCents > APPROVAL_THRESHOLD_CENTS) return 1;
  return 0;
}

// The effective date a direct send or final approval gets from its posting instant.
function effectiveDateForPosting(method, instantMs) {
  const date = nyDate(instantMs);
  if (method === 'rtp') return date;
  if (method === 'check') return fedcal.nextBusinessDayAfter(date);
  const cutoff = CUTOFF_MS_OF_DAY[method];
  if (fedcal.isBusinessDay(date) && nyMsOfDay(instantMs) < cutoff) return date;
  return fedcal.nextBusinessDayAfter(date);
}

// The effective date a scheduled payment is stamped with at scheduling time.
function effectiveDateForScheduled(method, scheduledFor) {
  if (method === 'rtp') return scheduledFor;
  return fedcal.firstBusinessDayOnOrAfter(scheduledFor);
}

function settlementDates(instantMs) {
  const out = {};
  for (const method of METHODS) out[method] = effectiveDateForPosting(method, instantMs);
  return out;
}

function sameDates(a, b) {
  return METHODS.every((method) => a[method] === b[method]);
}

// The earliest instant after `instantMs` at which at least one settlement date
// would differ: always a 16:00 or 17:00 New York cutoff, or a New York midnight.
function settlementDatesChangeAt(instantMs) {
  const current = settlementDates(instantMs);
  let date = nyDate(instantMs);
  for (let step = 0; step < 15; step += 1) {
    const candidates = [
      nyWallToUtc(date, 16, 0, 0, 0),
      nyWallToUtc(date, 17, 0, 0, 0),
      nyMidnightUtc(addDays(date, 1)),
    ].filter((ms) => ms > instantMs).sort((a, b) => a - b);
    for (const candidate of candidates) {
      if (!sameDates(current, settlementDates(candidate))) return candidate;
    }
    date = addDays(date, 1);
  }
  return nyMidnightUtc(addDays(nyDate(instantMs), 15));
}

// A held payment expires at 00:00 New York time on the fifth Federal Reserve
// business day strictly after the New York date it was created on.
function expiryForHeldPayment(createdAtMs) {
  const createdDate = nyDate(createdAtMs);
  const expiryDate = fedcal.addBusinessDays(createdDate, APPROVAL_EXPIRY_BUSINESS_DAYS);
  const expiresAtMs = nyMidnightUtc(expiryDate);
  return {
    expiresAt: new Date(expiresAtMs),
    expiresAtMs,
    // approve_by is the New York date of the last instant before the expiry.
    approveBy: addDays(expiryDate, -1),
  };
}

module.exports = {
  APPROVAL_THRESHOLD_CENTS,
  DUAL_APPROVAL_THRESHOLD_CENTS,
  METHODS,
  approvalsRequiredFor,
  effectiveDateForPosting,
  effectiveDateForScheduled,
  settlementDates,
  settlementDatesChangeAt,
  expiryForHeldPayment,
};
