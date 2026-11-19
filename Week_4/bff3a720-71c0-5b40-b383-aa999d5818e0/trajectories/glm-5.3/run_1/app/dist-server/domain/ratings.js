export function ratingOpens(arrival) {
    return arrival;
}
export function ratingCloses(arrival, cfg) {
    return arrival + cfg.ratingWindowDays * 86_400_000;
}
