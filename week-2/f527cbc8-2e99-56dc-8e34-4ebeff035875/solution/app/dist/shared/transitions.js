// The barn day and booking edges (brief: Business rules, Barn day states and Bookings), written once. The server's
// rule modules refuse actions with them; the browser uses them to show a control only when its edge is legal.
// No imports: both the Node server and the browser bundle load this file.
export const DAY_EDGES = {
    edit: { from: ["draft"], to: "draft" },
    publish: { from: ["draft"], to: "published" },
    start: { from: ["published", "full"], to: "in_progress" },
    close: { from: ["in_progress"], to: "closed" },
    cancel: { from: ["draft", "published", "full"], to: "cancelled" },
};
export const dayActionAllowed = (status, action) => DAY_EDGES[action].from.includes(status);
export const BOOKING_EDGES = {
    confirm: { from: "held", to: "confirmed" },
    release: { from: "held", to: "released" },
    lapse: { from: "held", to: "lapsed" },
    remove: { from: "held", to: "removed" },
    cancel: { from: "confirmed", to: "cancelled_in_time" },
    open_visit: { from: "confirmed", to: "worked" },
    no_show: { from: "confirmed", to: "no_show" },
    excuse: { from: "confirmed", to: "excused" },
};
export const bookingActionAllowed = (status, action) => BOOKING_EDGES[action].from === status;
/** Opening a visit and marking a no-show need the day in progress (the day_not_in_progress guard). */
export const dayIsWorking = (status) => status === "in_progress";
