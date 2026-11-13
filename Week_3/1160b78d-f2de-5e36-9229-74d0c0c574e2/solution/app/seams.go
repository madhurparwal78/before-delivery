package main

import (
	"encoding/json"
	"time"
)

// The types the domains share, and the functions they call on each other. Each function is defined in the file named here:
//
//	incident engine: applyMonitoringEvent (incident_engine_events.go), moveHandedOffIncidents (incident_engine_timers.go)
//	notifications:   notifyHolders, cancelPendingSteps, addResponderNotice, stepViews (notify.go), enqueueMail (mail.go)
//	schedules:       scheduleHolderAt, personShifts (schedule_final.go), clearOncallCache (oncall.go)
//	catalog:         policySnapshotOf (policy.go), serviceInMaintenance (maintenance.go), clearStatusCache (status.go)
//	webhooks:        emitWebhook (webhook.go)

// personRef is a person in a holder or responder list.
type personRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// monitoringEvent is one intake event after the worker accepted it, with the integration its routing key names.
type monitoringEvent struct {
	EventID         string
	RoutingKey      string
	DedupKey        string
	Action          string // trigger, acknowledge, resolve
	Summary         string
	Source          string
	Severity        string
	CustomDetails   json.RawMessage
	IntegrationID   string
	IntegrationName string
	ServiceID       string
}

// eventOutcome is what the event log records for an applied event.
type eventOutcome struct {
	Outcome        string // Applied, Dropped, Suppressed
	Reason         string // empty when Applied
	IncidentNumber *int
}

// policySnapshot is a policy as copied into an incident when it opens, with target names.
type policySnapshot struct {
	Name    string          `json:"name"`
	Version int             `json:"version"`
	Repeats int             `json:"repeats"`
	Levels  []snapshotLevel `json:"levels"`
}

type snapshotLevel struct {
	TimeoutMinutes int              `json:"timeout_minutes"`
	Targets        []snapshotTarget `json:"targets"`
}

type snapshotTarget struct {
	Type string `json:"type"` // person | schedule
	ID   string `json:"id"`
	Name string `json:"name"`
}

// stepView is one notification step on an incident, as published.
type stepView struct {
	ID         string  `json:"id"`
	Person     string  `json:"person"`
	Kind       string  `json:"kind"`    // step | low_urgency
	Channel    string  `json:"channel"` // in_app | email
	DueAt      string  `json:"due_at"`
	Status     string  `json:"status"` // scheduled | held | queued | sent | cancelled
	SentAt     *string `json:"sent_at"`
	DueLocal   string  `json:"due_local"`   // due time in the viewer's zone: YYYY-MM-DD HH:MM ZZZ
	StatusText string  `json:"status_text"` // Scheduled | Held until <local time in the holder's zone> | Queued | Sent | Cancelled
}

// outboundMail is one message for the mail queue.
type outboundMail struct {
	Kind    string // step | low_urgency | status
	To      string
	Subject string
	Body    string
	DueAt   time.Time
}

// shiftRef is one stretch of a final schedule held by a person.
type shiftRef struct {
	Schedule string
	Start    time.Time
	End      time.Time
}

// actorRef is who acts on an incident: ID is empty for an API key, an integration or a timer.
type actorRef struct {
	ID   string
	Name string
}

// ref is the request's actor as an actorRef.
func (rq *Req) ref() actorRef { return actorRef{ID: rq.Actor.ID, Name: rq.Actor.Name} }
