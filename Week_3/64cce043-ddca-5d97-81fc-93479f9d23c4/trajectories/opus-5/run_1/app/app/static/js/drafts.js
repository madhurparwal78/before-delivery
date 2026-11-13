// The one-use draft that keeps unsaved entries across an expired session.

const KEY = 'strongroom.draft';

export const DRAFT_RESTORED =
    'Your session ended. Your unsaved entries were kept; check them and save again.';

export function store(draft) {
    const path = location.pathname + location.search;
    sessionStorage.setItem(KEY, JSON.stringify({ ...draft, path }));
}

export function peek() {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (cause) {
        sessionStorage.removeItem(KEY);
        return null;
    }
}

export function discard() {
    sessionStorage.removeItem(KEY);
}

// A draft is used once, and only by the person and screen that stored it.
export function take(kind, email) {
    const draft = peek();
    if (!draft) return null;
    if (draft.email !== email) {
        discard();
        return null;
    }
    if (draft.kind !== kind || draft.path !== location.pathname + location.search) return null;
    discard();
    return draft;
}

export function signInAgain() {
    const next = encodeURIComponent(location.pathname + location.search);
    location.assign(`/auth/login?next=${next}`);
}
