// Where a day pass does not go: it admits to pass sessions of its festival day at every venue but this one.
export const FULL_PASS_ONLY_VENUE = "planetarium-dome";

export const dayPassCovers = (venueId: string) => venueId !== FULL_PASS_ONLY_VENUE;
