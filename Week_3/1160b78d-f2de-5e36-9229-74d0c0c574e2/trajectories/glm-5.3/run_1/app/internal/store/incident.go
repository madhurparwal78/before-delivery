package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"switchlamp/internal/domain"
)

// ErrNotFound is the one not-found error for record reads.
var ErrNotFound = pgx.ErrNoRows

// Incident loads one incident with every relation, applying nothing.
func (s *Store) Incident(ctx context.Context, id string) (*domain.Incident, error) {
	var inc domain.Incident
	var policy []byte
	var holders, impacted, responders []byte
	var mergedInto *string
	var respondersRemoved bool
	err := s.pool.QueryRow(ctx, `SELECT i.id, i.number, i.title, i.service_id, i.status, i.urgency, i.level, i.cycle,
		i.policy_snapshot, i.holders, i.opened_at, i.ack_deadline, i.snoozed_until, i.snoozed_by, i.auto_resolve_at,
		i.escalate_at, i.escalation_finished, i.grouping_until, i.resolve_reason, i.merged_into, i.impacted_services,
		i.responders, i.responders_removed, i.version, i.closed_at,
		sv.id, sv.name
		FROM incidents i JOIN services sv ON sv.id = i.service_id
		WHERE i.id = $1`, id).
		Scan(&inc.ID, &inc.Number, &inc.Title, &inc.ServiceID, &inc.Status, &inc.Urgency, &inc.Level, &inc.Cycle,
			&policy, &holders, &inc.OpenedAt, &inc.AckDeadline, &inc.SnoozedUntil, &inc.SnoozedBy, &inc.AutoResolveAt,
			&inc.EscalateAt, &inc.EscalationFinished, &inc.GroupingUntil, &inc.ResolveReason, &mergedInto,
			&impacted, &responders, &respondersRemoved, &inc.Version, &inc.ClosedAt,
			&inc.Service.ID, &inc.Service.Name)
	if err != nil {
		return nil, err
	}
	_ = respondersRemoved
	if mergedInto != nil {
		inc.MergedInto = mergedInto
		// The stored reference is the target's id; the number follows for
		// webhook bodies and pages.
		var num int64
		if err := s.pool.QueryRow(ctx, `SELECT number FROM incidents WHERE id = $1`, *mergedInto).Scan(&num); err == nil {
			inc.SetMergedNumber(num)
		}
	}
	if err := json.Unmarshal(policy, &inc.PolicySnapshot); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(holders, &inc.Holders); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(impacted, &inc.ImpactedServices); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(responders, &inc.Responders); err != nil {
		return nil, err
	}
	if err := s.fillRelations(ctx, &inc); err != nil {
		return nil, err
	}
	return &inc, nil
}

func (s *Store) fillRelations(ctx context.Context, inc *domain.Incident) error {
	// Alerts.
	rows, err := s.pool.Query(ctx, `SELECT id, routing_key, dedup_key, status, summary, source, severity, event_count
		FROM alerts WHERE incident_id = $1 ORDER BY opened_at, id`, inc.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var a domain.Alert
		if err := rows.Scan(&a.ID, &a.RoutingKey, &a.DedupKey, &a.Status, &a.Summary, &a.Source, &a.Severity, &a.EventCount); err != nil {
			return err
		}
		inc.Alerts = append(inc.Alerts, a)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	// Timeline.
	trows, err := s.pool.Query(ctx, `SELECT id, at, kind, actor, text, from_number FROM timelines
		WHERE incident_id = $1 ORDER BY at, id`, inc.ID)
	if err != nil {
		return err
	}
	defer trows.Close()
	for trows.Next() {
		var e domain.TimelineEntry
		if err := trows.Scan(&e.ID, &e.At, &e.Kind, &e.Actor, &e.Text, &e.FromNumber); err != nil {
			return err
		}
		inc.Timeline = append(inc.Timeline, e)
	}
	if err := trows.Err(); err != nil {
		return err
	}
	// Steps.
	srows, err := s.pool.Query(ctx, `SELECT st.id, u.name, st.kind, st.channel, st.due_at, st.status, st.sent_at
		FROM steps st JOIN users u ON u.id = st.person_id
		WHERE st.incident_id = $1 ORDER BY st.due_at, st.id`, inc.ID)
	if err != nil {
		return err
	}
	defer srows.Close()
	for srows.Next() {
		var st domain.Step
		if err := srows.Scan(&st.ID, &st.Person, &st.Kind, &st.Channel, &st.DueAt, &st.Status, &st.SentAt); err != nil {
			return err
		}
		inc.Steps = append(inc.Steps, st)
	}
	if err := srows.Err(); err != nil {
		return err
	}
	// Responder requests.
	rrows, err := s.pool.Query(ctx, `SELECT rr.id, u.name, rr.state FROM responder_requests rr
		JOIN users u ON u.id = rr.person_id WHERE rr.incident_id = $1 ORDER BY rr.created_at`, inc.ID)
	if err != nil {
		return err
	}
	defer rrows.Close()
	for rrows.Next() {
		var r domain.ResponderReq
		if err := rrows.Scan(&r.ID, &r.Person, &r.State); err != nil {
			return err
		}
		inc.ResponderRequests = append(inc.ResponderRequests, r)
	}
	return rrows.Err()
}

// IncidentListItem is the paged list row.
type IncidentListItem struct {
	domain.Incident
}

const incidentListCols = `i.id, i.number, i.title, i.service_id, i.status, i.urgency, i.holders, i.opened_at, i.version, sv.id, sv.name`

func scanList(scan func(dest ...any) error) (*domain.Incident, error) {
	var inc domain.Incident
	var holders []byte
	if err := scan(&inc.ID, &inc.Number, &inc.Title, &inc.ServiceID, &inc.Status, &inc.Urgency, &holders, &inc.OpenedAt, &inc.Version, &inc.Service.ID, &inc.Service.Name); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(holders, &inc.Holders); err != nil {
		return nil, err
	}
	return &inc, nil
}

// IncidentFilter names the list's filters.
type IncidentFilter struct {
	Status    string
	ServiceID string
	Before    string // cursor
	Limit     int
}

// IncidentsPage reads one cursor page in the published order: newest opening
// instant first, then higher incident number first. Cursors name a position so
// arrivals and removals elsewhere never repeat or skip a row.
func (s *Store) IncidentsPage(ctx context.Context, f IncidentFilter) (items []*domain.Incident, total int, nextCursor string, err error) {
	statuses := map[string][]string{
		"open":         {domain.StatusTriggered, domain.StatusAcknowledged, domain.StatusSnoozed},
		"triggered":    {domain.StatusTriggered},
		"acknowledged": {domain.StatusAcknowledged},
		"snoozed":      {domain.StatusSnoozed},
		"resolved":     {domain.StatusResolved},
	}[f.Status]
	where := ""
	args := []any{}
	if f.Status != "" && f.Status != "all" {
		where += ` AND i.status = ANY($1)`
		args = append(args, statuses)
	}
	if f.ServiceID != "" {
		where += ` AND i.service_id = $` + itoa(len(args)+1)
		args = append(args, f.ServiceID)
	}
	if f.Before != "" {
		where += ` AND (i.opened_at, i.number) < ($` + itoa(len(args)+1) + `::timestamptz, $` + itoa(len(args)+2) + `::bigint)`
		var at time.Time
		var num int64
		if err := parseCursor(f.Before, &at, &num); err != nil {
			return nil, 0, "", err
		}
		args = append(args, at, num)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM incidents i WHERE 1=1`+where, args...).Scan(&total); err != nil {
		return nil, 0, "", err
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 25
	}
	q := `SELECT ` + incidentListCols + ` FROM incidents i JOIN services sv ON sv.id = i.service_id
		WHERE 1=1` + where + ` ORDER BY i.opened_at DESC, i.number DESC LIMIT ` + itoa(limit+1)
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, "", err
	}
	defer rows.Close()
	for rows.Next() {
		inc, err := scanList(rows.Scan)
		if err != nil {
			return nil, 0, "", err
		}
		items = append(items, inc)
	}
	if err = rows.Err(); err != nil {
		return nil, 0, "", err
	}
	if len(items) > limit {
		last := items[limit-1]
		nextCursor = makeCursor(last.OpenedAt, last.Number)
		items = items[:limit]
	}
	return items, total, nextCursor, nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func makeCursor(at time.Time, number int64) string {
	return at.UTC().Format("20060102T150405Z") + "-" + itoa(int(number))
}

func parseCursor(c string, at *time.Time, num *int64) error {
	if len(c) < 21 || c[16] != '-' {
		return errors.New("bad cursor")
	}
	t, err := time.Parse("20060102T150405Z", c[:16])
	if err != nil {
		return err
	}
	var n int64
	for _, ch := range c[17:] {
		if ch < '0' || ch > '9' {
			return errors.New("bad cursor")
		}
		n = n*10 + int64(ch-'0')
	}
	*at = t
	*num = n
	return nil
}

// LatestIncidentForService finds a service's most recent incident.
func (s *Store) LatestIncidentForService(ctx context.Context, serviceID string) (*domain.Incident, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT id FROM incidents WHERE service_id = $1 AND status != 'resolved'
		ORDER BY opened_at DESC, number DESC LIMIT 1`, serviceID).Scan(&id)
	if err != nil {
		return nil, err
	}
	return s.Incident(ctx, id)
}

// OpenAlertByKey finds the open alert for a routing key and dedup key.
func (s *Store) OpenAlertByKey(ctx context.Context, routingKey, dedupKey string) (id string, incidentID string, err error) {
	err = s.pool.QueryRow(ctx, `SELECT a.id, a.incident_id FROM alerts a
		WHERE a.routing_key = $1 AND a.dedup_key = $2`, routingKey, dedupKey).Scan(&id, &incidentID)
	return id, incidentID, err
}

// LatestAlertByKey finds the most recent alert for a key pair, resolved or not.
func (s *Store) LatestAlertByKey(ctx context.Context, routingKey, dedupKey string) (id string, incidentID string, status string, err error) {
	err = s.pool.QueryRow(ctx, `SELECT a.id, a.incident_id, a.status FROM alerts a
		WHERE a.routing_key = $1 AND a.dedup_key = $2
		ORDER BY a.opened_at DESC LIMIT 1`, routingKey, dedupKey).Scan(&id, &incidentID, &status)
	return id, incidentID, status, err
}
