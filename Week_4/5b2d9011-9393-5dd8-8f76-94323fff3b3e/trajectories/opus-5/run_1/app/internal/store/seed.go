package store

import (
	"context"
	"time"

	"github.com/cinderlatch/holdfast/internal/clockx"
)

// StudioName, StudioZone and studioKey are the seeded studio records.
const (
	StudioName = "Cinderlatch Games"
	StudioZone = "America/Chicago"
	studioKey  = "latch-founder-2026"
)

// SeedItem is a seeded ammo-station item.
type SeedItem struct {
	Item  string
	Name  string
	Price int
}

// SeedItems are the ammo-station items and their first prices.
var SeedItems = []SeedItem{
	{Item: "ammo_pack", Name: "Ammo pack", Price: 120},
	{Item: "grenade", Name: "Grenade", Price: 200},
	{Item: "med_kit", Name: "Med kit", Price: 150},
}

// ItemName resolves an item's display name.
func ItemName(item string) string {
	for _, it := range SeedItems {
		if it.Item == item {
			return it.Name
		}
	}
	return ""
}

// KnownItem reports whether an item is an ammo-station item.
func KnownItem(item string) bool { return ItemName(item) != "" }

const seedPriceLocal = "2026-01-01T00:00"

type seedSeries struct {
	key       string
	title     string
	mode      string
	weekday   string
	localTime string
	firstDate string
	weeks     int
	capacity  int
}

var seedSeriesList = []seedSeries{
	{key: "friday-siege", title: "Friday Siege", mode: "siege", weekday: "friday", localTime: "20:00", firstDate: "2026-11-13", weeks: 8, capacity: 24},
	{key: "sunday-convoy", title: "Sunday Convoy", mode: "convoy", weekday: "sunday", localTime: "19:00", firstDate: "2026-11-15", weeks: 4, capacity: 12},
}

// seed writes the seeded records only when they are absent.
func (s *Store) seed(ctx context.Context) error {
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO studio (id, name, zone, key_hash) VALUES ('cinderlatch', $1, $2, $3)
		 ON CONFLICT (id) DO NOTHING`,
		StudioName, StudioZone, HashKey(studioKey)); err != nil {
		return err
	}

	effectiveAt, _, _ := clockx.ResolveLocal(s.zone, 2026, time.January, 1, 0, 0, 0)
	now := time.Now().UTC()
	for _, item := range SeedItems {
		if _, err := s.pool.Exec(ctx,
			`INSERT INTO price_changes (id, item, price, effective_local, effective_at, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (item, effective_at) DO NOTHING`,
			NewID(), item.Item, item.Price, seedPriceLocal, effectiveAt, now); err != nil {
			return err
		}
	}

	for _, sr := range seedSeriesList {
		if err := s.seedOneSeries(ctx, sr, now); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) seedOneSeries(ctx context.Context, sr seedSeries, now time.Time) error {
	var existing string
	err := s.pool.QueryRow(ctx, `SELECT id FROM series WHERE seed_key = $1`, sr.key).Scan(&existing)
	if err == nil {
		return nil
	}
	if !isNoRows(err) {
		return err
	}

	first, err := time.ParseInLocation("2006-01-02", sr.firstDate, time.UTC)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	seriesID := NewID()
	if _, err := tx.Exec(ctx,
		`INSERT INTO series (id, title, mode, weekday, local_time, first_date, weeks, capacity, seed_key, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (seed_key) DO NOTHING`,
		seriesID, sr.title, sr.mode, sr.weekday, sr.localTime, first, sr.weeks, sr.capacity, sr.key, now); err != nil {
		return err
	}
	for week := 0; week < sr.weeks; week++ {
		date := first.AddDate(0, 0, 7*week)
		if _, err := tx.Exec(ctx,
			`INSERT INTO nights (id, series_id, title, mode, night_date, scheduled_local_time, capacity, created_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			NewID(), seriesID, sr.title, sr.mode, date, sr.localTime, sr.capacity, now); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// StudioKeyMatches reports whether a key is the seeded studio key.
func (s *Store) StudioKeyMatches(ctx context.Context, key string) (bool, error) {
	c, cancel, err := s.call(ctx)
	if err != nil {
		return false, err
	}
	defer cancel()
	var hash string
	if err := s.pool.QueryRow(c, `SELECT key_hash FROM studio WHERE id = 'cinderlatch'`).Scan(&hash); err != nil {
		return false, s.down(c, err)
	}
	return hash == HashKey(key), nil
}
