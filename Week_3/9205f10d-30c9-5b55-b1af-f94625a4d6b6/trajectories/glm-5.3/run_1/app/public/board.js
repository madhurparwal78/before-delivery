import { el, seatCounterHtml, statusLabel } from "./api.js";
export function groupByDay(requests, mondayKey) {
    const days = [];
    const parts = mondayKey.split("-").map((n) => Number(n));
    const y = parts[0] ?? 2026;
    const m = parts[1] ?? 1;
    const d = parts[2] ?? 1;
    for (let i = 0; i < 7; i++) {
        const date = new Date(Date.UTC(y, m - 1, d + i));
        days.push({
            dateKey: date.toISOString().slice(0, 10),
            label: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(date),
            weekday: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(date),
            requests: [],
        });
    }
    for (const r of requests) {
        const day = days.find((x) => x.dateKey === dateKeyOf(r.starts_at));
        if (day)
            day.requests.push(r);
    }
    for (const day of days) {
        day.requests.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.reference.localeCompare(b.reference));
    }
    return days;
}
export function dateKeyOf(iso) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
export function mondayOf(dateKey) {
    const parts = dateKey.split("-").map((n) => Number(n));
    const y = parts[0] ?? 2026;
    const m = parts[1] ?? 1;
    const d = parts[2] ?? 1;
    const utc = Date.UTC(y, m - 1, d) + 12 * 3600_000;
    const wd = new Date(utc).getUTCDay();
    const back = wd === 0 ? 6 : wd - 1;
    const monday = new Date(utc - back * 86_400_000);
    return monday.toISOString().slice(0, 10);
}
export function shiftWeek(mondayKey, deltaWeeks) {
    const parts = mondayKey.split("-").map((n) => Number(n));
    const y = parts[0] ?? 2026;
    const m = parts[1] ?? 1;
    const d = parts[2] ?? 1;
    const t = Date.UTC(y, m - 1, d) + deltaWeeks * 7 * 86_400_000;
    return new Date(t).toISOString().slice(0, 10);
}
export function openSeatCount(r) {
    return r.seats.filter((s) => s.status === "open").length;
}
export function confirmedSeatCount(r) {
    return r.seats.filter((s) => s.status === "confirmed").length;
}
export function rowAccessibleName(r, startTime, orgName) {
    const confirmed = confirmedSeatCount(r);
    return `${r.reference}, ${startTime}, ${orgName}, ${statusLabel(r.status)}, ${confirmed} of ${r.team_size} seats`;
}
export function rowButton(r, orgName, onOpen) {
    const start = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(r.starts_at));
    const confirmed = confirmedSeatCount(r);
    const cancelled = r.status.startsWith("cancelled");
    const btn = el("button", {
        class: "row-button",
        "aria-label": rowAccessibleName(r, start, orgName),
        onclick: (ev) => onOpen(r, ev.currentTarget),
    }, el("span", { class: "time" }, start), el("span", { class: "status-block" }, el("span", { class: "status-label" }, statusLabel(r.status)), seatCounterHtml(confirmed, r.seats.length)), el("span", { class: "meta" }, el("span", { class: "ref" + (cancelled ? " cancelled" : "") }, r.reference), el("span", {}, orgName), el("span", {}, settingWord(r.setting)), el("span", {}, r.required_credential)), el("span", { class: "city" }, r.city));
    return btn;
}
export function settingWord(s) {
    return s === "medical" ? "Medical" : s === "education" ? "Education" : "Legal";
}
export function credentialWord(c) {
    return c;
}
/** Snapshot scrolling so day columns line up on the scroller's leading edge. */
export function wireDayScroller(scroller, dayLinks) {
    for (const link of dayLinks) {
        link.addEventListener("click", (ev) => {
            ev.preventDefault();
            const target = scroller.querySelector(`[data-day="${link.dataset.day}"]`);
            if (target) {
                scroller.scrollTo({ left: target.offsetLeft - scroller.offsetLeft, behavior: "smooth" });
                link.focus();
            }
        });
    }
}
