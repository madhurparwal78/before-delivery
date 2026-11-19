/// Every status line the console prints, character for character.
const DASH = "\u2014";
const DOT = "\u00b7";

export const copy = {
  gradeLine(letter: string, label: string, open: number): string {
    return `Grade ${letter} ${DASH} ${label} ${DOT} ${open} ${plural(open, "open defect", "open defects")}`;
  },
  dayRate(amount: number, currency: string): string {
    return `${amount} ${currency} per day`;
  },
  emptyState: "No defects marked on this pen",

  viewCylinder: "View: Cylinder",
  viewUnwrapping: "View: Unwrapping",
  viewFlat: "View: Flat chart",
  viewWrapping: "View: Wrapping",
  cameraFlat: "Camera: flat chart",
  cameraBearing(azimuth: number): string {
    return `Camera: ${azimuth}\u00b0`;
  },
  zoom(zoom: number): string {
    return `Zoom: ${zoom.toFixed(2)}\u00d7`;
  },
  selected(id: string | null): string {
    return `Selected: ${id ?? "none"}`;
  },
  focus(ids: string[]): string {
    return `Focus: ${ids.length ? ids.join(", ") : "none"}`;
  },
  diveClock(clock: string | null): string {
    return clock === null ? "Dive clock: no dive running" : `Dive clock: ${clock}`;
  },
  marking: "Marking: tap the net wall",
  loading: "Loading pen",
  noWebgl: `3D view unavailable ${DASH} showing the flat chart`,

  saving: "Saving\u2026",
  saved(id: string): string {
    return `Saved ${id}`;
  },
  versionConflict(id: string): string {
    return `${id} changed on another device ${DASH} reopen to see the latest`;
  },
  removedConflict(id: string): string {
    return `${id} was removed`;
  },
  lockedOn(device: string): string {
    return `Being edited on ${device}`;
  },
  noteCounter(count: number): string {
    return `${count} / 500`;
  },
  noteTooLong: "Note is longer than 500 characters",
  removing: "Removing\u2026",
  removed(id: string): string {
    return `Removed ${id}`;
  },
  uploadingStill: "Uploading still\u2026",
  attachedStill(id: string): string {
    return `Attached still ${id}`;
  },
  stillTooLarge: "Still is larger than 8,000,000 bytes",
  stillWrongType: "Stills must be JPEG or PNG",
  recordingRepair: "Recording repair\u2026",
  repairRecorded(id: string): string {
    return `Repair recorded for ${id}`;
  },
  alreadyRepaired(id: string): string {
    return `${id} is already repaired`;
  },
  lockLost: `Your edit lock expired ${DASH} reopen the editor to continue`,

  otherMarked(device: string, id: string): string {
    return `${device} marked ${id}`;
  },
  otherUpdated(device: string, id: string): string {
    return `${device} updated ${id}`;
  },
  otherRemoved(device: string, id: string): string {
    return `${device} removed ${id}`;
  },
  otherRepaired(device: string, id: string): string {
    return `${device} recorded a repair on ${id}`;
  },
  otherRestored(device: string, revision: number, penName: string): string {
    return `${device} restored revision ${revision} of ${penName}`;
  },
  linkCreatedElsewhere: "Report link created",
  linkRevokedElsewhere: "Report link revoked",
  linkRegeneratedElsewhere: "Report link regenerated",

  checkingForecast: "Checking forecast\u2026",
  forecastUnavailable: `Forecast unavailable ${DASH} try again shortly`,
  startingDive: "Starting dive\u2026",
  diveStarted: "Dive started",
  finishingDive: "Finishing dive\u2026",
  diveRecorded: "Dive recorded",
  uploadingSonar: "Uploading sonar capture\u2026",
  attachedSonar(id: string): string {
    return `Attached sonar capture ${id}`;
  },
  sonarTooLarge: "Sonar capture is larger than 20,000,000 bytes",
  trackRowInvalid(index: number, reason: string): string {
    return `Track row ${index} is invalid: ${reason}`;
  },

  askingCopilot: "Asking copilot\u2026",
  copilotAnswered: "Copilot answered",
  ignoredUnknown(ids: string[]): string {
    return `Ignored unknown defects: ${ids.join(", ")}`;
  },
  copilotUnavailable: "Copilot unavailable",
  applyingRepair: "Applying repair\u2026",
  proposalRemoved(id: string): string {
    return `${id} was removed`;
  },

  importing: "Importing\u2026",
  imported(
    fileName: string,
    created: number,
    merged: number,
    already: number,
    orphans: number,
    invalid: number,
  ): string {
    return `Imported ${fileName}: ${created} created, ${merged} merged, ${already} already imported, ${orphans} ${plural(orphans, "orphan", "orphans")}, ${invalid} invalid`;
  },
  importReplay: `Already imported ${DASH} nothing new created`,
  importTooLarge: "Import file is larger than 2,000,000 bytes",

  publishing: "Publishing\u2026",
  published(revision: number): string {
    return `Published revision ${revision}`;
  },
  restoring: "Restoring\u2026",
  restored(revision: number): string {
    return `Restored revision ${revision}`;
  },

  linkWorking: "Working\u2026",
  linkCreated: "Link created",
  linkRegenerated: `Link regenerated ${DASH} the old link no longer works`,
  linkRevoked: "Link revoked",
  linkCopied: "Link copied",
  linkInactive: "This link is no longer active",
  linkChangedElsewhere: `Link changed on another device ${DASH} the list has been refreshed`,

  erasing: "Erasing\u2026",
  erased(name: string): string {
    return `Erased ${name}`;
  },
  eraseConfirm: "Type the farm name exactly to confirm",

  searchResults(count: number): string {
    return `${count} ${plural(count, "result", "results")}`;
  },
  searchShort: "Type at least 2 characters",
  searchTooLong: "Search text is longer than 100 characters",

  unreachable: `Pensight server unreachable ${DASH} changes are not saved`,

  linkActive(expiresAt: string, seconds: number): string {
    return `Active ${DASH} expires ${stampLine(expiresAt)} (in ${remaining(seconds)})`;
  },
  linkStatusRevoked: "Revoked",
  linkStatusExpired: "Expired",
  shareExpiry(expiresAt: string, seconds: number): string {
    return `Link expires ${stampLine(expiresAt)} (in ${remaining(seconds)})`;
  },
  shareInactive: "This report link is no longer active",
  shareMissing: "This report link does not exist",

  deviceRow(name: string, online: boolean): string {
    return `${name} ${DASH} ${online ? "Online" : "Offline"}`;
  },
  devicesHeader(name: string): string {
    return `This browser is ${name}`;
  },

  diveStatus(status: string): string {
    return `Dive status: ${status}`;
  },
};

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/// `<h>` is expires_in_s ÷ 3600 rounded down; `<m>` is the remainder after
/// whole hours ÷ 60, rounded down.
export function remaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours} h ${minutes} min`;
}

export function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function utcTime(at: Date): string {
  return at.toISOString().slice(11, 16);
}

export function stampLine(iso: string): string {
  const at = new Date(iso);
  return `${utcDate(at)} ${utcTime(at)} UTC`;
}

export function clockText(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = String(Math.floor(safe / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const rest = String(safe % 60).padStart(2, "0");
  return `${hours}:${minutes}:${rest}`;
}
