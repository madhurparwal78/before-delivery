package saleroom

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Event types on the change feed, matching the socket frame types.
const (
	EventLotChanged = "lot_changed"
	EventNotice     = "notice"
)

// Causes a lot_changed frame can carry.
const (
	CauseBid       = "bid"
	CauseExtension = "extension"
	CauseRemoval   = "removal"
	CauseClose     = "close"
	CauseOffer     = "offer"
	CauseWatch     = "watch"
)

// Event is one row of the numbered change feed.
type Event struct {
	Seq      int64
	Type     string
	Cause    string
	LotID    string
	PersonID string
	NoticeID string
}

// recordLotChange writes one event for a committed change to a lot and tells
// every app process at commit.
func recordLotChange(ctx context.Context, tx pgx.Tx, cause, lotID string) error {
	return record(ctx, tx, Event{Type: EventLotChanged, Cause: cause, LotID: lotID})
}

// recordWatchChange writes the watch event, which only the bidder who watched
// or unwatched the lot ever sees.
func recordWatchChange(ctx context.Context, tx pgx.Tx, lotID, personID string) error {
	return record(ctx, tx, Event{
		Type: EventLotChanged, Cause: CauseWatch, LotID: lotID, PersonID: personID,
	})
}

func record(ctx context.Context, tx pgx.Tx, e Event) error {
	var seq int64
	err := tx.QueryRow(ctx,
		`INSERT INTO events (type, cause, lot_id, person_id, notice_id)
		 VALUES ($1, nullif($2,''), nullif($3,''), nullif($4,''), nullif($5,''))
		 RETURNING seq`,
		e.Type, e.Cause, e.LotID, e.PersonID, e.NoticeID).Scan(&seq)
	if err != nil {
		return fmt.Errorf("record %s event: %w", e.Type, err)
	}
	if _, err := tx.Exec(ctx, `SELECT pg_notify($1, $2)`, changeChannel, fmt.Sprint(seq)); err != nil {
		return fmt.Errorf("announce event %d: %w", seq, err)
	}
	return nil
}

// LatestSeq is the sequence a page's socket resumes from.
func (s *Saleroom) LatestSeq(ctx context.Context) (int64, error) {
	var seq int64
	err := s.pool.QueryRow(ctx, `SELECT coalesce(max(seq), 0) FROM events`).Scan(&seq)
	if err != nil {
		return 0, fmt.Errorf("read latest event sequence: %w", err)
	}
	return seq, nil
}

func latestSeqTx(ctx context.Context, tx pgx.Tx) (int64, error) {
	var seq int64
	if err := tx.QueryRow(ctx, `SELECT coalesce(max(seq), 0) FROM events`).Scan(&seq); err != nil {
		return 0, fmt.Errorf("read latest event sequence: %w", err)
	}
	return seq, nil
}

// EventsSince reads the change feed from a sequence number upward, so a
// reconnecting socket receives every event it missed, once each.
func (s *Saleroom) EventsSince(ctx context.Context, since int64, limit int) ([]Event, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT seq, type, coalesce(cause,''), coalesce(lot_id,''),
		        coalesce(person_id,''), coalesce(notice_id,'')
		   FROM events WHERE seq > $1 ORDER BY seq LIMIT $2`, since, limit)
	if err != nil {
		return nil, fmt.Errorf("read events since %d: %w", since, err)
	}
	defer rows.Close()
	var out []Event
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.Seq, &e.Type, &e.Cause, &e.LotID, &e.PersonID, &e.NoticeID); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
