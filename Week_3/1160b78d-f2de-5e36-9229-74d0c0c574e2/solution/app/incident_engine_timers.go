package main

import (
	"encoding/json"
	"fmt"
	"slices"
)

// nextEscalation decides where a due escalation goes: to the next occupied level (skipping empty ones in the same
// second), to nowhere when escalation is over, or to nobody when no level has anybody on call any more.
func nextEscalation(inc *incidentRow, levels *levelHolders) (place placement, finished bool, err error) {
	if len(inc.Holders) == 0 {
		if place, err = levels.seek(1, inc.Cycle); err != nil {
			return place, false, fmt.Errorf("find who is on call for incident #%d: %w", inc.Number, err)
		}
		return place, false, nil
	}
	level, cycle, more := nextPosition(inc.Snapshot, inc.Level, inc.Cycle)
	if !more {
		return place, true, nil
	}
	if place, err = levels.seek(level, cycle); err != nil {
		return place, false, fmt.Errorf("find who is on call for incident #%d: %w", inc.Number, err)
	}
	if place.Found {
		return place, false, nil
	}
	anywhere, err := levels.seek(1, 0)
	if err != nil {
		return place, false, fmt.Errorf("find who is on call for incident #%d: %w", inc.Number, err)
	}
	return place, anywhere.Found, nil
}

// fireEscalation moves a triggered incident whose level timed out to the next level, and notifies its holders.
func (a *App) fireEscalation(w *Work, incidentID string) error {
	inc, err := loadIncident(w.Ctx, w.Tx, incidentID)
	if err != nil {
		return fmt.Errorf("load incident: %w", err)
	}
	place, finished, err := nextEscalation(&inc, a.levels(w, inc.Snapshot))
	if err != nil {
		return fmt.Errorf("find next escalation: %w", err)
	}
	if finished {
		inc.EscalationFinished, inc.EscalationDueAt = true, nil
		if err := w.saveIncident(&inc); err != nil {
			return fmt.Errorf("save incident: %w", err)
		}
		if err := w.publishIncident(incidentID, ""); err != nil {
			return fmt.Errorf("publish incident: %w", err)
		}
		return nil
	}
	previous := inc.Holders
	if place.Found {
		inc.Level, inc.Cycle = place.Level, place.Cycle
	} else {
		inc.Level = 1
	}
	inc.Holders, inc.PolicyHeld = personIDs(place.Holders), true
	holdersChanged := !slices.Equal(previous, inc.Holders)
	if holdersChanged {
		inc.Assignment++
	}
	inc.armEscalation(w.Now)
	if err := w.saveIncident(&inc); err != nil {
		return fmt.Errorf("save incident: %w", err)
	}
	if !holdersChanged && !place.Found {
		if err := w.publishIncident(incidentID, ""); err != nil {
			return fmt.Errorf("publish incident: %w", err)
		}
		return nil
	}
	if len(previous) > 0 {
		if err := a.cancelPendingSteps(w, incidentID, previous); err != nil {
			return fmt.Errorf("cancel pending steps: %w", err)
		}
	}
	if err := a.notifyHolders(w, incidentID, inc.Holders); err != nil {
		return fmt.Errorf("notify holders: %w", err)
	}
	text := fmt.Sprintf("Incident #%d escalated to %s", inc.Number, holdersText(place.Holders))
	if err := w.report(&inc, "escalated", systemActor, text, hookEscalated); err != nil {
		return fmt.Errorf("report escalation: %w", err)
	}
	return nil
}

// returnToTriggered ends an acknowledge or a snooze at its deadline: the incident is triggered again, its current level's
// full timeout restarts and its holders are notified again.
func (a *App) returnToTriggered(w *Work, incidentID, kind, because string) error {
	inc, err := loadIncident(w.Ctx, w.Tx, incidentID)
	if err != nil {
		return fmt.Errorf("load incident: %w", err)
	}
	inc.backToTriggered(w.Now)
	if err := w.saveIncident(&inc); err != nil {
		return fmt.Errorf("save incident: %w", err)
	}
	if err := a.notifyHolders(w, incidentID, inc.Holders); err != nil {
		return fmt.Errorf("notify holders: %w", err)
	}
	text := fmt.Sprintf("Incident #%d back to triggered: %s", inc.Number, because)
	if err := w.report(&inc, kind, systemActor, text, hookUnacknowledged); err != nil {
		return fmt.Errorf("report return to triggered: %w", err)
	}
	return nil
}

func (a *App) fireAckTimeout(w *Work, incidentID string) error {
	if err := a.returnToTriggered(w, incidentID, "ack_timed_out", "acknowledge timed out"); err != nil {
		return fmt.Errorf("return incident to triggered: %w", err)
	}
	return nil
}

func (a *App) fireSnoozeEnd(w *Work, incidentID string) error {
	if err := a.returnToTriggered(w, incidentID, "snooze_ended", "snooze ended"); err != nil {
		return fmt.Errorf("return incident to triggered: %w", err)
	}
	return nil
}

func (a *App) fireAutoResolve(w *Work, incidentID string) error {
	inc, err := loadIncident(w.Ctx, w.Tx, incidentID)
	if err != nil {
		return fmt.Errorf("load incident: %w", err)
	}
	if err := a.closeIncident(w, &inc, closure{Reason: "Auto-resolved", Kind: "auto_resolved", Actor: systemActor,
		Text: fmt.Sprintf("Incident #%d auto-resolved", inc.Number), Hook: hookResolved}); err != nil {
		return fmt.Errorf("close auto-resolved incident: %w", err)
	}
	return nil
}

// moveHandedOffIncidents applies the handoff rule for a schedule at w.Now: a triggered incident held through the schedule
// target of its level moves to the level's holders as they now are. The new holders' steps start now, the old holders'
// unsent steps are cancelled and the escalation deadline stays.
func (a *App) moveHandedOffIncidents(w *Work, scheduleID string) error {
	target, err := json.Marshal([]map[string]string{{"type": "schedule", "id": scheduleID}})
	if err != nil {
		return fmt.Errorf("encode schedule target: %w", err)
	}
	rows, err := w.Tx.Query(w.Ctx, `select id from incidents where status = 'triggered' and policy_held
		and policy_snapshot -> 'levels' -> (level - 1) -> 'targets' @> $1::jsonb`, string(target))
	if err != nil {
		return fmt.Errorf("find incidents held through schedule %s: %w", scheduleID, err)
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("scan incident held through schedule %s: %w", scheduleID, err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("find incidents held through schedule %s: %w", scheduleID, err)
	}
	for _, id := range ids {
		if err := a.handOff(w, id); err != nil {
			return fmt.Errorf("hand off incident %s: %w", id, err)
		}
	}
	return nil
}

// peopleNotIn lists the people who are not among the others.
func peopleNotIn(people, others []personRef) []personRef {
	return slices.DeleteFunc(slices.Clone(people), func(p personRef) bool {
		return slices.ContainsFunc(others, func(o personRef) bool { return o.ID == p.ID })
	})
}

// handOff gives an incident the holders its level has now.
func (a *App) handOff(w *Work, incidentID string) error {
	inc, err := loadIncident(w.Ctx, w.Tx, incidentID)
	if err != nil {
		return fmt.Errorf("read incident: %w", err)
	}
	holders, err := a.levels(w, inc.Snapshot).of(inc.Level)
	if err != nil {
		return fmt.Errorf("find holders of level %d: %w", inc.Level, err)
	}
	current, err := personRefs(w.Ctx, w.Tx, inc.Holders)
	if err != nil {
		return fmt.Errorf("read holders: %w", err)
	}
	left, arrived := peopleNotIn(current, holders), peopleNotIn(holders, current)
	if len(left) == 0 && len(arrived) == 0 {
		return nil
	}
	inc.Holders = personIDs(holders)
	inc.Assignment++
	if err := w.saveIncident(&inc); err != nil {
		return fmt.Errorf("save incident: %w", err)
	}
	if len(left) > 0 {
		if err := a.cancelPendingSteps(w, incidentID, personIDs(left)); err != nil {
			return fmt.Errorf("cancel pending steps: %w", err)
		}
	}
	if len(arrived) > 0 {
		if err := a.notifyHolders(w, incidentID, personIDs(arrived)); err != nil {
			return fmt.Errorf("notify holders: %w", err)
		}
	}
	text := fmt.Sprintf("Incident #%d handed off from %s to %s", inc.Number, holdersText(left), holdersText(arrived))
	if err := w.report(&inc, "handed_off", systemActor, text, ""); err != nil {
		return fmt.Errorf("report handoff: %w", err)
	}
	return nil
}

func init() {
	timerHandlers[timerEscalation] = (*App).fireEscalation
	timerHandlers[timerAckTimeout] = (*App).fireAckTimeout
	timerHandlers[timerSnoozeEnd] = (*App).fireSnoozeEnd
	timerHandlers[timerAutoResolve] = (*App).fireAutoResolve
}
