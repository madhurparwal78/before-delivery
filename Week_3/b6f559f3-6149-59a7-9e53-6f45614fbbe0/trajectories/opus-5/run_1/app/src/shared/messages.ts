import { megabytes } from './format';

export const MSG = {
  unauthenticated: 'Sign in to continue.',
  notFound: 'Not found.',
  crossOrigin: 'Requests must come from this site.',
  unsupportedMediaType: 'Send application/json.',
  badCredentials: 'Email or password is incorrect.',
  viewerCantEdit: "Viewers can't edit this project.",
  ownerOnlyPublish: 'Only the owner can publish.',
  ownerOnlyMembers: 'Only the owner can manage members.',
  immutable: "Published versions can't be changed.",
  nothingToUndo: 'Nothing to undo',
  nothingToRedo: 'Nothing to redo',
  undone: 'Undone',
  redone: 'Redone',
  trashed: 'This project is in the trash. Restore it to edit.',
  alreadyTrashed: 'This project is already in the trash.',
  notTrashed: 'This project is not in the trash.',
  idempotencyConflict: 'This key was already used for a different request.',
  uploadNotReady: "This upload isn't ready yet.",
  storageUploads: 'Storage is unavailable, so uploads are paused. Published scenes still play.',
  storagePublishing: 'Storage is unavailable, so publishing is paused. Published scenes still play.',
  inviteUnavailable: 'This invite link has already been used or has expired.',
  shortPassword: 'Choose a password of at least 10 characters.',
  enterEmail: 'Enter a valid email address.',
  enterName: 'Enter a name.',
  variableName:
    'Use a lowercase letter first, then lowercase letters, digits or _ (at most 32 characters).',
  colourFormat: 'Use a colour like #RRGGBB.',
  gradientStops: 'A gradient needs between 2 and 8 stops.',
  chooseProperty: 'Choose a property first.',
  chooseEasing: 'Choose one of the listed easings.',
  notPublished: 'This scene is not published.',
  connectionLost: 'Connection lost — reconnecting',
  reconnected: 'Reconnected',
  saving: 'Saving…',
  saved: 'All changes saved',
  notSaved: 'Not saved — retrying',
  embedCopied: 'Embed code copied.',
  imageKind: 'Only PNG, JPEG and WebP images are supported.',
  svgNotSvg: 'This file is not an SVG.',
  svgStraightOnly: 'Only straight-line path commands (M, L, H, V, Z) are supported.',
  svgSelfCrossing: 'The path crosses itself.',
  modelNotValid: 'This file is not a valid glTF or GLB file.',
  modelVersion: 'Only glTF 2.0 files are supported.',
  modelExternalUri: 'External buffer URIs are not supported: embed buffers in the file.',
  modelMatrix: 'Node matrices are not supported; use translation, rotation and scale.',
  modelCubicSpline:
    'Animation interpolation CUBICSPLINE is not supported; use LINEAR or STEP.',
  importNotJson: 'This file is not valid JSON.',
  importMissingSchema: 'Missing field: schemaVersion',
  wrongPerson: (email: string): string => `This invite was sent to ${email}. Sign out to accept it.`,
} as const;

export const copy = {
  mustBeBetween: (min: number | string, max: number | string): string =>
    `Must be between ${min} and ${max}.`,
  variableExists: (name: string): string => `A variable named ${name} already exists.`,
  notInFont: (character: string): string =>
    `Character "${character}" is not in the built-in outline font.`,
  layerLocked: (layerName: string): string => `${layerName} is locked.`,
  layerHeld: (holderName: string): string => `${holderName} is editing this layer.`,
  notOverridable: (field: string): string => `${field} can't differ between breakpoints.`,
  tooLarge: (limit: number): string => `Request body is larger than ${limit} bytes.`,
  alreadyMember: (email: string): string => `${email} is already a member.`,
  invitePending: (email: string): string => `An invite to ${email} is already pending.`,
  publishLimit: (limit: number): string =>
    `This project has reached its limit of ${limit} published versions.`,
  imageTooLarge: (bytes: number, limit: number): string =>
    `This image is ${megabytes(bytes)} MB; the limit is ${megabytes(limit)} MB.`,
  imageTooBig: (width: number, height: number, limit: number): string =>
    `This image is ${width} × ${height} px; the limit is ${limit} px per side.`,
  modelTooLarge: (bytes: number, limit: number): string =>
    `This file is ${megabytes(bytes)} MB; the limit is ${megabytes(limit)} MB.`,
  modelCompressed: (extension: string): string =>
    `Compressed meshes (${extension}) are not supported.`,
  modelTooManyVertices: (count: number, limit: number): string =>
    `This model has ${count} vertices; the limit is ${limit}.`,
  svgPathCount: (count: number): string =>
    `This SVG has ${count} paths. Extrusion needs exactly one path.`,
  importSchemaVersion: (version: number): string =>
    `This file uses schema version ${version}; this app reads up to version 3.`,
  importMissingField: (path: string): string => `Missing field: ${path}`,
  importUnknownKind: (kind: string, path: string): string =>
    `Unknown layer kind "${kind}" at ${path}.`,
  importOutOfRange: (path: string, value: string, min: number | string, max: number | string): string =>
    `Value out of range: ${path} is ${value} (allowed ${min} to ${max}).`,
  inviteSent: (email: string): string => `Invite sent to ${email}.`,
  keyframeAdded: (time: string): string => `Keyframe added at ${time}`,
  versionLive: (n: number): string => `Version ${n} is live.`,
  movedToTrash: (name: string): string => `Moved ${name} to the trash.`,
  restored: (name: string): string => `Restored ${name}.`,
  imported: (name: string): string => `Created ${name} (imported).`,
  importing: (fileName: string): string => `Importing ${fileName}…`,
  uploading: (fileName: string): string => `Uploading ${fileName}…`,
  uploadReady: (fileName: string): string => `${fileName} is ready.`,
  variableDeleted: (name: string, count: number): string =>
    `Deleted ${name}. ${count} ${count === 1 ? 'property keeps' : 'properties keep'} its last value.`,
  presetApplied: (name: string): string => `Applied ${name}.`,
  storageMissing: (layerName: string): string => `${layerName} (storage unavailable)`,
};
