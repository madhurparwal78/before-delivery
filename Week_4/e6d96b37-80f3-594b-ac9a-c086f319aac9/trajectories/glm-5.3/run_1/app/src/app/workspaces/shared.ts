import type { Offer, Specimen } from "../../shared/types.js";
import { remainingText, expiryText } from "../feedback.js";

export function windowFor(offer: Offer): string {
  if (offer.status === "sent" || offer.status === "countered") {
    if (offer.remaining_seconds === null || offer.expires_at === null) return "";
    return `${remainingText(offer.remaining_seconds)} left, expires ${expiryText(offer.expires_at)}`;
  }
  if (offer.status === "accepted") {
    return "Accepted. No response window is running.";
  }
  if (offer.status === "expired") {
    return offer.expires_at ? `Window closed ${expiryText(offer.expires_at)}` : "";
  }
  return "";
}

export function specimenLabel(specimen: Specimen | undefined): string {
  return specimen?.display_label ?? "";
}

export function mintmarkOf(specimen: Specimen | undefined): string {
  return specimen?.attribution.mintmark ?? "";
}
