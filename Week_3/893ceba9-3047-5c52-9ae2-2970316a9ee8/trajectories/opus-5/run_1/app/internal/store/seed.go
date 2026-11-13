package store

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"

	"github.com/marlowquill/interline-desk/internal/domain"
)

type seedKey struct {
	name   string
	source string
}

var seedKeys = []seedKey{
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

var seedGerman = []string{
	"Larkspur Rider", "Start", "Fahrten", "Garage", "Profil", "Willkommen zurück, {name}.",
	"Du bist diese Woche {distance} km gefahren.", "Fahrt starten", "Noch keine Fahrten.",
	"Alle Fahrten", "Diesen Monat", "Dauer",
}

var seedFrench = []string{
	"Larkspur Rider", "Accueil", "Sorties", "Garage", "Profil", "Bon retour, {name}.",
	"Vous avez roulé {distance} km cette semaine.", "Démarrer une sortie",
}

var seedJapanese = []string{"Larkspur Rider", "ホーム", "ライド", "ガレージ", "プロフィール"}

type seedTM struct {
	source   string
	language string
	target   string
}

var seedMemory = []seedTM{
	{"Remove", "de", "Entfernen"},
	{"Remove", "fr", "Retirer"},
	{"Checkout", "de", "Kasse"},
	{"Total: {amount}", "de", "Summe: {amount}"},
	{"Sign out", "de", "Abmelden"},
	{"Sign out", "fr", "Se déconnecter"},
}

// Seed writes the demo workspace exactly once, however many instances boot at
// once against the same database.
func (s *Store) Seed(ctx context.Context) error {
	if _, err := s.Pool.Exec(ctx, "select pg_advisory_lock(818273642)"); err != nil {
		return fmt.Errorf("take seed lock: %w", err)
	}
	defer func() {
		if _, err := s.Pool.Exec(ctx, "select pg_advisory_unlock(818273642)"); err != nil {
			log.Printf("release seed lock: %v", err)
		}
	}()

	var users, projects int
	if err := s.Pool.QueryRow(ctx, `select (select count(*) from users), (select count(*) from projects)`).
		Scan(&users, &projects); err != nil {
		return fmt.Errorf("count workspace: %w", err)
	}
	if users > 0 || projects > 0 {
		return nil
	}
	return s.InTx(ctx, func(tx pgx.Tx) error { return s.writeSeed(ctx, tx) })
}

func (s *Store) writeSeed(ctx context.Context, tx pgx.Tx) error {
	now := Now()
	ownerID := NewID()
	if _, err := tx.Exec(ctx, `insert into users (id, name, email, password_hash, role, created_at)
	        values ($1,$2,$3,$4,'owner',$5)`, ownerID, "Robin Achterberg", "robin@marlowquill.example",
		HashPassword("interline-demo-2026"), now); err != nil {
		return fmt.Errorf("insert owner: %w", err)
	}

	project := &Project{
		ID: NewID(), Slug: "larkspur-rider", Name: "Larkspur Rider", Client: "Larkspur Cycles",
		SourceLanguage: "en", TargetLanguages: []string{"de", "fr", "ja"},
		Repository: "larkspur-cycles/rider-app", MQMThreshold: 90,
		AIRoutes:  map[string]string{"de": "lexa-general", "fr": "lexa-general", "ja": "lexa-formal"},
		CreatedAt: now,
	}
	if err := s.InsertProject(ctx, tx, project); err != nil {
		return err
	}

	main := &Branch{ID: NewID(), ProjectID: project.ID, Name: "main", State: domain.BranchOpen,
		IsMain: true, CreatedAt: now, Base: domain.KeySet{}}
	if err := s.InsertBranch(ctx, tx, main); err != nil {
		return err
	}

	keyIDs := make([]string, len(seedKeys))
	for i, k := range seedKeys {
		keyIDs[i] = NewID()
		if err := s.InsertKey(ctx, tx, project, main.ID, keyIDs[i], k.name, k.source); err != nil {
			return err
		}
		if err := s.AddKeyRevision(ctx, tx, project.ID, keyIDs[i], "main", "created", nil, &seedKeys[i].source,
			"robin@marlowquill.example", now); err != nil {
			return err
		}
	}
	orderSummary := "Order summary"
	basketSummary := "Basket summary"
	if err := s.AddKeyRevision(ctx, tx, project.ID, keyIDs[31], "main", "source", &orderSummary,
		&basketSummary, "robin@marlowquill.example", now); err != nil {
		return err
	}

	fill := func(lang string, values []string, status string, score int) error {
		for i, value := range values {
			if err := s.setSeedSegment(ctx, tx, main.ID, keyIDs[i], lang, value, status, score, nil); err != nil {
				return err
			}
		}
		return nil
	}
	if err := fill("de", seedGerman, domain.StatusApproved, 100); err != nil {
		return err
	}
	if err := fill("fr", seedFrench, domain.StatusApproved, 100); err != nil {
		return err
	}
	if err := fill("ja", seedJapanese, domain.StatusApproved, 100); err != nil {
		return err
	}
	if err := s.setSeedSegment(ctx, tx, main.ID, keyIDs[5], "ja", "ようこそ、{name}。", domain.StatusNeedsReview, 50,
		[]domain.Issue{{Category: "accuracy", Severity: "major", Note: `Drops "back" from the greeting.`}}); err != nil {
		return err
	}
	if err := s.setSeedSegment(ctx, tx, main.ID, keyIDs[6], "ja", "今週は{distance}km走りました。", domain.StatusNeedsReview, 80,
		[]domain.Issue{
			{Category: "fluency", Severity: "minor", Note: "Unit reads awkwardly."},
			{Category: "style", Severity: "minor", Note: "Casual register on a formal route."},
		}); err != nil {
		return err
	}

	for _, entry := range seedMemory {
		if _, err := tx.Exec(ctx, `insert into tm_entries (id, project_id, target_language, source, target,
		        norm_source, norm_target, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
			NewID(), project.ID, entry.language, entry.source, entry.target,
			domain.Normalise(entry.source), domain.Normalise(entry.target), now); err != nil {
			return fmt.Errorf("insert memory entry: %w", err)
		}
	}

	if err := s.seedFeatureBranch(ctx, tx, project, main, keyIDs); err != nil {
		return err
	}

	return s.AddAudit(ctx, tx, "system", "workspace.seeded", "", "", nil)
}

func (s *Store) setSeedSegment(ctx context.Context, tx pgx.Tx, branchID, keyID, lang, value, status string, score int, issues []domain.Issue) error {
	var segmentID string
	origin := "seed"
	err := tx.QueryRow(ctx, `update segments set value = $4, status = $5, score = $6, origin = $7
	        where branch_id = $1 and key_id = $2 and language = $3 returning id`,
		branchID, keyID, lang, value, status, score, origin).Scan(&segmentID)
	if err != nil {
		return fmt.Errorf("seed segment: %w", err)
	}
	for i, issue := range issues {
		if _, err := tx.Exec(ctx, `insert into segment_issues (id, segment_id, ord, category, severity, note)
		        values ($1,$2,$3,$4,$5,$6)`, NewID(), segmentID, i, issue.Category, issue.Severity, issue.Note); err != nil {
			return fmt.Errorf("seed issue: %w", err)
		}
	}
	return nil
}

// seedFeatureBranch writes the one open branch of the demo project: a copy of
// main taken before key 32's source changed, with two edits and two new keys.
func (s *Store) seedFeatureBranch(ctx context.Context, tx pgx.Tx, project *Project, main *Branch, keyIDs []string) error {
	now := Now()
	base, err := s.LoadKeySet(ctx, tx, main.ID)
	if err != nil {
		return err
	}
	base[keyIDs[31]].Source = "Order summary"

	branch := &Branch{ID: NewID(), ProjectID: project.ID, Name: "feature/checkout-redesign",
		State: domain.BranchOpen, IsMain: false, CreatedAt: now, Base: base}
	if err := s.InsertBranch(ctx, tx, branch); err != nil {
		return err
	}
	if err := s.CopyKeySet(ctx, tx, project, branch.ID, base); err != nil {
		return err
	}

	edits := []struct {
		keyID string
		from  string
		to    string
	}{
		{keyIDs[34], "Pay now", "Pay and finish"},
		{keyIDs[31], "Order summary", "Your order"},
	}
	for _, edit := range edits {
		if _, err := tx.Exec(ctx, `update keys set source = $3 where branch_id = $1 and key_id = $2`,
			branch.ID, edit.keyID, edit.to); err != nil {
			return fmt.Errorf("edit seeded branch key: %w", err)
		}
		if err := s.AddKeyRevision(ctx, tx, project.ID, edit.keyID, branch.Name, "source", &edit.from, &edit.to,
			"robin@marlowquill.example", now); err != nil {
			return err
		}
	}

	added := []seedKey{
		{"checkout.saved_card", "Pay with a saved card"},
		{"checkout.promo.label", "Promo code"},
	}
	for i := range added {
		keyID := NewID()
		if err := s.InsertKey(ctx, tx, project, branch.ID, keyID, added[i].name, added[i].source); err != nil {
			return err
		}
		if err := s.AddKeyRevision(ctx, tx, project.ID, keyID, branch.Name, "created", nil, &added[i].source,
			"robin@marlowquill.example", now); err != nil {
			return err
		}
	}
	return nil
}

// CopyKeySet writes a key set into a branch as fresh segments, keeping key ids.
func (s *Store) CopyKeySet(ctx context.Context, db DB, project *Project, branchID string, set domain.KeySet) error {
	for _, key := range set {
		if _, err := db.Exec(ctx, `insert into keys (id, project_id, branch_id, key_id, name, source)
		        values ($1,$2,$3,$4,$5,$6)`, NewID(), project.ID, branchID, key.KeyID, key.Name, key.Source); err != nil {
			return fmt.Errorf("copy key: %w", err)
		}
		for _, lang := range project.TargetLanguages {
			segment := key.Segments[lang]
			if segment == nil {
				segment = &domain.Segment{Status: domain.StatusUntranslated}
			}
			newID := NewID()
			if _, err := db.Exec(ctx, `insert into segments (id, project_id, branch_id, key_id, language, value, status, score, origin)
			        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, newID, project.ID, branchID, key.KeyID, lang,
				segment.Value, segment.Status, segment.Score, segment.Origin); err != nil {
				return fmt.Errorf("copy segment: %w", err)
			}
			for i, issue := range segment.Issues {
				if _, err := db.Exec(ctx, `insert into segment_issues (id, segment_id, ord, category, severity, note)
				        values ($1,$2,$3,$4,$5,$6)`, NewID(), newID, i, issue.Category, issue.Severity, issue.Note); err != nil {
					return fmt.Errorf("copy issue: %w", err)
				}
			}
			for _, comment := range segment.Comments {
				if _, err := db.Exec(ctx, `insert into segment_comments (id, segment_id, author, body, at)
				        values ($1,$2,$3,$4,$5)`, NewID(), newID, comment.Author, comment.Body, comment.At); err != nil {
					return fmt.Errorf("copy comment: %w", err)
				}
			}
		}
	}
	return nil
}
