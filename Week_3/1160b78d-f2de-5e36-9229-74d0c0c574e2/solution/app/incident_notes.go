package main

import (
	"fmt"
	"net/http"
	"strconv"
	"time"
	"unicode/utf8"
)

const (
	maxNoteLength = 10000
	noteSentence  = "Note must be 1 to 10000 characters."
)

// timelineEntry is the published timeline entry a new note answers with.
type timelineEntry struct {
	ID    string `json:"id"`
	At    string `json:"at"`
	Kind  string `json:"kind"`
	Actor string `json:"actor"`
	Text  string `json:"text"`
}

// noteDraft is a person's unsent note on one incident.
type noteDraft struct {
	Body    string  `json:"body"`
	SavedAt *string `json:"saved_at"`
}

// touchIncident raises the incident's version, because its published record changed.
func (w *Work) touchIncident(incidentID string) error {
	if _, err := w.Tx.Exec(w.Ctx, `update incidents set version = version + 1 where id = $1`, incidentID); err != nil {
		return fmt.Errorf("raise incident version: %w", err)
	}
	return nil
}

// publishDraftChange tells the person's other tabs that their draft on an incident changed. The draft itself is not
// sent, because the socket reaches everybody; the tab of draft_for reads it back from the note-draft endpoint.
func (w *Work) publishDraftChange(incidentID, userID string) error {
	item, err := w.A.incidentListItem(w.Ctx, w.Tx, incidentID, firmZone)
	if err != nil {
		return fmt.Errorf("render incident %s: %w", incidentID, err)
	}
	w.Publish("incident", map[string]any{"incident_id": incidentID, "announce": "", "item": item, "draft_for": userID})
	return nil
}

func (a *App) hAddNote(rq *Req) error {
	err := rq.Idempotent(func() error {
		if err := a.addNote(rq); err != nil {
			return fmt.Errorf("add note: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("add note idempotently: %w", err)
	}
	return nil
}

func (a *App) addNote(rq *Req) error {
	var body struct {
		Body string `json:"body"`
	}
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read note: %w", err)
	}
	if length := utf8.RuneCountInString(body.Body); length < 1 || length > maxNoteLength {
		return errField("body", noteSentence)
	}
	incidentID := rq.Param("id")
	var entry timelineEntry
	err := a.Do(rq.Ctx(), func(w *Work) error {
		id, err := w.addTimeline(incidentID, "note", rq.Actor.Name, body.Body, nil)
		if err != nil {
			return fmt.Errorf("add note: %w", err)
		}
		entry = timelineEntry{ID: strconv.FormatInt(id, 10), At: formatInstant(w.Now), Kind: "note", Actor: rq.Actor.Name, Text: body.Body}
		if err := w.touchIncident(incidentID); err != nil {
			return fmt.Errorf("raise incident version: %w", err)
		}
		if err := w.publishIncident(incidentID, ""); err != nil {
			return fmt.Errorf("publish incident: %w", err)
		}
		if rq.Actor.IsKey() {
			return nil
		}
		if _, err := w.Tx.Exec(w.Ctx, `delete from note_drafts where incident_id = $1 and user_id = $2`, incidentID, rq.Actor.ID); err != nil {
			return fmt.Errorf("clear note draft: %w", err)
		}
		if err := w.publishDraftChange(incidentID, rq.Actor.ID); err != nil {
			return fmt.Errorf("publish draft change: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("add note: %w", err)
	}
	return rq.JSON(http.StatusCreated, entry)
}

func (a *App) hGetNoteDraft(rq *Req) error {
	if rq.Actor.IsKey() {
		return errForbidden()
	}
	draft := noteDraft{}
	var savedAt time.Time
	err := a.db.QueryRow(rq.Ctx(), `select body, saved_at from note_drafts where incident_id = $1 and user_id = $2`,
		rq.Param("id"), rq.Actor.ID).Scan(&draft.Body, &savedAt)
	if err != nil && !isNoRows(err) {
		return fmt.Errorf("read note draft: %w", err)
	}
	if err == nil {
		stamp := formatInstant(savedAt)
		draft.SavedAt = &stamp
	}
	return rq.JSON(http.StatusOK, draft)
}

func (a *App) hPutNoteDraft(rq *Req) error {
	if rq.Actor.IsKey() {
		return errForbidden()
	}
	var body struct {
		Body string `json:"body"`
	}
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read draft: %w", err)
	}
	if utf8.RuneCountInString(body.Body) > maxNoteLength {
		return errField("body", noteSentence)
	}
	incidentID := rq.Param("id")
	var saved string
	err := a.Do(rq.Ctx(), func(w *Work) error {
		_, err := w.Tx.Exec(w.Ctx, `insert into note_drafts (incident_id, user_id, body, saved_at) values ($1, $2, $3, $4)
			on conflict (incident_id, user_id) do update set body = excluded.body, saved_at = excluded.saved_at`,
			incidentID, rq.Actor.ID, body.Body, w.Now)
		if err != nil {
			return fmt.Errorf("save note draft: %w", err)
		}
		saved = formatInstant(w.Now)
		if err := w.publishDraftChange(incidentID, rq.Actor.ID); err != nil {
			return fmt.Errorf("publish draft change: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("save draft: %w", err)
	}
	return rq.JSON(http.StatusOK, noteDraft{Body: body.Body, SavedAt: &saved})
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "POST /api/incidents/{id}/notes", Access: accStaff, Resource: "incident", KeyWrite: true, Handler: a.hAddNote})
		a.route(route{Pattern: "GET /api/incidents/{id}/note-draft", Access: accStaff, Resource: "incident", Handler: a.hGetNoteDraft})
		a.route(route{Pattern: "PUT /api/incidents/{id}/note-draft", Access: accStaff, Resource: "incident", Handler: a.hPutNoteDraft})
	})
}
