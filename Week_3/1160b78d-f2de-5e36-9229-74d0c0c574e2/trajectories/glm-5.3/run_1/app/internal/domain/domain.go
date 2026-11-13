// Package domain holds the shared record shapes and the single places where
// each domain rule is decided: transitions, the edge rule, the final schedule
// computation, the status rollup and the notification rules.
package domain

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Includes applies the edge rule: every timed period includes its start second
// and excludes its end second, so at second T the timer ending at T has fired.
func Includes(start, end, t time.Time) bool {
	return !t.Before(start) && t.Before(end)
}

// TimerFired reports whether a deadline has passed at instant t.
func TimerFired(deadline, t time.Time) bool { return !t.Before(deadline) }

// User is a person of the firm.
type User struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	Email              string  `json:"email"`
	Role               string  `json:"role"`
	Timezone           string  `json:"timezone"`
	QuietStart         *string `json:"quiet_start"`
	QuietEnd           *string `json:"quiet_end"`
	NotificationDelays []int   `json:"notification_delays"`
	LowUrgencyDelay    int     `json:"low_urgency_delay"`
}

// FirmZone is the firm's own zone.
const FirmZone = "America/Chicago"

var severityRank = map[string]int{"info": 0, "warning": 1, "error": 2, "critical": 3}

// SeverityRank orders severities.
func SeverityRank(s string) int { return severityRank[s] }

// UrgencyOf maps an alert severity to an incident urgency.
func UrgencyOf(severity string) string {
	if severity == "critical" || severity == "error" {
		return "high"
	}
	return "low"
}

// Incident statuses.
const (
	StatusTriggered    = "triggered"
	StatusAcknowledged = "acknowledged"
	StatusSnoozed      = "snoozed"
	StatusResolved     = "resolved"
)

// CanTransition decides the one published state machine. It returns the new
// status and whether the transition is legal.
func CanTransition(from, action string) (string, bool) {
	switch action {
	case "acknowledge":
		if from == StatusTriggered || from == StatusSnoozed {
			return StatusAcknowledged, true
		}
		return from, false
	case "resolve":
		switch from {
		case StatusTriggered, StatusAcknowledged, StatusSnoozed:
			return StatusResolved, true
		}
		return from, false
	case "snooze":
		if from == StatusAcknowledged {
			return StatusSnoozed, true
		}
		return from, false
	case "reassign":
		switch from {
		case StatusTriggered, StatusAcknowledged, StatusSnoozed:
			return StatusTriggered, true
		}
		return from, false
	}
	return from, false
}

// Open reports whether an incident can still be acted on.
func Open(status string) bool { return status != StatusResolved }

// PolicySnapshot is the opened-with copy of a policy.
type PolicySnapshot struct {
	Name    string        `json:"name"`
	Version int           `json:"version"`
	Repeats int           `json:"repeats"`
	Levels  []PolicyLevel `json:"levels"`
}

// PolicyLevel is one escalation level.
type PolicyLevel struct {
	TimeoutMinutes int            `json:"timeout_minutes"`
	Targets        []PolicyTarget `json:"targets"`
}

// PolicyTarget names a schedule or a person.
type PolicyTarget struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Holder is a person holding an incident.
type Holder struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Countdown kinds.
const (
	CountdownEscalation  = "escalation"
	CountdownAckTimeout  = "ack_timeout"
	CountdownSnooze      = "snooze"
	CountdownAutoResolve = "auto_resolve"
	CountdownNone        = "none"
)

// Countdown is the server-owned timer view.
type Countdown struct {
	Kind             string     `json:"kind"`
	DueAt            *time.Time `json:"due_at"`
	RemainingSeconds int64      `json:"remaining_seconds"`
}

// Incident carries the state needed on every surface.
type Incident struct {
	ID                 string          `json:"id"`
	Number             int64           `json:"number"`
	Title              string          `json:"title"`
	Service            ServiceRef      `json:"service"`
	Status             string          `json:"status"`
	Urgency            string          `json:"urgency"`
	Holders            []Holder        `json:"holders"`
	Level              int             `json:"level"`
	Cycle              int             `json:"cycle"`
	PolicySnapshot     PolicySnapshot  `json:"policy_snapshot"`
	ServerNow          time.Time       `json:"server_now"`
	Countdown          Countdown       `json:"countdown"`
	AutoResolveAt      *time.Time      `json:"auto_resolve_at"`
	SnoozedUntil       *time.Time      `json:"snoozed_until"`
	ResolveReason      *string         `json:"resolve_reason"`
	MergedInto         *string         `json:"merged_into"`
	ImpactedServices   []ServiceRef    `json:"impacted_services"`
	Responders         []Holder        `json:"responders"`
	ResponderRequests  []ResponderReq  `json:"responder_requests"`
	Alerts             []Alert         `json:"alerts"`
	Timeline           []TimelineEntry `json:"timeline"`
	Steps              []Step          `json:"steps"`
	Version            int             `json:"version"`
	OpenedAt           time.Time       `json:"opened_at"`
	AckDeadline        *time.Time      `json:"-"`
	EscalateAt         *time.Time      `json:"-"`
	SnoozedBy          *string         `json:"-"`
	GroupingUntil      *time.Time      `json:"-"`
	EscalationFinished bool            `json:"-"`
	ClosedAt           *time.Time      `json:"-"`
	ServiceID          string          `json:"-"`
	mergeTarget        int64
	mergedNumber      *int64
}

// ServiceRef names a service.
type ServiceRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Alert is one dedup key's alert.
type Alert struct {
	ID         string  `json:"id"`
	RoutingKey *string `json:"routing_key"`
	DedupKey    string  `json:"dedup_key"`
	Status     string  `json:"status"`
	Summary    string  `json:"summary"`
	Source     string  `json:"source"`
	Severity   string  `json:"severity"`
	EventCount int     `json:"event_count"`
}

// TimelineEntry is one line of the timeline.
type TimelineEntry struct {
	ID         string    `json:"id"`
	At         time.Time `json:"at"`
	Kind       string    `json:"kind"`
	Actor      string    `json:"actor"`
	Text       string    `json:"text"`
	FromNumber *int64    `json:"from_number,omitempty"`
}

// Step is one notification step.
type Step struct {
	ID     string     `json:"id"`
	Person string     `json:"person"`
	Kind   string     `json:"kind"`
	Channel string    `json:"channel"`
	DueAt  time.Time  `json:"due_at"`
	Status string     `json:"status"`
	SentAt *time.Time `json:"sent_at"`
}

// ResponderReq is an invitation to join.
type ResponderReq struct {
	ID     string `json:"id"`
	Person string `json:"person"`
	State  string `json:"state"`
}

// Timeline kinds.
const (
	KindTriggered         = "triggered"
	KindAcknowledged      = "acknowledged"
	KindSnoozed           = "snoozed"
	KindSnoozeEnded       = "snooze_ended"
	KindAckTimedOut       = "ack_timed_out"
	KindEscalated         = "escalated"
	KindHandedOff         = "handed_off"
	KindReassigned        = "reassigned"
	KindMerged            = "merged"
	KindSplit             = "split"
	KindUrgencyRaised     = "urgency_raised"
	KindResponderRequested = "responder_requested"
	KindResponderAccepted  = "responder_accepted"
	KindResponderDeclined  = "responder_declined"
	KindResolved           = "resolved"
	KindAutoResolved      = "auto_resolved"
	KindRepeatEvent       = "repeat_event"
	KindNote              = "note"
)

// TimelineText builds the exact published line for a kind. The extra strings
// carry the actor or target names the line needs.
func TimelineText(kind string, i *Incident, extra ...string) string {
	switch kind {
	case KindTriggered:
		return fmt.Sprintf("Incident #%d triggered: %s", i.Number, i.Title)
	case KindAcknowledged:
		return fmt.Sprintf("Incident #%d acknowledged by %s", i.Number, extra[0])
	case KindSnoozed:
		return fmt.Sprintf("Incident #%d snoozed by %s until %s", i.Number, extra[0], extra[1])
	case KindSnoozeEnded:
		return fmt.Sprintf("Incident #%d back to triggered: snooze ended", i.Number)
	case KindAckTimedOut:
		return fmt.Sprintf("Incident #%d back to triggered: acknowledge timed out", i.Number)
	case KindEscalated:
		return fmt.Sprintf("Incident #%d escalated to %s", i.Number, extra[0])
	case KindHandedOff:
		return fmt.Sprintf("Incident #%d handed off from %s to %s", i.Number, extra[0], extra[1])
	case KindReassigned:
		return fmt.Sprintf("Incident #%d reassigned to %s by %s", i.Number, extra[0], extra[1])
	case KindMerged:
		return fmt.Sprintf("Incident #%d merged into #%d by %s", i.Number, i.mergeTarget, extra[0])
	case KindSplit:
		return fmt.Sprintf("Alert %s split into incident #%s by %s", extra[0], extra[1], extra[2])
	case KindUrgencyRaised:
		return fmt.Sprintf("Incident #%d raised to high urgency", i.Number)
	case KindResponderRequested:
		return fmt.Sprintf("%s asked %s to join incident #%d", extra[0], extra[1], i.Number)
	case KindResponderAccepted:
		return fmt.Sprintf("%s joined incident #%d", extra[0], i.Number)
	case KindResponderDeclined:
		return fmt.Sprintf("%s declined to join incident #%d", extra[0], i.Number)
	case KindResolved:
		return fmt.Sprintf("Incident #%d resolved by %s", i.Number, extra[0])
	case KindAutoResolved:
		return fmt.Sprintf("Incident #%d auto-resolved", i.Number)
	case KindRepeatEvent:
		return fmt.Sprintf("Repeat event on %s", extra[0])
	}
	return ""
}

// SetMergeTarget records the merge target number for timeline text.
func (i *Incident) SetMergeTarget(n int64) { i.mergeTarget = n }

// ParseTarget returns the stored merge target number.
func (i *Incident) ParseTarget() int64 { return i.mergeTarget }

// SetMergedNumber records the merge target's number for webhook bodies.
func (i *Incident) SetMergedNumber(n int64) { i.mergedNumber = &n }

// MergedNumber reads the target's number from the stored reference.
func (i *Incident) MergedNumber() *int64 { return i.mergedNumber }

// HolderNames joins names with ", " or reads "Nobody".
func HolderNames(hs []Holder) string {
	if len(hs) == 0 {
		return "Nobody"
	}
	parts := make([]string, 0, len(hs))
	for _, h := range hs {
		parts = append(parts, h.Name)
	}
	return strings.Join(parts, ", ")
}

// LocalTime renders the display form YYYY-MM-DD HH:MM ZZZ.
func LocalTime(t time.Time, zone string) string {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		loc = time.UTC
	}
	return t.In(loc).Format("2006-01-02 15:04 MST")
}

// FirmLocal renders a server-built time in the firm's zone.
func FirmLocal(t time.Time) string { return LocalTime(t, FirmZone) }

// Schedule block sources.
const (
	SourceLayer    = "layer"
	SourceOverride = "override"
	SourceGap      = "gap"
)

// Block is one run of the final schedule.
type Block struct {
	Start      time.Time `json:"start"`
	End        time.Time `json:"end"`
	Minutes    int       `json:"minutes"`
	Person     *Holder   `json:"person"`
	Gap        bool      `json:"gap"`
	Source     string    `json:"source"`
	LayerID    *string    `json:"layer_id"`
	OverrideID *string   `json:"override_id"`
	Preview    bool      `json:"preview,omitempty"`
	LayerName  string    `json:"layer_name,omitempty"`
}

// DayBand is one local day of the grid.
type DayBand struct {
	Date    string    `json:"date"`
	Start   time.Time `json:"start"`
	End     time.Time `json:"end"`
	Minutes int       `json:"minutes"`
}

// Service own status words.
const (
	StatusMajorOutage = "Major outage"
	StatusPartial     = "Partial outage"
	StatusDegraded    = "Degraded"
	StatusMaintenance = "Maintenance"
	StatusOperational = "Operational"
)

// StatusOrder lists shown statuses worst first.
var StatusOrder = []string{StatusMajorOutage, StatusPartial, StatusDegraded, StatusMaintenance, StatusOperational}

// WorstStatus picks the worse of two shown statuses.
func WorstStatus(a, b string) string {
	if a == "" {
		return b
	}
	if b == "" {
		return a
	}
	ai, bi := -1, -1
	for i, s := range StatusOrder {
		if s == a {
			ai = i
		}
		if s == b {
			bi = i
		}
	}
	if ai < bi {
		return a
	}
	return b
}

// Delivery statuses.
const (
	DeliveryPending  = "pending"
	DeliveryRetrying = "retrying"
	DeliveryDelivered = "delivered"
	DeliveryRejected = "rejected"
	DeliveryFailed   = "failed"
)

// Event log outcomes.
const (
	LogApplied      = "Applied"
	LogDropped      = "Dropped"
	LogSuppressed   = "Suppressed"
	LogRefused      = "Refused"
	LogDeadLettered = "Dead-lettered"
	LogReplayed     = "Replayed"
)

// Step statuses.
const (
	StepScheduled = "scheduled"
	StepHeld      = "held"
	StepQueued    = "queued"
	StepSent      = "sent"
	StepCancelled = "cancelled"
)

// Maintenance window states.
const (
	WindowUpcoming = "Upcoming"
	WindowRunning  = "Running"
	WindowEnded    = "Ended"
)

// RawJSON marshals for storage in a jsonb column.
func RawJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("null")
	}
	return b
}

// FirmLoc loads the firm's zone once for analytics ranges and business hours.
func FirmLoc() *time.Location {
loc, err := time.LoadLocation(FirmZone)
if err != nil {
return time.UTC
}
return loc
}
