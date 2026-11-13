package main

import (
	"fmt"
	"net/http"
	"time"
)

// responderRequestView is the published request: the person is a name.
type responderRequestView struct {
	ID     string `json:"id"`
	Person string `json:"person"`
	State  string `json:"state"`
}

func (a *App) hRequestResponder(rq *Req) error {
	var body struct {
		PersonID string `json:"person_id"`
	}
	if err := rq.Decode(&body); err != nil {
		return fmt.Errorf("read responder request: %w", err)
	}
	incidentID := rq.Param("id")
	var view responderRequestView
	err := a.Do(rq.Ctx(), func(w *Work) error {
		var number int
		var status string
		var decidedBy *string
		var resolvedAt *time.Time
		err := w.Tx.QueryRow(w.Ctx, `select number, status, decided_by, resolved_at from incidents where id = $1`, incidentID).
			Scan(&number, &status, &decidedBy, &resolvedAt)
		if err != nil {
			return fmt.Errorf("read incident %s: %w", incidentID, err)
		}
		if status == "resolved" {
			return errConflict("already_decided", "decision", "resolved", "decided_by", *decidedBy, "decided_at", formatInstant(*resolvedAt))
		}
		var responding bool
		err = w.Tx.QueryRow(w.Ctx, `select $2 in (select unnest(holders) from incidents where id = $1)
			or exists (select 1 from incident_responders where incident_id = $1 and user_id = $2)
			or exists (select 1 from responder_requests where incident_id = $1 and person_id = $2 and state = 'requested')`,
			incidentID, body.PersonID).Scan(&responding)
		if err != nil {
			return fmt.Errorf("check responders: %w", err)
		}
		if responding {
			return errConflict("already_responding")
		}
		var personName string
		err = w.Tx.QueryRow(w.Ctx, `select name from users where id = $1 and removed_at is null and role <> 'stakeholder'`,
			body.PersonID).Scan(&personName)
		if isNoRows(err) {
			return errField("person_id", "Choose a person who can respond.")
		}
		if err != nil {
			return fmt.Errorf("read person %s: %w", body.PersonID, err)
		}
		view = responderRequestView{ID: newID(), Person: personName, State: "requested"}
		_, err = w.Tx.Exec(w.Ctx, `insert into responder_requests (id, incident_id, person_id, requested_by, state, created_at)
			values ($1, $2, $3, $4, $5, $6)`, view.ID, incidentID, body.PersonID, rq.Actor.Name, view.State, w.Now)
		if err != nil {
			return fmt.Errorf("save responder request: %w", err)
		}
		text := fmt.Sprintf("%s asked %s to join incident #%d", rq.Actor.Name, personName, number)
		if _, err := w.addTimeline(incidentID, "responder_requested", rq.Actor.Name, text, nil); err != nil {
			return fmt.Errorf("record responder request: %w", err)
		}
		if err := a.addResponderNotice(w, incidentID, body.PersonID); err != nil {
			return fmt.Errorf("notify responder: %w", err)
		}
		if err := w.finishResponderChange(incidentID, text); err != nil {
			return fmt.Errorf("finish responder change: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("add responder: %w", err)
	}
	return rq.JSON(http.StatusCreated, view)
}

// answerResponderRequest is accept or decline: only the person asked may answer, and the first answer stands.
func (a *App) answerResponderRequest(rq *Req, state, kind, format string) error {
	requestID := rq.Param("id")
	var view responderRequestView
	err := a.Do(rq.Ctx(), func(w *Work) error {
		var incidentID, personID, current string
		var number int
		err := w.Tx.QueryRow(w.Ctx, `select r.incident_id, r.person_id, u.name, r.state, i.number
			from responder_requests r join users u on u.id = r.person_id join incidents i on i.id = r.incident_id
			where r.id = $1`, requestID).Scan(&incidentID, &personID, &view.Person, &current, &number)
		if err != nil {
			return fmt.Errorf("read responder request %s: %w", requestID, err)
		}
		if personID != rq.Actor.ID {
			return errForbidden()
		}
		if current != "requested" {
			return errConflict("already_answered")
		}
		view.ID, view.State = requestID, state
		if _, err := w.Tx.Exec(w.Ctx, `update responder_requests set state = $2 where id = $1`, requestID, state); err != nil {
			return fmt.Errorf("answer responder request: %w", err)
		}
		if state == "accepted" {
			_, err := w.Tx.Exec(w.Ctx, `insert into incident_responders (incident_id, user_id, joined_at) values ($1, $2, $3)
				on conflict do nothing`, incidentID, personID, w.Now)
			if err != nil {
				return fmt.Errorf("add responder: %w", err)
			}
		}
		text := fmt.Sprintf(format, view.Person, number)
		if _, err := w.addTimeline(incidentID, kind, view.Person, text, nil); err != nil {
			return fmt.Errorf("record responder answer: %w", err)
		}
		if err := w.finishResponderChange(incidentID, text); err != nil {
			return fmt.Errorf("finish responder change: %w", err)
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("remove responder: %w", err)
	}
	return rq.JSON(http.StatusOK, view)
}

// finishResponderChange raises the incident's version and announces the entry just written.
func (w *Work) finishResponderChange(incidentID, announce string) error {
	if err := w.touchIncident(incidentID); err != nil {
		return fmt.Errorf("raise incident version: %w", err)
	}
	if err := w.publishIncident(incidentID, announce); err != nil {
		return fmt.Errorf("publish incident: %w", err)
	}
	return nil
}

func (a *App) hAcceptResponder(rq *Req) error {
	if err := a.answerResponderRequest(rq, "accepted", "responder_accepted", "%s joined incident #%d"); err != nil {
		return fmt.Errorf("accept responder request: %w", err)
	}
	return nil
}

func (a *App) hDeclineResponder(rq *Req) error {
	if err := a.answerResponderRequest(rq, "declined", "responder_declined", "%s declined to join incident #%d"); err != nil {
		return fmt.Errorf("decline responder request: %w", err)
	}
	return nil
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "POST /api/incidents/{id}/responder-requests", Access: accStaff, Resource: "incident", KeyWrite: true, Handler: a.hRequestResponder})
		a.route(route{Pattern: "POST /api/responder-requests/{id}/accept", Access: accStaff, Resource: "request", Handler: a.hAcceptResponder})
		a.route(route{Pattern: "POST /api/responder-requests/{id}/decline", Access: accStaff, Resource: "request", Handler: a.hDeclineResponder})
	})
}
