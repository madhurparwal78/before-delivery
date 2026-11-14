package main

import (
	"fmt"
	"time"
)

// Booking kinds and states. A booking is held, then paid or released; a paid booking becomes checked-in,
// no-show or cancelled.
const (
	kindBooking = "booking"
	kindMatch   = "match"

	bookingHeld      = "held"
	bookingPaid      = "paid"
	bookingReleased  = "released"
	bookingCheckedIn = "checked-in"
	bookingNoShow    = "no-show"
	bookingCancelled = "cancelled"
)

// Share states and the kind of record a share belongs to.
const (
	shareDue     = "due"
	sharePaid    = "paid"
	shareCovered = "covered"
	shareVoid    = "void"

	shareBooking = "booking"
	shareLesson  = "lesson"
)

// Open match and place reservation states.
const (
	matchOpen      = "open"
	matchFull      = "full"
	matchCancelled = "cancelled"

	placeReserved = "reserved"
	placePaid     = "paid"
)

// Guarantee states: exactly one guarantee of a booking is current (authorized) at a time.
const (
	guaranteeAuthorized = "authorized"
	guaranteeCaptured   = "captured"
	guaranteeSuperseded = "superseded"
	guaranteeVoided     = "voided"
)

// Credit reasons on the club's ledger.
const (
	creditBookingCancelled = "booking_cancelled"
	creditMatchCancelled   = "match_cancelled"
	creditLateCapture      = "late_capture"
)

// Notice states.
const (
	noticePending = "pending"
	noticeSent    = "sent"
	noticeFailed  = "failed"
)

const (
	// coPlayersPerSplit is how many co-players a four-way split names besides the organiser.
	coPlayersPerSplit = placesPerMatch - 1
	maxNoteRunes      = 280
	joinAttemptLimit  = 6
	joinAttemptWindow = 60 * time.Second
	retryEvery        = 30 * time.Second
)

// bookingTakesSlotSQL is the one rule of which bookings hold a court's time: paid, checked-in or no-show,
// or a hold still running on the database clock.
var bookingTakesSlotSQL = fmt.Sprintf("(status IN ('%s', '%s', '%s') OR (status = '%s' AND expires_at > clock_timestamp()))",
	bookingPaid, bookingCheckedIn, bookingNoShow, bookingHeld)

// bookedStatusesSQL lists the statuses that read as a booked cell and count as booked minutes.
var bookedStatusesSQL = fmt.Sprintf("('%s', '%s', '%s')", bookingPaid, bookingCheckedIn, bookingNoShow)

// placesSQL counts a match's players: paid places plus places reserved while their charge runs.
func placesSQL(match string) string {
	return fmt.Sprintf("(SELECT count(*) FROM place_reservations pr WHERE pr.match_id = %s.id)", match)
}

// matchLiveSQL is the one rule of which matches hold their court: full ones, and open ones until the
// cut-off unless a reserved fourth place keeps them alive.
func matchLiveSQL(match string) string {
	return fmt.Sprintf("(%[1]s.status = '%[2]s' OR (%[1]s.status = '%[3]s' AND (clock_timestamp() < %[1]s.cutoff_at OR %[4]s >= %[5]d)))",
		match, matchFull, matchOpen, placesSQL(match), placesPerMatch)
}

// matchStalledSQL is true for an open match the cut-off has caught with fewer than four players.
func matchStalledSQL(match string) string {
	return fmt.Sprintf("(%[1]s.status = '%[2]s' AND clock_timestamp() >= %[1]s.cutoff_at AND %[3]s < %[4]d)",
		match, matchOpen, placesSQL(match), placesPerMatch)
}

// matchCancelledSQL is true for a match that is cancelled, stored or by the cut-off.
func matchCancelledSQL(match string) string {
	return fmt.Sprintf("(%s.status = '%s' OR %s)", match, matchCancelled, matchStalledSQL(match))
}

// effectiveBookingStatus reports a hold as released from its expires_at on, before any worker has run.
func effectiveBookingStatus(status string, expiresAt *time.Time, now time.Time) string {
	if status == bookingHeld && expiresAt != nil && !expiresAt.After(now) {
		return bookingReleased
	}
	return status
}

// effectiveMatchStatus reports an open match as cancelled once the cut-off passes with fewer than four players.
func effectiveMatchStatus(status string, cutoff time.Time, players int, now time.Time) string {
	if status == matchOpen && !now.Before(cutoff) && players < placesPerMatch {
		return matchCancelled
	}
	return status
}

// effectiveShareStatus reports a due share as void when its hold has ended or its booking has started.
func effectiveShareStatus(shareStatus, bookingStatus string, start time.Time, now time.Time) string {
	if shareStatus != shareDue {
		return shareStatus
	}
	if bookingStatus == bookingReleased || (bookingStatus != bookingHeld && !start.After(now)) {
		return shareVoid
	}
	return shareStatus
}

// settleAt is the one place the settlement instant is decided: the start minus SHARE_SETTLE_SECONDS.
func (a *App) settleAt(start time.Time) time.Time {
	return start.Add(-time.Duration(a.cfg.Timing.ShareSettleSeconds) * time.Second)
}

// matchCutoff is the one place the cut-off instant is decided: the start minus MATCH_CUTOFF_SECONDS.
func (a *App) matchCutoff(start time.Time) time.Time {
	return start.Add(-time.Duration(a.cfg.Timing.MatchCutoffSeconds) * time.Second)
}

// holdExpiry is the one place a hold's end is decided: its creation plus HOLD_SECONDS.
func (a *App) holdExpiry(createdAt time.Time) time.Time {
	return createdAt.Add(time.Duration(a.cfg.Timing.HoldSeconds) * time.Second)
}

// freeCancelUntil is the last instant a cancellation is free: the start minus FREE_CANCEL_SECONDS.
func (a *App) freeCancelUntil(start time.Time) time.Time {
	return start.Add(-time.Duration(a.cfg.Timing.FreeCancelSeconds) * time.Second)
}

// noShowFrom is the one place the no-show grace instant is decided: the start plus NO_SHOW_GRACE_SECONDS.
func (a *App) noShowFrom(start time.Time) time.Time {
	return start.Add(time.Duration(a.cfg.Timing.NoShowGraceSeconds) * time.Second)
}
