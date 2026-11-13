import { api, Unreachable } from "./api.js";
/** A live region that holds the latest async action's copy. */
export class StatusRegion {
    node;
    original;
    constructor(node) {
        this.node = node;
        this.original = "";
    }
    set(text, kind = "info") {
        this.node.textContent = text;
        this.node.classList.toggle("alert", kind === "alert");
        this.original = text;
    }
    clear() {
        this.node.textContent = "";
        this.node.classList.remove("alert");
    }
    attach() {
        // region is already part of the page tree
    }
}
export function unreachableMessage() {
    return "Couldn't reach Crosshand Relay. Check your connection and try again.";
}
export function isUnreachable(err) {
    return err instanceof Unreachable;
}
export function errorMessage(err) {
    if (isUnreachable(err))
        return unreachableMessage();
    return err instanceof Error ? err.message : "Something went wrong.";
}
export function errorFields(err) {
    const e = err;
    return e?.api?.error?.fields ?? {};
}
export function errorCode(err) {
    const e = err;
    return e?.api?.error?.code ?? null;
}
export function errorQuote(err) {
    const e = err;
    return e?.api?.quote ?? null;
}
/** Debounce helper for search boxes: fire after 333ms of quiet or immediately on Enter. */
export function searchOnInput(input, apply) {
    let timer;
    input.addEventListener("input", () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => apply(input.value), 333);
    });
    input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
            ev.preventDefault();
            window.clearTimeout(timer);
            apply(input.value);
        }
    });
}
/** A 10-second poll that never stacks requests. */
export class Poller {
    fn;
    timer;
    running = false;
    constructor(fn) {
        this.fn = fn;
    }
    start() {
        this.stop();
        const tick = async () => {
            if (this.running)
                return;
            this.running = true;
            try {
                await this.fn();
            }
            catch {
                // transient; keep polling
            }
            finally {
                this.running = false;
            }
            this.timer = window.setTimeout(tick, 10_000);
        };
        this.timer = window.setTimeout(tick, 10_000);
    }
    stop() {
        if (this.timer !== undefined)
            window.clearTimeout(this.timer);
        this.timer = undefined;
    }
}
