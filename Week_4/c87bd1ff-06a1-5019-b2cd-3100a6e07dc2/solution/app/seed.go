package main

import (
	"context"
	"fmt"
	"time"

	"github.com/lib/pq"
)

type seedPerson struct {
	username, display, role string
	paddle, limit           int
	pending                 bool
}

var seedPeople = []seedPerson{
	{username: "mila.verhoef", display: "Mila Verhoef", role: "specialist"},
	{username: "joost.bakker", display: "Joost Bakker", role: "cashier"},
	{username: "ines.dekker", display: "Ines Dekker", role: "admin"},
	{username: "ruth.okafor", display: "Ruth Okafor", role: "bidder", limit: 3000},
	{username: "tomas.lindqvist", display: "Tomas Lindqvist", role: "bidder", limit: 10000},
	{username: "amaal.haddad", display: "Amaal Haddad", role: "bidder", limit: 25000},
	{username: "pieter.smit", display: "Pieter Smit", role: "bidder", pending: true},
	{username: "hendrik.vos", display: "Hendrik Vos", role: "consignor"},
	{username: "saskia.mol", display: "Saskia Mol", role: "consignor"},
}

type seedLot struct {
	number                 int
	title, category, shape string
	low, high, opening     int
	reserve                int
	consignor              string
}

var seedLots = []seedLot{
	{201, "Steel chronograph, black dial, c. 1965", "wristwatch", "chronograph", 2400, 3200, 1600, 2200, "hendrik.vos"},
	{202, "Pocket rangefinder, chrome body, c. 1958", "camera", "rangefinder", 300, 450, 180, 280, "saskia.mol"},
	{203, "Diver's watch, rotating bezel, c. 1972", "wristwatch", "diver", 1800, 2500, 1200, 1700, "hendrik.vos"},
	{204, "Twin-lens reflex, square format, c. 1955", "camera", "twin_lens", 400, 600, 250, 380, "saskia.mol"},
	{205, "Gold-plated dress watch, c. 1950", "wristwatch", "dress", 600, 900, 400, 550, "hendrik.vos"},
	{206, "Folding bellows camera, c. 1936", "camera", "bellows", 150, 250, 90, 140, "saskia.mol"},
	{207, "Pilot's watch, luminous numerals, c. 1968", "wristwatch", "chronograph", 900, 1300, 600, 850, "hendrik.vos"},
	{208, "Half-frame camera, c. 1963", "camera", "rangefinder", 120, 180, 60, 100, "saskia.mol"},
	{209, "Triple-calendar watch, c. 1948", "wristwatch", "dress", 3500, 5000, 2500, 3400, "hendrik.vos"},
	{210, "Box camera, c. 1932", "camera", "bellows", 40, 80, 20, 35, "saskia.mol"},
	{211, "Ultra-thin manual-wind watch, c. 1975", "wristwatch", "diver", 1100, 1600, 750, 1000, "hendrik.vos"},
	{212, "Medium-format reflex, waist-level finder, c. 1979", "camera", "twin_lens", 1400, 2000, 900, 1300, "saskia.mol"},
}

const seedCondition = "Running at time of cataloguing; light wear consistent with age."

// seed applies the seed people, the open sale and the intake lot once per database.
func (a *App) seed(ctx context.Context) error {
	return a.tx(ctx, func(t *Tx) error {
		if _, err := t.ExecContext(ctx, `SELECT pg_advisory_xact_lock(7302)`); err != nil {
			return fmt.Errorf("lock seed: %w", err)
		}
		var done bool
		if err := t.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM meta WHERE key = 'seed')`).Scan(&done); err != nil {
			return fmt.Errorf("check seed: %w", err)
		}
		if done {
			return nil
		}
		ids := map[string]string{}
		for _, p := range seedPeople {
			id := newID("per_")
			ids[p.username] = id
			roles := []string{p.role}
			if _, err := t.ExecContext(ctx, `INSERT INTO people (id, username, display_name, roles) VALUES ($1, $2, $3, $4)`, id, p.username, p.display, pq.Array(roles)); err != nil {
				return fmt.Errorf("seed person %s: %w", p.username, err)
			}
			if p.role != "bidder" && p.role != "consignor" {
				continue
			}
			status, phone := registrationStart(p.role), "+31 10 555 0100"
			var paddle, limit any
			if p.role == "bidder" && !p.pending {
				n, err := nextCounter(ctx, t, "paddle")
				if err != nil {
					return err
				}
				status, paddle, limit = registrationFlow.walk("approve"), n, p.limit
			}
			if _, err := t.ExecContext(ctx, `INSERT INTO registrations (id, person_id, role, full_name, phone, address, status, paddle, spending_limit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				newID("reg_"), id, p.role, p.display, phone, "Witte de Withstraat 20, Rotterdam", status, paddle, limit); err != nil {
				return fmt.Errorf("seed registration %s: %w", p.username, err)
			}
		}
		now, err := dbNow(ctx, t)
		if err != nil {
			return err
		}
		first := now.Add(7 * 24 * time.Hour).Truncate(time.Minute)
		if first.Before(now.Add(7 * 24 * time.Hour)) {
			first = first.Add(time.Minute)
		}
		saleID := newID("sal_")
		if _, err := t.ExecContext(ctx, `INSERT INTO sales (id, title, ends_at, first_lot_number, state) VALUES ($1, 'WEEK 45 · TIMEPIECES & CAMERAS', $2, 201, $3)`, saleID, first, saleFlow.walk("publish")); err != nil {
			return fmt.Errorf("seed sale: %w", err)
		}
		for i, l := range seedLots {
			_, err := t.ExecContext(ctx, `
				INSERT INTO lots (id, consignor_id, category, title, description, state, estimate_low, estimate_high, opening_bid, reserve, condition,
				                  portrait, sale_id, position, lot_number, closes_at)
				VALUES ($1, $2, $3, $4, $5, $16, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
				newID("lot_"), ids[l.consignor], l.category, l.title, l.title+".", l.low, l.high, l.opening, l.reserve, seedCondition,
				l.shape, saleID, i, l.number, first.Add(time.Duration(i)*a.cfg.lotGap), lotFlow.walk("estimate", "place", "publish"))
			if err != nil {
				return fmt.Errorf("seed lot %d: %w", l.number, err)
			}
		}
		_, err = t.ExecContext(ctx, `INSERT INTO lots (id, consignor_id, category, title, description, state) VALUES ($1, $2, 'wristwatch', 'Moonphase wristwatch, c. 1955', 'Moonphase wristwatch, c. 1955.', $3)`,
			newID("lot_"), ids["saskia.mol"], lotFlow.start)
		if err != nil {
			return fmt.Errorf("seed intake lot: %w", err)
		}
		if _, err := t.ExecContext(ctx, `INSERT INTO meta (key, value) VALUES ('seed', 'applied')`); err != nil {
			return fmt.Errorf("record seed: %w", err)
		}
		return nil
	})
}
