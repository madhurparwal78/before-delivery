export const BG_COLORS = { kraft: "#E5D8BE", green: "#2A4E31" };
export const TOP_COLORS = {
    mine: "#B5541A",
    taken: "#26211A",
    dropped: "#6B5C48",
};
export const INK = "#26211A";
export const KRAFT_LIGHT = "#F1E7D2";
export const INSIDE_TONE = "#EFE5CD";
export const BOX_FACE = "#D8C7A0";
export const BOX_FACE_DARK = "#C9B58C";
export const GLASS = "#CFCBBB";
export const PAPER = "#DCCDA9";
/** Grid columns for a pack: smallest divisor at least the square root. */
export function gridColumns(pack) {
    for (let c = Math.ceil(Math.sqrt(pack)); c <= pack; c++) {
        if (pack % c === 0)
            return c;
    }
    return pack;
}
export function crateName(line) {
    const state = line.status === "filling" ? "filling" : line.status === "sealed" ? "sealed" : line.status === "taken_up" ? "taken up" : "dropped";
    return `Crate of ${line.case_name}: ${line.pledged_units} of ${line.pack} units pledged, ${state}`;
}
/** The single place that decides whether a line may be drawn. */
export function lineIsNewer(shown, candidate) {
    return shown === null || candidate > shown;
}
