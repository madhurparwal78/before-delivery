package api

import (
	"net/http"
	"time"

	"github.com/cinderlatch/holdfast/internal/apierr"
	"github.com/cinderlatch/holdfast/internal/gamemap"
	"github.com/cinderlatch/holdfast/internal/sim"
	"github.com/cinderlatch/holdfast/internal/store"
)

func serviceState(up bool) string {
	if up {
		return "up"
	}
	return "down"
}

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"build":   s.cfg.Build,
		"tick_hz": sim.TickHz,
		"services": map[string]string{
			"postgres": serviceState(s.store.Up()),
			"valkey":   serviceState(s.registry.Up()),
			"mail":     serviceState(s.mail.Up()),
		},
		"mail_queued": s.outbox.QueuedCount(),
		"server_time": s.clock.Now().Format(time.RFC3339),
		"studio_zone": s.zone.String(),
	})
}

func (s *Server) handleStudio(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name": store.StudioName,
		"zone": s.zone.String(),
	})
}

func (s *Server) clockBody() map[string]any {
	now := s.clock.Now()
	return map[string]any{
		"now":          now.Format(time.RFC3339),
		"studio_local": now.In(s.zone).Format("2006-01-02T15:04:05"),
		"studio_zone":  s.zone.String(),
		"overridden":   s.clock.Overridden(),
	}
}

func (s *Server) handleGetClock(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.clockBody())
}

func (s *Server) handlePutClock(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.ClockControl {
		apierr.Write(w, apierr.NotFound())
		return
	}
	var body struct {
		Now string `json:"now"`
	}
	if failure := decode(r, &body); failure != nil {
		apierr.Write(w, failure)
		return
	}
	at, err := time.Parse(time.RFC3339, body.Now)
	if err != nil {
		apierr.Write(w, apierr.Field("now", "Use an RFC 3339 instant with an offset."))
		return
	}
	s.clock.Set(at.UTC())
	writeJSON(w, http.StatusOK, s.clockBody())
}

func (s *Server) handleDeleteClock(w http.ResponseWriter, _ *http.Request) {
	if !s.cfg.ClockControl {
		apierr.Write(w, apierr.NotFound())
		return
	}
	s.clock.Clear()
	writeJSON(w, http.StatusOK, s.clockBody())
}

func (s *Server) handleMap(w http.ResponseWriter, r *http.Request) {
	found, ok := gamemap.Get(r.PathValue("id"))
	if !ok {
		apierr.Write(w, apierr.NotFound())
		return
	}
	writeJSON(w, http.StatusOK, found)
}
