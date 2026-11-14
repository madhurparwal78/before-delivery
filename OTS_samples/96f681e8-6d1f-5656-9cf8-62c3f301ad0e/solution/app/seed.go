package main

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// seedPassword is the seeded users' shared password, as printed in the brief.
const seedPassword = "Yardline-Court-7"

const defaultRuleDescription = "Free cancellation up to 24 hours before start. Later cancellations keep half as a fee and credit the rest."

type seedPerson struct {
	Username, Name, Email, Role string
	Level                       *float64
	CoachID                     string
}

func level(value float64) *float64 { return &value }

var seedPeople = []seedPerson{
	{"ines", "Inés Carvajal", "ines@players.marloweyard.test", rolePlayer, level(3.5), ""},
	{"tomas", "Tomás Rial", "tomas@players.marloweyard.test", rolePlayer, level(3.5), ""},
	{"noor", "Noor Haddad", "noor@players.marloweyard.test", rolePlayer, level(4.0), ""},
	{"kai", "Kai Brennan", "kai@players.marloweyard.test", rolePlayer, level(3.0), ""},
	{"lucia", "Lucía Ortega", "lucia@players.marloweyard.test", rolePlayer, level(5.5), ""},
	{"pablo", "Pablo Ferrer", "pablo@players.marloweyard.test", rolePlayer, level(2.0), ""},
	{"rosa", "Rosa Vidal", "rosa@staff.marloweyard.test", roleDesk, nil, ""},
	{"marta", "Marta Sol", "marta@staff.marloweyard.test", roleCoach, nil, "coach-marta"},
	{"owen", "Owen Pryce", "owen@staff.marloweyard.test", roleCoach, nil, "coach-owen"},
	{"elena", "Elena Brandt", "elena@staff.marloweyard.test", roleManager, nil, ""},
}

type seedMatch struct {
	court, dayOffset, minutes int
	hm                        string
	levelMin, levelMax        float64
	players                   []string
}

var seedMatches = []seedMatch{
	{2, 2, 90, "19:00", 3.0, 4.0, []string{"ines", "tomas", "noor"}},
	{5, 2, 60, "10:00", 5.0, 6.0, []string{"lucia"}},
	{7, 3, 90, "20:00", 1.5, 3.0, []string{"pablo", "kai"}},
	{1, 3, 60, "09:00", 2.5, 4.0, []string{"tomas"}},
	{4, 4, 90, "18:30", 3.5, 5.0, []string{"noor", "ines"}},
}

// seedIfEmpty writes the club's starting data into an empty database, once.
func (a *App) seedIfEmpty(ctx context.Context) error {
	return withTx(ctx, a.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", schemaLockKey+1); err != nil {
			return fmt.Errorf("lock seed: %w", err)
		}
		var seeded bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM meta WHERE key = 'seeded_on')").Scan(&seeded); err != nil {
			return fmt.Errorf("check seed: %w", err)
		}
		if seeded {
			return nil
		}
		now, err := dbNow(ctx, tx)
		if err != nil {
			return err
		}
		today := a.clock.clubDate(now)
		for _, p := range seedPeople {
			if _, err := tx.Exec(ctx, `INSERT INTO people (username, name, email, level, coach_id, is_player, push_topic)
				VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7) ON CONFLICT (username) DO NOTHING`,
				p.Username, p.Name, p.Email, p.Level, p.CoachID, p.Role == rolePlayer, newPushTopic()); err != nil {
				return fmt.Errorf("seed person %s: %w", p.Username, err)
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO pricing_versions (version, effective_from, offpeak_cents, peak_cents, peak_start, peak_end, peak_days, saved_at)
			VALUES (1, '2026-01-01', 40, 60, '17:00', '22:00', '{mon,tue,wed,thu,fri}', $1)`, now); err != nil {
			return fmt.Errorf("seed pricing: %w", err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO cancellation_rules (version, late_fee_percent, description, saved_at) VALUES (1, 50, $1, $2)",
			defaultRuleDescription, now); err != nil {
			return fmt.Errorf("seed cancellation rule: %w", err)
		}
		if err := a.seedBookings(ctx, tx, today, now); err != nil {
			return err
		}
		if err := a.seedMatchRows(ctx, tx, today, now); err != nil {
			return err
		}
		if err := a.seedLesson(ctx, tx, today); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "INSERT INTO meta (key, value) VALUES ('seeded_on', $1)", today.Format(dateLayout)); err != nil {
			return fmt.Errorf("record seed: %w", err)
		}
		return nil
	})
}

func (a *App) seedStart(day time.Time, hm string) (time.Time, error) {
	minutes, err := parseClockMinutes(hm, false)
	if err != nil {
		return time.Time{}, err
	}
	start, ok := a.clock.wallInstant(day, minutes)
	if !ok {
		return time.Time{}, fmt.Errorf("seed time %s does not exist on %s", hm, day.Format(dateLayout))
	}
	return start, nil
}

func (a *App) seedBookings(ctx context.Context, tx pgx.Tx, today, now time.Time) error {
	rows := []struct {
		court, minutes int
		hm, organiser  string
		others         []string
	}{
		{1, 60, "08:00", "ines", nil},
		{3, 90, "12:00", "tomas", []string{"noor", "kai", "lucia"}},
		{6, 60, "21:00", "noor", nil},
	}
	for _, row := range rows {
		start, err := a.seedStart(today, row.hm)
		if err != nil {
			return err
		}
		quote, err := a.quoteSlot(ctx, tx, row.court, start, row.minutes)
		if err != nil {
			return err
		}
		id := newID("bk_")
		if _, err := tx.Exec(ctx, `INSERT INTO bookings (id, kind, court, start_utc, minutes, total_cents, organiser, status, created_at, pricing_version, split)
			VALUES ($1, $11, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			id, row.court, start, row.minutes, quote.TotalCents, row.organiser, bookingPaid, now, quote.PricingVersion, len(row.others) > 0, kindBooking); err != nil {
			return fmt.Errorf("seed booking: %w", err)
		}
		payers := append([]string{row.organiser}, row.others...)
		amounts := []int{quote.TotalCents}
		if len(payers) > 1 {
			amounts = quote.SplitCents
		}
		for i, payer := range payers {
			if _, err := insertShare(ctx, tx, shareBooking, id, i+1, payer, amounts[i], sharePaid); err != nil {
				return err
			}
		}
	}
	return nil
}

func (a *App) seedMatchRows(ctx context.Context, tx pgx.Tx, today, now time.Time) error {
	for _, m := range seedMatches {
		day := today.AddDate(0, 0, m.dayOffset)
		start, err := a.seedStart(day, m.hm)
		if err != nil {
			return err
		}
		quote, err := a.quoteSlot(ctx, tx, m.court, start, m.minutes)
		if err != nil {
			return err
		}
		id := newID("mt_")
		if _, err := tx.Exec(ctx, `INSERT INTO matches (id, court, start_utc, minutes, level_min, level_max, total_cents, creator, status, created_at, cutoff_at, pricing_version)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			id, m.court, start, m.minutes, m.levelMin, m.levelMax, quote.TotalCents, m.players[0], matchOpen, now,
			a.matchCutoff(start), quote.PricingVersion); err != nil {
			return fmt.Errorf("seed match: %w", err)
		}
		for i, player := range m.players {
			amount := joinerShare(quote.TotalCents)
			if i == 0 {
				amount = creatorShare(quote.TotalCents)
			}
			if _, err := tx.Exec(ctx, "INSERT INTO place_reservations (match_id, username, amount_cents, status) VALUES ($1, $2, $3, $4)",
				id, player, amount, placePaid); err != nil {
				return fmt.Errorf("seed match place: %w", err)
			}
		}
	}
	return nil
}

func (a *App) seedLesson(ctx context.Context, tx pgx.Tx, today time.Time) error {
	day := today.AddDate(0, 0, 1)
	start, err := a.seedStart(day, "10:00")
	if err != nil {
		return err
	}
	quote, err := a.quoteSlot(ctx, tx, 4, start, 60)
	if err != nil {
		return err
	}
	id := newID("ls_")
	if _, err := tx.Exec(ctx, `INSERT INTO lessons (id, series_id, coach_id, court, start_utc, minutes, total_cents, pricing_version)
		VALUES ($1, $2, 'coach-marta', 4, $3, 60, $4, $5)`, id, newID("sr_"), start, quote.TotalCents, quote.PricingVersion); err != nil {
		return fmt.Errorf("seed lesson: %w", err)
	}
	amounts := splitEvenly(quote.TotalCents, 2)
	if _, err := insertShare(ctx, tx, shareLesson, id, 1, "kai", amounts[0], sharePaid); err != nil {
		return err
	}
	_, err = insertShare(ctx, tx, shareLesson, id, 2, "pablo", amounts[1], shareDue)
	return err
}
