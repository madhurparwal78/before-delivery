// Sentences shown in the Connection, Sync results, Field, Save and packet
// regions, exactly as published in Feedback states.
export const connectionSentences = {
  offline: "You're offline. Everything you log is kept on this device and syncs when signal returns.",
  waitingChanges: (n: number) => (n === 1 ? "1 change waiting to sync." : `${n} changes waiting to sync.`),
  signedOutWaiting: (n: number) => (n === 1 ? "You're signed out. Sign in to send 1 waiting change." : `You're signed out. Sign in to send ${n} waiting changes.`),
  notOnDevice: "This isn't on this device yet. It needs signal.",
  synced: (designation: string, date: string) => `${designation} (${date}) synced.`,
  deletedSynced: (designation: string, date: string) => `${designation} (${date}) deleted.`,
  conflictKept: (field: string, device: string) => `Newer ${field} from ${device} kept.`,
  conflictReplaced: (field: string, device: string) => `Replaced ${field} from ${device}.`,
  rejected: (designation: string, date: string, code: string) => `${designation} (${date}) did not sync (${code}).`,
  sessionRejected: (date: string, code: string) => `Session ${date} did not sync (${code}).`,
  sketchStorage: "Sketch storage isn't answering. Your sketch is kept on this device and will upload when storage is back.",
  deleteStorage: "Sketch storage isn't answering. Your delete is kept on this device and will finish when storage is back.",
} as const;

export const fieldSentences = {
  brightnessChosen: (n: number) => `Brightness ${n}.`,
  starPlaced: (n: number) => `Star placed, brightness ${n}.`,
  lastMarkRemoved: "Removed the last mark.",
  noShorterEyepiece: "No shorter eyepiece in your kit.",
  noLongerEyepiece: "No longer eyepiece in your kit.",
  sketchUnreadable: "This sketch can't be shown while storage isn't answering. Nothing was changed.",
} as const;

export const saveSentences = {
  pending: (designation: string) => `Saving ${designation}.`,
  saved: (designation: string) => `${designation} saved.`,
  savedOffline: (designation: string) => `${designation} saved on this device.`,
  restored: "Unsaved changes restored.",
} as const;

export const kitSentences = {
  added: (name: string) => `Added ${name}.`,
} as const;

export const tonightSentences = {
  needsKit: "Add a telescope and an eyepiece in Kit before starting a session.",
  needsSite: "Add a site in Kit before starting a session.",
} as const;

export const programSentences = {
  empty: "You're not following any program yet. Choose one below to start counting toward its certificate.",
  counts: (qualifying: number, total: number, required: number) => `${qualifying} of ${total} objects · certificate at ${required}`,
  edition: (n: number, effectiveFrom: string) => `Rules: edition ${n} from ${effectiveFrom}. Earlier evenings count under edition ${n - 1}.`,
  followed: (name: string) => `Following ${name}.`,
  unfollowed: (name: string) => `Stopped following ${name}.`,
  noSignal: (name: string) => `That needs signal. ${name} wasn't changed.`,
} as const;

export const packetStateLabels = {
  draft: "Draft",
  checked: "Checked",
  rendering: "Rendering",
  rendered: "Rendered",
  render_failed: "Render failed",
  sending: "Sending",
  sent: "Sent",
  send_failed: "Send failed",
} as const;

export type PacketState = keyof typeof packetStateLabels;

export const packetSentences = {
  draft: "Draft. Check it before rendering.",
  returnedToDraft: "An observation in this packet changed, so it is back to draft.",
  rowMoved: (designation: string, position: number, total: number) => `${designation} moved to position ${position} of ${total}.`,
  checkFailed: (n: number) => (n === 1 ? "This packet can't be checked yet: 1 problem." : `This packet can't be checked yet: ${n} problems.`),
  checked: (n: number) => `Checked: ${n} observations ready to render.`,
  rendering: (number: number) => `Rendering packet ${number}. This can take a few seconds.`,
  rendered: (number: number, pages: number) => `Packet ${number} is rendered and stored (${pages} pages).`,
  renderFailedRenderer: "The PDF renderer isn't answering. Nothing was rendered; press Try again when it's back.",
  renderFailedStorage: "Packet storage isn't answering. Nothing was saved; press Try again when it's back.",
  sending: (number: number, coordinator: string) => `Sending packet ${number} to ${coordinator}.`,
  sent: (number: number, coordinator: string) => `Packet ${number} was sent to ${coordinator}.`,
  mailOutage: (number: number) => `The mail server isn't answering. Packet ${number} is still rendered and nothing was sent; try again later.`,
  sendStorageOutage: (number: number) => `Packet storage isn't answering. Packet ${number} is still rendered and nothing was sent; try again later.`,
  downloadStorageOutage: (number: number) => `Packet storage isn't answering. Packet ${number} is safe; try Download PDF again when it's back.`,
  sendFailed: (number: number) => `The mail server refused packet ${number}. Nothing was delivered; press Send to coordinator to try again.`,
  staleAction: "This packet changed somewhere else. Nothing was done; this is its current state.",
} as const;

export const accountSentences = {
  emailTaken: "An account already uses that email.",
  badCredentials: "That email and password don't match an account.",
  tooManyAttempts: "Too many sign-in attempts for this email. Wait 15 minutes and try again.",
  signOutNoSignal: "That needs signal. Nothing was changed.",
} as const;

export const deviceNameDefaults = { phone: "phone", tablet: "tablet", laptop: "laptop" } as const;
