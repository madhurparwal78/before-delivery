package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

type seedKey struct {
	Name   string
	Source string
}

var seedMainKeys = []seedKey{
	{"app.title", "Larkspur Rider"},
	{"nav.home", "Home"},
	{"nav.rides", "Rides"},
	{"nav.garage", "Garage"},
	{"nav.profile", "Profile"},
	{"home.greeting", "Welcome back, {name}."},
	{"home.weekly_distance", "You rode {distance} km this week."},
	{"home.start_ride", "Start a ride"},
	{"rides.empty", "No rides yet."},
	{"rides.filter.all", "All rides"},
	{"rides.filter.month", "This month"},
	{"rides.detail.duration", "Duration"},
	{"rides.detail.elevation", "Elevation gain"},
	{"rides.detail.share", "Share ride"},
	{"garage.add_bike", "Add a bike"},
	{"garage.service_due", "Service due in {days} days"},
	{"garage.tyre_pressure", "Tyre pressure"},
	{"garage.chain_wear", "Chain wear"},
	{"profile.edit", "Edit profile"},
	{"profile.units", "Units"},
	{"profile.units.metric", "Metric"},
	{"profile.units.imperial", "Imperial"},
	{"profile.sign_out", "Sign out"},
	{"settings.notifications", "Notifications"},
	{"settings.privacy", "Privacy"},
	{"settings.language", "Language"},
	{"cart.title", "Your basket"},
	{"cart.empty", "Your basket is empty."},
	{"cart.item_count", "{count} items"},
	{"cart.remove", "Remove"},
	{"checkout.title", "Checkout"},
	{"checkout.summary.title", "Basket summary"},
	{"checkout.shipping", "Shipping"},
	{"checkout.total", "Total: {amount}"},
	{"checkout.cta.pay", "Pay now"},
	{"checkout.success", "Thanks, {name}. Your order is on its way."},
	{"errors.network", "Check your connection and try again."},
	{"errors.payment_declined", "Your payment was declined."},
	{"errors.generic", "Something went wrong."},
	{"legal.terms", "Terms of service"},
}

var seedDe = []string{
	"Larkspur Rider", "Start", "Fahrten", "Garage", "Profil",
	"Willkommen zurück, {name}.", "Du bist diese Woche {distance} km gefahren.",
	"Fahrt starten", "Noch keine Fahrten.", "Alle Fahrten", "Diesen Monat", "Dauer",
}

var seedFr = []string{
	"Larkspur Rider", "Accueil", "Sorties", "Garage", "Profil",
	"Bon retour, {name}.", "Vous avez roulé {distance} km cette semaine.", "Démarrer une sortie",
}

var seedJaApproved = []string{"Larkspur Rider", "ホーム", "ライド", "ガレージ", "プロフィール"}

var seedTm = []struct{ Source, Target, Lang string }{
	{"Remove", "Entfernen", "de"},
	{"Remove", "Retirer", "fr"},
	{"Checkout", "Kasse", "de"},
	{"Total: {amount}", "Summe: {amount}", "de"},
	{"Sign out", "Abmelden", "de"},
	{"Sign out", "Se déconnecter", "fr"},
}

// SeedWorkspace writes the published seed exactly once, even when several
// instances boot at once against the same empty database.
func SeedWorkspace(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("seed begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Advisory lock: exactly one instance seeds.
	lock, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(473361)`)
	if err != nil {
		return fmt.Errorf("seed lock: %w", err)
	}
	_ = lock

	var n int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM projects`).Scan(&n); err != nil {
		return fmt.Errorf("seed count: %w", err)
	}
	if n > 0 {
		return nil
	}

	ownerID := uuid.New().String()
	hash, err := bcrypt.GenerateFromPassword([]byte("interline-demo-2026"), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("seed hash: %w", err)
	}
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES ($1,$2,$3,$4,'owner',$5)`,
		ownerID, "Robin Achterberg", "robin@marlowquill.example", string(hash), now); err != nil {
		return fmt.Errorf("seed owner: %w", err)
	}

	projectID := uuid.New().String()
	routes := map[string]string{"de": "lexa-general", "fr": "lexa-general", "ja": "lexa-formal"}
	routesJSON, _ := json.Marshal(routes)
	if _, err := tx.ExecContext(ctx, `INSERT INTO projects (id, slug, name, client, source_language, target_languages, repository, mqm_threshold, ai_routes, created_at)
		VALUES ($1,'larkspur-rider','Larkspur Rider','Larkspur Cycles','en',$2,'larkspur-cycles/rider-app',90,$3,$4)`,
		projectID, pq.Array([]string{"de", "fr", "ja"}), string(routesJSON), now); err != nil {
		return fmt.Errorf("seed project: %w", err)
	}

	// main branch
	mainID := uuid.New().String()
	if _, err := tx.ExecContext(ctx, `INSERT INTO branches (id, project_id, name, state, is_main, created_at) VALUES ($1,$2,'main','open',true,$3)`,
		mainID, projectID, now); err != nil {
		return fmt.Errorf("seed main: %w", err)
	}

	keyIDs := make([]string, len(seedMainKeys))
	for i, k := range seedMainKeys {
		id := uuid.New().String()
		keyIDs[i] = id
		src := k.Source
		if i == 31 {
			src = "Basket summary"
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO keys (id, project_id, branch_id, name, source, deleted, created_at) VALUES ($1,$2,$3,$4,$5,false,$6)`,
			id, projectID, mainID, k.Name, src, now); err != nil {
			return fmt.Errorf("seed key %s: %w", k.Name, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor) VALUES ($1,$2,'main','created',NULL,$3,'system')`,
			id, now, src); err != nil {
			return fmt.Errorf("seed key rev %s: %w", k.Name, err)
		}
		if i == 31 {
			if _, err := tx.ExecContext(ctx, `INSERT INTO key_revisions (key_id, at, branch, field, from_val, to_val, actor) VALUES ($1,$2,'main','source','Order summary',$3,'system')`,
				id, now, "Basket summary"); err != nil {
				return fmt.Errorf("seed key 32 rev: %w", err)
			}
		}
	}

	segment := func(keyIdx int, lang, value, status string, score *int, origin string, issues string) error {
		id := uuid.New().String()
		var scoreVal any
		if score != nil {
			scoreVal = *score
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
			id, projectID, mainID, keyIDs[keyIdx], lang, value, status, scoreVal, origin, issues, now); err != nil {
			return fmt.Errorf("seed segment: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO segment_history (segment_id, at, actor, from_status, to_status, value) VALUES ($1,$2,'system',NULL,'approved',$3)`,
			id, now, value); err != nil {
			return fmt.Errorf("seed segment history: %w", err)
		}
		return nil
	}

	approved := func(keyIdx int, lang, value string) error {
		s := 100
		return segment(keyIdx, lang, value, StatusApproved, &s, "seed", "[]")
	}
	for i := 0; i < 12; i++ {
		if err := approved(i, "de", seedDe[i]); err != nil {
			return err
		}
	}
	for i := 0; i < 8; i++ {
		if err := approved(i, "fr", seedFr[i]); err != nil {
			return err
		}
	}
	for i := 0; i < 5; i++ {
		if err := approved(i, "ja", seedJaApproved[i]); err != nil {
			return err
		}
	}
	s50 := 50
	if err := segment(5, "ja", "ようこそ、{name}。", StatusNeedsReview, &s50, "seed",
		`[{"category":"accuracy","severity":"major","note":"Drops \"back\" from the greeting."}]`); err != nil {
		return err
	}
	s80 := 80
	if err := segment(6, "ja", "今週は{distance}km走りました。", StatusNeedsReview, &s80, "seed",
		`[{"category":"fluency","severity":"minor","note":"Unit reads awkwardly."},{"category":"style","severity":"minor","note":"Casual register on a formal route."}]`); err != nil {
		return err
	}

	// remaining segments untranslated
	for _, lang := range []string{"de", "fr", "ja"} {
		start := 12
		if lang == "fr" {
			start = 8
		}
		if lang == "ja" {
			start = 7
		}
		for i := start; i < len(seedMainKeys); i++ {
			if lang == "ja" && i == 5 || lang == "ja" && i == 6 {
				continue
			}
			id := uuid.New().String()
			if _, err := tx.ExecContext(ctx, `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,NULL,'untranslated',NULL,NULL,'[]',$6,$6)`,
				id, projectID, mainID, keyIDs[i], lang, now); err != nil {
				return fmt.Errorf("seed untranslated: %w", err)
			}
		}
	}

	// TM entries
	for _, t := range seedTm {
		id := uuid.New().String()
		if _, err := tx.ExecContext(ctx, `INSERT INTO tm_entries (id, project_id, source, source_norm, target, target_norm, target_language, import_id, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8)`,
			id, projectID, t.Source, Normalise(t.Source), t.Target, Normalise(t.Target), t.Lang, now); err != nil {
			return fmt.Errorf("seed tm: %w", err)
		}
	}

	// feature branch
	branchID := uuid.New().String()
	if _, err := tx.ExecContext(ctx, `INSERT INTO branches (id, project_id, name, state, is_main, created_at) VALUES ($1,$2,'feature/checkout-redesign','open',false,$3)`,
		branchID, projectID, now); err != nil {
		return fmt.Errorf("seed branch: %w", err)
	}

	// branch copies every main key; key 32 keeps base source 'Order summary',
	// keys 35 and 32 get branch edits.
	for i, k := range seedMainKeys {
		src := k.Source
		if i == 31 {
			src = "Your order"
		}
		if i == 34 {
			src = "Pay and finish"
		}
		// the branch keeps main's key ids
		if _, err := tx.ExecContext(ctx, `INSERT INTO keys (id, project_id, branch_id, name, source, deleted, created_at) VALUES ($1,$2,$3,$4,$5,false,$6)`,
			keyIDs[i], projectID, branchID, k.Name, src, now); err != nil {
			return fmt.Errorf("seed branch key: %w", err)
		}
	}

	// branch keys checkout.saved_card and checkout.promo.label with three untranslated segments each
	for _, nk := range []seedKey{{"checkout.saved_card", "Pay with a saved card"}, {"checkout.promo.label", "Promo code"}} {
		id := uuid.New().String()
		if _, err := tx.ExecContext(ctx, `INSERT INTO keys (id, project_id, branch_id, name, source, deleted, created_at) VALUES ($1,$2,$3,$4,$5,false,$6)`,
			id, projectID, branchID, nk.Name, nk.Source, now); err != nil {
			return fmt.Errorf("seed branch new key: %w", err)
		}
		for _, lang := range []string{"de", "fr", "ja"} {
			sid := uuid.New().String()
			if _, err := tx.ExecContext(ctx, `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,NULL,'untranslated',NULL,NULL,'[]',$6,$6)`,
				sid, projectID, branchID, id, lang, now); err != nil {
				return fmt.Errorf("seed branch new segment: %w", err)
			}
		}
	}

	// copy main segments to the branch (new segment ids)
	rows, err := tx.QueryContext(ctx, `SELECT key_id, language, value, status, score, origin, issues FROM segments WHERE branch_id = $1`, mainID)
	if err != nil {
		return fmt.Errorf("seed copy segments: %w", err)
	}
	type segRow struct {
		KeyID  string
		Lang   string
		Value  *string
		Status string
		Score  *int
		Origin *string
		Issues string
	}
	var segs []segRow
	for rows.Next() {
		var r segRow
		if err := rows.Scan(&r.KeyID, &r.Lang, &r.Value, &r.Status, &r.Score, &r.Origin, &r.Issues); err != nil {
			rows.Close()
			return fmt.Errorf("seed scan: %w", err)
		}
		segs = append(segs, r)
	}
	rows.Close()
	for _, r := range segs {
		// find branch key id by name
		var bKeyID string
		if err := tx.QueryRowContext(ctx, `SELECT k2.id FROM keys k1 JOIN keys k2 ON k2.name = k1.name AND k2.branch_id = $1 WHERE k1.id = $2`,
			branchID, r.KeyID).Scan(&bKeyID); err != nil {
			return fmt.Errorf("seed branch key lookup: %w", err)
		}
		sid := uuid.New().String()
		if _, err := tx.ExecContext(ctx, `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
			sid, projectID, branchID, bKeyID, r.Lang, r.Value, r.Status, r.Score, r.Origin, r.Issues, now); err != nil {
			return fmt.Errorf("seed branch segment: %w", err)
		}
	}

	// the branch's base is main at creation: seed sources with key 32 at 'Order summary'
	for i, k := range seedMainKeys {
		src := k.Source
		if i == 31 {
			src = "Order summary"
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO branch_bases (branch_id, key_id, name, source, present) VALUES ($1,$2,$3,$4,true)`,
			branchID, keyIDs[i], k.Name, src); err != nil {
			return fmt.Errorf("seed branch base: %w", err)
		}
	}

	// the branch's conflict on key 32 source: base Order summary, main Basket summary, branch Your order
	if _, err := tx.ExecContext(ctx, `INSERT INTO conflicts (id, project_id, branch_id, key_id, field, base, main, branch, resolution, held_until, hold_session, seen_main)
		VALUES ($1,$2,$3,$4,'source','Order summary','Basket summary','Your order',NULL,NULL,NULL,'Basket summary')`,
		keyIDs[31]+":source", projectID, branchID, keyIDs[31]); err != nil {
		return fmt.Errorf("seed conflict: %w", err)
	}

	// audit entry
	if _, err := tx.ExecContext(ctx, `INSERT INTO audit_log (id, at, actor, action, project, detail) VALUES ($1,$2,'system','workspace.seeded','','')`,
		uuid.New(), now); err != nil {
		return fmt.Errorf("seed audit: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("seed commit: %w", err)
	}
	return nil
}
