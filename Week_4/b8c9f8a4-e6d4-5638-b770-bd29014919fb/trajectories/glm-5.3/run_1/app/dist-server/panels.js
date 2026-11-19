export const JSON_BODY_LIMIT = 65_536;
export const CAPTURE_BODY_LIMIT = 262_144;
export const UPLOAD_REQUEST_LIMIT = 8_200_000;
export const PANELS = [
    { id: 'bonnet', label: 'Bonnet', substrate: 'aluminium' },
    { id: 'os-front-wing', label: 'Offside front wing', substrate: 'steel' },
    { id: 'os-door', label: 'Offside door', substrate: 'steel' },
    { id: 'os-sill', label: 'Offside sill', substrate: 'steel' },
    { id: 'os-rear-quarter', label: 'Offside rear quarter', substrate: 'steel' },
    { id: 'boot-lid', label: 'Boot lid', substrate: 'aluminium' },
    { id: 'rear-bumper', label: 'Rear bumper', substrate: 'plastic' },
    { id: 'ns-rear-quarter', label: 'Nearside rear quarter', substrate: 'steel' },
    { id: 'ns-sill', label: 'Nearside sill', substrate: 'steel' },
    { id: 'ns-door', label: 'Nearside door', substrate: 'steel' },
    { id: 'ns-front-wing', label: 'Nearside front wing', substrate: 'steel' },
    { id: 'front-bumper', label: 'Front bumper', substrate: 'plastic' },
    { id: 'roof', label: 'Roof', substrate: 'steel' },
];
export const PANEL_BY_ID = Object.fromEntries(PANELS.map(p => [p.id, p]));
export const PANEL_FRAMES = {
    'bonnet': { origin: [-0.75, 0.85, -2.00], U: [1.5, 0, 0], V: [0, 0.1, 1.2] },
    'os-front-wing': { origin: [0.85, 0.45, -2.00], U: [0, 0, 1.0], V: [0, 0.4, 0] },
    'os-door': { origin: [0.85, 0.40, -1.00], U: [0, 0, 1.2], V: [0, 0.5, 0] },
    'os-sill': { origin: [0.85, 0.20, -1.00], U: [0, 0, 2.0], V: [0, 0.2, 0] },
    'os-rear-quarter': { origin: [0.85, 0.40, 0.20], U: [0, 0, 1.8], V: [0, 0.5, 0] },
    'boot-lid': { origin: [0.70, 0.90, 1.40], U: [-1.4, 0, 0], V: [0, -0.1, 0.6] },
    'rear-bumper': { origin: [0.85, 0.30, 2.10], U: [-1.7, 0, 0], V: [0, 0.3, 0] },
    'ns-rear-quarter': { origin: [-0.85, 0.40, 2.00], U: [0, 0, -1.8], V: [0, 0.5, 0] },
    'ns-sill': { origin: [-0.85, 0.20, 1.00], U: [0, 0, -2.0], V: [0, 0.2, 0] },
    'ns-door': { origin: [-0.85, 0.40, 0.20], U: [0, 0, -1.2], V: [0, 0.5, 0] },
    'ns-front-wing': { origin: [-0.85, 0.45, -1.00], U: [0, 0, -1.0], V: [0, 0.4, 0] },
    'front-bumper': { origin: [-0.85, 0.30, -2.10], U: [1.7, 0, 0], V: [0, 0.3, 0] },
    'roof': { origin: [-0.60, 1.30, -0.50], U: [1.2, 0, 0], V: [0, 0, 1.4] },
};
/** World point of a panel-local anchor: origin + u*U + v*V. */
export function panelPoint(panelId, u, v) {
    const f = PANEL_FRAMES[panelId];
    return [
        f.origin[0] + u * f.U[0] + v * f.V[0],
        f.origin[1] + u * f.U[1] + v * f.V[1],
        f.origin[2] + u * f.U[2] + v * f.V[2],
    ];
}
/** The four frame edges of a panel, each as [start, end] world points. */
export function panelEdges(panelId) {
    const f = PANEL_FRAMES[panelId];
    const o = f.origin;
    const pU = [o[0] + f.U[0], o[1] + f.U[1], o[2] + f.U[2]];
    const pUV = [o[0] + f.U[0] + f.V[0], o[1] + f.U[1] + f.V[1], o[2] + f.U[2] + f.V[2]];
    const pV = [o[0] + f.V[0], o[1] + f.V[1], o[2] + f.V[2]];
    return [[o, pU], [pU, pUV], [pUV, pV], [pV, o]];
}
/** Midpoint of each frame edge. */
export function panelEdgeMidpoints(panelId) {
    return panelEdges(panelId).map(([a, b]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
}
export const SEVERITIES = ['cosmetic', 'moderate', 'serious'];
export const severityRank = { cosmetic: 0, moderate: 1, serious: 2 };
export const isMaterial = (severity) => severity !== 'cosmetic';
/** Paint band from reading minus substrate median. */
export function bandForDelta(delta) {
    if (delta < -30)
        return 'Thin';
    if (delta <= 40)
        return 'Original';
    if (delta <= 150)
        return 'Refinished';
    return 'Filler';
}
/** Median of owner readings on a substrate, rounded half up to a whole micron; null when none. */
export function substrateMedian(readings) {
    if (readings.length === 0)
        return null;
    const sorted = [...readings].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return roundHalfUp(value);
}
export function roundHalfUp(value) {
    return Math.floor(value + 0.5);
}
/** Mils string: microns / 25.4, rounded half up to one decimal. */
export function micronsToMils(microns) {
    const tenths = Math.floor(microns / 25.4 * 10 + 0.5);
    return (tenths / 10).toFixed(1);
}
export function maskedRegistration(registration) {
    const chars = registration.split('');
    return chars.map((c, i) => (i < 2 ? c : '*')).join('');
}
export function formatPounds(amount) {
    return '£' + amount.toLocaleString('en-GB');
}
