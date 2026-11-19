/** Every piece of user-facing copy lives here once; server and browser both read it. */

export type ErrorCode =
  | 'unsupported_media'
  | 'too_large'
  | 'signed_out'
  | 'removed'
  | 'too_many_attempts'
  | 'rate_limited'
  | 'not_found'
  | 'forbidden'
  | 'email_unverified'
  | 'email_taken'
  | 'bad_credentials'
  | 'link_expired'
  | 'already_verified'
  | 'unknown_code'
  | 'join_closed'
  | 'classroom_full'
  | 'nickname_taken'
  | 'classroom_handed_in'
  | 'project_handed_in'
  | 'classroom_not_started'
  | 'classroom_archived'
  | 'not_handed_in'
  | 'owner_cannot_leave'
  | 'already_added'
  | 'no_such_educator'
  | 'stale_revision'
  | 'idempotency_conflict'
  | 'not_a_classroom_project'
  | 'mesh_not_closed'
  | 'validation'
  | 'storage_unavailable'
  | 'mail_unavailable'
  | 'database_unavailable';

export const ERROR_COPY: Record<ErrorCode, string> = {
  unsupported_media: 'Check the highlighted fields.',
  too_large: 'That is too large to upload.',
  signed_out: 'Sign in to continue.',
  removed: 'You were removed from the classroom.',
  too_many_attempts: 'Too many attempts. Try again in 60 seconds.',
  rate_limited: 'Wait a minute before sending another email.',
  not_found: 'Not found.',
  forbidden: "Only this classroom's instructors can do that.",
  email_unverified: 'Verify your email to save projects.',
  email_taken: 'An account already uses that email.',
  bad_credentials: 'Email or password is wrong.',
  link_expired: 'This verification link has expired or was replaced. Send a new one from your account.',
  already_verified: 'Your email is already verified.',
  unknown_code: 'This class code is not open for joining.',
  join_closed: 'This class code is not open for joining.',
  classroom_full: 'This classroom is full. Ask your instructor.',
  nickname_taken: 'That nickname is taken in this classroom.',
  classroom_handed_in: 'This classroom was handed in. Changes are no longer saved.',
  project_handed_in: 'You handed in this project. Changes are no longer saved.',
  classroom_not_started: "This classroom hasn't opened yet.",
  classroom_archived: 'This classroom is archived.',
  not_handed_in: 'Hand in the classroom before archiving it.',
  owner_cannot_leave: "The classroom owner can't be removed.",
  already_added: 'That instructor is already in this classroom.',
  no_such_educator: 'No verified Educator account uses that email.',
  stale_revision: 'This project changed in another tab. Reload to see the latest version.',
  idempotency_conflict: 'That save was already sent with different content.',
  not_a_classroom_project: 'Only classroom projects are handed in.',
  mesh_not_closed: 'Export failed: the mesh is not closed.',
  validation: 'Check the highlighted fields.',
  storage_unavailable: 'Storage is unavailable. Try again in a minute.',
  mail_unavailable: "We couldn't send the email. Try again in a minute.",
  database_unavailable: 'Storage is unavailable. Try again in a minute.',
};

export const PROJECT_NOT_FOUND = 'Project not found';

export const FIELD_COPY = {
  nickname: 'Use 2 to 24 letters, numbers, spaces, hyphens or apostrophes.',
  password: 'Use at least 10 characters.',
  email: 'Enter a valid email address.',
  name: 'Use 1 to 60 characters.',
  timeZone: 'Choose a time zone from the list.',
  localFormat: 'Use the form YYYY-MM-DD HH:mm.',
  joinOrder: 'Join closes must be after Join opens.',
  handInBeforeJoinCloses: 'Hand-in time must be at or after Join closes.',
  handInNotLater: 'Hand-in time must be later than now.',
  size: 'Enter a size from 0.1 to 1000 mm.',
  resistance: 'Enter a resistance from 1 to 10000000 Ω.',
  voltage: 'Enter a voltage from 1 to 12 V.',
} as const;

export const dstGapCopy = (zone: string): string => `That time does not exist in ${zone}.`;

/** Copy that only the browser shows. */
export const UI_COPY = {
  joined: (classroom: string, nickname: string) => `Joined ${classroom} as ${nickname}`,
  studentJoined: (nickname: string) => `${nickname} joined`,
  studentSaved: (nickname: string, revision: number) => `${nickname} saved revision ${revision}`,
  studentHandedIn: (nickname: string) => `${nickname} handed in`,
  handedInLabel: 'Handed in',
  classroomCreated: (classroom: string) => `Created ${classroom}`,
  newJoinCode: 'New join code ready',
  renamed: (nickname: string) => `Renamed to ${nickname}`,
  removedStudent: (nickname: string) => `Removed ${nickname}`,
  addedAssistant: (name: string) => `Added ${name}`,
  grouped: (n: number) => `Grouped ${n} shapes`,
  ungrouped: (n: number) => `Ungrouped ${n} shapes`,
  groupNeedsSolid: 'A group needs at least one solid.',
  selectTwo: 'Select two or more shapes first.',
  aligned: (n: number, axis: string) => `Aligned ${n} shapes on ${axis}`,
  workplanePick: 'Pick a face for the workplane',
  workplaneSet: (face: string) => `Workplane set to ${face} face`,
  workplaneReset: 'Workplane reset',
  objectLimit: 'This design has the most shapes it can hold (200).',
  savedRevision: (n: number) => `Saved revision ${n}`,
  savingLabel: 'Saving…',
  savedLabel: (n: number) => `Saved · revision ${n}`,
  unsavedLabel: 'Unsaved changes',
  grouping: 'Grouping…',
  preparing: (file: string) => `Preparing ${file}…`,
  handedInProject: (name: string) => `Handed in ${name}`,
  handedInClassroom: (classroom: string) => `Handed in ${classroom}`,
  wiringFrom: (label: string, terminal: string) => `Wiring from ${label} ${terminal}`,
  wired: (from: string, to: string) => `Wired ${from} to ${to}`,
  alreadyWired: 'Those terminals are already wired.',
  simStarted: 'Simulation started',
  simStopped: 'Simulation stopped',
  ledBurnt: (label: string, ma: string) => `${label} burnt out at ${ma} mA`,
  ledLit: (label: string, ma: string) => `${label} lit at ${ma} mA`,
  ledReset: (label: string) => `${label} reset`,
  shorted: (label: string) => `${label} is short-circuited`,
  programFinished: (n: number) => `Program finished: ${n} objects`,
  programStepLimit: 'Program stopped after 500 steps.',
  programStopped: 'Program stopped',
  exported: (file: string, unitWord: string) => `Exported ${file} (${unitWord})`,
  exportStored: 'Saved to your library',
  exportStorageDown: 'Export failed: storage is unavailable. Your design is safe; try again.',
  saveStorageDown: 'Save failed: storage is unavailable. Your design is safe; try again.',
  storageStanding: 'Storage is unavailable. Your edits are kept in this browser until it is back.',
  openStorageDown: 'Storage is unavailable. Try again in a minute.',
  nothingToExport3d: 'Add a solid shape before exporting.',
  nothingToExportCircuit: 'Add a component before exporting.',
  removedNotice: (classroom: string) => `You were removed from ${classroom}.`,
  glancetRemoved: (nickname: string, classroom: string) => `${nickname} was removed from ${classroom}.`,
  verifyToSave: 'Verify your email to save projects.',
  verifyToCreate: 'Verify your email to create classrooms.',
  verifyToExport: 'Verify your email to export files.',
  verifyReminder: (email: string) => `Check your inbox at ${email} to verify your account.`,
  verifySucceeded: 'Email verified. You can save projects now.',
  verificationSent: (email: string) => `Verification email sent to ${email}`,
  keptEdits: 'This browser kept unsaved changes to this project.',
  countdown: (d: number, h: number, m: number) => `Hand-in in ${d}d ${h}h ${m}m`,
  savedAt: (stamp: string) => `Saved ${stamp}`,
  joinWindow: (from: string, to: string, zone: string) => `Join window: ${from} to ${to} (${zone})`,
  handInLine: (at: string, zone: string) => `Hand-in: ${at} (${zone})`,
  sizeLine3d: (w: string, d: string, h: string, unit: string) => `Size: ${w} × ${d} × ${h} ${unit}`,
  sizeLineCircuit: 'Size: wiring diagram, 297 × 210 mm page',
} as const;

export const STATE_LABEL = {
  draft: 'Draft',
  open: 'Open for joining',
  in_session: 'In session',
  handed_in: 'Handed in',
  archived: 'Archived',
} as const;
