package api

import (
	"net/http"
	"strings"
)

func (s *Server) routes() {
	mux := http.NewServeMux()
	s.mux = mux

	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/time", s.handleTime)
	mux.HandleFunc("POST /api/session", s.handleSignIn)
	mux.HandleFunc("DELETE /api/session", s.handleSignOut)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("PATCH /api/me", s.handlePatchMe)
	mux.HandleFunc("GET /api/people", s.handlePeople)
	mux.HandleFunc("GET /api/calendars", s.handleCalendars)
	mux.HandleFunc("PATCH /api/calendars/{id}", s.handlePatchCalendar)

	mux.HandleFunc("GET /api/draft", s.handleGetDraft)
	mux.HandleFunc("PUT /api/draft", s.handlePutDraft)
	mux.HandleFunc("DELETE /api/draft", s.handleDeleteDraft)

	mux.HandleFunc("GET /api/occurrences", s.handleOccurrences)
	mux.HandleFunc("POST /api/events", s.handleCreateEvent)
	mux.HandleFunc("GET /api/events/{id}", s.handleGetEvent)
	mux.HandleFunc("PATCH /api/events/{id}", s.handlePatchEvent)
	mux.HandleFunc("DELETE /api/events/{id}", s.handleDeleteEvent)
	mux.HandleFunc("POST /api/events/{id}/duplicate", s.handleDuplicate)
	mux.HandleFunc("POST /api/events/{id}/move", s.handleMoveCalendar)
	mux.HandleFunc("GET /api/events/{id}/conflicts", s.handleConflicts)
	mux.HandleFunc("POST /api/events/{id}/guests", s.handleAddGuests)
	mux.HandleFunc("DELETE /api/events/{id}/guests/{personID}", s.handleRemoveGuest)
	mux.HandleFunc("PUT /api/events/{id}/replies/me", s.handleReply)
	mux.HandleFunc("POST /api/events/{id}/proposals", s.handleProposal)
	mux.HandleFunc("POST /api/proposals/{id}/accept", s.handleAcceptProposal)
	mux.HandleFunc("POST /api/proposals/{id}/decline", s.handleDeclineProposal)
	mux.HandleFunc("POST /api/events/{id}/share-link", s.handleCreateShareLink)
	mux.HandleFunc("DELETE /api/events/{id}/share-link", s.handleDeleteShareLink)
	mux.HandleFunc("POST /api/events/{id}/zone-moves", s.handleZoneMove)
	mux.HandleFunc("/api/share/{token}", s.handleSharedEvent)

	mux.HandleFunc("GET /api/shares", s.handleShares)
	mux.HandleFunc("PUT /api/calendars/{id}/shares/{personID}", s.handlePutShare)
	mux.HandleFunc("DELETE /api/calendars/{id}/shares/{personID}", s.handleDeleteShare)

	mux.HandleFunc("GET /api/settings", s.handleGetSettings)
	mux.HandleFunc("PATCH /api/settings", s.handlePatchSettings)
	mux.HandleFunc("GET /api/zone-rules", s.handleZoneRules)
	mux.HandleFunc("POST /api/zone-rules", s.handleRecordZoneRule)

	mux.HandleFunc("GET /api/trash", s.handleTrash)
	mux.HandleFunc("POST /api/trash/{id}/restore", s.handleRestore)
	mux.HandleFunc("DELETE /api/trash/{id}", s.handleDeleteForGood)

	mux.HandleFunc("GET /api/search", s.handleSearch)
	mux.HandleFunc("GET /api/find-a-time", s.handleFindATime)
	mux.HandleFunc("GET /api/notices", s.handleNotices)
	mux.HandleFunc("GET /api/reminders", s.handleReminders)
	mux.HandleFunc("POST /api/reminders/{id}/snooze", s.handleSnooze)

	mux.HandleFunc("POST /api/prints", s.handleCreatePrint)
	mux.HandleFunc("GET /api/prints", s.handlePrints)
	mux.HandleFunc("GET /api/prints/{id}", s.handlePrint)
	mux.HandleFunc("POST /api/prints/{id}/retry", s.handleRetryPrint)
	mux.HandleFunc("GET /api/prints/{id}/pdf", s.handlePrintPDF)

	mux.HandleFunc("POST /api/calendars/{id}/exports", s.handleExport)
	mux.HandleFunc("GET /api/exports/{id}/file", s.handleExportFile)
	mux.HandleFunc("POST /api/calendars/{id}/imports", s.handleImport)

	mux.HandleFunc("GET /api/live", s.handleLive)

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		notFound(w)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.Ping(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "starting"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (s *Server) handleTime(w http.ResponseWriter, r *http.Request) {
	zone := "UTC"
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		if person, err := s.Store.SessionPerson(r.Context(), cookie.Value); err == nil {
			zone = person.Zone
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"now_utc": s.Clock.Now().Format("2006-01-02T15:04:05.000Z07:00"),
		"zone":    zone,
	})
}

func pathValue(r *http.Request, name string) string {
	return strings.TrimSpace(r.PathValue(name))
}
