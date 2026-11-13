package main

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	seedOwnerName     = "Robin Achterberg"
	seedOwnerEmail    = "robin@marlowquill.example"
	seedOwnerPassword = "interline-demo-2026"
	seedBranchName    = "feature/checkout-redesign"
)

var seedKeys = [][2]string{
	{"app.title", "Larkspur Rider"}, {"nav.home", "Home"}, {"nav.rides", "Rides"}, {"nav.garage", "Garage"},
	{"nav.profile", "Profile"}, {"home.greeting", "Welcome back, {name}."}, {"home.weekly_distance", "You rode {distance} km this week."},
	{"home.start_ride", "Start a ride"}, {"rides.empty", "No rides yet."}, {"rides.filter.all", "All rides"},
	{"rides.filter.month", "This month"}, {"rides.detail.duration", "Duration"}, {"rides.detail.elevation", "Elevation gain"},
	{"rides.detail.share", "Share ride"}, {"garage.add_bike", "Add a bike"}, {"garage.service_due", "Service due in {days} days"},
	{"garage.tyre_pressure", "Tyre pressure"}, {"garage.chain_wear", "Chain wear"}, {"profile.edit", "Edit profile"},
	{"profile.units", "Units"}, {"profile.units.metric", "Metric"}, {"profile.units.imperial", "Imperial"},
	{"profile.sign_out", "Sign out"}, {"settings.notifications", "Notifications"}, {"settings.privacy", "Privacy"},
	{"settings.language", "Language"}, {"cart.title", "Your basket"}, {"cart.empty", "Your basket is empty."},
	{"cart.item_count", "{count} items"}, {"cart.remove", "Remove"}, {"checkout.title", "Checkout"},
	{"checkout.summary.title", "Order summary"}, {"checkout.shipping", "Shipping"}, {"checkout.total", "Total: {amount}"},
	{"checkout.cta.pay", "Pay now"}, {"checkout.success", "Thanks, {name}. Your order is on its way."},
	{"errors.network", "Check your connection and try again."}, {"errors.payment_declined", "Your payment was declined."},
	{"errors.generic", "Something went wrong."}, {"legal.terms", "Terms of service"},
}

var seedApproved = map[string][]string{
	"de": {"Larkspur Rider", "Start", "Fahrten", "Garage", "Profil", "Willkommen zurück, {name}.", "Du bist diese Woche {distance} km gefahren.",
		"Fahrt starten", "Noch keine Fahrten.", "Alle Fahrten", "Diesen Monat", "Dauer"},
	"fr": {"Larkspur Rider", "Accueil", "Sorties", "Garage", "Profil", "Bon retour, {name}.", "Vous avez roulé {distance} km cette semaine.", "Démarrer une sortie"},
	"ja": {"Larkspur Rider", "ホーム", "ライド", "ガレージ", "プロフィール"},
}

var seedTM = [][3]string{
	{"Remove", "de", "Entfernen"}, {"Remove", "fr", "Retirer"}, {"Checkout", "de", "Kasse"},
	{"Total: {amount}", "de", "Summe: {amount}"}, {"Sign out", "de", "Abmelden"}, {"Sign out", "fr", "Se déconnecter"},
}

// seed writes the published demo workspace; it runs once, inside the schema lock.
func (a *App) seed(ctx context.Context, tx pgx.Tx) error {
	at := time.Now().UTC().Truncate(time.Second)
	hash, err := hashPassword(seedOwnerPassword)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "INSERT INTO users (id, name, email, role, password_hash, created_at) VALUES ($1, $2, $3, 'owner', $4, $5)",
		newID(), seedOwnerName, seedOwnerEmail, hash, at); err != nil {
		return fmt.Errorf("seed owner: %w", err)
	}
	p := &Project{ID: newID(), Slug: "larkspur-rider", Name: "Larkspur Rider", Client: "Larkspur Cycles", SourceLanguage: "en",
		TargetLanguages: []string{"de", "fr", "ja"}, Repository: "larkspur-cycles/rider-app", MQMThreshold: 90,
		AIRoutes: map[string]string{"de": "lexa-general", "fr": "lexa-general", "ja": "lexa-formal"}, CreatedAt: at}
	if err := insertProject(ctx, tx, p); err != nil {
		return err
	}
	main, err := mainBranch(ctx, tx, p.ID)
	if err != nil {
		return err
	}
	keyIDs := make([]string, len(seedKeys))
	for i, kv := range seedKeys {
		keyIDs[i] = newID()
		if _, err := tx.Exec(ctx, "INSERT INTO keys (id, project_id) VALUES ($1, $2)", keyIDs[i], p.ID); err != nil {
			return fmt.Errorf("seed key: %w", err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO branch_keys (branch_id, key_id, name, source) VALUES ($1, $2, $3, $4)", main.ID, keyIDs[i], kv[0], kv[1]); err != nil {
			return fmt.Errorf("seed branch key: %w", err)
		}
		if err := addRevision(ctx, tx, p.ID, keyIDs[i], "main", "created", nil, &kv[0], "system"); err != nil {
			return err
		}
		for _, lang := range p.TargetLanguages {
			if err := seedSegment(ctx, tx, p, main.ID, keyIDs[i], lang, i, kv[1], at); err != nil {
				return err
			}
		}
	}
	for _, e := range seedTM {
		if _, err := tx.Exec(ctx, `INSERT INTO tm_entries (id, project_id, source, norm_source, target_language, target, norm_target, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, newID(), p.ID, e[0], normalise(e[0]), e[1], e[2], normalise(e[2]), at); err != nil {
			return fmt.Errorf("seed TM entry: %w", err)
		}
	}
	feature := &Branch{ID: newID(), ProjectID: p.ID, Name: seedBranchName, State: stateOpen, CreatedAt: at.Add(time.Second)}
	if err := copyMainToBranch(ctx, tx, main.ID, feature); err != nil {
		return err
	}
	const summaryKey, payKey = 31, 34
	order, basket := "Order summary", "Basket summary"
	if _, err := tx.Exec(ctx, "UPDATE branch_keys SET source = $3 WHERE branch_id = $1 AND key_id = $2", main.ID, keyIDs[summaryKey], basket); err != nil {
		return fmt.Errorf("seed main edit: %w", err)
	}
	if err := addRevision(ctx, tx, p.ID, keyIDs[summaryKey], "main", "source", &order, &basket, "system"); err != nil {
		return err
	}
	for keyIdx, source := range map[int]string{payKey: "Pay and finish", summaryKey: "Your order"} {
		if _, err := tx.Exec(ctx, "UPDATE branch_keys SET source = $3 WHERE branch_id = $1 AND key_id = $2", feature.ID, keyIDs[keyIdx], source); err != nil {
			return fmt.Errorf("seed branch edit: %w", err)
		}
	}
	for _, kv := range [][2]string{{"checkout.saved_card", "Pay with a saved card"}, {"checkout.promo.label", "Promo code"}} {
		if _, err := a.createKey(ctx, tx, p, feature, kv[0], kv[1], "system", at); err != nil {
			return err
		}
	}
	return a.audit(ctx, tx, "system", "workspace.seeded", nil, "")
}

// seedSegment inserts the published translation (or the untranslated state) of key index i in one language.
func seedSegment(ctx context.Context, tx pgx.Tx, p *Project, branchID, keyID, lang string, i int, source string, at time.Time) error {
	s := &Segment{ID: newID(), Status: statusUntranslated, Issues: []Issue{}, Comments: []Comment{}, History: []HistoryEntry{}}
	approved := seedApproved[lang]
	switch {
	case i < len(approved):
		v, score, origin := approved[i], 100, "seed"
		s.Value, s.Score, s.Origin = &v, &score, &origin
		s.record("system", statusApproved, at, "")
	case lang == "ja" && i == 5:
		v, score, origin := "ようこそ、{name}。", 50, "seed"
		s.Value, s.Score, s.Origin = &v, &score, &origin
		s.Issues = []Issue{{Category: "accuracy", Severity: "major", Note: `Drops "back" from the greeting.`}}
		s.record("system", statusNeedsReview, at, "")
	case lang == "ja" && i == 6:
		v, score, origin := "今週は{distance}km走りました。", 80, "seed"
		s.Value, s.Score, s.Origin = &v, &score, &origin
		s.Issues = []Issue{{Category: "fluency", Severity: "minor", Note: "Unit reads awkwardly."}, {Category: "style", Severity: "minor", Note: "Casual register on a formal route."}}
		s.record("system", statusNeedsReview, at, "")
	}
	_, err := tx.Exec(ctx, `INSERT INTO segments (id, project_id, branch_id, key_id, language, value, status, score, origin, issues, comments, history)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, s.ID, p.ID, branchID, keyID, lang, s.Value, s.Status, s.Score, s.Origin, s.Issues, s.Comments, s.History)
	if err != nil {
		return fmt.Errorf("seed segment: %w", err)
	}
	return nil
}
