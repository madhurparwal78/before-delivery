/** Legal listing transitions. rendering may return to the prior status on failure. */
export const LISTING_TRANSITIONS = {
    draft: ['rendering', 'withdrawn'],
    rendering: ['live', 'draft', 'under_offer', 'sold', 'withdrawn'],
    live: ['rendering', 'under_offer', 'withdrawn'],
    under_offer: ['sold', 'withdrawn'],
    sold: [],
    withdrawn: [],
};
export function listingTransitionAllowed(from, to) {
    return LISTING_TRANSITIONS[from].includes(to);
}
/** Legal offer transitions. */
export function offerTransitionAllowed(from, to) {
    switch (from) {
        case 'open': return to === 'needs_reread' || to === 'accepted' || to === 'declined' || to === 'lapsed' || to === 'closed_by_acceptance';
        case 'needs_reread': return to === 'open' || to === 'declined' || to === 'lapsed' || to === 'closed_by_acceptance';
        default: return false;
    }
}
export const OFFER_STATUS_WORD = {
    open: 'Open', needs_reread: 'Needs re-read', accepted: 'Accepted', declined: 'Declined',
    lapsed: 'Lapsed', closed_by_acceptance: 'Closed by another acceptance',
};
export const LISTING_STATUS_WORD = {
    draft: 'Draft', rendering: 'Rendering', live: 'Live', under_offer: 'Under offer', sold: 'Sold', withdrawn: 'Withdrawn',
};
export const ALERT_STATE_WORD = { waiting: 'Waiting', delivered: 'Delivered', failed: 'Failed' };
export const OFFER_LAPSE_SECONDS_DEFAULT = 172_800;
export const OFFER_WARNING_SECONDS_DEFAULT = 14_400;
export const LINK_TTL_SECONDS_DEFAULT = 1_209_600;
export const RECORD_PULL_MAX_AGE_SECONDS_DEFAULT = 2_592_000;
/** The hero finding: highest severity, tie to earliest walkround position. */
export function heroOf(findings) {
    let best = null;
    for (const f of findings) {
        if (!best) {
            best = f;
            continue;
        }
        const better = f.severity !== best.severity
            ? severityOrder(f.severity) > severityOrder(best.severity)
            : f.position < best.position;
        if (better)
            best = f;
    }
    return best ? best.id : null;
}
function severityOrder(severity) {
    return severity === 'serious' ? 2 : severity === 'moderate' ? 1 : 0;
}
export const PUBLISH_BLOCKER_COPY = {
    no_findings: 'Add at least one finding',
    no_record_pull: 'Pull the test record',
    record_stale: 'The test record is too old. Pull it again.',
    advisories_unanswered: 'Answer every advisory from the latest pull',
    advisory_recurred: 'Change the stance on each advisory seen again at a later test',
};
