/** The published sentences the server owns, character for character. */
export const sentences = {
  printOutage: 'Printing is down. The prices on this page are still correct.',
  storageOutage: 'Stored copies are unavailable right now. The prices on this page are still correct.',
  unknownBatch: "We can't find that batch. Check the code printed near the best-before date.",
  unknownPack: "This pack isn't in the programme.",
  noSticker: 'No sticker on this pack. The printed price is the price.',
  pastDate: "This pack is past its best-before date. Please don't drink it.",
  staleDraft: 'This draft changed in another tab. Reload to see it.',
  closedWrapperWindow: 'No notice allows old wrappers for this pack on that date.',
  badSheetQuoting: 'This sheet has a broken quoted field.',
  rotationUnavailable: 'Rotation needs the message service. Try again shortly.',
  rotationInProgress: 'This secret is already being rotated.',
  nothingToRecover: 'Nothing on this endpoint is waiting for recovery.',
  badCredentials: "That email and password don't match.",
  endpointRefused: "That address can't receive price messages. Use a public https address.",
  recordUnavailable: 'The record is unavailable. Please try again shortly.',
} as const;

export function waitMessage(seconds: number): string {
  return `Too many tries. Wait ${seconds} seconds and try again.`;
}
