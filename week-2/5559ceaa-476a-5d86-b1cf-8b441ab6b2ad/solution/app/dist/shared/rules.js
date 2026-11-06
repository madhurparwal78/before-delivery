// Domain rules both the server (which enforces them) and the browser (which shows only what they allow) read.
/** Session transitions: each action's target state and the states it may start from. */
export const TRANSITIONS = {
    start: { to: "live", from: ["scheduled"] },
    pause: { to: "paused", from: ["live"] },
    resume: { to: "live", from: ["paused"] },
    end: { to: "ended", from: ["live", "paused"] },
};
/** The write rule: with a live session only its driver writes, with a paused one nobody, otherwise every member. */
export function writeRefusal(running, userId) {
    if (!running)
        return null;
    if (running.state === "paused")
        return "session_paused";
    return running.driver_id === userId ? null : "not_driver";
}
/** Only the mentor or the current driver may pass the baton. */
export function mayPass(role, driverId, userId) {
    return role === "mentor" || driverId === userId;
}
