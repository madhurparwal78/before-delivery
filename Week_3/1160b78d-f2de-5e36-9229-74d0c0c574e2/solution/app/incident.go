package main

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// serviceRef is a service in an incident's published record.
type serviceRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// incidentRow is one incident as stored, with the name of its service.
type incidentRow struct {
	ID                 string
	Number             int
	ServiceID          string
	ServiceName        string
	Title              string
	Status             string
	Urgency            string
	Holders            []string
	Level              int
	Cycle              int
	EscalationFinished bool
	PolicyHeld         bool
	Snapshot           policySnapshot
	OpenedAt           time.Time
	SnoozedUntil       *time.Time
	SnoozedBy          *string
	AckDeadline        *time.Time
	AutoResolveMinutes *int
	AutoResolveAt      *time.Time
	ResolveReason      *string
	MergedInto         *int
	ResolvedAt         *time.Time
	DecidedBy          *string
	DecidedAt          *time.Time
	WindowEndsAt       *time.Time
	EscalationDueAt    *time.Time
	ImpactedServices   []string
	Assignment         int
	Version            int
}

const incidentSelect = `select i.id, i.number, i.service_id, s.name, i.title, i.status, i.urgency, i.holders, i.level, i.cycle,
		i.escalation_finished, i.policy_held, i.policy_snapshot, i.opened_at, i.snoozed_until, i.snoozed_by, i.ack_deadline,
		i.auto_resolve_minutes, i.auto_resolve_at, i.resolve_reason, i.merged_into, i.resolved_at, i.decided_by, i.decided_at,
		i.window_ends_at, i.escalation_due_at, i.impacted_services, i.assignment, i.version
	from incidents i join services s on s.id = i.service_id`

func loadIncident(ctx context.Context, q dbq, id string) (incidentRow, error) {
	var i incidentRow
	err := q.QueryRow(ctx, incidentSelect+` where i.id = $1`, id).
		Scan(&i.ID, &i.Number, &i.ServiceID, &i.ServiceName, &i.Title, &i.Status, &i.Urgency, &i.Holders, &i.Level,
			&i.Cycle, &i.EscalationFinished, &i.PolicyHeld, &i.Snapshot, &i.OpenedAt, &i.SnoozedUntil, &i.SnoozedBy, &i.AckDeadline,
			&i.AutoResolveMinutes, &i.AutoResolveAt, &i.ResolveReason, &i.MergedInto, &i.ResolvedAt, &i.DecidedBy,
			&i.DecidedAt, &i.WindowEndsAt, &i.EscalationDueAt, &i.ImpactedServices, &i.Assignment, &i.Version)
	if err != nil {
		return i, fmt.Errorf("read incident %s: %w", id, err)
	}
	return i, nil
}

// countdownView is the countdown of an incident.
type countdownView struct {
	Kind             string  `json:"kind"`
	DueAt            *string `json:"due_at"`
	RemainingSeconds int64   `json:"remaining_seconds"`
}

// countdown picks the timer the incident page shows: the first line of the brief's countdown order that applies.
func (i *incidentRow) countdown(now time.Time) countdownView {
	kind, due := "none", (*time.Time)(nil)
	switch {
	case i.Status == "snoozed":
		kind, due = "snooze", i.SnoozedUntil
	case i.Status == "acknowledged" && i.AckDeadline != nil:
		kind, due = "ack_timeout", i.AckDeadline
	case i.Status == "triggered" && i.Urgency == "high" && i.EscalationDueAt != nil:
		kind, due = "escalation", i.EscalationDueAt
	case i.Status != "resolved" && i.AutoResolveAt != nil:
		kind, due = "auto_resolve", i.AutoResolveAt
	}
	view := countdownView{Kind: kind, DueAt: optionalInstant(due)}
	if due != nil && !instantReached(now, *due) {
		view.RemainingSeconds = int64(due.Sub(now) / time.Second)
	}
	return view
}

// holdersText is the holder names joined by ", ", or Nobody.
func holdersText(holders []personRef) string {
	if len(holders) == 0 {
		return "Nobody"
	}
	names := make([]string, len(holders))
	for n, h := range holders {
		names[n] = h.Name
	}
	return strings.Join(names, ", ")
}

// personIDs lists the ids of people.
func personIDs(people []personRef) []string {
	ids := make([]string, len(people))
	for n, p := range people {
		ids[n] = p.ID
	}
	return ids
}

// personRefs reads people by id, in the order given.
func personRefs(ctx context.Context, q dbq, ids []string) ([]personRef, error) {
	rows, err := q.Query(ctx, `select u.id, u.name from unnest($1::text[]) with ordinality as t(id, n)
		join users u on u.id = t.id order by t.n`, ids)
	if err != nil {
		return nil, fmt.Errorf("read people: %w", err)
	}
	defer rows.Close()
	people := []personRef{}
	for rows.Next() {
		var p personRef
		if err := rows.Scan(&p.ID, &p.Name); err != nil {
			return nil, fmt.Errorf("scan person: %w", err)
		}
		people = append(people, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read people: %w", err)
	}
	return people, nil
}

func serviceRefs(ctx context.Context, q dbq, ids []string) ([]serviceRef, error) {
	rows, err := q.Query(ctx, `select s.id, s.name from unnest($1::text[]) with ordinality as t(id, n)
		join services s on s.id = t.id order by t.n`, ids)
	if err != nil {
		return nil, fmt.Errorf("read services: %w", err)
	}
	defer rows.Close()
	services := []serviceRef{}
	for rows.Next() {
		var s serviceRef
		if err := rows.Scan(&s.ID, &s.Name); err != nil {
			return nil, fmt.Errorf("scan service: %w", err)
		}
		services = append(services, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read services: %w", err)
	}
	return services, nil
}

type alertView struct {
	ID         string  `json:"id"`
	RoutingKey *string `json:"routing_key"`
	DedupKey   string  `json:"dedup_key"`
	Status     string  `json:"status"`
	Summary    string  `json:"summary"`
	Source     string  `json:"source"`
	Severity   string  `json:"severity"`
	EventCount int     `json:"event_count"`
}

func alertViews(ctx context.Context, q dbq, incidentID string) ([]alertView, error) {
	rows, err := q.Query(ctx, `select id, routing_key, dedup_key, status, summary, source, severity, event_count
		from alerts where incident_id = $1 order by order_no`, incidentID)
	if err != nil {
		return nil, fmt.Errorf("list alerts of incident %s: %w", incidentID, err)
	}
	defer rows.Close()
	alerts := []alertView{}
	for rows.Next() {
		var a alertView
		if err := rows.Scan(&a.ID, &a.RoutingKey, &a.DedupKey, &a.Status, &a.Summary, &a.Source, &a.Severity, &a.EventCount); err != nil {
			return nil, fmt.Errorf("scan alert: %w", err)
		}
		alerts = append(alerts, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list alerts of incident %s: %w", incidentID, err)
	}
	return alerts, nil
}

type timelineView struct {
	ID         string `json:"id"`
	At         string `json:"at"`
	Kind       string `json:"kind"`
	Actor      string `json:"actor"`
	Text       string `json:"text"`
	FromNumber *int   `json:"from_number,omitempty"`
}

func timelineViews(ctx context.Context, q dbq, incidentID string) ([]timelineView, error) {
	rows, err := q.Query(ctx, `select id, at, kind, actor, text, from_number from timeline
		where incident_id = $1 order by at, id`, incidentID)
	if err != nil {
		return nil, fmt.Errorf("list timeline of incident %s: %w", incidentID, err)
	}
	defer rows.Close()
	entries := []timelineView{}
	for rows.Next() {
		var (
			e  timelineView
			id int64
			at time.Time
		)
		if err := rows.Scan(&id, &at, &e.Kind, &e.Actor, &e.Text, &e.FromNumber); err != nil {
			return nil, fmt.Errorf("scan timeline entry: %w", err)
		}
		e.ID, e.At = strconv.FormatInt(id, 10), formatInstant(at)
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list timeline of incident %s: %w", incidentID, err)
	}
	return entries, nil
}

type requestView struct {
	ID     string `json:"id"`
	Person string `json:"person"`
	State  string `json:"state"`
}

func requestViews(ctx context.Context, q dbq, incidentID string) ([]requestView, error) {
	rows, err := q.Query(ctx, `select r.id, u.name, r.state from responder_requests r join users u on u.id = r.person_id
		where r.incident_id = $1 order by r.created_at, r.id`, incidentID)
	if err != nil {
		return nil, fmt.Errorf("list responder requests of incident %s: %w", incidentID, err)
	}
	defer rows.Close()
	requests := []requestView{}
	for rows.Next() {
		var r requestView
		if err := rows.Scan(&r.ID, &r.Person, &r.State); err != nil {
			return nil, fmt.Errorf("scan responder request: %w", err)
		}
		requests = append(requests, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list responder requests of incident %s: %w", incidentID, err)
	}
	return requests, nil
}

func responderRefs(ctx context.Context, q dbq, incidentID string) ([]personRef, error) {
	rows, err := q.Query(ctx, `select u.id, u.name from incident_responders r join users u on u.id = r.user_id
		where r.incident_id = $1 order by r.joined_at, u.name`, incidentID)
	if err != nil {
		return nil, fmt.Errorf("list responders of incident %s: %w", incidentID, err)
	}
	defer rows.Close()
	people := []personRef{}
	for rows.Next() {
		var p personRef
		if err := rows.Scan(&p.ID, &p.Name); err != nil {
			return nil, fmt.Errorf("scan responder: %w", err)
		}
		people = append(people, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list responders of incident %s: %w", incidentID, err)
	}
	return people, nil
}

// incidentView is the published incident.
type incidentView struct {
	ID                string         `json:"id"`
	Number            int            `json:"number"`
	Title             string         `json:"title"`
	Service           serviceRef     `json:"service"`
	Status            string         `json:"status"`
	Urgency           string         `json:"urgency"`
	Holders           []personRef    `json:"holders"`
	Level             int            `json:"level"`
	Cycle             int            `json:"cycle"`
	PolicySnapshot    policySnapshot `json:"policy_snapshot"`
	ServerNow         string         `json:"server_now"`
	Countdown         countdownView  `json:"countdown"`
	AutoResolveAt     *string        `json:"auto_resolve_at"`
	SnoozedUntil      *string        `json:"snoozed_until"`
	ResolveReason     *string        `json:"resolve_reason"`
	MergedInto        *int           `json:"merged_into"`
	ImpactedServices  []serviceRef   `json:"impacted_services"`
	Responders        []personRef    `json:"responders"`
	ResponderRequests []requestView  `json:"responder_requests"`
	Alerts            []alertView    `json:"alerts"`
	Timeline          []timelineView `json:"timeline"`
	Steps             []stepView     `json:"steps"`
	OpenedAt          string         `json:"opened_at"`
	OpenedLocal       string         `json:"opened_local"`
	Version           int            `json:"version"`
}

// incidentJSON is the published incident with its ETag version, times in the viewer's zone.
func (a *App) incidentJSON(ctx context.Context, q dbq, id, viewerZone string) (view any, version int, err error) {
	inc, err := loadIncident(ctx, q, id)
	if err != nil {
		return nil, 0, fmt.Errorf("load incident: %w", err)
	}
	now := a.clock.Now()
	v := incidentView{
		ID: inc.ID, Number: inc.Number, Title: inc.Title, Service: serviceRef{ID: inc.ServiceID, Name: inc.ServiceName},
		Status: inc.Status, Urgency: inc.Urgency, Level: inc.Level, Cycle: inc.Cycle, PolicySnapshot: inc.Snapshot,
		ServerNow: formatInstant(now), Countdown: inc.countdown(now), AutoResolveAt: optionalInstant(inc.AutoResolveAt),
		SnoozedUntil: optionalInstant(inc.SnoozedUntil), ResolveReason: inc.ResolveReason, MergedInto: inc.MergedInto,
		OpenedAt: formatInstant(inc.OpenedAt), Version: inc.Version,
	}
	if v.OpenedLocal, err = localTime(inc.OpenedAt, viewerZone); err != nil {
		return nil, 0, fmt.Errorf("local time: %w", err)
	}
	if v.Holders, err = personRefs(ctx, q, inc.Holders); err != nil {
		return nil, 0, fmt.Errorf("person refs: %w", err)
	}
	if v.ImpactedServices, err = serviceRefs(ctx, q, inc.ImpactedServices); err != nil {
		return nil, 0, fmt.Errorf("service refs: %w", err)
	}
	if v.Responders, err = responderRefs(ctx, q, id); err != nil {
		return nil, 0, fmt.Errorf("responder refs: %w", err)
	}
	if v.ResponderRequests, err = requestViews(ctx, q, id); err != nil {
		return nil, 0, fmt.Errorf("request views: %w", err)
	}
	if v.Alerts, err = alertViews(ctx, q, id); err != nil {
		return nil, 0, fmt.Errorf("alert views: %w", err)
	}
	if v.Timeline, err = timelineViews(ctx, q, id); err != nil {
		return nil, 0, fmt.Errorf("timeline views: %w", err)
	}
	if v.Steps, err = a.stepViews(ctx, q, id, viewerZone); err != nil {
		return nil, 0, fmt.Errorf("list steps of incident %s: %w", id, err)
	}
	return v, inc.Version, nil
}

// listItem is an incident in a list and in the live "incident" message.
type listItem struct {
	ID          string        `json:"id"`
	Number      int           `json:"number"`
	Title       string        `json:"title"`
	Service     serviceRef    `json:"service"`
	Status      string        `json:"status"`
	Urgency     string        `json:"urgency"`
	Holders     []personRef   `json:"holders"`
	OpenedAt    string        `json:"opened_at"`
	OpenedLocal string        `json:"opened_local"`
	AlertCount  int           `json:"alert_count"`
	Countdown   countdownView `json:"countdown"`
}

// incidentListItem is the published list item, its countdown read at the server clock.
func (a *App) incidentListItem(ctx context.Context, q dbq, id, viewerZone string) (any, error) {
	item, err := a.listItemAt(ctx, q, id, viewerZone, a.clock.Now())
	if err != nil {
		return nil, fmt.Errorf("read list item of incident %s: %w", id, err)
	}
	return item, nil
}

func (a *App) listItemAt(ctx context.Context, q dbq, id, viewerZone string, now time.Time) (listItem, error) {
	inc, err := loadIncident(ctx, q, id)
	if err != nil {
		return listItem{}, fmt.Errorf("load incident: %w", err)
	}
	item := listItem{ID: inc.ID, Number: inc.Number, Title: inc.Title, Service: serviceRef{ID: inc.ServiceID, Name: inc.ServiceName},
		Status: inc.Status, Urgency: inc.Urgency, OpenedAt: formatInstant(inc.OpenedAt), Countdown: inc.countdown(now)}
	if item.OpenedLocal, err = localTime(inc.OpenedAt, viewerZone); err != nil {
		return item, fmt.Errorf("local time: %w", err)
	}
	if item.Holders, err = personRefs(ctx, q, inc.Holders); err != nil {
		return item, fmt.Errorf("person refs: %w", err)
	}
	err = q.QueryRow(ctx, `select count(*) from alerts where incident_id = $1`, id).Scan(&item.AlertCount)
	if err != nil {
		return item, fmt.Errorf("count alerts of incident %s: %w", id, err)
	}
	return item, nil
}

// publishIncident queues the "incident" live message; announce is the timeline text just written, or "".
func (w *Work) publishIncident(incidentID, announce string) error {
	item, err := w.A.listItemAt(w.Ctx, w.Tx, incidentID, firmZone, w.Now)
	if err != nil {
		return fmt.Errorf("render incident %s: %w", incidentID, err)
	}
	w.Publish("incident", map[string]any{"incident_id": incidentID, "announce": announce, "item": item})
	return nil
}

// statusChanged tells the status surfaces that an alert or an incident changed status, and drops the cached public status.
func (w *Work) statusChanged() {
	w.Publish("status", map[string]any{})
	w.After(w.A.clearStatusCache)
}

// addTimeline writes one timeline entry stamped w.Now.
func (w *Work) addTimeline(incidentID, kind, actor, text string, fromNumber *int) (int64, error) {
	var id int64
	err := w.Tx.QueryRow(w.Ctx, `insert into timeline (incident_id, at, kind, actor, text, from_number)
		values ($1, $2, $3, $4, $5, $6) returning id`, incidentID, w.Now, kind, actor, text, fromNumber).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("write %s entry on incident %s: %w", kind, incidentID, err)
	}
	return id, nil
}

// liveCountdown is the per-second message a page watching an incident receives.
type liveCountdown struct {
	countdownView
	Level   int      `json:"level"`
	Cycle   int      `json:"cycle"`
	Holders []string `json:"holders"`
	Status  string   `json:"status"`
}

func (a *App) incidentCountdown(ctx context.Context, id string) (any, error) {
	inc, err := loadIncident(ctx, a.db, id)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read incident for countdown: %w", err)
	}
	holders, err := personRefs(ctx, a.db, inc.Holders)
	if err != nil {
		return nil, fmt.Errorf("person refs: %w", err)
	}
	names := make([]string, len(holders))
	for n, h := range holders {
		names[n] = h.Name
	}
	return liveCountdown{countdownView: inc.countdown(a.clock.Now()), Level: inc.Level, Cycle: inc.Cycle, Holders: names,
		Status: inc.Status}, nil
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.hub.RegisterCountdown("incident", a.incidentCountdown)
	})
}
