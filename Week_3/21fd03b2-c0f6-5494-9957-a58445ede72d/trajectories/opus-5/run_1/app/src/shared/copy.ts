/** Every piece of user-facing copy named in the brief, in one place. */

export const fieldCopy = {
  displayName: 'Enter a name of 1 to 60 characters.',
  email: 'Enter a valid email address.',
  emailTaken: 'An account already uses this email.',
  password: 'Use 10 to 128 characters.',
  name: 'Names need 1 to 60 characters.',
  checkpointNameTaken: 'A checkpoint with this name already exists.',
  notANumber: 'Enter a number.',
  massUnit: 'Use kg, g or lb.',
  lengthUnit: 'Use m, cm, mm, in or ft.',
  angleUnit: 'Use deg or rad.',
  transform: 'Keep objects within 500 m of the origin and scale between 0.01 and 100.',
  uploadType: 'Upload a GLB, glTF, PNG or JPEG file.',
  uploadDamaged: 'This model file is damaged or is not glTF 2.0.',
  uploadExternal: 'Models must be self-contained: embed every buffer and texture.',
  uploadName: 'Use a file name of 1 to 120 characters without slashes, backslashes or "..".',
  uploadUnit: 'Choose m, cm, mm, in or ft.',
  uploadExtent: 'After converting to metres the model must measure from 0.01 m to 100 m across.',
  uploadTooLarge: 'Files must be 10,000,000 bytes or smaller.',
  steps: 'Steps must be from 1 to 12000.',
  exposed: 'Choose up to 8 parameters from this scene.',
  role: 'Choose Editor or Viewer.',
  signInFailed: 'Email or password is incorrect.',
} as const;

export function rangeCopy(min: string, max: string): string {
  return `Enter a value from ${min} to ${max}.`;
}

export function unexposedCopy(key: string): string {
  return `${key} is not adjustable in this lab.`;
}

export const saveStatusCopy = {
  pending: 'Saving...',
  saved: 'All changes saved',
  offline: 'Offline: changes will save when you reconnect.',
  revisionConflict: 'Not saved: this scene changed elsewhere',
  leaseLost: (objectName: string) => `Not saved: your hold on ${objectName} ran out`,
  lockOutage: 'Not saved: live editing is paused',
  demoted: 'Not saved: you can no longer edit this scene.',
  fieldError: 'Not saved: check the highlighted value',
  restored: (label: string) => `Restored checkpoint ${label}`,
  restoreRefused: 'Restore blocked while others are editing objects',
} as const;

export const collaborationCopy = {
  joined: (name: string) => `${name} joined the scene`,
  left: (name: string) => `${name} left the scene`,
  editing: (name: string, objectName: string) => `${name} is now editing ${objectName}`,
  free: (objectName: string) => `${objectName} is free to edit`,
  roleChanged: (name: string, role: string) => `${name} is now ${role}`,
} as const;

export function lockNoticeCopy(name: string, objectName: string): string {
  return `${name} is editing ${objectName}. You can view it but cannot change it until they finish.`;
}

export const noticeCopy = {
  invitePending: 'Sending invite...',
  inviteSent: (email: string) => `Invite sent to ${email}`,
  inviteQueued: (email: string) =>
    `Invite saved for ${email}. The email will go out when mail is back.`,
  inviteRevoked: (email: string) => `Invite to ${email} revoked`,
  roleChanged: (name: string, role: string) => `${name} is now ${role}`,
  created: (name: string) => `${name} created`,
  checkpointPending: 'Saving checkpoint...',
  checkpointSaved: (label: string) => `Checkpoint ${label} saved`,
  publishPending: 'Publishing...',
  published: (address: string) => `Lab published at ${address}`,
  publishedQueued: (address: string) =>
    `Lab published at ${address}. The confirmation email will go out when mail is back.`,
  publishNoCheckpoint: 'Save a checkpoint before publishing.',
  unpublished: 'Lab unpublished. Its link no longer works.',
  labLinkRegenerated: 'New lab link created. The old link no longer works.',
  linkCreated: 'Link created',
  linkEmailed: (email: string) => `Link emailed to ${email}`,
  linkEmailQueued: (email: string) =>
    `Link created. The email to ${email} will go out when mail is back.`,
  linkRegenerated: 'New link created. The old link no longer works.',
  linkRevoked: 'Link revoked',
  copied: 'Copied',
  loading: 'Loading...',
  showing: (count: number) => `Showing ${count} events`,
} as const;

export const uploadStatusCopy = {
  pending: (fileName: string) => `Uploading ${fileName}...`,
  success: (fileName: string, folder: string) => `${fileName} added to ${folder}`,
  replay: (fileName: string) => `${fileName} is already in this project`,
  storageOutage: 'File storage is unreachable. Nothing was uploaded.',
} as const;

export const bannerCopy = {
  locks: 'Live editing is paused because the lock service is unreachable. You can still run the scene.',
  storage: 'File storage is unreachable. Uploads, checkpoints and publishing are paused.',
} as const;

export const emptyCopy = {
  projects: 'No projects yet. Create one to start a bench.',
  scenes: 'This project has no scenes yet.',
  outline: 'No objects. Add one from Props.',
  assetFolder: 'This folder is empty. Drop a GLB, glTF, PNG or JPEG file here.',
  models: 'No models yet. Upload one in Assets.',
  checkpoints: 'No checkpoints yet.',
  activity: 'No activity yet.',
  links: 'No active links.',
  presenceDown: 'Presence unavailable',
} as const;

export const pageCopy = {
  missingLabHeading: "We couldn't find this lab",
  missingLabBody: 'The link may have been withdrawn or replaced. Ask your tutor for a new one.',
  labStorageHeading: 'This lab cannot load right now',
  labStorageBody: 'Try again in a minute.',
  deadLink: 'This link no longer works. Ask the owner for a new one.',
  notFound: "We couldn't find that page",
  noWebgl:
    'The 3D stage needs WebGL, which this browser cannot provide. Panels still work; Run is unavailable.',
  loading: 'Loading...',
  problem: 'There is a problem',
} as const;

export const inviteScreenCopy = {
  expired: 'This invite has expired. Ask for a new one.',
  revoked: 'This invite was withdrawn.',
  superseded: 'This invite was replaced by a newer one. Use the latest email.',
  used: 'This invite has already been used.',
  mismatch: (email: string) =>
    `This invite is for ${email}. Sign in with that address to accept it.`,
} as const;

export const landingCopy = {
  title: 'Rampwright',
  sections: [
    'Every number in metres, kilograms and seconds',
    "The same run on every student's screen",
    'Stop, and the bench is exactly as you left it',
  ],
} as const;
