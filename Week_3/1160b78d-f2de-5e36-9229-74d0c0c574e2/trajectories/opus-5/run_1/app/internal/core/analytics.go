package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type AnalyticsRow struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Incidents int    `json:"incidents"`
	MTTA      string `json:"mtta_minutes"`
	MTTR      string `json:"mttr_minutes"`
}

type AnalyticsOverall struct {
	Incidents int    `json:"incidents"`
	MTTA      string `json:"mtta_minutes"`
	MTTR      string `json:"mttr_minutes"`
}

type AnalyticsJob struct {
	ID      string            `json:"id"`
	From    string            `json:"from"`
	To      string            `json:"to"`
	State   string            `json:"state"`
	Done    int               `json:"done"`
	Total   int               `json:"total"`
	Cached  bool              `json:"cached"`
	Rows    []AnalyticsRow    `json:"rows"`
	Overall *AnalyticsOverall `json:"overall"`
}

// businessSeconds counts only the seconds inside business hours, Monday to
// Friday 08:00 to 18:00 in the firm's zone.
func businessSeconds(from, to time.Time) int {
	if !to.After(from) {
		return 0
	}
	total := 0
	day := wallOf(from, firmZone).dateOnly()
	for i := 0; i < 800; i++ {
		date := day.addDays(i)
		start := resolveWall(firmZone, date.withTime(8, 0))
		end := resolveWall(firmZone, date.withTime(18, 0))
		if !start.Before(to) {
			break
		}
		weekday := date.utc().Weekday()
		if weekday == time.Saturday || weekday == time.Sunday {
			continue
		}
		windowStart, windowEnd := start, end
		if windowStart.Before(from) {
			windowStart = from
		}
		if windowEnd.After(to) {
			windowEnd = to
		}
		if windowEnd.After(windowStart) {
			total += int(windowEnd.Sub(windowStart) / time.Second)
		}
	}
	return total
}

func meanMinutes(totalSeconds, count int) string {
	if count == 0 {
		return "n/a"
	}
	minutes := float64(totalSeconds) / float64(count) / 60
	return fmt.Sprintf("%.1f", math.Floor(minutes*10+0.5)/10)
}

type measureSet struct {
	incidents  int
	ttaSeconds int
	ttaCount   int
	ttrSeconds int
	ttrCount   int
}

func (m *measureSet) row(name, kind string) AnalyticsRow {
	return AnalyticsRow{Name: name, Kind: kind, Incidents: m.incidents,
		MTTA: meanMinutes(m.ttaSeconds, m.ttaCount), MTTR: meanMinutes(m.ttrSeconds, m.ttrCount)}
}

// StartAnalyticsJob answers a finished cached result at once, or starts a job.
func (a *App) StartAnalyticsJob(ctx context.Context, from, to string) (*AnalyticsJob, bool, error) {
	fromDate, ok := parseDate(from)
	if !ok {
		return nil, false, errFields("from", "Use the format YYYY-MM-DD.")
	}
	toDate, ok := parseDate(to)
	if !ok {
		return nil, false, errFields("to", "Use the format YYYY-MM-DD.")
	}
	if toDate.utc().Before(fromDate.utc()) {
		return nil, false, errFields("to", "The range must end on or after its start.")
	}
	if _, body, ok := a.cacheGet(ctx, "cache:analytics:"+from+":"+to); ok {
		var job AnalyticsJob
		if err := json.Unmarshal([]byte(body), &job); err == nil {
			job.Cached = true
			return &job, true, nil
		}
	}
	services, err := a.ListServices(ctx)
	if err != nil {
		return nil, false, err
	}
	job := &AnalyticsJob{ID: newID(), From: from, To: to, State: "running", Total: len(services)}
	if _, err := a.pool.Exec(ctx, `INSERT INTO analytics_jobs (id, from_date, to_date, state, done, total, created_at)
		VALUES ($1,$2,$3,'running',0,$4,$5)`, job.ID, from, to, len(services), a.Clock.Now()); err != nil {
		return nil, false, fmt.Errorf("create analytics job: %w", err)
	}
	go a.runAnalyticsJob(context.WithoutCancel(ctx), job.ID, from, to)
	return job, false, nil
}

func (a *App) runAnalyticsJob(ctx context.Context, jobID, from, to string) {
	services, err := a.ListServices(ctx)
	if err != nil {
		return
	}
	sort.Slice(services, func(i, j int) bool { return services[i].Name < services[j].Name })
	incidents, err := a.incidentsInRange(ctx, from, to)
	if err != nil {
		return
	}
	byService := map[string]*measureSet{}
	byTeam := map[string]*measureSet{}
	overall := &measureSet{}
	for _, s := range services {
		byService[s.ID] = &measureSet{}
		if byTeam[s.Team] == nil {
			byTeam[s.Team] = &measureSet{}
		}
	}
	teamOf := map[string]string{}
	for _, s := range services {
		teamOf[s.ID] = s.Team
	}

	done := 0
	for _, s := range services {
		// Each service is measured in turn, taking at least one real second.
		started := time.Now()
		for _, inc := range incidents {
			if inc.serviceID != s.ID {
				continue
			}
			sets := []*measureSet{byService[s.ID], byTeam[s.Team], overall}
			for _, set := range sets {
				set.incidents++
				if inc.ttaSeconds >= 0 {
					set.ttaSeconds += inc.ttaSeconds
					set.ttaCount++
				}
				if inc.ttrSeconds >= 0 {
					set.ttrSeconds += inc.ttrSeconds
					set.ttrCount++
				}
			}
		}
		if wait := time.Second - time.Since(started); wait > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}
		}
		done++
		if _, err := a.pool.Exec(ctx, `UPDATE analytics_jobs SET done=$1 WHERE id=$2`, done, jobID); err != nil {
			return
		}
		a.publishAnalytics(ctx, jobID, done, len(services), "running")
	}

	rows := []AnalyticsRow{}
	for _, s := range services {
		rows = append(rows, byService[s.ID].row(s.Name, "service"))
	}
	teams := make([]string, 0, len(byTeam))
	for team := range byTeam {
		teams = append(teams, team)
	}
	sort.Strings(teams)
	for _, team := range teams {
		rows = append(rows, byTeam[team].row(team, "team"))
	}
	result := AnalyticsOverall{Incidents: overall.incidents,
		MTTA: meanMinutes(overall.ttaSeconds, overall.ttaCount),
		MTTR: meanMinutes(overall.ttrSeconds, overall.ttrCount)}
	if _, err := a.pool.Exec(ctx, `UPDATE analytics_jobs SET state='done', done=$1, rows=$2, overall=$3 WHERE id=$4`,
		len(services), mustJSON(rows), mustJSON(result), jobID); err != nil {
		return
	}
	job, err := a.AnalyticsJob(ctx, jobID)
	if err == nil {
		if body, err := json.Marshal(job); err == nil {
			a.cacheSet(ctx, "cache:analytics:"+from+":"+to, "analytics", string(body), 30*24*time.Hour)
		}
	}
	a.publishAnalytics(ctx, jobID, len(services), len(services), "done")
}

type rangeIncident struct {
	serviceID              string
	ttaSeconds, ttrSeconds int
}

// incidentsInRange measures each incident whose opening date falls in the
// range, in the firm's zone, leaving out a source closed by merge.
func (a *App) incidentsInRange(ctx context.Context, from, to string) ([]rangeIncident, error) {
	fromDate, _ := parseDate(from)
	toDate, _ := parseDate(to)
	start := resolveWall(firmZone, fromDate.withTime(0, 0))
	end := resolveWall(firmZone, toDate.addDays(1).withTime(0, 0))
	rows, err := a.pool.Query(ctx, `SELECT id, service_id, opened_at, acknowledged_at, resolved_at, resolve_reason
		FROM incidents WHERE opened_at >= $1 AND opened_at < $2`, start, end)
	if err != nil {
		return nil, fmt.Errorf("read incidents in range: %w", err)
	}
	defer rows.Close()
	type record struct {
		id, serviceID string
		opened        time.Time
		acknowledged  *time.Time
		resolved      *time.Time
		reason        *string
	}
	var records []record
	for rows.Next() {
		var r record
		if err := rows.Scan(&r.id, &r.serviceID, &r.opened, &r.acknowledged, &r.resolved, &r.reason); err != nil {
			return nil, fmt.Errorf("read incident: %w", err)
		}
		records = append(records, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var out []rangeIncident
	for _, r := range records {
		if r.reason != nil && *r.reason == "Merged" {
			continue
		}
		entry := rangeIncident{serviceID: r.serviceID, ttaSeconds: -1, ttrSeconds: -1}
		firstAck, err := a.firstAcknowledge(ctx, r.id)
		if err != nil {
			return nil, err
		}
		if firstAck != nil {
			entry.ttaSeconds = businessSeconds(r.opened.UTC(), firstAck.UTC())
		}
		if r.resolved != nil {
			snoozed, err := a.snoozedBusinessSeconds(ctx, r.id)
			if err != nil {
				return nil, err
			}
			entry.ttrSeconds = businessSeconds(r.opened.UTC(), r.resolved.UTC()) - snoozed
			if entry.ttrSeconds < 0 {
				entry.ttrSeconds = 0
			}
		}
		out = append(out, entry)
	}
	return out, nil
}

func (a *App) firstAcknowledge(ctx context.Context, incidentID string) (*time.Time, error) {
	var at time.Time
	err := a.pool.QueryRow(ctx, `SELECT at FROM timeline WHERE incident_id=$1 AND kind='acknowledged'
		ORDER BY at, seq LIMIT 1`, incidentID).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read first acknowledge: %w", err)
	}
	return &at, nil
}

// snoozedBusinessSeconds measures the time an incident spent snoozed.
func (a *App) snoozedBusinessSeconds(ctx context.Context, incidentID string) (int, error) {
	rows, err := a.pool.Query(ctx, `SELECT at, kind FROM timeline WHERE incident_id=$1 ORDER BY at, seq`, incidentID)
	if err != nil {
		return 0, fmt.Errorf("read timeline: %w", err)
	}
	defer rows.Close()
	total := 0
	var snoozedAt *time.Time
	for rows.Next() {
		var at time.Time
		var kind string
		if err := rows.Scan(&at, &kind); err != nil {
			return 0, fmt.Errorf("read timeline entry: %w", err)
		}
		at = at.UTC()
		if kind == "snoozed" {
			moment := at
			snoozedAt = &moment
			continue
		}
		if snoozedAt != nil && contains([]string{"snooze_ended", "acknowledged", "resolved", "auto_resolved", "reassigned", "merged"}, kind) {
			total += businessSeconds(*snoozedAt, at)
			snoozedAt = nil
		}
	}
	return total, rows.Err()
}

func (a *App) AnalyticsJob(ctx context.Context, id string) (*AnalyticsJob, error) {
	var job AnalyticsJob
	var rows, overall []byte
	err := a.pool.QueryRow(ctx, `SELECT id, from_date, to_date, state, done, total, rows, overall FROM analytics_jobs
		WHERE id=$1`, id).Scan(&job.ID, &job.From, &job.To, &job.State, &job.Done, &job.Total, &rows, &overall)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read analytics job: %w", err)
	}
	if len(rows) > 0 {
		if err := jsonInto(rows, &job.Rows); err != nil {
			return nil, err
		}
	}
	if len(overall) > 0 {
		var result AnalyticsOverall
		if err := jsonInto(overall, &result); err != nil {
			return nil, err
		}
		job.Overall = &result
	}
	return &job, nil
}

// AnalyticsCSV writes the same strings the table shows.
func (a *App) AnalyticsCSV(ctx context.Context, id string) (string, error) {
	job, err := a.AnalyticsJob(ctx, id)
	if err != nil {
		return "", err
	}
	if job.State != "done" {
		return "", errCode(409, "job_running")
	}
	var b strings.Builder
	b.WriteString("name,incidents,mtta_minutes,mttr_minutes\n")
	for _, row := range job.Rows {
		fmt.Fprintf(&b, "%s,%d,%s,%s\n", csvField(row.Name), row.Incidents, row.MTTA, row.MTTR)
	}
	if job.Overall != nil {
		fmt.Fprintf(&b, "All services,%d,%s,%s\n", job.Overall.Incidents, job.Overall.MTTA, job.Overall.MTTR)
	}
	return b.String(), nil
}

func csvField(value string) string {
	if strings.ContainsAny(value, ",\"\n") {
		return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
	}
	return value
}

// DefaultAnalyticsRange is the 30 days, both ends included, the page opens on.
func (a *App) DefaultAnalyticsRange() (string, string) {
	today := wallOf(a.Clock.Now(), firmZone).dateOnly()
	from := today.addDays(-29)
	format := func(w wall) string { return fmt.Sprintf("%04d-%02d-%02d", w.year, int(w.month), w.day) }
	return format(from), format(today)
}
