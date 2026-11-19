package saleroom

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"gavelhouse/internal/domain"
)

// lotRow is a lot as the database holds it, before any projection.
type lotRow struct {
	ID                  string
	ConsignorID         string
	ConsignorName       string
	SaleID              *string
	LotNumber           *int
	CataloguePosition   *int
	Title               string
	Category            string
	Description         string
	Condition           string
	Portrait            *string
	EstimateLow         *int
	EstimateHigh        *int
	OpeningBid          *int
	Reserve             *int
	State               string
	ClosesAt            *time.Time
	SoldAtHammer        bool
	Hammer              *int
	SecondChanceDecided bool
}

const lotColumns = `l.id, l.consignor_id, p.full_name, l.sale_id, l.lot_number,
	l.catalogue_position, l.title, l.category, l.description, l.condition, l.portrait,
	l.estimate_low, l.estimate_high, l.opening_bid, l.reserve, l.state, l.closes_at,
	l.sold_at_hammer, l.hammer, l.second_chance_decided`

const lotFrom = ` FROM lots l JOIN people p ON p.id = l.consignor_id`

func scanLot(rows pgx.Rows) (lotRow, error) {
	var l lotRow
	err := rows.Scan(&l.ID, &l.ConsignorID, &l.ConsignorName, &l.SaleID, &l.LotNumber,
		&l.CataloguePosition, &l.Title, &l.Category, &l.Description, &l.Condition, &l.Portrait,
		&l.EstimateLow, &l.EstimateHigh, &l.OpeningBid, &l.Reserve, &l.State, &l.ClosesAt,
		&l.SoldAtHammer, &l.Hammer, &l.SecondChanceDecided)
	if err != nil {
		return l, fmt.Errorf("scan lot: %w", err)
	}
	return l, nil
}

func loadLot(ctx context.Context, tx pgx.Tx, id string) (lotRow, error) {
	rows, err := tx.Query(ctx, `SELECT `+lotColumns+lotFrom+` WHERE l.id = $1`, id)
	if err != nil {
		return lotRow{}, fmt.Errorf("query lot %s: %w", id, err)
	}
	defer rows.Close()
	if !rows.Next() {
		return lotRow{}, ErrNotFound
	}
	return scanLot(rows)
}

func loadLots(ctx context.Context, tx pgx.Tx, where string, args ...any) ([]lotRow, error) {
	rows, err := tx.Query(ctx, `SELECT `+lotColumns+lotFrom+` `+where, args...)
	if err != nil {
		return nil, fmt.Errorf("query lots: %w", err)
	}
	defer rows.Close()
	var out []lotRow
	for rows.Next() {
		l, err := scanLot(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// bidRow is one accepted bid with the detail the admin's history needs.
type bidRow struct {
	domain.Bid
	BidderName string
	AcceptedAt time.Time
}

func loadBids(ctx context.Context, tx pgx.Tx, lotID string) ([]bidRow, error) {
	rows, err := tx.Query(ctx,
		`SELECT b.id, b.bidder_id, coalesce(r.paddle, 0), p.full_name, b.max_amount, b.accepted_at
		   FROM bids b
		   JOIN people p ON p.id = b.bidder_id
		   LEFT JOIN registrations r ON r.person_id = b.bidder_id
		  WHERE b.lot_id = $1 AND b.removed_at IS NULL
		  ORDER BY b.ordinal`, lotID)
	if err != nil {
		return nil, fmt.Errorf("query bids on lot %s: %w", lotID, err)
	}
	defer rows.Close()
	var out []bidRow
	for rows.Next() {
		var b bidRow
		if err := rows.Scan(&b.ID, &b.BidderID, &b.Paddle, &b.BidderName, &b.MaxEuros, &b.AcceptedAt); err != nil {
			return nil, fmt.Errorf("scan bid: %w", err)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func bidsOf(rows []bidRow) []domain.Bid {
	out := make([]domain.Bid, len(rows))
	for i, r := range rows {
		out[i] = r.Bid
	}
	return out
}

// standing works out the lot's price and leader from its remaining bids and
// copies each bid's resulting price back onto the rows.
func standing(l lotRow, bids []bidRow) domain.Standing {
	plain := bidsOf(bids)
	s := domain.Replay(intOr(l.OpeningBid, 0), intOr(l.Reserve, math.MaxInt32), plain)
	for i := range bids {
		bids[i].PriceAfter = plain[i].PriceAfter
	}
	return s
}

func intOr(p *int, def int) int {
	if p == nil {
		return def
	}
	return *p
}

// Viewer is the signed-in person a response is projected for.
type Viewer struct {
	SignedIn   bool
	PersonID   string
	FullName   string
	Roles      []string
	HasRole    map[string]bool
	Paddle     *int
	RegStatus  string
	RegRole    string
	SpendLimit *int
}

// AnonymousViewer is the viewer behind a request with no session.
func AnonymousViewer() Viewer {
	return Viewer{Roles: []string{}, HasRole: map[string]bool{}}
}

// IsBidder reports whether the viewer bids in this sale.
func (v Viewer) IsBidder() bool { return v.HasRole["bidder"] }

// IsConsignor reports whether the viewer consigns in this sale.
func (v Viewer) IsConsignor() bool { return v.HasRole["consignor"] }

func remainingSeconds(closesAt *time.Time, serverNow time.Time, live bool) int {
	if closesAt == nil || !live {
		return 0
	}
	d := closesAt.Sub(serverNow)
	if d <= 0 {
		return 0
	}
	return int(math.Ceil(d.Seconds()))
}

func timeOrNil(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

func intPtrOrNil(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

// publicLot projects a lot for a signed-out page, and for any signed-in role
// looking at a lot that is not their own consignment.
func publicLot(l lotRow, st domain.Standing, serverNow time.Time) map[string]any {
	status := domain.PublicStatus(l.State, l.SoldAtHammer)
	var price, leaderPaddle any
	if st.BidCount > 0 {
		price = st.Price
		leaderPaddle = st.LeaderPddl
	}
	return map[string]any{
		"id":                l.ID,
		"sale_id":           strOrNil(l.SaleID),
		"lot_number":        intPtrOrNil(l.LotNumber),
		"title":             l.Title,
		"category":          l.Category,
		"description":       l.Description,
		"condition":         l.Condition,
		"portrait":          strOrNil(l.Portrait),
		"estimate_low":      intPtrOrNil(l.EstimateLow),
		"estimate_high":     intPtrOrNil(l.EstimateHigh),
		"opening_bid":       intPtrOrNil(l.OpeningBid),
		"price":             price,
		"asking":            st.Asking,
		"bid_count":         st.BidCount,
		"leader_paddle":     leaderPaddle,
		"reserve_met":       st.ReserveMet,
		"status":            status,
		"closes_at":         timeOrNil(l.ClosesAt),
		"remaining_seconds": remainingSeconds(l.ClosesAt, serverNow, domain.IsLive(l.State)),
		"server_now":        serverNow.UTC().Format(time.RFC3339),
	}
}

// bidderLot adds the three keys a bidder sees on top of the public projection:
// their own maximum, their lead and their watch.
func bidderLot(l lotRow, st domain.Standing, bids []bidRow, serverNow time.Time,
	personID string, watching bool) map[string]any {
	m := publicLot(l, st, serverNow)
	var myMax any
	for _, b := range bids {
		if b.BidderID == personID {
			if cur, ok := myMax.(int); !ok || b.MaxEuros > cur {
				myMax = b.MaxEuros
			}
		}
	}
	m["my_max"] = myMax
	m["i_lead"] = st.HasLeader && st.LeaderID == personID
	m["watching"] = watching
	return m
}

// consignorLot projects a lot for the consignor who owns it. It carries the
// price, the bid count and the result, and never a paddle or any other
// bidder detail.
func consignorLot(l lotRow, st domain.Standing, serverNow time.Time, offer map[string]any) map[string]any {
	var price any
	if st.BidCount > 0 {
		price = st.Price
	}
	return map[string]any{
		"id":                 l.ID,
		"sale_id":            strOrNil(l.SaleID),
		"lot_number":         intPtrOrNil(l.LotNumber),
		"title":              l.Title,
		"category":           l.Category,
		"description":        l.Description,
		"condition":          l.Condition,
		"portrait":           strOrNil(l.Portrait),
		"estimate_low":       intPtrOrNil(l.EstimateLow),
		"estimate_high":      intPtrOrNil(l.EstimateHigh),
		"opening_bid":        intPtrOrNil(l.OpeningBid),
		"reserve":            intPtrOrNil(l.Reserve),
		"price":              price,
		"bid_count":          st.BidCount,
		"reserve_met":        st.ReserveMet,
		"state":              l.State,
		"closes_at":          timeOrNil(l.ClosesAt),
		"remaining_seconds":  remainingSeconds(l.ClosesAt, serverNow, domain.IsLive(l.State)),
		"server_now":         serverNow.UTC().Format(time.RFC3339),
		"hammer":             intPtrOrNil(l.Hammer),
		"second_chance_open": secondChanceOpen(l, st),
		"offer":              offerOrNil(offer),
	}
}

// staffLot adds the consignor's name and the leader's paddle for the desks.
func staffLot(l lotRow, st domain.Standing, serverNow time.Time, offer map[string]any) map[string]any {
	m := consignorLot(l, st, serverNow, offer)
	m["consignor_name"] = l.ConsignorName
	var leaderPaddle any
	if st.BidCount > 0 {
		leaderPaddle = st.LeaderPddl
	}
	m["leader_paddle"] = leaderPaddle
	return m
}

func offerOrNil(offer map[string]any) any {
	if offer == nil {
		return nil
	}
	return offer
}

// secondChanceOpen is true only for a closed-unsold lot with at least one
// remaining bid and no decision yet.
func secondChanceOpen(l lotRow, st domain.Standing) bool {
	return l.State == domain.LotClosedUnsold && st.BidCount > 0 && !l.SecondChanceDecided
}

func strOrNil(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

// publicHistory and the other history projections list one row per accepted
// bid that has not been removed, newest first.
func publicHistory(bids []bidRow) []map[string]any {
	out := make([]map[string]any, 0, len(bids))
	for i := len(bids) - 1; i >= 0; i-- {
		b := bids[i]
		out = append(out, map[string]any{
			"paddle":      b.Paddle,
			"price_after": b.PriceAfter,
			"accepted_at": b.AcceptedAt.UTC().Format(time.RFC3339),
		})
	}
	return out
}

func consignorHistory(bids []bidRow) []map[string]any {
	out := make([]map[string]any, 0, len(bids))
	for i := len(bids) - 1; i >= 0; i-- {
		b := bids[i]
		out = append(out, map[string]any{
			"price_after": b.PriceAfter,
			"accepted_at": b.AcceptedAt.UTC().Format(time.RFC3339),
		})
	}
	return out
}

func adminHistory(bids []bidRow) []map[string]any {
	out := make([]map[string]any, 0, len(bids))
	for i := len(bids) - 1; i >= 0; i-- {
		b := bids[i]
		out = append(out, map[string]any{
			"bid_id":      b.ID,
			"paddle":      b.Paddle,
			"bidder_name": b.BidderName,
			"max_amount":  b.MaxEuros,
			"price_after": b.PriceAfter,
			"accepted_at": b.AcceptedAt.UTC().Format(time.RFC3339),
		})
	}
	return out
}

func isWatching(ctx context.Context, tx pgx.Tx, lotID, personID string) (bool, error) {
	if personID == "" {
		return false, nil
	}
	var watching bool
	err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM watches WHERE lot_id = $1 AND person_id = $2)`,
		lotID, personID).Scan(&watching)
	if err != nil {
		return false, fmt.Errorf("read watch on lot %s: %w", lotID, err)
	}
	return watching, nil
}
