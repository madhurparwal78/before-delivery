// Package seed loads the invented firm's starting data once, on an empty database.
package seed

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"switchlamp/internal/copytext"
)

const Password = "yard-lamp-2026"

type person struct {
	Name  string
	Email string
	Role  string
	Zone  string
	Quiet [2]*string
}

func sp(s string) *string { return &s }

func ip(i int) *int { return &i }

// Load seeds the database when it is empty.
func Load(ctx context.Context, pool *pgxpool.Pool) error {
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE removed_at IS NULL`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(Password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	people := []person{
		{"Rowan Achterberg", "rowan@tarecross.example", "admin", "America/Chicago", [2]*string{nil, nil}},
		{"Sunniva Okoye", "sunniva@tarecross.example", "lead", "America/Chicago", [2]*string{nil, nil}},
		{"Dario Mbeki", "dario@tarecross.example", "lead", "Europe/Lisbon", [2]*string{nil, nil}},
		{"Ines Varga", "ines@tarecross.example", "responder", "America/Chicago", [2]*string{sp("22:00"), sp("07:00")}},
		{"Tomasz Reyes", "tomasz@tarecross.example", "responder", "America/Chicago", [2]*string{sp("22:00"), sp("07:00")}},
		{"Priya Lindqvist", "priya@tarecross.example", "responder", "Asia/Kolkata", [2]*string{sp("22:00"), sp("07:00")}},
		{"Mateus Oyelaran", "mateus@tarecross.example", "responder", "Europe/Berlin", [2]*string{sp("23:00"), sp("07:00")}},
		{"Hana Castellanos", "hana@tarecross.example", "stakeholder", "America/Chicago", [2]*string{nil, nil}},
	}
	ids := map[string]string{}
	for _, p := range people {
		id := newID()
		ids[p.Name] = id
		_, err := pool.Exec(ctx, `INSERT INTO users (id, name, email, password_hash, role, timezone, quiet_start, quiet_end, notification_delays, low_urgency_delay)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0)`,
			id, p.Name, p.Email, string(hash), p.Role, p.Zone, p.Quiet[0], p.Quiet[1], `[5,15]`)
		if err != nil {
			return fmt.Errorf("seeding person %s: %w", p.Name, err)
		}
	}

	// Schedules and layers.
	type layerDef struct {
		schedule string
		name     string
		order    int
		days     int
		handoff  string
		start    string
		people   []string
		restr    string
		fmt1     bool
	}
	scheduleIDs := map[string]string{}
	schedules := []struct {
		name string
		zone string
	}{
		{"Transport Primary", "America/Chicago"},
		{"Carrier Data", "America/Chicago"},
		{"Tracking Nights", "Europe/Berlin"},
		{"Legacy Yard Rota", "America/Chicago"},
	}
	for _, sc := range schedules {
		id := newID()
		scheduleIDs[sc.name] = id
		fmtV := 2
		if sc.name == "Legacy Yard Rota" {
			fmtV = 1
		}
		if _, err := pool.Exec(ctx, `INSERT INTO schedules (id, name, zone, record_format) VALUES ($1,$2,$3,$4)`,
			id, sc.name, sc.zone, fmtV); err != nil {
			return err
		}
	}
	layers := []layerDef{
		{"Transport Primary", "Primary days", 1, 1, "08:00", "2026-01-05", []string{"Ines Varga", "Tomasz Reyes", "Priya Lindqvist", "Mateus Oyelaran"}, "[]", false},
		{"Carrier Data", "Base week", 1, 7, "09:00", "2026-01-05", []string{"Tomasz Reyes", "Ines Varga"}, "[]", false},
		{"Carrier Data", "Weekend cover", 2, 7, "00:00", "2026-01-03", []string{"Mateus Oyelaran", "Priya Lindqvist"}, `[{"days":["sat","sun"],"start":"00:00","end":"24:00"}]`, false},
		{"Tracking Nights", "Nights", 1, 1, "20:00", "2026-01-05", []string{"Mateus Oyelaran", "Priya Lindqvist"}, `[{"days":["mon","tue","wed","thu","fri","sat","sun"],"start":"20:00","end":"06:00"}]`, false},
		{"Legacy Yard Rota", "Yard week", 1, 7, "14:00", "2026-01-05", []string{"Ines Varga", "Tomasz Reyes"}, "[]", true},
	}
	for _, l := range layers {
		// The layer's people hold the person ids, not the names.
		peopleIDs := make([]string, 0, len(l.people))
		for _, name := range l.people {
			peopleIDs = append(peopleIDs, ids[name])
		}
		people, _ := json.Marshal(peopleIDs)
		handoff := l.handoff
		if l.fmt1 {
			// record_format 1 stores the handoff as a UTC time.
			handoff = "14:00"
		}
		if _, err := pool.Exec(ctx, `INSERT INTO layers (id, schedule_id, name, "order", shift_days, handoff_time, start_date, people, restrictions, edited_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
			newID(), scheduleIDs[l.schedule], l.name, l.order, l.days, handoff, l.start, string(people), l.restr); err != nil {
			return fmt.Errorf("seeding layer %s: %w", l.name, err)
		}
	}

	// Policies.
	policyIDs := map[string]string{}
	policies := []struct {
		name    string
		repeats int
		levels  string
	}{
		{"Transport escalation", 0, fmt.Sprintf(`[{"timeout_minutes":30,"targets":[{"type":"schedule","id":"%s","name":"Transport Primary"}]},{"timeout_minutes":30,"targets":[{"type":"person","id":"%s","name":"Sunniva Okoye"}]}]`, scheduleIDs["Transport Primary"], ids["Sunniva Okoye"])},
		{"Carrier escalation", 0, fmt.Sprintf(`[{"timeout_minutes":10,"targets":[{"type":"schedule","id":"%s","name":"Carrier Data"}]},{"timeout_minutes":5,"targets":[{"type":"person","id":"%s","name":"Dario Mbeki"},{"type":"person","id":"%s","name":"Sunniva Okoye"}]}]`, scheduleIDs["Carrier Data"], ids["Dario Mbeki"], ids["Sunniva Okoye"])},
		{"Tracking escalation", 2, fmt.Sprintf(`[{"timeout_minutes":30,"targets":[{"type":"schedule","id":"%s","name":"Tracking Nights"}]},{"timeout_minutes":30,"targets":[{"type":"schedule","id":"%s","name":"Transport Primary"}]}]`, scheduleIDs["Tracking Nights"], scheduleIDs["Transport Primary"])},
		{"Portal escalation", 0, fmt.Sprintf(`[{"timeout_minutes":30,"targets":[{"type":"person","id":"%s","name":"Priya Lindqvist"}]}]`, ids["Priya Lindqvist"])},
	}
	for _, p := range policies {
		id := newID()
		policyIDs[p.name] = id
		if _, err := pool.Exec(ctx, `INSERT INTO policies (id, name, repeats, levels) VALUES ($1,$2,$3,$4)`,
			id, p.name, p.repeats, p.levels); err != nil {
			return err
		}
	}

	// Services and integrations.
	serviceIDs := map[string]string{}
	services := []struct {
		name, team, policy string
		depends            string
		grouping           string
		groupingMinutes    *int
		ackTimeout         *int
		autoResolve        *int
		integration        string
		routing            string
	}{
		{"Transport Management", "Freight Core", "Transport escalation", `[]`, "none", nil, ip(30), nil, "Transport monitor", "rk_transport_0001"},
		{"Carrier Data Exchange", "Freight Core", "Carrier escalation", `[]`, "window", ip(5), nil, ip(240), "Carrier monitor", "rk_carrier_0002"},
		{"Shipment Tracking", "Customer Visibility", "Tracking escalation", `[]`, "none", nil, nil, nil, "Tracking monitor", "rk_tracking_0003"},
		{"Customer Portal", "Customer Visibility", "Portal escalation", `["Shipment Tracking"]`, "until_resolved", nil, nil, nil, "Portal monitor", "rk_portal_0004"},
	}
	// Fill dependencies that resolve after services exist.
	depPatch := map[string]string{
		"Transport Management":     `["Carrier Data Exchange"]`,
		"Shipment Tracking":       `["Carrier Data Exchange"]`,
		"Customer Portal":         `["Shipment Tracking","Transport Management"]`,
	}
	for _, sv := range services {
		id := newID()
		serviceIDs[sv.name] = id
		dep := sv.depends
		if p, ok := depPatch[sv.name]; ok {
			dep = p
		}
		if _, err := pool.Exec(ctx, `INSERT INTO services (id, name, team, policy_id, depends_on, grouping_mode, grouping_minutes, ack_timeout_minutes, auto_resolve_minutes)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			id, sv.name, sv.team, policyIDs[sv.policy], dep, sv.grouping, sv.groupingMinutes, sv.ackTimeout, sv.autoResolve); err != nil {
			return fmt.Errorf("seeding service %s: %w", sv.name, err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO integrations (id, service_id, name, routing_key) VALUES ($1,$2,$3,$4)`,
			newID(), id, sv.integration, sv.routing); err != nil {
			return err
		}
	}
	_ = serviceIDs

	// Resolved incidents on Shipment Tracking, numbers 1 to 4.
	trackID := serviceIDs["Shipment Tracking"]
	trackPolicy, err := policyJSON(ctx, pool, policyIDs["Tracking escalation"])
	if err != nil {
		return err
	}
	ines := ids["Ines Varga"]
	type seedIncident struct {
		number    int64
		key       string
		opened    string
		acked     *string
		snoozed   *string
		resolved  *string
		mergedTo  *int64
		note      string
	}
	want := []seedIncident{
		{1, "tracking-late-1", "2026-10-06T14:00:00Z", sp("2026-10-06T14:12:30Z"), nil, sp("2026-10-06T15:00:00Z"), nil, "NOTE-ONLY: rollback key is in vault slot 7."},
		{2, "tracking-late-2", "2026-10-06T22:50:00Z", sp("2026-10-07T13:05:00Z"), nil, sp("2026-10-07T13:20:00Z"), nil, ""},
		{3, "tracking-late-3", "2026-10-08T14:00:00Z", sp("2026-10-08T14:10:00Z"), sp("2026-10-08T15:10:00Z"), sp("2026-10-08T16:00:00Z"), nil, ""},
		{4, "tracking-late-4", "2026-10-08T14:05:00Z", nil, nil, sp("2026-10-08T14:06:00Z"), nil, ""},
	}
	incidentIDs := map[int64]string{}
	for _, w := range want {
		incID := newID()
		incidentIDs[w.number] = incID
		title := fmt.Sprintf("Tracking delay %d", w.number)
		actor := "Ines Varga"
		status := "resolved"
		resolveReason := "Resolved"
		mergedInto := (*string)(nil)
		if w.number == 4 {
			title = "Tracking delay 4"
			resolveReason = "Merged"
			actor = "Sunniva Okoye"
			mergedInto = sp(incidentIDs[3])
		}
		if _, err := pool.Exec(ctx, `INSERT INTO incidents (id, number, title, service_id, status, urgency, policy_snapshot, holders, opened_at, resolve_reason, merged_into, closed_at, snoozed_until, snoozed_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
			incID, w.number, title, trackID, status, "low", trackPolicy, `[]`, w.opened, resolveReason, mergedInto, w.resolved, w.snoozed, func() *string { if w.number == 3 { return sp(ines) } else { return nil } }()); err != nil {
			return fmt.Errorf("seeding incident %d: %w", w.number, err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO alerts (id, incident_id, routing_key, dedup_key, status, summary, source, severity, opened_at, resolved_at)
			VALUES ($1,$2,'rk_tracking_0003',$3,$4,$5,'tracking-seed','warning',$6,$7)`,
			newID(), incID, w.key, "resolved", title, w.opened, w.resolved); err != nil {
			return err
		}
		addTimeline(ctx, pool, incID, w.opened, "triggered", "Switchlamp", fmt.Sprintf("Incident #%d triggered: %s", w.number, title))
		if w.acked != nil {
			addTimeline(ctx, pool, incID, *w.acked, "acknowledged", actor, fmt.Sprintf("Incident #%d acknowledged by %s", w.number, actor))
		}
		if w.snoozed != nil {
			addTimeline(ctx, pool, incID, "2026-10-08T14:10:00Z", "snoozed", actor, fmt.Sprintf("Incident #%d snoozed by %s until 2026-10-08 10:10 CDT", w.number, actor))
			addTimeline(ctx, pool, incID, *w.snoozed, "snooze_ended", "Switchlamp", fmt.Sprintf("Incident #%d back to triggered: snooze ended", w.number))
		}
		if w.number == 4 {
			addTimeline(ctx, pool, incID, *w.resolved, "merged", actor, fmt.Sprintf("Incident #%d merged into #3 by %s", w.number, actor))
		} else {
			addTimeline(ctx, pool, incID, *w.resolved, "resolved", actor, fmt.Sprintf("Incident #%d resolved by %s", w.number, actor))
		}
		if w.note != "" {
			if _, err := pool.Exec(ctx, `INSERT INTO timelines (id, incident_id, at, kind, actor, text) VALUES ($1,$2,$3,'note',$4,$5)`,
				newID(), incID, "2026-10-06T14:20:00Z", "Ines Varga", w.note); err != nil {
				return err
			}
		}
	}
	// Incident 4 merged into 3.
	if _, err := pool.Exec(ctx, `UPDATE incidents SET merged_into = $1 WHERE number = 4`, incidentIDs[3]); err != nil {
		return err
	}

	// Private markers: draft and published update.
	if _, err := pool.Exec(ctx, `INSERT INTO status_updates (id, title, body, state, service_ids)
		VALUES ($1,'Carrier feed slowdown','DRAFT-ONLY: carrier feed slowdown under review.','investigating','[]')`,
		newID()); err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `INSERT INTO status_updates (id, title, body, state, service_ids, published_at)
		VALUES ($1,'Tracking delays cleared','Tracking updates are back on time.','resolved',$2,'2026-10-08T17:00:00Z')`,
		newID(), fmt.Sprintf(`["%s"]`, serviceIDs["Shipment Tracking"])); err != nil {
		return err
	}
	for _, email := range []string{"dock-office@meridian-haulage.example", "ops@larkfield-freight.example"} {
		if _, err := pool.Exec(ctx, `INSERT INTO subscribers (id, email, token) VALUES ($1,$2,$3)`,
			newID(), email, token(32)); err != nil {
			return err
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO webhook_endpoints (id, name, path, event_types, service_ids, secret)
		VALUES ($1,'Carrier desk receiver','/hooks/carrier-desk',$2,'[]','whsec_seed_carrier_desk_7f3a')`,
		newID(), `["incident.triggered","incident.acknowledged","incident.snoozed","incident.unacknowledged","incident.escalated","incident.reassigned","incident.merged","incident.resolved"]`); err != nil {
		return err
	}
	keyHash := sha256.Sum256([]byte("slk_seed_read_4c1d"))
	if _, err := pool.Exec(ctx, `INSERT INTO api_keys (id, name, scope, key_hash) VALUES ($1,'Dock board reader','read',$2)`,
		newID(), hex.EncodeToString(keyHash[:])); err != nil {
		return err
	}
	return nil
}

func addTimeline(ctx context.Context, pool *pgxpool.Pool, incidentID, at, kind, actor, text string) error {
	_, err := pool.Exec(ctx, `INSERT INTO timelines (id, incident_id, at, kind, actor, text) VALUES ($1,$2,$3,$4,$5,$6)`,
		newID(), incidentID, at, kind, actor, text)
	return err
}

func policyJSON(ctx context.Context, pool *pgxpool.Pool, id string) (string, error) {
	var levels string
	var repeats int
	var name string
	err := pool.QueryRow(ctx, `SELECT name, repeats, levels FROM policies WHERE id = $1`, id).Scan(&name, &repeats, &levels)
	if err != nil {
		return "", err
	}
	b, _ := json.Marshal(map[string]any{"name": name, "version": 1, "repeats": repeats, "levels": json.RawMessage(levels)})
	return string(b), nil
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func token(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

var _ = copytext.Saved
var _ = time.Now
