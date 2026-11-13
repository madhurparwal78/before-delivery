import { DEFAULT_ZOOM } from "../../shared/limits";

export type Panel = "inspector" | "comments" | "exports" | "none";
const PANELS: readonly Panel[] = ["inspector", "comments", "exports", "none"];

interface Address {
  frame: number;
  zoom: number;
  clip: string | null;
  panel: Panel;
}

function whole(value: string | null): number | null {
  return value !== null && /^\d+$/.test(value) ? Number(value) : null;
}

/** Reads the four view parameters; anything out of range or unknown falls back to its default. */
export function parseAddress(search: string, lastFrame: number, clipIds: ReadonlySet<string>): Address {
  const params = new URLSearchParams(search);
  const frame = whole(params.get("frame"));
  const zoom = whole(params.get("zoom"));
  const clip = params.get("clip");
  const panel = PANELS.find((candidate) => candidate === params.get("panel"));
  return {
    frame: frame === null ? 0 : Math.min(frame, Math.max(0, lastFrame)),
    zoom: zoom !== null && zoom <= 5 ? zoom : DEFAULT_ZOOM,
    clip: clip && clipIds.has(clip) ? clip : null,
    panel: panel ?? "none",
  };
}

/** The query string for a view, in the published order, leaving out what is at its default. */
export function buildSearch(address: Address): string {
  const params = new URLSearchParams();
  if (address.frame > 0) params.set("frame", String(address.frame));
  if (address.zoom !== DEFAULT_ZOOM) params.set("zoom", String(address.zoom));
  if (address.clip) params.set("clip", address.clip);
  if (address.panel !== "none") params.set("panel", address.panel);
  const text = params.toString();
  return text ? `?${text}` : "";
}
