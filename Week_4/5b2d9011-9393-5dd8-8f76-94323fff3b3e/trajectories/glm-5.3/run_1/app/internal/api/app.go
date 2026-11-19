// Package api serves every /api/ endpoint.
package api

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"holdfast/internal/apperr"
	"holdfast/internal/clock"
	"holdfast/internal/config"
	"holdfast/internal/httpx"
	"holdfast/internal/rooms"
	"holdfast/internal/store"
	"holdfast/internal/studio"
	"holdfast/internal/zoneinfo"
)

// App carries every dependency the API needs.
type App struct {
	Cfg      config.Config
	Clock    *clock.Clock
	Store    *store.Store
	Hub      *rooms.Hub
	Studio   studio.Zone
	StudioName string

	Mail struct {
		Up bool
		From string
		Host string
		Port int
	}

	mu          sync.RWMutex
	pgUp        bool
	valkeyUp    bool
	mailUp      bool
	mailQueued  int
}

// NewApp wires the app.
func NewApp(cfg config.Config, c *clock.Clock, st *store.Store, hub *rooms.Hub, studioZone studio.Zone, studioName string) *App {
	a := &App{
		Cfg: cfg, Clock: c, Store: st, Hub: hub, Studio: studioZone, StudioName: studioName,
	}
	a.Mail.From = cfg.MailFrom
	a.Mail.Host = cfg.SMTPHost
	a.Mail.Port = cfg.SMTPPort
	return a
}

// SetService records a probe result.
func (a *App) SetService(name string, up bool) {
	a.mu.Lock()
	switch name {
	case "postgres":
		a.pgUp = up
	case "valkey":
		a.valkeyUp = up
	case "mail":
		a.mailUp = up
	}
	a.mu.Unlock()
	if name == "valkey" {
		a.Hub.SetValkeyUp(up)
	}
}

// SetQueued records the queued mail count.
func (a *App) SetQueued(n int) {
	a.mu.Lock()
	a.mailQueued = n
	a.mu.Unlock()
}

// ServiceUp reports a probe result.
func (a *App) ServiceUp(name string) bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	switch name {
	case "postgres":
		return a.pgUp
	case "valkey":
		return a.valkeyUp
	case "mail":
		return a.mailUp
	}
	return false
}

// Queued returns the queued mail count.
func (a *App) Queued() int {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.mailQueued
}

// Handle is the /api/ entry point.
func (a *App) Handle(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api")
	path = strings.TrimPrefix(path, "/")
	if err := httpx.SameOrigin(r); err != nil {
		httpx.WriteError(w, err)
		return
	}
	switch {
	case path == "health" && r.Method == http.MethodGet:
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	case path == "status" && r.Method == http.MethodGet:
		a.handleStatus(w)
	case path == "studio" && r.Method == http.MethodGet:
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"name": a.StudioName, "zone": a.Studio.Name})
	case path == "clock" && r.Method == http.MethodGet:
		a.handleClockGet(w)
	case path == "clock" && r.Method == http.MethodPut:
		a.handleClockPut(w, r)
	case path == "clock" && r.Method == http.MethodDelete:
		a.handleClockDelete(w)
	case path == "sessions" && r.Method == http.MethodPost:
		a.handleSessionPost(w, r)
	case path == "me" && r.Method == http.MethodGet:
		a.handleMeGet(w, r)
	case path == "me" && r.Method == http.MethodDelete:
		a.handleMeDelete(w, r)
	case path == "me/settings" && r.Method == http.MethodGet:
		a.handleSettingsGet(w, r)
	case path == "me/settings" && r.Method == http.MethodPut:
		a.handleSettingsPut(w, r)
	case strings.HasPrefix(path, "rooms"):
		a.handleRooms(w, r, strings.TrimPrefix(path, "rooms"))
	case strings.HasPrefix(path, "history"):
		a.handleHistory(w, r)
	case strings.HasPrefix(path, "laps"):
		a.handleLaps(w, r)
	case strings.HasPrefix(path, "maps/"):
		a.handleMap(w, r, strings.TrimPrefix(path, "maps/"))
	case path == "prices" && (r.Method == http.MethodGet || r.Method == http.MethodPost):
		a.handlePrices(w, r)
	case strings.HasPrefix(path, "prices/"):
		a.handlePriceDelete(w, r, strings.TrimPrefix(path, "prices/"))
	case strings.HasPrefix(path, "nights"):
		a.handleNights(w, r, strings.TrimPrefix(path, "nights"))
	default:
		httpx.WriteError(w, apperr.NotFound)
	}
}

func (a *App) handleStatus(w http.ResponseWriter) {
	now := a.Clock.Now().UTC()
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"build": a.Cfg.Build,
		"tick_hz": 20,
		"services": map[string]string{
			"postgres": upDown(a.ServiceUp("postgres")),
			"valkey":   upDown(a.ServiceUp("valkey")),
			"mail":     upDown(a.ServiceUp("mail")),
		},
		"mail_queued": a.Queued(),
		"server_time": clock.Instant(now),
		"studio_zone": a.Studio.Name,
	})
}

func upDown(up bool) string {
	if up {
		return "up"
	}
	return "down"
}

func (a *App) handleClockGet(w http.ResponseWriter) {
	now := a.Clock.Now().UTC()
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"now":          clock.Instant(now),
		"studio_local":  now.In(a.Studio.Loc).Format("2006-01-02T15:04:05"),
		"studio_zone":  a.Studio.Name,
		"overridden":   a.Clock.Overridden(),
	})
}

func (a *App) handleClockPut(w http.ResponseWriter, r *http.Request) {
	if !a.Cfg.ClockControl {
		httpx.WriteError(w, apperr.NotFound)
		return
	}
	var body struct {
		Now string `json:"now"`
	}
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, err)
		return
	}
	t, err := parseInstantWithOffset(body.Now)
	if err != nil {
		httpx.WriteError(w, apperr.SingleValidation("now", "Use an RFC 3339 instant with an offset."))
		return
	}
	a.Clock.Set(t.UTC())
	a.handleClockGet(w)
}

func (a *App) handleClockDelete(w http.ResponseWriter) {
	if !a.Cfg.ClockControl {
		httpx.WriteError(w, apperr.NotFound)
		return
	}
	a.Clock.Clear()
	a.handleClockGet(w)
}

func parseInstantWithOffset(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, errEmpty
	}
	return time.Parse(time.RFC3339, s)
}

type emptyErr struct{}

func (emptyErr) Error() string { return "empty instant" }

var errEmpty = emptyErr{}

// ctxWithTimeout is the standard request context.
func ctxWithTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 5*time.Second)
}

// MailTimeIn renders an instant in the published email shape for a zone.
func (a *App) MailTimeIn(t time.Time, zone string) string {
	return mailTime(t, zone)
}

// UTCOffsetAt formats the UTC offset of an instant.
func (a *App) UTCOffsetAt(t time.Time) string {
	return zoneinfo.UTCOffset(t, a.Studio.Loc)
}
