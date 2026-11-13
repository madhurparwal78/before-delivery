/** DOM helpers with the roles and names the brief publishes. */
export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false)
            continue;
        if (k === "class")
            node.className = String(v);
        else if (k === "text")
            node.textContent = String(v);
        else if (v === true)
            node.setAttribute(k, "");
        else
            node.setAttribute(k, String(v));
    }
    for (const c of children) {
        if (c === null || c === undefined)
            continue;
        node.append(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
}
export function text(s) { return document.createTextNode(s); }
export function setStatus(id, message) {
    let node = document.getElementById(id);
    if (!node) {
        node = el("div", { class: "status", role: "status", id });
        document.getElementById("status-banners")?.append(node);
    }
    node.textContent = message;
    return node;
}
export function clearStatus(id) {
    document.getElementById(id)?.remove();
}
export function announce(id, message) {
    setStatus(id, message);
}
/** The user's reduced-motion preference. */
export function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
/** A unique viewer id per page load. */
export function viewerId() {
    const key = "tinework:viewer";
    let v = sessionStorage.getItem(key);
    if (!v) {
        v = `viewer-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
        sessionStorage.setItem(key, v);
    }
    return v;
}
/** sessionStorage-backed painted epoch (house rule H5). */
export function epochKey(kind, id) {
    return `tinework:epoch:${kind}:${id}`;
}
export function bumpEpoch(root, key) {
    const current = Number(sessionStorage.getItem(key) ?? "0");
    const next = current + 1;
    sessionStorage.setItem(key, String(next));
    root.dataset.epoch = String(next);
}
export function restoreEpoch(root, key) {
    root.dataset.epoch = sessionStorage.getItem(key) ?? "0";
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
