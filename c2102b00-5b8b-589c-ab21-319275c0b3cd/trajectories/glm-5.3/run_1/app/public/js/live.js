const regions = {};
function ensure(name) {
    let node = regions[name];
    if (!node || !document.body.contains(node)) {
        node = document.createElement("div");
        node.className = "live";
        node.setAttribute("role", "status");
        node.setAttribute("aria-live", "polite");
        switch (name) {
            case "pledge":
                node.setAttribute("aria-label", "Pledge updates");
                break;
            case "credit":
                node.setAttribute("aria-label", "Credit updates");
                break;
            case "coordinator":
                node.setAttribute("aria-label", "Coordinator updates");
                break;
            case "bag":
                node.setAttribute("aria-label", "Bag updates");
                break;
        }
        document.body.append(node);
        regions[name] = node;
    }
    return node;
}
/** Announces text in the named region, replacing the previous text. */
export function announce(name, text) {
    const node = ensure(name);
    node.textContent = text;
}
export function resetLiveRegions() {
    for (const key of Object.keys(regions)) {
        delete regions[key];
    }
    document.querySelectorAll(".live[role='status']").forEach((n) => n.remove());
}
