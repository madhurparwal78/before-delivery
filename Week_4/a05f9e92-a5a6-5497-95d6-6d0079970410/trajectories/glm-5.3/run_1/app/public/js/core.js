// Shared browser helpers: fetch, announcements, motion, countdowns.
/** Fetch JSON from the app's own origin, with the one error body. */
export async function api(path, init) {
    const res = await fetch(path, {
        ...init,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...init?.headers },
    });
    if (res.status === 204)
        return undefined;
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) {
        const err = new Error(body?.error?.message ?? 'Request failed');
        err.status = res.status;
        err.code = body?.error?.code;
        err.body = body;
        throw err;
    }
    return body;
}
/** The Announcements status region: one live region for every result.
 *  The last announcement survives a re-render. */
let lastAnnouncement = '';
export function announce(text) {
    lastAnnouncement = text;
    const region = document.querySelector('[role="status"][aria-label="Announcements"]');
    if (region)
        region.textContent = text;
}
export function currentAnnouncement() {
    return lastAnnouncement;
}
export function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
/** Motion: 180 or 420 ms, one curve that starts fast and settles softly. */
export function animate(el, keyframes, duration) {
    return el.animate(keyframes, {
        duration,
        easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
        fill: 'forwards',
    });
}
/** A countdown from the last server message plus the browser's elapsed delta.
 *  A wrong device clock never changes what is shown. */
export function shownRemaining(sla, receivedAt) {
    const sinceReceipt = (performance.now() - receivedAt) / 1000;
    if (!sla.ticking)
        return sla.remaining_seconds;
    if (sla.next_change_at === null)
        return sla.remaining_seconds - sinceReceipt;
    const nextChange = Date.parse(sla.next_change_at);
    const serverNow = Date.parse(sla.server_time);
    const untilChange = Math.max(0, (nextChange - serverNow) / 1000);
    return sla.remaining_seconds - Math.min(sinceReceipt, untilChange);
}
/** Duration as H:MM:SS with whole hours and padded minutes and seconds. */
export function hms(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
/** SLA countdown copy per the published rules. */
export function countdownText(sla, remaining) {
    if (sla.stage === 'completed')
        return sla.breached ? 'Missed' : 'Met';
    if (sla.stage === 'paused')
        return `Paused at ${hms(remaining)} left`;
    if (sla.breached)
        return `Breached by ${hms(-remaining)}`;
    return `${hms(remaining)} left`;
}
export function navigate(path) {
    history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
}
