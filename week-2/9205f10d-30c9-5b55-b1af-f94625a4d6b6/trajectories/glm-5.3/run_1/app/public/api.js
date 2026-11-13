/* Crosshand Relay client: state, API, formatting, and the app shell. */
const AGENCY_TZ = "America/New_York";
/* --------------------------------------------------------------- formatting */
export function fmtTime(iso) {
    return new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function fmtDate(iso) {
    return new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, month: "short", day: "numeric" }).format(new Date(iso));
}
export function fmtWeekday(iso) {
    return new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, weekday: "short" }).format(new Date(iso));
}
export function fmtDateKey(iso) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: AGENCY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
export function fmtCutoff(iso) {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: AGENCY_TZ, weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(new Date(iso));
}
export function fmtClockStamp(iso) {
    return new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function fmtDayStamp(iso) {
    return new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, month: "short", day: "numeric" }).format(new Date(iso));
}
export const STATUS_LABELS = {
    draft: "Draft",
    submitted: "Open seat",
    half_staffed: "Half-staffed",
    staffed: "Staffed",
    completed: "Completed",
    invoiced: "Invoiced",
    cancelled_early: "Cancelled",
    cancelled_late: "Cancelled (late fee)",
};
export const SETTING_WORDS = {
    medical: "Medical", education: "Education", legal: "Legal",
};
/* --------------------------------------------------------------------- api */
export class Unreachable extends Error {
}
export async function api(method, path, body, opts) {
    const headers = {};
    if (body !== undefined)
        headers["Content-Type"] = "application/json";
    if (opts?.idempotencyKey)
        headers["Idempotency-Key"] = opts.idempotencyKey;
    let res;
    try {
        res = await fetch(path, {
            method,
            headers,
            body: body === undefined ? null : JSON.stringify(body),
            credentials: "same-origin",
        });
    }
    catch {
        throw new Unreachable("network");
    }
    if (res.status === 204)
        return undefined;
    const text = await res.text();
    let parsed = undefined;
    try {
        parsed = text ? JSON.parse(text) : undefined;
    }
    catch {
        parsed = { error: { code: "bad_response", message: "Unexpected response." } };
    }
    if (!res.ok) {
        const err = parsed;
        const out = new Error(err?.error?.message ?? "Request failed.");
        out.api = err;
        throw out;
    }
    return parsed;
}
export function parseRoute() {
    const [path, search] = window.location.hash.replace(/^#/, "").split("?");
    return { path: path || "/", query: new URLSearchParams(search ?? "") };
}
export function navigate(path) {
    window.location.hash = path.startsWith("/") ? path : `/${path}`;
}
export function homeFor(role) {
    switch (role) {
        case "coordinator": return "/board";
        case "interpreter": return "/open-seats";
        case "client_scheduler": return "/requests";
        case "billing_admin": return "/billing";
    }
}
export const NAV_LINKS = {
    coordinator: [["Week board", "/board"], ["Credentials", "/credentials"]],
    interpreter: [["Open seats", "/open-seats"], ["My assignments", "/assignments"], ["Profile", "/profile"]],
    client_scheduler: [["Requests", "/requests"], ["New request", "/requests/new"], ["Invoices", "/invoices"]],
    billing_admin: [["Billing", "/billing"], ["Invoices", "/invoices"]],
};
/* ------------------------------------------------------------------- dom */
export function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null || v === false)
                continue;
            if (k === "class")
                node.setAttribute("class", String(v));
            else if (k === "dataset")
                Object.assign(node.dataset, v);
            else if (k.startsWith("on") && typeof v === "function") {
                node.addEventListener(k.slice(2), v);
            }
            else if (v === true)
                node.setAttribute(k, "");
            else
                node.setAttribute(k, String(v));
        }
    }
    for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false)
            continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}
export function clear(node) {
    while (node.firstChild)
        node.removeChild(node.firstChild);
}
export function seatCounterHtml(confirmed, total) {
    const wrap = el("span", { class: "seat-counter", "aria-hidden": "true" });
    for (let i = 0; i < total; i++) {
        wrap.append(el("i", { class: i < confirmed ? "solid" : "hatched" }));
    }
    return wrap;
}
export function statusLabel(status) {
    return STATUS_LABELS[status] ?? status;
}
