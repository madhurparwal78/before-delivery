package main

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"
)

// scheduleMessage is the data of the "schedule" live message.
type scheduleMessage struct {
	ScheduleID string `json:"schedule_id"`
}

const handoffTimer = "handoff"

// currentSchedule reads a schedule inside a work, upgrading an older record first so an edit is always made on the
// local-time form, and returns who is on call on it at that second ("" in a gap).
func (a *App) currentSchedule(w *Work, scheduleID string) (*scheduleModel, string, error) {
	m, err := a.loadScheduleModel(w.Ctx, w.Tx, scheduleID)
	if err != nil {
		return nil, "", fmt.Errorf("read schedule: %w", err)
	}
	if m.RecordFormat == 1 {
		if err := upgradeScheduleRecord(w, m); err != nil {
			return nil, "", fmt.Errorf("upgrade older schedule: %w", err)
		}
		if m, err = a.loadScheduleModel(w.Ctx, w.Tx, scheduleID); err != nil {
			return nil, "", fmt.Errorf("read upgraded schedule: %w", err)
		}
	}
	return m, m.slotAt(w.Now).person, nil
}

// scheduleEdited is what every change to a schedule does once its rows are written: a changed holder triggers the
// handoff rule at once, the next handoff is armed anew, the cached who-is-on-call copy goes before the response returns
// and every open screen hears of it. holderBefore is who was on call at this second before the change.
func (a *App) scheduleEdited(w *Work, scheduleID, holderBefore string) error {
	m, err := a.loadScheduleModel(w.Ctx, w.Tx, scheduleID)
	if err != nil {
		return fmt.Errorf("read edited schedule: %w", err)
	}
	if m.slotAt(w.Now).person != holderBefore {
		if err := a.moveHandedOffIncidents(w, scheduleID); err != nil {
			return fmt.Errorf("move handed-off incidents: %w", err)
		}
	}
	a.announceSchedule(w, scheduleID)
	if err := a.armHandoff(w, m, w.Now); err != nil {
		return fmt.Errorf("arm handoff timer: %w", err)
	}
	return nil
}

// announceSchedule clears the cached copy after the commit and tells every open screen the schedule changed.
func (a *App) announceSchedule(w *Work, scheduleID string) {
	w.After(func(ctx context.Context) { a.clearOncallCache(ctx, scheduleID) })
	w.Publish("schedule", scheduleMessage{ScheduleID: scheduleID})
}

// armHandoff sets the schedule's handoff timer to the next change of who is on call after an instant, or clears it when
// nothing will ever change.
func (a *App) armHandoff(w *Work, m *scheduleModel, after time.Time) error {
	_, next := m.holderAt(after)
	if next == nil {
		if err := w.clearTimer(handoffTimer, m.ID); err != nil {
			return fmt.Errorf("clear handoff timer: %w", err)
		}
		return nil
	}
	if err := w.setTimer(handoffTimer, m.ID, *next); err != nil {
		return fmt.Errorf("set handoff timer: %w", err)
	}
	return nil
}

// heldByTriggeredIncident reports whether a triggered incident's policy copy points at the schedule, so a handoff has
// somebody to move.
func heldByTriggeredIncident(w *Work, scheduleID string) (bool, error) {
	var held bool
	err := w.Tx.QueryRow(w.Ctx, `select exists (select 1 from incidents where status = 'triggered' and
		jsonb_path_exists(policy_snapshot, '$.levels[*].targets[*] ? (@.type == "schedule" && @.id == $id)',
		jsonb_build_object('id', $1::text)))`, scheduleID).Scan(&held)
	if err != nil {
		return false, fmt.Errorf("find incidents held through schedule %s: %w", scheduleID, err)
	}
	return held, nil
}

// handleHandoff runs at the handoff second: triggered incidents held through the schedule move to the new holder, the
// cached copy goes, screens hear of it and the next handoff is armed. With nobody to move, every handoff the clock has
// already passed is skipped in one step, so a jump of a year over daily handoffs stays fast.
func handleHandoff(a *App, w *Work, scheduleID string) error {
	m, err := a.loadScheduleModel(w.Ctx, w.Tx, scheduleID)
	if err != nil {
		return fmt.Errorf("read schedule: %w", err)
	}
	held, err := heldByTriggeredIncident(w, scheduleID)
	if err != nil {
		return fmt.Errorf("find held incidents: %w", err)
	}
	after := laterOf(w.Now, a.clock.Now())
	if held {
		after = w.Now
		if err := a.moveHandedOffIncidents(w, scheduleID); err != nil {
			return fmt.Errorf("move handed-off incidents: %w", err)
		}
	}
	a.announceSchedule(w, scheduleID)
	if err := a.armHandoff(w, m, after); err != nil {
		return fmt.Errorf("arm handoff timer: %w", err)
	}
	return nil
}

// fromUTC rewrites a form of an older record, which holds its handoff as a UTC time on a UTC date, as the same first
// handoff in the schedule's own zone: its local clock time and local date.
func (f *layerForm) fromUTC(loc *time.Location) error {
	date, err := parseLocalDay(f.StartDate)
	if err != nil {
		return fmt.Errorf("read start date: %w", err)
	}
	minutes, ok := clockMinutes(f.HandoffTime, false)
	if !ok {
		return fmt.Errorf("handoff time %q is not HH:MM", f.HandoffTime)
	}
	first := date.midnight.Add(time.Duration(minutes) * time.Minute)
	f.StartDate = dayOf(first, loc).String()
	f.HandoffTime = first.In(loc).Format("15:04")
	return nil
}

// upgradeScheduleRecord stores a read older record in the current format, once. The model was read with the local
// handoff already, so the blocks are the same before and after.
func upgradeScheduleRecord(w *Work, m *scheduleModel) error {
	for _, layer := range m.layers {
		for _, revision := range layer.Revisions {
			_, err := w.Tx.Exec(w.Ctx, `update schedule_layer_revisions set handoff_time = $3, start_date = $4
				where layer_id = $1 and revision = $2`, layer.ID, revision.Number, revision.Form.HandoffTime, revision.Form.StartDate)
			if err != nil {
				return fmt.Errorf("upgrade layer %s: %w", layer.ID, err)
			}
		}
	}
	_, err := w.Tx.Exec(w.Ctx, `update schedules set record_format = 2, upgraded_at = $2, version = version + 1 where id = $1`,
		m.ID, w.Now)
	if err != nil {
		return fmt.Errorf("upgrade schedule %s: %w", m.ID, err)
	}
	return nil
}

// upgradeProgress is what GET /api/system reports about the one-time upgrade of older records.
type upgradeProgress struct {
	mu       sync.Mutex
	done     bool
	upgraded int
	finished time.Time
}

var scheduleUpgrade upgradeProgress

func (p *upgradeProgress) report() any {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.done {
		return map[string]any{"state": "running", "upgraded": p.upgraded, "finished_at": nil}
	}
	return map[string]any{"state": "done", "upgraded": p.upgraded, "finished_at": formatInstant(p.finished)}
}

// upgradeOlderSchedules rewrites every record_format 1 schedule to format 2 on start, one at a time, never holding up a
// read. A record upgraded on an earlier start is not touched again.
func (a *App) upgradeOlderSchedules(ctx context.Context) {
	rows, err := a.db.Query(ctx, `select id from schedules where record_format = 1 order by name, id`)
	if err != nil {
		log.Printf("schedule upgrade: list older records: %v", err)
		return
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			log.Printf("schedule upgrade: scan record: %v", err)
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		err := a.Do(ctx, func(w *Work) error {
			m, err := a.loadScheduleModel(w.Ctx, w.Tx, id)
			if err != nil {
				return fmt.Errorf("read schedule: %w", err)
			}
			if m.RecordFormat != 1 {
				return nil
			}
			if err := upgradeScheduleRecord(w, m); err != nil {
				return fmt.Errorf("upgrade schedule record: %w", err)
			}
			return nil
		})
		if err != nil {
			log.Printf("schedule upgrade: record %s: %v", id, err)
			return
		}
	}
	var upgraded int
	if err := a.db.QueryRow(ctx, `select count(*) from schedules where upgraded_at is not null`).Scan(&upgraded); err != nil {
		log.Printf("schedule upgrade: count upgraded records: %v", err)
		return
	}
	scheduleUpgrade.mu.Lock()
	defer scheduleUpgrade.mu.Unlock()
	scheduleUpgrade.done, scheduleUpgrade.upgraded, scheduleUpgrade.finished = true, upgraded, a.clock.Now()
}

func init() {
	timerHandlers[handoffTimer] = handleHandoff
	systemProbes["schedule_upgrade"] = func(*App) any { return scheduleUpgrade.report() }
	workerSetups = append(workerSetups, func(a *App, ctx context.Context) { go a.upgradeOlderSchedules(ctx) })
}
