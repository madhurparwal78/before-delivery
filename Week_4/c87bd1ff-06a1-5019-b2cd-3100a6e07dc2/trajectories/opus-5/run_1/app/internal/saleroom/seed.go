package saleroom

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"gavelhouse/internal/domain"
)

// SeedUser is one invented person the saleroom comes up with.
type SeedUser struct {
	Username string
	Password string
	Role     string
	FullName string
	Paddle   int
	Status   string
	Limit    int
}

// SeedUsers are the saleroom's staff, bidders and consignors at start.
var SeedUsers = []SeedUser{
	{"mila.verhoef", "Harrow-specialist-2026", "specialist", "Mila Verhoef", 0, "", 0},
	{"joost.bakker", "Harrow-cashier-2026", "cashier", "Joost Bakker", 0, "", 0},
	{"ines.dekker", "Harrow-admin-2026", "admin", "Ines Dekker", 0, "", 0},
	{"ruth.okafor", "Harrow-bidder-2026", "bidder", "Ruth Okafor", 101, "active", 3000},
	{"tomas.lindqvist", "Harrow-bidder-2026", "bidder", "Tomas Lindqvist", 102, "active", 10000},
	{"amaal.haddad", "Harrow-bidder-2026", "bidder", "Amaal Haddad", 103, "active", 25000},
	{"pieter.smit", "Harrow-bidder-2026", "bidder", "Pieter Smit", 0, "pending", 0},
	{"hendrik.vos", "Harrow-consignor-2026", "consignor", "Hendrik Vos", 0, "active", 0},
	{"saskia.mol", "Harrow-consignor-2026", "consignor", "Saskia Mol", 0, "active", 0},
}

// Email is the seed user's invented address.
func (u SeedUser) Email() string { return u.Username + "@example.test" }

// IsStaff reports whether the seed user runs a desk rather than registering.
func (u SeedUser) IsStaff() bool {
	switch u.Role {
	case "specialist", "cashier", "admin":
		return true
	}
	return false
}

const seedSaleTitle = "WEEK 45 · TIMEPIECES & CAMERAS"

const seedCondition = "Running at time of cataloguing; light wear consistent with age."

type seedLot struct {
	title        string
	category     string
	portrait     string
	estimateLow  int
	estimateHigh int
	openingBid   int
	reserve      int
	consignor    string
}

var seedLots = []seedLot{
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

// applySeed brings an empty database up with the invented saleroom. It is
// applied at start whenever it is missing.
func (s *Saleroom) applySeed(ctx context.Context) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		for _, u := range SeedUsers {
			if err := seedPerson(ctx, tx, u); err != nil {
				return err
			}
		}
		var sales int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM sales`).Scan(&sales); err != nil {
			return fmt.Errorf("count sales: %w", err)
		}
		if sales > 0 {
			return nil
		}
		return s.seedSale(ctx, tx)
	})
}

func seedPerson(ctx context.Context, tx pgx.Tx, u SeedUser) error {
	personID := newID()
	err := tx.QueryRow(ctx,
		`INSERT INTO people (id, sub, username, full_name, email, staff_roles)
		 VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (username) DO UPDATE SET username = people.username
		 RETURNING id`,
		personID, "seed:"+u.Username, u.Username, u.FullName, u.Email(), staffRolesOf(u)).Scan(&personID)
	if err != nil {
		return fmt.Errorf("seed person %s: %w", u.Username, err)
	}
	if u.IsStaff() {
		return nil
	}
	var paddle, limit any
	if u.Paddle > 0 {
		paddle = u.Paddle
	}
	if u.Limit > 0 {
		limit = u.Limit
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO registrations (id, person_id, role, status, paddle, spending_limit,
		     full_name, phone, address)
		 SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9
		  WHERE NOT EXISTS (SELECT 1 FROM registrations WHERE person_id = $2)`,
		newID(), personID, u.Role, u.Status, paddle, limit, u.FullName,
		"+31 10 555 0100", "Rotterdam")
	if err != nil {
		return fmt.Errorf("seed registration for %s: %w", u.Username, err)
	}
	if u.Paddle > 0 {
		_, err = tx.Exec(ctx,
			`UPDATE counters SET value = GREATEST(value, $1) WHERE name = 'paddle'`, u.Paddle)
		if err != nil {
			return fmt.Errorf("advance the paddle counter: %w", err)
		}
	}
	return nil
}

func staffRolesOf(u SeedUser) []string {
	if u.IsStaff() {
		return []string{u.Role}
	}
	return []string{}
}

// seedSale opens the week's sale. Lot 201 closes at the first whole minute at
// least seven days after the seed is applied, and each following lot one lot
// gap later.
func (s *Saleroom) seedSale(ctx context.Context, tx pgx.Tx) error {
	serverNow, err := now(ctx, tx)
	if err != nil {
		return err
	}
	firstClose := serverNow.Add(7 * 24 * time.Hour).Truncate(time.Minute)
	if firstClose.Before(serverNow.Add(7 * 24 * time.Hour)) {
		firstClose = firstClose.Add(time.Minute)
	}
	saleID := newID()
	_, err = tx.Exec(ctx,
		`INSERT INTO sales (id, title, ends_at, state, first_lot_number, published_at)
		 VALUES ($1,$2,$3,$4,$5,$6)`,
		saleID, seedSaleTitle, firstClose, domain.SaleOpen, 201, serverNow)
	if err != nil {
		return fmt.Errorf("seed sale: %w", err)
	}
	for k, sl := range seedLots {
		consignorID, err := personIDByUsername(ctx, tx, sl.consignor)
		if err != nil {
			return err
		}
		closesAt := firstClose.Add(time.Duration(k) * s.cfg.LotGap)
		_, err = tx.Exec(ctx,
			`INSERT INTO lots (id, consignor_id, sale_id, lot_number, catalogue_position, title,
			     category, description, condition, portrait, estimate_low, estimate_high,
			     opening_bid, reserve, state, closes_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
			newID(), consignorID, saleID, 201+k, k, sl.title, sl.category,
			seedDescription(sl), seedCondition, sl.portrait, sl.estimateLow, sl.estimateHigh,
			sl.openingBid, sl.reserve, domain.LotOpen, closesAt)
		if err != nil {
			return fmt.Errorf("seed lot %d: %w", 201+k, err)
		}
	}
	saskia, err := personIDByUsername(ctx, tx, "saskia.mol")
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO lots (id, consignor_id, title, category, description, state)
		 VALUES ($1,$2,$3,$4,$5,$6)`,
		newID(), saskia, "Moonphase wristwatch, c. 1955", "wristwatch",
		"A moonphase wristwatch awaiting the specialist's estimate.", domain.LotIntake)
	if err != nil {
		return fmt.Errorf("seed intake lot: %w", err)
	}
	return nil
}

func seedDescription(sl seedLot) string {
	if sl.category == "wristwatch" {
		return "A collector's wristwatch offered from a private Rotterdam collection. " +
			"Manual movement, original dial, presented as found."
	}
	return "A film camera offered from a private Rotterdam collection. " +
		"Shutter and film transport working, presented as found."
}

func personIDByUsername(ctx context.Context, tx pgx.Tx, username string) (string, error) {
	var id string
	if err := tx.QueryRow(ctx, `SELECT id FROM people WHERE username = $1`, username).Scan(&id); err != nil {
		return "", fmt.Errorf("read seed person %s: %w", username, err)
	}
	return id, nil
}
