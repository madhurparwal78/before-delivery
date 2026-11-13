// API shapes shared by the server (which builds them) and the client (which renders them).
export const SECTION_KEYS = ["violin_1", "violin_2", "viola", "cello", "bass"];
export const SECTION_NAMES = {
    violin_1: "Violin I",
    violin_2: "Violin II",
    viola: "Viola",
    cello: "Cello",
    bass: "Bass",
};
export const PROGRAMME_STATUS_LABELS = {
    draft: "Draft",
    in_preparation: "In preparation",
    published: "Published",
    in_performance: "In performance",
    closed: "Closed",
};
export const RENTAL_STATUS_LABELS = {
    requested: "Requested",
    received: "Received",
    in_use: "In use",
    returned: "Returned",
    checked_in: "Checked in",
};
/** `M:SS` for a whole number of seconds. */
export function clockText(seconds) {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
