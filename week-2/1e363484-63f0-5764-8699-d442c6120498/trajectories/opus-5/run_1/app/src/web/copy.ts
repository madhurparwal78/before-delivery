/** Every piece of visible copy the brief publishes, in one place. */
export const COPY = {
  signInFailed: 'That email and password do not match.',
  noReadings: 'No readings have been ingested for this project yet.',
  windowOrder: 'The To date must be on or after the From date.',
  previewFailed: 'Could not load the figure for this interval. Move the brush to try again.',
  settledSealable: (coverage: string, net: string) =>
    `Coverage ${coverage}%, net ${net} tCO2e. Seal available.`,
  settledBelowFloor: (coverage: string, net: string, floor: string) =>
    `Coverage ${coverage}%, net ${net} tCO2e. Below the ${floor}% floor.`,
  settledBlocked: (coverage: string, net: string) =>
    `Coverage ${coverage}%, net ${net} tCO2e. Seal unavailable.`,
  belowFloorReason: (coverage: string, floor: string) =>
    `Coverage ${coverage}% is below this project's ${floor}% floor, so this figure cannot be sealed.`,
  analystRole: 'Your role on this project can preview figures but not seal them.',
  viewerRole: 'Your role on this project can view sealed figures but not preview new ones.',
  lostAccess: 'You no longer have access to this project.',
  overlapsSealed: (figureId: string) =>
    `This interval overlaps sealed figure ${figureId}. Choose an interval that does not overlap it.`,
  alreadySealed: (figureId: string) => `This interval is already sealed as ${figureId}.`,
  readingsChanged:
    'Readings in this interval changed since the preview. Check the new figure before sealing.',
  sealingLabel: 'Sealing...',
  sealingStatus: 'Sealing figure. Waiting for evidence storage to confirm.',
  sealed: (figureId: string, net: string, coverage: string) =>
    `Sealed ${figureId}: ${net} tCO2e at ${coverage}% coverage.`,
  sealedSupersedes: (figureId: string, net: string, coverage: string, oldFigureId: string) =>
    `Sealed ${figureId}: ${net} tCO2e at ${coverage}% coverage. Supersedes ${oldFigureId}.`,
  storageUnavailable:
    'Evidence storage is unreachable, so nothing was sealed. Try again in a few minutes.',
  mailUnavailable:
    'The seal notice could not be sent, so nothing was sealed. Try again in a few minutes.',
  noAnswer: 'No answer from the server yet. Confirm seal again to retry safely.',
  sealBroken: (figureId: string) =>
    `Seal broken on ${figureId}. Its tonnes have been reversed in the ledger.`,
  brokenBanner: (moved: number) =>
    `Seal broken. Readings moved since sealing: ${moved}. Its tonnes have been reversed in the ledger.`,
  supersededBy: (figureId: string) => `Superseded by ${figureId}.`,
  auditEmpty: 'No readings have moved since this figure was sealed.',
  linkIssued: (expires: string) => `Regulator link issued. It expires ${expires}.`,
  linkRevoked: 'Link revoked.',
  linkNotIssuable: 'Only an intact sealed figure can have a regulator link.',
  linkAlreadyExpired: 'This link has already expired.',
  rederivePending: 'Re-deriving from the stored readings.',
  rederiveDone: (checked: string, verdict: string) => `Re-derived at ${checked}: ${verdict}.`,
  rederiveFailed: 'Could not re-derive right now. Try again in a few minutes.',
  evidenceUnavailable:
    'The readings file is unavailable while evidence storage is unreachable. Try again in a few minutes.',
  evidenceMismatch: "The stored readings file does not match this figure's fingerprint.",
  expiredLink: {
    heading: 'This link has expired',
    line: 'Ask the project team for a new link.',
  },
  revokedLink: {
    heading: 'This link was revoked',
    line: 'The project team withdrew this link.',
  },
  unknownLink: {
    heading: 'No sealed figure is published at this link',
    line: 'Check the address you were given.',
  },
  grantSaved: (person: string, project: string, role: string) =>
    `Saved access for ${person} on ${project}: ${role}.`,
  grantFailed: 'Access was not changed. Try again.',
} as const;

export const ROLE_LABELS = {
  none: 'No access',
  viewer: 'Viewer',
  analyst: 'Analyst',
  sealer: 'Sealer',
} as const;
