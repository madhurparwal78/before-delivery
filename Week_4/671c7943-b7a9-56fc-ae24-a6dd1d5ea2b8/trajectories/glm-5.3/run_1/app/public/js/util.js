export function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
let announceToggle = false;
export function announce(text) {
    const region = document.querySelector('[role="status"]');
    if (!region)
        return;
    region.textContent = "";
    announceToggle = !announceToggle;
    region.textContent = announceToggle ? text : ` ${text}`;
}
export function focusScroll(element) {
    const headerBottom = 64;
    const rect = element.getBoundingClientRect();
    const top = rect.top + window.scrollY - headerBottom - 8;
    if (rect.height < window.innerHeight - headerBottom - 16) {
        const bottom = rect.bottom + window.scrollY;
        if (bottom - Math.max(0, top) > window.innerHeight) {
            window.scrollTo(0, bottom - window.innerHeight);
            return;
        }
    }
    window.scrollTo(0, Math.max(0, top));
}
export function focusControl(element) {
    if (!element.matches("a, button, input, select, textarea, iframe") && !element.hasAttribute("tabindex")) {
        element.setAttribute("tabindex", "-1");
    }
    focusScroll(element);
    element.focus({ preventScroll: true });
}
export function setQueryParam(key, value) {
    const url = new URL(window.location.href);
    if (value === null) {
        url.searchParams.delete(key);
    }
    else {
        url.searchParams.set(key, value);
    }
    window.history.replaceState(null, "", url.toString());
}
