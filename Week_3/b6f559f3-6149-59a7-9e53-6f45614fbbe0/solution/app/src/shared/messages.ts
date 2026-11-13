/** Every refusal, status and notice text of the product. Nothing else writes user-facing copy. */

export const MESSAGES = {
  unauthenticated: 'Sign in to continue.',
  notFound: 'Not found.',
  viewerRefusal: "Viewers can't edit this project.",
  publishRefusal: 'Only the owner can publish.',
  memberRefusal: 'Only the owner can manage members.',
  trashed: 'This project is in the trash. Restore it to edit.',
  alreadyTrashed: 'This project is already in the trash.',
  notTrashed: 'This project is not in the trash.',
  nothingToUndo: 'Nothing to undo',
  nothingToRedo: 'Nothing to redo',
  idempotencyConflict: 'This key was already used for a different request.',
  immutable: "Published versions can't be changed.",
  crossOrigin: 'Requests must come from this site.',
  badCredentials: 'Email or password is incorrect.',
  unsupportedMedia: 'Send application/json.',
  sendMultipart: 'Send multipart/form-data.',
  serviceStarting: 'The service is starting. Try again shortly.',
  internalError: 'Something went wrong.',
  validEmail: 'Enter a valid email address.',
  inviteGone: 'This invite link has already been used or has expired.',
  passwordShort: 'Choose a password of at least 10 characters.',
  enterName: 'Enter a name.',
  variableName: 'Use a lowercase letter first, then lowercase letters, digits or _ (at most 32 characters).',
  colour: 'Use a colour like #RRGGBB.',
  gradientStops: 'A gradient needs between 2 and 8 stops.',
  easing: 'Choose one of the listed easings.',
  uploadNotReady: "This upload isn't ready yet.",
  storageUploads: 'Storage is unavailable, so uploads are paused. Published scenes still play.',
  storagePublish: 'Storage is unavailable, so publishing is paused. Published scenes still play.',
  unknownField: 'Unknown field.',
  unknownLayer: 'Unknown layer.',
  unknownVariable: 'Unknown variable.',
  unknownPreset: 'Unknown preset.',
  invalidValue: 'Enter a valid value.',
  notAnImage: 'Only PNG, JPEG and WebP images are supported.',
  notSvg: 'This file is not an SVG.',
  svgCommands: 'Only straight-line path commands (M, L, H, V, Z) are supported.',
  svgCrossing: 'The path crosses itself.',
  gltfInvalid: 'This file is not a valid glTF or GLB file.',
  gltfVersion: 'Only glTF 2.0 files are supported.',
  gltfExternal: 'External buffer URIs are not supported: embed buffers in the file.',
  gltfMatrix: 'Node matrices are not supported; use translation, rotation and scale.',
  gltfCubicSpline: 'Animation interpolation CUBICSPLINE is not supported; use LINEAR or STEP.',
  jsonInvalid: 'This file is not valid JSON.',
  missingSchemaVersion: 'Missing field: schemaVersion',
  saving: 'Saving…',
  saved: 'All changes saved',
  notSaved: 'Not saved — retrying',
  reconnected: 'Reconnected',
  connectionLost: 'Connection lost — reconnecting',
  undone: 'Undone',
  redone: 'Redone',
  chooseProperty: 'Choose a property first.',
  embedCopied: 'Embed code copied.',
  noticeSent: 'Notice sent',
  noticeQueued: 'Notice queued — mail is unavailable',
  inviteSentRow: 'Invite sent',
  inviteQueuedRow: 'Invite queued — mail is unavailable',
  notPublished: 'This scene is not published.',
  signingIn: 'Signing in…',
  joining: 'Joining…',
  sending: 'Sending…',
  publishing: 'Publishing…',
} as const;

export const mustBeBetween = (min: number, max: number): string => `Must be between ${min} and ${max}.`;
export const layerHeld = (holder: string): string => `${holder} is editing this layer.`;
export const layerLocked = (layer: string): string => `${layer} is locked.`;
export const differsByBreakpoint = (field: string): string => `${field} can't differ between breakpoints.`;
export const variableExists = (name: string): string => `A variable named ${name} already exists.`;
export const characterRefused = (character: string): string =>
  `Character "${character}" is not in the built-in outline font.`;
export const publishLimit = (limit: number): string =>
  `This project has reached its limit of ${limit} published versions.`;
export const tooLarge = (limit: number): string => `Request body is larger than ${limit} bytes.`;
export const alreadyMember = (email: string): string => `${email} is already a member.`;
export const alreadyPending = (email: string): string => `An invite to ${email} is already pending.`;
export const wrongPerson = (email: string): string => `This invite was sent to ${email}. Sign out to accept it.`;
export const svgPaths = (count: number): string => `This SVG has ${count} paths. Extrusion needs exactly one path.`;
export const gltfCompressed = (extension: string): string => `Compressed meshes (${extension}) are not supported.`;
export const gltfVertices = (count: number, limit: number): string =>
  `This model has ${count} vertices; the limit is ${limit}.`;
export const schemaTooNew = (version: number, supported: number): string =>
  `This file uses schema version ${version}; this app reads up to version ${supported}.`;
export const missingField = (path: string): string => `Missing field: ${path}`;
export const unknownKind = (kind: string, path: string): string => `Unknown layer kind "${kind}" at ${path}.`;
export const outOfRange = (path: string, value: number, min: number, max: number): string =>
  `Value out of range: ${path} is ${value} (allowed ${min} to ${max}).`;

const megabytes = (bytes: number): string => (bytes / 1048576).toFixed(1);
export const fileTooLarge = (bytes: number, limit: number): string =>
  `This file is ${megabytes(bytes)} MB; the limit is ${megabytes(limit)} MB.`;
export const imageTooLarge = (bytes: number, limit: number): string =>
  `This image is ${megabytes(bytes)} MB; the limit is ${megabytes(limit)} MB.`;
export const imageDimensions = (width: number, height: number, limit: number): string =>
  `This image is ${width} × ${height} px; the limit is ${limit} px per side.`;

export const keyframeAdded = (time: string): string => `Keyframe added at ${time}`;
export const uploading = (file: string): string => `Uploading ${file}…`;
export const uploadReady = (file: string): string => `${file} is ready.`;
export const versionLive = (number: number): string => `Version ${number} is live.`;
export const inviteSent = (email: string): string => `Invite sent to ${email}.`;
export const variableDeleted = (name: string, count: number): string =>
  count === 1 ? `Deleted ${name}. 1 property keeps its last value.` : `Deleted ${name}. ${count} properties keep its last value.`;
export const presetApplied = (name: string): string => `Applied ${name}.`;
export const movedToTrash = (name: string): string => `Moved ${name} to the trash.`;
export const restored = (name: string): string => `Restored ${name}.`;
export const importing = (file: string): string => `Importing ${file}…`;
export const importCreated = (name: string): string => `Created ${name} (imported).`;
export const clamped = (limit: number): string => `Clamped to ${limit}`;
export const boundTo = (name: string): string => `Bound to ${name}`;
export const heldBy = (name: string): string => `Held by ${name}`;
export const isHere = (name: string): string => `${name} is here`;
export const joinHeading = (project: string, role: string): string => `Join ${project} as ${role}`;
export const inviteSubject = (project: string): string => `Join ${project} in Halation Studio`;
export const noticeSubject = (project: string, version: number): string => `${project} version ${version} is live`;
export const counts = (editors: number, viewers: number): string =>
  `${editors} ${editors === 1 ? 'editor' : 'editors'} · ${viewers} ${viewers === 1 ? 'viewer' : 'viewers'}`;
export const layerCount = (count: number): string => `${count} ${count === 1 ? 'layer' : 'layers'}`;
