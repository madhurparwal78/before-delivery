/** Club-local wall-clock text for the time fields, mirroring the server's
 * club-time rule for display only: the server remains the authority. */
export function clubLocalText(iso, timeZone) {
    if (!iso)
        return "";
    const date = new Date(iso);
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(date);
    const get = (t) => parts.find((p) => p.type === t)?.value ?? "00";
    const base = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
    if (get("second") !== "00")
        return `${base}:${get("second")}`;
    return base;
}
