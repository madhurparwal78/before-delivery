package main

import (
	"context"
	"crypto/rand"
	_ "embed"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

//go:embed schema.sql
var schemaSQL string

const schemaLockKey = 7350001

func (a *app) migrate(ctx context.Context) error {
	return a.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, schemaLockKey); err != nil {
			return fmt.Errorf("schema lock: %w", err)
		}
		if _, err := tx.Exec(ctx, schemaSQL); err != nil {
			return fmt.Errorf("apply schema: %w", err)
		}
		return nil
	})
}

const idAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"

func randomString(n int) string {
	b := make([]byte, n)
	// crypto/rand.Read never returns an error; it aborts the program instead.
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = idAlphabet[int(b[i])%len(idAlphabet)]
	}
	return string(b)
}

func newID(prefix string) string { return prefix + "_" + randomString(12) }

func newPushTopic() string { return "yardline-p-" + randomString(24) }

type seedPerson struct {
	Username, Name, Email, Role string
	Level                       float64
	CoachID                     string
	CoachMin, CoachMax          float64
	CoachLine                   string
}

const seedPassword = "Yardline-Court-7"

var seedPeople = []seedPerson{
	{Username: "ines", Name: "Inés Carvajal", Email: "ines@players.marloweyard.test", Role: "player", Level: 3.5},
	{Username: "tomas", Name: "Tomás Rial", Email: "tomas@players.marloweyard.test", Role: "player", Level: 3.5},
	{Username: "noor", Name: "Noor Haddad", Email: "noor@players.marloweyard.test", Role: "player", Level: 4.0},
	{Username: "kai", Name: "Kai Brennan", Email: "kai@players.marloweyard.test", Role: "player", Level: 3.0},
	{Username: "lucia", Name: "Lucía Ortega", Email: "lucia@players.marloweyard.test", Role: "player", Level: 5.5},
	{Username: "pablo", Name: "Pablo Ferrer", Email: "pablo@players.marloweyard.test", Role: "player", Level: 2.0},
	{Username: "rosa", Name: "Rosa Vidal", Email: "rosa@staff.marloweyard.test", Role: "desk"},
	{Username: "marta", Name: "Marta Sol", Email: "marta@staff.marloweyard.test", Role: "coach", CoachID: "coach-marta",
		CoachMin: 1.0, CoachMax: 4.0, CoachLine: "Patient drills for new and returning players."},
	{Username: "owen", Name: "Owen Pryce", Email: "owen@staff.marloweyard.test", Role: "coach", CoachID: "coach-owen",
		CoachMin: 3.5, CoachMax: 7.0, CoachLine: "Match tactics for competitive pairs."},
	{Username: "elena", Name: "Elena Brandt", Email: "elena@staff.marloweyard.test", Role: "manager"},
}

const seedRuleDescription = "Free cancellation up to 24 hours before start. Later cancellations keep half as a fee and credit the rest."

// seed writes the seed data only into an empty database.
func (a *app) seed(ctx context.Context) error {
	return a.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, schemaLockKey); err != nil {
			return fmt.Errorf("seed lock: %w", err)
		}
		var seeded bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pricing_version)`).Scan(&seeded); err != nil {
			return fmt.Errorf("check seed: %w", err)
		}
		if seeded {
			return nil
		}
		s := seeder{a: a, tx: tx}
		return s.run(ctx)
	})
}

type seeder struct {
	a  *app
	tx pgx.Tx
}

func (s seeder) run(ctx context.Context) error {
	for _, p := range seedPeople {
		var level, cmin, cmax *float64
		var coachID, line, topic *string
		if p.Role == "player" {
			level = &p.Level
			t := newPushTopic()
			topic = &t
		}
		if p.CoachID != "" {
			coachID, line, cmin, cmax = &p.CoachID, &p.CoachLine, &p.CoachMin, &p.CoachMax
		}
		if _, err := s.tx.Exec(ctx, `INSERT INTO app_user (username, name, email, roles, level, coach_id,
			coach_level_min, coach_level_max, coach_line, push_topic)
			VALUES ($1, $2, $3, ARRAY[$4], $5, $6, $7, $8, $9, $10) ON CONFLICT (username) DO NOTHING`,
			p.Username, p.Name, p.Email, p.Role, level, coachID, cmin, cmax, line, topic); err != nil {
			return fmt.Errorf("seed user %s: %w", p.Username, err)
		}
	}
	if _, err := s.tx.Exec(ctx, `INSERT INTO pricing_version (version, effective_from, offpeak_cents_per_minute,
		peak_cents_per_minute, peak_start, peak_end, peak_days) VALUES (1, '2026-01-01', 40, 60, '17:00', '22:00',
		ARRAY['mon','tue','wed','thu','fri'])`); err != nil {
		return fmt.Errorf("seed pricing: %w", err)
	}
	if _, err := s.tx.Exec(ctx, `INSERT INTO cancellation_rule (version, late_fee_percent, description)
		VALUES (1, 50, $1)`, seedRuleDescription); err != nil {
		return fmt.Errorf("seed rule: %w", err)
	}
	var now time.Time
	if err := s.tx.QueryRow(ctx, `SELECT now()`).Scan(&now); err != nil {
		return fmt.Errorf("seed clock: %w", err)
	}
	d := s.a.cfg.clubDateOf(now)
	bookings := []struct {
		court, hour, minutes int
		organiser            string
		coPlayers            []string
	}{
		{1, 8, 60, "ines", nil},
		{3, 12, 90, "tomas", []string{"noor", "kai", "lucia"}},
		{6, 21, 60, "noor", nil},
	}
	for _, b := range bookings {
		if err := s.booking(ctx, d, b.court, b.hour*60, b.minutes, b.organiser, b.coPlayers); err != nil {
			return err
		}
	}
	matches := []struct {
		court, day, minute, minutes int
		lo, hi                      float64
		players                     []string
	}{
		{2, 2, 19 * 60, 90, 3.0, 4.0, []string{"ines", "tomas", "noor"}},
		{5, 2, 10 * 60, 60, 5.0, 6.0, []string{"lucia"}},
		{7, 3, 20 * 60, 90, 1.5, 3.0, []string{"pablo", "kai"}},
		{1, 3, 9 * 60, 60, 2.5, 4.0, []string{"tomas"}},
		{4, 4, 18*60 + 30, 90, 3.5, 5.0, []string{"noor", "ines"}},
	}
	for _, m := range matches {
		if err := s.match(ctx, d.AddDays(m.day), m.court, m.minute, m.minutes, m.lo, m.hi, m.players); err != nil {
			return err
		}
	}
	return s.lesson(ctx, d.AddDays(1))
}

func (s seeder) slot(ctx context.Context, d clubDate, minute, minutes int) (time.Time, slotPrice, error) {
	start, ok := s.a.cfg.wallTime(d, minute)
	if !ok {
		return start, slotPrice{}, fmt.Errorf("seed slot %s %d does not exist", d, minute)
	}
	p, err := s.a.cfg.priceFor(ctx, s.tx, start, minutes)
	return start, p, err
}

func (s seeder) claim(ctx context.Context, owner string, court int, start time.Time, minutes int) error {
	if _, err := s.tx.Exec(ctx, `INSERT INTO court_claim (owner, court, during)
		VALUES ($1, $2, tstzrange($3::timestamptz, $3::timestamptz + make_interval(mins => $4)))`, owner, court, start, minutes); err != nil {
		return fmt.Errorf("seed claim %s: %w", owner, err)
	}
	return nil
}

func (s seeder) booking(ctx context.Context, d clubDate, court, minute, minutes int, organiser string, coPlayers []string) error {
	start, price, err := s.slot(ctx, d, minute, minutes)
	if err != nil {
		return err
	}
	id := newID("bk")
	if err := s.claim(ctx, id, court, start, minutes); err != nil {
		return err
	}
	split := len(coPlayers) > 0
	var settle *time.Time
	if split {
		t := s.a.cfg.settleAt(start)
		settle = &t
	}
	if _, err := s.tx.Exec(ctx, `INSERT INTO booking (id, kind, status, court, start_utc, minutes, total_cents,
		organiser, pricing_version, split, settle_at, paid_at) VALUES ($1, 'booking', 'paid', $2, $3, $4, $5, $6, $7, $8, $9, now())`,
		id, court, start, minutes, price.Total, organiser, price.Version, split, settle); err != nil {
		return fmt.Errorf("seed booking: %w", err)
	}
	payers := append([]string{organiser}, coPlayers...)
	for i, amount := range splitShares(price.Total, len(payers)) {
		if _, err := s.tx.Exec(ctx, `INSERT INTO share (booking_id, position, player, amount_cents, status, token)
			VALUES ($1, $2, $3, $4, 'paid', $5)`, id, i+1, payers[i], amount, randomString(32)); err != nil {
			return fmt.Errorf("seed share: %w", err)
		}
	}
	return nil
}

func (s seeder) match(ctx context.Context, d clubDate, court, minute, minutes int, lo, hi float64, players []string) error {
	start, price, err := s.slot(ctx, d, minute, minutes)
	if err != nil {
		return err
	}
	id := newID("mt")
	if err := s.claim(ctx, id, court, start, minutes); err != nil {
		return err
	}
	shares := splitShares(price.Total, 4)
	if _, err := s.tx.Exec(ctx, `INSERT INTO match (id, court, start_utc, minutes, level_min, level_max, status,
		total_cents, share_cents, creator, cutoff_at, pricing_version)
		VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11)`,
		id, court, start, minutes, lo, hi, price.Total, shares[1], players[0], s.a.cfg.cutoffAt(start), price.Version); err != nil {
		return fmt.Errorf("seed match: %w", err)
	}
	for i, p := range players {
		if _, err := s.tx.Exec(ctx, `INSERT INTO match_place (match_id, player, status, amount_cents)
			VALUES ($1, $2, 'paid', $3)`, id, p, shares[i]); err != nil {
			return fmt.Errorf("seed place: %w", err)
		}
	}
	return nil
}

func (s seeder) lesson(ctx context.Context, d clubDate) error {
	start, price, err := s.slot(ctx, d, 10*60, 60)
	if err != nil {
		return err
	}
	series, id := newID("sr"), newID("ls")
	if err := s.claim(ctx, id, 4, start, 60); err != nil {
		return err
	}
	if _, err := s.tx.Exec(ctx, `INSERT INTO lesson_series (id, coach_id) VALUES ($1, 'coach-marta')`, series); err != nil {
		return fmt.Errorf("seed series: %w", err)
	}
	if _, err := s.tx.Exec(ctx, `INSERT INTO lesson (id, series_id, coach_id, court, start_utc, minutes, total_cents, pricing_version)
		VALUES ($1, $2, 'coach-marta', 4, $3, 60, $4, $5)`, id, series, start, price.Total, price.Version); err != nil {
		return fmt.Errorf("seed lesson: %w", err)
	}
	for i, amount := range splitShares(price.Total, 2) {
		status, player := "paid", "kai"
		if i == 1 {
			status, player = "due", "pablo"
		}
		if _, err := s.tx.Exec(ctx, `INSERT INTO share (lesson_id, position, player, amount_cents, status, token)
			VALUES ($1, $2, $3, $4, $5, $6)`, id, i+1, player, amount, status, randomString(32)); err != nil {
			return fmt.Errorf("seed lesson share: %w", err)
		}
	}
	return nil
}
