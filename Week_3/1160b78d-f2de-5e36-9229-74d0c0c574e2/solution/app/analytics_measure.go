package main

import (
	"context"
	"fmt"
	"time"
)

// Business hours are Monday to Friday, 08:00 to 18:00 in the firm's zone, with no holidays.
const (
	businessOpenHour  = 8
	businessCloseHour = 18
)

// businessSeconds counts the seconds of [from, to) that fall inside business hours in the zone. This is the only place the
// business-hours arithmetic lives; a period includes its start second and excludes its end second.
func businessSeconds(zone *time.Location, from, to time.Time) int64 {
	if !to.After(from) {
		return 0
	}
	year, month, day := from.In(zone).Date()
	var total int64
	for midnight := time.Date(year, month, day, 0, 0, 0, 0, zone); midnight.Before(to); {
		y, m, d := midnight.Date()
		if weekday := midnight.Weekday(); weekday != time.Saturday && weekday != time.Sunday {
			opens := time.Date(y, m, d, businessOpenHour, 0, 0, 0, zone)
			closes := time.Date(y, m, d, businessCloseHour, 0, 0, 0, zone)
			total += overlapSeconds(from, to, opens, closes)
		}
		midnight = time.Date(y, m, d+1, 0, 0, 0, 0, zone)
	}
	return total
}

// overlapSeconds is the length of the overlap of two periods.
func overlapSeconds(startA, endA, startB, endB time.Time) int64 {
	start, end := startA, endA
	if startB.After(start) {
		start = startB
	}
	if endB.Before(end) {
		end = endB
	}
	if !end.After(start) {
		return 0
	}
	return int64(end.Sub(start) / time.Second)
}

// measureKinds are the timeline kinds the measures read, from an incident's own entries (those carrying no from_number):
//
//	acknowledged   the first one ends the time to acknowledge; any one ends a snooze
//	snoozed        starts a snooze
//	snooze_ended   ends a snooze at its own time
//	reassigned     cancels a snooze
//	resolved, auto_resolved   end the incident, and a snooze with it
var measureKinds = []string{"acknowledged", "snoozed", "snooze_ended", "reassigned", "resolved", "auto_resolved"}

var snoozeEnders = map[string]bool{"acknowledged": true, "snooze_ended": true, "reassigned": true, "resolved": true, "auto_resolved": true}

// tally holds exact seconds, so a team's or the firm's mean is taken over all its incidents, never over means.
type tally struct {
	Incidents      int   `json:"incidents"`
	AckSeconds     int64 `json:"ack_seconds"`
	AckCount       int64 `json:"ack_count"`
	ResolveSeconds int64 `json:"resolve_seconds"`
	ResolveCount   int64 `json:"resolve_count"`
}

func (t *tally) add(other tally) {
	t.Incidents += other.Incidents
	t.AckSeconds += other.AckSeconds
	t.AckCount += other.AckCount
	t.ResolveSeconds += other.ResolveSeconds
	t.ResolveCount += other.ResolveCount
}

// meanMinutes is the mean of exact seconds in minutes, rounded half up to one decimal, or n/a with nothing to measure.
func meanMinutes(seconds, count int64) string {
	if count == 0 {
		return "n/a"
	}
	denominator := 60 * count
	tenths := (20*seconds + denominator) / (2 * denominator)
	return fmt.Sprintf("%d.%d", tenths/10, tenths%10)
}

// measureTotals is the published figures of a row.
type measureTotals struct {
	Incidents   int    `json:"incidents"`
	MttaMinutes string `json:"mtta_minutes"`
	MttrMinutes string `json:"mttr_minutes"`
}

func (t tally) totals() measureTotals {
	return measureTotals{Incidents: t.Incidents, MttaMinutes: meanMinutes(t.AckSeconds, t.AckCount),
		MttrMinutes: meanMinutes(t.ResolveSeconds, t.ResolveCount)}
}

// measureRow is one line of the response measures table.
type measureRow struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
	measureTotals
}

// plannedService is a service a job will measure.
type plannedService struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Team string `json:"team"`
}

// serviceMeasure is one service's tally.
type serviceMeasure struct {
	plannedService
	tally
}

// span is a stretch of time.
type span struct{ from, to time.Time }

// incidentTrace follows one incident through its own timeline entries.
type incidentTrace struct {
	openedAt       time.Time
	resolvedAt     *time.Time
	merged         bool
	acknowledgedAt *time.Time
	snoozes        []span
	snoozedSince   *time.Time
}

func (t *incidentTrace) see(kind string, at time.Time) {
	if kind == "acknowledged" && t.acknowledgedAt == nil {
		t.acknowledgedAt = &at
	}
	if snoozeEnders[kind] && t.snoozedSince != nil {
		t.snoozes = append(t.snoozes, span{*t.snoozedSince, at})
		t.snoozedSince = nil
	}
	if kind == "snoozed" {
		t.snoozedSince = &at
	}
}

// tally measures the incident: a source closed by merge counts for nothing, an end point that never happened leaves that
// measure out while the incident is still counted.
func (t *incidentTrace) tally(zone *time.Location) tally {
	if t.merged {
		return tally{}
	}
	measured := tally{Incidents: 1}
	if t.acknowledgedAt != nil {
		measured.AckCount = 1
		measured.AckSeconds = businessSeconds(zone, t.openedAt, *t.acknowledgedAt)
	}
	if t.resolvedAt != nil {
		if t.snoozedSince != nil {
			t.snoozes = append(t.snoozes, span{*t.snoozedSince, *t.resolvedAt})
		}
		measured.ResolveCount = 1
		measured.ResolveSeconds = businessSeconds(zone, t.openedAt, *t.resolvedAt)
		for _, snooze := range t.snoozes {
			measured.ResolveSeconds -= businessSeconds(zone, snooze.from, snooze.to)
		}
	}
	return measured
}

// measureService tallies the incidents of one service opened inside [from, to), an incident counting under the service it is
// on now.
func (a *App) measureService(ctx context.Context, zone *time.Location, service plannedService, from, to time.Time) (serviceMeasure, error) {
	measure := serviceMeasure{plannedService: service}
	rows, err := a.db.Query(ctx, `select i.id, i.opened_at, i.status, coalesce(i.resolve_reason, ''), i.resolved_at, t.at, t.kind
		from incidents i left join timeline t on t.incident_id = i.id and t.from_number is null and t.kind = any($4)
		where i.service_id = $1 and i.opened_at >= $2 and i.opened_at < $3 order by i.id, t.at, t.id`,
		service.ID, from, to, measureKinds)
	if err != nil {
		return measure, fmt.Errorf("read incidents of %s: %w", service.Name, err)
	}
	defer rows.Close()
	var current string
	var trace *incidentTrace
	for rows.Next() {
		var id, status, reason string
		var openedAt time.Time
		var resolvedAt, at *time.Time
		var kind *string
		if err := rows.Scan(&id, &openedAt, &status, &reason, &resolvedAt, &at, &kind); err != nil {
			return measure, fmt.Errorf("scan incident of %s: %w", service.Name, err)
		}
		if id != current {
			if trace != nil {
				measure.add(trace.tally(zone))
			}
			current = id
			trace = &incidentTrace{openedAt: openedAt, merged: status == "resolved" && reason == "Merged"}
			if status == "resolved" {
				trace.resolvedAt = resolvedAt
			}
		}
		if kind != nil {
			trace.see(*kind, *at)
		}
	}
	if err := rows.Err(); err != nil {
		return measure, fmt.Errorf("read incidents of %s: %w", service.Name, err)
	}
	if trace != nil {
		measure.add(trace.tally(zone))
	}
	return measure, nil
}
