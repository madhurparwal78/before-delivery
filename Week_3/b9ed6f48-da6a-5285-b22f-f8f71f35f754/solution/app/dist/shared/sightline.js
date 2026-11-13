// The sightline rules (brief: Business rules › Sightline). Decided here once; the scene,
// the still viewpoints and the chapters API all call these.
export const YAW_MIN = -60;
export const YAW_MAX = 60;
export const YAW_SPAN = YAW_MAX - YAW_MIN;
export const YAW_STEP = 3;
const RESOLVE_WINDOW = 2.5;
const BASE_VIEWPOINTS = [-60, -40, -20, 0, 20, 40, 60];
/** Whole-degree yaw: halves round away from zero, then clamped to -60..+60. */
export function wholeYaw(yaw) {
    const rounded = Math.sign(yaw) * Math.round(Math.abs(yaw));
    return Math.min(YAW_MAX, Math.max(YAW_MIN, rounded === 0 ? 0 : rounded));
}
/** round(100 × (1 − d / 120)), halves up, on whole degrees. */
export function alignment(yaw, sightline) {
    const d = Math.abs(yaw - sightline);
    return Math.floor((2 * 100 * (YAW_SPAN - d) + YAW_SPAN) / (2 * YAW_SPAN));
}
export function withinResolveWindow(yaw, sightline) {
    return Math.abs(yaw - sightline) <= RESOLVE_WINDOW;
}
/** Seven viewpoints: the base set with the one nearest the sightline (ties: nearer 0) replaced. */
export function viewpoints(sightline) {
    const nearest = BASE_VIEWPOINTS.reduce((best, v) => {
        const by = Math.abs(v - sightline) - Math.abs(best - sightline);
        return by < 0 || (by === 0 && Math.abs(v) < Math.abs(best)) ? v : best;
    });
    return BASE_VIEWPOINTS.map((v) => (v === nearest ? sightline : v)).sort((a, b) => a - b);
}
/** `+33°`, `-45°`, `0°`. */
export function formatAngle(degrees) {
    return `${degrees > 0 ? "+" : ""}${degrees}°`;
}
