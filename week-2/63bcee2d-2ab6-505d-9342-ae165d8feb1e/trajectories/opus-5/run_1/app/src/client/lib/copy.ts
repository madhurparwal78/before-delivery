/** Every published pending, success, refusal and rare-state line. */

import { formatDate } from '../../shared/format.js';

export const pending = {
  signIn: 'Signing in…',
  sendInvitation: 'Sending invitation…',
  join: 'Joining…',
  saveMember: 'Saving…',
  removeMember: 'Removing…',
  requestSignOff: 'Requesting sign-off…',
  signOff: (stage: string): string => `Signing off ${stage}…`,
  returnStage: 'Returning…',
  saveNote: 'Saving…',
  uploadSheet: (index: number, total: number, fileName: string): string =>
    `Uploading ${index} of ${total}: ${fileName}`,
  issueTransmittal: 'Building transmittal…',
  saveTenderDraft: 'Saving…',
  publishTender: 'Publishing…',
  moveClose: 'Saving…',
  continueToTender: 'Signing you in…',
  submitBid: 'Submitting bid…',
  submitAmendment: 'Submitting amendment…',
  openBids: 'Opening bids…',
  saveLevelling: 'Saving…',
  award: 'Awarding…',
  submitVariation: 'Sending variation…',
  saveVariation: 'Saving…',
  variationTransition: 'Saving…',
  postComment: 'Posting…',
  issueCertificate: 'Issuing…',
  recordPracticalCompletion: 'Recording…',
  finalRelease: 'Releasing…',
  sendForReview: 'Sending…',
  returnDrawing: 'Returning drawing…',
  pinSnag: 'Pinning snag…',
  snagTransition: 'Saving…',
  uploadImage: (fileName: string): string => `Uploading ${fileName}…`,
  importFinishes: 'Importing…',
  reorderDrop: 'Saving…',
  sendPreview: 'Sending preview…',
  revokePreview: 'Revoking…',
  approveCaseStudy: 'Approving…',
  publishCaseStudy: 'Publishing…',
  withdrawCaseStudy: 'Withdrawing…',
  sendEnquiry: 'Sending…',
} as const;

export const success = {
  invitationSent: (email: string): string => `Invitation sent to ${email}.`,
  joined: (name: string): string => `Welcome to Marrow Hall Interiors, ${name}.`,
  memberUpdated: (name: string): string => `${name} updated.`,
  memberRemoved: (name: string): string => `${name} no longer has access.`,
  signOffRequested: (stage: string): string => `Sign-off requested for ${stage}.`,
  signedOff: (stage: string, invoiceNumber: string, email: string): string =>
    `${stage} signed off. Invoice ${invoiceNumber} raised; a receipt is on its way to ${email}.`,
  stageReturned: (stage: string): string => `${stage} returned to the studio.`,
  noteSaved: 'Internal note saved.',
  sheetAdded: (fileName: string, sheetCode: string, revision: string): string =>
    `${fileName} added as ${sheetCode} revision ${revision}.`,
  sheetBatch: (uploaded: number, total: number): string =>
    `${uploaded} of ${total} files uploaded.`,
  transmittalIssued: (number: string, count: number): string =>
    `Transmittal ${number} issued with ${count} sheets.`,
  tenderDraftSaved: 'Tender draft saved.',
  tenderPublished: (count: number): string =>
    `Tender published. Invitations sent to ${count} bidders.`,
  closeMoved: (time: string, count: number): string =>
    `Close moved to ${time}. Updated invitations sent to ${count} bidders.`,
  bidSubmitted: (time: string): string => `Bid submitted at ${time}.`,
  bidAmended: (time: string): string =>
    `Bid amended at ${time}. Your latest amendment is the one that counts.`,
  bidsOpened: (count: number): string => `Bids opened. ${count} bids are ready to level.`,
  levellingSaved: (reference: string): string => `Levelling for ${reference} saved.`,
  awarded: (companyName: string): string => `Awarded to ${companyName}.`,
  variationRaised: (number: string): string => `Variation ${number} raised.`,
  variationSaved: (number: string): string => `Variation ${number} saved.`,
  variationTransition: (number: string, stateWords: string): string =>
    `Variation ${number} ${stateWords}.`,
  commentPosted: 'Comment posted.',
  certificateIssued: (number: string, amount: string): string =>
    `Certificate ${number} issued: ${amount} due.`,
  practicalCompletion: (number: string, amount: string): string =>
    `Practical completion recorded. Retention release ${number} issued for ${amount}.`,
  finalRelease: (number: string, amount: string): string =>
    `Final retention release ${number} issued for ${amount}.`,
  shopDrawingReceived: (reference: string, due: string): string =>
    `${reference} received. Review due ${due}.`,
  drawingReturned: (reference: string, codeLabel: string): string =>
    `${reference} returned with ${codeLabel}.`,
  snagPinned: (number: number, across: number, down: number): string =>
    `Snag ${number} pinned at ${across}% across, ${down}% down.`,
  snagMoved: (number: number): string => `Snag ${number} moved.`,
  snagTransition: (number: number, stateWord: string): string =>
    `Snag ${number} marked ${stateWord}.`,
  photoUploaded: (fileName: string, viewpointName: string): string =>
    `${fileName} is now the site photo for ${viewpointName}.`,
  renderUploaded: (fileName: string, viewpointName: string): string =>
    `${fileName} is now the render for ${viewpointName}.`,
  importFinished: (
    created: number,
    updated: number,
    unchanged: number,
    rejected: number,
  ): string =>
    `Import finished: ${created} created, ${updated} updated, ${unchanged} unchanged, ${rejected} rejected.`,
  reorderPickUp: (finish: string, position: number, total: number): string =>
    `Picked up ${finish}. Position ${position} of ${total}. Use the up and down arrow keys to move, Enter to drop, Escape to cancel.`,
  reorderMove: (finish: string, position: number, total: number): string =>
    `${finish} moved to position ${position} of ${total}.`,
  reorderDrop: (finish: string, position: number, total: number): string =>
    `${finish} dropped at position ${position} of ${total}.`,
  reorderCancel: (finish: string, position: number, total: number): string =>
    `Reorder cancelled. ${finish} is back at position ${position} of ${total}.`,
  previewSent: (count: number, time: string): string =>
    `Preview sent to ${count} approvers. The link works until ${time}.`,
  previewRevoked: 'Preview link revoked.',
  caseStudyApproved: 'Approved for publishing.',
  caseStudyPublished: (title: string): string => `${title} is live.`,
  caseStudyWithdrawn: (title: string): string => `${title} withdrawn from the public site.`,
  enquirySent: (name: string, reference: string): string =>
    `Thanks, ${name}. Your enquiry ${reference} is with our studio.`,
  draftRestored: 'Your draft is restored.',
} as const;

export const refusal = {
  wrongCredentials: "That email and password don't match. Check them and try again.",
  signOffLostRace: (name: string, stage: string, time: string): string =>
    `${name} already signed off ${stage} on ${time}.`,
  shopDrawingLostRace: (name: string, reference: string, time: string): string =>
    `${name} already returned ${reference} on ${time}.`,
  newerVersion: (name: string, time: string): string =>
    `${name} saved a newer version at ${time}. Your changes weren't saved; they're shown beside the latest version.`,
  sessionEnded: "Your session ended. Sign in again and we'll put your draft back.",
  accessRemoved: 'Your access to this workspace was removed. Anything unsaved was discarded.',
  notFound: "We couldn't find that. It may have been removed, or you may not have access.",
  forbidden: "Your role can't do this. Ask the studio director if you need it.",
  overApprovalLimit: (amount: string): string =>
    `This variation is over your approval limit of ${amount}. Ask the studio director to approve it.`,
  ownVariation: 'You raised this variation, so someone else has to decide it.',
  variationIllegal: (number: string, actionPast: string, stateWord: string): string =>
    `Variation ${number} can't be ${actionPast} because it's already ${stateWord}. It's back as it was.`,
  closedSnagMoved: (number: number): string =>
    `Snag ${number} is closed, so it can't be moved. It's back where it was.`,
  otherIllegal: (stateWord: string): string => `That can't be done while this is ${stateWord}.`,
  refusedUpload: (fileName: string, fieldError: string): string =>
    `${fileName} wasn't uploaded: ${fieldError}`,
  lateBid: (closeTime: string): string =>
    `This tender closed at ${closeTime}. Late bids and amendments can't be accepted.`,
  bidsNotYetOpenable: (closeTime: string): string => `Bids can be opened from ${closeTime}.`,
  unpricedExclusions: (count: number): string =>
    `Price every exclusion before awarding. ${count} are still unpriced.`,
  defectsPeriodRunning: (defectsEndOn: string): string =>
    `Final retention can be released after ${formatDate(defectsEndOn)}.`,
  reusedRetryKey:
    "This retry doesn't match the variation it's retrying. Reload and check your variations.",
  tenderLinkSpent: 'This sign-in link has expired or has already been used.',
  enquiryRateLimit: (email: string, seconds: number): string =>
    `You've sent 3 enquiries from ${email} recently. Please try again in ${
      seconds === 1 ? '1 second' : `${seconds} seconds`
    }.`,
  billingOutage: (stage: string): string =>
    `Billing is unreachable, so ${stage} wasn't signed off. Nothing was recorded; try again in a few minutes.`,
  storageOutageUpload: (fileName: string): string =>
    `File storage is unreachable, so ${fileName} wasn't uploaded. Nothing was saved.`,
  storageOutageTransmittal:
    "File storage is unreachable, so the set wasn't issued. No transmittal was created.",
  storageOutageDownload: 'File storage is unreachable. Try the download again in a few minutes.',
  networkFailure:
    "We couldn't reach Plumbline. Check your connection; nothing was saved. Try again and we'll make sure it only happens once.",
} as const;
