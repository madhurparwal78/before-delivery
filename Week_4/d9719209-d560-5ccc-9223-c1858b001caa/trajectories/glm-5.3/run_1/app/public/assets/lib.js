/* Moothall client library: fetch helpers, live regions, toasts, the live
   stream and page utilities. Every string matches the published copy. */
export class ApiFailure extends Error {
    status;
    code;
    fields;
    retryAfter;
    current;
    constructor(status, shape) {
        super(shape.message);
        this.status = status;
        this.code = shape.code;
        this.fields = shape.fields ?? {};
        this.retryAfter = shape.retryAfter;
        this.current = shape.current;
    }
}
export async function api(path, init = {}) {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    if (res.status === 204)
        return undefined;
    const text = await res.text();
    const body = text === '' ? null : JSON.parse(text);
    if (!res.ok) {
        const shape = body?.error ?? { code: 'UNKNOWN', message: 'Request failed' };
        throw new ApiFailure(res.status, shape);
    }
    return body;
}
export const copy = {
    upvoted: (n) => `Upvoted. Score ${n}`,
    downvoted: (n) => `Downvoted. Score ${n}`,
    voteRemoved: (n) => `Vote removed. Score ${n}`,
    voteSlowDown: (n) => `Slow down — try again in ${n} s`,
    voteVerify: 'Verify your email to vote',
    voteSignIn: 'Sign in to vote',
    voteArchive: 'This thread is archived. Voting and replies are closed.',
    voteNoSave: "Vote didn't save",
    livePaused: 'Live updates paused',
    signOutSuspension: 'Your account has been suspended',
    moderatorRemoved: 'Moderator tools removed',
    canNowPost: (name) => `You can now post in c/${name}`,
    newReply: (username) => `New reply from ${username}`,
    replyPosted: 'Reply posted',
    postRemovedWatchers: 'Post removed by moderators',
    endOfFeed: "You've reached the end",
    emptyHome: 'Join a community to fill your home feed',
    removedHeading: (reason) => `Removed by moderators: ${reason}`,
    removedCommentLabel: '[removed by moderators]',
    deletedCommentLabel: '[deleted]',
    lockBanner: 'Locked by moderators',
    restrictedNotice: 'Approved posters only',
    archived: 'This thread is archived. Voting and replies are closed.',
    titleNote: "Titles can't be edited",
    usernameNote: "Usernames can't be changed",
    reportRef: (ref) => `Your reference is ${ref}`,
    reportSent: (ref) => `Report sent. Reference ${ref}`,
    anotherModActed: 'Another moderator acted first',
    live: 'Live',
    livePausedLabel: 'Live updates paused',
    due: (h, m) => `Due in ${h} h ${m} min`,
    overdue: 'Overdue',
};
export function displayScore(score) {
    if (Math.abs(score) < 10000)
        return String(score);
    const thousands = Math.floor(Math.abs(score) / 1000) / 10;
    const oneDecimal = Math.floor(thousands * 10) / 10;
    const sign = score < 0 ? '-' : '';
    return `${sign}${oneDecimal.toFixed(1)}k`;
}
export function formatUtc(iso) {
    const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${d.getUTCDate()} ${months[d.getMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
export function plural(n, one, many) {
    return n === 1 ? `${n} ${one}` : `${n} ${many}`;
}
/* --- Live regions and toasts --- */
let toastTimer;
export function announce(message, assertive = false) {
    const region = document.getElementById(assertive ? 'live-alert' : 'live-status');
    if (region !== null) {
        region.textContent = '';
        // A fresh node forces the announcement even when the text repeats.
        window.setTimeout(() => { region.textContent = message; }, 10);
    }
    showToast(message, assertive);
}
export function showToast(message, alert = false) {
    const stack = document.getElementById('toast-stack');
    if (stack === null)
        return;
    const toast = document.createElement('div');
    toast.className = alert ? 'toast alert' : 'toast';
    toast.textContent = message;
    stack.replaceChildren(toast);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { stack.replaceChildren(); }, 5000);
}
export class Live {
    onStateChange;
    es = null;
    topics = [];
    handler = null;
    paused = false;
    retryTimer;
    constructor(onStateChange) {
        this.onStateChange = onStateChange;
    }
    subscribe(topics, handler) {
        this.topics = topics;
        this.handler = handler;
        this.open();
    }
    open() {
        this.closeEvents();
        const url = `/api/stream?topics=${encodeURIComponent(this.topics.join(','))}`;
        const es = new EventSource(url);
        this.es = es;
        es.onopen = () => this.setPaused(false);
        es.onerror = () => {
            // EventSource retries by itself; we surface the paused state on a timer.
            if (!this.paused)
                this.setPaused(true);
            window.clearTimeout(this.retryTimer);
            this.retryTimer = window.setTimeout(() => { void 0; }, 10_000);
        };
        const forward = (event) => {
            const e = { id: String(event.lastEventId), event: event.type, data: JSON.parse(String(event.data ?? '{}')) };
            this.setPaused(false);
            this.handler?.(e);
        };
        for (const name of ['score', 'comments', 'comment', 'post-state', 'membership', 'account']) {
            es.addEventListener(name, forward);
        }
        es.addEventListener('resync', () => { window.location.reload(); });
    }
    setPaused(paused) {
        this.paused = paused;
        this.onStateChange(paused);
    }
    closeEvents() {
        this.es?.close();
        this.es = null;
    }
    stop() {
        this.closeEvents();
        window.clearTimeout(this.retryTimer);
    }
}
export function idKey() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
/* --- DOM helpers --- */
export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false)
            continue;
        if (name === 'class')
            node.className = String(value);
        else if (name === 'text')
            node.textContent = String(value);
        else if (value === true)
            node.setAttribute(name, '');
        else
            node.setAttribute(name, String(value));
    }
    for (const child of children) {
        if (child === null || child === undefined)
            continue;
        node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}
export function navigate(path) {
    window.location.href = path;
}
export function requires2faRedirect() {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    navigate(`/settings/2fa?next=${next}`);
}
/* Focus trap for modal dialogs. */
export function trapFocus(container, previouslyFocused) {
    const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKeydown = (e) => {
        if (e.key !== 'Tab')
            return;
        const focusables = Array.from(container.querySelectorAll(selector)).filter((n) => n.offsetParent !== null);
        if (focusables.length === 0)
            return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        }
        else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };
    container.addEventListener('keydown', onKeydown);
    return () => {
        container.removeEventListener('keydown', onKeydown);
        previouslyFocused?.focus();
    };
}
