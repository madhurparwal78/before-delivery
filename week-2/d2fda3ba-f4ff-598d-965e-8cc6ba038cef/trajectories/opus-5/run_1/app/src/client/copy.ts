export const COPY = {
  sync: {
    signedOut: 'Local only — not syncing',
    waitingApproval: 'Waiting for device approval — check your email',
    inFlight: (queued: number): string => `Syncing — ${queued} queued`,
    allSynced: 'All changes synced',
    offline: (queued: number): string => `Offline — ${queued} queued`,
    storage: (queued: number): string => `sync paused: storage unavailable — ${queued} queued`,
    billing: (queued: number): string => `sync paused: billing unavailable — ${queued} queued`,
    readOnly: 'Vault is read-only — Sync has lapsed',
  },
  badge: {
    localOnly: 'local only',
    pending: 'pending',
    synced: 'synced',
    conflict: 'conflict',
    error: 'sync error',
    paused: 'paused',
  },
  rejection: (message: string): string => `This revision was rejected: ${message}`,
  conflict: {
    copyTitle: (title: string, deviceName: string): string => `${title} (conflict copy, ${deviceName})`,
    notice: 'Another device saved this note first. Your version is kept as a conflict copy.',
  },
  account: {
    signingIn: 'Signing in…',
    creating: 'Creating account…',
    signedIn: (email: string): string => `Signed in as ${email}`,
    created: 'Account created — this browser is your first device.',
    wrongCredentials: 'Wrong email or password.',
  },
  deviceApproval: {
    approved: 'Device approved. You can close this tab.',
    expired: 'This approval link has expired. Sign in again on the new device to get a fresh one.',
    alreadyUsed: 'This device is already approved.',
  },
  plan: {
    pending: 'Updating plan…',
    syncActive: 'Sync active',
    publishActive: 'Publish active',
    syncEnds: (when: string): string => `Sync ends ${when}`,
    publishEnds: (when: string): string => `Publish ends ${when}`,
    billingOutage: "Billing is unavailable. Your plan hasn't changed — try again shortly.",
  },
  vault: {
    creating: 'Creating vault…',
    created: 'Vault created — this notebook now syncs',
    inviteCreated: (email: string): string => `Invite created — an email is on its way to ${email}`,
    inviteAccepted: (inviter: string): string =>
      `You've joined the vault. Enter the vault passphrase from ${inviter} to unlock it.`,
    inviteExpired: 'This invite has expired.',
    wrongRecipient: 'This invite was sent to a different email address.',
    wrongPassphrase: "That passphrase doesn't unlock this vault.",
  },
  restore: {
    pending: (rev: number): string => `Restoring r${rev}…`,
    success: (rev: number, next: number): string => `Restored r${rev} as r${next}`,
    conflict: 'This note changed on another device. The latest version is loaded — choose a revision again.',
    storage: 'Restore paused: storage unavailable. Nothing changed.',
  },
  ring: {
    counts: (publicCount: number, severed: number): string =>
      `notes public ${publicCount} · links severed ${severed}`,
    announcement: (hop: number, publicCount: number, severed: number): string =>
      `Hop ${hop}: ${publicCount} notes public, ${severed} links severed`,
    checking: 'Checking boundary…',
    match: (publicCount: number, severed: number): string =>
      `Server boundary matches: ${publicCount} public · ${severed} severed`,
    mismatch: 'Server boundary differs — publishing is blocked until it matches',
    failure: 'Boundary check unavailable — try again',
  },
  publish: {
    pending: 'Publishing…',
    success: (publicCount: number, severed: number): string =>
      `Published ${publicCount} notes · ${severed} links severed`,
    storage: "Publish paused: storage unavailable. The live dossier hasn't changed.",
    notEntitled: 'Publishing needs the Publish add-on.',
    alreadyRunning: 'Another publish of this dossier is still running.',
    takedownPending: 'Taking down…',
    takedownSuccess: 'Dossier taken down',
    takedownStorage: 'Takedown paused: storage unavailable. Try again shortly.',
    reopened: 'Reopened as draft',
    confirm: (publicCount: number, severed: number): string =>
      `Publish ${publicCount} notes and cut ${severed} links?`,
  },
  preview: {
    pending: 'Creating preview link…',
    success: (when: string): string => `Preview link ready — expires ${when}`,
    revoked: 'Preview link revoked',
    storage: 'Preview paused: storage unavailable.',
  },
  ops: {
    live: 'Live from Kill Bill',
    cached: (when: string): string => `Billing unavailable — showing last known state from ${when}`,
    running: 'Running lapse check…',
    done: (warnings: number, takenDown: number): string =>
      `Lapse check done: ${warnings} warnings sent, ${takenDown} dossiers taken down`,
    envelopeFooter: 'Every stored revision passed the encrypted-envelope check on upload.',
  },
} as const;
