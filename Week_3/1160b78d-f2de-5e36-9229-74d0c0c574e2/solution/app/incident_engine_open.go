package main

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"time"
)

// serviceRow is the part of a service the incident engine reads.
type serviceRow struct {
	ID                 string
	Name               string
	PolicyID           string
	GroupingMode       string
	GroupingMinutes    *int
	AckTimeoutMinutes  *int
	AutoResolveMinutes *int
}

func loadService(ctx context.Context, q dbq, id string) (serviceRow, error) {
	var s serviceRow
	err := q.QueryRow(ctx, `select id, name, policy_id, grouping_mode, grouping_minutes, ack_timeout_minutes, auto_resolve_minutes
		from services where id = $1`, id).
		Scan(&s.ID, &s.Name, &s.PolicyID, &s.GroupingMode, &s.GroupingMinutes, &s.AckTimeoutMinutes, &s.AutoResolveMinutes)
	if err != nil {
		return s, fmt.Errorf("read service %s: %w", id, err)
	}
	return s, nil
}

// nextPosition is where escalation goes when the level at (level, cycle) times out: the next level, else level 1 of the
// next cycle until the policy's repeats are used up, else nowhere.
func nextPosition(snapshot policySnapshot, level, cycle int) (nextLevel, nextCycle int, more bool) {
	switch {
	case level < len(snapshot.Levels):
		return level + 1, cycle, true
	case cycle < snapshot.Repeats:
		return 1, cycle + 1, true
	}
	return 0, 0, false
}

// levelHolders resolves the holders of a policy snapshot's levels at one instant.
type levelHolders struct {
	app      *App
	ctx      context.Context
	q        dbq
	snapshot policySnapshot
	at       time.Time
	memo     map[int][]personRef
}

func (a *App) levels(w *Work, snapshot policySnapshot) *levelHolders {
	return &levelHolders{app: a, ctx: w.Ctx, q: w.Tx, snapshot: snapshot, at: w.Now, memo: map[int][]personRef{}}
}

// of is the people holding a level (1-based): each person target, and whoever is on call for each schedule target.
func (l *levelHolders) of(level int) ([]personRef, error) {
	if holders, ok := l.memo[level]; ok {
		return holders, nil
	}
	holders := []personRef{}
	add := func(p personRef) {
		if !slices.ContainsFunc(holders, func(h personRef) bool { return h.ID == p.ID }) {
			holders = append(holders, p)
		}
	}
	for _, target := range l.snapshot.Levels[level-1].Targets {
		if target.Type == "person" {
			add(personRef{ID: target.ID, Name: target.Name})
			continue
		}
		holder, _, err := l.app.scheduleHolderAt(l.ctx, l.q, target.ID, l.at)
		if err != nil {
			return nil, fmt.Errorf("find who is on call on %s: %w", target.Name, err)
		}
		if holder != nil {
			add(*holder)
		}
	}
	l.memo[level] = holders
	return holders, nil
}

// placement is a position in a policy with the people holding it.
type placement struct {
	Level   int
	Cycle   int
	Holders []personRef
	Found   bool
}

// seek finds the first position at or after (level, cycle) whose level has somebody on call; a level with nobody is
// skipped in the same second.
func (l *levelHolders) seek(level, cycle int) (placement, error) {
	for {
		holders, err := l.of(level)
		if err != nil {
			return placement{}, fmt.Errorf("find holders of level %d: %w", level, err)
		}
		if len(holders) > 0 {
			return placement{Level: level, Cycle: cycle, Holders: holders, Found: true}, nil
		}
		var more bool
		if level, cycle, more = nextPosition(l.snapshot, level, cycle); !more {
			return placement{}, nil
		}
	}
}

// urgencyOf is the urgency a severity makes.
func urgencyOf(severity string) string {
	if severity == "critical" || severity == "error" {
		return "high"
	}
	return "low"
}

// newIncident is what opens an incident: the service, the policy copy, where escalation starts and the first alert.
type newIncident struct {
	Service  serviceRow
	Snapshot policySnapshot
	Place    placement
	Title    string
	Urgency  string
	Actor    string
}

// insertIncident writes a triggered incident at w.Now and arms its timers. It starts at the placement's level, or at
// level 1 with nobody when the policy has nobody on call.
func (a *App) insertIncident(w *Work, n newIncident) (incidentRow, error) {
	var number int
	if err := w.Tx.QueryRow(w.Ctx, `select nextval('incident_number_seq')`).Scan(&number); err != nil {
		return incidentRow{}, fmt.Errorf("number incident: %w", err)
	}
	inc := incidentRow{
		ID: newID(), Number: number, ServiceID: n.Service.ID, ServiceName: n.Service.Name, Title: n.Title, Status: "triggered",
		Urgency: n.Urgency, Holders: personIDs(n.Place.Holders), Level: 1, PolicyHeld: true, Snapshot: n.Snapshot, OpenedAt: w.Now,
		AutoResolveMinutes: n.Service.AutoResolveMinutes, ImpactedServices: []string{}, Assignment: 1, Version: 1,
	}
	if n.Place.Found {
		inc.Level = n.Place.Level
	}
	inc.armEscalation(w.Now)
	inc.restartAutoResolve(w.Now)
	if n.Service.GroupingMode == "window" && n.Service.GroupingMinutes != nil {
		end := w.Now.Add(time.Duration(*n.Service.GroupingMinutes) * time.Minute)
		inc.WindowEndsAt = &end
	}
	_, err := w.Tx.Exec(w.Ctx, `insert into incidents (id, number, service_id, title, status, urgency, holders, level, cycle,
			escalation_finished, policy_snapshot, opened_at, auto_resolve_minutes, auto_resolve_at, window_ends_at,
			escalation_due_at, impacted_services, assignment, version)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
		inc.ID, inc.Number, inc.ServiceID, inc.Title, inc.Status, inc.Urgency, inc.Holders, inc.Level, inc.Cycle,
		inc.EscalationFinished, inc.Snapshot, inc.OpenedAt, inc.AutoResolveMinutes, inc.AutoResolveAt, inc.WindowEndsAt,
		inc.EscalationDueAt, inc.ImpactedServices, inc.Assignment, inc.Version)
	if err != nil {
		return inc, fmt.Errorf("open incident #%d: %w", number, err)
	}
	if err := w.syncTimers(&inc); err != nil {
		return inc, fmt.Errorf("sync timers: %w", err)
	}
	return inc, nil
}

// announceOpened writes the triggered entry of an incident whose alerts are in place, notifies its holders and tells
// everyone who listens.
func (a *App) announceOpened(w *Work, inc *incidentRow, actor string) error {
	if err := a.notifyHolders(w, inc.ID, inc.Holders); err != nil {
		return fmt.Errorf("notify holders: %w", err)
	}
	text := fmt.Sprintf("Incident #%d triggered: %s", inc.Number, inc.Title)
	if err := w.report(inc, "triggered", actor, text, hookTriggered); err != nil {
		return fmt.Errorf("report triggered incident: %w", err)
	}
	return nil
}

// newAlert is an alert as an event or a drill brings it.
type newAlert struct {
	RoutingKey    *string
	DedupKey      string
	Summary       string
	Source        string
	Severity      string
	CustomDetails json.RawMessage
	ServiceID     string
}

func (w *Work) insertAlert(incidentID string, alert newAlert) error {
	details := alert.CustomDetails
	if len(details) == 0 {
		details = json.RawMessage("{}")
	}
	_, err := w.Tx.Exec(w.Ctx, `insert into alerts (id, incident_id, routing_key, dedup_key, status, summary, source, severity,
			custom_details, event_count, opened_at, service_id)
		values ($1, $2, $3, $4, 'triggered', $5, $6, $7, $8, 1, $9, $10)`,
		newID(), incidentID, alert.RoutingKey, alert.DedupKey, alert.Summary, alert.Source, alert.Severity, details, w.Now,
		alert.ServiceID)
	if err != nil {
		return fmt.Errorf("open alert %s: %w", alert.DedupKey, err)
	}
	return nil
}

// raiseUrgency lifts an incident to high urgency, never the other way. A triggered incident starts escalating at level 1
// with its holders' high-urgency steps from now and drops any low-urgency notice; an acknowledged or snoozed one only
// records the raise. It reports whether the urgency rose, in which case the change has been saved and announced.
func (a *App) raiseUrgency(w *Work, inc *incidentRow, to, actor string) (bool, error) {
	if inc.Urgency == "high" || to != "high" {
		return false, nil
	}
	inc.Urgency = "high"
	triggered := inc.Status == "triggered"
	if triggered {
		place, err := a.levels(w, inc.Snapshot).seek(1, 0)
		if err != nil {
			return false, fmt.Errorf("find who is on call: %w", err)
		}
		inc.Level, inc.Cycle, inc.EscalationFinished = 1, 0, false
		if place.Found {
			inc.Level = place.Level
		}
		if holders := personIDs(place.Holders); inc.PolicyHeld && !slices.Equal(holders, inc.Holders) {
			inc.Holders = holders
			inc.Assignment++
		}
		inc.armEscalation(w.Now)
	}
	if err := w.saveIncident(inc); err != nil {
		return false, fmt.Errorf("save incident: %w", err)
	}
	if triggered {
		if err := a.cancelPendingSteps(w, inc.ID, nil); err != nil {
			return false, fmt.Errorf("cancel pending steps: %w", err)
		}
		if err := a.notifyHolders(w, inc.ID, inc.Holders); err != nil {
			return false, fmt.Errorf("notify holders: %w", err)
		}
	}
	text := fmt.Sprintf("Incident #%d raised to high urgency", inc.Number)
	if err := w.report(inc, "urgency_raised", actor, text, ""); err != nil {
		return true, fmt.Errorf("report urgency raised: %w", err)
	}
	return true, nil
}
