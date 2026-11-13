/** The one table of field validation messages, and every other published string. */

export const FIELD_MESSAGES = {
  observed_at: 'Use a UT time during this session.',
  seeing: 'Seeing is a whole number from 1 to 10.',
  transparency_nelm: 'Transparency is a limiting magnitude from 1.0 to 8.0.',
  description: 'Keep the description to 4,000 characters or fewer.',
  concentration_class: 'Concentration class is I to XII, for globular clusters only.',
  pair: 'A measured pair is two different points, for double stars only.',
  optics: 'Choose a telescope and an eyepiece from your kit.',
  train: 'Choose a train from the list.',
  strokes: 'The sketch file is not a Lowlamp stroke file.',
  raster: 'The sketch image must be a PNG of 2,000,000 bytes or fewer.',
  started_at: "A session can't start in the future.",
  object_id: 'Choose an object from the catalogue.',
  edited_at: 'The edit time is in the future.',
  email: 'Enter an email address.',
  password: 'Use at least 10 characters.',
  display_name: 'Enter your name as it should appear on packets.',
  name: 'Give it a name of up to 60 characters.',
  aperture: 'Aperture must be from 25 mm to 1,600 mm.',
  telescope_focal_length_mm: 'Focal length must be from 100 mm to 20,000 mm.',
  eyepiece_focal_length_mm: 'Eyepiece focal length must be from 2 mm to 60 mm.',
  apparent_field_deg: 'Apparent field must be from 30° to 120°.',
  factor: 'Barlow factor must be from 1.1× to 5.0×.',
  latitude: 'Latitude must be from -90 to 90.',
  longitude: 'Longitude must be from -180 to 180.',
  time_zone: 'Choose a time zone from the list.',
  revision: 'Send the revision you are acting on.',
  observation_ids: 'List 1 to 200 distinct observations.',
  changes: 'Send 1 to 200 changes.',
  device: 'Name this device in 1 to 40 characters.',
  aperture_unit: 'Choose millimetres or inches.',
  site_id: 'Choose a site from your kit.',
  session_id: 'Choose a session.',
  base_version: 'Send the version you are editing.',
  program_id: 'Choose a program.',
} as const;

export type FieldMessageKey = keyof typeof FIELD_MESSAGES;

export const ACCOUNT_COPY = {
  email_taken: 'An account already uses that email.',
  bad_credentials: "That email and password don't match an account.",
  too_many_attempts: 'Too many sign-in attempts for this email. Wait 15 minutes and try again.',
} as const;

export const CONNECTION_COPY = {
  offline:
    "You're offline. Everything you log is kept on this device and syncs when signal returns.",
  not_on_device: "This isn't on this device yet. It needs signal.",
  storage_sketch:
    "Sketch storage isn't answering. Your sketch is kept on this device and will upload when storage is back.",
  storage_delete:
    "Sketch storage isn't answering. Your delete is kept on this device and will finish when storage is back.",
} as const;

export function waitingCount(count: number): string {
  return count === 1 ? '1 change waiting to sync.' : `${count} changes waiting to sync.`;
}

export function signedOutLine(count: number): string {
  return count === 1
    ? "You're signed out. Sign in to send 1 waiting change."
    : `You're signed out. Sign in to send ${count} waiting changes.`;
}

export function observationSynced(designation: string, eveningDate: string): string {
  return `${designation} (${eveningDate}) synced.`;
}

export function observationDeletedSentence(designation: string, eveningDate: string): string {
  return `${designation} (${eveningDate}) deleted.`;
}

export function conflictKept(field: string, device: string): string {
  return `Newer ${field} from ${device} kept.`;
}

export function conflictReplaced(field: string, device: string): string {
  return `Replaced ${field} from ${device}.`;
}

export function changeRejected(
  designation: string,
  eveningDate: string,
  errorCode: string,
): string {
  return `${designation} (${eveningDate}) did not sync (${errorCode}).`;
}

export function sessionRejected(eveningDate: string, errorCode: string): string {
  return `Session ${eveningDate} did not sync (${errorCode}).`;
}

/** Conflict reports name fields in the observer's words. */
export const CONFLICT_FIELD_NAMES: Record<string, string> = {
  observed_at: 'UT time',
  seeing: 'seeing',
  transparency_nelm: 'transparency',
  description: 'description',
  optics: 'optics',
  sketch: 'sketch',
  concentration_class: 'concentration class',
  pair: 'measured pair',
};

export const FIELD_COPY = {
  pair_none: 'Mark the primary star.',
  pair_one: 'Mark the secondary star.',
  no_shorter: 'No shorter eyepiece in your kit.',
  no_longer: 'No longer eyepiece in your kit.',
  sketch_unreadable:
    "This sketch can't be shown while storage isn't answering. Nothing was changed.",
  removed_mark: 'Removed the last mark.',
} as const;

export function pairReadout(separation: string, positionAngle: number): string {
  return `Separation ${separation}′ · Position angle ${positionAngle}°`;
}

export function swapSentence(
  trueFieldArcmin: number,
  magnification: number,
  orientationSentence: string,
): string {
  return `Field now ${trueFieldArcmin}′ at ${magnification}×. ${orientationSentence}`;
}

export function brightnessChosen(brightness: number): string {
  return `Brightness ${brightness}.`;
}

export function starPlaced(brightness: number): string {
  return `Star placed, brightness ${brightness}.`;
}

export const SAVE_COPY = {
  restored: 'Unsaved changes restored.',
} as const;

export function savePending(designation: string): string {
  return `Saving ${designation}.`;
}

export function savedOnServer(designation: string): string {
  return `${designation} saved.`;
}

export function savedOnDevice(designation: string): string {
  return `${designation} saved on this device.`;
}

export function kitAdded(name: string): string {
  return `Added ${name}.`;
}

export const TONIGHT_COPY = {
  no_optics: 'Add a telescope and an eyepiece in Kit before starting a session.',
  no_site: 'Add a site in Kit before starting a session.',
} as const;

export const PROGRAMS_COPY = {
  empty:
    "You're not following any program yet. Choose one below to start counting toward its certificate.",
} as const;

export function countsLine(qualifying: number, total: number, required: number): string {
  return `${qualifying} of ${total} objects · certificate at ${required}`;
}

export function editionLine(edition: number, effectiveFrom: string): string {
  return `Rules: edition ${edition} from ${effectiveFrom}. Earlier evenings count under edition ${edition - 1}.`;
}

export function followed(programName: string): string {
  return `Following ${programName}.`;
}

export function unfollowed(programName: string): string {
  return `Stopped following ${programName}.`;
}

export function followNoSignal(programName: string): string {
  return `That needs signal. ${programName} wasn't changed.`;
}

export const PACKET_LABELS = {
  draft: 'Draft',
  checked: 'Checked',
  rendering: 'Rendering',
  rendered: 'Rendered',
  render_failed: 'Render failed',
  sending: 'Sending',
  sent: 'Sent',
  send_failed: 'Send failed',
} as const;

export const PACKET_COPY = {
  draft: 'Draft. Check it before rendering.',
  returned_to_draft: 'An observation in this packet changed, so it is back to draft.',
  render_failed_renderer:
    "The PDF renderer isn't answering. Nothing was rendered; press Try again when it's back.",
  render_failed_storage:
    "Packet storage isn't answering. Nothing was saved; press Try again when it's back.",
  stale: 'This packet changed somewhere else. Nothing was done; this is its current state.',
} as const;

export function checkFailed(problems: number): string {
  return problems === 1
    ? "This packet can't be checked yet: 1 problem."
    : `This packet can't be checked yet: ${problems} problems.`;
}

export function packetChecked(rows: number): string {
  return `Checked: ${rows} observations ready to render.`;
}

export function packetRendering(packetNumber: number): string {
  return `Rendering packet ${packetNumber}. This can take a few seconds.`;
}

export function packetRendered(packetNumber: number, pages: number): string {
  return `Packet ${packetNumber} is rendered and stored (${pages} pages).`;
}

export function packetSending(packetNumber: number, coordinatorName: string): string {
  return `Sending packet ${packetNumber} to ${coordinatorName}.`;
}

export function packetSent(packetNumber: number, coordinatorName: string): string {
  return `Packet ${packetNumber} was sent to ${coordinatorName}.`;
}

export function mailOutage(packetNumber: number): string {
  return `The mail server isn't answering. Packet ${packetNumber} is still rendered and nothing was sent; try again later.`;
}

export function sendStorageOutage(packetNumber: number): string {
  return `Packet storage isn't answering. Packet ${packetNumber} is still rendered and nothing was sent; try again later.`;
}

export function downloadStorageOutage(packetNumber: number): string {
  return `Packet storage isn't answering. Packet ${packetNumber} is safe; try Download PDF again when it's back.`;
}

export function sendRefused(packetNumber: number): string {
  return `The mail server refused packet ${packetNumber}. Nothing was delivered; press Send to coordinator to try again.`;
}

export function rowMoved(designation: string, position: number, total: number): string {
  return `${designation} moved to position ${position} of ${total}.`;
}

export const PACKET_REASON_MESSAGES = {
  not_on_program: (designation: string, date: string): string =>
    `${designation}, ${date}: not on this program's list.`,
  duplicate_object: (designation: string, date: string): string =>
    `${designation}, ${date}: only one observation per object.`,
  missing_ut_time: (designation: string, date: string): string =>
    `${designation}, ${date}: add the UT time.`,
  missing_seeing: (designation: string, date: string): string =>
    `${designation}, ${date}: add seeing from 1 to 10.`,
  missing_transparency: (designation: string, date: string): string =>
    `${designation}, ${date}: add transparency as a limiting magnitude.`,
  missing_concentration: (designation: string, date: string): string =>
    `${designation}, ${date}: add the Shapley-Sawyer concentration class.`,
  missing_pair: (designation: string, date: string): string =>
    `${designation}, ${date}: add the measured pair for this double star.`,
  short_description: (designation: string, date: string, minimum: number): string =>
    `${designation}, ${date}: the description needs at least ${minimum} characters.`,
  missing_sketch: (designation: string, date: string): string =>
    `${designation}, ${date}: this program needs a sketch.`,
  too_few: (count: number, required: number): string =>
    `This packet has ${count} qualifying objects; the certificate needs ${required}.`,
} as const;

export const GLOBAL_COPY = {
  not_found: "We couldn't find that here.",
  internal: 'Something went wrong on our side. Nothing was lost; try again.',
  needs_signal: 'That needs signal. Nothing was changed.',
} as const;
