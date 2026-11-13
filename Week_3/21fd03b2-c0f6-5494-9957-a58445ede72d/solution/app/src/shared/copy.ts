/** Every user-facing sentence the brief pins, written once and shared by the server and the browser. */
export const COPY = {
  displayName: "Enter a name of 1 to 60 characters.",
  email: "Enter a valid email address.",
  emailTaken: "An account already uses this email.",
  password: "Use 10 to 128 characters.",
  names: "Names need 1 to 60 characters.",
  checkpointTaken: "A checkpoint with this name already exists.",
  notANumber: "Enter a number.",
  massUnit: "Use kg, g or lb.",
  lengthUnit: "Use m, cm, mm, in or ft.",
  angleUnit: "Use deg or rad.",
  transform: "Keep objects within 500 m of the origin and scale between 0.01 and 100.",
  uploadType: "Upload a GLB, glTF, PNG or JPEG file.",
  uploadDamaged: "This model file is damaged or is not glTF 2.0.",
  uploadExternal: "Models must be self-contained: embed every buffer and texture.",
  uploadName: 'Use a file name of 1 to 120 characters without slashes, backslashes or "..".',
  uploadUnit: "Choose m, cm, mm, in or ft.",
  uploadExtent: "After converting to metres the model must measure from 0.01 m to 100 m across.",
  uploadTooLarge: "Files must be 10,000,000 bytes or smaller.",
  steps: "Steps must be from 1 to 12000.",
  exposed: "Choose up to 8 parameters from this scene.",
  role: "Choose Editor or Viewer.",
  badCredentials: "Email or password is incorrect.",
  unexposed: (key: string) => `${key} is not adjustable in this lab.`,
  range: (min: number, max: number) => `Enter a value from ${min} to ${max}.`,
} as const;

export const SAVE = {
  pending: "Saving...",
  success: "All changes saved",
  offline: "Offline: changes will save when you reconnect.",
  conflict: "Not saved: this scene changed elsewhere",
  leaseLost: (name: string) => `Not saved: your hold on ${name} ran out`,
  lockOutage: "Not saved: live editing is paused",
  demoted: "Not saved: you can no longer edit this scene.",
  fieldError: "Not saved: check the highlighted value",
  restored: (label: string) => `Restored checkpoint ${label}`,
  restoreRefused: "Restore blocked while others are editing objects",
} as const;

export const BANNER = {
  locks: "Live editing is paused because the lock service is unreachable. You can still run the scene.",
  storage: "File storage is unreachable. Uploads, checkpoints and publishing are paused.",
} as const;

export const NOTICE = {
  inviting: "Sending invite...",
  inviteSent: (email: string) => `Invite sent to ${email}`,
  inviteQueued: (email: string) => `Invite saved for ${email}. The email will go out when mail is back.`,
  inviteRevoked: (email: string) => `Invite to ${email} revoked`,
  roleChanged: (name: string, role: string) => `${name} is now ${role}`,
  created: (name: string) => `${name} created`,
  checkpointSaving: "Saving checkpoint...",
  checkpointSaved: (label: string) => `Checkpoint ${label} saved`,
  publishing: "Publishing...",
  published: (address: string) => `Lab published at ${address}`,
  publishedQueued: (address: string) => `Lab published at ${address}. The confirmation email will go out when mail is back.`,
  needCheckpoint: "Save a checkpoint before publishing.",
  unpublished: "Lab unpublished. Its link no longer works.",
  labRegenerated: "New lab link created. The old link no longer works.",
  linkCreated: "Link created",
  linkEmailed: (email: string) => `Link emailed to ${email}`,
  linkQueued: (email: string) => `Link created. The email to ${email} will go out when mail is back.`,
  linkRegenerated: "New link created. The old link no longer works.",
  linkRevoked: "Link revoked",
  copied: "Copied",
  loading: "Loading...",
  showing: (n: number) => `Showing ${n} events`,
} as const;

export const UPLOAD = {
  pending: (name: string) => `Uploading ${name}...`,
  added: (name: string, folder: string) => `${name} added to ${folder}`,
  replay: (name: string) => `${name} is already in this project`,
  storageDown: "File storage is unreachable. Nothing was uploaded.",
} as const;

export const COLLAB = {
  joined: (name: string) => `${name} joined the scene`,
  left: (name: string) => `${name} left the scene`,
  editing: (name: string, object: string) => `${name} is now editing ${object}`,
  free: (object: string) => `${object} is free to edit`,
  role: (name: string, role: string) => `${name} is now ${role}`,
} as const;

export const lockNotice = (holder: string, object: string): string =>
  `${holder} is editing ${object}. You can view it but cannot change it until they finish.`;

export const EMPTY = {
  projects: "No projects yet. Create one to start a bench.",
  scenes: "This project has no scenes yet.",
  outline: "No objects. Add one from Props.",
  folder: "This folder is empty. Drop a GLB, glTF, PNG or JPEG file here.",
  models: "No models yet. Upload one in Assets.",
  checkpoints: "No checkpoints yet.",
  activity: "No activity yet.",
  links: "No active links.",
  presenceDown: "Presence unavailable",
} as const;

export const PAGES = {
  missingLabTitle: "We couldn't find this lab",
  missingLabBody: "The link may have been withdrawn or replaced. Ask your tutor for a new one.",
  labDownTitle: "This lab cannot load right now",
  labDownBody: "Try again in a minute.",
  deadLink: "This link no longer works. Ask the owner for a new one.",
  notFound: "We couldn't find that page",
  noWebgl: "The 3D stage needs WebGL, which this browser cannot provide. Panels still work; Run is unavailable.",
  ownerOnly: "Only the workspace owner can share or publish.",
} as const;

export const INVITE_STATE = {
  expired: "This invite has expired. Ask for a new one.",
  revoked: "This invite was withdrawn.",
  superseded: "This invite was replaced by a newer one. Use the latest email.",
  used: "This invite has already been used.",
  mismatch: (email: string) => `This invite is for ${email}. Sign in with that address to accept it.`,
} as const;
