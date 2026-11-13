// Qualification, decided once here: an interpreter qualifies when they hold an unexpired
// credential from the setting's list on the booking's agency-local start date.
export const SETTING_CREDENTIALS = {
    medical: ['NIC', 'BEI'],
    educational: ['EIPA', 'NIC'],
    legal: ['SC:L'],
    workplace: ['NIC', 'BEI'],
};
export function isQualified(setting, credentials, assignmentDate) {
    const wanted = SETTING_CREDENTIALS[setting];
    if (!wanted)
        return false;
    return credentials.some((c) => wanted.includes(c.code) && c.expires_on >= assignmentDate);
}
/** Busy means holding a seat on another booking that is not cancelled and whose start-to-end
 * span overlaps this one. Spans that only touch do not overlap. */
export function spansOverlap(startA, endA, startB, endB) {
    return startA < endB && startB < endA;
}
