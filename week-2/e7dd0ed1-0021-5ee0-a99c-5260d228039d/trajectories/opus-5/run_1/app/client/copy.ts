import { formatCount, formatTime, otherSessionsLabel, regionCountLabel, shortVersion } from '../src/format';

export const storageOutage = "Farshore can't reach storage right now. Nothing was changed; try again in a minute.";
export const stepUpCancelled = 'Nothing changed. Confirmation was cancelled.';
export const suspensionBanner = 'This workspace is suspended. Uploads, downloads and share links are paused.';

export const signIn = {
  wrong: 'Email or password is incorrect.',
  throttled: (seconds: number) => `Too many sign-in attempts. Try again in ${seconds} seconds.`,
  wrongCode: "That code didn't work.",
  expired: 'This sign-in has expired. Enter your email and password again.',
};

export const bucketStatus = {
  pending: (name: string) => `Creating ${name}\u2026`,
  success: (name: string, regions: string[]) => `Created ${name} in ${regions.join(', ')}.`,
  nameError: "This name doesn't meet the bucket naming rules.",
  placementError: 'Choose one origin and up to three other regions.',
  taken: 'That name is taken. Bucket names are unique across all of Farshore.',
};

export const results = {
  pending: 'Loading objects\u2026',
  count: (count: number) => `${formatCount(count)} objects on this page`,
  truncated: 'Showing the matches found so far. Narrow the filter or go to the next page.',
  fieldError: (message: string) => `Filter not accepted: ${message}`,
  empty: 'No objects match.',
  outsideWorkspace: "This bucket isn't in your workspace.",
  unknownObject: (key: string, bucket: string) => `No object ${key} in ${bucket}.`,
};

export const upload = {
  pending: (file: string, sent: number, total: number) => `Uploading ${file}: ${formatCount(sent)} of ${formatCount(total)} bytes`,
  success: (key: string, versionId: string, pending: number) =>
    pending === 0
      ? `Stored ${key} as version ${shortVersion(versionId)}.`
      : `Stored ${key} as version ${shortVersion(versionId)}. Copies pending in ${regionCountLabel(pending)}.`,
  sizeMismatch: (file: string) => `${file} changed while uploading. Nothing was saved; try again.`,
  tooLarge: (file: string) => `${file} is over the single-upload limit. Use a multipart upload through the S3 API.`,
  badKey: (file: string) => `${file} has a name Farshore can't store as a key.`,
  scriptedSvg: (file: string) => `${file} is an SVG with scripts. Farshore doesn't store scripted SVG files.`,
  tagError: 'These tags break the tag limits for an object.',
  metadataError: "This file's metadata is over the size limit.",
  overwriteLost: (key: string, versionId: string) =>
    `${key} changed since you opened it. Reload to get version ${shortVersion(versionId)} before saving.`,
  overwriteDeleted: (key: string) => `${key} was deleted since you opened it. Nothing was saved.`,
  overQuota: (file: string, workspace: string, quota: number) =>
    `${file} would put ${workspace} over its ${formatCount(quota)} byte storage limit. Nothing was saved.`,
  originOffline: (bucket: string, region: string) =>
    `${bucket} can't take uploads while its origin region ${region} is offline. Nothing was saved; try again later.`,
  forbidden: "You can't upload to this bucket.",
};

export const deleteStatus = {
  pending: (count: number) => `Deleting ${formatCount(count)} objects\u2026`,
  success: (deleted: number, missing: number, undoUntil: string) =>
    missing === 0
      ? `Deleted ${formatCount(deleted)} objects. Undo until ${formatTime(undoUntil)}.`
      : `Deleted ${formatCount(deleted)} objects. ${formatCount(missing)} were already gone. Undo until ${formatTime(undoUntil)}.`,
  undoPending: 'Restoring\u2026',
  undoSuccess: (restored: number, kept: number, gone: number) => {
    let text = `Restored ${formatCount(restored)} objects.`;
    if (kept !== 0) text += ` ${formatCount(kept)} kept their newer version.`;
    if (gone !== 0) text += ` ${formatCount(gone)} were removed for good.`;
    return text;
  },
  windowClosed: 'The undo window has closed.',
  alreadyUndone: 'This delete was already undone.',
  item: (key: string, outcome: string) => {
    const labels: Record<string, string> = {
      deleted: 'deleted',
      not_found: 'already gone',
      restored: 'restored',
      newer_version: 'kept newer version',
      gone: 'removed for good',
    };
    return `${key}: ${labels[outcome] ?? outcome}`;
  },
};

export const lifecycleStatus = {
  pending: 'Saving rules\u2026',
  success: (bucket: string) => `Lifecycle rules saved for ${bucket}.`,
  fieldError: 'Rules not saved. Fix the highlighted fields.',
};

export const versionStatus = {
  pending: (versionId: string) => `Updating version ${shortVersion(versionId)}\u2026`,
  retentionSet: (versionId: string, time: string) => `Version ${shortVersion(versionId)} held until ${formatTime(time)}.`,
  legalHold: (versionId: string, on: boolean) =>
    on ? `Legal hold on for version ${shortVersion(versionId)}.` : `Legal hold off for version ${shortVersion(versionId)}.`,
  deleted: (versionId: string) => `Version ${shortVersion(versionId)} deleted.`,
  retentionRefused: (versionId: string, time: string) =>
    `Version ${shortVersion(versionId)} is held until ${formatTime(time)}; it can't be deleted.`,
  holdRefused: (versionId: string) => `Version ${shortVersion(versionId)} is on legal hold; it can't be deleted.`,
  shorteningRefused: 'Retention can be extended but not shortened.',
};

export const replicaCopy = {
  settled: (region: string, settleMs: number) => `${region} settled in ${formatCount(settleMs)} ms`,
  failed: (region: string) => `${region} failed`,
  retrying: (region: string) => `${region} retrying`,
  newVersion: (versionId: string, pending: number) =>
    `New version ${shortVersion(versionId)}. Copies pending in ${regionCountLabel(pending)}.`,
  restored: (versionId: string, pending: number) =>
    `Restored version ${shortVersion(versionId)}. Copies pending in ${regionCountLabel(pending)}.`,
};

export const readiness = {
  ready: (placed: number, versionId: string) =>
    `Ready to ship: all ${formatCount(placed)} regions hold version ${shortVersion(versionId)}.`,
  waiting: (pending: number, placed: number) => `Waiting on ${formatCount(pending)} of ${formatCount(placed)} regions.`,
  failed: (failed: number) => `Not ready: ${formatCount(failed)} failed. Retry before shipping.`,
};

export const shareStatus = {
  pending: 'Creating link\u2026',
  success: (expiresAt: string) => `Link ready. It expires ${formatTime(expiresAt)}.`,
  copied: 'Link copied.',
  expiryError: 'Pick an expiry between one second and seven days.',
  revoked: 'Link revoked. It stops working on the next request.',
};

export const inviteStatus = {
  pending: 'Sending invite\u2026',
  success: (email: string, expiresAt: string) => `Invite created for ${email}. It expires ${formatTime(expiresAt)}.`,
  emailError: 'Enter a valid email address.',
  alreadyMember: (email: string) => `${email} is already in this workspace.`,
  rateLimited: (seconds: number) => `Too many invites right now. Try again in ${seconds} seconds.`,
};

export const teamStatus = {
  pending: (name: string) => `Updating ${name}\u2026`,
  roleChanged: (name: string, role: string) =>
    role === 'owner' ? `${name} is now an owner.` : role === 'developer' ? `${name} is now a developer.` : `${name} is now a viewer.`,
  removed: (name: string) => `${name} removed. Their share links were revoked.`,
  lastOwner: 'A workspace needs at least one owner.',
};

export const keyStatus = {
  creating: 'Creating key\u2026',
  rotating: 'Rotating key\u2026',
  created: (keyId: string) => `Key ${keyId} created. Copy the secret now; Farshore won't show it again.`,
  rotated: (keyId: string, time: string) => `Key ${keyId} rotated. The previous secret works until ${formatTime(time)}.`,
  rotationDuringOverlap: "This key's previous secret is still live. Rotate again after the overlap ends.",
  disabled: (keyId: string) => `Key ${keyId} disabled. Requests signed with it fail from now on.`,
  deleted: (keyId: string) => `Key ${keyId} deleted.`,
  fieldError: 'Key not created. Fix the highlighted fields.',
  illegalDelete: 'Disable the key before deleting it.',
  illegalTransition: "That change isn't allowed from the current state.",
};

export const webhookStatus = {
  pending: 'Saving endpoint\u2026',
  created: "Endpoint added. Copy the signing secret now; Farshore won't show it again.",
  disabled: 'Endpoint disabled. New events are not queued for it.',
  enabled: 'Endpoint enabled.',
  deleted: 'Endpoint deleted.',
  fieldError: 'Endpoint not added. Fix the highlighted fields.',
  limit: 'This workspace already has 5 webhook endpoints.',
  redelivered: (sequence: number) => `Delivery ${formatCount(sequence)} queued again.`,
  illegalTransition: "That change isn't allowed from the current state.",
};

export const encryptionStatus = {
  pending: 'Rotating workspace key\u2026',
  success: (generation: number, rewrapped: number) =>
    `Workspace key rotated to generation ${formatCount(generation)}. ${formatCount(rewrapped)} data keys re-wrapped.`,
  running: 'Another rotation is running. Try again when it finishes.',
};

export const auditStatus = {
  pending: 'Verifying chain\u2026',
  verified: (entries: number) => `Chain verified: ${formatCount(entries)} entries intact.`,
  broken: (seq: number) => `Chain broken at entry ${formatCount(seq)}.`,
  filterError: (message: string) => `Filter not accepted: ${message}`,
  empty: 'No audit entries match.',
};

export const twoStepStatus = {
  setupStarted: 'Add this key to your authenticator app, then enter the code it shows.',
  pending: 'Checking code\u2026',
  turnedOn: "Two-step sign-in is on. Save your recovery codes now; Farshore won't show them again.",
  turnedOff: 'Two-step sign-in is off.',
};

export const sessionsStatus = {
  oneEnded: 'Session signed out.',
  othersEnded: (count: number) => `Signed out ${otherSessionsLabel(count)}.`,
};

export const passwordStatus = {
  pending: 'Changing password\u2026',
  success: (ended: number) => `Password changed. ${otherSessionsLabel(ended)} signed out.`,
  wrongCurrent: 'Your current password is incorrect.',
};

export const billingSync = {
  inSync: (confirmedThrough: string | null) =>
    `Billing in sync. Confirmed through ${confirmedThrough === null ? 'nothing yet this month' : formatTime(confirmedThrough)}.`,
  pending: 'Billing sync pending. Closed hours post within a minute.',
  delayed: (confirmedThrough: string | null) =>
    `Billing sync delayed. Metered totals here are complete; billing has confirmed usage through ${
      confirmedThrough === null ? 'nothing yet this month' : formatTime(confirmedThrough)
    }.`,
};

export const operatorStatus = {
  region: (name: string, state: string) => `${name} is now ${state}.`,
  workspace: (name: string, state: string) => `${name} ${state}.`,
  sync: (posted: number, queued: number) => `Billing sync: ${formatCount(posted)} rows posted, ${formatCount(queued)} still queued.`,
  lifecycle: (expired: number, aborted: number, skipped: number) =>
    `Lifecycle run: ${formatCount(expired)} versions expired, ${formatCount(aborted)} uploads aborted, ${formatCount(
      skipped,
    )} held versions skipped.`,
  illegalTransition: "That change isn't allowed from the current state.",
};

export const acceptInvite = {
  expired: 'This invite has expired. Ask the workspace owner for a new one.',
  wrongPassword: "That password doesn't match your Farshore account.",
};
