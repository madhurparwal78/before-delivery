package core

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type PolicyTarget struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

type PolicyLevel struct {
	TimeoutMinutes int            `json:"timeout_minutes"`
	Targets        []PolicyTarget `json:"targets"`
}

type PolicySnapshot struct {
	Name    string        `json:"name"`
	Version int           `json:"version"`
	Repeats int           `json:"repeats"`
	Levels  []PolicyLevel `json:"levels"`
	ID      string        `json:"id,omitempty"`
}

const seedPassword = "yard-lamp-2026"

// seed loads the firm's starting record once, when the database is empty.
func (a *App) seed(ctx context.Context) error {
	var people int
	if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&people); err != nil {
		return fmt.Errorf("count users: %w", err)
	}
	if people > 0 {
		return nil
	}
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin seed: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := seedRecord(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit seed: %w", err)
	}
	return nil
}

func seedRecord(ctx context.Context, tx pgx.Tx) error {
	created := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	hash, err := hashPassword(seedPassword)
	if err != nil {
		return err
	}

	type seedPerson struct {
		name, email, role, zone string
		quietStart, quietEnd    *string
	}
	quiet := func(s, e string) (*string, *string) { return &s, &e }
	qs, qe := quiet("22:00", "07:00")
	ms, me := quiet("23:00", "07:00")
	peopleRows := []seedPerson{
		{"Rowan Achterberg", "rowan@tarecross.example", "admin", "America/Chicago", nil, nil},
		{"Sunniva Okoye", "sunniva@tarecross.example", "lead", "America/Chicago", nil, nil},
		{"Dario Mbeki", "dario@tarecross.example", "lead", "Europe/Lisbon", nil, nil},
		{"Ines Varga", "ines@tarecross.example", "responder", "America/Chicago", qs, qe},
		{"Tomasz Reyes", "tomasz@tarecross.example", "responder", "America/Chicago", qs, qe},
		{"Priya Lindqvist", "priya@tarecross.example", "responder", "Asia/Kolkata", qs, qe},
		{"Mateus Oyelaran", "mateus@tarecross.example", "responder", "Europe/Berlin", ms, me},
		{"Hana Castellanos", "hana@tarecross.example", "stakeholder", "America/Chicago", nil, nil},
	}
	ids := map[string]string{}
	for _, p := range peopleRows {
		id := newID()
		ids[p.name] = id
		_, err := tx.Exec(ctx, `INSERT INTO users (id, name, email, role, timezone, quiet_start, quiet_end,
			notification_delays, low_urgency_delay, password_hash, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,'[5,15]',0,$8,$9)`,
			id, p.name, p.email, p.role, p.zone, p.quietStart, p.quietEnd, hash, created)
		if err != nil {
			return fmt.Errorf("seed person %s: %w", p.name, err)
		}
	}

	type seedLayer struct {
		name         string
		ord          int
		shiftDays    int
		handoff      string
		startDate    string
		people       []string
		restrictions string
	}
	type seedSchedule struct {
		name, zone   string
		recordFormat int
		layers       []seedLayer
	}
	schedules := []seedSchedule{
		{"Transport Primary", "America/Chicago", 2, []seedLayer{
			{"Primary days", 1, 1, "08:00", "2026-01-05", []string{"Ines Varga", "Tomasz Reyes", "Priya Lindqvist", "Mateus Oyelaran"}, "[]"},
		}},
		{"Carrier Data", "America/Chicago", 2, []seedLayer{
			{"Base week", 1, 7, "09:00", "2026-01-05", []string{"Tomasz Reyes", "Ines Varga"}, "[]"},
			{"Weekend cover", 2, 7, "00:00", "2026-01-03", []string{"Mateus Oyelaran", "Priya Lindqvist"},
				`[{"days":["sat","sun"],"start":"00:00","end":"24:00"}]`},
		}},
		{"Tracking Nights", "Europe/Berlin", 2, []seedLayer{
			{"Nights", 1, 1, "20:00", "2026-01-05", []string{"Mateus Oyelaran", "Priya Lindqvist"},
				`[{"days":["mon","tue","wed","thu","fri","sat","sun"],"start":"20:00","end":"06:00"}]`},
		}},
		// Stored in the older record format, whose handoff is a UTC time.
		{"Legacy Yard Rota", "America/Chicago", 1, []seedLayer{
			{"Yard week", 1, 7, "14:00", "2026-01-05", []string{"Ines Varga", "Tomasz Reyes"}, "[]"},
		}},
	}
	scheduleIDs := map[string]string{}
	for _, s := range schedules {
		id := newID()
		scheduleIDs[s.name] = id
		if _, err := tx.Exec(ctx, `INSERT INTO schedules (id, name, zone, record_format, version, created_at)
			VALUES ($1,$2,$3,$4,1,$5)`, id, s.name, s.zone, s.recordFormat, created); err != nil {
			return fmt.Errorf("seed schedule %s: %w", s.name, err)
		}
		for _, l := range s.layers {
			layerID := newID()
			if _, err := tx.Exec(ctx, `INSERT INTO layers (id, schedule_id, name, ord, version, created_at)
				VALUES ($1,$2,$3,$4,1,$5)`, layerID, id, l.name, l.ord, created); err != nil {
				return fmt.Errorf("seed layer %s: %w", l.name, err)
			}
			peopleIDs := make([]string, 0, len(l.people))
			for _, name := range l.people {
				peopleIDs = append(peopleIDs, ids[name])
			}
			peopleJSON, err := json.Marshal(peopleIDs)
			if err != nil {
				return fmt.Errorf("seed layer people: %w", err)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO layer_versions (id, layer_id, from_at, to_at, shift_days,
				handoff_time, start_date, people, restrictions)
				VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8)`,
				newID(), layerID, time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC),
				l.shiftDays, l.handoff, l.startDate, peopleJSON, l.restrictions); err != nil {
				return fmt.Errorf("seed layer version %s: %w", l.name, err)
			}
		}
	}

	type seedPolicy struct {
		name    string
		repeats int
		levels  []PolicyLevel
	}
	person := func(name string) PolicyTarget { return PolicyTarget{Type: "person", ID: ids[name]} }
	schedule := func(name string) PolicyTarget { return PolicyTarget{Type: "schedule", ID: scheduleIDs[name]} }
	policies := []seedPolicy{
		{"Transport escalation", 0, []PolicyLevel{
			{30, []PolicyTarget{schedule("Transport Primary")}},
			{30, []PolicyTarget{person("Sunniva Okoye")}},
		}},
		{"Carrier escalation", 0, []PolicyLevel{
			{10, []PolicyTarget{schedule("Carrier Data")}},
			{5, []PolicyTarget{person("Dario Mbeki"), person("Sunniva Okoye")}},
		}},
		{"Tracking escalation", 2, []PolicyLevel{
			{30, []PolicyTarget{schedule("Tracking Nights")}},
			{30, []PolicyTarget{schedule("Transport Primary")}},
		}},
		{"Portal escalation", 0, []PolicyLevel{
			{30, []PolicyTarget{person("Priya Lindqvist")}},
		}},
	}
	policyIDs := map[string]string{}
	for _, p := range policies {
		id := newID()
		policyIDs[p.name] = id
		levels, err := json.Marshal(p.levels)
		if err != nil {
			return fmt.Errorf("seed policy levels: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO policies (id, name, repeats, levels, version, created_at)
			VALUES ($1,$2,$3,$4,1,$5)`, id, p.name, p.repeats, levels, created); err != nil {
			return fmt.Errorf("seed policy %s: %w", p.name, err)
		}
	}

	type seedService struct {
		name, team, policy string
		dependsOn          []string
		groupingMode       string
		groupingMinutes    *int
		ackTimeout         *int
		autoResolve        *int
		integration        string
		routingKey         string
	}
	services := []seedService{
		{"Transport Management", "Freight Core", "Transport escalation", []string{"Carrier Data Exchange"},
			"none", nil, ptr(30), nil, "Transport monitor", "rk_transport_0001"},
		{"Carrier Data Exchange", "Freight Core", "Carrier escalation", nil,
			"window", ptr(5), nil, ptr(240), "Carrier monitor", "rk_carrier_0002"},
		{"Shipment Tracking", "Customer Visibility", "Tracking escalation", []string{"Carrier Data Exchange"},
			"none", nil, nil, nil, "Tracking monitor", "rk_tracking_0003"},
		{"Customer Portal", "Customer Visibility", "Portal escalation", []string{"Shipment Tracking", "Transport Management"},
			"until_resolved", nil, nil, nil, "Portal monitor", "rk_portal_0004"},
	}
	serviceIDs := map[string]string{}
	for _, s := range services {
		id := newID()
		serviceIDs[s.name] = id
		if _, err := tx.Exec(ctx, `INSERT INTO services (id, name, team, policy_id, grouping_mode, grouping_minutes,
			ack_timeout_minutes, auto_resolve_minutes, version, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)`,
			id, s.name, s.team, policyIDs[s.policy], s.groupingMode, s.groupingMinutes,
			s.ackTimeout, s.autoResolve, created); err != nil {
			return fmt.Errorf("seed service %s: %w", s.name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO integrations (id, service_id, name, routing_key, created_at)
			VALUES ($1,$2,$3,$4,$5)`, newID(), id, s.integration, s.routingKey, created); err != nil {
			return fmt.Errorf("seed integration %s: %w", s.integration, err)
		}
	}
	for _, s := range services {
		for _, dep := range s.dependsOn {
			if _, err := tx.Exec(ctx, `INSERT INTO service_deps (service_id, depends_on_id) VALUES ($1,$2)`,
				serviceIDs[s.name], serviceIDs[dep]); err != nil {
				return fmt.Errorf("seed dependency %s: %w", dep, err)
			}
		}
	}

	if err := seedIncidents(ctx, tx, ids, serviceIDs, policyIDs, scheduleIDs); err != nil {
		return err
	}

	// Private markers: an unpublished draft and one published update.
	if _, err := tx.Exec(ctx, `INSERT INTO status_updates (id, title, body, state, service_ids, published_at, created_at)
		VALUES ($1,$2,$3,$4,$5,NULL,$6)`, newID(), "Carrier feed slowdown",
		"DRAFT-ONLY: carrier feed slowdown under review.", "investigating",
		mustJSON([]string{serviceIDs["Carrier Data Exchange"]}), created); err != nil {
		return fmt.Errorf("seed draft: %w", err)
	}
	published := time.Date(2026, 10, 8, 17, 0, 0, 0, time.UTC)
	if _, err := tx.Exec(ctx, `INSERT INTO status_updates (id, title, body, state, service_ids, published_at, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$6)`, newID(), "Tracking delays cleared",
		"Tracking updates are back on time.", "resolved",
		mustJSON([]string{serviceIDs["Shipment Tracking"]}), published); err != nil {
		return fmt.Errorf("seed published update: %w", err)
	}

	for _, email := range []string{"dock-office@meridian-haulage.example", "ops@larkfield-freight.example"} {
		if _, err := tx.Exec(ctx, `INSERT INTO subscribers (id, email, token, created_at) VALUES ($1,$2,$3,$4)`,
			newID(), email, randomHex(16), created); err != nil {
			return fmt.Errorf("seed subscriber: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `INSERT INTO webhook_endpoints (id, name, path, event_types, service_ids, secret, created_at)
		VALUES ($1,$2,$3,$4,'[]',$5,$6)`, newID(), "Carrier desk receiver", "/hooks/carrier-desk",
		mustJSON(webhookEventTypes), "whsec_seed_carrier_desk_7f3a", created); err != nil {
		return fmt.Errorf("seed webhook endpoint: %w", err)
	}

	seedKey := "slk_seed_read_4c1d"
	if _, err := tx.Exec(ctx, `INSERT INTO api_keys (id, name, scope, prefix, hash, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, newID(), "Dock board reader", "read", seedKey[:12],
		hashAPIKey(seedKey), created); err != nil {
		return fmt.Errorf("seed api key: %w", err)
	}
	return nil
}

func seedIncidents(ctx context.Context, tx pgx.Tx, people, services, policies, schedules map[string]string) error {
	trackingSnapshot := PolicySnapshot{
		Name:    "Tracking escalation",
		Version: 1,
		Repeats: 2,
		ID:      policies["Tracking escalation"],
		Levels: []PolicyLevel{
			{30, []PolicyTarget{{Type: "schedule", ID: schedules["Tracking Nights"], Name: "Tracking Nights"}}},
			{30, []PolicyTarget{{Type: "schedule", ID: schedules["Transport Primary"], Name: "Transport Primary"}}},
		},
	}
	snapshot := mustJSON(trackingSnapshot)
	ines := people["Ines Varga"]
	service := services["Shipment Tracking"]

	at := func(s string) time.Time {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			panic(err)
		}
		return t.UTC()
	}

	type seedIncident struct {
		number                         int64
		key, title, severity           string
		opened, resolved               time.Time
		acknowledged, snoozeFrom, snTo *time.Time
		reason                         string
		mergedIntoNumber               int64
	}
	ack1, ack2, ack3 := at("2026-10-06T14:12:30Z"), at("2026-10-07T13:05:00Z"), at("2026-10-08T14:10:00Z")
	snoozeFrom, snoozeTo := at("2026-10-08T14:10:00Z"), at("2026-10-08T15:10:00Z")
	rows := []seedIncident{
		{1, "tracking-late-1", "Tracking updates late for 40 shipments", "critical",
			at("2026-10-06T14:00:00Z"), at("2026-10-06T15:00:00Z"), &ack1, nil, nil, "Resolved", 0},
		{2, "tracking-late-2", "Tracking feed stalled overnight", "error",
			at("2026-10-06T22:50:00Z"), at("2026-10-07T13:20:00Z"), &ack2, nil, nil, "Resolved", 0},
		{3, "tracking-late-3", "Tracking updates late on carrier handovers", "critical",
			at("2026-10-08T14:00:00Z"), at("2026-10-08T16:00:00Z"), &ack3, &snoozeFrom, &snoozeTo, "Resolved", 0},
		{4, "tracking-late-4", "Tracking map stale for one lane", "error",
			at("2026-10-08T14:05:00Z"), at("2026-10-08T14:06:00Z"), nil, nil, nil, "Merged", 3},
	}
	incidentIDs := map[int64]string{}
	for _, r := range rows {
		id := newID()
		incidentIDs[r.number] = id
		var mergedInto *string
		if r.mergedIntoNumber != 0 {
			target := incidentIDs[r.mergedIntoNumber]
			mergedInto = &target
		}
		resolvedBy := "Ines Varga"
		if r.reason == "Merged" {
			resolvedBy = "Sunniva Okoye"
		}
		if _, err := tx.Exec(ctx, `INSERT INTO incidents (id, number, service_id, title, status, urgency, level, cycle,
			policy_snapshot, escalation_finished, opened_at, acknowledged_at, acknowledged_by, decided_at,
			resolved_at, resolve_reason, resolved_by, merged_into, version)
			VALUES ($1,$2,$3,$4,'resolved','high',1,0,$5,true,$6,$7,$8,$9,$9,$10,$11,$12,1)`,
			id, r.number, service, r.title, snapshot, r.opened, r.acknowledged,
			nullableName(r.acknowledged, "Ines Varga"), r.resolved, r.reason, resolvedBy, mergedInto); err != nil {
			return fmt.Errorf("seed incident %d: %w", r.number, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO incident_holders (incident_id, person_id, assignment_id, assigned_at)
			VALUES ($1,$2,$3,$4)`, id, ines, newID(), r.opened); err != nil {
			return fmt.Errorf("seed holder: %w", err)
		}
		alertIncident := id
		if r.mergedIntoNumber != 0 {
			alertIncident = incidentIDs[r.mergedIntoNumber]
		}
		if _, err := tx.Exec(ctx, `INSERT INTO alerts (id, incident_id, service_id, routing_key, dedup_key, status,
			summary, source, severity, event_count, opened_at, resolved_at)
			VALUES ($1,$2,$3,'rk_tracking_0003',$4,'resolved',$5,'tracking-worker-1',$6,1,$7,$8)`,
			newID(), alertIncident, service, r.key, r.title, r.severity, r.opened, r.resolved); err != nil {
			return fmt.Errorf("seed alert: %w", err)
		}

		entry := func(at time.Time, kind, actor, text string, fromNumber *int64) error {
			target := id
			if r.mergedIntoNumber != 0 {
				target = incidentIDs[r.mergedIntoNumber]
			}
			_, err := tx.Exec(ctx, `INSERT INTO timeline (id, incident_id, at, kind, actor, text, from_number)
				VALUES ($1,$2,$3,$4,$5,$6,$7)`, newID(), target, at, kind, actor, text, fromNumber)
			if err != nil {
				return fmt.Errorf("seed timeline: %w", err)
			}
			return nil
		}
		var from *int64
		if r.mergedIntoNumber != 0 {
			n := r.number
			from = &n
		}
		if err := entry(r.opened, "triggered", "Tracking monitor", txtTriggered(r.number, r.title), from); err != nil {
			return err
		}
		if r.acknowledged != nil {
			if err := entry(*r.acknowledged, "acknowledged", "Ines Varga", txtAcknowledged(r.number, "Ines Varga"), from); err != nil {
				return err
			}
		}
		if r.snoozeFrom != nil {
			if err := entry(*r.snoozeFrom, "snoozed", "Ines Varga", txtSnoozed(r.number, "Ines Varga", *r.snTo), from); err != nil {
				return err
			}
			if err := entry(*r.snTo, "snooze_ended", "Switchlamp", txtSnoozeEnded(r.number), from); err != nil {
				return err
			}
		}
		if r.reason == "Merged" {
			if err := entry(r.resolved, "merged", "Sunniva Okoye", txtMerged(r.number, r.mergedIntoNumber, "Sunniva Okoye"), from); err != nil {
				return err
			}
		} else {
			if err := entry(r.resolved, "resolved", "Ines Varga", txtResolved(r.number, "Ines Varga"), from); err != nil {
				return err
			}
		}
	}

	// The private note that must never reach a public surface.
	if _, err := tx.Exec(ctx, `INSERT INTO timeline (id, incident_id, at, kind, actor, text)
		VALUES ($1,$2,$3,'note','Ines Varga',$4)`, newID(), incidentIDs[1],
		time.Date(2026, 10, 6, 14, 30, 0, 0, time.UTC),
		"NOTE-ONLY: rollback key is in vault slot 7."); err != nil {
		return fmt.Errorf("seed note: %w", err)
	}
	return nil
}

func nullableName(at *time.Time, name string) *string {
	if at == nil {
		return nil
	}
	return &name
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
