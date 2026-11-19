import { prefersReducedMotion } from "./util.js";
let heroFly = null;
export function takeHeroFly() {
    const fly = heroFly;
    heroFly = null;
    return fly;
}
export function recordHeroFly(box) {
    heroFly = { x: box.x, y: box.y, width: box.width, height: box.height };
}
export function applyHeroFly(element, duration = 480) {
    const fly = takeHeroFly();
    if (!fly || prefersReducedMotion())
        return;
    const target = element.getBoundingClientRect();
    const startX = fly.x - target.x;
    const startY = fly.y + window.scrollY - (target.y + window.scrollY);
    const scaleX = fly.width / target.width;
    const scaleY = fly.height / target.height;
    element.style.transformOrigin = "top left";
    element.animate([
        { transform: `translate(${startX}px, ${startY}px) scale(${scaleX}, ${scaleY})` },
        { transform: "translate(0, 0) scale(1, 1)" },
    ], { duration, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "none" });
}
export function replaceMainWith(href, push = true) {
    return fetch(href)
        .then((response) => response.text())
        .then((html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const newMain = doc.querySelector("main");
        const currentMain = document.querySelector("main");
        if (!newMain || !currentMain) {
            window.location.assign(href);
            return;
        }
        document.title = doc.title;
        currentMain.replaceWith(newMain);
        if (push) {
            window.history.pushState({ sollis: true }, "", href);
        }
        window.scrollTo(0, 0);
    });
}
