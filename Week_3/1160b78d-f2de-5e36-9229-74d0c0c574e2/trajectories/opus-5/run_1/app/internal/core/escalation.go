package core

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// policySnapshotFor copies a service's policy as it stands, which the incident
// then uses for every later step.
func (a *App) policySnapshotFor(ctx context.Context, serviceID string) (PolicySnapshot, error) {
	service, err := a.GetService(ctx, serviceID)
	if err != nil {
		return PolicySnapshot{}, err
	}
	if service.PolicyID == nil {
		return PolicySnapshot{Name: "No policy", Version: 0, Levels: []PolicyLevel{}}, nil
	}
	policy, err := a.GetPolicy(ctx, *service.PolicyID)
	if err != nil {
		return PolicySnapshot{}, err
	}
	return PolicySnapshot{ID: policy.ID, Name: policy.Name, Version: policy.Version,
		Repeats: policy.Repeats, Levels: policy.Levels}, nil
}

// holdersForLevel resolves one level's targets to the people holding it now.
func (a *App) holdersForLevel(ctx context.Context, snapshot PolicySnapshot, level int, at time.Time) ([]string, error) {
	if level < 1 || level > len(snapshot.Levels) {
		return nil, nil
	}
	var out []string
	seen := map[string]bool{}
	for _, target := range snapshot.Levels[level-1].Targets {
		switch target.Type {
		case "person":
			var removed *time.Time
			if err := a.pool.QueryRow(ctx, `SELECT removed_at FROM users WHERE id=$1`, target.ID).Scan(&removed); err != nil {
				continue
			}
			if removed != nil || seen[target.ID] {
				continue
			}
			seen[target.ID] = true
			out = append(out, target.ID)
		case "schedule":
			ids, err := a.holderIDsForSchedule(ctx, target.ID, at)
			if err != nil {
				return nil, err
			}
			for _, id := range ids {
				if !seen[id] {
					seen[id] = true
					out = append(out, id)
				}
			}
		}
	}
	return out, nil
}

// anyoneOnPolicy answers whether any level of a policy has somebody at all.
func (a *App) anyoneOnPolicy(ctx context.Context, snapshot PolicySnapshot, at time.Time) (bool, error) {
	for level := 1; level <= len(snapshot.Levels); level++ {
		ids, err := a.holdersForLevel(ctx, snapshot, level, at)
		if err != nil {
			return false, err
		}
		if len(ids) > 0 {
			return true, nil
		}
	}
	return false, nil
}

func levelTimeout(snapshot PolicySnapshot, level int) time.Duration {
	if level < 1 || level > len(snapshot.Levels) {
		return 30 * time.Minute
	}
	return time.Duration(snapshot.Levels[level-1].TimeoutMinutes) * time.Minute
}

// advanceLevel steps an incident to its next level, or answers false once the
// policy's repeats are used up.
func advanceLevel(inc *incidentRow) bool {
	levels := len(inc.Snapshot.Levels)
	if levels == 0 {
		return false
	}
	if inc.Level < levels {
		inc.Level++
		return true
	}
	if inc.Cycle >= inc.Snapshot.Repeats {
		return false
	}
	inc.Cycle++
	inc.Level = 1
	return true
}

// runEscalation puts an incident on the first level with somebody on call,
// skipping an empty level in the same second.
func (a *App) runEscalation(ctx context.Context, inc *incidentRow, now time.Time, initial bool) error {
	levels := len(inc.Snapshot.Levels)
	if levels == 0 {
		return a.setHolders(ctx, inc, nil, now, false, "")
	}
	for tried := 0; tried < levels; tried++ {
		ids, err := a.holdersForLevel(ctx, inc.Snapshot, inc.Level, now)
		if err != nil {
			return err
		}
		if len(ids) > 0 {
			inc.EscalationDueAt = ptr(now.Add(levelTimeout(inc.Snapshot, inc.Level)))
			inc.EscalationFinished = false
			inc.HoldersPinned = false
			if err := a.setHolders(ctx, inc, ids, now, true, ""); err != nil {
				return err
			}
			if !initial {
				names, err := a.holderNames(ctx, inc.ID)
				if err != nil {
					return err
				}
				if _, err := a.addEntry(ctx, inc.ID, now, "escalated", "Switchlamp", txtEscalated(inc.Number, names), nil); err != nil {
					return err
				}
			}
			return nil
		}
		if !advanceLevel(inc) {
			inc.EscalationFinished = true
			inc.EscalationDueAt = nil
			return a.setHolders(ctx, inc, nil, now, false, "")
		}
	}
	// Every level is empty: the incident stays triggered with nobody, and tries
	// again when level 1's timeout passes.
	inc.Level = 1
	inc.EscalationFinished = false
	inc.EscalationDueAt = ptr(now.Add(levelTimeout(inc.Snapshot, 1)))
	return a.setHolders(ctx, inc, nil, now, false, "")
}

// assignFirstLevel puts a low-urgency incident with the first level that has
// somebody, without starting any escalation.
func (a *App) assignFirstLevel(ctx context.Context, inc *incidentRow, now time.Time) error {
	for level := 1; level <= len(inc.Snapshot.Levels); level++ {
		ids, err := a.holdersForLevel(ctx, inc.Snapshot, level, now)
		if err != nil {
			return err
		}
		if len(ids) > 0 {
			inc.Level = level
			inc.EscalationDueAt = nil
			inc.HoldersPinned = false
			return a.setHolders(ctx, inc, ids, now, true, "")
		}
	}
	return a.setHolders(ctx, inc, nil, now, false, "")
}

// setHolders replaces an incident's holders. The new holders' steps start from
// delay zero and the old holders' unsent steps are cancelled.
func (a *App) setHolders(ctx context.Context, inc *incidentRow, ids []string, now time.Time, notify bool, handoffEntry string) error {
	current, err := a.holderRefs(ctx, inc.ID)
	if err != nil {
		return err
	}
	keep := map[string]bool{}
	for _, id := range ids {
		keep[id] = true
	}
	had := map[string]bool{}
	for _, c := range current {
		had[c.ID] = true
		if !keep[c.ID] {
			if err := a.cancelSteps(ctx, inc.ID, &c.ID); err != nil {
				return err
			}
			if _, err := a.pool.Exec(ctx, `DELETE FROM incident_holders WHERE incident_id=$1 AND person_id=$2`,
				inc.ID, c.ID); err != nil {
				return fmt.Errorf("drop holder: %w", err)
			}
		}
	}
	for _, id := range ids {
		if had[id] {
			continue
		}
		assignment := newID()
		if _, err := a.pool.Exec(ctx, `INSERT INTO incident_holders (incident_id, person_id, assignment_id, assigned_at)
			VALUES ($1,$2,$3,$4)`, inc.ID, id, assignment, now); err != nil {
			return fmt.Errorf("add holder: %w", err)
		}
		if notify {
			if err := a.scheduleSteps(ctx, inc, id, assignment, now); err != nil {
				return err
			}
		}
	}
	return nil
}

// applyHandoffs moves an unacknowledged incident to its target's new holder at
// the handoff second, so no later step goes to someone who has handed off.
func (a *App) applyHandoffs(ctx context.Context) error {
	now := a.Clock.Now()
	rows, err := a.pool.Query(ctx, `SELECT `+incidentColumns+` FROM incidents
		WHERE status='triggered' AND holders_pinned = false`)
	if err != nil {
		return fmt.Errorf("read triggered incidents: %w", err)
	}
	var open []*incidentRow
	for rows.Next() {
		inc, err := scanIncident(rows)
		if err != nil {
			rows.Close()
			return fmt.Errorf("read incident: %w", err)
		}
		open = append(open, inc)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, inc := range open {
		if inc.Level < 1 || inc.Level > len(inc.Snapshot.Levels) {
			continue
		}
		hasSchedule := false
		for _, t := range inc.Snapshot.Levels[inc.Level-1].Targets {
			if t.Type == "schedule" {
				hasSchedule = true
			}
		}
		if !hasSchedule {
			continue
		}
		want, err := a.holdersForLevel(ctx, inc.Snapshot, inc.Level, now)
		if err != nil {
			return err
		}
		current, err := a.holderRefs(ctx, inc.ID)
		if err != nil {
			return err
		}
		if samePeople(current, want) {
			continue
		}
		oldNames := make([]string, 0, len(current))
		for _, c := range current {
			oldNames = append(oldNames, c.Name)
		}
		if err := a.setHolders(ctx, inc, want, now, true, ""); err != nil {
			return err
		}
		newNames, err := a.holderNames(ctx, inc.ID)
		if err != nil {
			return err
		}
		if _, err := a.addEntry(ctx, inc.ID, now, "handed_off", "Switchlamp",
			txtHandedOff(inc.Number, joinNames(oldNames), joinNames(newNames)), nil); err != nil {
			return err
		}
		if err := a.saveIncident(ctx, inc); err != nil {
			return err
		}
		a.announceIncident(ctx, inc, txtHandedOff(inc.Number, joinNames(oldNames), joinNames(newNames)))
	}
	return nil
}

func samePeople(current []PersonRef, want []string) bool {
	if len(current) != len(want) {
		return false
	}
	have := map[string]bool{}
	for _, c := range current {
		have[c.ID] = true
	}
	for _, id := range want {
		if !have[id] {
			return false
		}
	}
	return true
}

func (a *App) addEntry(ctx context.Context, incidentID string, at time.Time, kind, actor, text string, fromNumber *int64) (TimelineEntry, error) {
	entry := TimelineEntry{ID: newID(), At: at, Kind: kind, Actor: actor, Text: text, FromNumber: fromNumber}
	if _, err := a.pool.Exec(ctx, `INSERT INTO timeline (id, incident_id, at, kind, actor, text, from_number)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, entry.ID, incidentID, at, kind, actor, text, fromNumber); err != nil {
		return TimelineEntry{}, fmt.Errorf("write timeline entry: %w", err)
	}
	return entry, nil
}

func (a *App) saveIncident(ctx context.Context, inc *incidentRow) error {
	snapshot, err := jsonBytes(inc.Snapshot)
	if err != nil {
		return err
	}
	_, err = a.pool.Exec(ctx, `UPDATE incidents SET service_id=$1, title=$2, status=$3, urgency=$4, level=$5, cycle=$6,
		policy_snapshot=$7, escalation_due_at=$8, escalation_finished=$9, ack_deadline_at=$10, snoozed_until=$11,
		snoozed_by=$12, auto_resolve_minutes=$13, auto_resolve_at=$14, acknowledged_at=$15, acknowledged_by=$16,
		decided_by=$17, decided_at=$18, resolved_at=$19, resolve_reason=$20, resolved_by=$21, merged_into=$22,
		grouping_until=$23, holders_pinned=$24, version=version+1 WHERE id=$25`,
		inc.ServiceID, inc.Title, inc.Status, inc.Urgency, inc.Level, inc.Cycle, snapshot, inc.EscalationDueAt,
		inc.EscalationFinished, inc.AckDeadlineAt, inc.SnoozedUntil, inc.SnoozedBy, inc.AutoResolveMinutes,
		inc.AutoResolveAt, inc.AcknowledgedAt, inc.AcknowledgedBy, inc.DecidedBy, inc.DecidedAt, inc.ResolvedAt,
		inc.ResolveReason, inc.ResolvedBy, inc.MergedInto, inc.GroupingUntil, inc.HoldersPinned, inc.ID)
	if err != nil {
		return fmt.Errorf("save incident: %w", err)
	}
	inc.Version++
	return nil
}

func jsonBytes(v any) ([]byte, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("write json: %w", err)
	}
	return b, nil
}

// announceIncident sends one decided event to every open screen.
func (a *App) announceIncident(ctx context.Context, inc *incidentRow, announce string) {
	fresh, err := a.loadIncident(ctx, inc.ID)
	if err != nil {
		return
	}
	item, err := a.incidentItem(ctx, fresh)
	if err != nil {
		return
	}
	a.publish(ctx, "incident", map[string]any{
		"incident_id": inc.ID,
		"announce":    announce,
		"item":        item,
	})
}
