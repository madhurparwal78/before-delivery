package main

import (
	"fmt"
	"time"
)

const (
	seedServiceName = "Shipment Tracking"
	seedResponder   = "Ines Varga"
	seedLead        = "Sunniva Okoye"
	seedMonitor     = "Tracking monitor"
	seedRoutingKey  = "rk_tracking_0003"
	seedPrivateNote = "NOTE-ONLY: rollback key is in vault slot 7."
	seedNoteDelay   = 20 * time.Minute
)

// seedIncident is one resolved incident of the brief's seed table; a zero instant did not happen.
type seedIncident struct {
	Number       int
	Key          string
	Opened       time.Time
	Acknowledged time.Time
	SnoozedUntil time.Time
	Resolved     time.Time
	MergedInto   int
}

func seedAt(month time.Month, day, hour, minute, second int) time.Time {
	return time.Date(2026, month, day, hour, minute, second, 0, time.UTC)
}

var seedIncidents = []seedIncident{
	{Number: 1, Key: "tracking-late-1", Opened: seedAt(time.October, 6, 14, 0, 0), Acknowledged: seedAt(time.October, 6, 14, 12, 30),
		Resolved: seedAt(time.October, 6, 15, 0, 0)},
	{Number: 2, Key: "tracking-late-2", Opened: seedAt(time.October, 6, 22, 50, 0), Acknowledged: seedAt(time.October, 7, 13, 5, 0),
		Resolved: seedAt(time.October, 7, 13, 20, 0)},
	{Number: 3, Key: "tracking-late-3", Opened: seedAt(time.October, 8, 14, 0, 0), Acknowledged: seedAt(time.October, 8, 14, 10, 0),
		SnoozedUntil: seedAt(time.October, 8, 15, 10, 0), Resolved: seedAt(time.October, 8, 16, 0, 0)},
	{Number: 4, Key: "tracking-late-4", Opened: seedAt(time.October, 8, 14, 5, 0), Resolved: seedAt(time.October, 8, 14, 6, 0),
		MergedInto: 3},
}

func (s seedIncident) title() string {
	return fmt.Sprintf("Tracking updates are late (batch %d)", s.Number)
}

// seedEntry is one timeline entry of a seeded incident.
type seedEntry struct {
	At    time.Time
	Kind  string
	Actor string
	Text  string
}

// entries is the timeline the incident would have written itself: triggered, acknowledged, snoozed and back to triggered,
// then resolved or merged.
func (s seedIncident) entries() ([]seedEntry, error) {
	entries := []seedEntry{{At: s.Opened, Kind: "triggered", Actor: seedMonitor,
		Text: fmt.Sprintf("Incident #%d triggered: %s", s.Number, s.title())}}
	if !s.Acknowledged.IsZero() {
		entries = append(entries, seedEntry{At: s.Acknowledged, Kind: "acknowledged", Actor: seedResponder,
			Text: fmt.Sprintf("Incident #%d acknowledged by %s", s.Number, seedResponder)})
	}
	if !s.SnoozedUntil.IsZero() {
		until, err := localTime(s.SnoozedUntil, firmZone)
		if err != nil {
			return nil, fmt.Errorf("local time: %w", err)
		}
		entries = append(entries,
			seedEntry{At: s.Acknowledged, Kind: "snoozed", Actor: seedResponder,
				Text: fmt.Sprintf("Incident #%d snoozed by %s until %s", s.Number, seedResponder, until)},
			seedEntry{At: s.SnoozedUntil, Kind: "snooze_ended", Actor: systemActor,
				Text: fmt.Sprintf("Incident #%d back to triggered: snooze ended", s.Number)})
	}
	if s.MergedInto != 0 {
		return append(entries, seedEntry{At: s.Resolved, Kind: "merged", Actor: seedLead,
			Text: fmt.Sprintf("Incident #%d merged into #%d by %s", s.Number, s.MergedInto, seedLead)}), nil
	}
	return append(entries, seedEntry{At: s.Resolved, Kind: "resolved", Actor: seedResponder,
		Text: fmt.Sprintf("Incident #%d resolved by %s", s.Number, seedResponder)}), nil
}

func init() {
	seeders = append(seeders, seeder{order: 50, name: "incidents", fn: seedResolvedIncidents})
}

// seedResolvedIncidents loads the four resolved incidents on Shipment Tracking with their alerts and timelines, and the
// private note on the first. The merged incident's alert and entries live on its target too, as a real merge leaves them.
func seedResolvedIncidents(a *App, w *Work) error {
	var serviceID string
	if err := w.Tx.QueryRow(w.Ctx, `select id from services where name = $1`, seedServiceName).Scan(&serviceID); err != nil {
		return fmt.Errorf("find service %s: %w", seedServiceName, err)
	}
	service, err := loadService(w.Ctx, w.Tx, serviceID)
	if err != nil {
		return fmt.Errorf("load service: %w", err)
	}
	snapshot, err := a.policySnapshotOf(w.Ctx, w.Tx, service.PolicyID)
	if err != nil {
		return fmt.Errorf("copy policy of %s: %w", service.Name, err)
	}
	ids := map[int]string{}
	for _, s := range seedIncidents {
		ids[s.Number] = newID()
	}
	for _, s := range seedIncidents {
		if err := insertSeedIncident(w, s, ids, service, snapshot); err != nil {
			return fmt.Errorf("insert seed incident: %w", err)
		}
	}
	for _, s := range seedIncidents {
		if err := insertSeedEntries(w, s, ids); err != nil {
			return fmt.Errorf("insert seed entries: %w", err)
		}
	}
	note := seedEntry{At: seedIncidents[0].Opened.Add(seedNoteDelay), Kind: "note", Actor: seedResponder, Text: seedPrivateNote}
	if err := insertSeedEntry(w, ids[1], note, nil); err != nil {
		return fmt.Errorf("insert seed note: %w", err)
	}
	return nil
}

func insertSeedIncident(w *Work, s seedIncident, ids map[int]string, service serviceRow, snapshot policySnapshot) error {
	decider, reason := seedResponder, "Resolved"
	var mergedInto *int
	home := s.Number
	if s.MergedInto != 0 {
		decider, reason, mergedInto, home = seedLead, "Merged", &s.MergedInto, s.MergedInto
	}
	_, err := w.Tx.Exec(w.Ctx, `insert into incidents (id, number, service_id, title, status, urgency, holders, level, cycle,
			policy_snapshot, opened_at, resolve_reason, merged_into, resolved_at, decided_by, decided_at, impacted_services)
		values ($1, $2, $3, $4, 'resolved', 'high', $5, 1, 0, $6, $7, $8, $9, $10, $11, $10, '{}')`,
		ids[s.Number], s.Number, service.ID, s.title(), []string{seededUserIDs[seedResponder]}, snapshot, s.Opened, reason,
		mergedInto, s.Resolved, decider)
	if err != nil {
		return fmt.Errorf("seed incident #%d: %w", s.Number, err)
	}
	resolvedAt := s.Resolved
	for _, h := range seedIncidents {
		if h.Number == home {
			resolvedAt = h.Resolved
		}
	}
	_, err = w.Tx.Exec(w.Ctx, `insert into alerts (id, incident_id, routing_key, dedup_key, status, summary, source, severity,
			event_count, opened_at, resolved_at, service_id)
		values ($1, $2, $3, $4, 'resolved', $5, 'tracking-feed', 'error', 1, $6, $7, $8)`,
		newID(), ids[home], seedRoutingKey, s.Key, s.title(), s.Opened, resolvedAt, service.ID)
	if err != nil {
		return fmt.Errorf("seed alert of incident #%d: %w", s.Number, err)
	}
	return nil
}

// insertSeedEntries writes an incident's timeline, and for a merged incident the copies its target carries.
func insertSeedEntries(w *Work, s seedIncident, ids map[int]string) error {
	entries, err := s.entries()
	if err != nil {
		return fmt.Errorf("build entries of seeded incident: %w", err)
	}
	for _, e := range entries {
		if err := insertSeedEntry(w, ids[s.Number], e, nil); err != nil {
			return fmt.Errorf("insert seed entry: %w", err)
		}
		if s.MergedInto != 0 {
			if err := insertSeedEntry(w, ids[s.MergedInto], e, &s.Number); err != nil {
				return fmt.Errorf("insert seed entry: %w", err)
			}
		}
	}
	return nil
}

func insertSeedEntry(w *Work, incidentID string, e seedEntry, fromNumber *int) error {
	_, err := w.Tx.Exec(w.Ctx, `insert into timeline (incident_id, at, kind, actor, text, from_number)
		values ($1, $2, $3, $4, $5, $6)`, incidentID, e.At, e.Kind, e.Actor, e.Text, fromNumber)
	if err != nil {
		return fmt.Errorf("seed %s entry: %w", e.Kind, err)
	}
	return nil
}
