/** Every string Tracewell shows, character for character. */
export const BOARD_COPY = {
  loading: 'Loading figures...',
  refreshFailed: 'Figures could not be refreshed. Showing the last loaded figures.',
  vaultUnavailable:
    'Filing vault unavailable \u2014 exhibits are temporarily unavailable. Figures shown are unchanged.',
  exhibitDownloadVaultDown:
    'Filing vault unavailable \u2014 this exhibit cannot be downloaded right now. Figures shown are unchanged.',
  unexpected: 'Something went wrong. Nothing was changed.',
  footer:
    'Figures are preliminary and unaudited. Each figure links to the filing it comes from; where they differ, the filing controls.',
  citationNotFound: 'No published figure for that date.',
  restated: 'Restated',
  viewSuperseding: 'View superseding entry',
  closeTrace: 'Close',
  citeFigure: 'Cite this figure',
  setsAsOf: 'Sets as-of',
} as const;

export function sessionOpenLine(closesAtShort: string): string {
  return `Session open \u2014 closes at ${closesAtShort} ET`;
}

export function marketClosedLine(officialCloseDate: string): string {
  return `Market closed \u2014 share price is the ${officialCloseDate} official close`;
}

export function sessionCloseAnnouncement(officialCloseDate: string): string {
  return `Equity session closed. Share price is now the ${officialCloseDate} official close.`;
}

export function ethLiveLine(lastTickTime: string): string {
  return `Live \u2014 last tick ${lastTickTime} ET`;
}

export function ethStaleLine(lastTickTime: string | null): string {
  return lastTickTime === null
    ? 'Stale \u2014 no ETH tick received'
    : `Stale \u2014 no ETH tick since ${lastTickTime} ET`;
}

export function holdingsLine(weekEnding: string): string {
  return `Week ending ${weekEnding} \u2014 as of ${weekEnding} 23:59:59 ET`;
}

export function tileAsOfLine(date: string, time: string): string {
  return `As of ${date} ${time} ET`;
}

export function tileCitationLine(accession: string, page: number): string {
  return `Accession ${accession} \u00b7 p. ${page}`;
}

export function lastTickLine(time: string): string {
  return `Last tick ${time} ET`;
}

export function officialCloseLine(date: string, time: string): string {
  return `Official close ${date} at ${time} ET`;
}

export function restatedLine(on: string, reason: string): string {
  return `Restated on ${on}: ${reason}`;
}

export function provisionalLine(date: string): string {
  return `Provisional \u2014 ${date} has not ended; this figure may still change.`;
}

export function citationHeading(label: string, date: string): string {
  return `${label} as of the end of ${date}`;
}

export const STAFF_COPY = {
  signInFailed: 'Email or password is incorrect.',
  sessionEndedDialog: 'Your session ended. Sign in again to finish this action.',
  sessionEndedUpdates: 'Your session ended. Sign in to save your changes.',
  draftSaved: 'Draft saved.',
  draftProblem: 'There is a problem with this draft',
  sentToCounsel: 'Sent to disclosure counsel.',
  sendRefusedExhibit: 'Attach a verified exhibit before sending to disclosure counsel.',
  returned: 'Returned to the treasury analyst.',
  cleared: 'Cleared for release.',
  versionConflict: 'This restatement changed since you opened it. Reload to see the current version.',
  withdrawn: 'Release withdrawn \u2014 the restatement is cleared again.',
  withdrawRefused: 'This restatement has already published or changed. Refresh to see its current state.',
  uploadInProgress: 'Uploading exhibit and checking SHA-256...',
  uploadHashMismatch: "Exhibit rejected \u2014 the vault copy's SHA-256 does not match the file you chose.",
  uploadNotPdf: 'Choose a PDF file.',
  uploadNotFilingSafe:
    'This PDF contains active content, links, embedded files or encryption. Print it to a new PDF and try again.',
  uploadTooLarge: 'The exhibit is larger than the size limit.',
  uploadNoAccession: 'Save the accession number before attaching an exhibit.',
  uploadVaultDown:
    'Filing vault unavailable \u2014 the exhibit was not stored. Try again when the vault is back.',
  releaseTimingClosed: 'Releasing now publishes it at once.',
  releaseUnconfirmed:
    'The release could not be confirmed. Press Release to try again; it will not be released twice.',
  releaseRefusedTwoPerson:
    'You prepared or cleared this restatement, so another disclosure officer must release it.',
  releaseRefusedStateChanged: 'This restatement is no longer cleared. Refresh to see its current state.',
  unexpected: 'Something went wrong. Nothing was changed.',
  noExhibit: 'No exhibit attached',
  exhibitPending: 'Exhibit pending verification',
  exhibitVerified: 'Exhibit verified',
  exhibitRejected: 'Exhibit rejected \u2014 SHA-256 mismatch',
} as const;

export function uploadVerifiedLine(sha256: string): string {
  return `Exhibit verified \u2014 SHA-256 ${sha256} matches the vault copy.`;
}

export function differentUserLine(name: string): string {
  return `Signed in as ${name}. The interrupted action was not sent.`;
}

export function releaseTimingOpenLine(closeTime: string, closeDate: string): string {
  return `Releasing now queues it to the ${closeTime} ET session close on ${closeDate}.`;
}

export function releaseQueuedLine(closeTime: string, closeDate: string): string {
  return `Release queued \u2014 publishes at the ${closeTime} ET session close on ${closeDate}.`;
}

export function releasedNowLine(time: string, date: string): string {
  return `Released \u2014 published at ${time} ET on ${date}.`;
}

export const OPERATOR_COPY = {
  paused: 'Tape paused.',
  playing: 'Tape playing.',
  realTime: 'Clock follows real time.',
  invalidTime: 'Enter a time as YYYY-MM-DD HH:MM:SS in New York time.',
} as const;

export function tapeLine(state: 'playing' | 'paused', position: number): string {
  return state === 'playing' ? `Tape playing at position ${position}` : `Tape paused at position ${position}`;
}

export function marketClockLine(date: string, time: string): string {
  return `Market clock ${date} ${time} ET`;
}

export function clockSetLine(date: string, time: string): string {
  return `Clock set to ${date} ${time} ET.`;
}
