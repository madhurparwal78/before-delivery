package core

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// scheduleSteps writes one person's notification steps for an incident: an
// in-app notice at once, then mail at that person's own delays.
func (a *App) scheduleSteps(ctx context.Context, inc *incidentRow, personID, assignmentID string, from time.Time) error {
	user, err := a.UserByID(ctx, personID)
	if err != nil {
		return err
	}
	insert := func(kind, channel string, due time.Time, status string, heldUntil *time.Time, sentAt *time.Time) error {
		_, err := a.pool.Exec(ctx, `INSERT INTO notification_steps (id, incident_id, person_id, assignment_id, kind,
			channel, due_at, held_until, status, sent_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			newID(), inc.ID, personID, assignmentID, kind, channel, due, heldUntil, status, sentAt, from)
		if err != nil {
			return fmt.Errorf("write notification step: %w", err)
		}
		return nil
	}
	if err := insert("step", "in_app", from, "sent", nil, &from); err != nil {
		return err
	}
	if inc.Urgency == "high" {
		for _, delay := range user.NotificationDelays {
			if err := insert("step", "email", from.Add(time.Duration(delay)*time.Minute), "scheduled", nil, nil); err != nil {
				return err
			}
		}
		return nil
	}
	due := from.Add(time.Duration(user.LowUrgencyDelay) * time.Minute)
	if hold := quietHold(user, due); hold != nil {
		return insert("low_urgency", "email", due, "held", hold, nil)
	}
	return insert("low_urgency", "email", due, "scheduled", nil, nil)
}

// quietHold answers when a low-urgency notice may go out, in the holder's own
// zone, or nil when quiet hours do not cover it.
func quietHold(user *User, due time.Time) *time.Time {
	if user.QuietStart == nil || user.QuietEnd == nil {
		return nil
	}
	sh, sm, okStart := parseHHMM(*user.QuietStart)
	eh, em, okEnd := parseHHMM(*user.QuietEnd)
	if !okStart || !okEnd {
		return nil
	}
	loc := zoneOr(user.Timezone)
	day := wallOf(due, loc)
	start := resolveWall(loc, day.withTime(sh, sm))
	end := resolveWall(loc, day.withTime(eh, em))
	if (eh*60 + em) <= (sh*60 + sm) {
		if !due.Before(start) {
			next := resolveWall(loc, day.addDays(1).withTime(eh, em))
			return &next
		}
		if due.Before(end) {
			return &end
		}
		return nil
	}
	if !due.Before(start) && due.Before(end) {
		return &end
	}
	return nil
}

func (a *App) cancelSteps(ctx context.Context, incidentID string, personID *string) error {
	query := `UPDATE notification_steps SET status='cancelled' WHERE incident_id=$1 AND status IN ('scheduled','held')`
	args := []any{incidentID}
	if personID != nil {
		query += ` AND person_id=$2`
		args = append(args, *personID)
	}
	if _, err := a.pool.Exec(ctx, query, args...); err != nil {
		return fmt.Errorf("cancel steps: %w", err)
	}
	return nil
}

// sendDueSteps queues each due step as mail, while the incident still needs
// that person.
func (a *App) sendDueSteps(ctx context.Context, now time.Time) error {
	rows, err := a.pool.Query(ctx, `SELECT s.id, s.incident_id, s.person_id, s.kind, s.status, s.held_until, s.due_at,
		i.number, i.title, i.status, u.email
		FROM notification_steps s JOIN incidents i ON i.id = s.incident_id JOIN users u ON u.id = s.person_id
		WHERE s.channel='email' AND s.status IN ('scheduled','held')
		  AND coalesce(s.held_until, s.due_at) <= $1 ORDER BY coalesce(s.held_until, s.due_at)`, now)
	if err != nil {
		return fmt.Errorf("read due steps: %w", err)
	}
	type dueStep struct {
		id, incidentID, personID, kind, status, title, incidentStatus, email string
		number                                                               int64
	}
	var due []dueStep
	for rows.Next() {
		var s dueStep
		var heldUntil, dueAt time.Time
		var held *time.Time
		if err := rows.Scan(&s.id, &s.incidentID, &s.personID, &s.kind, &s.status, &held, &dueAt,
			&s.number, &s.title, &s.incidentStatus, &s.email); err != nil {
			rows.Close()
			return fmt.Errorf("read due step: %w", err)
		}
		_ = heldUntil
		due = append(due, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, s := range due {
		var holds int
		if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM incident_holders WHERE incident_id=$1 AND person_id=$2`,
			s.incidentID, s.personID).Scan(&holds); err != nil {
			return fmt.Errorf("check holder: %w", err)
		}
		if s.incidentStatus != "triggered" || holds == 0 {
			if _, err := a.pool.Exec(ctx, `UPDATE notification_steps SET status='cancelled' WHERE id=$1`, s.id); err != nil {
				return fmt.Errorf("cancel step: %w", err)
			}
			continue
		}
		subject := fmt.Sprintf("[Switchlamp] Incident #%d needs you: %s", s.number, s.title)
		if s.kind == "low_urgency" {
			subject = fmt.Sprintf("[Switchlamp] Low urgency incident #%d: %s", s.number, s.title)
		}
		body := fmt.Sprintf("Incident #%d: %s\n\nAcknowledge: %s/ack/%s\n",
			s.number, s.title, a.publicURL(), a.ackToken(s.id))
		if _, err := a.pool.Exec(ctx, `UPDATE notification_steps SET status='queued' WHERE id=$1`, s.id); err != nil {
			return fmt.Errorf("queue step: %w", err)
		}
		if err := a.queueMail(ctx, s.email, subject, body, &s.id, now); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) publicURL() string {
	if a.Cfg.PublicURL != "" {
		return a.Cfg.PublicURL
	}
	return fmt.Sprintf("http://127.0.0.1:%d", a.Cfg.Port)
}

func (a *App) ackToken(stepID string) string {
	mac := hmac.New(sha256.New, a.signingSecret())
	mac.Write([]byte("ack:" + stepID))
	return stepID + "." + hex.EncodeToString(mac.Sum(nil))[:32]
}

func (a *App) verifyAckToken(token string) (string, bool) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return "", false
	}
	if !hmac.Equal([]byte(a.ackToken(parts[0])), []byte(token)) {
		return "", false
	}
	return parts[0], true
}

// AckPage is what an acknowledge link shows.
type AckPage struct {
	State    string
	Number   int64
	Title    string
	Name     string
	Token    string
	HTTPCode int
}

// AckLink answers the first page that applies for an acknowledge link, and on a
// commit acknowledges the incident once.
func (a *App) AckLink(ctx context.Context, token string, commit bool) (AckPage, error) {
	stepID, ok := a.verifyAckToken(token)
	if !ok {
		return AckPage{State: "invalid", HTTPCode: 404}, nil
	}
	var incidentID, personID string
	var dueAt time.Time
	err := a.pool.QueryRow(ctx, `SELECT incident_id, person_id, due_at FROM notification_steps WHERE id=$1`, stepID).
		Scan(&incidentID, &personID, &dueAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return AckPage{State: "invalid", HTTPCode: 404}, nil
	}
	if err != nil {
		return AckPage{}, fmt.Errorf("read step: %w", err)
	}
	person, err := a.UserByID(ctx, personID)
	if err != nil {
		return AckPage{}, err
	}
	inc, err := a.loadIncident(ctx, incidentID)
	if err != nil {
		return AckPage{}, err
	}
	page := AckPage{Number: inc.Number, Title: inc.Title, Token: token, HTTPCode: 200}

	var usedBy string
	err = a.pool.QueryRow(ctx, `SELECT u.name FROM ack_link_uses l JOIN users u ON u.id = l.person_id WHERE l.step_id=$1`, stepID).Scan(&usedBy)
	if err == nil {
		page.State = "used"
		page.Name = usedBy
		page.HTTPCode = 410
		return page, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return AckPage{}, fmt.Errorf("read link use: %w", err)
	}

	if inc.Status == "resolved" {
		page.State = "out_of_date"
		page.HTTPCode = 410
		return page, nil
	}
	if inc.Status == "acknowledged" || inc.Status == "snoozed" {
		page.State = "used"
		page.HTTPCode = 410
		if inc.AcknowledgedBy != nil {
			page.Name = *inc.AcknowledgedBy
		}
		return page, nil
	}
	now := a.Clock.Now()
	var holds int
	if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM incident_holders WHERE incident_id=$1 AND person_id=$2`,
		incidentID, personID).Scan(&holds); err != nil {
		return AckPage{}, fmt.Errorf("check holder: %w", err)
	}
	expired := !now.Before(dueAt.Add(30 * time.Minute))
	if expired || holds == 0 {
		page.State = "out_of_date"
		page.HTTPCode = 410
		return page, nil
	}
	if !commit {
		page.State = "valid"
		page.Name = person.Name
		return page, nil
	}
	tag, err := a.pool.Exec(ctx, `INSERT INTO ack_link_uses (step_id, incident_id, person_id, used_at)
		VALUES ($1,$2,$3,$4) ON CONFLICT (step_id) DO NOTHING`, stepID, incidentID, personID, now)
	if err != nil {
		return AckPage{}, fmt.Errorf("record link use: %w", err)
	}
	if tag.RowsAffected() == 0 {
		page.State = "used"
		page.Name = person.Name
		page.HTTPCode = 410
		return page, nil
	}
	if _, err := a.Acknowledge(ctx, Actor{User: person}, incidentID); err != nil {
		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.Status == 409 {
			page.State = "used"
			page.Name = person.Name
			page.HTTPCode = 410
			return page, nil
		}
		return AckPage{}, err
	}
	page.State = "done"
	page.Name = person.Name
	return page, nil
}
