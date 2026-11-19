package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/cinderlatch/holdfast/internal/apierr"
)

func limitParam(r *http.Request, fallback, highest int) int {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 || value > highest {
		return fallback
	}
	return value
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	matches, err := s.store.History(r.Context(), limitParam(r, 20, 50))
	if err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}

	rows := make([]map[string]any, 0, len(matches))
	for _, match := range matches {
		rows = append(rows, map[string]any{
			"id":            match.ID,
			"code":          match.Code,
			"mode":          match.Mode,
			"result":        match.Result,
			"waves_cleared": match.WavesCleared,
			"night_id":      match.NightID,
			"started_at":    match.StartedAt.Format(time.RFC3339),
			"ended_at":      match.EndedAt.Format(time.RFC3339),
			"players":       match.Players,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"matches": rows})
}

func (s *Server) handleLaps(w http.ResponseWriter, r *http.Request) {
	best, err := s.store.LapBoard(r.Context(), limitParam(r, 10, 50))
	if err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}

	rows := make([]map[string]any, 0, len(best))
	for index, lap := range best {
		rows = append(rows, map[string]any{
			"rank":     index + 1,
			"callsign": lap.Callsign,
			"lap_ms":   lap.LapMS,
			"set_at":   lap.SetAt.Format(time.RFC3339),
			"match_id": lap.MatchID,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"laps": rows})
}
