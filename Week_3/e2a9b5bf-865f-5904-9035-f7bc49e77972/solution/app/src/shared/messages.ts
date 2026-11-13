/** Every published sentence, character for character. */

export const FIELD_MESSAGES = {
  observed_at: "Use a UT time during this session.",
  seeing: "Seeing is a whole number from 1 to 10.",
  transparency_nelm: "Transparency is a limiting magnitude from 1.0 to 8.0.",
  description: "Keep the description to 4,000 characters or fewer.",
  concentration_class: "Concentration class is I to XII, for globular clusters only.",
  pair: "A measured pair is two different points, for double stars only.",
  optics: "Choose a telescope and an eyepiece from your kit.",
  train: "Choose a train from the list.",
  strokes: "The sketch file is not a Lowlamp stroke file.",
  raster: "The sketch image must be a PNG of 2,000,000 bytes or fewer.",
  started_at: "A session can't start in the future.",
  object_id: "Choose an object from the catalogue.",
  edited_at: "The edit time is in the future.",
  email: "Enter an email address.",
  password: "Use at least 10 characters.",
  display_name: "Enter your name as it should appear on packets.",
  name: "Give it a name of up to 60 characters.",
  aperture: "Aperture must be from 25 mm to 1,600 mm.",
  telescope_focal_length_mm: "Focal length must be from 100 mm to 20,000 mm.",
  eyepiece_focal_length_mm: "Eyepiece focal length must be from 2 mm to 60 mm.",
  apparent_field_deg: "Apparent field must be from 30° to 120°.",
  factor: "Barlow factor must be from 1.1× to 5.0×.",
  latitude: "Latitude must be from -90 to 90.",
  longitude: "Longitude must be from -180 to 180.",
  time_zone: "Choose a time zone from the list.",
  revision: "Send the revision you are acting on.",
  device: "Name the device in 1 to 40 characters.",
  changes: "Send 1 to 200 changes.",
  observation_ids: "Choose between 1 and 200 different observations.",
  observation_id: "Send the observation's id.",
  session_id: "Choose a session.",
  site_id: "Choose a site.",
  base_version: "Send the version you are changing.",
  client_op_id: "Send a client op id.",
  kind: "Choose a change kind.",
  aperture_unit: "Choose mm or in.",
  program_id: "Choose a program.",
} as const;

export type FieldMessageKey = keyof typeof FIELD_MESSAGES;

export const COPY = {
  offlineBanner: "You're offline. Everything you log is kept on this device and syncs when signal returns.",
  waitingOne: "1 change waiting to sync.",
  waitingMany: (n: number) => `${n} changes waiting to sync.`,
  notOnDevice: "This isn't on this device yet. It needs signal.",
  synced: (designation: string, date: string) => `${designation} (${date}) synced.`,
  deleted: (designation: string, date: string) => `${designation} (${date}) deleted.`,
  conflictKept: (field: string, device: string) => `Newer ${field} from ${device} kept.`,
  conflictReplaced: (field: string, device: string) => `Replaced ${field} from ${device}.`,
  rejected: (designation: string, date: string, code: string) => `${designation} (${date}) did not sync (${code}).`,
  sessionRejected: (date: string, code: string) => `Session ${date} did not sync (${code}).`,
  storageSketch: "Sketch storage isn't answering. Your sketch is kept on this device and will upload when storage is back.",
  storageDelete: "Sketch storage isn't answering. Your delete is kept on this device and will finish when storage is back.",

  pairPrimary: "Mark the primary star.",
  pairSecondary: "Mark the secondary star.",
  brightness: (n: number) => `Brightness ${n}.`,
  starPlaced: (n: number) => `Star placed, brightness ${n}.`,
  removedMark: "Removed the last mark.",
  noShorter: "No shorter eyepiece in your kit.",
  noLonger: "No longer eyepiece in your kit.",
  sketchUnreadable: "This sketch can't be shown while storage isn't answering. Nothing was changed.",
  localTime: (clock: string, offset: string) => `${clock} local, UTC${offset}`,

  saving: (designation: string) => `Saving ${designation}.`,
  saved: (designation: string) => `${designation} saved.`,
  savedOffline: (designation: string) => `${designation} saved on this device.`,
  restored: "Unsaved changes restored.",

  added: (name: string) => `Added ${name}.`,
  emailTaken: "An account already uses that email.",
  signinFailed: "That email and password don't match an account.",
  tooManyAttempts: "Too many sign-in attempts for this email. Wait 15 minutes and try again.",

  tonightKit: "Add a telescope and an eyepiece in Kit before starting a session.",
  tonightSite: "Add a site in Kit before starting a session.",

  emptyPrograms: "You're not following any program yet. Choose one below to start counting toward its certificate.",
  counts: (qualifying: number, total: number, required: number) =>
    `${qualifying} of ${total} objects · certificate at ${required}`,
  edition: (n: number, from: string) => `Rules: edition ${n} from ${from}. Earlier evenings count under edition ${n - 1}.`,
  following: (name: string) => `Following ${name}.`,
  unfollowed: (name: string) => `Stopped following ${name}.`,
  followNoSignal: (name: string) => `That needs signal. ${name} wasn't changed.`,

  draftPlain: "Draft. Check it before rendering.",
  draftReturned: "An observation in this packet changed, so it is back to draft.",
  rowMoved: (designation: string, position: number, total: number) =>
    `${designation} moved to position ${position} of ${total}.`,
  checkFailed: (n: number) => (n === 1 ? "This packet can't be checked yet: 1 problem." : `This packet can't be checked yet: ${n} problems.`),
  checked: (n: number) => `Checked: ${n} observations ready to render.`,
  rendering: (number: number) => `Rendering packet ${number}. This can take a few seconds.`,
  rendered: (number: number, pages: number) => `Packet ${number} is rendered and stored (${pages} pages).`,
  renderFailedRenderer: "The PDF renderer isn't answering. Nothing was rendered; press Try again when it's back.",
  renderFailedStorage: "Packet storage isn't answering. Nothing was saved; press Try again when it's back.",
  sending: (number: number, coordinator: string) => `Sending packet ${number} to ${coordinator}.`,
  sent: (number: number, coordinator: string) => `Packet ${number} was sent to ${coordinator}.`,
  mailOutage: (number: number) =>
    `The mail server isn't answering. Packet ${number} is still rendered and nothing was sent; try again later.`,
  sendStorageDown: (number: number) =>
    `Packet storage isn't answering. Packet ${number} is still rendered and nothing was sent; try again later.`,
  downloadStorageDown: (number: number) =>
    `Packet storage isn't answering. Packet ${number} is safe; try Download PDF again when it's back.`,
  sendRefused: (number: number) =>
    `The mail server refused packet ${number}. Nothing was delivered; press Send to coordinator to try again.`,
  stale: "This packet changed somewhere else. Nothing was done; this is its current state.",

  notFound: "We couldn't find that here.",
  serverError: "Something went wrong on our side. Nothing was lost; try again.",
  needsSignal: "That needs signal. Nothing was changed.",
} as const;

export const PACKET_LABELS = {
  draft: "Draft",
  checked: "Checked",
  rendering: "Rendering",
  rendered: "Rendered",
  render_failed: "Render failed",
  sending: "Sending",
  sent: "Sent",
  send_failed: "Send failed",
} as const;

export const REASON_MESSAGES = {
  not_on_program: (d: string, date: string) => `${d}, ${date}: not on this program's list.`,
  duplicate_object: (d: string, date: string) => `${d}, ${date}: only one observation per object.`,
  missing_ut_time: (d: string, date: string) => `${d}, ${date}: add the UT time.`,
  missing_seeing: (d: string, date: string) => `${d}, ${date}: add seeing from 1 to 10.`,
  missing_transparency: (d: string, date: string) => `${d}, ${date}: add transparency as a limiting magnitude.`,
  missing_concentration: (d: string, date: string) => `${d}, ${date}: add the Shapley-Sawyer concentration class.`,
  missing_pair: (d: string, date: string) => `${d}, ${date}: add the measured pair for this double star.`,
  short_description: (d: string, date: string, minimum: number) =>
    `${d}, ${date}: the description needs at least ${minimum} characters.`,
  missing_sketch: (d: string, date: string) => `${d}, ${date}: this program needs a sketch.`,
} as const;

export const CONCENTRATION_CLASSES = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;

export const CONFLICT_FIELD_LABELS = {
  observed_at: "UT time",
  seeing: "seeing",
  transparency_nelm: "transparency",
  description: "description",
  optics: "optics",
  sketch: "sketch",
  concentration_class: "concentration class",
  pair: "measured pair",
} as const;
