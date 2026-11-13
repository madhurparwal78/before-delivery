package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type ServiceRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Alert struct {
	ID         string  `json:"id"`
	RoutingKey *string `json:"routing_key"`
	DedupKey   string  `json:"dedup_key"`
	Status     string  `json:"status"`
	Summary    string  `json:"summary"`
	Source     string  `json:"source"`
	Severity   string  `json:"severity"`
	EventCount int     `json:"event_count"`
	ServiceID  string  `json:"-"`
}

type TimelineEntry struct {
	ID         string    `json:"id"`
	At         time.Time `json:"at"`
	Kind       string    `json:"kind"`
	Actor      string    `json:"actor"`
	Text       string    `json:"text"`
	FromNumber *int64    `json:"from_number,omitempty"`
}

type Step struct {
	ID      string     `json:"id"`
	Person  string     `json:"person"`
	Kind    string     `json:"kind"`
	Channel string     `json:"channel"`
	DueAt   time.Time  `json:"due_at"`
	Status  string     `json:"status"`
	SentAt  *time.Time `json:"sent_at"`
	Word    string     `json:"word"`
}

type ResponderRequest struct {
	ID     string `json:"id"`
	Person string `json:"person"`
	State  string `json:"state"`
}

type Countdown struct {
	Kind             string     `json:"kind"`
	DueAt            *time.Time `json:"due_at"`
	RemainingSeconds int        `json:"remaining_seconds"`
	Label            string     `json:"-"`
}

// incidentRow is the stored form of an incident.
type incidentRow struct {
	ID                 string
	Number             int64
	ServiceID          string
	Title              string
	Status             string
	Urgency            string
	Level              int
	Cycle              int
	Snapshot           PolicySnapshot
	EscalationDueAt    *time.Time
	EscalationFinished bool
	AckDeadlineAt      *time.Time
	SnoozedUntil       *time.Time
	SnoozedBy          *string
	AutoResolveMinutes *int
	AutoResolveAt      *time.Time
	OpenedAt           time.Time
	AcknowledgedAt     *time.Time
	AcknowledgedBy     *string
	DecidedBy          *string
	DecidedAt          *time.Time
	ResolvedAt         *time.Time
	ResolveReason      *string
	ResolvedBy         *string
	MergedInto         *string
	GroupingUntil      *time.Time
	HoldersPinned      bool
	Version            int
}

const incidentColumns = `id, number, service_id, title, status, urgency, level, cycle, policy_snapshot,
	escalation_due_at, escalation_finished, ack_deadline_at, snoozed_until, snoozed_by, auto_resolve_minutes,
	auto_resolve_at, opened_at, acknowledged_at, acknowledged_by, decided_by, decided_at, resolved_at, resolve_reason,
	resolved_by, merged_into, grouping_until, holders_pinned, version`

func scanIncident(row pgx.Row) (*incidentRow, error) {
	var r incidentRow
	var snapshot []byte
	if err := row.Scan(&r.ID, &r.Number, &r.ServiceID, &r.Title, &r.Status, &r.Urgency, &r.Level, &r.Cycle,
		&snapshot, &r.EscalationDueAt, &r.EscalationFinished, &r.AckDeadlineAt, &r.SnoozedUntil, &r.SnoozedBy,
		&r.AutoResolveMinutes, &r.AutoResolveAt, &r.OpenedAt, &r.AcknowledgedAt, &r.AcknowledgedBy, &r.DecidedBy, &r.DecidedAt,
		&r.ResolvedAt, &r.ResolveReason, &r.ResolvedBy, &r.MergedInto, &r.GroupingUntil, &r.HoldersPinned, &r.Version); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(snapshot, &r.Snapshot); err != nil {
		return nil, fmt.Errorf("read policy snapshot: %w", err)
	}
	r.OpenedAt = r.OpenedAt.UTC()
	return &r, nil
}

func (a *App) loadIncident(ctx context.Context, id string) (*incidentRow, error) {
	row := a.pool.QueryRow(ctx, `SELECT `+incidentColumns+` FROM incidents WHERE id=$1`, id)
	r, err := scanIncident(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read incident: %w", err)
	}
	return r, nil
}

func (a *App) holderRefs(ctx context.Context, incidentID string) ([]PersonRef, error) {
	rows, err := a.pool.Query(ctx, `SELECT u.id, u.name FROM incident_holders h JOIN users u ON u.id = h.person_id
		WHERE h.incident_id=$1 ORDER BY u.name`, incidentID)
	if err != nil {
		return nil, fmt.Errorf("read holders: %w", err)
	}
	defer rows.Close()
	out := []PersonRef{}
	for rows.Next() {
		var p PersonRef
		if err := rows.Scan(&p.ID, &p.Name); err != nil {
			return nil, fmt.Errorf("read holder: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (a *App) holderNames(ctx context.Context, incidentID string) ([]string, error) {
	refs, err := a.holderRefs(ctx, incidentID)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(refs))
	for _, r := range refs {
		names = append(names, r.Name)
	}
	return names, nil
}

func (a *App) alertsFor(ctx context.Context, incidentID string) ([]Alert, error) {
	rows, err := a.pool.Query(ctx, `SELECT id, routing_key, dedup_key, status, summary, source, severity, event_count, service_id
		FROM alerts WHERE incident_id=$1 ORDER BY opened_at, id`, incidentID)
	if err != nil {
		return nil, fmt.Errorf("read alerts: %w", err)
	}
	defer rows.Close()
	out := []Alert{}
	for rows.Next() {
		var al Alert
		if err := rows.Scan(&al.ID, &al.RoutingKey, &al.DedupKey, &al.Status, &al.Summary, &al.Source,
			&al.Severity, &al.EventCount, &al.ServiceID); err != nil {
			return nil, fmt.Errorf("read alert: %w", err)
		}
		out = append(out, al)
	}
	return out, rows.Err()
}

func (a *App) timelineFor(ctx context.Context, incidentID string) ([]TimelineEntry, error) {
	rows, err := a.pool.Query(ctx, `SELECT id, at, kind, actor, text, from_number FROM timeline
		WHERE incident_id=$1 ORDER BY at, seq`, incidentID)
	if err != nil {
		return nil, fmt.Errorf("read timeline: %w", err)
	}
	defer rows.Close()
	out := []TimelineEntry{}
	for rows.Next() {
		var e TimelineEntry
		if err := rows.Scan(&e.ID, &e.At, &e.Kind, &e.Actor, &e.Text, &e.FromNumber); err != nil {
			return nil, fmt.Errorf("read timeline entry: %w", err)
		}
		e.At = e.At.UTC()
		out = append(out, e)
	}
	return out, rows.Err()
}

func (a *App) stepsFor(ctx context.Context, incidentID string) ([]Step, error) {
	rows, err := a.pool.Query(ctx, `SELECT s.id, u.name, s.kind, s.channel, s.due_at, s.held_until, s.status, s.sent_at,
		u.timezone FROM notification_steps s JOIN users u ON u.id = s.person_id
		WHERE s.incident_id=$1 ORDER BY s.due_at, s.created_at`, incidentID)
	if err != nil {
		return nil, fmt.Errorf("read steps: %w", err)
	}
	defer rows.Close()
	out := []Step{}
	for rows.Next() {
		var s Step
		var heldUntil *time.Time
		var zone string
		if err := rows.Scan(&s.ID, &s.Person, &s.Kind, &s.Channel, &s.DueAt, &heldUntil, &s.Status, &s.SentAt, &zone); err != nil {
			return nil, fmt.Errorf("read step: %w", err)
		}
		s.DueAt = s.DueAt.UTC()
		s.Word = stepWord(s.Status, heldUntil, zone)
		out = append(out, s)
	}
	return out, rows.Err()
}

func stepWord(status string, heldUntil *time.Time, zone string) string {
	switch status {
	case "scheduled":
		return "Scheduled"
	case "held":
		if heldUntil != nil {
			return "Held until " + LocalTime(*heldUntil, zoneOr(zone))
		}
		return "Scheduled"
	case "queued":
		return "Queued"
	case "sent":
		return "Sent"
	default:
		return "Cancelled"
	}
}

func (a *App) respondersFor(ctx context.Context, incidentID string) ([]PersonRef, error) {
	rows, err := a.pool.Query(ctx, `SELECT u.id, u.name FROM incident_responders r JOIN users u ON u.id = r.person_id
		WHERE r.incident_id=$1 ORDER BY u.name`, incidentID)
	if err != nil {
		return nil, fmt.Errorf("read responders: %w", err)
	}
	defer rows.Close()
	out := []PersonRef{}
	for rows.Next() {
		var p PersonRef
		if err := rows.Scan(&p.ID, &p.Name); err != nil {
			return nil, fmt.Errorf("read responder: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (a *App) responderRequestsFor(ctx context.Context, incidentID string) ([]ResponderRequest, error) {
	rows, err := a.pool.Query(ctx, `SELECT r.id, u.name, r.state FROM responder_requests r JOIN users u ON u.id = r.person_id
		WHERE r.incident_id=$1 ORDER BY r.created_at`, incidentID)
	if err != nil {
		return nil, fmt.Errorf("read responder requests: %w", err)
	}
	defer rows.Close()
	out := []ResponderRequest{}
	for rows.Next() {
		var r ResponderRequest
		if err := rows.Scan(&r.ID, &r.Person, &r.State); err != nil {
			return nil, fmt.Errorf("read responder request: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (a *App) impactedFor(ctx context.Context, incidentID string) ([]ServiceRef, error) {
	rows, err := a.pool.Query(ctx, `SELECT s.id, s.name FROM incident_impacted i JOIN services s ON s.id = i.service_id
		WHERE i.incident_id=$1 ORDER BY s.name`, incidentID)
	if err != nil {
		return nil, fmt.Errorf("read impacted services: %w", err)
	}
	defer rows.Close()
	out := []ServiceRef{}
	for rows.Next() {
		var s ServiceRef
		if err := rows.Scan(&s.ID, &s.Name); err != nil {
			return nil, fmt.Errorf("read impacted service: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// countdownFor decides the one timer an incident shows, by the published order.
func countdownFor(r *incidentRow, now time.Time) Countdown {
	remaining := func(due *time.Time) int {
		if due == nil {
			return 0
		}
		seconds := int(due.Sub(now) / time.Second)
		if seconds < 0 {
			return 0
		}
		return seconds
	}
	switch {
	case r.Status == "snoozed" && r.SnoozedUntil != nil:
		return Countdown{Kind: "snooze", DueAt: r.SnoozedUntil, RemainingSeconds: remaining(r.SnoozedUntil), Label: "Snooze ends in"}
	case r.Status == "acknowledged" && r.AckDeadlineAt != nil:
		return Countdown{Kind: "ack_timeout", DueAt: r.AckDeadlineAt, RemainingSeconds: remaining(r.AckDeadlineAt), Label: "Back to triggered in"}
	case r.Status == "triggered" && r.Urgency == "high" && !r.EscalationFinished && r.EscalationDueAt != nil:
		return Countdown{Kind: "escalation", DueAt: r.EscalationDueAt, RemainingSeconds: remaining(r.EscalationDueAt), Label: "Escalates in"}
	case r.Status != "resolved" && r.AutoResolveAt != nil:
		return Countdown{Kind: "auto_resolve", DueAt: r.AutoResolveAt, RemainingSeconds: remaining(r.AutoResolveAt), Label: "Auto-resolves in"}
	case r.Status == "triggered" && r.Urgency == "high" && r.EscalationFinished:
		return Countdown{Kind: "none", RemainingSeconds: 0, Label: "Escalation finished"}
	default:
		return Countdown{Kind: "none", RemainingSeconds: 0, Label: "No timer running"}
	}
}

// IncidentView is the full published form of one incident.
type IncidentView struct {
	ID                string             `json:"id"`
	Number            int64              `json:"number"`
	Title             string             `json:"title"`
	Service           ServiceRef         `json:"service"`
	Status            string             `json:"status"`
	StatusWord        string             `json:"status_word"`
	Urgency           string             `json:"urgency"`
	Holders           []PersonRef        `json:"holders"`
	Level             int                `json:"level"`
	Cycle             int                `json:"cycle"`
	PolicySnapshot    PolicySnapshot     `json:"policy_snapshot"`
	ServerNow         time.Time          `json:"server_now"`
	Countdown         Countdown          `json:"countdown"`
	CountdownLabel    string             `json:"countdown_label"`
	AutoResolveAt     *time.Time         `json:"auto_resolve_at"`
	SnoozedUntil      *time.Time         `json:"snoozed_until"`
	ResolveReason     *string            `json:"resolve_reason"`
	MergedInto        *int64             `json:"merged_into"`
	ImpactedServices  []ServiceRef       `json:"impacted_services"`
	Responders        []PersonRef        `json:"responders"`
	ResponderRequests []ResponderRequest `json:"responder_requests"`
	Alerts            []Alert            `json:"alerts"`
	Timeline          []TimelineEntry    `json:"timeline"`
	Steps             []Step             `json:"steps"`
	OpenedAt          time.Time          `json:"opened_at"`
	Version           int                `json:"version"`
}

// IncidentItem is the list form.
type IncidentItem struct {
	ID         string      `json:"id"`
	Number     int64       `json:"number"`
	Title      string      `json:"title"`
	Service    ServiceRef  `json:"service"`
	Status     string      `json:"status"`
	StatusWord string      `json:"status_word"`
	Urgency    string      `json:"urgency"`
	Holders    []PersonRef `json:"holders"`
	OpenedAt   time.Time   `json:"opened_at"`
	AlertCount int         `json:"alert_count"`
	Countdown  Countdown   `json:"countdown"`
}

func (a *App) serviceRef(ctx context.Context, id string) (ServiceRef, error) {
	var ref ServiceRef
	err := a.pool.QueryRow(ctx, `SELECT id, name FROM services WHERE id=$1`, id).Scan(&ref.ID, &ref.Name)
	if err != nil {
		return ref, fmt.Errorf("read service name: %w", err)
	}
	return ref, nil
}

func (a *App) incidentView(ctx context.Context, r *incidentRow) (*IncidentView, error) {
	now := a.Clock.Now()
	service, err := a.serviceRef(ctx, r.ServiceID)
	if err != nil {
		return nil, err
	}
	holders, err := a.holderRefs(ctx, r.ID)
	if err != nil {
		return nil, err
	}
	alerts, err := a.alertsFor(ctx, r.ID)
	if err != nil {
		return nil, err
	}
	timeline, err := a.timelineFor(ctx, r.ID)
	if err != nil {
		return nil, err
	}
	steps, err := a.stepsFor(ctx, r.ID)
	if err != nil {
		return nil, err
	}
	responders, err := a.respondersFor(ctx, r.ID)
	if err != nil {
		return nil, err
	}
	requests, err := a.responderRequestsFor(ctx, r.ID)
	if err != nil {
		return nil, err
	}
	impacted, err := a.impactedFor(ctx, r.ID)
	if err != nil {
		return nil, err
	}
	var mergedNumber *int64
	if r.MergedInto != nil {
		var number int64
		if err := a.pool.QueryRow(ctx, `SELECT number FROM incidents WHERE id=$1`, *r.MergedInto).Scan(&number); err == nil {
			mergedNumber = &number
		}
	}
	countdown := countdownFor(r, now)
	return &IncidentView{
		ID: r.ID, Number: r.Number, Title: r.Title, Service: service, Status: r.Status,
		StatusWord: incidentStatusWords[r.Status], Urgency: r.Urgency, Holders: holders,
		Level: r.Level, Cycle: r.Cycle, PolicySnapshot: r.Snapshot, ServerNow: now,
		Countdown: countdown, CountdownLabel: countdown.Label, AutoResolveAt: r.AutoResolveAt,
		SnoozedUntil: r.SnoozedUntil, ResolveReason: r.ResolveReason, MergedInto: mergedNumber,
		ImpactedServices: impacted, Responders: responders, ResponderRequests: requests,
		Alerts: alerts, Timeline: timeline, Steps: steps, OpenedAt: r.OpenedAt, Version: r.Version,
	}, nil
}

func (a *App) incidentItem(ctx context.Context, r *incidentRow) (*IncidentItem, error) {
	service, err := a.serviceRef(ctx, r.ServiceID)
	if err != nil {
		return nil, err
	}
	holders, err := a.holderRefs(ctx, r.ID)
	if err != nil {
		return nil, err
	}
	var alertCount int
	if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM alerts WHERE incident_id=$1`, r.ID).Scan(&alertCount); err != nil {
		return nil, fmt.Errorf("count alerts: %w", err)
	}
	return &IncidentItem{
		ID: r.ID, Number: r.Number, Title: r.Title, Service: service, Status: r.Status,
		StatusWord: incidentStatusWords[r.Status], Urgency: r.Urgency, Holders: holders,
		OpenedAt: r.OpenedAt, AlertCount: alertCount, Countdown: countdownFor(r, a.Clock.Now()),
	}, nil
}

// Incident answers one incident in its published form.
func (a *App) Incident(ctx context.Context, id string) (*IncidentView, error) {
	r, err := a.loadIncident(ctx, id)
	if err != nil {
		return nil, err
	}
	return a.incidentView(ctx, r)
}

// IncidentQuery is one page of the incident list.
type IncidentQuery struct {
	Status    string
	ServiceID string
	Limit     int
	After     string
	Before    string
}

type IncidentPage struct {
	Items      []*IncidentItem `json:"items"`
	Total      int             `json:"total"`
	NextCursor *string         `json:"next_cursor"`
	PrevCursor *string         `json:"prev_cursor"`
}

func statusFilterSQL(status string) (string, error) {
	switch status {
	case "", "open":
		return "status <> 'resolved'", nil
	case "triggered", "acknowledged", "snoozed", "resolved":
		return "status = '" + status + "'", nil
	case "all":
		return "true", nil
	default:
		return "", errFields("status", "Choose a listed status.")
	}
}

// cursor names a position in the list order: newest opening instant first,
// then higher number first.
func encodeCursor(openedAt time.Time, number int64) string {
	return fmt.Sprintf("%d_%d", openedAt.Unix(), number)
}

func decodeCursor(cursor string) (time.Time, int64, bool) {
	parts := strings.SplitN(cursor, "_", 2)
	if len(parts) != 2 {
		return time.Time{}, 0, false
	}
	var unix, number int64
	if _, err := fmt.Sscanf(parts[0], "%d", &unix); err != nil {
		return time.Time{}, 0, false
	}
	if _, err := fmt.Sscanf(parts[1], "%d", &number); err != nil {
		return time.Time{}, 0, false
	}
	return time.Unix(unix, 0).UTC(), number, true
}

func (a *App) ListIncidents(ctx context.Context, q IncidentQuery) (*IncidentPage, error) {
	if q.Limit == 0 {
		q.Limit = 25
	}
	if q.Limit < 1 || q.Limit > 100 {
		return nil, errFields("limit", "Limit must be between 1 and 100.")
	}
	where, err := statusFilterSQL(q.Status)
	if err != nil {
		return nil, err
	}
	args := []any{}
	clause := "WHERE " + where
	if q.ServiceID != "" {
		args = append(args, q.ServiceID)
		clause += fmt.Sprintf(" AND service_id = $%d", len(args))
	}
	var total int
	if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM incidents `+clause, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count incidents: %w", err)
	}
	order := "ORDER BY opened_at DESC, number DESC"
	if q.After != "" {
		at, number, ok := decodeCursor(q.After)
		if ok {
			args = append(args, at, number)
			clause += fmt.Sprintf(" AND (opened_at, number) < ($%d, $%d)", len(args)-1, len(args))
		}
	} else if q.Before != "" {
		at, number, ok := decodeCursor(q.Before)
		if ok {
			args = append(args, at, number)
			clause += fmt.Sprintf(" AND (opened_at, number) > ($%d, $%d)", len(args)-1, len(args))
			order = "ORDER BY opened_at ASC, number ASC"
		}
	}
	args = append(args, q.Limit+1)
	query := `SELECT ` + incidentColumns + ` FROM incidents ` + clause + ` ` + order + fmt.Sprintf(" LIMIT $%d", len(args))
	rows, err := a.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list incidents: %w", err)
	}
	defer rows.Close()
	var records []*incidentRow
	for rows.Next() {
		r, err := scanIncident(rows)
		if err != nil {
			return nil, fmt.Errorf("read incident: %w", err)
		}
		records = append(records, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	hasMore := len(records) > q.Limit
	if hasMore {
		records = records[:q.Limit]
	}
	if q.Before != "" {
		for i, j := 0, len(records)-1; i < j; i, j = i+1, j-1 {
			records[i], records[j] = records[j], records[i]
		}
	}
	page := &IncidentPage{Items: []*IncidentItem{}, Total: total}
	for _, r := range records {
		item, err := a.incidentItem(ctx, r)
		if err != nil {
			return nil, err
		}
		page.Items = append(page.Items, item)
	}
	if len(records) > 0 {
		last := records[len(records)-1]
		first := records[0]
		if hasMore || q.Before != "" {
			cursor := encodeCursor(last.OpenedAt, last.Number)
			page.NextCursor = &cursor
		}
		if q.After != "" || q.Before != "" {
			cursor := encodeCursor(first.OpenedAt, first.Number)
			page.PrevCursor = &cursor
		}
	}
	return page, nil
}

// NoticesFor counts the triggered incidents one person holds.
func (a *App) NoticesFor(ctx context.Context, userID string) (int, error) {
	var n int
	err := a.pool.QueryRow(ctx, `SELECT count(*) FROM incidents i JOIN incident_holders h ON h.incident_id = i.id
		WHERE h.person_id=$1 AND i.status='triggered'`, userID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count notices: %w", err)
	}
	return n, nil
}
