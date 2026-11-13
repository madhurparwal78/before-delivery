// Programme state edges reachable through the transition endpoint (publish has its own guards).
const TRANSITION_EDGES = new Set([
    "draft>in_preparation",
    "in_preparation>draft",
    "published>in_performance",
    "in_performance>closed",
]);
export function transitionAllowed(from, to) {
    return TRANSITION_EDGES.has(`${from}>${to}`);
}
/** Works may be added while a programme is a draft or in preparation. */
export function worksMayBeAdded(status) {
    return status === "draft" || status === "in_preparation";
}
