package main

import "time"

// The edge rule is decided here and nowhere else: a period includes its start second and excludes its end second, so
// at the end second the period has already ended and a timer due at that second has fired. Go code compares instants
// only through these two functions; the SQL queries that must filter on a deadline (due_at <= $1, grace_ends_at > $2)
// are the SQL form of the same rule and say so where they sit.

// instantReached reports whether an instant has reached an edge: at or after it.
func instantReached(at, edge time.Time) bool { return !at.Before(edge) }

// periodHolds reports whether an instant lies inside [start, end).
func periodHolds(start, end, at time.Time) bool {
	return instantReached(at, start) && !instantReached(at, end)
}
