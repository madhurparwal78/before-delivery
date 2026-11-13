package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"switchlamp/internal/domain"
	"switchlamp/internal/store"
)

// Reassign moves an incident to a person or a service.
func (e *Engine) Reassign(ctx context.Context, id, actorName string, personID, serviceID *string) (*domain.Incident, error) {
	now := e.Now()
	if err := e.ApplyDue(ctx, now); err != nil {
		return nil, err
	}
	inc, err := e.Store.Incident(ctx, id)
	if err != nil {
		return nil, err
	}
	if inc.Status == domain.StatusResolved {
		c, _ := e.resolvedDecision(ctx, inc)
		return nil, c
	}
	names, err := e.Store.UserNames(ctx)
	if err != nil {
		return nil, err
	}
	var newHolders []domain.Holder
	targetService := inc.ServiceID
	if personID != nil {
		if len(inc.Holders) == 1 && inc.Holders[0].ID == *personID {
			return nil, errPersonHolds
		}
		newHolders = []domain.Holder{{ID: *personID, Name: names[*personID]}}
	}
	if serviceID != nil {
		if *serviceID == inc.ServiceID {
			return nil, errSameService
		}
		targetService = *serviceID
	}
	var newPolicy *domain.PolicySnapshot
	if serviceID != nil {
		sv, err := e.Store.Service(ctx, *serviceID)
		if err != nil {
			return nil, err
		}
		snap, err := e.policySnapshot(ctx, sv)
		if err != nil {
			return nil, err
		}
		newPolicy = &snap
		if personID == nil {
			// Holders follow the new service's policy as it stands then.
			holders, _, err := e.levelHolders(ctx, snap.Levels[0], now)
			if err != nil {
				return nil, err
			}
			newHolders = holders
		}
	}
	// Build the update.
	impacted := inc.ImpactedServices
	if serviceID != nil {
		found := false
		for _, s := range impacted {
			if s.ID == inc.ServiceID {
				found = true
			}
		}
		if !found {
			impacted = append(impacted, inc.Service)
		}
	}
	holdersJSON, _ := json.Marshal(newHolders)
	level, cycle := inc.Level, inc.Cycle
	escalationFinished := inc.EscalationFinished
	var escalateAt *time.Time
	if serviceID != nil {
		level, cycle = 1, 0
		escalationFinished = false
		t := now.Add(time.Duration(e.timeoutOf(newPolicy, 1)) * time.Minute)
		escalateAt = &t
	} else if !escalationFinished {
		t := now.Add(time.Duration(e.levelTimeout(inc, level)) * time.Minute)
		escalateAt = &t
	}
	// Cancel any snooze and acknowledge deadline; status becomes triggered.
	if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET status = 'triggered', holders = $2, level = $3, cycle = $4,
		policy_snapshot = coalesce($5, policy_snapshot), escalate_at = $6, escalation_finished = $7,
		snoozed_until = NULL, snoozed_by = NULL, ack_deadline = NULL, impacted_services = $8,
		service_id = $9, version = version + 1 WHERE id = $1`,
		inc.ID, holdersJSON, level, cycle, policyJSON(newPolicy), escalateAt, escalationFinished, mustJSON(impacted), targetService); err != nil {
		return nil, err
	}
	// Auto-resolve stays unchanged unless a snooze was cancelled.
	wasSnoozed := inc.Status == domain.StatusSnoozed
	if wasSnoozed && inc.AutoResolveAt != nil {
		sv, serr := e.Store.Service(ctx, inc.ServiceID)
		if serr == nil && sv.AutoResolveMinutes != nil {
			ar := now.Add(time.Duration(*sv.AutoResolveMinutes) * time.Minute)
			if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET auto_resolve_at = $2 WHERE id = $1`, inc.ID, ar); err != nil {
				return nil, err
			}
		}
	}
	out, err := e.Store.Incident(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := e.writeTimeline(ctx, out, now, domain.KindReassigned, actorName,
		domain.TimelineText(domain.KindReassigned, out, domain.HolderNames(out.Holders), actorName)); err != nil {
		return nil, err
	}
	if err := e.cancelSteps(ctx, inc.ID); err != nil {
		return nil, err
	}
	if err := e.notifyHolders(ctx, out, now); err != nil {
		return nil, err
	}
	if err := e.sendWebhook(ctx, out, "incident.reassigned", now); err != nil {
		return nil, err
	}
	e.emit(ctx, out)
	return e.Store.Incident(ctx, id)
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

func policyJSON(p *domain.PolicySnapshot) []byte {
	if p == nil {
		return nil
	}
	return mustJSON(p)
}

var (
	errPersonHolds = errors.New("This person already holds the incident.")
	errSameService = errors.New("The incident is already on this service.")
)

func (e *Engine) timeoutOf(p *domain.PolicySnapshot, level int) int {
	if p == nil || level > len(p.Levels) {
		return 30
	}
	t := p.Levels[level-1].TimeoutMinutes
	if t <= 0 {
		return 30
	}
	return t
}

// policySnapshot copies a service's policy as it stands now.
func (e *Engine) policySnapshot(ctx context.Context, sv *store.ServiceRecord) (domain.PolicySnapshot, error) {
	if sv.PolicyID == nil {
		return domain.PolicySnapshot{Name: "No policy", Version: 1, Repeats: 0}, nil
	}
	p, err := e.Store.Policy(ctx, *sv.PolicyID)
	if err != nil {
		return domain.PolicySnapshot{Name: "No policy", Version: 1, Repeats: 0}, nil
	}
	return domain.PolicySnapshot{Name: p.Name, Version: p.Version, Repeats: p.Repeats, Levels: p.Levels}, nil
}


// Merge moves source incidents into a target.
func (e *Engine) Merge(ctx context.Context, targetID string, sourceIDs []string, actorName string) (*domain.Incident, error) {
	now := e.Now()
	if err := e.ApplyDue(ctx, now); err != nil {
		return nil, err
	}
	target, err := e.Store.Incident(ctx, targetID)
	if err != nil {
		return nil, err
	}
	if target.Status == domain.StatusResolved {
		return nil, errMergeTargetResolved
	}
	var sources []*domain.Incident
	var sourceNumbers []int64
	for _, sid := range sourceIDs {
		if sid == targetID {
			return nil, errMergeIntoSelf
		}
		src, err := e.Store.Incident(ctx, sid)
		if err != nil {
			return nil, err
		}
		if src.Status == domain.StatusResolved {
			return nil, &MergeSourceResolvedError{Number: src.Number}
		}
		sources = append(sources, src)
		sourceNumbers = append(sourceNumbers, src.Number)
	}
	// A combined total over 1000 alerts blocks the merge.
	total := len(target.Alerts)
	for _, s := range sources {
		total += len(s.Alerts)
	}
	if total > 1000 {
		return nil, errMergeTooMany
	}
	for i, src := range sources {
		// Sources resolve with resolve_reason Merged and merged_into set.
		if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET status = 'resolved', resolve_reason = 'Merged',
			merged_into = $2, closed_at = $3, snoozed_until = NULL, ack_deadline = NULL, escalate_at = NULL,
			version = version + 1 WHERE id = $1`, src.ID, targetID, now); err != nil {
			return nil, err
		}
		// Alerts move with their keys unchanged.
		if _, err := e.Store.Pool().Exec(ctx, `UPDATE alerts SET incident_id = $2 WHERE incident_id = $1`, src.ID, targetID); err != nil {
			return nil, err
		}
		// The target's timeline shows the sources' entries with its own in time
		// order, each carrying from_number.
		for _, entry := range src.Timeline {
			num := sourceNumbers[i]
			if _, err := e.Store.Pool().Exec(ctx, `INSERT INTO timelines (id, incident_id, at, kind, actor, text, from_number)
				VALUES ($1,$2,$3,$4,$5,$6,$7)`, newID(), targetID, entry.At, entry.Kind, entry.Actor, entry.Text, num); err != nil {
				return nil, err
			}
		}
		srcAfter, err := e.Store.Incident(ctx, src.ID)
		if err != nil {
			return nil, err
		}
		srcAfter.SetMergeTarget(target.Number)
		if err := e.writeTimeline(ctx, srcAfter, now, domain.KindMerged, actorName,
			domain.TimelineText(domain.KindMerged, srcAfter, actorName)); err != nil {
			return nil, err
		}
		// Source timers stop and unsent source steps are cancelled.
		if err := e.cancelSteps(ctx, src.ID); err != nil {
			return nil, err
		}
		if err := e.sendWebhook(ctx, srcAfter, "incident.merged", now); err != nil {
			return nil, err
		}
		e.emit(ctx, srcAfter)
	}
	out, err := e.Store.Incident(ctx, targetID)
	if err != nil {
		return nil, err
	}
	e.emit(ctx, out)
	return out, nil
}

// MergeSourceResolvedError names the resolved source.
type MergeSourceResolvedError struct{ Number int64 }

func (m *MergeSourceResolvedError) Error() string {
	return fmt.Sprintf("source %d resolved", m.Number)
}

var (
	errMergeTargetResolved = errors.New("merge target resolved")
	errMergeIntoSelf        = errors.New("An incident cannot merge into itself.")
	errMergeTooMany         = errors.New("An incident can hold at most 1000 alerts.")
)

// MergeErrors exposes the merge error values.
func MergeErrors() (targetResolved, intoSelf, tooMany error) {
	return errMergeTargetResolved, errMergeIntoSelf, errMergeTooMany
}

// Split moves one alert of a target into a new incident.
func (e *Engine) Split(ctx context.Context, incidentID, alertID, actorName string) (*domain.Incident, error) {
	now := e.Now()
	if err := e.ApplyDue(ctx, now); err != nil {
		return nil, err
	}
	inc, err := e.Store.Incident(ctx, incidentID)
	if err != nil {
		return nil, err
	}
	if inc.Status == domain.StatusResolved {
		c, _ := e.resolvedDecision(ctx, inc)
		return nil, c
	}
	var alert *domain.Alert
	for i := range inc.Alerts {
		if inc.Alerts[i].ID == alertID {
			alert = &inc.Alerts[i]
			break
		}
	}
	if alert == nil {
		return nil, errNotFound
	}
	// The source's last alert cannot be split.
	if len(inc.Alerts) == 1 {
		return nil, errLastAlert
	}
	// The new incident opens on that alert's service at its current policy.
	sv, err := e.Store.Service(ctx, inc.ServiceID)
	if err != nil {
		return nil, err
	}
	snap, err := e.policySnapshot(ctx, sv)
	if err != nil {
		return nil, err
	}
	number, err := e.Store.NextIncidentNumber(ctx)
	if err != nil {
		return nil, err
	}
	newIDv := newID()
	holders, empty, err := e.levelHolders(ctx, snap.Levels[0], now)
	if err != nil {
		return nil, err
	}
	holdersJSON, _ := json.Marshal(holders)
	escalateAt := now.Add(time.Duration(e.timeoutOf(&snap, 1)) * time.Minute)
	urgency := domain.UrgencyOf(alert.Severity)
	autoResolveAt := inc.AutoResolveAt
	if _, err := e.Store.Pool().Exec(ctx, `INSERT INTO incidents (id, number, title, service_id, status, urgency, level, cycle,
		policy_snapshot, holders, opened_at, escalate_at, auto_resolve_at, version)
		VALUES ($1,$2,$3,$4,'triggered',$5,1,0,$6,$7,$8,$9,1)`,
		newIDv, number, alert.Summary, inc.ServiceID, urgency, mustJSON(snap), holdersJSON, now, escalateAt, autoResolveAt); err != nil {
		return nil, err
	}
	if _, err := e.Store.Pool().Exec(ctx, `UPDATE alerts SET incident_id = $2 WHERE id = $1`, alert.ID, newIDv); err != nil {
		return nil, err
	}
	newInc, err := e.Store.Incident(ctx, newIDv)
	if err != nil {
		return nil, err
	}
	if err := e.writeTimeline(ctx, newInc, now, domain.KindTriggered, "Switchlamp",
		domain.TimelineText(domain.KindTriggered, newInc)); err != nil {
		return nil, err
	}
	if !empty {
		if err := e.notifyHolders(ctx, newInc, now); err != nil {
			return nil, err
		}
	}
	// One split entry on the source.
	srcAfter, err := e.Store.Incident(ctx, incidentID)
	if err != nil {
		return nil, err
	}
	srcAfter.SetMergeTarget(number)
	if _, err := e.Store.Pool().Exec(ctx, `INSERT INTO timelines (id, incident_id, at, kind, actor, text)
		VALUES ($1,$2,$3,$4,$5,$6)`, newID(), incidentID, now, domain.KindSplit, actorName,
		fmt.Sprintf("Alert %s split into incident #%d by %s", alert.DedupKey, number, actorName)); err != nil {
		return nil, err
	}
	e.emit(ctx, newInc)
	e.emit(ctx, srcAfter)
	return newInc, nil
}

var (
	errNotFound  = errors.New("not found")
	errLastAlert = errors.New("last alert")
)

// SplitErrors exposes the split error values.
func SplitErrors() (lastAlert error) { return errLastAlert }

// Note adds a note to an incident's timeline.
func (e *Engine) Note(ctx context.Context, incidentID, personID, personName, body string) (*domain.Incident, error) {
	now := e.Now()
	if err := e.ApplyDue(ctx, now); err != nil {
		return nil, err
	}
	inc, err := e.Store.Incident(ctx, incidentID)
	if err != nil {
		return nil, err
	}
	if err := e.writeTimeline(ctx, inc, now, domain.KindNote, personName, body); err != nil {
		return nil, err
	}
	// Add note clears the draft everywhere.
	if _, err := e.Store.Pool().Exec(ctx, `DELETE FROM note_drafts WHERE incident_id = $1`, incidentID); err != nil {
		return nil, err
	}
	e.emit(ctx, inc)
	return e.Store.Incident(ctx, incidentID)
}

// RequestResponder asks a colleague to join.
func (e *Engine) RequestResponder(ctx context.Context, incidentID, personID, byName string) (string, error) {
	now := e.Now()
	if err := e.ApplyDue(ctx, now); err != nil {
		return "", err
	}
	inc, err := e.Store.Incident(ctx, incidentID)
	if err != nil {
		return "", err
	}
	if inc.Status == domain.StatusResolved {
		return "", errResolved
	}
	for _, r := range inc.Responders {
		if r.ID == personID {
			return "", errAlreadyResponding
		}
	}
	for _, r := range inc.ResponderRequests {
		if r.State == "requested" && r.Person == personID {
			return "", errAlreadyResponding
		}
	}
	reqID := newID()
	if _, err := e.Store.Pool().Exec(ctx, `INSERT INTO responder_requests (id, incident_id, person_id, state)
		VALUES ($1,$2,$3,'requested')`, reqID, incidentID, personID); err != nil {
		return "", err
	}
	asked, err := e.Store.User(ctx, personID)
	if err != nil {
		return "", err
	}
	incAfter, err := e.Store.Incident(ctx, incidentID)
	if err != nil {
		return "", err
	}
	if err := e.writeTimeline(ctx, incAfter, now, domain.KindResponderRequested, byName,
		domain.TimelineText(domain.KindResponderRequested, incAfter, byName, asked.Name)); err != nil {
		return "", err
	}
	// The notification reaches that person through an in-app step.
	if err := e.insertStep(ctx, incAfter, domain.Holder{ID: personID, Name: asked.Name}, "step", "in_app", now, domain.StepSent, &now); err != nil {
		return "", err
	}
	e.emit(ctx, incAfter)
	return reqID, nil
}

// AnswerResponder records an accept or decline.
func (e *Engine) AnswerResponder(ctx context.Context, requestID string, accept bool) (string, error) {
	now := e.Now()
	if err := e.ApplyDue(ctx, now); err != nil {
		return "", err
	}
	var personID, incidentID, state string
	var answeredAt *time.Time
	if err := e.Store.Pool().QueryRow(ctx, `SELECT person_id, incident_id, state, answered_at
		FROM responder_requests WHERE id = $1`, requestID).Scan(&personID, &incidentID, &state, &answeredAt); err != nil {
		return "", err
	}
	if state != "requested" {
		return "", errAlreadyAnswered
	}
	newState := "declined"
	kind := domain.KindResponderDeclined
	if accept {
		newState = "accepted"
		kind = domain.KindResponderAccepted
	}
	if _, err := e.Store.Pool().Exec(ctx, `UPDATE responder_requests SET state = $2, answered_at = $3 WHERE id = $1`,
		requestID, newState, now); err != nil {
		return "", err
	}
	if accept {
		inc, err := e.Store.Incident(ctx, incidentID)
		if err != nil {
			return "", err
		}
		u, err := e.Store.User(ctx, personID)
		if err != nil {
			return "", err
		}
		resp := inc.Responders
		resp = append(resp, domain.Holder{ID: personID, Name: u.Name})
		if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET responders = $2, version = version + 3 WHERE id = $1`,
			incidentID, mustJSON(resp)); err != nil {
			return "", err
		}
	}
	incAfter, err := e.Store.Incident(ctx, incidentID)
	if err != nil {
		return "", err
	}
	u, err := e.Store.User(ctx, personID)
	if err != nil {
		return "", err
	}
	if err := e.writeTimeline(ctx, incAfter, now, kind, u.Name,
		domain.TimelineText(kind, incAfter, u.Name)); err != nil {
		return "", err
	}
	e.emit(ctx, incAfter)
	return newState, nil
}

var (
	errResolved           = errors.New("resolved")
	errAlreadyResponding  = errors.New("already responding")
	errAlreadyAnswered    = errors.New("already answered")
)

// ResponderErrors exposes the responder error values.
func ResponderErrors() (resolved, alreadyResponding, alreadyAnswered error) {
	return errResolved, errAlreadyResponding, errAlreadyAnswered
}
