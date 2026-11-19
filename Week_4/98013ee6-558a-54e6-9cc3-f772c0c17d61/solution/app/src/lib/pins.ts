import type { FeedPin, Pin } from "../../shared/types";

/** The credit line a card or page shows for a pin. */
export function creditLine(pin: Pin | FeedPin): string {
  if ("group" in pin && pin.group.owners.length > 1) {
    const [first = "", second = ""] = pin.group.owners;
    return pin.group.owners.length === 2 ? `Saved by ${first} and ${second}` : `Saved by ${first} and ${pin.group.owners.length - 1} others`;
  }
  if (pin.saved_from === null) return pin.owner.name;
  return pin.saved_from.removed ? `Saved from ${pin.saved_from.user_name} · Original removed` : `Saved from ${pin.saved_from.user_name}`;
}

/** The smallest stored width that stays sharp at the given CSS width, the original when none is wide enough. */
export function imageSource(pin: Pin, cssWidth: number): string {
  const wanted = cssWidth * Math.min(window.devicePixelRatio || 1, 2);
  const fit = pin.image.variants.find((candidate) => candidate.width >= wanted);
  return fit ? fit.url : pin.image.original_url;
}
