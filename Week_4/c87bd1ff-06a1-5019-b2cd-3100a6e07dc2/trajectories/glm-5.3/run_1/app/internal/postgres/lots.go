package postgres

import (
	"context"
	"database/sql/driver"
	"fmt"
	"strings"
	"time"

	"gavelhouse/internal/store"
)

// pqStringArray writes and reads a postgres text array.
type pqStringArray []string

func (a pqStringArray) Value() (driver.Value, error) {
	if a == nil {
		return "{}", nil
	}
	parts := make([]string, len(a))
	for i, s := range a {
		parts[i] = `"` + strings.ReplaceAll(s, `"`, `\"`) + `"`
	}
	return "{" + strings.Join(parts, ",") + "}", nil
}

func (a *pqStringArray) Scan(src any) error {
	switch x := src.(type) {
	case nil:
		*a = nil
	case []byte:
		parsePqArray(string(x), a)
	case string:
		parsePqArray(x, a)
	default:
		return fmt.Errorf("unexpected array value %v", src)
	}
	return nil
}

func parsePqArray(s string, dst *pqStringArray) {
	s = strings.TrimPrefix(strings.TrimSuffix(s, "}"), "{")
	if s == "" {
		*dst = nil
		return
	}
	var items []string
	var cur strings.Builder
	inQuote := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '"':
			inQuote = !inQuote
		case c == '\\' && inQuote:
			if i+1 < len(s) {
				i++
				cur.WriteByte(s[i])
			}
		case c == ',' && !inQuote:
			items = append(items, cur.String())
			cur.Reset()
		default:
			cur.WriteByte(c)
		}
	}
	items = append(items, cur.String())
	*dst = items
}

// ---- lots ----

const lotCols = `l.id, l.sale_id, l.position, l.consignor_id, COALESCE(c.full_name, p.name), l.lot_number, l.title, l.category,
	l.description, l.condition, l.portrait, l.estimate_low, l.estimate_high, l.opening_bid, l.reserve,
	l.price, l.leader_bid_id, l.reserve_met, l.state, l.closes_at, l.closed_at, l.hammer, l.second_chance_done`

const lotFrom = ` FROM lots l
	LEFT JOIN people p ON p.id = l.consignor_id
	LEFT JOIN registrations c ON c.person_id = l.consignor_id `

func scanLot(scan func(...any) error) (*store.Lot, error) {
	var (
		id, consignorID, consignorName, title, category, description, condition, portrait, state   string
		saleID, position, lotNumber, estLow, estHigh, opening, reserve, price, leaderBidID, hammer any
		reserveMet, scDone                                                                         bool
		closesAt, closedAt                                                                         any
	)
	if err := scan(&id, &saleID, &position, &consignorID, &consignorName, &lotNumber, &title, &category,
		&description, &condition, &portrait, &estLow, &estHigh, &opening, &reserve,
		&price, &leaderBidID, &reserveMet, &state, &closesAt, &closedAt, &hammer, &scDone); err != nil {
		return nil, err
	}
	lot := store.Lot{
		ID: id, ConsignorID: consignorID, ConsignorName: consignorName,
		Title: title, Category: category, Description: description,
		Condition: condition, Portrait: portrait, State: state,
		ReserveMet: reserveMet, SecondChanceDone: scDone,
	}
	lot.SaleID = strPtr(saleID)
	lot.Position = intPtr(position)
	lot.LotNumber = intPtr(lotNumber)
	lot.EstimateLow = intPtr(estLow)
	lot.EstimateHigh = intPtr(estHigh)
	lot.OpeningBid = intPtr(opening)
	lot.Reserve = intPtr(reserve)
	lot.Price = intPtr(price)
	lot.LeaderBidID = strPtr(leaderBidID)
	lot.Hammer = intPtr(hammer)
	if t := timePtr(closesAt); t != nil {
		lot.ClosesAt = t
	}
	if t := timePtr(closedAt); t != nil {
		lot.ClosedAt = t
	}
	return &lot, nil
}

func (t *Tx) CreateLot(ctx context.Context, lot store.Lot) (store.Lot, error) {
	_, err := t.tx.ExecContext(ctx, `INSERT INTO lots (id, consignor_id, title, category, description, state)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		lot.ID, lot.ConsignorID, lot.Title, lot.Category, lot.Description, lot.State)
	if err != nil {
		return store.Lot{}, fmt.Errorf("saving the lot: %w", err)
	}
	return lot, nil
}

func (t *Tx) GetLot(ctx context.Context, id string) (*store.Lot, error) {
	row := t.tx.QueryRowContext(ctx, `SELECT `+lotCols+lotFrom+` WHERE l.id = $1`, id)
	lot, err := scanLot(row.Scan)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the lot: %w", err)
	}
	return lot, nil
}

func (t *Tx) queryLots(ctx context.Context, query string, args ...any) ([]store.Lot, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT `+lotCols+lotFrom+query, args...)
	if err != nil {
		return nil, fmt.Errorf("reading the lots: %w", err)
	}
	defer rows.Close()
	var out []store.Lot
	for rows.Next() {
		lot, err := scanLot(rows.Scan)
		if err != nil {
			return nil, fmt.Errorf("reading a lot: %w", err)
		}
		out = append(out, *lot)
	}
	return out, rows.Err()
}

func (t *Tx) ConsignorLots(ctx context.Context, consignorID string) ([]store.Lot, error) {
	return t.queryLots(ctx, ` WHERE l.consignor_id = $1 ORDER BY l.created_at, l.id`, consignorID)
}

func (t *Tx) DeskLotsByState(ctx context.Context, states []string) ([]store.Lot, error) {
	return t.queryLots(ctx, ` WHERE l.state = ANY($1) ORDER BY l.created_at, l.id`, states)
}

func (t *Tx) SaleLots(ctx context.Context, saleID string) ([]store.Lot, error) {
	return t.queryLots(ctx, ` WHERE l.sale_id = $1 ORDER BY l.position NULLS LAST, l.lot_number NULLS LAST`, saleID)
}

func (t *Tx) UpdateLotEstimate(ctx context.Context, lot store.Lot) error {
	_, err := t.tx.ExecContext(ctx, `UPDATE lots SET estimate_low = $2, estimate_high = $3, opening_bid = $4,
		reserve = $5, condition = $6, portrait = $7, state = $8 WHERE id = $1`,
		lot.ID, nullInt(lot.EstimateLow), nullInt(lot.EstimateHigh), nullInt(lot.OpeningBid),
		nullInt(lot.Reserve), lot.Condition, lot.Portrait, lot.State)
	if err != nil {
		return fmt.Errorf("saving the estimate: %w", err)
	}
	return nil
}

func (t *Tx) SetLotOrder(ctx context.Context, saleID string, lotIDs []string) error {
	for i, id := range lotIDs {
		if _, err := t.tx.ExecContext(ctx, `UPDATE lots SET sale_id = $1, position = $2, state = 'placed', lot_number = NULL WHERE id = $3`, saleID, i, id); err != nil {
			return fmt.Errorf("ordering the lots: %w", err)
		}
		if _, err := t.tx.ExecContext(ctx, `INSERT INTO events (kind, lot_id) VALUES ('estimate', $1)`, id); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
	}
	return nil
}

func (t *Tx) AssignLotNumbers(ctx context.Context, saleID string, first int, gap time.Duration, ends time.Time) error {
	rows, err := t.tx.QueryContext(ctx, `SELECT id FROM lots WHERE sale_id = $1 AND state = 'placed' ORDER BY position`, saleID)
	if err != nil {
		return fmt.Errorf("reading the sale's lots: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("reading a lot: %w", err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for k, id := range ids {
		number := first + k
		closes := ends.Add(time.Duration(k) * gap)
		if _, err := t.tx.ExecContext(ctx, `UPDATE lots SET lot_number = $2, closes_at = $3, state = 'open' WHERE id = $1`, id, number, closes); err != nil {
			return fmt.Errorf("opening the lot: %w", err)
		}
	}
	return nil
}

func (t *Tx) LotBids(ctx context.Context, lotID string) ([]store.Bid, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT b.id, b.lot_id, b.bidder_id, COALESCE(r.full_name, p.name), COALESCE(r.paddle, 0), b.max_amount, b.price_after, b.accepted_at
		FROM bids b
		JOIN people p ON p.id = b.bidder_id
		LEFT JOIN registrations r ON r.person_id = b.bidder_id
		WHERE b.lot_id = $1 AND b.removed_at IS NULL
		ORDER BY b.accepted_at, b.id`, lotID)
	if err != nil {
		return nil, fmt.Errorf("reading the bids: %w", err)
	}
	defer rows.Close()
	var out []store.Bid
	for rows.Next() {
		var b store.Bid
		if err := rows.Scan(&b.ID, &b.LotID, &b.BidderID, &b.BidderName, &b.Paddle, &b.MaxAmount, &b.PriceAfter, &b.AcceptedAt); err != nil {
			return nil, fmt.Errorf("reading a bid: %w", err)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (t *Tx) InsertBid(ctx context.Context, bid store.Bid, seq int64) error {
	_, err := t.tx.ExecContext(ctx, `INSERT INTO bids (id, lot_id, bidder_id, max_amount, price_after, accepted_at, seq)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		bid.ID, bid.LotID, bid.BidderID, bid.MaxAmount, bid.PriceAfter, bid.AcceptedAt, seq)
	if err != nil {
		return fmt.Errorf("saving the bid: %w", err)
	}
	return nil
}

func (t *Tx) RemoveBid(ctx context.Context, bidID string, reason string, removedAt time.Time) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE bids SET removed_at = $2, removed_reason = $3 WHERE id = $1 AND removed_at IS NULL`, bidID, removedAt, reason); err != nil {
		return fmt.Errorf("removing the bid: %w", err)
	}
	return nil
}

func (t *Tx) GetBid(ctx context.Context, bidID string) (*store.Bid, error) {
	var b store.Bid
	var removedAt any
	err := t.tx.QueryRowContext(ctx, `SELECT b.id, b.lot_id, b.bidder_id, COALESCE(r.full_name, p.name), COALESCE(r.paddle, 0), b.max_amount, b.price_after, b.accepted_at, b.removed_at
		FROM bids b
		JOIN people p ON p.id = b.bidder_id
		LEFT JOIN registrations r ON r.person_id = b.bidder_id
		WHERE b.id = $1`, bidID).Scan(&b.ID, &b.LotID, &b.BidderID, &b.BidderName, &b.Paddle, &b.MaxAmount, &b.PriceAfter, &b.AcceptedAt, &removedAt)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the bid: %w", err)
	}
	b.RemovedAt = timePtr(removedAt)
	return &b, nil
}

// ApplyBidResult stores the decided price, leader and reserve-met flag.
func (t *Tx) ApplyBidResult(ctx context.Context, lotID string, price int, leaderBidID string, reserveMet bool, lastBidID string) error {
	if leaderBidID == "" {
		if _, err := t.tx.ExecContext(ctx, `UPDATE lots SET price = $2, leader_bid_id = NULL, reserve_met = $3 WHERE id = $1`, lotID, price, reserveMet); err != nil {
			return fmt.Errorf("updating the lot: %w", err)
		}
		return nil
	}
	if _, err := t.tx.ExecContext(ctx, `UPDATE lots SET price = $2, leader_bid_id = $3, reserve_met = $4 WHERE id = $1`, lotID, price, leaderBidID, reserveMet); err != nil {
		return fmt.Errorf("updating the lot: %w", err)
	}
	return nil
}

func (t *Tx) SetLotState(ctx context.Context, lotID, state string) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE lots SET state = $2 WHERE id = $1`, lotID, state); err != nil {
		return fmt.Errorf("updating the lot: %w", err)
	}
	return nil
}

func (t *Tx) SetLotClose(ctx context.Context, lotID string, closesAt time.Time) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE lots SET closes_at = $2 WHERE id = $1`, lotID, closesAt); err != nil {
		return fmt.Errorf("extending the lot: %w", err)
	}
	return nil
}

func (t *Tx) CloseLotRow(ctx context.Context, lotID, state string, hammer int, closedAt time.Time) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE lots SET state = $2, hammer = $3, closed_at = $4 WHERE id = $1`, lotID, state, hammer, closedAt); err != nil {
		return fmt.Errorf("closing the lot: %w", err)
	}
	return nil
}

func (t *Tx) SetLotHammer(ctx context.Context, lotID string, hammer int, state string) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE lots SET hammer = $2, state = $3 WHERE id = $1`, lotID, hammer, state); err != nil {
		return fmt.Errorf("updating the lot: %w", err)
	}
	return nil
}

func (t *Tx) MarkSecondChanceDone(ctx context.Context, lotID string) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE lots SET second_chance_done = TRUE WHERE id = $1`, lotID); err != nil {
		return fmt.Errorf("updating the lot: %w", err)
	}
	return nil
}

// ---- watches ----

func (t *Tx) SetWatch(ctx context.Context, personID, lotID string, watching bool) error {
	if watching {
		if _, err := t.tx.ExecContext(ctx, `INSERT INTO watches (person_id, lot_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, personID, lotID); err != nil {
			return fmt.Errorf("saving the watch: %w", err)
		}
	} else {
		if _, err := t.tx.ExecContext(ctx, `DELETE FROM watches WHERE person_id = $1 AND lot_id = $2`, personID, lotID); err != nil {
			return fmt.Errorf("removing the watch: %w", err)
		}
	}
	return nil
}

func (t *Tx) IsWatching(ctx context.Context, personID, lotID string) (bool, error) {
	var one int
	err := t.tx.QueryRowContext(ctx, `SELECT 1 FROM watches WHERE person_id = $1 AND lot_id = $2`, personID, lotID).Scan(&one)
	if isNoRows(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("reading the watch: %w", err)
	}
	return true, nil
}

func (t *Tx) Watchers(ctx context.Context, lotID string) ([]string, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT person_id FROM watches WHERE lot_id = $1`, lotID)
	if err != nil {
		return nil, fmt.Errorf("reading the watchers: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("reading a watcher: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (t *Tx) WatchedLots(ctx context.Context, personID string) ([]store.Lot, error) {
	return t.queryLots(ctx, ` JOIN watches w ON w.lot_id = l.id WHERE w.person_id = $1 ORDER BY l.created_at`, personID)
}

func (t *Tx) MyMax(ctx context.Context, personID, lotID string) (*int, error) {
	var max any
	err := t.tx.QueryRowContext(ctx, `SELECT max_amount FROM bids WHERE bidder_id = $1 AND lot_id = $2 AND removed_at IS NULL`, personID, lotID).Scan(&max)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the maximum: %w", err)
	}
	return intPtr(max), nil
}

// Committed sums the bidder's leading maximums on open lots.
func (t *Tx) Committed(ctx context.Context, personID string) (int, error) {
	var total any
	err := t.tx.QueryRowContext(ctx, `SELECT sum(b.max_amount) FROM lots l
		JOIN bids b ON b.id = l.leader_bid_id
		WHERE l.state IN ('open','extended') AND b.bidder_id = $1 AND b.removed_at IS NULL`, personID).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("working out the committed amount: %w", err)
	}
	if total == nil {
		return 0, nil
	}
	return intOf(total), nil
}

func (t *Tx) ForEachLeadingLot(ctx context.Context, personID string, fn func(*store.LotFull) error) error {
	lots, err := t.queryLots(ctx, ` JOIN bids b ON b.id = l.leader_bid_id
		WHERE l.state IN ('open','extended') AND b.bidder_id = $1 AND b.removed_at IS NULL
		ORDER BY l.closes_at, l.id`, personID)
	if err != nil {
		return err
	}
	for i := range lots {
		bids, err := t.LotBids(ctx, lots[i].ID)
		if err != nil {
			return err
		}
		if err := fn(&store.LotFull{Lot: lots[i], Bids: bids}); err != nil {
			return err
		}
	}
	return nil
}

func (t *Tx) ForEachWonLot(ctx context.Context, personID string, fn func(*store.LotFull) error) error {
	lots, err := t.queryLots(ctx, ` WHERE l.leader_bid_id IN (SELECT id FROM bids WHERE bidder_id = $1)
		AND l.state IN ('closed_sold','invoiced','paid','sold_by_offer','defaulted')
		ORDER BY l.closed_at DESC, l.id`, personID)
	if err != nil {
		return err
	}
	for i := range lots {
		bids, err := t.LotBids(ctx, lots[i].ID)
		if err != nil {
			return err
		}
		if err := fn(&store.LotFull{Lot: lots[i], Bids: bids}); err != nil {
			return err
		}
	}
	return nil
}

// ---- idempotency ----

func (t *Tx) GetIdempotency(ctx context.Context, bidderID, key string) (*store.IdemRecord, error) {
	var rec store.IdemRecord
	err := t.tx.QueryRowContext(ctx, `SELECT body_hash, status, response FROM idempotency WHERE bidder_id = $1 AND key = $2`, bidderID, key).
		Scan(&rec.BodyHash, &rec.Status, &rec.Response)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the idempotency key: %w", err)
	}
	return &rec, nil
}

func (t *Tx) InsertIdempotency(ctx context.Context, bidderID, key, bodyHash string, status int, body []byte) error {
	if _, err := t.tx.ExecContext(ctx, `INSERT INTO idempotency (bidder_id, key, body_hash, status, response) VALUES ($1,$2,$3,$4,$5)`,
		bidderID, key, bodyHash, status, body); err != nil {
		return fmt.Errorf("saving the idempotency key: %w", err)
	}
	return nil
}
