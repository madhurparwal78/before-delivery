package core

import (
	"fmt"
	"time"
)

// FirmZone is the firm's own zone, used for every server-built local time
// except the override copy, which uses the schedule's zone.
const FirmZoneName = "America/Chicago"

var firmZone = mustZone(FirmZoneName)

func mustZone(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

func zoneOr(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		return firmZone
	}
	return loc
}

// LocalTime is the one display form for a moment: YYYY-MM-DD HH:MM ZZZ.
func LocalTime(t time.Time, loc *time.Location) string {
	return t.In(loc).Format("2006-01-02 15:04 MST")
}

func firmTime(t time.Time) string { return LocalTime(t, firmZone) }

func txtTriggered(number int64, title string) string {
	return fmt.Sprintf("Incident #%d triggered: %s", number, title)
}

func txtAcknowledged(number int64, name string) string {
	return fmt.Sprintf("Incident #%d acknowledged by %s", number, name)
}

func txtSnoozed(number int64, name string, until time.Time) string {
	return fmt.Sprintf("Incident #%d snoozed by %s until %s", number, name, firmTime(until))
}

func txtSnoozeEnded(number int64) string {
	return fmt.Sprintf("Incident #%d back to triggered: snooze ended", number)
}

func txtAckTimedOut(number int64) string {
	return fmt.Sprintf("Incident #%d back to triggered: acknowledge timed out", number)
}

func txtEscalated(number int64, holders []string) string {
	return fmt.Sprintf("Incident #%d escalated to %s", number, joinNames(holders))
}

func txtHandedOff(number int64, from, to string) string {
	return fmt.Sprintf("Incident #%d handed off from %s to %s", number, from, to)
}

func txtReassigned(number int64, holders []string, actor string) string {
	return fmt.Sprintf("Incident #%d reassigned to %s by %s", number, joinNames(holders), actor)
}

func txtMerged(number, target int64, actor string) string {
	return fmt.Sprintf("Incident #%d merged into #%d by %s", number, target, actor)
}

func txtSplit(dedupKey string, number int64, actor string) string {
	return fmt.Sprintf("Alert %s split into incident #%d by %s", dedupKey, number, actor)
}

func txtUrgencyRaised(number int64) string {
	return fmt.Sprintf("Incident #%d raised to high urgency", number)
}

func txtResponderRequested(actor, person string, number int64) string {
	return fmt.Sprintf("%s asked %s to join incident #%d", actor, person, number)
}

func txtResponderAccepted(person string, number int64) string {
	return fmt.Sprintf("%s joined incident #%d", person, number)
}

func txtResponderDeclined(person string, number int64) string {
	return fmt.Sprintf("%s declined to join incident #%d", person, number)
}

func txtResolved(number int64, name string) string {
	return fmt.Sprintf("Incident #%d resolved by %s", number, name)
}

func txtAutoResolved(number int64) string {
	return fmt.Sprintf("Incident #%d auto-resolved", number)
}

func txtRepeatEvent(dedupKey string) string {
	return fmt.Sprintf("Repeat event on %s", dedupKey)
}

// Event log reasons.
const (
	reasonNoAlert          = "No alert has this dedup key."
	reasonAlreadyResolved  = "This alert is already resolved."
	reasonAlreadyAcked     = "This alert is already acknowledged."
	reasonOtherIntegration = "This dedup key belongs to another integration."
	reasonNobodyOnCall     = "Nobody is on call on this policy, so no incident opened."
	reasonMaintenance      = "The service is in a maintenance window."
	reasonRateLimited      = "Over the limit of 120 events a minute."
	reasonQueueUnavailable = "The queue did not confirm this event."
)

// Dead letter reasons.
const (
	deadNotJSON     = "Body is not valid JSON."
	deadLongSummary = "Summary is longer than 1024 characters."
)

func deadMissingField(field string) string  { return fmt.Sprintf("Missing field: %s.", field) }
func deadUnknownSeverity(v string) string   { return fmt.Sprintf("Unknown severity: %s.", v) }
func deadUnknownRoutingKey(v string) string { return fmt.Sprintf("Unknown routing key: %s.", v) }
func deadEarlierMissing(seq int64) string {
	return fmt.Sprintf("Earlier event never arrived: key_seq %d.", seq)
}

// Status words shown on screen.
var incidentStatusWords = map[string]string{
	"triggered":    "Triggered",
	"acknowledged": "Acknowledged",
	"snoozed":      "Snoozed",
	"resolved":     "Resolved",
}

var updateStateLabels = map[string]string{
	"investigating": "Investigating",
	"identified":    "Identified",
	"monitoring":    "Monitoring",
	"resolved":      "Resolved",
}

var roleLabels = map[string]string{
	"responder":   "Responder",
	"lead":        "Lead",
	"admin":       "Admin",
	"stakeholder": "Stakeholder",
}

// RoleLabel is the word a role shows as on every screen and in mail.
func RoleLabel(role string) string { return roleLabels[role] }

// UpdateStateLabel is the word a status update's state shows as.
func UpdateStateLabel(state string) string { return updateStateLabels[state] }

// CountdownText is the one countdown form: MM:SS, or H:MM:SS from one hour.
func CountdownText(seconds int) string {
	if seconds < 0 {
		seconds = 0
	}
	hours := seconds / 3600
	minutes := (seconds % 3600) / 60
	rest := seconds % 60
	if hours > 0 {
		return fmt.Sprintf("%d:%02d:%02d", hours, minutes, rest)
	}
	return fmt.Sprintf("%02d:%02d", minutes, rest)
}

// knownZones are the zones the time zone comboboxes offer, alphabetically.
var knownZones = []string{
	"Africa/Lagos", "America/Bogota", "America/Chicago", "America/Denver", "America/Los_Angeles",
	"America/Mexico_City", "America/New_York", "America/Sao_Paulo", "America/Toronto", "Asia/Dubai",
	"Asia/Kolkata", "Asia/Shanghai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
	"Europe/Amsterdam", "Europe/Berlin", "Europe/Dublin", "Europe/Lisbon", "Europe/London",
	"Europe/Madrid", "Europe/Paris", "Europe/Stockholm", "Europe/Warsaw", "Pacific/Auckland", "UTC",
}

// KnownZones lists the zones a person or a schedule view may be set to.
func KnownZones() []string { return append([]string{}, knownZones...) }
