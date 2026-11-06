// Hang rules (brief: Business rules, Hang rules), checked in order for every placement, move and
// undo-restore. The first failure is the rejection.
export const CENTRE_LINE_MM = 1450;
const MIN_GAP_MM = 200;

type HangReason = "off_wall" | "off_centre_line" | "too_close" | "too_bright";

interface HangWall {
  name: string;
  lengthMm: number;
  heightMm: number;
  plannedLux: number;
}

interface HangWork {
  widthMm: number;
  heightMm: number;
  offsetMm: number;
  centreHeightMm: number;
  heightOverride: boolean;
  luxLimit: number;
}

interface Neighbour {
  title: string;
  offsetMm: number;
  widthMm: number;
}

interface HangRejection {
  reason: HangReason;
  message: string;
}

export function checkHang(work: HangWork, wall: HangWall, neighbours: Neighbour[]): HangRejection | null {
  const left = work.offsetMm - work.widthMm / 2;
  const right = work.offsetMm + work.widthMm / 2;
  const bottom = work.centreHeightMm - work.heightMm / 2;
  const top = work.centreHeightMm + work.heightMm / 2;
  if (left < 0 || right > wall.lengthMm || bottom < 0 || top > wall.heightMm) {
    return { reason: "off_wall", message: `Runs off the wall: keep the whole work on ${wall.name}.` };
  }
  if (!work.heightOverride && work.centreHeightMm !== CENTRE_LINE_MM) {
    return {
      reason: "off_centre_line",
      message: "Off the 145 cm centre line: set the centre height to 145 cm or mark it as an exception.",
    };
  }
  const closest = neighbours
    .map((n) => ({ n, gap: Math.max(n.offsetMm - n.widthMm / 2 - right, left - (n.offsetMm + n.widthMm / 2)) }))
    .filter(({ gap }) => gap < MIN_GAP_MM)
    .sort((a, b) => a.gap - b.gap || a.n.offsetMm - b.n.offsetMm)[0];
  if (closest) {
    return { reason: "too_close", message: `Too close to ${closest.n.title}: keep at least 20 cm between works.` };
  }
  if (wall.plannedLux > work.luxLimit) {
    return {
      reason: "too_bright",
      message: `Too bright for this work: ${wall.name} is lit at ${wall.plannedLux} lux and the limit is ${work.luxLimit} lux.`,
    };
  }
  return null;
}
