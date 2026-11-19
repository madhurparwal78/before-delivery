// Every error shape and the one published precedence order.

export const COPY = {
  crossSite: 'Cross-site request refused.',
  signIn: 'Sign in to continue.',
  sessionEnded: 'Your session has ended. Sign in again.',
  notFound: 'Not found.',
  staffOnly: 'Only desk staff can do that.',
  coordinatorOnly: 'Only the coordinator can do that.',
  membersOnly: 'Only members can do that.',
  signOutFirst: 'Sign out before joining.',
  sendJson: 'Send JSON.',
  tooLarge: 'Request is too large.',
  photoTooLarge: 'Photo must be 5,000,000 bytes or smaller.',
  formProblems: 'Check the highlighted fields.',
  wrongPeg: 'That peg belongs to a different tool.',
  emailTaken: 'An account with this email already exists.',
  badCredentials: 'Email or password is incorrect.',
  storageBanner: 'Photo storage is down. Check-ins are held as pending photo until it is back.',
  billingBanner: 'Billing is down. Joins, payments, waivers and check-ins that raise a fee will wait until it is back.',
  billingDownJoin: 'Billing is down. Nothing was charged; try again when it is back.',
  billingDownCheckin: 'Billing is down. This check-in was not saved; try again when it is back.',
  storageDownCheckout: 'Photo storage is down. The loan stays reserved; check it out when storage is back.',
  storageDownFinish: 'Photo storage is down. This check-in is still pending photo; finish it when storage is back.',
  storageDownPhoto: 'Photo storage is down.',
  membershipNotActive: 'Your membership is not active.',
  toolOnWall: 'This tool is on the wall. Ask at the desk to borrow it.',
  alreadyHold: 'You already have a hold on this tool.',
  holdNoLongerActive: 'This hold is no longer active.',
  onlyActiveCancel: 'Only an active membership can be cancelled.',
  alreadyEnding: 'This membership already ends at the end of its term.',
  loanAlreadyOut: 'This loan is already checked out.',
  onlyReservedCancel: 'Only a reserved loan can be cancelled.',
  notCheckedOut: 'This loan has not been checked out.',
  waitingForPhoto: 'This check-in is waiting for its photo.',
  alreadyCheckedIn: 'This loan is already checked in.',
  notWaitingPhoto: 'This loan is not waiting for a photo.',
  memberNotActive: "This member's membership is not active.",
  notOnWall: (tag: string) => `${tag} is not on the wall.`,
  missingPartsTool: (tag: string) => `${tag} is missing parts.`,
  heldForAnother: (tag: string) => `${tag} is held for another member.`,
  alreadyOnPeg: (part: string) => `${part} is already on its peg.`,
  feeSettled: 'This fee is already settled.',
  feeWaived: 'This fee has been waived.',
  waiverWaiting: 'A waiver request is already waiting.',
  noWaiver: 'There is no waiver request to decide.',
  dayAlreadyClosed: 'That day is already closed.',
  pastClosures: 'Past closures cannot be removed.',
  noToolsMatch: 'No tools match that search.',
  notFoundPage: "We couldn't find that page.",
} as const;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly fields?: Record<string, string>,
  ) {
    super(error);
    this.name = 'ApiError';
  }

  body(): { error: string; fields?: Record<string, string> } {
    const out: { error: string; fields?: Record<string, string> } = { error: this.error };
    if (this.fields !== undefined) out.fields = this.fields;
    return out;
  }
}

export function crossSite(): ApiError {
  return new ApiError(403, COPY.crossSite);
}
export function needsSignIn(): ApiError {
  return new ApiError(401, COPY.signIn);
}
export function sessionEnded(): ApiError {
  return new ApiError(401, COPY.sessionEnded);
}
export function notFound(): ApiError {
  return new ApiError(404, COPY.notFound);
}
export function staffOnly(): ApiError {
  return new ApiError(403, COPY.staffOnly);
}
export function coordinatorOnly(): ApiError {
  return new ApiError(403, COPY.coordinatorOnly);
}
export function membersOnly(): ApiError {
  return new ApiError(403, COPY.membersOnly);
}
export function signOutFirst(): ApiError {
  return new ApiError(403, COPY.signOutFirst);
}
export function sendJson(): ApiError {
  return new ApiError(415, COPY.sendJson);
}
export function tooLarge(): ApiError {
  return new ApiError(413, COPY.tooLarge);
}
export function photoTooLarge(): ApiError {
  return new ApiError(413, COPY.photoTooLarge);
}
export function validation(fields: Record<string, string>): ApiError {
  return new ApiError(422, COPY.formProblems, fields);
}
export function conflict(message: string): ApiError {
  return new ApiError(409, message);
}
export function providerDown(message: string): ApiError {
  return new ApiError(503, message);
}
