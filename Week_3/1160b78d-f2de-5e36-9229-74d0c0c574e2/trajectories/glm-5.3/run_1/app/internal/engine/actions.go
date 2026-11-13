package engine

import (
	"context"
	"errors"
	"fmt"
	"time"

	"switchlamp/internal/domain"
)

// Decision names the winning decision on an incident.
type Decision struct {
	Kind      string
	By        string
	At        time.Time
}

// ConflictError reports that someone else decided first.
type ConflictError struct {
	Decision string `json:"decision"`
	By       string `json:"decided_by"`
	At       time.Time `json:"decided_at"`
}

func (c *ConflictError) Error() string {
	return fmt.Sprintf("already %s by %s", c.Decision, c.By)
}

// IllegalTransitionError is the published 409 for a bad transition.
type IllegalTransitionError struct{ Message string }

func (i *IllegalTransitionError) Error() string { return i.Message }

// resolvedDecision reads who decided a resolved incident.
func (e *Engine) resolvedDecision(ctx context.Context, inc *domain.Incident) (*ConflictError, error) {
	for i := len(inc.Timeline) - 1; i >= 0; i-- {
		if inc.Timeline[i].Kind == domain.KindResolved {
			return &ConflictError{Decision: "resolved", By: inc.Timeline[i].Actor, At: inc.Timeline[i].At}, nil
		}
		if inc.Timeline[i].Kind == domain.KindAutoResolved {
			return &ConflictError{Decision: "resolved", By: "Switchlamp", At: inc.Timeline[i].At}, nil
		}
		if inc.Timeline[i].Kind == domain.KindMerged {
			return &ConflictError{Decision: "resolved", By: inc.Timeline[i].Actor, At: inc.Timeline[i].At}, nil
		}
	}
	return &ConflictError{Decision: "resolved", By: "Switchlamp", At: time.Time{}}, nil
}

// Acknowledge applies the acknowledge action.
func (e *Engine) Acknowledge(ctx context.Context, id, actorID, actorName string) (*domain.Incident, error) {
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
	// Snoozed: only someone other than the snoozer can acknowledge.
	if inc.Status == domain.StatusSnoozed {
		if inc.SnoozedBy != nil && *inc.SnoozedBy == actorID {
			// The snoozer's own acknowledge is refused as decided by themselves.
			return nil, &ConflictError{Decision: "snoozed", By: actorName, At: *inc.SnoozedUntil}
		}
		if err := e.endSnoozeByAck(ctx, inc, now, actorName); err != nil {
			return nil, err
		}
		return inc, nil
	}
	if inc.Status != domain.StatusTriggered {
		return nil, &ConflictError{Decision: "acknowledged", By: e.lastAckBy(inc), At: time.Time{}}
	}
	if err := e.doAcknowledge(ctx, inc, now, actorName); err != nil {
		return nil, err
	}
	return e.Store.Incident(ctx, id)
}

func (e *Engine) lastAckBy(inc *domain.Incident) string {
	for i := len(inc.Timeline) - 1; i >= 0; i-- {
		if inc.Timeline[i].Kind == domain.KindAcknowledged {
			return inc.Timeline[i].Actor
		}
	}
	return "Switchlamp"
}

// endSnoozeByAck ends a snooze with another person's acknowledge.
func (e *Engine) endSnoozeByAck(ctx context.Context, inc *domain.Incident, now time.Time, actor string) error {
	if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET status = 'acknowledged', snoozed_until = NULL,
		version = version + 1 WHERE id = $1`, inc.ID); err != nil {
		return err
	}
	if err := e.writeTimeline(ctx, inc, now, domain.KindAcknowledged, actor,
		domain.TimelineText(domain.KindAcknowledged, inc, actor)); err != nil {
		return err
	}
	// The acknowledge timeout starts from that second, and auto-resolve moves
	// by the Snooze rule.
	if err := e.setAckDeadline(ctx, inc, now); err != nil {
		return err
	}
	if inc.AutoResolveAt != nil {
		sv, serr := e.Store.Service(ctx, inc.ServiceID)
		if serr == nil && sv.AutoResolveMinutes != nil {
			ar := now.Add(time.Duration(*sv.AutoResolveMinutes) * time.Minute)
			if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET auto_resolve_at = $2 WHERE id = $1`, inc.ID, ar); err != nil {
				return err
			}
		}
	}
	if err := e.cancelSteps(ctx, inc.ID); err != nil {
		return err
	}
	if err := e.sendWebhook(ctx, inc, "incident.acknowledged", now); err != nil {
		return err
	}
	e.emit(ctx, inc)
	return nil
}

// doAcknowledge runs the plain triggered to acknowledged transition.
func (e *Engine) doAcknowledge(ctx context.Context, inc *domain.Incident, now time.Time, actor string) error {
	if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET status = 'acknowledged', version = version + 1 WHERE id = $1`, inc.ID); err != nil {
		return err
	}
	if err := e.writeTimeline(ctx, inc, now, domain.KindAcknowledged, actor,
		domain.TimelineText(domain.KindAcknowledged, inc, actor)); err != nil {
		return err
	}
	if err := e.setAckDeadline(ctx, inc, now); err != nil {
		return err
	}
	if err := e.cancelSteps(ctx, inc.ID); err != nil {
		return err
	}
	if err := e.sendWebhook(ctx, inc, "incident.acknowledged", now); err != nil {
		return err
	}
	e.emit(ctx, inc)
	return nil
}

// setAckDeadline sets the acknowledge timeout from the service as it stands now.
func (e *Engine) setAckDeadline(ctx context.Context, inc *domain.Incident, now time.Time) error {
	sv, err := e.Store.Service(ctx, inc.ServiceID)
	if err != nil {
		return nil
	}
	if sv.AckTimeoutMinutes == nil || *sv.AckTimeoutMinutes == 0 {
		return nil
	}
	dl := now.Add(time.Duration(*sv.AckTimeoutMinutes) * time.Minute)
	_, err = e.Store.Pool().Exec(ctx, `UPDATE incidents SET ack_deadline = $2 WHERE id = $1`, inc.ID, dl)
	return err
}

// Snooze applies the snooze action. until must be inside 168 hours of now.
func (e *Engine) Snooze(ctx context.Context, id, actorID, actorName string, until time.Time) (*domain.Incident, error) {
	now := e.Now()
	if err := e.ApplyDue(ctx, now); err != nil {
		return nil, err
	}
	inc, err := e.Store.Incident(ctx, id)
	if err != nil {
		return nil, err
	}
	switch inc.Status {
	case domain.StatusResolved:
		c, _ := e.resolvedDecision(ctx, inc)
		return nil, c
	case domain.StatusSnoozed:
		return nil, &ConflictError{Decision: "snoozed", By: e.lastSnoozeBy(inc), At: deref(inc.SnoozedUntil)}
	case domain.StatusTriggered:
		return nil, &IllegalTransitionError{Message: "Only an acknowledged incident can be snoozed."}
	}
	if !until.After(now) {
		return nil, errSnoozeFuture
	}
	if until.After(now.Add(168 * time.Hour)) {
		return nil, errSnoozeMax
	}
	if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET status = 'snoozed', snoozed_until = $2, snoozed_by = $3,
		version = version + 1 WHERE id = $1`, inc.ID, until, actorID); err != nil {
		return nil, err
	}
	// A snooze replaces the acknowledge timeout and moves auto-resolve.
	if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET ack_deadline = NULL WHERE id = $1`, inc.ID); err != nil {
		return nil, err
	}
	untilStr := domain.FirmLocal(until)
	if err := e.writeTimeline(ctx, inc, now, domain.KindSnoozed, actorName,
		domain.TimelineText(domain.KindSnoozed, inc, actorName, untilStr)); err != nil {
		return nil, err
	}
	if inc.AutoResolveAt != nil {
		sv, err := e.Store.Service(ctx, inc.ServiceID)
		if err == nil && sv.AutoResolveMinutes != nil {
			ar := until.Add(time.Duration(*sv.AutoResolveMinutes) * time.Minute)
			if _, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET auto_resolve_at = $2 WHERE id = $1`, inc.ID, ar); err != nil {
				return nil, err
			}
		}
	}
	if err := e.cancelSteps(ctx, inc.ID); err != nil {
		return nil, err
	}
	if err := e.sendWebhook(ctx, inc, "incident.snoozed", now); err != nil {
		return nil, err
	}
	e.emit(ctx, inc)
	return e.Store.Incident(ctx, id)
}

func (e *Engine) lastSnoozeBy(inc *domain.Incident) string {
	for i := len(inc.Timeline) - 1; i >= 0; i-- {
		if inc.Timeline[i].Kind == domain.KindSnoozed {
			return inc.Timeline[i].Actor
		}
	}
	return "Switchlamp"
}

func deref(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}

var errSnoozeFuture = errors.New("Choose a time after now.")
var errSnoozeMax = errors.New("Snooze for at most 168 hours.")

// SnoozeErrors expose the two published snooze sentences.
func SnoozeErrors() (future, max error) { return errSnoozeFuture, errSnoozeMax }

// Resolve applies the resolve action.
func (e *Engine) Resolve(ctx context.Context, id, actorName string) (*domain.Incident, error) {
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
	tag, err := e.Store.Pool().Exec(ctx, `UPDATE incidents SET status = 'resolved', resolve_reason = 'Resolved',
		closed_at = $2, snoozed_until = NULL, ack_deadline = NULL, escalate_at = NULL, version = version + 1
		WHERE id = $1 AND status != 'resolved'`, inc.ID, now)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		c, _ := e.resolvedDecision(ctx, inc)
		return nil, c
	}
	if _, err := e.Store.Pool().Exec(ctx, `UPDATE alerts SET status = 'resolved', resolved_at = $2
		WHERE incident_id = $1 AND status != 'resolved'`, inc.ID, now); err != nil {
		return nil, err
	}
	if err := e.writeTimeline(ctx, inc, now, domain.KindResolved, actorName,
		domain.TimelineText(domain.KindResolved, inc, actorName)); err != nil {
		return nil, err
	}
	if err := e.cancelSteps(ctx, inc.ID); err != nil {
		return nil, err
	}
	if err := e.sendWebhook(ctx, inc, "incident.resolved", now); err != nil {
		return nil, err
	}
	e.emit(ctx, inc)
	return e.Store.Incident(ctx, id)
}


// Exported sentinel errors the serve layer maps to the published responses.
var (
	ErrSnoozeFuture        = errSnoozeFuture
	ErrSnoozeMax           = errSnoozeMax
	ErrPersonHolds         = errPersonHolds
	ErrSameService         = errSameService
	ErrMergeTargetResolved = errMergeTargetResolved
	ErrMergeIntoSelf       = errMergeIntoSelf
	ErrMergeTooMany        = errMergeTooMany
	ErrLastAlert           = errLastAlert
	ErrAlreadyResponding   = errAlreadyResponding
	ErrAlreadyAnswered     = errAlreadyAnswered
	ErrResolvedRequest     = errResolved
)

// ResolvedDecisionFor exposes the resolved decision to the serve layer.
func (e *Engine) ResolvedDecisionFor(ctx context.Context, inc *domain.Incident) (*ConflictError, error) {
return e.resolvedDecision(ctx, inc)
}
