// Every published piece of copy, in one place. The API messages, the
// inspector notices and the screen text all come from here.

export const COPY = {
  // Errors, by code
  unauthenticated: 'Sign in to continue.',
  notFound: 'Not found.',
  badCredentials: 'Email or password is incorrect.',
  crossOrigin: 'Requests must come from this site.',
  unsupportedMediaType: 'Send application/json.',
  layerHeld: (name: string) => `${name} is editing this layer.`,
  layerLocked: (name: string) => `${name} is locked.`,
  trashed: 'This project is in the trash. Restore it to edit.',
  alreadyTrashed: 'This project is already in the trash.',
  notTrashed: 'This project is not in the trash.',
  nothingToUndo: 'Nothing to undo',
  nothingToRedo: 'Nothing to redo',
  idempotencyConflict: 'This key was already used for a different request.',
  viewerEdit: "Viewers can't edit this project.",
  ownerPublish: 'Only the owner can publish.',
  ownerMembers: 'Only the owner can manage members.',
  immutable: "Published versions can't be changed.",
  inviteUnavailable: 'This invite link has already been used or has expired.',
  wrongPerson: (email: string) => `This invite was sent to ${email}. Sign out to accept it.`,
  publishLimit: (n: number) => `This project has reached its limit of ${n} published versions.`,
  storageOutage:
    'Storage is unavailable, so uploads are paused. Published scenes still play.',
  publishOutage:
    'Storage is unavailable, so publishing is paused. Published scenes still play.',
  importOutage: 'Storage is unavailable, so imports are paused. Published scenes still play.',
  embedUnpublished: 'This scene is not published.',
  uploadNotReady: "This upload isn't ready yet.",
  invalidEmail: 'Enter a valid email address.',
  alreadyMember: (email: string) => `${email} is already a member.`,
  invitePending: (email: string) => `An invite to ${email} is already pending.`,
  shortPassword: 'Choose a password of at least 10 characters.',
  enterName: 'Enter a name.',
  mustBeBetween: (min: number, max: number) => `Must be between ${min} and ${max}.`,
  variableNamePattern:
    'Use a lowercase letter first, then lowercase letters, digits or _ (at most 32 characters).',
  variableExists: (name: string) => `A variable named ${name} already exists.`,
  colourFormat: 'Use a colour like #RRGGBB.',
  gradientStops: 'A gradient needs between 2 and 8 stops.',
  fontChar: (c: string) => `Character "${c}" is not in the built-in outline font.`,
  notOverridable: (field: string) => `${field} can't differ between breakpoints.`,
  chooseEasing: 'Choose one of the listed easings.',
  chooseProperty: 'Choose a property first.',
  svgNotSvg: 'This file is not an SVG.',
  svgPathCount: (n: number) => `This SVG has ${n} paths. Extrusion needs exactly one path.`,
  svgCommands: 'Only straight-line path commands (M, L, H, V, Z) are supported.',
  svgCrosses: 'The path crosses itself.',
  imageKind: 'Only PNG, JPEG and WebP images are supported.',
  imageSize: (mb: string, limit: string) => `This image is ${mb} MB; the limit is ${limit} MB.`,
  imageDimension: (w: number, h: number, d: number) =>
    `This image is ${w} × ${h} px; the limit is ${d} px per side.`,
  modelSize: (mb: string, limit: string) => `This file is ${mb} MB; the limit is ${limit} MB.`,
  modelInvalid: 'This file is not a valid glTF or GLB file.',
  modelVersion: 'Only glTF 2.0 files are supported.',
  modelCompression: (ext: string) => `Compressed meshes (${ext}) are not supported.`,
  modelExternal: 'External buffer URIs are not supported: embed buffers in the file.',
  modelMatrix: 'Node matrices are not supported; use translation, rotation and scale.',
  modelCubicspline:
    'Animation interpolation CUBICSPLINE is not supported; use LINEAR or STEP.',
  modelVertices: (n: number, limit: number) =>
    `This model has ${n} vertices; the limit is ${limit}.`,
  importInvalidJson: 'This file is not valid JSON.',
  importMissing: (path: string) => `Missing field: ${path}`,
  importSchema: (n: number) => `This file uses schema version ${n}; this app reads up to version 3.`,
  importKind: (kind: string, path: string) => `Unknown layer kind "${kind}" at ${path}.`,
  importRange: (path: string, value: string, min: number | string, max: number | string) =>
    `Value out of range: ${path} is ${value} (allowed ${min} to ${max}).`,
  tooLarge: (limit: number) => `Request body is larger than ${limit} bytes.`,

  // Status and success
  saving: 'Saving…',
  saved: 'All changes saved',
  notSaved: 'Not saved — retrying',
  reconnected: 'Reconnected',
  connectionLost: 'Connection lost — reconnecting',
  undone: 'Undone',
  redone: 'Redone',
  keyframeAdded: (t: string) => `Keyframe added at ${t}`,
  uploading: (name: string) => `Uploading ${name}…`,
  uploaded: (name: string) => `${name} is ready.`,
  publishing: 'Publishing…',
  versionLive: (n: number) => `Version ${n} is live.`,
  noticeSent: 'Notice sent',
  noticeQueued: 'Notice queued — mail is unavailable',
  sending: 'Sending…',
  inviteSent: (email: string) => `Invite sent to ${email}.`,
  inviteQueuedRow: 'Invite queued — mail is unavailable',
  joining: 'Joining…',
  signingIn: 'Signing in…',
  appliedPreset: (name: string) => `Applied ${name}.`,
  embedCopied: 'Embed code copied.',
  trashedMsg: (name: string) => `Moved ${name} to the trash.`,
  restoredMsg: (name: string) => `Restored ${name}.`,
  importing: (name: string) => `Importing ${name}…`,
  imported: (name: string) => `Created ${name} (imported).`,
  variableDeleted: (name: string, n: number) =>
    n === 1
      ? `Deleted ${name}. 1 property keeps its last value.`
      : `Deleted ${name}. ${n} properties keep its last value.`,
} as const;

export function mbLabel(bytes: number): string {
  return (bytes / 1048576).toFixed(1);
}
