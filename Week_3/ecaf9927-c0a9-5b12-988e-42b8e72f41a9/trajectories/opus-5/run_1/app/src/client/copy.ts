export const COPY = {
  signingIn: 'Signing in\u2026',
  signIn: 'Sign in',
  saving: 'Saving\u2026',
  stored: 'Stored',
  notStored: 'Not stored',
  noBody: 'No body',
  noBodyYet: 'No body yet',
  noStoredBodyYet: 'No stored body yet',
  confirmed: 'Confirmed',
  preview: 'Preview',
  fullyHeld: 'Fully held',
  extruding: 'Extruding\u2026',
  confirmExtrude: 'Confirm extrude',
  adding: 'Adding\u2026',
  add: 'Add',
  storageOutage:
    'Storage is unreachable. Changes are kept, but parts are marked Not stored until a save reaches storage.',
  bodyViewUnavailable: 'Body view unavailable while storage is unreachable.',
  noAnswer: 'No answer from the server. Your change was not confirmed.',
  dash: '\u2014',
} as const;

export function slackReadout(slack: number): string {
  return slack === 0 ? COPY.fullyHeld : `Slack ${slack}`;
}

export function constraintAdded(label: string, slack: number): string {
  return slack === 0 ? `${label} added. ${COPY.fullyHeld}.` : `${label} added. Slack ${slack}.`;
}

export function constraintRedundant(label: string): string {
  return `${label} added and marked redundant.`;
}

export function featureAdded(name: string): string {
  return `${name} added.`;
}

export function instanceAdded(name: string, quantity: number, assemblyName: string): string {
  return `${name} \u00d7${quantity} added to ${assemblyName}.`;
}
