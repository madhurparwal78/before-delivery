import { intensityFromOffset } from "../shared/domain.js";
export function activeLayersFor(station, intensity) {
    const layers = [];
    if (intensity >= station.thresholds.bed)
        layers.push("bed");
    if (intensity >= station.thresholds.pulse)
        layers.push("pulse");
    if (intensity >= station.thresholds.lead)
        layers.push("lead");
    if (intensity >= station.thresholds.stinger)
        layers.push("stinger");
    return layers;
}
export class LadderEngine {
    hooks;
    current = null;
    intensity = 0;
    reducedMotion;
    stations;
    constructor(stations, reducedMotion, hooks) {
        this.hooks = hooks;
        this.stations = stations;
        this.reducedMotion = reducedMotion;
    }
    /** Recompute from scroll position; the scrolled (non reduced-motion) mode. */
    updateFromScroll(scrollY, viewportHeight) {
        if (this.reducedMotion)
            return;
        let next = null;
        let offset = 0;
        for (const station of this.stations) {
            const top = station.chapter.offsetTop;
            const relative = scrollY - top;
            if (relative >= 0 && relative <= 1600) {
                next = station;
                offset = relative;
                break;
            }
        }
        if (!next) {
            this.setCurrent(null, 0);
            return;
        }
        this.setCurrent(next, Math.min(100, Math.max(0, intensityFromOffset(offset))));
    }
    /** Reduced-motion current station rule: stage holding focus or filling the viewport. */
    updateReducedMotion(scrollY, viewportHeight, focusInside) {
        if (!this.reducedMotion)
            return;
        let best = null;
        if (focusInside) {
            best = this.stations.find((station) => station.stage.contains(focusInside)) || null;
        }
        if (!best) {
            let bestVisible = 0;
            for (const station of this.stations) {
                const top = station.stage.offsetTop;
                const bottom = top + station.stage.offsetHeight;
                const visible = Math.max(0, Math.min(bottom, scrollY + viewportHeight) - Math.max(top, scrollY));
                if (visible > bestVisible) {
                    bestVisible = visible;
                    best = station;
                }
            }
            if (bestVisible === 0)
                best = null;
        }
        this.setCurrent(best, best ? this.intensity : 0);
    }
    setIntensity(station, intensity) {
        this.setCurrent(station, Math.max(0, Math.min(100, intensity)));
    }
    setCurrent(station, intensity) {
        const previousLayers = this.current ? activeLayersFor(this.current, this.intensity) : [];
        const nextLayers = station ? activeLayersFor(station, intensity) : [];
        const joined = nextLayers
            .filter((layer) => !previousLayers.includes(layer))
            .map((layer) => ({ layer, intensity }));
        const left = previousLayers
            .filter((layer) => !nextLayers.includes(layer))
            .map((layer) => ({ layer, intensity }));
        const changed = joined.length > 0 || left.length > 0 || station !== this.current;
        this.current = station;
        this.intensity = intensity;
        if (changed) {
            this.hooks.onRungChange({ station, intensity, activeLayers: nextLayers, joined, left });
        }
    }
    get currentStation() {
        return this.current;
    }
    get currentIntensity() {
        return this.intensity;
    }
}
/** Layer copy from Feedback states: "<Layer> in at intensity <n>." */
export function rungSentences(update) {
    const parts = [];
    for (const change of update.joined) {
        parts.push(`${capitalise(change.layer)} in at intensity ${change.intensity}.`);
    }
    for (const change of update.left) {
        parts.push(`${capitalise(change.layer)} out at intensity ${change.intensity}.`);
    }
    return parts.join(" ");
}
function capitalise(layer) {
    return layer.charAt(0).toUpperCase() + layer.slice(1);
}
