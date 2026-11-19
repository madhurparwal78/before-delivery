// Package seed applies the schema and the seed data, idempotently, at start.
package seed

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"gavelhouse/internal/keycloak"
	"gavelhouse/internal/store"
)

// Apply runs the schema and, when the database is empty, the seed data.
func Apply(ctx context.Context, pool *sql.DB, kc *keycloak.Client, lotGap time.Duration) error {
	if _, err := pool.ExecContext(ctx, schemaSQL); err != nil {
		return fmt.Errorf("applying the schema: %w", err)
	}
	var people int
	if err := pool.QueryRowContext(ctx, `SELECT count(*) FROM people`).Scan(&people); err != nil {
		return fmt.Errorf("reading the people: %w", err)
	}
	if people > 0 {
		return nil
	}
	// The seed is one transaction: it either applies whole or not at all.
	tx, err := pool.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("seeding: %w", err)
	}
	if err := seedData(ctx, tx, kc, lotGap); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

type seedUser struct {
	username string
	password string
	role     string
	name     string
	paddle   *int
	limit    *int
	status   string
}

func seedData(ctx context.Context, tx *sql.Tx, kc *keycloak.Client, lotGap time.Duration) error {
	users := []seedUser{
		{"mila.verhoef", "Harrow-specialist-2026", "specialist", "Mila Verhoef", nil, nil, "active"},
		{"joost.bakker", "Harrow-cashier-2026", "cashier", "Joost Bakker", nil, nil, "active"},
		{"ines.dekker", "Harrow-admin-2026", "admin", "Ines Dekker", nil, nil, "active"},
		{"ruth.okafor", "Harrow-bidder-2026", "bidder", "Ruth Okafor", intPtr(101), intPtr(3000), "active"},
		{"tomas.lindqvist", "Harrow-bidder-2026", "bidder", "Tomas Lindqvist", intPtr(102), intPtr(10000), "active"},
		{"amaal.haddad", "Harrow-bidder-2026", "bidder", "Amaal Haddad", intPtr(103), intPtr(25000), "active"},
		{"pieter.smit", "Harrow-bidder-2026", "bidder", "Pieter Smit", nil, nil, "pending"},
		{"hendrik.vos", "Harrow-consignor-2026", "consignor", "Hendrik Vos", nil, nil, "active"},
		{"saskia.mol", "Harrow-consignor-2026", "consignor", "Saskia Mol", nil, nil, "active"},
	}
	ids := map[string]string{}
	for _, u := range users {
		id := store.ID()
		ids[u.username] = id
		if _, err := tx.ExecContext(ctx, `INSERT INTO people (id, keycloak_sub, name) VALUES ($1,$2,$3)`,
			id, u.username, u.name); err != nil {
			return fmt.Errorf("seeding the person: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO registrations (id, person_id, role, status, full_name, phone, address, paddle, spending_limit)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			store.ID(), id, u.role, u.status, u.name, "+31 6 1000 0000", "Wijnhaven 107, Rotterdam", nullInt(u.paddle), nullInt(u.limit)); err != nil {
			return fmt.Errorf("seeding the registration: %w", err)
		}
	}
	// The seed sale: lot 201 closes at the first whole minute at least seven
	// days from now.
	var now time.Time
	if err := tx.QueryRowContext(ctx, `SELECT now() AT TIME ZONE 'UTC'`).Scan(&now); err != nil {
		return fmt.Errorf("reading the clock: %w", err)
	}
	firstClose := now.Add(7 * 24 * time.Hour).Truncate(time.Minute).Add(time.Minute)
	saleID := store.ID()
	if _, err := tx.ExecContext(ctx, `INSERT INTO sales (id, title, ends_at, first_lot_number, state)
		VALUES ($1,$2,$3,$4,'open')`,
		saleID, "WEEK 45 · TIMEPIECES & CAMERAS", firstClose, 201); err != nil {
		return fmt.Errorf("seeding the sale: %w", err)
	}
	lots := []struct {
		title    string
		category string
		portrait string
		low      int
		high     int
		opening  int
		reserve  int
		who      string
	}{
		{"Steel chronograph, black dial, c. 1965", "wristwatch", "chronograph", 2400, 3200, 1600, 2200, "hendrik.vos"},
		{"Pocket rangefinder, chrome body, c. 1958", "camera", "rangefinder", 300, 450, 180, 280, "saskia.mol"},
		{"Diver's watch, rotating bezel, c. 1972", "wristwatch", "diver", 1800, 2500, 1200, 1700, "hendrik.vos"},
		{"Twin-lens reflex, square format, c. 1955", "camera", "twin_lens", 400, 600, 250, 380, "saskia.mol"},
		{"Gold-plated dress watch, c. 1950", "wristwatch", "dress", 600, 900, 400, 550, "hendrik.vos"},
		{"Folding bellows camera, c. 1936", "camera", "bellows", 150, 250, 90, 140, "saskia.mol"},
		{"Pilot's watch, luminous numerals, c. 1968", "wristwatch", "chronograph", 900, 1300, 600, 850, "hendrik.vos"},
		{"Half-frame camera, c. 1963", "camera", "rangefinder", 120, 180, 60, 100, "saskia.mol"},
		{"Triple-calendar watch, c. 1948", "wristwatch", "dress", 3500, 5000, 2500, 3400, "hendrik.vos"},
		{"Box camera, c. 1932", "camera", "bellows", 40, 80, 20, 35, "saskia.mol"},
		{"Ultra-thin manual-wind watch, c. 1975", "wristwatch", "diver", 1100, 1600, 750, 1000, "hendrik.vos"},
		{"Medium-format reflex, waist-level finder, c. 1979", "camera", "twin_lens", 1400, 2000, 900, 1300, "saskia.mol"},
	}
	for i, l := range lots {
		number := 201 + i
		if _, err := tx.ExecContext(ctx, `INSERT INTO lots (id, sale_id, consignor_id, position, lot_number, title, category,
			description, condition, portrait, estimate_low, estimate_high, opening_bid, reserve, state, closes_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'open',$15)`,
			store.ID(), saleID, ids[l.who], i, number, l.title, l.category,
			"Consigned for the weekly sale.", "Running at time of cataloguing; light wear consistent with age.",
			l.portrait, l.low, l.high, l.opening, l.reserve, firstClose.Add(time.Duration(i)*lotGap)); err != nil {
			return fmt.Errorf("seeding the lot: %w", err)
		}
	}
	// One intake lot with no estimate.
	if _, err := tx.ExecContext(ctx, `INSERT INTO lots (id, consignor_id, title, category, description, state)
		VALUES ($1,$2,$3,$4,$5,'intake')`,
		store.ID(), ids["saskia.mol"], "Moonphase wristwatch, c. 1955", "wristwatch",
		"Consigned for the weekly sale."); err != nil {
		return fmt.Errorf("seeding the intake lot: %w", err)
	}
	return nil
}

// EnsureKeycloak makes the roles and users exist, retried every ten seconds
// while Keycloak is unreachable.
func EnsureKeycloak(ctx context.Context, kc *keycloak.Client) {
	go func() {
		roles := []string{"bidder", "consignor", "specialist", "cashier", "admin"}
		users := []struct{ username, password, firstName, lastName, role string }{
			{"mila.verhoef", "Harrow-specialist-2026", "Mila", "Verhoef", "specialist"},
			{"joost.bakker", "Harrow-cashier-2026", "Joost", "Bakker", "cashier"},
			{"ines.dekker", "Harrow-admin-2026", "Ines", "Dekker", "admin"},
			{"ruth.okafor", "Harrow-bidder-2026", "Ruth", "Okafor", "bidder"},
			{"tomas.lindqvist", "Harrow-bidder-2026", "Tomas", "Lindqvist", "bidder"},
			{"amaal.haddad", "Harrow-bidder-2026", "Amaal", "Haddad", "bidder"},
			{"pieter.smit", "Harrow-bidder-2026", "Pieter", "Smit", "bidder"},
			{"hendrik.vos", "Harrow-consignor-2026", "Hendrik", "Vos", "consignor"},
			{"saskia.mol", "Harrow-consignor-2026", "Saskia", "Mol", "consignor"},
		}
		for {
			ok := true
			for _, role := range roles {
				if err := kc.EnsureRole(role); err != nil {
					ok = false
					break
				}
			}
			if ok {
				for _, u := range users {
					if err := kc.EnsureUser(u.username, u.password, u.firstName, u.lastName, u.role); err != nil {
						ok = false
						break
					}
				}
			}
			if ok {
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(10 * time.Second):
			}
		}
	}()
}

func intPtr(n int) *int { return &n }

func nullInt(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}
