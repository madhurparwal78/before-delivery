export function studioLabel(iso, timeZone = "America/Chicago") {
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    });
    const parts = fmt.formatToParts(iso);
    const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
    const weekday = get("weekday");
    const hour = get("hour");
    const minute = get("minute");
    const dayPeriod = get("dayPeriod").toUpperCase();
    return `${weekday} ${hour}:${minute} ${dayPeriod}`;
}
export function studioDate(iso) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });
    return fmt.format(iso);
}
export function centsToDollars(cents) {
    const sign = cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
export function jsonOk(res, status, body) {
    res.status(status).json(body);
}
export function requireUser(req) {
    if (!req.user)
        throw new Error("user missing on authenticated route");
    return req.user;
}
export function isStaff(user) {
    return user.role === "owner" || user.role === "tech";
}
