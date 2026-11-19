// The homing flight (brief: Motion and effects, Signature): after a move is acknowledged each moved file lifts a name
// chip from its row and flies it on a curve to the destination's tree node (the path bar at phone width), 40 ms
// apart, at most 8 chips plus one "+n", each 420 ms; rows collapse after their chip leaves; counts step on landing.
import { folders, heldCounts, plusBadge } from "../data";
import { matches, PHONE, REDUCED } from "../media";

const CHIP_MS = 420;
const STAGGER_MS = 40;
const CAP = 8;
const COLLAPSE_MS = 180;
const POINTS = 16;
const BOW = 0.42;
const EASE = "cubic-bezier(.16,.84,.3,1)";

export function reducedMotion(): boolean {
  return matches(REDUCED);
}

function layer(): HTMLElement {
  let found = document.getElementById("homing-layer");
  if (!found) {
    found = document.createElement("div");
    found.id = "homing-layer";
    found.setAttribute("aria-hidden", "true");
    document.body.append(found);
  }
  return found;
}

function visible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

/** The folder and its ancestors, nearest first. */
function lineage(folderId: string): string[] {
  const byId = new Map(folders.get().map((f) => [f.id, f]));
  const out: string[] = [];
  for (let f = byId.get(folderId); f; f = f.parentId ? byId.get(f.parentId) : undefined) out.push(f.id);
  return out;
}

/** Where chips land: the destination's tree node or its nearest visible ancestor; at phone width the path bar. */
function landingTarget(folderId: string | null): { el: HTMLElement; folderId: string | null } | null {
  if (matches(PHONE)) {
    const segments = [...document.querySelectorAll<HTMLElement>("[data-path-segment]")].filter(visible);
    if (!segments.length) return null;
    if (folderId) {
      for (const id of lineage(folderId)) {
        const hit = segments.find((s) => s.dataset.pathSegment === id);
        if (hit) return { el: hit, folderId: id };
      }
    }
    const first = segments[0];
    return first ? { el: first, folderId: first.dataset.pathSegment || null } : null;
  }
  if (!folderId) return null;
  for (const id of lineage(folderId)) {
    const node = document.querySelector(`[data-tree="Folders"] [data-folder-node="${CSS.escape(id)}"]`);
    if (visible(node)) return { el: node, folderId: id };
  }
  return null;
}

function curve(sx: number, sy: number, ex: number, ey: number): [number, number][] {
  const dx = ex - sx, dy = ey - sy;
  const dist = Math.hypot(dx, dy) || 1;
  let nx = -dy / dist, ny = dx / dist;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const cx = (sx + ex) / 2 + nx * dist * BOW, cy = (sy + ey) / 2 + ny * dist * BOW;
  return Array.from({ length: POINTS + 1 }, (_, i) => {
    const t = i / POINTS, u = 1 - t;
    return [u * u * sx + 2 * u * t * cx + t * t * ex, u * u * sy + 2 * u * t * cy + t * t * ey];
  });
}

export interface Flyer {
  fileId: string;
  name: string;
  row: HTMLElement | null;
  /** Where this file's chip lands; a lost file flies to the winner's folder. */
  folderId: string | null;
}

/**
 * Flies the chips and collapses the rows; `land` runs when the last chip lands (at once under reduced motion,
 * where the destination shows a static "+n" badge instead). Returns the total flight time.
 */
export function fly(flyers: Flyer[], destination: string | null, land: () => void): number {
  const withRows = flyers.filter((f) => f.row && f.row.isConnected);
  const held = new Set<string>();
  if (reducedMotion()) {
    const target = landingTarget(destination);
    if (flyers.length) {
      plusBadge.set({ folderId: target ? target.folderId : destination, n: flyers.length });
      clearBadgeOnFocus();
    }
    land();
    return 0;
  }
  const counts = Object.fromEntries(folders.get().map((f) => [f.id, f.fileCount]));
  const hold = (id: string | null) => {
    if (id && counts[id] !== undefined) held.add(id);
  };
  for (const f of flyers) hold(f.folderId);
  hold(destination);
  for (const f of folders.get()) if (withRows.some((w) => w.row?.dataset.fromFolder === f.id)) hold(f.id);
  heldCounts.set((current) => ({ ...Object.fromEntries([...held].map((id) => [id, counts[id] ?? 0])), ...current }));
  const host = layer();
  const chips: HTMLElement[] = [];
  const launch = (label: string, chipId: string, from: DOMRect, folderId: string | null, index: number) => {
    const target = landingTarget(folderId);
    const chip = document.createElement("div");
    chip.className = "homing-chip";
    chip.dataset.homingChip = chipId;
    chip.textContent = label;
    host.append(chip);
    chips.push(chip);
    const w = chip.offsetWidth, h = chip.offsetHeight;
    const sx = from.left + Math.min(from.width / 2, 16 + w / 2), sy = from.top + from.height / 2;
    const end = target?.el.getBoundingClientRect();
    const ex = end ? end.left + end.width / 2 : sx, ey = end ? end.top + end.height / 2 : sy - 40;
    const frames = curve(sx, sy, ex, ey).map(([x, y], i, all) => ({
      transform: `translate(${(x - w / 2).toFixed(1)}px, ${(y - h / 2).toFixed(1)}px) scale(${(1 - 0.25 * (i / (all.length - 1))).toFixed(3)})`,
    }));
    chip.animate(frames, { duration: CHIP_MS, delay: index * STAGGER_MS, easing: EASE, fill: "both" });
  };
  const capped = withRows.slice(0, CAP);
  capped.forEach((f, i) => {
    if (f.row) launch(f.name, f.fileId, f.row.getBoundingClientRect(), f.folderId, i);
  });
  const rest = withRows.slice(CAP);
  const firstRest = rest[0];
  if (firstRest?.row) launch(`+${rest.length}`, "more", firstRest.row.getBoundingClientRect(), firstRest.folderId, CAP);
  withRows.forEach((f, i) => {
    const row = f.row;
    if (!row) return;
    const height = row.getBoundingClientRect().height;
    row.animate([{ height: `${height}px`, opacity: 0.5 }, { height: "0px", opacity: 0, paddingBlock: "0px", borderBottomWidth: "0px" }],
      { duration: COLLAPSE_MS, delay: Math.min(i, CAP) * STAGGER_MS + 60, easing: "ease-out", fill: "forwards" });
  });
  const launched = Math.min(withRows.length, CAP) + (rest.length ? 1 : 0);
  const total = launched ? (launched - 1) * STAGGER_MS + CHIP_MS : 0;
  setTimeout(() => {
    for (const chip of chips) chip.remove();
    heldCounts.set((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !held.has(id))));
    land();
  }, total);
  return total;
}

/** Under reduced motion the "+n" badge stays until focus next moves. */
function clearBadgeOnFocus(): void {
  document.addEventListener("focusin", () => plusBadge.set(null), { once: true });
}
