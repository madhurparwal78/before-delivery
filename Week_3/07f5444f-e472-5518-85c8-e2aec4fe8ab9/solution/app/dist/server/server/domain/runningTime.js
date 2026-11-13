// Running time and cut saving, derived from the bar map and the stored cuts on every read.
/** Exact milliseconds of the bars from `from` to `to` inclusive. */
export function spanMs(barMap, from, to) {
    return barMap.reduce((total, segment) => {
        const bars = Math.min(segment.to_bar, to) - Math.max(segment.from_bar, from) + 1;
        return total + Math.max(bars, 0) * segment.bar_ms;
    }, 0);
}
/** Exact milliseconds of the work's uncut bars. */
export function uncutMs(barMap, cuts) {
    const bars = barMap.at(-1)?.to_bar ?? 0;
    return spanMs(barMap, 1, bars) - cuts.reduce((total, cut) => total + spanMs(barMap, cut.from_bar, cut.to_bar), 0);
}
/** Nearest whole second, half a second rounding up. */
export function wholeSeconds(ms) {
    return Math.floor((ms + 500) / 1000);
}
