package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// api_delete.go — deleting, duplicating, moving and the zone rule Move.

// handleDeleteEvent applies the three delete scopes.
func (a *App) handleDeleteEvent(ctx context.Context, resp *apiResponse, person *Person, id, scope, occurrenceID, ifMatch string) error {
	err := a.store.Tx(ctx, func(tx pgx.Tx) error {
		e, txErr := a.store.LoadEventTx(ctx, tx, id)
		if txErr != nil {
			return txErr
		}
		if e == nil {
			return apiErr(404, "not_found", "That event is not available.")
		}
		cal, txErr := a.store.CalendarByID(ctx, e.CalendarID)
		if txErr != nil {
			return txErr
		}
		access := a.store.Access(ctx, person, cal, e)
		if access != "full" {
			return apiErr(403, "forbidden", "You need edit access on that event.")
		}
		if txErr := checkVersion(e, ifMatch); txErr != nil {
			return txErr
		}
		isSeries := e.RRule != nil && *e.RRule != ""
		if isSeries && scope == "" {
			scope = "all"
		}
		if scope == "this" || scope == "following" {
			if occurrenceID == "" {
				return apiFieldErr("Choose the occurrence to delete.", map[string]string{"occurrence_id": "Choose the occurrence to delete."})
			}
		}
		now := a.clock.Now()
		switch scope {
		case "", "all":
			kind := "event"
			if isSeries {
				kind = "series"
			}
			trashID := newID("trash")
			title := e.Title
			if _, err := tx.Exec(ctx, `INSERT INTO trash (id, kind, event_id, title, trashed_at, purge_at)
			  VALUES ($1,$2,$3,$4,$5,$6)`, trashID, kind, e.ID, title, now, now.Add(a.cfg.TrashRetention)); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE events SET state='trashed', version=version+1 WHERE id=$1`, e.ID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE reminders SET status='cancelled' WHERE event_id=$1 AND status IN ('scheduled','snoozed')`, e.ID); err != nil {
				return err
			}
			resp.trashID = trashID
			return nil
		case "this":
			// a deleted occurrence with its own trash item
			trashID := newID("trash")
			occID := occurrenceID
			if _, err := tx.Exec(ctx, `INSERT INTO exceptions (event_id, occurrence_id, deleted)
			  VALUES ($1,$2,true) ON CONFLICT (event_id, occurrence_id) DO UPDATE SET deleted=true`, e.ID, occID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO trash (id, kind, event_id, occurrence_id, title, trashed_at, purge_at)
			  VALUES ($1,'occurrence',$2,$3,$4,$5,$6)`, trashID, e.ID, occID, e.Title, now, now.Add(a.cfg.TrashRetention)); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE events SET version=version+1 WHERE id=$1`, e.ID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE reminders SET status='cancelled' WHERE event_id=$1 AND occurrence_id=$2 AND status IN ('scheduled','snoozed')`, e.ID, occID); err != nil {
				return err
			}
			resp.trashID = trashID
			return nil
		case "following":
			rules, _ := a.store.ZoneRules(ctx)
			moved := map[string]bool{}
			occ := FindOccurrence(e, occurrenceID, rules, moved)
			if occ == nil {
				return apiErr(404, "not_found", "That event is not available.")
			}
			if occ.OccurrenceID == firstOccurrenceID(e, rules) {
				// behaves as all
				trashID := newID("trash")
				if _, err := tx.Exec(ctx, `INSERT INTO trash (id, kind, event_id, title, trashed_at, purge_at)
				  VALUES ($1,'series',$2,$3,$4,$5)`, trashID, e.ID, e.Title, now, now.Add(a.cfg.TrashRetention)); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `UPDATE events SET state='trashed', version=version+1 WHERE id=$1`, e.ID); err != nil {
					return err
				}
				resp.trashID = trashID
				return nil
			}
			laterID, txErr := splitSeriesAt(ctx, a, tx, e, occ, rules, moved)
			if txErr != nil {
				return txErr
			}
			trashID := newID("trash")
			if _, err := tx.Exec(ctx, `INSERT INTO trash (id, kind, event_id, title, trashed_at, purge_at)
			  VALUES ($1,'series',$2,$3,$4,$5)`, trashID, laterID, e.Title, now, now.Add(a.cfg.TrashRetention)); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE events SET state='trashed', version=version+1 WHERE id=$1`, laterID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE reminders SET status='cancelled' WHERE event_id=$1 AND status IN ('scheduled','snoozed')`, laterID); err != nil {
				return err
			}
			resp.trashID = trashID
			return nil
		}
		return apiErr(422, "invalid", "Choose This event, This and following events or All events.")
	})
	if err != nil {
		var vc *versionConflict
		if asVersionConflict(err, &vc) {
			a.writeConflict(ctx, resp, person, id)
			return nil
		}
		return err
	}
	e, _ := a.store.LoadEvent(ctx, id)
	a.broadcaster.BroadcastDelete(ctx, e, resp.trashID)
	writeJSON(resp.w, http.StatusOK, map[string]any{"trash_id": resp.trashID})
	return nil
}

// asVersionConflict reports whether err is the one place's version check
// refusing a save, and fills vc with the conflicting event when it is.
func asVersionConflict(err error, vc **versionConflict) bool {
	var target *versionConflict
	if errors.As(err, &target) && target != nil {
		*vc = target
		return true
	}
	return false
}

func (a *App) writeConflict(ctx context.Context, resp *apiResponse, person *Person, id string) {
	current, _ := a.store.LoadEvent(ctx, id)
	if current == nil {
		writeJSONStatus(resp.w, 412, map[string]any{
			"error": "version_conflict", "message": "Someone saved this first.", "current": nil,
		})
		return
	}
	cal, _ := a.store.CalendarByID(ctx, current.CalendarID)
	access := a.store.Access(ctx, person, cal, current)
	hours, _ := a.store.OfficeHoursAll(ctx)
	writeJSONStatus(resp.w, 412, map[string]any{
		"error":   "version_conflict",
		"message": fmt.Sprintf("%s saved this first.", a.winnerName(ctx, current)),
		"current": ProjectEvent(current, nil, access, person, hours),
	})
}

// handleDuplicate is POST /api/events/:id/duplicate.
func (a *App) handleDuplicate(ctx context.Context, resp *apiResponse, person *Person, id string) error {
	e, err := a.store.LoadEvent(ctx, id)
	if err != nil {
		return err
	}
	if e == nil {
		return apiErr(404, "not_found", "That event is not available.")
	}
	cal, _ := a.store.CalendarByID(ctx, e.CalendarID)
	access := a.store.Access(ctx, person, cal, e)
	if access == "busy" {
		return apiErr(403, "forbidden", "You cannot duplicate an event you cannot read.")
	}
	targetCal := e.CalendarID
	if access != "full" {
		// duplicate onto the caller's own calendar
		targetCal = "cal-" + strings.TrimPrefix(person.ID, "p-")
	}
	defaults, _ := a.store.GuestDefaults(ctx)
	newEventID := newID("evt")
	now := a.clock.Now()
	savedDate := InZone(now, e.Zone).Format("2006-01-02")
	err = a.store.Tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO events (id, calendar_id, organiser_id, title, location, notes, kind, colour,
		  all_day, start_date, start_minutes, end_date, end_minutes, zone, visibility, rrule,
		  decline_mode, decline_message, saved_at, saved_date, version)
		  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,1)`,
			newEventID, targetCal, person.ID, e.Title+" copy", e.Location, e.Notes, e.Kind, e.Colour,
			e.AllDay, e.StartDate, e.StartMinutes, e.EndDate, e.EndMinutes, e.Zone, e.Visibility,
			nilDeref(e.RRule), nilDeref(e.DeclineMode), nilDeref(e.DeclineMessage), now, savedDate); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO switches (event_id, modify_event, invite_others, see_guest_list)
		  VALUES ($1,$2,$3,$4)`, newEventID, defaults.ModifyEvent, defaults.InviteOthers, defaults.SeeGuestList); err != nil {
			return err
		}
		for _, m := range e.Reminders {
			if _, err := tx.Exec(ctx, `INSERT INTO event_reminders (event_id, minutes) VALUES ($1,$2)`, newEventID, m); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	newEvent, _ := a.store.LoadEvent(ctx, newEventID)
	a.broadcaster.BroadcastEvent(ctx, newEvent)
	hours, _ := a.store.OfficeHoursAll(ctx)
	writeJSON(resp.w, http.StatusCreated, ProjectEvent(newEvent, nil, "full", person, hours))
	return nil
}

// handleMoveCalendar moves an event to another calendar.
func (a *App) handleMoveCalendar(ctx context.Context, resp *apiResponse, person *Person, id string, body []byte, ifMatch string) error {
	var req struct {
		CalendarID string `json:"calendar_id"`
	}
	if err := jsonUnmarshal(body, &req); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	err := a.store.Tx(ctx, func(tx pgx.Tx) error {
		e, txErr := a.store.LoadEventTx(ctx, tx, id)
		if txErr != nil {
			return txErr
		}
		if e == nil {
			return apiErr(404, "not_found", "That event is not available.")
		}
		from, _ := a.store.CalendarByID(ctx, e.CalendarID)
		to, txErr := a.store.CalendarByID(ctx, req.CalendarID)
		if txErr != nil {
			return txErr
		}
		if to == nil {
			return apiErr(404, "not_found", "Nothing is scheduled at this address.")
		}
		if to.ReadOnly {
			return apiErr(403, "forbidden", "Public holidays cannot be changed.")
		}
		if a.store.Access(ctx, person, from, e) != "full" || a.store.Access(ctx, person, to, nil) != "full" {
			return apiErr(403, "forbidden", "You need edit access on both calendars.")
		}
		if txErr := checkVersion(e, ifMatch); txErr != nil {
			return txErr
		}
		now := a.clock.Now()
		if _, err := tx.Exec(ctx, `UPDATE events SET calendar_id=$2, version=version+1, saved_at=$3,
		  saved_date=$4 WHERE id=$1`, id, req.CalendarID, now, InZone(now, e.Zone).Format("2006-01-02")); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		var vc *versionConflict
		if asVersionConflict(err, &vc) {
			a.writeConflict(ctx, resp, person, id)
			return nil
		}
		return err
	}
	e, _ := a.store.LoadEvent(ctx, id)
	a.broadcaster.BroadcastEvent(ctx, e)
	hours, _ := a.store.OfficeHoursAll(ctx)
	writeJSON(resp.w, http.StatusOK, ProjectEvent(e, nil, "full", person, hours))
	return nil
}

// handleZoneMove is POST /api/events/:id/zone-moves, the Move action.
func (a *App) handleZoneMove(ctx context.Context, resp *apiResponse, person *Person, id string, body []byte, ifMatch string) error {
	var req struct {
		RuleID string `json:"rule_id"`
	}
	if err := jsonUnmarshal(body, &req); err != nil {
		return apiErr(422, "invalid", "That is not valid JSON.")
	}
	err := a.store.Tx(ctx, func(tx pgx.Tx) error {
		e, txErr := a.store.LoadEventTx(ctx, tx, id)
		if txErr != nil {
			return txErr
		}
		if e == nil {
			return apiErr(404, "not_found", "That event is not available.")
		}
		cal, _ := a.store.CalendarByID(ctx, e.CalendarID)
		if a.store.Access(ctx, person, cal, e) != "full" {
			return apiErr(403, "forbidden", "Only full access may move for a zone rule.")
		}
		if txErr := checkVersion(e, ifMatch); txErr != nil {
			return txErr
		}
		rule, txErr := a.store.ZoneRuleByID(ctx, req.RuleID)
		if txErr != nil {
			return txErr
		}
		if rule == nil {
			return apiErr(404, "not_found", "That zone rule is not available.")
		}
		alreadyMoved := map[string]bool{}
		for _, r := range e.MovedRules {
			alreadyMoved[r] = true
		}
		rules := []*ZoneRule{rule}
		moved := map[string]bool{}
		// find the first warned occurrence for that rule
		occs := GenOccurrences(e, mustDate("1900-01-01"), mustDate("9999-12-31"), rules, moved)
		var firstWarned *Occurrence
		for _, o := range occs {
			if o.HasWarning && o.RuleID == rule.ID {
				firstWarned = o
				break
			}
		}
		if firstWarned == nil {
			return apiErr(409, "not_warned", "This event has no warned occurrence for that rule.")
		}
		// split there if there are earlier occurrences
		_ = alreadyMoved
		if firstWarned.OccurrenceID != firstOccurrenceID(e, rules) {
			newID, txErr := splitSeriesAt(ctx, a, tx, e, firstWarned, rules, moved)
			if txErr != nil {
				return txErr
			}
			e, txErr = a.store.LoadEventTx(ctx, tx, newID)
			if txErr != nil {
				return txErr
			}
		}
		// mark the rule moved, which clears its warnings and returns the
		// warned occurrences to their saved clock time
		if _, err := tx.Exec(ctx, `INSERT INTO zone_moves (event_id, rule_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			e.ID, rule.ID); err != nil {
			return err
		}
		now := a.clock.Now()
		if _, err := tx.Exec(ctx, `UPDATE events SET version=version+1, saved_at=$2, saved_date=$3 WHERE id=$1`,
			e.ID, now, InZone(now, e.Zone).Format("2006-01-02")); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		var vc *versionConflict
		if asVersionConflict(err, &vc) {
			a.writeConflict(ctx, resp, person, id)
			return nil
		}
		return err
	}
	e, _ := a.store.LoadEvent(ctx, id)
	a.broadcaster.BroadcastEvent(ctx, e)
	hours, _ := a.store.OfficeHoursAll(ctx)
	writeJSON(resp.w, http.StatusOK, map[string]any{
		"event": ProjectEvent(e, nil, "full", person, hours), "split": nil,
	})
	return nil
}

// Trash ---------------------------------------------------------------------

func (a *App) handleTrashList(ctx context.Context, resp *apiResponse, person *Person) error {
	rows, err := a.store.Pool().Query(ctx, `SELECT t.id, t.kind, t.title, t.event_id, t.occurrence_id, t.trashed_at, t.purge_at
	  FROM trash t JOIN events e ON e.id = t.event_id
	  WHERE t.purge_at > $2 AND (e.organiser_id = $1 OR EXISTS (
	    SELECT 1 FROM shares s WHERE s.calendar_id = e.calendar_id AND s.person_id = $1 AND s.level IN ('edit','manage')))
	  ORDER BY t.trashed_at DESC`, person.ID, a.clock.Now())
	if err != nil {
		return err
	}
	defer rows.Close()
	now := a.clock.Now()
	out := []map[string]any{}
	for rows.Next() {
		var id, kind, title, eventID string
		var occID *string
		var trashedAt, purgeAt time.Time
		if err := rows.Scan(&id, &kind, &title, &eventID, &occID, &trashedAt, &purgeAt); err != nil {
			return err
		}
		daysLeft := int((purgeAt.Sub(now) + 23*time.Hour) / (24 * time.Hour))
		out = append(out, map[string]any{
			"id": id, "kind": kind, "title": title, "event_id": eventID,
			"occurrence_id": occID, "trashed_at": trashedAt.UTC().Format(time.RFC3339),
			"purge_at": purgeAt.UTC().Format(time.RFC3339), "days_left": daysLeft,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i]["trashed_at"].(string) > out[j]["trashed_at"].(string)
	})
	return writeOkBody(resp, map[string]any{"items": out})
}

func (a *App) handleTrashRestore(ctx context.Context, resp *apiResponse, person *Person, id string) error {
	e, trash, err := a.loadTrash(ctx, id)
	if err != nil {
		return err
	}
	if trash == nil {
		return apiErr(404, "not_found", "That trash item is gone.")
	}
	if e.State != "trashed" {
		return apiErr(409, "not_trashed", "This item is not in the trash.")
	}
	if trash.Kind == "occurrence" {
		// its series must be live
		if e.State == "trashed" {
			return apiErr(409, "parent_trashed", "Restore the series first, then this occurrence.")
		}
		if _, err := a.store.Pool().Exec(ctx, `DELETE FROM exceptions WHERE event_id=$1 AND occurrence_id=$2`,
			e.ID, deref(trash.OccurrenceID)); err != nil {
			return err
		}
		_, _ = a.store.Pool().Exec(ctx, `DELETE FROM trash WHERE id=$1`, id)
		_, _ = a.store.Pool().Exec(ctx, `UPDATE events SET version=version+1 WHERE id=$1`, e.ID)
		a.restoreFutureReminders(ctx, e.ID)
		e, _ = a.store.LoadEvent(ctx, e.ID)
		a.broadcaster.BroadcastEvent(ctx, e)
		hours, _ := a.store.OfficeHoursAll(ctx)
		return writeOkBody(resp, map[string]any{"event": ProjectEvent(e, nil, "full", person, hours)})
	}
	if _, err := a.store.Pool().Exec(ctx, `UPDATE events SET state='restored', version=version+1 WHERE id=$1`, e.ID); err != nil {
		return err
	}
	_, _ = a.store.Pool().Exec(ctx, `DELETE FROM trash WHERE id=$1`, id)
	a.restoreFutureReminders(ctx, e.ID)
	e, _ = a.store.LoadEvent(ctx, e.ID)
	a.broadcaster.BroadcastEvent(ctx, e)
	hours, _ := a.store.OfficeHoursAll(ctx)
	return writeOkBody(resp, map[string]any{"event": ProjectEvent(e, nil, "full", person, hours)})
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (a *App) loadTrash(ctx context.Context, id string) (*Event, *TrashItem, error) {
	var item TrashItem
	var occID *string
	err := a.store.Pool().QueryRow(ctx, `SELECT id, kind, title, event_id, occurrence_id, trashed_at, purge_at
	  FROM trash WHERE id=$1`, id).Scan(&item.ID, &item.Kind, &item.Title, &item.EventID, &occID, &item.TrashedAt, &item.PurgeAt)
	if err != nil {
		return nil, nil, nil
	}
	item.OccurrenceID = occID
	if item.PurgeAt.Before(a.clock.Now()) {
		return nil, nil, nil
	}
	e, err := a.store.LoadEvent(ctx, item.EventID)
	if err != nil {
		return nil, nil, err
	}
	return e, &item, nil
}

func (a *App) handleTrashPurge(ctx context.Context, resp *apiResponse, person *Person, id string) error {
	e, trash, err := a.loadTrash(ctx, id)
	if err != nil {
		return err
	}
	if trash == nil {
		return apiErr(404, "not_found", "That trash item is gone.")
	}
	cal, _ := a.store.CalendarByID(ctx, e.CalendarID)
	if a.store.Access(ctx, person, cal, e) != "full" {
		return apiErr(403, "forbidden", "You need edit access on that event.")
	}
	if _, err := a.store.Pool().Exec(ctx, `UPDATE events SET state='purged' WHERE id=$1`, e.ID); err != nil {
		return err
	}
	_, _ = a.store.Pool().Exec(ctx, `DELETE FROM trash WHERE id=$1`, id)
	_, _ = a.store.Pool().Exec(ctx, `DELETE FROM notices WHERE person_id IN (SELECT person_id FROM guests WHERE event_id=$1) AND text LIKE '%'||$2||'%'`, e.ID, e.Title)
	resp.w.WriteHeader(http.StatusNoContent)
	return nil
}

// purgeSweep removes trashed items whose retention ended.
func (a *App) purgeSweep() {
	for range time.Tick(5 * time.Second) {
		ctx := context.Background()
		if !a.dbReady {
			continue
		}
		rows, err := a.store.Pool().Query(ctx, `SELECT id, event_id FROM trash WHERE purge_at <= $1`, a.clock.Now())
		if err != nil {
			continue
		}
		var ids []struct{ id, eventID string }
		for rows.Next() {
			var i struct{ id, eventID string }
			if err := rows.Scan(&i.id, &i.eventID); err == nil {
				ids = append(ids, i)
			}
		}
		rows.Close()
		for _, i := range ids {
			_, _ = a.store.Pool().Exec(ctx, `UPDATE events SET state='purged' WHERE id=$1 AND state='trashed'`, i.eventID)
			_, _ = a.store.Pool().Exec(ctx, `DELETE FROM trash WHERE id=$1`, i.id)
		}
	}
}

func (a *App) restoreFutureReminders(ctx context.Context, eventID string) {
	_, _ = a.store.Pool().Exec(ctx, `UPDATE reminders SET status='scheduled'
	  WHERE event_id=$1 AND status='cancelled' AND due_at > $2`, eventID, a.clock.Now())
}
