// Small DOM helpers: building, focus handling, announcements and counting.

export function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

export function clear(node) {
    while (node.firstChild) node.firstChild.remove();
}

export function announce(region, text) {
    if (!region) return;
    region.textContent = text;
}

export function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
    'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusable(container) {
    return [...container.querySelectorAll(FOCUSABLE)].filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
    );
}

// Tab and Shift+Tab stay inside the container and wrap at both ends.
export function trapTab(container, event) {
    if (event.key !== 'Tab') return;
    const items = focusable(container);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

export function debounce(work, delay) {
    let timer = 0;
    const run = (...args) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => work(...args), delay);
    };
    run.cancel = () => window.clearTimeout(timer);
    return run;
}

// Only the answer to the most recent input is ever shown.
export class Latest {
    constructor() {
        this.token = 0;
    }

    next() {
        this.token += 1;
        return this.token;
    }

    current(token) {
        return token === this.token;
    }
}

const COUNT_MILLISECONDS = 420;

// Counts a numeral in whole steps, ending exactly on the target.
export function countTo(node, target, { animate = true } = {}) {
    if (node.countHandle) {
        window.cancelAnimationFrame(node.countHandle);
        node.countHandle = 0;
    }
    const from = Number.parseInt(node.textContent, 10);
    const start = Number.isNaN(from) ? target : from;
    if (!animate || reducedMotion() || start === target) {
        node.textContent = String(target);
        return;
    }
    const began = performance.now();
    const step = (now) => {
        const share = Math.min((now - began) / COUNT_MILLISECONDS, 1);
        node.textContent = String(Math.round(start + (target - start) * share));
        if (share < 1) {
            node.countHandle = window.requestAnimationFrame(step);
        } else {
            node.textContent = String(target);
            node.countHandle = 0;
        }
    };
    node.countHandle = window.requestAnimationFrame(step);
}
