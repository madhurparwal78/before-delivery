export const copy = {
  generic: 'Something went wrong. Try again.',

  signIn: {
    pending: 'Sending your link…',
    success: 'Check your inbox. The link works once.',
    fieldError: 'Enter an email address like name@example.com.',
    mailOutage: "Sign-in email can't be sent right now. Try again in a minute.",
    finishPending: 'Signing you in…',
    used: 'This sign-in link has already been used. Request a new one.',
    expired: 'This sign-in link has expired. Request a new one.',
    unknown: "This sign-in link isn't valid. Request a new one.",
    erased: 'Your account and your work have been erased.',
  },

  session: {
    pending: 'Updating session…',
    refused: (state: string) => `That change isn't possible while the session is ${state}.`,
    anotherLive: 'Another session in this project is already running.',
  },

  baton: {
    pending: 'Claiming the baton…',
    driving: (name: string) => `${name} is now driving`,
    lost: (name: string) => `${name} took the baton first.`,
    notLive: 'The baton is only passed during a live session.',
  },

  editor: {
    viewing: (name: string) => `You are viewing — ${name} is driving.`,
    paused: 'Session paused — editing resumes when the mentor resumes.',
    saving: 'Saving…',
    saved: 'All changes saved',
    stale: (path: string) =>
      `A newer version of ${path} was saved. Your change wasn't applied — the editor now shows the latest version.`,
    tooLarge: (path: string) => `${path} is too large to save.`,
    following: (name: string, path: string) => `Following ${name} · ${path}`,
    deleted: (path: string) => `${path} was deleted.`,
    removed: 'You were removed from this project.',
  },

  checkpoint: {
    pending: 'Saving checkpoint…',
    saved: (name: string) => `Checkpoint "${name}" saved.`,
    pendingUpload: (name: string) =>
      `Checkpoint "${name}" is pending upload. Keep working — storage is unreachable right now.`,
    failed: (name: string) => `Checkpoint "${name}" couldn't be uploaded. Save it again.`,
    fieldError: 'Give the checkpoint a name of 1 to 80 characters.',
  },

  restore: {
    pending: (name: string) => `Restoring "${name}"…`,
    success: (name: string) => `Restored "${name}".`,
    undoPending: 'Undoing restore…',
    undoSuccess: 'Restore undone.',
    superseded: "This restore can't be undone because files changed after it.",
    notSaved: "This checkpoint hasn't finished uploading yet.",
    damaged: "This checkpoint's stored files don't match its record, so it can't be restored.",
    storageOutage: "Storage is unreachable, so checkpoints can't be opened or restored right now.",
  },

  importing: {
    pending: 'Checking the zip…',
    planned: (counts: { added: number; changed: number; unchanged: number; orphans: number }) =>
      `${counts.added} new, ${counts.changed} changed, ${counts.unchanged} unchanged, ${counts.orphans} only in the project.`,
    rejected: (count: number) =>
      `Zip rejected: ${count} problem(s) found. Nothing was imported.`,
    uploadTooLarge: (limit: number) => `The zip is over the upload limit of ${limit} bytes.`,
    applied: (counts: { added: number; replaced: number; kept: number }) =>
      `Import applied: ${counts.added} added, ${counts.replaced} replaced, ${counts.kept} kept.`,
    expiredPlan: 'This zip check has expired. Upload it again.',
    stalePlan: 'Files changed since this zip was checked. Upload it again.',
    alreadyApplied: 'This import was already applied.',
    sessionRunning: 'Imports are applied between sessions.',
    storageOutage: "Storage is unreachable, so zips can't be imported right now.",
    limits:
      'Zips up to 5,000,000 bytes, 500 entries, 1,000,000 bytes per file and 20,000,000 bytes in total; text files only.',
  },

  members: {
    pending: 'Sending invite…',
    success: (email: string) => `Invite recorded for ${email}.`,
    nameError: "Enter the learner's name (1 to 80 characters).",
    seatTaken: 'This one-to-one project already has a learner. Remove them first.',
    groupFull: 'This group already has six learners.',
    removalPending: (name: string) => `Removing ${name}…`,
    removed: (name: string) => `${name} was removed. Their access has ended.`,
    confirmBody: 'They lose access straight away, including any open session.',
  },

  share: {
    created: (expiry: string) => `Reviewer link created. It expires ${expiry}.`,
    hoursError: 'Choose between 1 and 336 hours.',
    revoked: 'Link revoked. It no longer opens.',
    regenerated: 'New link created. The old link no longer opens.',
  },

  review: {
    loading: 'Loading checkpoint…',
    expired: 'This review link has expired.',
    revoked: 'This review link was revoked.',
    notFound: "This review link doesn't exist.",
    damaged: "This checkpoint can't be shown because its stored files are damaged.",
    storageOutage: "This checkpoint can't be loaded right now. Try again shortly.",
  },

  account: {
    pending: 'Erasing your account…',
    confirmError: 'Type ERASE to confirm.',
    storageOutage:
      "Storage is unreachable, so your account can't be erased right now. Nothing was removed.",
  },
} as const;

export const rejectionReasons: Record<string, (limit: number | undefined) => string> = {
  path_traversal: () => 'leaves the project folder',
  absolute_path: () => 'uses an absolute path',
  path_too_long: () => 'has a path over 255 characters',
  symlink: () => 'is a symbolic link',
  disallowed_type: () => 'is not an allowed file type',
  content_mismatch: () => "isn't readable text",
  unsafe_svg: () => 'contains script',
  duplicate_path: () => 'appears more than once',
  file_too_large: (limit) => `is over the per-file limit of ${limit} bytes`,
  total_too_large: (limit) => `brings the total over ${limit} bytes`,
  too_many_entries: (limit) => `has more than ${limit} entries`,
  ratio_exceeded: (limit) => `expands more than ${limit} times its packed size`,
  not_a_zip: () => "isn't a zip archive",
};
