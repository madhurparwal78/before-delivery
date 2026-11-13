import { api, ApiError } from "./api.js";
import { announce } from "./dom.js";
import { formatFixed } from "../shared/numbers.js";
/**
 * The evaluation lifecycle of one part page: one evaluation per burst, the
 * newest result wins, supersession cancels, and the camera never moves.
 */
export class EvalEngine {
    partSlug;
    debounceMs;
    slowMs;
    onSettled;
    onFailed;
    onStateChange;
    viewportRoot;
    seq = 0;
    appliedSeq = 0;
    state = "settled";
    timer = null;
    abort = null;
    slowTimer = null;
    viewer;
    constructor(partSlug, debounceMs, slowMs, viewer, onSettled, onFailed, onStateChange, viewportRoot) {
        this.partSlug = partSlug;
        this.debounceMs = debounceMs;
        this.slowMs = slowMs;
        this.onSettled = onSettled;
        this.onFailed = onFailed;
        this.onStateChange = onStateChange;
        this.viewportRoot = viewportRoot;
        this.viewer = viewer;
    }
    get currentState() { return this.state; }
    get currentSeq() { return this.appliedSeq; }
    /** A commit: mark dirty, restart the debounce, supersede anything in flight. */
    commit() {
        if (this.state === "evaluating") {
            this.abort?.abort();
            void api.cancel(this.viewer);
            this.setState("stale");
            announce("eval-status", "Superseded by a newer change.");
        }
        else if (this.state === "settled" || this.state === "failed") {
            this.setState("dirty");
        }
        else {
            this.setState(this.state === "dirty" ? "dirty" : "stale");
        }
        if (this.timer !== null)
            clearTimeout(this.timer);
        this.timer = window.setTimeout(() => { void this.evaluate(); }, this.debounceMs);
    }
    setState(s) {
        this.state = s;
        this.viewportRoot.dataset.evalState = s;
        this.onStateChange(s);
    }
    async evaluate() {
        this.timer = null;
        if (this.state === "stale" && this.appliedSeq > 0) {
            // A commit while stale still sends a fresh evaluation after the debounce.
        }
        this.setState("evaluating");
        this.abort = new AbortController();
        this.showSlowNoticeSoon();
        this.seq += 1;
        const seq = this.seq;
        try {
            const values = this.currentValues();
            const res = await api.evaluate(this.partSlug, values, seq, this.viewer, this.abort.signal);
            if (res.status === "cancelled")
                return;
            if (seq < this.appliedSeq)
                return;
            if (seq < this.seq) {
                // A newer commit has arrived; drop this response.
                return;
            }
            this.appliedSeq = seq;
            this.hideSlowNotice();
            if (res.status === "failed") {
                const first = res.diagnostics[0];
                this.setState("failed");
                this.onFailed(first);
                announce("eval-status", `Could not evaluate: ${first.message}`);
                return;
            }
            this.setState("settling");
            const snap = {
                volume: res.volume,
                bbox: res.bbox,
                faces: res.faces,
                digest: res.geometryDigest ?? "",
                solid: res.solid,
            };
            this.onSettled(snap);
            announce("eval-status", `Updated: ${formatFixed(res.volume, 2)}\u202Fmm\u00b3`);
            // The cross-fade duration; reduced motion swaps at once.
            const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            window.setTimeout(() => this.setState("settled"), reduced ? 0 : 140);
        }
        catch (err) {
            if (err instanceof DOMException && err.name === "AbortError")
                return;
            if (err instanceof ApiError && err.status === 0)
                return;
            if (seq < this.appliedSeq || seq < this.seq)
                return;
            this.hideSlowNotice();
            this.setState("settled");
        }
    }
    /** The current values; provided by the page. */
    currentValues = () => ({});
    slowNotice = null;
    showSlowNoticeSoon() {
        this.hideSlowNotice();
        this.slowTimer = window.setTimeout(() => {
            this.slowNotice = document.querySelector('[data-ui="slow-notice"]');
            this.slowNotice?.classList.add("shown");
        }, this.slowMs);
    }
    hideSlowNotice() {
        if (this.slowTimer !== null) {
            clearTimeout(this.slowTimer);
            this.slowTimer = null;
        }
        document.querySelector('[data-ui="slow-notice"]')?.classList.remove("shown");
    }
}
