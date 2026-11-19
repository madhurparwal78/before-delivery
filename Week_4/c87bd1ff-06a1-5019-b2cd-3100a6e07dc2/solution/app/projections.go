package main

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"strings"
	"time"
)

var amsterdam = mustLocation("Europe/Amsterdam")

func mustLocation(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic("time zone " + name + ": " + err.Error())
	}
	return loc
}

// rotterdamTime is "12 Nov 2026, 20:14:30" in Rotterdam local time.
func rotterdamTime(t time.Time) string { return t.In(amsterdam).Format("2 Jan 2006, 15:04:05") }

func apiTime(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func optTime(t sql.NullTime) any {
	if !t.Valid {
		return nil
	}
	return apiTime(t.Time)
}

func optInt(n sql.NullInt64) any {
	if !n.Valid {
		return nil
	}
	return int(n.Int64)
}

func optString(s sql.NullString) any {
	if !s.Valid {
		return nil
	}
	return s.String
}

// lotRow is a lot as the database holds it, with the joined names a projection needs.
type lotRow struct {
	ID, ConsignorID, Category, Title, Description, State, Condition string
	Portrait, SaleID, Result, LeaderID, WinnerID                    sql.NullString
	LotNumber, EstLow, EstHigh, Opening, Reserve, Price             sql.NullInt64
	LeaderMax, Hammer, LeaderPaddle, MyMax                          sql.NullInt64
	BidCount                                                        int
	ClosesAt                                                        sql.NullTime
	Decided, Watching                                               bool
	ConsignorName                                                   string
}

const lotColumns = `l.id, l.consignor_id, l.category, l.title, l.description, l.state, l.condition,
	l.portrait, l.sale_id, l.result, l.leader_id, l.winner_id,
	l.lot_number, l.estimate_low, l.estimate_high, l.opening_bid, l.reserve, l.price,
	l.leader_max, l.hammer, lr.paddle,
	(SELECT max(b.max_amount) FROM bids b WHERE b.lot_id = l.id AND b.person_id = $1 AND b.removed_at IS NULL),
	l.bid_count, l.closes_at, l.decided,
	EXISTS (SELECT 1 FROM watches w WHERE w.lot_id = l.id AND w.person_id = $1),
	COALESCE(cr.full_name, cp.display_name)`

const lotJoins = `FROM lots l
	JOIN people cp ON cp.id = l.consignor_id
	LEFT JOIN registrations cr ON cr.person_id = l.consignor_id
	LEFT JOIN registrations lr ON lr.person_id = l.leader_id`

func scanLot(rows interface{ Scan(...any) error }) (*lotRow, error) {
	l := &lotRow{}
	err := rows.Scan(&l.ID, &l.ConsignorID, &l.Category, &l.Title, &l.Description, &l.State, &l.Condition,
		&l.Portrait, &l.SaleID, &l.Result, &l.LeaderID, &l.WinnerID,
		&l.LotNumber, &l.EstLow, &l.EstHigh, &l.Opening, &l.Reserve, &l.Price,
		&l.LeaderMax, &l.Hammer, &l.LeaderPaddle, &l.MyMax,
		&l.BidCount, &l.ClosesAt, &l.Decided, &l.Watching, &l.ConsignorName)
	if err != nil {
		return nil, fmt.Errorf("scan lot: %w", err)
	}
	return l, nil
}

// loadLots reads lots for a viewer (person id, or "" for nobody) with a trailing SQL clause.
func loadLots(ctx context.Context, q querier, viewerID, clause string, args ...any) ([]*lotRow, error) {
	rows, err := q.QueryContext(ctx, "SELECT "+lotColumns+" "+lotJoins+" "+clause, append([]any{viewerID}, args...)...)
	if err != nil {
		return nil, fmt.Errorf("load lots: %w", err)
	}
	defer rows.Close()
	var out []*lotRow
	for rows.Next() {
		l, err := scanLot(rows)
		if err != nil {
			return nil, fmt.Errorf("load lots: %w", err)
		}
		out = append(out, l)
	}
	return out, readErr(rows, "lots")
}

func loadLot(ctx context.Context, q querier, viewerID, id string) (*lotRow, error) {
	lots, err := loadLots(ctx, q, viewerID, "WHERE l.id = $2", id)
	if err != nil || len(lots) == 0 {
		return nil, err
	}
	return lots[0], nil
}

// isRunning reports whether the lot still takes bids.
func (l *lotRow) isRunning() bool { return lotRunning(l.State) }

func (l *lotRow) published() bool { return lotPublished(l.State) }

// status is the hammer result the public sees; it never changes after the close.
func (l *lotRow) status() string { return publicStatus(l.State, l.Result.String) }

func (l *lotRow) remaining(now time.Time) int {
	if !l.isRunning() || !l.ClosesAt.Valid {
		return 0
	}
	return max(int(math.Ceil(l.ClosesAt.Time.Sub(now).Seconds())), 0)
}

func (l *lotRow) reserveMet() bool {
	return l.LeaderMax.Valid && l.Reserve.Valid && l.LeaderMax.Int64 >= l.Reserve.Int64
}

func (l *lotRow) askingValue() any {
	if !l.Opening.Valid {
		return nil
	}
	return asking(int(l.Price.Int64), int(l.Opening.Int64))
}

func (l *lotRow) secondChanceOpen() bool {
	return secondChanceAllowed(l.State, l.BidCount, l.Decided)
}

func (l *lotRow) public(now time.Time) map[string]any {
	return map[string]any{
		"id": l.ID, "sale_id": optString(l.SaleID), "lot_number": optInt(l.LotNumber), "title": l.Title,
		"category": l.Category, "description": l.Description, "condition": l.Condition, "portrait": optString(l.Portrait),
		"estimate_low": optInt(l.EstLow), "estimate_high": optInt(l.EstHigh), "opening_bid": optInt(l.Opening),
		"price": optInt(l.Price), "asking": l.askingValue(), "bid_count": l.BidCount,
		"leader_paddle": optInt(l.LeaderPaddle), "reserve_met": l.reserveMet(), "status": l.status(),
		"closes_at": optTime(l.ClosesAt), "remaining_seconds": l.remaining(now), "server_now": apiTime(now),
	}
}

func (l *lotRow) bidder(now time.Time, viewerID string) map[string]any {
	m := l.public(now)
	m["my_max"] = optInt(l.MyMax)
	m["i_lead"] = l.LeaderID.Valid && l.LeaderID.String == viewerID
	m["watching"] = l.Watching
	return m
}

func (l *lotRow) consignor(now time.Time, offer *offerRow) map[string]any {
	var offerJSON any
	if offer != nil {
		offerJSON = offer.json()
	}
	var hammer any
	if l.Hammer.Valid && hammerShown(l.State, l.Result.String) {
		hammer = int(l.Hammer.Int64)
	}
	return map[string]any{
		"id": l.ID, "sale_id": optString(l.SaleID), "lot_number": optInt(l.LotNumber), "title": l.Title,
		"category": l.Category, "description": l.Description, "condition": l.Condition, "portrait": optString(l.Portrait),
		"estimate_low": optInt(l.EstLow), "estimate_high": optInt(l.EstHigh), "opening_bid": optInt(l.Opening),
		"reserve": optInt(l.Reserve), "price": optInt(l.Price), "bid_count": l.BidCount, "reserve_met": l.reserveMet(),
		"state": l.State, "closes_at": optTime(l.ClosesAt), "remaining_seconds": l.remaining(now),
		"server_now": apiTime(now), "hammer": hammer, "second_chance_open": l.secondChanceOpen(), "offer": offerJSON,
	}
}

func (l *lotRow) staff(now time.Time, offer *offerRow) map[string]any {
	m := l.consignor(now, offer)
	m["consignor_name"] = l.ConsignorName
	m["leader_paddle"] = optInt(l.LeaderPaddle)
	return m
}

// offerRow is a second-chance or default offer with its lot's number and title.
type offerRow struct {
	ID, LotID, PersonID, Kind, Status, Title string
	LotNumber, Amount                        int
	ExpiresAt, CreatedAt                     time.Time
}

func (o *offerRow) json() map[string]any {
	return map[string]any{
		"id": o.ID, "lot_id": o.LotID, "lot_number": o.LotNumber, "title": o.Title, "kind": o.Kind,
		"amount": o.Amount, "expires_at": apiTime(o.ExpiresAt), "status": o.Status,
	}
}

const offerColumns = `o.id, o.lot_id, o.person_id, o.kind, o.status, l.title, COALESCE(l.lot_number, 0), o.amount, o.expires_at, o.created_at`

func loadOffers(ctx context.Context, q querier, clause string, args ...any) ([]*offerRow, error) {
	rows, err := q.QueryContext(ctx, "SELECT "+offerColumns+" FROM offers o JOIN lots l ON l.id = o.lot_id "+clause, args...)
	if err != nil {
		return nil, fmt.Errorf("load offers: %w", err)
	}
	defer rows.Close()
	var out []*offerRow
	for rows.Next() {
		o := &offerRow{}
		if err := rows.Scan(&o.ID, &o.LotID, &o.PersonID, &o.Kind, &o.Status, &o.Title, &o.LotNumber, &o.Amount, &o.ExpiresAt, &o.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan offer: %w", err)
		}
		out = append(out, o)
	}
	return out, readErr(rows, "offers")
}

// latestOffers maps lot id to the most recent offer on it.
func latestOffers(ctx context.Context, q querier, lotIDs []string) (map[string]*offerRow, error) {
	out := map[string]*offerRow{}
	if len(lotIDs) == 0 {
		return out, nil
	}
	holders := make([]string, len(lotIDs))
	args := make([]any, len(lotIDs))
	for i, id := range lotIDs {
		holders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}
	offers, err := loadOffers(ctx, q, "WHERE o.lot_id IN ("+strings.Join(holders, ",")+") ORDER BY o.created_at ASC", args...)
	if err != nil {
		return nil, err
	}
	for _, o := range offers {
		out[o.LotID] = o
	}
	return out, nil
}

// historyBid is one remaining bid with the price it left behind.
type historyBid struct {
	ID, PersonID, Name string
	Paddle             sql.NullInt64
	Max, PriceAfter    int
	At                 time.Time
}

// loadHistory returns the lot's remaining bids newest first, with the price after each.
func loadHistory(ctx context.Context, q querier, l *lotRow) ([]historyBid, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT b.id, b.person_id, COALESCE(r.full_name, p.display_name), r.paddle, b.max_amount, b.accepted_at
		FROM bids b JOIN people p ON p.id = b.person_id LEFT JOIN registrations r ON r.person_id = b.person_id
		WHERE b.lot_id = $1 AND b.removed_at IS NULL ORDER BY b.n ASC`, l.ID)
	if err != nil {
		return nil, fmt.Errorf("load bids: %w", err)
	}
	defer rows.Close()
	var asc []historyBid
	for rows.Next() {
		var h historyBid
		if err := rows.Scan(&h.ID, &h.PersonID, &h.Name, &h.Paddle, &h.Max, &h.At); err != nil {
			return nil, fmt.Errorf("scan bid: %w", err)
		}
		asc = append(asc, h)
	}
	if err := readErr(rows, "bid history"); err != nil {
		return nil, err
	}
	records := make([]bidRecord, len(asc))
	for i, h := range asc {
		records[i] = bidRecord{ID: h.ID, PersonID: h.PersonID, Max: h.Max}
	}
	s := resolve(records, int(l.Opening.Int64), int(l.Reserve.Int64))
	out := make([]historyBid, len(asc))
	for i, h := range asc {
		h.PriceAfter = s.PriceAfter[i]
		out[len(asc)-1-i] = h
	}
	return out, nil
}

func historyRows(history []historyBid, kind string) []map[string]any {
	out := make([]map[string]any, 0, len(history))
	for _, h := range history {
		switch kind {
		case "consignor":
			out = append(out, map[string]any{"price_after": h.PriceAfter, "accepted_at": apiTime(h.At)})
		case "admin":
			out = append(out, map[string]any{"bid_id": h.ID, "paddle": optInt(h.Paddle), "bidder_name": h.Name,
				"max_amount": h.Max, "price_after": h.PriceAfter, "accepted_at": apiTime(h.At)})
		default:
			out = append(out, map[string]any{"paddle": optInt(h.Paddle), "price_after": h.PriceAfter, "accepted_at": apiTime(h.At)})
		}
	}
	return out
}

// view says which projection a viewer gets of a lot.
type view int

const (
	viewPublic view = iota
	viewBidder
	viewConsignor
)

func viewFor(v *Viewer, l *lotRow) view {
	switch {
	case v == nil:
		return viewPublic
	case v.hasRole("bidder"):
		return viewBidder
	case v.hasRole("consignor") && l.ConsignorID == v.PersonID:
		return viewConsignor
	default:
		return viewPublic
	}
}

func viewerID(v *Viewer) string {
	if v == nil {
		return ""
	}
	return v.PersonID
}

// projectLot renders a lot and its history for a viewer.
func projectLot(ctx context.Context, q querier, v *Viewer, l *lotRow, now time.Time, offers map[string]*offerRow) (map[string]any, []map[string]any, error) {
	history, err := loadHistory(ctx, q, l)
	if err != nil {
		return nil, nil, err
	}
	switch viewFor(v, l) {
	case viewBidder:
		return l.bidder(now, v.PersonID), historyRows(history, "bidder"), nil
	case viewConsignor:
		return l.consignor(now, offers[l.ID]), historyRows(history, "consignor"), nil
	default:
		return l.public(now), historyRows(history, "public"), nil
	}
}

// catalogueLess orders running lots first by close, then closed lots by number.
func catalogueLess(a, b *lotRow) bool {
	if a.isRunning() != b.isRunning() {
		return a.isRunning()
	}
	if a.isRunning() {
		if !a.ClosesAt.Time.Equal(b.ClosesAt.Time) {
			return a.ClosesAt.Time.Before(b.ClosesAt.Time)
		}
	}
	return a.LotNumber.Int64 < b.LotNumber.Int64
}
