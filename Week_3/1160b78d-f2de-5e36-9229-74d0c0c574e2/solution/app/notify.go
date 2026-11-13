package main

import (
	"context"
	"fmt"
	"time"
)

const quietClockLayout = "15:04"

// incidentFacts is what a step's mail says about its incident.
type incidentFacts struct {
	Number     int
	Title      string
	Urgency    string
	Assignment int
}

// personFacts is a holder's notification settings.
type personFacts struct {
	ID         string
	Email      string
	Zone       string
	QuietStart *string
	QuietEnd   *string
	Delays     []int
	LowDelay   int
}

// plannedStep is one email step before it is written: the second it is due and, for a notice held through quiet hours,
// the second it goes out.
type plannedStep struct {
	Kind    string
	Due     time.Time
	Release *time.Time
}

func readIncidentFacts(ctx context.Context, q dbq, incidentID string) (incidentFacts, error) {
	var facts incidentFacts
	err := q.QueryRow(ctx, `select number, title, urgency, assignment from incidents where id = $1`, incidentID).
		Scan(&facts.Number, &facts.Title, &facts.Urgency, &facts.Assignment)
	if err != nil {
		return facts, fmt.Errorf("read incident %s for its steps: %w", incidentID, err)
	}
	return facts, nil
}

func readPersonFacts(ctx context.Context, q dbq, personID string) (personFacts, error) {
	person := personFacts{ID: personID}
	err := q.QueryRow(ctx, `select email, timezone, quiet_start, quiet_end, notification_delays, low_urgency_delay
		from users where id = $1`, personID).
		Scan(&person.Email, &person.Zone, &person.QuietStart, &person.QuietEnd, &person.Delays, &person.LowDelay)
	if err != nil {
		return person, fmt.Errorf("read notification settings of %s: %w", personID, err)
	}
	return person, nil
}

// planEmailSteps is the mail a holder gets from the instant they become a holder: one step per delay for high urgency,
// one notice after the low-urgency delay otherwise.
func planEmailSteps(person personFacts, urgency string, now time.Time) ([]plannedStep, error) {
	if urgency == "high" {
		plan := make([]plannedStep, 0, len(person.Delays))
		for _, delay := range person.Delays {
			plan = append(plan, plannedStep{Kind: "step", Due: now.Add(time.Duration(delay) * time.Minute)})
		}
		return plan, nil
	}
	due := now.Add(time.Duration(person.LowDelay) * time.Minute)
	release, err := quietRelease(due, person)
	if err != nil {
		return nil, fmt.Errorf("check quiet hours: %w", err)
	}
	return []plannedStep{{Kind: "low_urgency", Due: due, Release: release}}, nil
}

// quietRelease is the second a notice due at an instant goes out when the instant falls inside the person's quiet hours,
// read in their own zone and possibly crossing midnight: the quiet period includes its start second and excludes its end
// second. It is nil when the instant is outside quiet hours or the person has none.
func quietRelease(at time.Time, person personFacts) (*time.Time, error) {
	if person.QuietStart == nil || person.QuietEnd == nil {
		return nil, nil
	}
	zone, err := time.LoadLocation(person.Zone)
	if err != nil {
		return nil, fmt.Errorf("load zone %s: %w", person.Zone, err)
	}
	start, err := clockSeconds(*person.QuietStart)
	if err != nil {
		return nil, fmt.Errorf("read quiet start: %w", err)
	}
	end, err := clockSeconds(*person.QuietEnd)
	if err != nil {
		return nil, fmt.Errorf("read quiet end: %w", err)
	}
	local := at.In(zone)
	second := local.Hour()*3600 + local.Minute()*60 + local.Second()
	crossing := start >= end
	inside := second >= start && second < end
	days := 0
	if crossing {
		inside = second >= start || second < end
		if second >= start {
			days = 1
		}
	}
	if !inside {
		return nil, nil
	}
	release := time.Date(local.Year(), local.Month(), local.Day()+days, end/3600, end%3600/60, 0, 0, zone).UTC()
	return &release, nil
}

// clockSeconds reads an HH:MM time of day as seconds after midnight.
func clockSeconds(text string) (int, error) {
	parsed, err := time.Parse(quietClockLayout, text)
	if err != nil {
		return 0, fmt.Errorf("read quiet hours time %q: %w", text, err)
	}
	return parsed.Hour()*3600 + parsed.Minute()*60, nil
}

type newStep struct {
	IncidentID string
	PersonID   string
	Assignment int
	Kind       string
	Channel    string
	Due        time.Time
	Release    *time.Time
}

// insertStep writes one step. An in-app step is sent at its second; an email step waits, held when it has a release.
func insertStep(w *Work, s newStep) (string, error) {
	id := newID()
	status, sentAt := "scheduled", (*time.Time)(nil)
	switch {
	case s.Channel == "in_app":
		status, sentAt = "sent", &s.Due
	case s.Release != nil:
		status = "held"
	}
	_, err := w.Tx.Exec(w.Ctx, `insert into steps (id, incident_id, person_id, kind, channel, due_at, release_at, status, sent_at, assignment)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		id, s.IncidentID, s.PersonID, s.Kind, s.Channel, s.Due, s.Release, status, sentAt, s.Assignment)
	if err != nil {
		return "", fmt.Errorf("write %s %s step: %w", s.Channel, s.Kind, err)
	}
	return id, nil
}

// notifyHolders gives each person an in-app step and, by the incident's urgency, their email steps, each carrying a fresh
// acknowledge link and counted from w.Now.
func (a *App) notifyHolders(w *Work, incidentID string, holderIDs []string) error {
	inc, err := readIncidentFacts(w.Ctx, w.Tx, incidentID)
	if err != nil {
		return fmt.Errorf("notify holders: %w", err)
	}
	for _, personID := range holderIDs {
		person, err := readPersonFacts(w.Ctx, w.Tx, personID)
		if err != nil {
			return fmt.Errorf("notify holders: %w", err)
		}
		if _, err := insertStep(w, newStep{IncidentID: incidentID, PersonID: personID, Assignment: inc.Assignment,
			Kind: "step", Channel: "in_app", Due: w.Now}); err != nil {
			return fmt.Errorf("notify %s: %w", personID, err)
		}
		plan, err := planEmailSteps(person, inc.Urgency, w.Now)
		if err != nil {
			return fmt.Errorf("plan mail for %s: %w", personID, err)
		}
		for _, planned := range plan {
			if err := a.addEmailStep(w, incidentID, inc, person, planned); err != nil {
				return fmt.Errorf("notify %s: %w", personID, err)
			}
		}
	}
	return nil
}

// addEmailStep writes one email step and queues its mail with a fresh acknowledge link.
func (a *App) addEmailStep(w *Work, incidentID string, inc incidentFacts, person personFacts, planned plannedStep) error {
	stepID, err := insertStep(w, newStep{IncidentID: incidentID, PersonID: person.ID, Assignment: inc.Assignment,
		Kind: planned.Kind, Channel: "email", Due: planned.Due, Release: planned.Release})
	if err != nil {
		return fmt.Errorf("add email step: %w", err)
	}
	goesOut := planned.Due
	if planned.Release != nil {
		goesOut = *planned.Release
	}
	token, err := signAckToken(w.Ctx, w.Tx, ackToken{Step: stepID, Person: person.ID, Incident: incidentID,
		Assignment: inc.Assignment, Due: goesOut})
	if err != nil {
		return fmt.Errorf("make link for step %s: %w", stepID, err)
	}
	subject := fmt.Sprintf("[Switchlamp] Incident #%d needs you: %s", inc.Number, inc.Title)
	if planned.Kind == "low_urgency" {
		subject = fmt.Sprintf("[Switchlamp] Low urgency incident #%d: %s", inc.Number, inc.Title)
	}
	body := fmt.Sprintf("Incident #%d: %s\n\nAcknowledge: %s/ack/%s\n", inc.Number, inc.Title, a.publicURL(), token)
	if err := a.enqueue(w, &stepID, outboundMail{Kind: planned.Kind, To: person.Email, Subject: subject, Body: body, DueAt: goesOut}); err != nil {
		return fmt.Errorf("queue acknowledge mail: %w", err)
	}
	return nil
}

// publicURL is the base of the links in mail.
func (a *App) publicURL() string {
	if a.cfg.PublicURL != "" {
		return a.cfg.PublicURL
	}
	return "http://localhost:" + a.cfg.Port
}

// cancelPendingSteps cancels the unsent steps of an incident for the given people (nil: everyone) and drops their mail.
func (a *App) cancelPendingSteps(w *Work, incidentID string, personIDs []string) error {
	_, err := w.Tx.Exec(w.Ctx, `with cancelled as (
			update steps set status = 'cancelled'
			where incident_id = $1 and status in ('scheduled', 'held') and ($2::text[] is null or person_id = any($2))
			returning id)
		delete from mail_outbox where sent_at is null and step_id in (select id from cancelled)`, incidentID, personIDs)
	if err != nil {
		return fmt.Errorf("cancel pending steps of incident %s: %w", incidentID, err)
	}
	return nil
}

// addResponderNotice writes the in-app step that asks a colleague to join.
func (a *App) addResponderNotice(w *Work, incidentID, personID string) error {
	inc, err := readIncidentFacts(w.Ctx, w.Tx, incidentID)
	if err != nil {
		return fmt.Errorf("add responder notice: %w", err)
	}
	if _, err = insertStep(w, newStep{IncidentID: incidentID, PersonID: personID, Assignment: inc.Assignment,
		Kind: "step", Channel: "in_app", Due: w.Now}); err != nil {
		return fmt.Errorf("add responder notice: %w", err)
	}
	return nil
}

// stepViews lists an incident's steps as published, times in the viewer's zone.
func (a *App) stepViews(ctx context.Context, q dbq, incidentID, viewerZone string) ([]stepView, error) {
	viewer, err := time.LoadLocation(viewerZone)
	if err != nil {
		return nil, fmt.Errorf("load viewer zone %s: %w", viewerZone, err)
	}
	rows, err := q.Query(ctx, `select s.id, u.name, u.timezone, s.kind, s.channel, s.due_at, coalesce(s.release_at, s.due_at),
			s.status, s.sent_at
		from steps s join users u on u.id = s.person_id
		where s.incident_id = $1 order by s.due_at, s.seq`, incidentID)
	if err != nil {
		return nil, fmt.Errorf("list steps of incident %s: %w", incidentID, err)
	}
	defer rows.Close()
	now := a.clock.Now()
	views := []stepView{}
	for rows.Next() {
		var (
			view         stepView
			holderZone   string
			due, goesOut time.Time
			sentAt       *time.Time
		)
		if err := rows.Scan(&view.ID, &view.Person, &holderZone, &view.Kind, &view.Channel, &due, &goesOut, &view.Status, &sentAt); err != nil {
			return nil, fmt.Errorf("scan step: %w", err)
		}
		view.DueAt = formatInstant(due)
		view.DueLocal = localLabel(due, viewer)
		if sentAt != nil {
			text := formatInstant(*sentAt)
			view.SentAt = &text
		}
		if view.Status == "scheduled" || view.Status == "held" {
			if instantReached(now, goesOut) {
				view.Status = "queued"
			}
		}
		view.StatusText, err = stepStatusText(view.Status, goesOut, holderZone)
		if err != nil {
			return nil, fmt.Errorf("describe step %s: %w", view.ID, err)
		}
		views = append(views, view)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list steps of incident %s: %w", incidentID, err)
	}
	return views, nil
}

// stepStatusText is the status word of a step; a held one names its release second in the holder's zone.
func stepStatusText(status string, goesOut time.Time, holderZone string) (string, error) {
	switch status {
	case "held":
		local, err := localTime(goesOut, holderZone)
		if err != nil {
			return "", fmt.Errorf("show release time: %w", err)
		}
		return "Held until " + local, nil
	case "scheduled":
		return "Scheduled", nil
	case "queued":
		return "Queued", nil
	case "sent":
		return "Sent", nil
	}
	return "Cancelled", nil
}
