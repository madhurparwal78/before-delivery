export class ApiError extends Error {
    status;
    code;
    message;
    errors;
    constructor(status, code, message, errors) {
        super(message);
        this.status = status;
        this.code = code;
        this.message = message;
        this.errors = errors;
    }
}
async function request(path, init = {}) {
    const res = await fetch(path, {
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        ...init,
    });
    const body = await res.text();
    const json = body ? JSON.parse(body) : {};
    if (!res.ok) {
        throw new ApiError(res.status, String(json.error ?? "error"), String(json.message ?? ""), json.errors ?? null);
    }
    return json;
}
export const api = {
    config: () => request("/api/config"),
    me: () => request("/api/me"),
    part: (slug, revision) => request(`/api/parts/${slug}${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`),
    gallery: (params) => {
        const q = new URLSearchParams();
        if (params.category)
            q.set("category", params.category);
        if (params.sort)
            q.set("sort", params.sort);
        if (params.cursor)
            q.set("cursor", params.cursor);
        return request(`/api/parts?${q.toString()}`);
    },
    revisions: (slug) => request(`/api/parts/${slug}/revisions`),
    evaluate: (partSlug, values, seq, viewer, signal) => request("/api/evaluations", {
        method: "POST",
        body: JSON.stringify({ partSlug, values, seq, viewerId: viewer }),
        signal,
    }),
    cancel: (viewer) => fetch("/api/evaluations/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ viewerId: viewer }), credentials: "same-origin" }),
    preflight: (partSlug, values, process) => request("/api/preflight", { method: "POST", body: JSON.stringify({ partSlug, values, process }) }),
    tape: (revisionId) => request(`/api/revisions/${revisionId}/tape`),
    compare: (base, head) => request(`/api/compare?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`),
    room: (id) => request(`/api/rooms/${id}`),
    postComment: (roomId, body, anchor, pose, key) => request(`/api/rooms/${roomId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ body, anchor, pose }),
    }),
    approve: (roomId, revisionId, key) => request(`/api/rooms/${roomId}/approvals`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ revisionId }),
    }),
    closeRoom: (roomId) => request(`/api/rooms/${roomId}/close`, { method: "POST" }),
    dashboard: () => request("/api/dashboard"),
    like: (slug) => request(`/api/parts/${slug}/like`, { method: "PUT" }),
    unlike: (slug) => request(`/api/parts/${slug}/like`, { method: "DELETE" }),
    signin: (email, password, next) => request("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password, next }) }),
    signup: (email, password, displayName, next) => request("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password, displayName, next }) }),
    signout: () => fetch("/api/auth/signout", { method: "POST", credentials: "same-origin" }),
};
