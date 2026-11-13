import type { Grant, Person } from "../shared/types.js";
import { formatCountdown, formatInstant } from "../shared/format.js";
import { el } from "./dom.js";

export function offerWarningCopy(grant: Grant): string {
  return `The offer for grant ${grant.id} lapses at ${formatInstant(grant.offer_expires_at ?? "")}. Accept or decline before then.`;
}

export function offerWarningStrip(grants: readonly Grant[], now: Date): HTMLElement | null {
  const warned = grants.find(
    (grant) =>
      grant.state === "offered" &&
      grant.offer_warning_at !== null &&
      new Date(grant.offer_warning_at).getTime() <= now.getTime(),
  );
  if (warned === undefined) return null;
  return el("section", { class: "strip strip-red", role: "region", "aria-label": "Offer warning" }, [
    offerWarningCopy(warned),
  ]);
}

/** The latest leaver warning whose time has passed, in the published countdown format. */
export function passedWindowWarning(person: Person, now: Date): number | null {
  if (person.departure === null) return null;
  const windowEnds = new Date(person.departure.window_ends_at).getTime();
  if (now.getTime() >= windowEnds) return null;
  const passed = person.departure.warnings_at
    .map((at) => new Date(at).getTime())
    .filter((at) => at <= now.getTime())
    .sort((a, b) => a - b);
  const latest = passed[passed.length - 1];
  return latest === undefined ? null : windowEnds - latest;
}

export function windowWarningCopy(grantId: string, warningMilliseconds: number): string {
  return `Your exercise window on grant ${grantId} closes in ${formatCountdown(warningMilliseconds)}.`;
}

export function windowWarningStrip(person: Person, grants: readonly Grant[], now: Date): HTMLElement | null {
  const remaining = passedWindowWarning(person, now);
  if (remaining === null) return null;
  const grant = grants.find((candidate) => candidate.state === "accepted");
  if (grant === undefined) return null;
  return el("section", { class: "strip strip-red", role: "region", "aria-label": "Window warning" }, [
    windowWarningCopy(grant.id, remaining),
  ]);
}
