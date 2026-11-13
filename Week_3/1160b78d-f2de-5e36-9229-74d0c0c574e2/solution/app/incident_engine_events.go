package main

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// Reasons the event log prints for an event that does not open or change an incident.
const (
	reasonNobodyOnCall     = "Nobody is on call on this policy, so no incident opened."
	reasonInMaintenance    = "The service is in a maintenance window."
	reasonNoAlert          = "No alert has this dedup key."
	reasonAlertResolved    = "This alert is already resolved."
	reasonAlertAcknowledge = "This alert is already acknowledged."
	reasonOtherIntegration = "This dedup key belongs to another integration."
)

// Outcomes of the event log that the engine decides.
const (
	outcomeApplied    = "Applied"
	outcomeDropped    = "Dropped"
	outcomeSuppressed = "Suppressed"
)

// systemActor is the name of an entry made by a timer, or by a handoff with nobody acting.
const systemActor = "Switchlamp"

// planKind says what a trigger does.
type planKind int

const (
	planRepeat     planKind = iota // the alert is open: count it
	planJoin                       // a grouped incident takes the alert
	planOpen                       // a new incident opens
	planSuppressed                 // the service is in a maintenance window
	planNobody                     // nobody is on call on the whole policy
)

// triggerPlan is what a trigger will do, decided before anything is written.
type triggerPlan struct {
	Kind       planKind
	Service    serviceRow
	IncidentID string // the incident a repeat or a join lands on
	AlertID    string // the open alert a repeat counts
	Snapshot   policySnapshot
	Place      placement
}

// planTrigger decides, in the brief's order, what a trigger does: a maintenance window suppresses it, an open alert
// counts it, a grouped incident takes it, and otherwise a new incident opens if somebody is on call.
func (a *App) planTrigger(w *Work, alert newAlert) (triggerPlan, error) {
	service, err := loadService(w.Ctx, w.Tx, alert.ServiceID)
	if err != nil {
		return triggerPlan{}, fmt.Errorf("load service: %w", err)
	}
	plan := triggerPlan{Service: service}
	inMaintenance, err := a.serviceInMaintenance(w.Ctx, w.Tx, service.ID, w.Now)
	if err != nil {
		return plan, fmt.Errorf("check maintenance of %s: %w", service.Name, err)
	}
	if inMaintenance {
		plan.Kind = planSuppressed
		return plan, nil
	}
	err = w.Tx.QueryRow(w.Ctx, `select id, incident_id from alerts where routing_key is not distinct from $1 and dedup_key = $2
			and status <> 'resolved' and ($1::text is not null or service_id = $3)
		order by order_no desc limit 1`, alert.RoutingKey, alert.DedupKey, alert.ServiceID).Scan(&plan.AlertID, &plan.IncidentID)
	if err == nil {
		plan.Kind = planRepeat
		return plan, nil
	}
	if !isNoRows(err) {
		return plan, fmt.Errorf("find open alert %s: %w", alert.DedupKey, err)
	}
	joined, err := a.groupingTarget(w, service)
	if err != nil {
		return plan, fmt.Errorf("grouping target: %w", err)
	}
	if joined != "" {
		plan.Kind, plan.IncidentID = planJoin, joined
		return plan, nil
	}
	if plan.Snapshot, err = a.policySnapshotOf(w.Ctx, w.Tx, service.PolicyID); err != nil {
		return plan, fmt.Errorf("copy policy of %s: %w", service.Name, err)
	}
	if plan.Place, err = a.levels(w, plan.Snapshot).seek(1, 0); err != nil {
		return plan, fmt.Errorf("find who is on call: %w", err)
	}
	plan.Kind = planOpen
	if !plan.Place.Found {
		plan.Kind = planNobody
	}
	return plan, nil
}

// groupingTarget is the open incident a new alert on the service joins by its grouping mode, or "": the service's most
// recent incident, while it is open and, with a window, inside the window.
func (a *App) groupingTarget(w *Work, service serviceRow) (string, error) {
	if service.GroupingMode == "none" {
		return "", nil
	}
	var (
		id, status string
		windowEnds *time.Time
	)
	err := w.Tx.QueryRow(w.Ctx, `select id, status, window_ends_at from incidents where service_id = $1
		order by opened_at desc, number desc limit 1`, service.ID).Scan(&id, &status, &windowEnds)
	if isNoRows(err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("find latest incident of %s: %w", service.Name, err)
	}
	insideWindow := service.GroupingMode == "until_resolved" || (windowEnds != nil && !instantReached(w.Now, *windowEnds))
	if status == "resolved" || !insideWindow {
		return "", nil
	}
	return id, nil
}

// applyTrigger carries out a plan that opens, joins or counts an alert, and answers the incident it landed on.
func (a *App) applyTrigger(w *Work, alert newAlert, actor string, plan triggerPlan) (incidentRow, error) {
	switch plan.Kind {
	case planRepeat:
		inc, err := a.repeatAlert(w, alert, actor, plan)
		if err != nil {
			return inc, fmt.Errorf("count repeat alert: %w", err)
		}
		return inc, nil
	case planJoin:
		inc, err := a.joinAlert(w, alert, actor, plan.IncidentID)
		if err != nil {
			return inc, fmt.Errorf("join alert: %w", err)
		}
		return inc, nil
	}
	inc, err := a.insertIncident(w, newIncident{Service: plan.Service, Snapshot: plan.Snapshot, Place: plan.Place,
		Title: alert.Summary, Urgency: urgencyOf(alert.Severity), Actor: actor})
	if err != nil {
		return inc, fmt.Errorf("open incident: %w", err)
	}
	if err := w.insertAlert(inc.ID, alert); err != nil {
		return inc, fmt.Errorf("insert alert: %w", err)
	}
	if err := a.announceOpened(w, &inc, actor); err != nil {
		return inc, fmt.Errorf("announce opened incident: %w", err)
	}
	return inc, nil
}

// repeatAlert counts another trigger on an open alert; nothing is sent.
func (a *App) repeatAlert(w *Work, alert newAlert, actor string, plan triggerPlan) (incidentRow, error) {
	incidentID := plan.IncidentID
	_, err := w.Tx.Exec(w.Ctx, `update alerts set event_count = event_count + 1 where id = $1`, plan.AlertID)
	if err != nil {
		return incidentRow{}, fmt.Errorf("count event on alert %s: %w", alert.DedupKey, err)
	}
	if _, err := w.addTimeline(incidentID, "repeat_event", actor, "Repeat event on "+alert.DedupKey, nil); err != nil {
		return incidentRow{}, fmt.Errorf("add timeline: %w", err)
	}
	if err := w.touchIncident(incidentID); err != nil {
		return incidentRow{}, fmt.Errorf("touch incident: %w", err)
	}
	if err := w.publishIncident(incidentID, ""); err != nil {
		return incidentRow{}, fmt.Errorf("publish incident: %w", err)
	}
	inc, err := loadIncident(w.Ctx, w.Tx, incidentID)
	if err != nil {
		return incidentRow{}, fmt.Errorf("load incident: %w", err)
	}
	return inc, nil
}

// joinAlert adds an alert to a grouped incident. Joining changes nothing else, except that a more severe alert raises
// the urgency.
func (a *App) joinAlert(w *Work, alert newAlert, actor, incidentID string) (incidentRow, error) {
	inc, err := loadIncident(w.Ctx, w.Tx, incidentID)
	if err != nil {
		return inc, fmt.Errorf("load incident: %w", err)
	}
	if err := w.insertAlert(incidentID, alert); err != nil {
		return inc, fmt.Errorf("insert alert: %w", err)
	}
	raised, err := a.raiseUrgency(w, &inc, urgencyOf(alert.Severity), actor)
	if err != nil {
		return inc, fmt.Errorf("raise urgency of incident #%d: %w", inc.Number, err)
	}
	if raised {
		return inc, nil
	}
	if err := w.touchIncident(incidentID); err != nil {
		return inc, fmt.Errorf("touch incident: %w", err)
	}
	w.statusChanged()
	if err := w.publishIncident(incidentID, ""); err != nil {
		return inc, fmt.Errorf("publish incident: %w", err)
	}
	return inc, nil
}

// applyMonitoringEvent applies one accepted event inside the caller's work and answers what the event log records.
func (a *App) applyMonitoringEvent(w *Work, ev monitoringEvent) (eventOutcome, error) {
	var outcome eventOutcome
	var err error
	switch ev.Action {
	case "trigger":
		outcome, err = a.applyTriggerEvent(w, ev)
	case "acknowledge":
		outcome, err = a.applyAcknowledgeEvent(w, ev)
	default:
		outcome, err = a.applyResolveEvent(w, ev)
	}
	if err != nil {
		return outcome, fmt.Errorf("apply %s event: %w", ev.Action, err)
	}
	return outcome, nil
}

func (a *App) applyTriggerEvent(w *Work, ev monitoringEvent) (eventOutcome, error) {
	alert := newAlert{RoutingKey: &ev.RoutingKey, DedupKey: ev.DedupKey, Summary: ev.Summary, Source: ev.Source,
		Severity: ev.Severity, CustomDetails: ev.CustomDetails, ServiceID: ev.ServiceID}
	plan, err := a.planTrigger(w, alert)
	if err != nil {
		return eventOutcome{}, fmt.Errorf("plan trigger: %w", err)
	}
	switch plan.Kind {
	case planSuppressed:
		return eventOutcome{Outcome: outcomeSuppressed, Reason: reasonInMaintenance}, nil
	case planNobody:
		return eventOutcome{Outcome: outcomeDropped, Reason: reasonNobodyOnCall}, nil
	}
	inc, err := a.applyTrigger(w, alert, ev.IntegrationName, plan)
	if err != nil {
		return eventOutcome{}, fmt.Errorf("apply trigger: %w", err)
	}
	return eventOutcome{Outcome: outcomeApplied, IncidentNumber: &inc.Number}, nil
}

// eventAlert is the latest alert of an event's routing key and dedup key, with its incident.
type eventAlert struct {
	ID             string
	IncidentID     string
	Status         string
	Number         int
	IncidentStatus string
}

// locateAlert finds the alert an acknowledge or resolve event is about. When there is none to act on it answers the
// dropped outcome, with dropped true, instead.
func (a *App) locateAlert(w *Work, ev monitoringEvent) (alert eventAlert, drop eventOutcome, dropped bool, err error) {
	err = w.Tx.QueryRow(w.Ctx, `select a.id, a.incident_id, a.status, i.number, i.status from alerts a
		join incidents i on i.id = a.incident_id where a.routing_key = $1 and a.dedup_key = $2
		order by a.order_no desc limit 1`, ev.RoutingKey, ev.DedupKey).
		Scan(&alert.ID, &alert.IncidentID, &alert.Status, &alert.Number, &alert.IncidentStatus)
	if isNoRows(err) {
		var elsewhere bool
		err = w.Tx.QueryRow(w.Ctx, `select exists (select 1 from alerts where routing_key <> $1 and dedup_key = $2
			and status <> 'resolved')`, ev.RoutingKey, ev.DedupKey).Scan(&elsewhere)
		if err != nil {
			return alert, drop, false, fmt.Errorf("look for dedup key %s under other integrations: %w", ev.DedupKey, err)
		}
		reason := reasonNoAlert
		if elsewhere {
			reason = reasonOtherIntegration
		}
		return alert, eventOutcome{Outcome: outcomeDropped, Reason: reason}, true, nil
	}
	if err != nil {
		return alert, drop, false, fmt.Errorf("find alert %s: %w", ev.DedupKey, err)
	}
	if alert.Status == "resolved" {
		return alert, eventOutcome{Outcome: outcomeDropped, Reason: reasonAlertResolved, IncidentNumber: &alert.Number}, true, nil
	}
	return alert, drop, false, nil
}

func (a *App) applyAcknowledgeEvent(w *Work, ev monitoringEvent) (eventOutcome, error) {
	alert, drop, dropped, err := a.locateAlert(w, ev)
	if err != nil {
		return eventOutcome{}, fmt.Errorf("locate alert %s: %w", ev.DedupKey, err)
	}
	if dropped {
		return drop, nil
	}
	if !acknowledgeEventApplies(alert.IncidentStatus) {
		return eventOutcome{Outcome: outcomeDropped, Reason: reasonAlertAcknowledge, IncidentNumber: &alert.Number}, nil
	}
	if err := a.acknowledgeIncident(w, alert.IncidentID, actorRef{Name: ev.IntegrationName}); err != nil {
		return eventOutcome{}, fmt.Errorf("acknowledge from event: %w", err)
	}
	if _, err := w.Tx.Exec(w.Ctx, `update alerts set status = 'acknowledged' where id = $1`, alert.ID); err != nil {
		return eventOutcome{}, fmt.Errorf("acknowledge alert %s: %w", ev.DedupKey, err)
	}
	return eventOutcome{Outcome: outcomeApplied, IncidentNumber: &alert.Number}, nil
}

func (a *App) applyResolveEvent(w *Work, ev monitoringEvent) (eventOutcome, error) {
	alert, drop, dropped, err := a.locateAlert(w, ev)
	if err != nil {
		return eventOutcome{}, fmt.Errorf("locate alert %s: %w", ev.DedupKey, err)
	}
	if dropped {
		return drop, nil
	}
	var stillOpen int
	err = w.Tx.QueryRow(w.Ctx, `select count(*) from alerts where incident_id = $1 and status <> 'resolved' and id <> $2`,
		alert.IncidentID, alert.ID).Scan(&stillOpen)
	if err != nil {
		return eventOutcome{}, fmt.Errorf("count open alerts of incident %s: %w", alert.IncidentID, err)
	}
	applied := eventOutcome{Outcome: outcomeApplied, IncidentNumber: &alert.Number}
	if stillOpen == 0 {
		if err := a.resolveIncident(w, alert.IncidentID, actorRef{Name: ev.IntegrationName}); err != nil {
			return applied, fmt.Errorf("resolve incident: %w", err)
		}
		return applied, nil
	}
	_, err = w.Tx.Exec(w.Ctx, `update alerts set status = 'resolved', resolved_at = $2 where id = $1`, alert.ID, w.Now)
	if err != nil {
		return eventOutcome{}, fmt.Errorf("resolve alert %s: %w", ev.DedupKey, err)
	}
	// window_ends_at > now is the SQL form of the edge rule (edge.go): a window that has not yet ended is ended now.
	_, err = w.Tx.Exec(w.Ctx, `update incidents set window_ends_at = $2 where id = $1 and window_ends_at > $2`, alert.IncidentID, w.Now)
	if err != nil {
		return eventOutcome{}, fmt.Errorf("end grouping window of incident %s: %w", alert.IncidentID, err)
	}
	if err := w.touchIncident(alert.IncidentID); err != nil {
		return eventOutcome{}, fmt.Errorf("touch incident: %w", err)
	}
	w.statusChanged()
	if err := w.publishIncident(alert.IncidentID, ""); err != nil {
		return applied, fmt.Errorf("publish incident: %w", err)
	}
	return applied, nil
}

// drillRequest is the body of a drill.
type drillRequest struct {
	ServiceID string `json:"service_id"`
	Summary   string `json:"summary"`
	Severity  string `json:"severity"`
	DedupKey  string `json:"dedup_key"`
}

var severities = []string{"critical", "error", "warning", "info"}

// problems lists the field errors of a drill, with the intake sentences.
func (d drillRequest) problems(serviceKnown bool) map[string]string {
	problems := map[string]string{}
	switch {
	case strings.TrimSpace(d.Summary) == "":
		problems["summary"] = "Summary is required."
	case utf8.RuneCountInString(d.Summary) > 1024:
		problems["summary"] = "Summary is longer than 1024 characters."
	}
	if !slices.Contains(severities, d.Severity) {
		problems["severity"] = "Severity must be critical, error, warning or info."
	}
	if !serviceKnown {
		problems["service_id"] = "Choose a service."
	}
	if utf8.RuneCountInString(d.DedupKey) > 255 {
		problems["dedup_key"] = "Dedup key must be 1 to 255 characters."
	}
	return problems
}

// openDrill opens a real alert on a service for the admin who asked, following the rules of a trigger. State conflicts
// answer before field errors.
func (a *App) openDrill(w *Work, req drillRequest, actor string) (string, error) {
	service, err := loadService(w.Ctx, w.Tx, req.ServiceID)
	if err != nil && !isNoRows(err) {
		return "", fmt.Errorf("read service: %w", err)
	}
	known := err == nil
	if req.DedupKey == "" {
		req.DedupKey = newID()
	}
	alert := newAlert{DedupKey: req.DedupKey, Summary: req.Summary, Source: "drill", Severity: req.Severity, ServiceID: service.ID}
	var plan triggerPlan
	if known {
		if plan, err = a.planTrigger(w, alert); err != nil {
			return "", fmt.Errorf("plan trigger: %w", err)
		}
		switch plan.Kind {
		case planSuppressed:
			return "", errConflict("in_maintenance")
		case planNobody:
			return "", errConflict("nobody_on_call")
		}
	}
	if problems := req.problems(known); len(problems) > 0 {
		return "", errFields(problems)
	}
	inc, err := a.applyTrigger(w, alert, actor, plan)
	if err != nil {
		return "", fmt.Errorf("apply drill: %w", err)
	}
	return inc.ID, nil
}

func (a *App) hDrill(rq *Req) error {
	var req drillRequest
	if err := rq.Decode(&req); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	var incidentID string
	err := a.Do(rq.Ctx(), func(w *Work) error {
		var err error
		incidentID, err = a.openDrill(w, req, rq.Actor.Name)
		if err != nil {
			return fmt.Errorf("open drill on %s: %w", req.ServiceID, err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("open drill: %w", err)
	}
	view, _, err := a.incidentJSON(rq.Ctx(), a.db, incidentID, rq.viewerZone())
	if err != nil {
		return fmt.Errorf("read incident %s: %w", incidentID, err)
	}
	return rq.JSON(http.StatusCreated, view)
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "POST /api/operator/drill", Access: accAdmin, Handler: a.hDrill})
	})
}
