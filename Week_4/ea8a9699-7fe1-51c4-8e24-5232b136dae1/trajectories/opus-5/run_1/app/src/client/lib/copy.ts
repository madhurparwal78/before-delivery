import { statusLabel } from '../../shared/status.js';
import type { ClusterStatus } from '../../shared/types.js';

export const trayCopy = {
  pluckPending: (timecode: string) => `Saving frame ${timecode}...`,
  pluckSaved: (timecode: string, clipTitle: string, count: number, clusterTitle: string) =>
    `Plucked ${timecode} from ${clipTitle}. ${count} items in ${clusterTitle}.`,
  pluckStorageDown: (timecode: string, clusterTitle: string) =>
    `Storage is unreachable. Frame ${timecode} was not saved and ${clusterTitle} is unchanged.`,
  clusterLocked: (clusterTitle: string) => `${clusterTitle} is locked and cannot take new items.`,
  noActiveCluster: () => 'Choose a cluster in the tray before plucking.',
  added: (referenceTitle: string, count: number, clusterTitle: string) =>
    `Added ${referenceTitle}. ${count} items in ${clusterTitle}.`,
  alreadyAdded: (referenceTitle: string, clusterTitle: string) =>
    `${referenceTitle} is already in ${clusterTitle}.`,
  lifted: (title: string, position: number, count: number) =>
    `Lifted ${title}, position ${position} of ${count}. Use arrow keys to move, Space to drop, Escape to cancel.`,
  step: (title: string, position: number, count: number) => `${title}, position ${position} of ${count}.`,
  moveSaved: (title: string, position: number, count: number) =>
    `Moved ${title} to position ${position} of ${count}. Order saved.`,
  moveCancelled: (title: string, position: number, count: number) =>
    `Move cancelled. ${title} is back at position ${position} of ${count}.`,
  moveStale: () => 'The order changed elsewhere. Showing the latest order.',
  moveLocked: (clusterTitle: string, status: ClusterStatus) =>
    `${clusterTitle} is locked while ${statusLabel(status)}. The order is unchanged.`,
  moveFailed: () => 'The order could not be saved. Try again.',
};

export const wallCopy = {
  uploadPending: (fileName: string) => `Uploading ${fileName}...`,
  uploaded: (title: string) => `Uploaded ${title}.`,
  uploadStorageDown: (fileName: string) => `Storage is unreachable. ${fileName} was not uploaded.`,
  tooLarge: (fileName: string) => `${fileName} is larger than the limit for its type.`,
  unsupported: (fileName: string) => `${fileName} is not a supported image or clip.`,
  seatMissing: () => 'You need a pro seat to make changes. Ask your design ops lead.',
};

export const searchCopy = {
  pending: () => 'Searching...',
  results: (clusters: number, references: number, query: string) =>
    `${clusters} clusters and ${references} references match ${query}.`,
  none: (workspaceName: string, query: string) => `Nothing in ${workspaceName} matches ${query}.`,
};

export const clusterCopy = {
  created: (title: string) => `Created ${title} as a draft.`,
  sentToReview: () => 'Sent to review.',
  backToDraft: () => 'Back to draft. Review links are no longer active.',
  embargoSet: (liftLocal: string, timeZone: string) => `Embargo set. Goes public at ${liftLocal} ${timeZone}.`,
  embargoCancelled: () => 'Embargo cancelled. Back in review.',
  withdrawn: () => 'Withdrawn. The public page is gone.',
  transitionRefused: (status: ClusterStatus) =>
    `This cluster is now ${statusLabel(status)}. Refresh to see its current state.`,
  statusFailed: () => 'The status change could not be saved. Try again.',
  detailsSaved: () => 'Details saved.',
  commentPosted: () => 'Comment posted.',
  reviewLinkSent: (email: string) => `Review link sent to ${email}.`,
  reviewLinkMailDown: () => 'The review email could not be sent. No link was created.',
  linkRevoked: (email: string) => `Link for ${email} revoked.`,
  linkRegenerated: (email: string) => `New link sent to ${email}. The old link no longer works.`,
  regenerateMailDown: () => 'The new link could not be sent. The current link still works.',
  lockedEdit: (status: ClusterStatus) => `This cluster is locked while ${statusLabel(status)}.`,
};

export const adminCopy = {
  seatAssigned: (name: string, used: number, cap: number) =>
    `Seat assigned to ${name}. ${used} of ${cap} seats in use.`,
  seatFreed: (name: string, used: number, cap: number) => `Seat freed from ${name}. ${used} of ${cap} seats in use.`,
  noSeatsLeft: () => 'No seats left on this plan. Upgrade the plan or free a seat.',
  seatFailed: (used: number, cap: number) => `The seat change could not be saved. ${used} of ${cap} seats in use.`,
  upgradePending: () => 'Upgrading plan...',
  upgraded: (planName: string, cap: number, email: string) =>
    `Plan upgraded to ${planName}. ${cap} seats available. Receipt sent to ${email}.`,
  upgradeMailDown: () => 'The receipt email could not be sent, so the upgrade was cancelled. Your plan is unchanged.',
  upgradeBillingDown: () => 'Billing is unreachable. Your plan is unchanged.',
  upgradeInProgress: () => 'This upgrade is already in progress.',
  inviteSent: (email: string) => `Invite sent to ${email}.`,
  inviteMailDown: () => 'The invite email could not be sent. No invite was created.',
  offboarded: (count: number, email: string) => `Revoked ${count} review links for ${email}.`,
};

export const feedCopy = {
  pending: () => 'Loading more clusters...',
  showing: (count: number) => `Showing ${count} clusters.`,
  end: () => "You're all caught up.",
  failed: () => 'The feed could not load. Try again.',
};

export const profileCopy = {
  followed: (name: string, count: number) => `Following ${name}. ${count} followers.`,
  unfollowed: (name: string, count: number) => `Unfollowed ${name}. ${count} followers.`,
  failed: (count: number) => `Could not update the follow. ${count} followers.`,
};

export const reviewCopy = {
  commentPosted: () => 'Comment posted.',
  rateLimited: (seconds: number) => `You're commenting too fast. Try again in ${seconds} seconds.`,
  expired: () => 'This review link has expired.',
  revoked: () => 'This review link was revoked.',
  leftReview: () => 'This cluster is no longer in review.',
  unknown: () => 'This review link does not exist.',
  viewOnly: () => 'This link is view-only.',
};

export const notFoundCopy = 'This page does not exist.';
