// The publish guards, in order. One check decides both the blockers on every read and publish itself.
export function publishBlockers(programme, now) {
    const blockers = [];
    if (programme.status !== "in_preparation") {
        blockers.push({ error: "illegal_transition", message: "Folders can only be published while the programme is in preparation." });
    }
    if (now >= programme.firstRehearsal) {
        blockers.push({ error: "first_rehearsal_passed", message: "Folders can't be published after the first rehearsal has started." });
    }
    if (programme.workCount === 0) {
        blockers.push({ error: "no_works", message: "Add a work before publishing folders." });
    }
    if (programme.shortfall > 0) {
        const copies = programme.shortfall === 1 ? "1 copy is" : `${programme.shortfall} copies are`;
        blockers.push({ error: "copies_short", message: `Folders can't be published while ${copies} short.` });
    }
    return blockers;
}
