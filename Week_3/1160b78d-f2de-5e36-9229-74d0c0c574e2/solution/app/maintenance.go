package main

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

const (
	windowUpcoming = "upcoming"
	windowRunning  = "running"
	windowEnded    = "ended"

	windowEndSentence    = "The window must end after it starts."
	windowStartSentence  = "The window cannot start in the past."
	windowTimeSentence   = "Use the format YYYY-MM-DD HH:MM."
	windowStartTimerKind = "window_start"
	windowEndTimerKind   = "window_end"
)

// maintenanceWindow is a stretch of time in which a service is under maintenance. EndedAt is set when an admin ends it
// early.
type maintenanceWindow struct {
	ID        string
	ServiceID string
	StartsAt  time.Time
	EndsAt    time.Time
	EndedAt   *time.Time
}

// stateAt is the one place a window's state is named, by the edge rule: it includes its start second and excludes its
// end second, and an early end counts as the end.
func (m maintenanceWindow) stateAt(at time.Time) string {
	end := m.EndsAt
	if m.EndedAt != nil && !instantReached(*m.EndedAt, end) {
		end = *m.EndedAt
	}
	switch {
	case instantReached(at, end):
		return windowEnded
	case instantReached(at, m.StartsAt):
		return windowRunning
	}
	return windowUpcoming
}

// windowView is the published window.
type windowView struct {
	ID        string `json:"id"`
	ServiceID string `json:"service_id"`
	StartsAt  string `json:"starts_at"`
	EndsAt    string `json:"ends_at"`
	State     string `json:"state"`
}

func (m maintenanceWindow) view(at time.Time) windowView {
	return windowView{ID: m.ID, ServiceID: m.ServiceID, StartsAt: formatInstant(m.StartsAt), EndsAt: formatInstant(m.EndsAt), State: m.stateAt(at)}
}

// loadWindows reads the windows of one service, or of every service when serviceID is empty, by start.
func loadWindows(ctx context.Context, q dbq, serviceID string) ([]maintenanceWindow, error) {
	rows, err := q.Query(ctx, `select id, service_id, starts_at, ends_at, ended_at from maintenance_windows
		where $1 = '' or service_id = $1 order by starts_at, id`, serviceID)
	if err != nil {
		return nil, fmt.Errorf("read maintenance windows: %w", err)
	}
	defer rows.Close()
	var windows []maintenanceWindow
	for rows.Next() {
		var window maintenanceWindow
		if err := rows.Scan(&window.ID, &window.ServiceID, &window.StartsAt, &window.EndsAt, &window.EndedAt); err != nil {
			return nil, fmt.Errorf("scan maintenance window: %w", err)
		}
		windows = append(windows, window)
	}
	if err := rows.Err(); err != nil {
		return windows, fmt.Errorf("read maintenance windows: %w", err)
	}
	return windows, nil
}

// serviceInMaintenance reports whether a maintenance window covers the service at an instant.
func (a *App) serviceInMaintenance(ctx context.Context, q dbq, serviceID string, at time.Time) (bool, error) {
	windows, err := loadWindows(ctx, q, serviceID)
	if err != nil {
		return false, fmt.Errorf("load maintenance windows: %w", err)
	}
	for _, window := range windows {
		if window.stateAt(at) == windowRunning {
			return true, nil
		}
	}
	return false, nil
}

func (a *App) hListWindows(rq *Req) error {
	windows, err := loadWindows(rq.Ctx(), a.db, "")
	if err != nil {
		return fmt.Errorf("list maintenance windows: %w", err)
	}
	now := a.clock.Now()
	items := make([]windowView, 0, len(windows))
	for _, window := range windows {
		items = append(items, window.view(now))
	}
	return rq.JSON(http.StatusOK, map[string]any{"items": items})
}

// parseWindowInstant reads an instant field of a window, reporting the field's sentence when it cannot be read.
func parseWindowInstant(field, text string, problems map[string]string) time.Time {
	instant, err := parseInstant(text)
	if err != nil {
		problems[field] = windowTimeSentence
	}
	return instant
}

func (a *App) hCreateWindow(rq *Req) error {
	var in struct {
		ServiceID string `json:"service_id"`
		StartsAt  string `json:"starts_at"`
		EndsAt    string `json:"ends_at"`
	}
	if err := rq.Decode(&in); err != nil {
		return fmt.Errorf("read maintenance window: %w", err)
	}
	var created windowView
	err := a.Do(rq.Ctx(), func(w *Work) error {
		problems := map[string]string{}
		var serviceFound bool
		if err := w.Tx.QueryRow(w.Ctx, `select exists (select 1 from services where id = $1)`, in.ServiceID).Scan(&serviceFound); err != nil {
			return fmt.Errorf("check service %s: %w", in.ServiceID, err)
		}
		if !serviceFound {
			problems["service_id"] = chooseServiceSentence
		}
		starts := parseWindowInstant("starts_at", in.StartsAt, problems)
		ends := parseWindowInstant("ends_at", in.EndsAt, problems)
		if _, bad := problems["starts_at"]; !bad && !instantReached(starts, w.Now) {
			problems["starts_at"] = windowStartSentence
		}
		if _, bad := problems["ends_at"]; !bad && instantReached(starts, ends) {
			problems["ends_at"] = windowEndSentence
		}
		if len(problems) > 0 {
			return errFields(problems)
		}
		window := maintenanceWindow{ID: newID(), ServiceID: in.ServiceID, StartsAt: starts, EndsAt: ends}
		_, err := w.Tx.Exec(w.Ctx, `insert into maintenance_windows (id, service_id, starts_at, ends_at, created_at)
			values ($1, $2, $3, $4, $5)`, window.ID, window.ServiceID, window.StartsAt, window.EndsAt, w.Now)
		if err != nil {
			return fmt.Errorf("insert maintenance window: %w", err)
		}
		if err := w.setTimer(windowStartTimerKind, window.ID, window.StartsAt); err != nil {
			return fmt.Errorf("arm window start: %w", err)
		}
		if err := w.setTimer(windowEndTimerKind, window.ID, window.EndsAt); err != nil {
			return fmt.Errorf("arm window end: %w", err)
		}
		w.catalogChanged()
		created = window.view(w.Now)
		return nil
	})
	if err != nil {
		return fmt.Errorf("create maintenance window: %w", err)
	}
	return rq.JSON(http.StatusCreated, created)
}

// hEndWindow ends a window at once.
func (a *App) hEndWindow(rq *Req) error {
	id := rq.Param("id")
	err := a.Do(rq.Ctx(), func(w *Work) error {
		_, err := w.Tx.Exec(w.Ctx, `update maintenance_windows set ended_at = $2 where id = $1 and ended_at is null`, id, w.Now)
		if err != nil {
			return fmt.Errorf("end maintenance window %s: %w", id, err)
		}
		for _, kind := range []string{windowStartTimerKind, windowEndTimerKind} {
			if err := w.clearTimer(kind, id); err != nil {
				return fmt.Errorf("disarm window timer: %w", err)
			}
		}
		w.catalogChanged()
		return nil
	})
	if err != nil {
		return fmt.Errorf("delete maintenance window: %w", err)
	}
	return rq.NoContent()
}

// windowEdge fires at a window's start and end second: banners and statuses change there.
func windowEdge(_ *App, w *Work, _ string) error {
	w.catalogChanged()
	return nil
}

func init() {
	timerHandlers[windowStartTimerKind] = windowEdge
	timerHandlers[windowEndTimerKind] = windowEdge
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "GET /api/maintenance-windows", Access: accStaff, Handler: a.hListWindows})
		a.route(route{Pattern: "POST /api/maintenance-windows", Access: accAdmin, Handler: a.hCreateWindow})
		a.route(route{Pattern: "DELETE /api/maintenance-windows/{id}", Access: accAdmin, Resource: "window", Handler: a.hEndWindow})
	})
}
