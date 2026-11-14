package main

import (
	"context"
	"fmt"
	"time"
)

// slotEnd is the one place a slot's end is worked out from its start and length.
func slotEnd(start time.Time, minutes int) time.Time {
	return start.Add(time.Duration(minutes) * time.Minute)
}

// slotTaken is the one rule of overlap: a slot is taken when it overlaps a live booking, a live open match or
// a lesson on the same court. Holds, matches and lesson series are all decided by it.
func slotTaken(ctx context.Context, q querier, court int, start, end time.Time) (bool, error) {
	var taken bool
	err := q.QueryRow(ctx, fmt.Sprintf(`SELECT EXISTS (
			SELECT 1 FROM bookings WHERE court = $1 AND kind = '%s' AND start_utc < $3
				AND start_utc + make_interval(mins => minutes) > $2 AND %s
			UNION ALL
			SELECT 1 FROM matches m WHERE m.court = $1 AND m.start_utc < $3
				AND m.start_utc + make_interval(mins => m.minutes) > $2 AND %s
			UNION ALL
			SELECT 1 FROM lessons WHERE court = $1 AND start_utc < $3 AND start_utc + make_interval(mins => minutes) > $2)`,
		kindBooking, bookingTakesSlotSQL, matchLiveSQL("m")), court, start, end).Scan(&taken)
	if err != nil {
		return false, fmt.Errorf("check court %d for overlap: %w", court, err)
	}
	return taken, nil
}
