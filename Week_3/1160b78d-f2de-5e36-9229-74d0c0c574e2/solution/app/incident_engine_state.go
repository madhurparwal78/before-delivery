package main

import (
	"fmt"
	"net/http"
	"slices"
	"time"
)

// Actions an incident can be asked to take, and the two refusals of the transition table.
const (
	actAcknowledge = "acknowledge"
	actSnooze      = "snooze"
	actResolve     = "resolve"
	actReassign    = "reassign"
	actMerge       = "merge"
	actSplit       = "split"

	verdictConflict = "conflict" // the incident's standing decision makes the action illegal: 409 already_decided
	verdictIllegal  = "illegal"  // the action is illegal in this status: 409 illegal_transition
)

const illegalSnoozeMessage = "Only an acknowledged incident can be snoozed."

// Webhook event types of the incident engine.
const (
	hookTriggered      = "incident.triggered"
	hookAcknowledged   = "incident.acknowledged"
	hookSnoozed        = "incident.snoozed"
	hookUnacknowledged = "incident.unacknowledged"
	hookEscalated      = "incident.escalated"
	hookReassigned     = "incident.reassigned"
	hookMerged         = "incident.merged"
	hookResolved       = "incident.resolved"
)

// transitions is the incident state table: the status each action leads to from each status, or a refusal.
var transitions = map[string]map[string]string{
	"triggered": {actAcknowledge: "acknowledged", actSnooze: verdictIllegal, actResolve: "resolved",
		actReassign: "triggered", actMerge: "resolved", actSplit: "triggered"},
	"acknowledged": {actAcknowledge: verdictConflict, actSnooze: "snoozed", actResolve: "resolved",
		actReassign: "triggered", actMerge: "resolved", actSplit: "acknowledged"},
	"snoozed": {actAcknowledge: "acknowledged", actSnooze: verdictConflict, actResolve: "resolved",
		actReassign: "triggered", actMerge: "resolved", actSplit: "snoozed"},
	"resolved": {actAcknowledge: verdictConflict, actSnooze: verdictConflict, actResolve: verdictConflict,
		actReassign: verdictConflict, actMerge: verdictConflict, actSplit: verdictConflict},
}

// outcome is the status an action leads to, or a verdict. Only another person's acknowledge ends a snooze.
func (i *incidentRow) outcome(action string, by actorRef) string {
	if i.Status == "snoozed" && action == actAcknowledge && i.SnoozedBy != nil && *i.SnoozedBy == by.Name {
		return verdictConflict
	}
	return transitions[i.Status][action]
}

// alreadyAcknowledged reports whether someone has acknowledged an incident in the given status and it is not resolved:
// it is acknowledged, or snoozed after an acknowledge.
func alreadyAcknowledged(status string) bool { return status == "acknowledged" || status == "snoozed" }

// acknowledgeEventApplies reports whether an acknowledge event from a monitoring system takes effect on an incident in
// the given status. Only a triggered incident takes it; on an acknowledged or snoozed incident the event is dropped as
// already acknowledged, although a person may still acknowledge a snoozed incident through the table above.
func acknowledgeEventApplies(status string) bool {
	return status == "triggered" && transitions[status][actAcknowledge] == "acknowledged"
}

// decisionConflict is the 409 naming who made the decision that stands.
func (i *incidentRow) decisionConflict() *apiError {
	return errConflict("already_decided", "decision", i.Status, "decided_by", *i.DecidedBy,
		"decided_at", formatInstant(*i.DecidedAt))
}

// allow answers the status an action leads to, or the published refusal.
func (i *incidentRow) allow(action string, by actorRef) (string, error) {
	switch to := i.outcome(action, by); to {
	case verdictConflict:
		return "", i.decisionConflict()
	case verdictIllegal:
		return "", errConflict("illegal_transition", "message", illegalSnoozeMessage)
	default:
		return to, nil
	}
}

// decide records the decision that stands.
func (i *incidentRow) decide(status, by string, now time.Time) {
	i.Status, i.DecidedBy, i.DecidedAt = status, &by, &now
}

// armEscalation starts the current level's full timeout at now, for a triggered high-urgency incident whose escalation
// has not finished.
func (i *incidentRow) armEscalation(now time.Time) {
	i.EscalationDueAt = nil
	if i.Urgency == "high" && !i.EscalationFinished {
		due := now.Add(time.Duration(i.Snapshot.Levels[i.Level-1].TimeoutMinutes) * time.Minute)
		i.EscalationDueAt = &due
	}
}

// backToTriggered clears the standing decision and restarts escalation at now.
func (i *incidentRow) backToTriggered(now time.Time) {
	i.Status = "triggered"
	i.SnoozedUntil, i.SnoozedBy, i.AckDeadline, i.DecidedBy, i.DecidedAt = nil, nil, nil, nil, nil
	i.armEscalation(now)
}

// restartAutoResolve moves auto-resolve to the given instant plus the copied minutes, when the incident has any.
func (i *incidentRow) restartAutoResolve(from time.Time) {
	if i.AutoResolveMinutes != nil {
		at := from.Add(time.Duration(*i.AutoResolveMinutes) * time.Minute)
		i.AutoResolveAt = &at
	}
}

// Timers the engine keeps for an incident, each armed from a deadline column.
const (
	timerEscalation  = "incident_escalation"
	timerAckTimeout  = "incident_ack_timeout"
	timerSnoozeEnd   = "incident_snooze_end"
	timerAutoResolve = "incident_auto_resolve"
)

// syncTimers arms each timer whose deadline is set on the incident and disarms the others.
func (w *Work) syncTimers(inc *incidentRow) error {
	deadlines := []struct {
		kind string
		due  *time.Time
	}{
		{timerEscalation, inc.EscalationDueAt},
		{timerAckTimeout, inc.AckDeadline},
		{timerSnoozeEnd, inc.SnoozedUntil},
		{timerAutoResolve, inc.AutoResolveAt},
	}
	for _, d := range deadlines {
		var err error
		if d.due != nil {
			err = w.setTimer(d.kind, inc.ID, *d.due)
		} else {
			err = w.clearTimer(d.kind, inc.ID)
		}
		if err != nil {
			return fmt.Errorf("sync timers of incident %s: %w", inc.ID, err)
		}
	}
	return nil
}

// saveIncident writes every mutable column, raises the version once and re-arms the timers.
func (w *Work) saveIncident(inc *incidentRow) error {
	_, err := w.Tx.Exec(w.Ctx, `update incidents set service_id = $2, status = $3, urgency = $4, holders = $5, level = $6,
			cycle = $7, escalation_finished = $8, policy_held = $9, policy_snapshot = $10, snoozed_until = $11,
			snoozed_by = $12, ack_deadline = $13, auto_resolve_at = $14, resolve_reason = $15, merged_into = $16,
			resolved_at = $17, decided_by = $18, decided_at = $19, window_ends_at = $20, escalation_due_at = $21,
			impacted_services = $22, assignment = $23, version = version + 1 where id = $1`,
		inc.ID, inc.ServiceID, inc.Status, inc.Urgency, inc.Holders, inc.Level, inc.Cycle, inc.EscalationFinished,
		inc.PolicyHeld, inc.Snapshot, inc.SnoozedUntil, inc.SnoozedBy, inc.AckDeadline, inc.AutoResolveAt, inc.ResolveReason, inc.MergedInto,
		inc.ResolvedAt, inc.DecidedBy, inc.DecidedAt, inc.WindowEndsAt, inc.EscalationDueAt, inc.ImpactedServices,
		inc.Assignment)
	if err != nil {
		return fmt.Errorf("save incident %s: %w", inc.ID, err)
	}
	inc.Version++
	if err := w.syncTimers(inc); err != nil {
		return fmt.Errorf("arm incident timers: %w", err)
	}
	return nil
}

// report records a change of the incident: its timeline entry, the webhook event, the live message and the status surfaces.
func (w *Work) report(inc *incidentRow, kind, actor, text, hook string) error {
	if _, err := w.addTimeline(inc.ID, kind, actor, text, nil); err != nil {
		return fmt.Errorf("add timeline: %w", err)
	}
	if hook != "" {
		if err := w.emitWebhook(hook, inc.ID); err != nil {
			return fmt.Errorf("emit %s for incident %s: %w", hook, inc.ID, err)
		}
	}
	if err := w.publishIncident(inc.ID, text); err != nil {
		return fmt.Errorf("publish incident: %w", err)
	}
	w.statusChanged()
	return nil
}

// acknowledgeIncident is the acknowledge transition. Another person's acknowledge ends a snooze early.
func (a *App) acknowledgeIncident(w *Work, incidentID string, by actorRef) error {
	inc, err := loadIncident(w.Ctx, w.Tx, incidentID)
	if err != nil {
		return fmt.Errorf("load incident: %w", err)
	}
	to, err := inc.allow(actAcknowledge, by)
	if err != nil {
		return fmt.Errorf("acknowledge incident %s: %w", incidentID, err)
	}
	service, err := loadService(w.Ctx, w.Tx, inc.ServiceID)
	if err != nil {
		return fmt.Errorf("load service: %w", err)
	}
	endsSnooze := inc.Status == "snoozed"
	inc.decide(to, by.Name, w.Now)
	inc.SnoozedUntil, inc.SnoozedBy, inc.EscalationDueAt, inc.AckDeadline = nil, nil, nil, nil
	if service.AckTimeoutMinutes != nil {
		deadline := w.Now.Add(time.Duration(*service.AckTimeoutMinutes) * time.Minute)
		inc.AckDeadline = &deadline
	}
	if endsSnooze {
		inc.restartAutoResolve(w.Now)
	}
	if err := w.saveIncident(&inc); err != nil {
		return fmt.Errorf("save incident: %w", err)
	}
	if err := a.cancelPendingSteps(w, incidentID, nil); err != nil {
		return fmt.Errorf("cancel pending steps: %w", err)
	}
	text := fmt.Sprintf("Incident #%d acknowledged by %s", inc.Number, by.Name)
	if err := w.report(&inc, "acknowledged", by.Name, text, hookAcknowledged); err != nil {
		return fmt.Errorf("report acknowledged incident: %w", err)
	}
	return nil
}

// closure is how an incident ends: resolved by a person or a timer, or merged.
type closure struct {
	Reason     string
	Kind       string
	Actor      string
	Text       string
	Hook       string
	MergedInto *int
}

// closeIncident ends an incident: it resolves its alerts, stops its timers and cancels its unsent steps.
func (a *App) closeIncident(w *Work, inc *incidentRow, c closure) error {
	resolvedAt := w.Now
	inc.decide("resolved", c.Actor, w.Now)
	inc.ResolvedAt, inc.ResolveReason, inc.MergedInto = &resolvedAt, &c.Reason, c.MergedInto
	inc.SnoozedUntil, inc.SnoozedBy, inc.AckDeadline, inc.AutoResolveAt = nil, nil, nil, nil
	inc.EscalationDueAt, inc.WindowEndsAt = nil, nil
	_, err := w.Tx.Exec(w.Ctx, `update alerts set status = 'resolved', resolved_at = $2
		where incident_id = $1 and status <> 'resolved'`, inc.ID, w.Now)
	if err != nil {
		return fmt.Errorf("resolve alerts of incident %s: %w", inc.ID, err)
	}
	if err := w.saveIncident(inc); err != nil {
		return fmt.Errorf("save incident: %w", err)
	}
	if err := a.cancelPendingSteps(w, inc.ID, nil); err != nil {
		return fmt.Errorf("cancel pending steps: %w", err)
	}
	if err := w.report(inc, c.Kind, c.Actor, c.Text, c.Hook); err != nil {
		return fmt.Errorf("report incident closure: %w", err)
	}
	return nil
}

// resolveIncident is the resolve transition.
func (a *App) resolveIncident(w *Work, incidentID string, by actorRef) error {
	inc, err := loadIncident(w.Ctx, w.Tx, incidentID)
	if err != nil {
		return fmt.Errorf("load incident: %w", err)
	}
	if _, err := inc.allow(actResolve, by); err != nil {
		return fmt.Errorf("resolve incident %s: %w", incidentID, err)
	}
	if err := a.closeIncident(w, &inc, closure{Reason: "Resolved", Kind: "resolved", Actor: by.Name,
		Text: fmt.Sprintf("Incident #%d resolved by %s", inc.Number, by.Name), Hook: hookResolved}); err != nil {
		return fmt.Errorf("close resolved incident: %w", err)
	}
	return nil
}

const (
	snoozeMaxHours = 168
	snoozeAfterNow = "Choose a time after now."
	snoozeTooLong  = "Snooze for at most 168 hours."
)

var snoozePresets = []int{1, 4, 8, 24}

// snoozeRequest is the body of a snooze: a preset in hours, or an instant.
type snoozeRequest struct {
	PresetHours *int    `json:"preset_hours"`
	Until       *string `json:"until"`
}

// end is the instant the snooze lasts until.
func (r snoozeRequest) end(now time.Time) (time.Time, error) {
	if r.PresetHours != nil && slices.Contains(snoozePresets, *r.PresetHours) {
		return now.Add(time.Duration(*r.PresetHours) * time.Hour), nil
	}
	if r.Until == nil {
		return time.Time{}, errField("until", snoozeAfterNow)
	}
	until, err := parseInstant(*r.Until)
	if err != nil || instantReached(now, until) {
		return time.Time{}, errField("until", snoozeAfterNow)
	}
	if !instantReached(now.Add(snoozeMaxHours*time.Hour), until) {
		return time.Time{}, errField("until", snoozeTooLong)
	}
	return until, nil
}

// snoozeIncident snoozes an acknowledged incident; the snooze replaces its acknowledge timeout.
func (a *App) snoozeIncident(w *Work, incidentID string, by actorRef, req snoozeRequest) error {
	inc, err := loadIncident(w.Ctx, w.Tx, incidentID)
	if err != nil {
		return fmt.Errorf("load incident: %w", err)
	}
	to, err := inc.allow(actSnooze, by)
	if err != nil {
		return fmt.Errorf("snooze incident %s: %w", incidentID, err)
	}
	until, err := req.end(w.Now)
	if err != nil {
		return fmt.Errorf("snooze incident %s: %w", incidentID, err)
	}
	inc.decide(to, by.Name, w.Now)
	inc.SnoozedUntil, inc.SnoozedBy, inc.AckDeadline = &until, &by.Name, nil
	inc.restartAutoResolve(until)
	if err := w.saveIncident(&inc); err != nil {
		return fmt.Errorf("save incident: %w", err)
	}
	local, err := localTime(until, firmZone)
	if err != nil {
		return fmt.Errorf("local time: %w", err)
	}
	text := fmt.Sprintf("Incident #%d snoozed by %s until %s", inc.Number, by.Name, local)
	if err := w.report(&inc, "snoozed", by.Name, text, hookSnoozed); err != nil {
		return fmt.Errorf("report snoozed incident: %w", err)
	}
	return nil
}

// reassignRequest is the body of a reassign: a person or a service.
type reassignRequest struct {
	PersonID  string `json:"person_id"`
	ServiceID string `json:"service_id"`
}

// reassignIncident hands the incident to a person, or to another service's policy; either way it is triggered again.
func (a *App) reassignIncident(w *Work, incidentID string, by actorRef, req reassignRequest) error {
	inc, err := loadIncident(w.Ctx, w.Tx, incidentID)
	if err != nil {
		return fmt.Errorf("load incident: %w", err)
	}
	if _, err := inc.allow(actReassign, by); err != nil {
		return fmt.Errorf("reassign incident %s: %w", incidentID, err)
	}
	if (req.PersonID == "") == (req.ServiceID == "") {
		return errField("person_id", "Choose either a person or a service.")
	}
	wasSnoozed, oldHolders := inc.Status == "snoozed", inc.Holders
	if req.PersonID != "" {
		if err := a.reassignToPerson(w, &inc, req.PersonID); err != nil {
			return fmt.Errorf("reassign to person: %w", err)
		}
	} else if err := a.reassignToService(w, &inc, req.ServiceID); err != nil {
		return fmt.Errorf("reassign to service: %w", err)
	}
	inc.backToTriggered(w.Now)
	if wasSnoozed {
		inc.restartAutoResolve(w.Now)
	}
	inc.Assignment++
	if err := w.saveIncident(&inc); err != nil {
		return fmt.Errorf("save incident: %w", err)
	}
	if err := a.cancelPendingSteps(w, incidentID, oldHolders); err != nil {
		return fmt.Errorf("cancel pending steps: %w", err)
	}
	if err := a.notifyHolders(w, incidentID, inc.Holders); err != nil {
		return fmt.Errorf("notify holders: %w", err)
	}
	holders, err := personRefs(w.Ctx, w.Tx, inc.Holders)
	if err != nil {
		return fmt.Errorf("person refs: %w", err)
	}
	text := fmt.Sprintf("Incident #%d reassigned to %s by %s", inc.Number, holdersText(holders), by.Name)
	if err := w.report(&inc, "reassigned", by.Name, text, hookReassigned); err != nil {
		return fmt.Errorf("report reassigned incident: %w", err)
	}
	return nil
}

func (a *App) reassignToPerson(w *Work, inc *incidentRow, personID string) error {
	var known bool
	err := w.Tx.QueryRow(w.Ctx, `select exists (select 1 from users where id = $1 and removed_at is null)`, personID).Scan(&known)
	if err != nil {
		return fmt.Errorf("check person %s: %w", personID, err)
	}
	switch {
	case !known:
		return errField("person_id", "Choose a person.")
	case slices.Contains(inc.Holders, personID):
		return errField("person_id", "This person already holds the incident.")
	}
	inc.Holders, inc.PolicyHeld = []string{personID}, false
	return nil
}

func (a *App) reassignToService(w *Work, inc *incidentRow, serviceID string) error {
	if serviceID == inc.ServiceID {
		return errField("service_id", "The incident is already on this service.")
	}
	service, err := loadService(w.Ctx, w.Tx, serviceID)
	if isNoRows(err) {
		return errField("service_id", "Choose a service.")
	}
	if err != nil {
		return fmt.Errorf("read service: %w", err)
	}
	snapshot, err := a.policySnapshotOf(w.Ctx, w.Tx, service.PolicyID)
	if err != nil {
		return fmt.Errorf("copy policy of service %s: %w", serviceID, err)
	}
	place, err := a.levels(w, snapshot).seek(1, 0)
	if err != nil {
		return fmt.Errorf("find who is on call: %w", err)
	}
	if !slices.Contains(inc.ImpactedServices, inc.ServiceID) {
		inc.ImpactedServices = append(inc.ImpactedServices, inc.ServiceID)
	}
	_, err = w.Tx.Exec(w.Ctx, `update alerts set service_id = $2 where incident_id = $1`, inc.ID, serviceID)
	if err != nil {
		return fmt.Errorf("move alerts of incident %s: %w", inc.ID, err)
	}
	inc.ServiceID, inc.Snapshot, inc.Cycle, inc.EscalationFinished, inc.PolicyHeld = serviceID, snapshot, 0, false, true
	inc.Level, inc.Holders = 1, personIDs(place.Holders)
	if place.Found {
		inc.Level = place.Level
	}
	return nil
}

// respond answers an incident action with the incident as the viewer sees it.
func (a *App) respond(rq *Req, incidentID string) error {
	view, _, err := a.incidentJSON(rq.Ctx(), a.db, incidentID, rq.viewerZone())
	if err != nil {
		return fmt.Errorf("read incident %s: %w", incidentID, err)
	}
	return rq.JSON(http.StatusOK, view)
}

func (a *App) hAcknowledge(rq *Req) error {
	id := rq.Param("id")
	err := a.Do(rq.Ctx(), func(w *Work) error {
		if err := a.acknowledgeIncident(w, id, rq.ref()); err != nil {
			return fmt.Errorf("apply acknowledge: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("acknowledge incident %s: %w", id, err)
	}
	if err := a.respond(rq, id); err != nil {
		return fmt.Errorf("answer acknowledge: %w", err)
	}
	return nil
}

func (a *App) hResolve(rq *Req) error {
	id := rq.Param("id")
	err := a.Do(rq.Ctx(), func(w *Work) error {
		if err := a.resolveIncident(w, id, rq.ref()); err != nil {
			return fmt.Errorf("apply resolve: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("resolve incident %s: %w", id, err)
	}
	if err := a.respond(rq, id); err != nil {
		return fmt.Errorf("answer resolve: %w", err)
	}
	return nil
}

func (a *App) hSnooze(rq *Req) error {
	id := rq.Param("id")
	var req snoozeRequest
	if err := rq.Decode(&req); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	err := a.Do(rq.Ctx(), func(w *Work) error {
		if err := a.snoozeIncident(w, id, rq.ref(), req); err != nil {
			return fmt.Errorf("apply snooze: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("snooze incident %s: %w", id, err)
	}
	if err := a.respond(rq, id); err != nil {
		return fmt.Errorf("answer snooze: %w", err)
	}
	return nil
}

func (a *App) hReassign(rq *Req) error {
	id := rq.Param("id")
	var req reassignRequest
	if err := rq.Decode(&req); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	err := a.Do(rq.Ctx(), func(w *Work) error {
		if err := a.reassignIncident(w, id, rq.ref(), req); err != nil {
			return fmt.Errorf("apply reassign: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("reassign incident %s: %w", id, err)
	}
	if err := a.respond(rq, id); err != nil {
		return fmt.Errorf("answer reassign: %w", err)
	}
	return nil
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "POST /api/incidents/{id}/acknowledge", Access: accStaff, Resource: "incident", KeyWrite: true, Handler: a.hAcknowledge})
		a.route(route{Pattern: "POST /api/incidents/{id}/snooze", Access: accStaff, Resource: "incident", KeyWrite: true, Handler: a.hSnooze})
		a.route(route{Pattern: "POST /api/incidents/{id}/resolve", Access: accStaff, Resource: "incident", KeyWrite: true, Handler: a.hResolve})
		a.route(route{Pattern: "POST /api/incidents/{id}/reassign", Access: accStaff, Resource: "incident", KeyWrite: true, Handler: a.hReassign})
	})
}
