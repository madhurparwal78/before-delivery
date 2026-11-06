/** Every announced sentence, in one place. */
export const COPY = {
  unavailable: 'Saving is unavailable right now. Your choices are still on this page; try again in a minute.',
  liveCountResting: 'Tonight, people everywhere are keeping a Stillhour.',
  breathIn: 'Breathe in',
  breathHold: 'Hold',
  breathOut: 'Breathe out',
  breathDone: 'Three rounds done. Notice how you feel.',
  breathStopped: 'Breathing stopped.',
  filmPlaying: 'Playing',
  filmPaused: 'Paused',
  captionsOn: 'Captions on',
  captionsOff: 'Captions off',
  muted: 'Muted',
  soundOn: 'Sound on',
  plannerPending: 'Saving your hour…',
  plannerSent: 'Check your inbox. We sent a link to confirm your hour.',
  plannerQueued:
    'Your hour is saved as a draft. The confirmation email is delayed and will arrive as soon as our mail service is back.',
  plannerFields: 'Some details need another look.',
  plannerFailed: 'Your hour was not saved. Please try again.',
  signInPending: 'Sending your link…',
  signInSent: 'If that address has a Stillhour, a sign-in link is on its way. It works once, for 15 minutes.',
  linkPending: 'Checking your link…',
  linkConfirmed: 'Your Stillhour is confirmed. Reminders are on.',
  linkSignedIn: 'You are signed in.',
  linkUsed: 'This link has already been used. Ask for a new one on Manage my hour.',
  linkExpired: 'This link has expired. Ask for a new one on Manage my hour.',
  linkUnknown: 'We do not recognise this link.',
  managePending: 'Saving your hour…',
  manageSaved: 'Your hour is saved.',
  remindersOn: 'Reminders are on.',
  remindersPaused: 'Reminders are paused.',
  manageConflict: 'This plan changed somewhere else. Here is the latest version; your edits were not saved.',
  shareReady: 'Your share link is ready.',
  shareCopied: 'Link copied.',
  shareOff: 'Sharing is off. The old link no longer works.',
  deleted: 'Everything is deleted. You will not get another reminder.',
  signedOut: 'You are signed out.',
  signedOutPrompt: 'Sign in to manage your hour.',
  sharedLoading: 'Opening the shared hour…',
  sharedGone: 'This shared hour is no longer available.',
  draftWaiting: 'Your hour is waiting for confirmation. Open the link in your confirmation email.',
} as const;

export const livePeople = (count: number): string =>
  count === 1
    ? '1 person is keeping a Stillhour tonight'
    : `${count.toLocaleString('en-GB')} people are keeping a Stillhour tonight`;

export const saveLimitCopy = (minutes: number): string =>
  `You have saved three hours for this address in the last hour. Try again in ${minutes} minutes.`;

export const signInLimitCopy = (minutes: number): string =>
  `That address has asked for five links in the last hour. Try again in ${minutes} minutes.`;
